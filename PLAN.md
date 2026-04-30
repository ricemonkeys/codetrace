# CodeTrace — 프로젝트 계획 및 정적 기술 검토

> 본 문서는 `CodeTrace_Development_Plan.md` 원안을 기반으로,
> 구현 착수 전에 발생할 수 있는 기술적 위험과 사양 공백을 정리한
> 정적 리뷰(Static Review) 산출물입니다.
> 의사결정이 갱신될 때마다 이 문서를 업데이트하는 살아있는 문서로 운영합니다.

---

## 1. 원안 요약

- **무엇**: VS Code 익스텐션 + Webview 캔버스(Excalidraw) 기반의 협업형 코드 리뷰 도구
- **핵심 가치**: 코드를 캔버스 위에 '카드'로 올려놓고, 화살표·메모·드로잉으로 구조를 시각화하며 실시간으로 함께 본다
- **구성**:
  1. Extension Host — VS Code API, 코드 추출, LSP/AST 연동
  2. Webview Panel — React + Vite + Excalidraw
  3. Collaboration Layer — Yjs (CRDT) + WebSocket / WebRTC
  4. CLI — `ctrv open [room-id]`로 세션 참가
- **로드맵**: MVP → 실시간 협업 → 코드 분석 고도화 → 마켓플레이스 배포

---

## 2. 정적 검토 (Static Review)

### 2.1 Critical — 착수 전 결정 필요

#### C1. VS Code Webview는 에디터로부터의 네이티브 드래그를 받지 못한다
원안 4.1의 "에디터에서 선택한 코드 블록을 드래그하여 캔버스에 삽입"은 Webview API 한계로 **직접 구현 불가**.

- Webview는 sandboxed iframe이며, VS Code 에디터의 `dragstart` 이벤트가 외부로 전파되지 않음
- **대안 (권장)**:
  1. 에디터 선택 → 컨텍스트 메뉴(`editor/context`) 또는 단축키 → `codetrace.addSelectionToCanvas` 명령 실행
  2. Extension Host가 선택 텍스트 + 파일 URI + 라인 범위를 `webview.postMessage`로 전송
  3. Webview는 메시지를 받아 '코드 카드' 요소를 캔버스에 생성
- **영향**: UX 문구를 "드래그"에서 "선택 후 단축키" 또는 "선택 후 우클릭"으로 변경 필요

#### C2. Excalidraw에는 공식 Yjs 바인딩이 없다
원안 2.3의 "Yjs로 실시간 상태 동기화"는 어댑터를 직접 만들어야 함.

- Excalidraw는 `elements: ExcalidrawElement[]` 배열과 `appState`를 React state로 관리. CRDT 친화적 구조 아님
- 단순히 배열을 `Y.Array`로 감싸면 **같은 요소의 동시 편집 시 last-write-wins로 변경이 유실**됨
- **선택지**:
  - (A) Excalidraw 공식 collab 예제 패턴 — 중앙 서버에 broadcast, conflict 무시. CRDT 보장 약함
  - (B) `y-excalidraw` 등 서드파티 어댑터 채택 — 유지보수·품질 검증 필요
  - (C) elements를 element-id 단위 `Y.Map<Y.Map<...>>`으로 분해 — 구현 비용 큼, 정합성 가장 좋음
- **PoC 결과 (#4, 2026-05-01)**:
  - (B) `y-excalidraw@2.0.12`는 `Y.Array<Y.Map<{ pos, el }>>` 형태로 정렬과 전체 element 객체를 저장한다. 같은 element의 서로 다른 필드를 두 클라이언트가 동시에 수정하면 Yjs 수렴은 되지만 전체 element 객체 단위로 한쪽 변경이 이겨 독립 필드 변경이 유실될 수 있다.
  - (C) 직접 구현 PoC는 `Y.Map<elementId, Y.Map<field, value>>`로 field 단위 병합을 검증했다. 서로 다른 필드 동시 편집은 병합되고, 같은 필드 편집만 Yjs의 deterministic conflict resolution에 맡겨진다.
  - 번들/의존성 기준: 두 방식 모두 `yjs`가 필요하다. (B)는 추가로 `y-excalidraw`와 `fractional-indexing`에 의존하고, (C)는 어댑터 패키지 없이 CodeTrace 소유 sync 로직이 필요하다.
- **결정**: Phase 2 실시간 협업은 (C) element-id 단위 직접 Y.Map 바인딩으로 진행한다. `y-excalidraw`는 참고 구현으로만 유지한다.

#### C3. '코드 카드'는 Excalidraw 기본 요소가 아니다
원안 4.1의 "코드 카드"는 명세 공백.

- Excalidraw 내장 element type에 코드 하이라이팅 박스 없음 (`rectangle`, `text`, `arrow`, `image`, `frame`, `embeddable` 등)
- **선택지**:
  - (A) `embeddable`(iframe) 안에 Shiki/Monaco 렌더 — CSP·성능·iframe 통신 비용 발생
  - (B) `frame` + `text` 조합, `customData`로 카드 메타데이터 보관 — Excalidraw 공식 확장 포인트
  - (C) Excalidraw 위에 React 오버레이 레이어 추가, 카드만 별도 렌더 — 좌표·줌 동기화 직접 처리 필요
- **권장**: (B) `customData`. 직렬화·동기화 모두 Excalidraw 내에서 자연스럽게 처리됨

---

### 2.2 High — 사양 명확화 필요

#### H1. Yjs 서버 호스팅 전략 — ADR (결정일: 2026-05-01)

**Decision**
Phase 2 MVP 기준으로 자체 호스팅 `y-websocket` 단일 인스턴스를 채택한다.
개발 단계(dev-only)에서 먼저 운영하고, 첫 실제 사용자 투입 시점에 production-grade 구성을 검토한다.

**Rationale**
- `y-webrtc`: P2P. 공개 시그널링 서버 의존(운영 부적합), 20+ 참가자에서 대역폭 폭증
- `y-websocket`: 중앙 릴레이. 인프라 비용 발생하나 안정적이고 감사 용이
- 클라우드 관리형 서비스(Liveblocks 등)는 OSS 정책과 상충 가능 → 선택하지 않음

**Auth model**
- 방 입장 시 room token 필수 (room-ID만으로 접근 불가)
- 토큰은 VS Code `SecretStorage` API를 통해 키체인에 저장 (issue #31)
- 토큰 발급·검증 로직은 Phase 2 구현 시 확정

**Persistence**
- MVP: in-memory (프로세스 재시작 시 세션 소멸)
- 디스크 백업(WAL 또는 LevelDB)은 첫 paying customer 이후로 연기

**Assumptions**
- Q6: 라이선스는 MIT OSS 기준으로 가정. 상용화 모델 변경 시 재검토.

**Out of scope**
- 다중 리전, 비용 산정, WebRTC 하이브리드

**Revisit triggers**
- 첫 paying customer 발생
- 동시 접속 룸 50개 초과
- 팀 인프라 담당자 합류 또는 예산 변경

#### H2. AST 파서와 LSP의 역할 중복
원안은 LSP와 Tree-sitter를 함께 사용한다고만 기술. 책임 분리가 모호.

- VS Code LSP의 `DocumentSymbolProvider` / `ReferenceProvider` / `CallHierarchyProvider`만으로 함수·클래스 호출 관계 그래프 구성 가능
- Tree-sitter WASM은 언어당 200KB+ 번들 비용 → 마켓플레이스 배포 크기 압박
- **권장**:
  - 1차: VS Code 빌트인 LSP만 사용 (TS/JS/Python은 무료로 강력함)
  - 2차: LSP가 약한 언어·파편화된 분석에서만 Tree-sitter 보강

#### H3. CLI 사양 공백
원안 4.4 `ctrv open [room-id]`는 동작 정의가 모호.

- 새 VS Code 윈도우를 띄우는가, 실행 중 인스턴스에 attach 하는가?
- 인증 토큰·세션 키 전달 방식은? (CLI argv 노출 vs 환경변수 vs 키체인)
- 워크스페이스가 열려 있지 않은 상태에서 시작 가능한가?
- "iterm2" 명시는 macOS 한정 인상을 줌. Windows Terminal, gnome-terminal 등 터미널 무관해야 함
- **권장**: Phase 2에서 아래 방식으로 결정 후 구현
  - `code --reuse-window` + `vscode://codetrace.codetrace/join?room=...` URI 핸들러 호출
  - 토큰은 OS 키체인(`keytar`) 사용

#### H4. PR Diff Highlight — 인증 흐름 미정
원안 4.3의 "PR 정보를 가져와 변경된 코드 라인을 강조"는 외부 API 의존.

- **공백**: 인증(GitHub PAT vs OAuth App vs GitHub App), 사설 호스팅(GitLab/Bitbucket) 지원 범위, 다중 리모트 처리, rate limit 대응
- **권장**: Phase 3에서 GitHub.com 한정으로 시작, OAuth Device Flow + PAT 폴백

#### H5. 로컬 저장 포맷 미정
원안 Phase 1의 "로컬 저장 기능" 저장 위치·포맷 미정. **Phase 2 동기화 데이터 모델과 동일해야 마이그레이션 비용을 줄일 수 있으므로 지금 결정 필요.**

- 위치 후보:
  - `.codetrace/canvases/<id>.json` — 워크스페이스에 커밋 가능
  - `ExtensionContext.globalStorageUri` — 사용자 글로벌, 공유 불가
  - `ExtensionContext.workspaceState` — 용량 한계, JSON 직렬화
- **권장**: 워크스페이스 폴더 기반 `.codetrace/` 파일. Excalidraw scene + 자체 메타데이터를 JSON으로 저장. `.gitignore` 여부는 사용자 선택

---

### 2.3 Medium — 구현 단계에서 처리

#### M1. Webview CSP 미명시
- VS Code Webview는 strict CSP 권장. nonce 기반 inline script 정책 필수
- 외부 리소스(폰트·이미지)는 `webview.asWebviewUri()` 변환 필요
- WebSocket은 `connect-src wss://your.server` 명시
- **준수 항목**: CSP meta tag, nonce, `asWebviewUri`, `localResourceRoots` 최소화

#### M2. Tailwind + Excalidraw 스타일 충돌
- Tailwind `preflight` (CSS reset)이 Excalidraw 내장 스타일을 깨뜨릴 수 있음
- **권장**: `corePlugins: { preflight: false }` 또는 Excalidraw 컨테이너를 Tailwind scope 밖으로 분리

#### M3. 코드 카드 데이터 모델 정규화
멀티 사용자·워크스페이스 환경에서 동일 코드를 가리키려면 식별자 정규화 필요.

**권장 스키마**:
```ts
type CodeCard = {
  id: string;           // ULID
  file: {
    path: string;       // 워크스페이스 루트 기준 상대 경로 (POSIX 슬래시)
    gitCommit?: string; // HEAD 커밋 해시 (있으면)
  };
  range: {
    startLine: number;  // 1-indexed
    endLine: number;    // 1-indexed, inclusive
  };
  snapshot: string;     // 캡처 시점의 텍스트 (drift 감지용)
  language: string;     // VS Code language ID
  customData: Record<string, unknown>;
};
```

파일 변경 후 라인이 어긋나면(`snapshot`과 현재 텍스트 불일치) 카드에 "stale" 마커 표시.

#### M4. 테스트 전략 보강
- 익스텐션 단위 테스트: `@vscode/test-electron` 또는 `@vscode/test-cli`. 현재 미설치
- Webview 컴포넌트: jsdom + React Testing Library
- E2E: Playwright는 Webview HTML을 직접 테스트 가능하나, **익스텐션 활성화·명령 호출까지 포함하려면 `@vscode/test-electron` 결합 필요**
- 현재 CI(`system-test.yml`)는 `frontend/playwright.config.ts` 존재만 검사 → 익스텐션 E2E 잡 별도 추가 필요

#### M5. 크로스 플랫폼은 Phase 4가 아니라 Phase 0
원안 Phase 4의 "Windows/macOS 환경 설정 최적화"는 사후 적용이 어려움.

- LF 통일, `path.posix` 사용, 파일 감시(`fs.watch` vs `chokidar`) 차이는 초반부터 강제해야 회귀 비용이 적음
- 이미 `.editorconfig` 추가됨 ✓. 추가로 `.gitattributes` (`text=auto eol=lf`) 검토 필요

---

### 2.4 운영·품질 보강

| 항목 | 상태 | 비고 |
|------|------|------|
| `LICENSE` | ✅ 완료 | MIT |
| `SECURITY.md` | 누락 | 취약점 신고 채널 명시 |
| `.github/ISSUE_TEMPLATE/` | ✅ 완료 | bug / feature 분리 |
| 텔레메트리·에러 리포팅 | 미정 | 옵트인 + `vscode.env.isTelemetryEnabled` 준수 |
| `CHANGELOG.md` | 미생성 | Release workflow가 자동 생성하나 초기 빈 파일 필요 |
| `.gitattributes` | ✅ 완료 | LF 강제 (`* text=auto eol=lf`) |
| `CONTRIBUTING.md` | ✅ 완료 | 브랜치 전략·커밋 컨벤션·로컬 세팅 포함 |
| Yjs 서버 운영 계획 | 결정됨 (2026-05-01) | Phase 2 MVP: 자체 호스팅 `y-websocket` 단일 인스턴스, in-memory, room token 인증. 상세는 §H1 ADR 참조 |

---

## 3. 보완된 로드맵

### Phase 0 — 데이터 모델·기술 PoC (신규 추가)
*완료 기준*: 아래 결정이 이 문서에 반영됨.

- [ ] CodeCard 스키마 확정 (§M3)
- [x] Excalidraw + Yjs 바인딩 후보 비교 PoC (§C2 A/B/C)
- [ ] '코드 카드' 렌더 방식 결정 (§C3 A/B/C)
- [ ] 로컬 저장 포맷·위치 결정 (§H5)
- [x] Yjs 서버 호스팅 전략 결정 (§H1, §2.4 표)
- [ ] CSP 정책 초안 작성 (§M1)
- [ ] `.gitattributes` 추가

### Phase 1 — MVP
*완료 기준*: 단일 사용자가 캔버스에 코드 카드를 올리고 저장·재열기 가능.

- [ ] `codetrace.openCanvas` 명령으로 Webview 패널 표시
- [ ] `codetrace.addSelectionToCanvas` 명령 (컨텍스트 메뉴 + 단축키): 선택 → 카드 생성 (§C1 대안)
- [ ] 카드 더블클릭 → 원본 라인으로 navigate (Bi-directional Navigation)
- [ ] `.codetrace/canvases/*.json`으로 저장·로드 (§H5 결정 반영)
- [ ] 카드 stale 감지 (snapshot ≠ 현재 텍스트, §M3)
- [ ] 단위 테스트: 익스텐션 명령, 카드 컴포넌트, 직렬화 라운드트립 (§M4)

### Phase 2 — 실시간 협업
*완료 기준*: 두 사용자가 동일 룸에서 카드·드로잉·커서를 실시간 공유.

- [ ] 자체 호스팅 `y-websocket` 서버 배포 (§H1)
- [ ] Yjs 어댑터 통합 — element-id 단위 직접 `Y.Map<Y.Map<...>>` 바인딩 (§C2 결정 반영)
- [ ] Awareness 기반 presence (커서·이름)
- [ ] 룸 생성·초대 링크 (`vscode://codetrace.codetrace/join?room=...`)
- [ ] 인증 토큰을 OS 키체인에 보관 (`keytar`)
- [ ] CLI `ctrv open [room-id]` (§H3 결정 반영)
- [ ] 통합 테스트: 두 클라이언트 시뮬레이션

### Phase 3 — 코드 분석 고도화
*완료 기준*: TS 프로젝트에서 함수 호출 그래프가 카드 간 화살표로 자동 생성.

- [ ] LSP `CallHierarchyProvider` 기반 호출 관계 그래프 (§H2)
- [ ] PR Diff Highlight (GitHub.com 한정, OAuth Device Flow + PAT 폴백, §H4)
- [ ] (옵션) Tree-sitter로 LSP 미지원 언어 보강

### Phase 4 — 배포·안정화
*완료 기준*: VS Code Marketplace에 v1.0 게시.

- [ ] `LICENSE` / `SECURITY.md` / `CONTRIBUTING.md` / `CHANGELOG.md` 정비 (§2.4 표)
- [ ] 텔레메트리 옵트인 (`vscode.env.isTelemetryEnabled`)
- [ ] 마켓플레이스 메타데이터, 아이콘, 스크린샷
- [ ] Windows·macOS·Linux 매트릭스 E2E 검증

---

## 4. Open Questions (팀 합의 필요)

> Phase 0 진입 시 답이 있어야 하는 항목.

| # | 질문 | 관련 섹션 |
|---|------|----------|
| Q1 | ~~**Yjs 서버 운영 주체**: 자체 호스팅 vs 사용자가 자체 서버 운영 vs 매니지드 서비스(Liveblocks·PartyKit)~~ **결정됨** (2026-05-01): 자체 호스팅 `y-websocket`. 상세 §H1 ADR | §H1, §2.4 |
| Q2 | ~~**룸 인증**: 룸 ID만 알면 누구나 입장 가능한가? 토큰·초대 링크 만료 정책은?~~ **결정됨** (2026-05-01): room token 필수, SecretStorage 저장. 상세 §H1 ADR | §H3 |
| Q3 | **저장소 가시성**: `.codetrace/` 파일을 git에 커밋하는 것이 기본인가? `.gitignore` 가이드는? | §H5 |
| Q4 | **PR 통합 범위**: GitHub.com만? GitLab·Bitbucket은 언제? | §H4 |
| Q5 | **다중 워크스페이스 매핑**: 사용자 A의 `monorepo/packages/foo`와 사용자 B의 `foo`가 다른 절대 경로일 때 카드를 어떻게 매핑할 것인가? | §M3 |
| Q6 | **라이선스·상용화**: 오픈소스(MIT)인가, 상용 모델인가? Marketplace publisher ID는? — **가정**: MIT OSS. 상용화 모델 변경 시 §H1 Revisit triggers 조건으로 재검토 | §2.4 |

---

## 5. 다음 단계 (제안)

1. 이 문서를 팀과 공유하고 **Q1·Q2·Q5** 우선 합의
2. Phase 0 PoC 브랜치(`feat/poc-yjs-excalidraw`) 개설
3. `LICENSE`, `.gitattributes` 추가는 Phase 0와 별개로 즉시 가능 → 별도 PR
