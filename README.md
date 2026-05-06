# CodeTrace

VS Code 확장. 워크스페이스를 분석해 **자동 마인드맵**을 그리고, 그 위에 **포스트잇**으로 코드 리뷰를 남기는 협업 캔버스.

- **마인드맵 (자동)** — 파일/함수 노드와 호출·참조 화살표를 시스템이 그린다. 사용자는 직접 그리지 않는다.
- **포스트잇 (사용자)** — 노드 위에 부착하는 리뷰 코멘트. 소스 파일에 마커 주석 + `.codetrace/reviews/<id>.md` 본문으로 영속화되어 git으로 공유된다.
- **보조 도구 (사용자)** — 캔버스에서만 보이는 자유 화살표/텍스트. 소스 코드에는 영향 없음.

## Structure

```
codetrace/
├── extension/   # VS Code Extension Host (TypeScript + esbuild)
└── frontend/    # Webview UI (React + Vite + Excalidraw)
```

## Prerequisites

- Node.js >= 20
- VS Code >= 1.85

## Setup

```bash
npm install
```

## Development

```bash
# Build extension
npm run build --workspace=extension

# Run frontend dev server
npm run dev:frontend
```

## 저장 포맷

```
<workspace>/.codetrace/
├── canvases/<name>.codetrace   # 캔버스 SoT (commit 권장)
├── reviews/<id>.md             # 포스트잇 본문 (commit 권장)
├── analysis_cache.json         # 분석 캐시 (gitignore)
└── removed.log                 # 노드 삭제 이력 (commit 권장)
```

## Roadmap

- **Phase 1 (MVP)** — 자동 마인드맵 렌더, 포스트잇 round-trip(소스 마커 ↔ md 본문), 노드 잠금/위치 보존, 노드 삭제 시 caller 분석 다이얼로그
- **Phase 2** — Yjs + WebSocket 기반 실시간 협업
- **Phase 3** — 분석기 보강 (LSP 약점 언어에 Tree-sitter 적용)
- **Phase 4** — VS Code Marketplace 배포

상세 ADR은 `PLAN.md` 참조 (§C4 컨셉 재정의, §C5 포스트잇 영속화, §C6 잠금/삭제, §C7 element 분류, §H5 저장 포맷).
