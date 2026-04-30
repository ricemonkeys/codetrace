# CodeTrace — 팀 역할 분담

## 팀원

| GitHub ID | 역할 |
|-----------|------|
| `jinsh` | Extension Host & 프로젝트 리드 |
| `2sthise` | Frontend & Canvas UI |
| `babytazo` | 데이터 모델 & 저장/로드 |
| `jjk03` | 협업 레이어 & 인프라 |

---

## 역할 상세

### jinsh — Extension Host & 프로젝트 리드

**담당 영역**: `extension/src/`

**책임**
- VS Code Extension API 전반 (`CanvasEditorProvider`, 명령 등록)
- `codetrace.addSelectionToCanvas` 명령 구현 (에디터 선택 → 카드 생성)
- Bi-directional Navigation (캔버스 카드 더블클릭 → 에디터 라인 포커스)
- Extension Host ↔ Webview 메시지 프로토콜 설계 및 유지
- PR 리뷰, develop/main 브랜치 관리, 릴리즈 조율

**Phase 1 주요 브랜치**
- `feat/selection-to-canvas`
- `feat/bidirectional-navigation`

---

### 2sthise — Frontend & Canvas UI

**담당 영역**: `frontend/src/`

**책임**
- Excalidraw 캔버스 렌더링 및 초기화
- 코드 카드 UI 컴포넌트 구현 (`customData` 기반, PLAN.md §C3-B)
- Stale 카드 시각 표시 (snapshot 불일치 시 마커)
- Tailwind 적용 (Excalidraw 스타일 충돌 방지, PLAN.md §M2)
- Webview ↔ Extension Host 메시지 수신/송신 처리

**Phase 1 주요 브랜치**
- `feat/canvas-render`
- `feat/code-card-ui`

---

### babytazo — 데이터 모델 & 저장/로드

**담당 영역**: `frontend/src/types/`, `extension/src/storage/`

**책임**
- `CodeCard` 타입 스키마 정의 및 관리 (PLAN.md §M3)
- `.codetrace` 파일 직렬화·역직렬화 (Excalidraw scene + 메타데이터)
- 저장(`save`) / 로드(`update`) 메시지 처리 — CanvasEditorProvider 연동
- 스키마 버전 관리 (`version` 필드 마이그레이션 전략)
- 데이터 모델 단위 테스트

**Phase 1 주요 브랜치**
- `feat/data-model`
- `feat/local-storage`

---

### jjk03 — 협업 레이어 & 인프라

**담당 영역**: `server/` (신규), CI/CD 보강

**책임**
- Phase 0: Yjs + Excalidraw 바인딩 PoC (`feat/poc-yjs-excalidraw`)
- Phase 2: `y-websocket` 서버 구축 및 배포 설정
- Awareness 기반 presence (커서·이름 실시간 표시)
- GitHub Actions 워크플로우 보강 (익스텐션 E2E 잡 추가)
- Phase 1 기간 중: PoC 진행하며 팀 PR 리뷰 지원

**Phase 0~2 주요 브랜치**
- `feat/poc-yjs-excalidraw`
- `feat/yjs-server`
- `feat/presence`

---

## 의존 관계 & 착수 순서

```
[babytazo] feat/data-model        ──┐
[2sthise]  feat/canvas-render     ──┼──→ develop 합류
[jjk03]    feat/poc-yjs-excalidraw──┘
                                      │
                                      ▼
[jinsh]    feat/selection-to-canvas   (canvas-render 완료 후)
[2sthise]  feat/code-card-ui          (data-model 완료 후)
[babytazo] feat/local-storage         (data-model 완료 후)
```

- `feat/data-model`, `feat/canvas-render`, `feat/poc-yjs-excalidraw` 는 **동시 착수 가능**
- `feat/selection-to-canvas` 는 캔버스가 뜨는 것이 확인된 후 착수
- `feat/code-card-ui`, `feat/local-storage` 는 `data-model` PR 머지 후 착수

---

## 공유 규칙

- **메시지 프로토콜** (`extension ↔ webview`): `jinsh`가 초안 작성, 변경 시 전원 리뷰
- **CodeCard 스키마** (`types/`): `babytazo`가 소유, 변경 시 전원 리뷰
- **PR 머지**: approve 1명 이상 필수 (자신의 PR은 본인이 머지 금지)
- **develop 직접 push**: 금지 (hotfix 제외)

---

## 커뮤니케이션

- 브랜치 착수 전 해당 이슈 생성 후 본인 assign
- 블로커 발생 시 이슈에 코멘트 또는 PR draft 오픈으로 공유
- PLAN.md Open Questions 결정 사항은 해당 섹션을 직접 수정하여 PR로 반영
