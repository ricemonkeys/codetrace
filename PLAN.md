# CodeTrace — 프로젝트 계획 및 정적 기술 검토

> 본 문서는 `CodeTrace_Development_Plan.md` 원안을 기반으로,
> 구현 착수 전에 발생할 수 있는 기술적 위험과 사양 공백을 정리한
> 정적 리뷰(Static Review) 산출물입니다.
> 의사결정이 갱신될 때마다 이 문서를 업데이트하는 살아있는 문서로 운영합니다.

---

## 1. 원안 요약

- **무엇**: VS Code 익스텐션 + Webview 캔버스(Excalidraw) 기반의 협업형 코드 리뷰 도구
- **핵심 가치 (2026-05-02 §C4 재정의)**:
  시스템이 워크스페이스를 분석해 **파일·함수 마인드맵을 자동으로 그려주고**, 사용자는 그 위에 **포스트잇으로 리뷰 코멘트**를 부착한다.
  포스트잇은 소스 코드의 주석으로 영속화되어 git으로 공유된다.
  사용자는 노드/엣지를 직접 그리지 않으며, 화살표/텍스트는 마인드맵 안에서만 보이는 보조 시각화 도구로 제공된다.
- **구성**:
  1. Extension Host — VS Code API, LSP/AST 분석(`extractWorkspaceCallGraph`), 소스 주석 동기화
  2. Webview Panel — React + Vite + Excalidraw (자동 그래프 + 포스트잇 + 보조 도구 단일 화면)
  3. Collaboration Layer — Yjs (CRDT) + WebSocket (Phase 2)
  4. CLI — `ctrv open [room-id]`로 세션 참가
- **로드맵**: MVP(자동 마인드맵 + 포스트잇 + 소스 주석 round-trip) → 실시간 협업 → 코드 분석 고도화 → 마켓플레이스 배포

---

## 2. 정적 검토 (Static Review)

### 2.1 Critical — 착수 전 결정 필요

#### C1. VS Code Webview는 에디터로부터의 네이티브 드래그를 받지 못한다
> **§C4(2026-05-02)로 superseded.** 본 항목은 "사용자가 에디터에서 코드를 선택해 캔버스에 카드로 삽입한다"는 원안 4.1 흐름을 전제로 한 기술 제약 분석이다. §C4에서 수동 코드 카드/`codetrace.addSelectionToCanvas` 흐름 자체를 폐기했으므로, 아래 "대안 (권장)" 항목은 더 이상 권장 구현이 아니다. 기술 제약(Webview는 네이티브 드래그를 받지 못함) 자체는 사실로 유지되며, 향후 다른 에디터→Webview 데이터 전달이 필요해질 경우 참고 자료로 남긴다.

원안 4.1의 "에디터에서 선택한 코드 블록을 드래그하여 캔버스에 삽입"은 Webview API 한계로 **직접 구현 불가**.

- Webview는 sandboxed iframe이며, VS Code 에디터의 `dragstart` 이벤트가 외부로 전파되지 않음
- ~~**대안 (권장)**:~~ *(§C4로 폐기)*
  1. ~~에디터 선택 → 컨텍스트 메뉴(`editor/context`) 또는 단축키 → `codetrace.addSelectionToCanvas` 명령 실행~~
  2. ~~Extension Host가 선택 텍스트 + 파일 URI + 라인 범위를 `webview.postMessage`로 전송~~
  3. ~~Webview는 메시지를 받아 '코드 카드' 요소를 캔버스에 생성~~
- ~~**영향**: UX 문구를 "드래그"에서 "선택 후 단축키" 또는 "선택 후 우클릭"으로 변경 필요~~

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
> **§C4(2026-05-02)로 superseded.** 본 항목은 수동 코드 카드를 어떤 Excalidraw element로 구현할지에 대한 선택지 비교였다. §C4에서 수동 코드 카드 자동을 폐기하고 자동 마인드맵의 `graphNode`/`reviewSticky`(§C7 `customData.kind` 분류) 모델로 대체했으므로, 아래 A/B/C 선택지 중 하나를 고르는 결정은 더 이상 필요하지 않다. 자동 노드는 §C6(잠금/위치 보존), 포스트잇은 §C5(영속화 round-trip)에서 다룬다. `customData` 기반 확장(원래 권장이었던 (B))의 패턴은 §C7의 `customData.kind` 정책에 흡수되었다.

원안 4.1의 "코드 카드"는 명세 공백.

- Excalidraw 내장 element type에 코드 하이라이팅 박스 없음 (`rectangle`, `text`, `arrow`, `image`, `frame`, `embeddable` 등)
- ~~**선택지**:~~ *(§C4로 폐기 — 수동 코드 카드 자체가 사라짐)*
  - ~~(A) `embeddable`(iframe) 안에 Shiki/Monaco 렌더 — CSP·성능·iframe 통신 비용 발생~~
  - ~~(B) `frame` + `text` 조합, `customData`로 카드 메타데이터 보관 — Excalidraw 공식 확장 포인트~~
  - ~~(C) Excalidraw 위에 React 오버레이 레이어 추가, 카드만 별도 렌더 — 좌표·줌 동기화 직접 처리 필요~~
- ~~**권장**: (B) `customData`. 직렬화·동기화 모두 Excalidraw 내에서 자연스럽게 처리됨~~

#### C4. 제품 컨셉 재정의 — 마인드맵 + 포스트잇 (결정일: 2026-05-02)

기존 "코드 카드를 수동으로 배치하는 캔버스" + "별도 패널의 자동 호출 그래프(React Flow)"
이중 화면 구조를 폐기하고, **단일 Excalidraw 캔버스 위에 자동 마인드맵을 렌더하는 통합 화면**으로 재정의한다.

**핵심 컨셉**
- **메인**: 시스템이 자동으로 노드(파일/함수)와 화살표(호출/참조 관계)를 그린 마인드맵
- **보조 1 — 포스트잇**: 마인드맵 위에서 사용자가 부착하는 리뷰 코멘트.
  포스트잇은 소스 파일에 `<주석 prefix> review: <id> <title>` 형태의 주석으로 영속화되어 git으로 공유된다(§C5).
- **보조 2 — 화살표/텍스트**: 캔버스에서만 보이는 시각화 보조 도구.
  소스 코드에는 영향 없음. `.codetrace/canvases/*.codetrace`에만 저장.
- **사용자가 직접 그리지 않는 것**: 노드, 노드 간 연결 화살표 (전부 자동 생성)

**툴바 정책**
- 노출: 선택/이동/줌, 포스트잇, 화살표, 텍스트
- 숨김: 사각형/원/다이아몬드/펜/지우개 등 자유 그리기 도구
- 사용자가 직접 만든 화살표/텍스트는 자동 생성된 그래프 element와 시각적으로 구분 가능해야 한다 (색·태그·`customData.kind` 사용).

**화면 통합**
- `App.tsx` (Excalidraw `.codetrace` 캔버스)와 `CallGraphApp.tsx` (React Flow 패널)는 하나로 합쳐진다.
- React Flow + dagre 기반 레이아웃 로직(`frontend/src/graph/`)은 폐기 또는 Excalidraw element 생성기로 재작성.
  dagre 레이아웃 계산 자체는 재사용 가능.
- PR #61~#65는 본 결정으로 사실상 재작업 대상이 된다 (의식적 재작업).

**영향**
- 기존 `codetrace.addSelectionToCanvas` 흐름(선택 → 카드 박기)은 **삭제**한다. 컨셉상 사용자가 "코드 스니펫을 카드로 박는" 행위 자체를 더 이상 지원하지 않는다.
- README의 Roadmap·Phase 정의 갱신 필요.

#### C5. 포스트잇 영속화 — 소스 주석 round-trip ADR (결정일: 2026-05-02)

**모델**
- 포스트잇 = `{ id (ULID), anchor, title, body, draft }`
- 소스에는 한 줄 마커 주석만 박는다: `<주석 prefix> review: <id> <title>`
- 본문은 `.codetrace/reviews/<id>.md`에 저장 (front-matter에 anchor·createdAt 등)
- 캔버스 파일에는 포스트잇 위치(좌표) + 그룹 정보만 저장. 본문 중복 저장 금지.
- 본문 ≤5줄이면 마커 주석에 본문도 함께 저장 (`review: <id> <title>\n<주석 prefix> <body line 1>\n...`). 초과 시 제목만.

**Anchor 정책**
- 포스트잇은 **심볼 ID(파일 경로 + 심볼명) 기반**으로 anchor한다. 라인 번호 기반 아님.
- 이름 변경/파일 이동에 대해 LSP의 심볼 정보로 재매칭 시도.
- LSP가 못 잡는 경우(자유 텍스트 라인 등)는 라인 번호 + 주변 컨텍스트 hash로 폴백.

**round-trip 흐름**
- 작성: 캔버스에서 포스트잇 작성 → 저장 시 (a) 소스에 마커 주석 삽입 (b) `.codetrace/reviews/<id>.md` 본문 저장 (c) 캔버스에 좌표 저장
- 복원: 캔버스 열기 → 워크스페이스 분석 + `.codetrace/reviews/` 스캔 → 마커 주석에서 id 수집 → md 본문과 결합 → 마인드맵 노드 위에 포스트잇 element로 렌더

**엣지 케이스 정책**
| 상황 | 동작 |
|------|------|
| 고아 주석 (마커 있음, md 없음) | 경고 + placeholder 포스트잇 표시 (제목만, "본문 누락" 표기) |
| 고아 본문 (md 있음, 마커 없음) | 자동 삭제하지 않고 보존. 다음 분석에서 ID로 재매칭 시도. 일정 기간(1주? 운영 중 결정) 매칭 실패 시 사용자에게 archive 여부 확인 |
| 캔버스 JSON 머지 충돌 | 1단계: git 텍스트 머지에 위임. 실제로 충돌이 자주 발생하면 그때 도구화 (전용 머지 드라이버 등) |
| 라인 위치는 변했으나 심볼 동일 | 심볼 ID로 재매칭. 마커 주석은 신규 위치로 자동 이동 (재저장) |
| 심볼 사라짐 | 포스트잇은 캔버스에서 placeholder로 유지. 사용자가 archive/삭제 결정 |

**언어별 주석 prefix**
- 분석기가 지원하는 언어와 동일 범위에서만 동작 (현재: ts/tsx/js/jsx/py/java/go).
  분석기 지원 언어가 늘어나면 prefix 매핑도 함께 확장.
- 초기 매핑:
  - `//` — ts/tsx/js/jsx/java/go
  - `#` — py
- 블록 주석(`/* */`, `<!-- -->`, `'''…'''`) 미지원. 라인 주석으로 통일.

#### C6. 잠금/삭제/보존 정책 ADR (결정일: 2026-05-02)

**잠금**
- 자동 생성 노드/엣지는 **default 잠금**.
- 캔버스 상단 잠금 토글 버튼으로 해제 가능.
- 잠금 해제 시: 이동·삭제 가능. 잠금 상태에선 선택만 가능(클릭 → 코드로 점프 등은 동작).

**위치 보존 (재분석 시)**
- 노드 ID(파일경로 + 심볼명) 기준으로 매칭:
  - 존재하는 노드 → 사용자 위치 유지
  - 사라진 노드 → 위치 정보 파기 (사라진 사실은 변경 로그에 기록)
  - 신규 노드 → dagre 자동 배치
- 위치 정보는 `.codetrace/canvases/<name>.codetrace`에 저장 (git 공유 — A가 정리한 위치를 B도 본다).

**노드 삭제 → 소스 변형 정책**
- 함수 단위·파일 단위 모두 1단계부터 지원.
- 삭제 시 다이얼로그에 caller 목록 표시 + 자동 정리 가능 여부 표기.
- 자동 정리 규칙(안전 자동화):
  - **케이스 1 — 단순 호출문(`foo();`)**: 라인을 주석으로 치환.
    `<주석 prefix> codetrace: removed call to foo() — was defined in <원래 위치>`
  - **케이스 2 — 값을 사용하는 호출(`const x = foo()`, `if (foo())`, `return foo() + 1` 등)**: 호출부는 그대로 두고 한 줄 위에 경고 주석만 추가.
    `<주석 prefix> codetrace: foo() was deleted — this call site needs manual review`
    컴파일 에러는 사용자가 직접 수정.
  - **케이스 3 — named import**: 해당 심볼만 import 절에서 제거 + 한 줄 주석 추가.
- 삭제 시 함께 정리되는 것:
  - 해당 심볼/파일에 anchor된 포스트잇 (마커 주석 + md 본문 모두 제거)
  - `.codetrace/removed.log`에 삭제 기록 append (날짜, 대상, caller 수)
- 함수 단위 삭제는 ts-morph 기반 AST 변형으로 구현 (라인 범위 단순 삭제는 위험 — JSDoc·decorators·중괄호 매칭 처리 필요).

**다이얼로그 흐름**
```
[함수 foo 삭제]

이 함수는 다음 N곳에서 사용 중입니다:
  ✓ src/bar.ts:42      foo();              → 자동 주석 치환 (케이스 1)
  ✓ src/baz.ts:17      import { foo }       → import에서 제거 (케이스 3)
  ⚠ src/qux.ts:88      const x = foo();    → 수동 수정 필요 (케이스 2)

연결된 포스트잇 N개도 함께 제거됩니다.

[취소]  [수동 수정 위치 열기]  [그래도 삭제]
```

#### C7. 사용자 그린 요소(화살표/텍스트)의 앵커링 ADR (결정일: 2026-05-02)

**화살표**
- Excalidraw의 기본 binding(`startBinding`/`endBinding`)을 그대로 사용.
- 사용자가 화살표 양 끝을 자동 생성 노드 element에 붙이면 노드 이동 시 화살표가 따라옴 (Excalidraw 기본 동작).
- 별도 구현 거의 없음.

**텍스트 — 옵션 2 (명시적 그룹화)**
- 노드 컨텍스트 메뉴 또는 사이드 액션에서 "메모 추가" → 텍스트 element 생성 + 노드와 동일한 `groupIds`에 묶음.
- 노드를 옮기면 그룹 단위로 함께 이동.
- 사용자가 자유롭게 그린 텍스트는 그룹화 안 함 (캔버스 좌표만).

**구분 표기**
- `customData.kind` 값으로 구분:
  - `'graphNode'` / `'graphEdge'` — 자동 생성, 잠금 대상
  - `'reviewSticky'` — 포스트잇
  - `'userArrow'` / `'userText'` — 사용자 보조 요소
- 시각적으로도 자동 생성 element와 사용자 요소를 다르게 (색상·border·태그 배지 등). UI 단계에서 구체화.

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
- MVP 만료 정책: 만료 없음, 수동 revoke만 지원. TTL 기반 만료는 production-grade 전환 시 결정
- 토큰 발급·검증 로직 상세는 Phase 2 구현(#23) 시 확정

**Persistence**
- MVP: in-memory (프로세스 재시작 시 세션 소멸)
- 디스크 백업(WAL 또는 LevelDB)은 첫 paying customer 이후로 연기

**Infrastructure cost (rough)**
- 동시 접속자 100명 기준: Fly.io 또는 Render 단일 인스턴스 (1 vCPU / 512 MB) → 월 $7–$10 수준
- Phase 2 MVP 기간에는 무료 티어 또는 최소 과금 인스턴스로 운영
- 정밀 산정은 첫 paying customer 확보 후 수행

**Topology**
- Phase 2: 단일 리전, 단일 인스턴스
- 멀티 리전은 production-grade 재검토 시점까지 명시적으로 보류 (Revisit triggers 참조)

**Assumptions**
- Q6: 라이선스는 MIT OSS 기준으로 가정. 상용화 모델 변경 시 재검토.

**Out of scope**
- WebRTC 하이브리드 모드

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

#### H5. 로컬 저장 포맷 — `.codetrace/` 폴더 구조 ADR (갱신일: 2026-05-02)

**결정 (§C4·§C5 반영)**
```
.codetrace/
├── canvases/
│   └── <name>.codetrace      # SoT — Excalidraw scene + 자동 그래프 위치 + 잠금 + 그룹
├── reviews/
│   └── <id>.md               # 포스트잇 본문 (front-matter: anchor, createdAt, draft 등)
├── analysis_cache.json       # 자동 분석 결과 캐시 (재생성 가능, .gitignore 권장)
└── removed.log               # 노드 삭제 이력 append-only
```

**역할 분리**
- `canvases/*.codetrace` — Single Source of Truth. 캔버스 위치/잠금/사용자 그린 화살표·텍스트·그룹/포스트잇 좌표.
- `reviews/<id>.md` — 포스트잇 본문 (소스 마커 주석과 한 쌍).
- `analysis_cache.json` — 분석기가 만든 호출 그래프 캐시. 캔버스 열 때 매번 재계산하면 느리므로 캐시.
  **재생성 가능한 파생 데이터이므로 `.gitignore` 권장.**
- `removed.log` — 노드 삭제 시 자동 정리 기록.

**`.gitignore` 가이드 (Q3 답)**
- `canvases/*.codetrace`, `reviews/*.md` — **commit 권장** (협업 자산)
- `analysis_cache.json` — **gitignore 권장** (파생). 현재 `.gitignore`의 `.codetrace/analysis*.json`으로 이미 무시됨.
- `removed.log` — **commit 대상** (팀 간 노드 삭제 이력 공유). 단, 저장소 `.gitignore`의 `*.log` 패턴이 기본 적용되므로 `!.codetrace/removed.log` 예외 규칙이 필요하다. 본 결정에 맞춰 `.gitignore`에 예외를 추가했다.

**기존 코드와의 차이**
- 현재 `extension.ts`의 `runAnalysis`가 `.codetrace/analysis_result.json` (또는 `analysis_<ts>.json`)에 일회성으로 쓰는데, 이는 `analysis_cache.json` 단일 파일로 통합한다.
- 현재 `canvases/<name>.codetrace`는 유지하되 스키마 확장 필요 (자동 그래프 element + 잠금 상태 + 포스트잇 좌표 + 그룹 정보).

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
> **§C4(2026-05-02)로 superseded.** 수동 `CodeCard` 모델은 §C4에서 폐기되었다. 대체 모델은 다음과 같이 분산된다:
> - **자동 노드(파일/함수)** = `graphNode` (`customData.kind = 'graphNode'`, §C7). 식별·앵커링은 §C5 Anchor 정책(LSP 심볼 ID + 라인 hash 폴백)을 따른다.
> - **포스트잇(리뷰 코멘트)** = `reviewSticky` (`customData.kind = 'reviewSticky'`, §C7). 본문은 `.codetrace/reviews/<id>.md`, 소스 마커는 §C5 round-trip 정책으로 영속화한다.
> - **사용자 그린 화살표/텍스트** = `userArrow`/`userText` (§C7).
>
> 따라서 본 §M3의 `CodeCard` 단일 스키마는 더 이상 필요하지 않다. 아래 원본은 역사적 맥락 보존을 위해 남긴다 — drift 감지(snapshot 비교) 아이디어는 §C5 Anchor의 라인 hash 폴백에 부분 흡수되었다.

~~멀티 사용자·워크스페이스 환경에서 동일 코드를 가리키려면 식별자 정규화 필요.~~

~~**권장 스키마**~~ *(§C4로 폐기)*:
```ts
// 폐기된 스키마 — §C5/§C7 모델로 대체됨
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

~~파일 변경 후 라인이 어긋나면(`snapshot`과 현재 텍스트 불일치) 카드에 "stale" 마커 표시.~~

#### M4. 테스트 전략 보강
- 익스텐션 단위 테스트: `@vscode/test-electron` 또는 `@vscode/test-cli`. ✅ 도입 완료 (`extension/.vscode-test.mjs`)
- Webview 컴포넌트: jsdom + React Testing Library
- E2E: Playwright는 Webview HTML을 직접 테스트 가능하나, **익스텐션 활성화·명령 호출까지 포함하려면 `@vscode/test-electron` 결합 필요**. ✅ #26 완료 (`extension/src/test/suite/e2e.test.ts`, `npm run test:e2e --workspace=extension`)
- 현재 CI(`system-test.yml`)는 `frontend/playwright.config.ts` 존재만 검사 → 익스텐션 E2E 잡 별도 추가. ✅ #26 완료 (`integration-test.yml`의 `extension-e2e` 잡, PR-to-develop 트리거)

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
| 제품 컨셉 재정의 | 결정됨 (2026-05-02) | 자동 마인드맵 + 포스트잇 보조. 수동 코드 카드 폐기. 상세는 §C4·§C5·§C6·§C7 ADR 참조 |

---

## 3. 보완된 로드맵

### Phase 0 — 데이터 모델·기술 PoC (신규 추가)
*완료 기준*: 아래 결정이 이 문서에 반영됨.

- [x] ~~CodeCard 스키마 확정 (§M3)~~ → §C4로 폐기. `graphNode`/`reviewSticky` 모델로 대체 (§C5·§C7)
- [x] Excalidraw + Yjs 바인딩 후보 비교 PoC (§C2 A/B/C)
- [x] ~~'코드 카드' 렌더 방식 결정 (§C3 A/B/C)~~ → §C4로 폐기. 수동 코드 카드 자체가 사라짐
- [x] 로컬 저장 포맷·위치 결정 (§H5, 2026-05-02)
- [x] Yjs 서버 호스팅 전략 결정 (§H1, §2.4 표)
- [x] CSP 정책 초안 작성 (§M1)
- [x] `.gitattributes` 추가

### Phase 1 — MVP (재정의, 2026-05-02)
*완료 기준*: 단일 사용자가 마인드맵을 자동 생성하고, 포스트잇으로 코드 리뷰 코멘트를 부착하여 git으로 공유할 수 있다.

**§C4·C5·C6·C7 결정에 따라 Phase 1 재구성. 기존 PR #61~#65(React Flow 기반)와 수동 코드 카드 흐름은 의식적 재작업 대상.**

- [ ] **컨셉 재정의 spec 문서화** — README/CLAUDE.md/`.github/pull_request_template.md` 갱신
- [ ] **화면 통합** — `App.tsx`(Excalidraw)와 `CallGraphApp.tsx`(React Flow)를 단일 Excalidraw 캔버스로 합침. React Flow + dagre 어댑터는 폐기 또는 Excalidraw element 생성기로 재작성 (dagre 레이아웃 계산 로직만 재사용)
- [ ] **자동 마인드맵 렌더** — 분석 결과(`extractWorkspaceCallGraph`) → Excalidraw element(노드 + 엣지) 변환. `customData.kind = 'graphNode' | 'graphEdge'` 태깅
- [ ] **잠금 모델** — default 잠금, 토글 버튼. 잠금 시 자동 그래프 element는 선택만 가능 (이동·삭제 차단)
- [ ] **위치 보존** — 노드 ID 매칭으로 재분석 시 사용자 위치 유지. `.codetrace/canvases/*.codetrace` 스키마 확장
- [ ] **포스트잇 도구** — 툴바에 포스트잇 버튼. 노드 클릭 → "포스트잇 부착" → 작성 다이얼로그(저장/임시/취소). draft 상태 지원
- [ ] **소스 주석 동기화** — 포스트잇 저장 시 마커 주석 삽입 + `.codetrace/reviews/<id>.md` 작성. 캔버스 열 때 round-trip 복원. 엣지 케이스(고아 주석/본문) §C5 표대로 처리
- [ ] **노드 삭제 자동화** — caller 분석 다이얼로그 + 안전 자동화(케이스 1·3 자동 처리, 케이스 2 경고 주석). 함수 단위 삭제는 ts-morph로 구현. 파일 단위는 `vscode.workspace.fs.delete`
- [ ] **사용자 그린 화살표/텍스트** — Excalidraw 기본 binding + 그룹화. `customData.kind = 'userArrow' | 'userText'` 태깅. 마인드맵 안에서만 보이고 소스에 영향 없음
- [ ] **툴바 커스터마이징** — 포스트잇/화살표/텍스트만 노출, 자유 그리기 도구 숨김
- [ ] **단위 테스트** — round-trip(주석↔md 본문), 잠금 동작, 노드 삭제 자동화 케이스별, 위치 보존
- [ ] **통합 테스트** — 두 사용자 시뮬레이션(A 작성 → push → B pull → 포스트잇 복원)
- [x] **폐기·정리** — 기존 `codetrace.addSelectionToCanvas` 명령 제거, 수동 코드 카드 코드 경로 제거, 폐기되는 React Flow 모듈 정리

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
| Q2 | **룸 인증** (부분 결정됨, 2026-05-01): room token 필수(room-ID 단독 입장 불가), SecretStorage 저장. MVP 만료 정책 = 만료 없음/수동 revoke. TTL·초대 링크 만료는 production-grade 전환 시 결정. 상세 §H1 ADR | §H3 |
| Q3 | ~~**저장소 가시성**: `.codetrace/` 파일을 git에 커밋하는 것이 기본인가? `.gitignore` 가이드는?~~ **결정됨** (2026-05-02): `canvases/*.codetrace` + `reviews/*.md`는 commit 권장(협업 자산), `analysis_cache.json`은 gitignore 권장(파생 데이터). 상세 §H5 ADR | §H5 |
| Q4 | **PR 통합 범위**: GitHub.com만? GitLab·Bitbucket은 언제? | §H4 |
| Q5 | **다중 워크스페이스 매핑**: 사용자 A의 `monorepo/packages/foo`와 사용자 B의 `foo`가 다른 절대 경로일 때 카드를 어떻게 매핑할 것인가? | §M3 |
| Q6 | **라이선스·상용화**: 오픈소스(MIT)인가, 상용 모델인가? Marketplace publisher ID는? — **가정**: MIT OSS. 상용화 모델 변경 시 §H1 Revisit triggers 조건으로 재검토 | §2.4 |

---

## 5. 다음 단계 (제안)

1. 이 문서를 팀과 공유하고 **Q1·Q2·Q5** 우선 합의
2. Phase 0 PoC 브랜치(`feat/poc-yjs-excalidraw`) 개설
3. `LICENSE`, `.gitattributes` 추가는 Phase 0와 별개로 즉시 가능 → 별도 PR
