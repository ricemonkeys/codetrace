# codetrace

## 컨셉 (§C4·§C5·§C6·§C7 ADR — 2026-05-02 결정)

CodeTrace는 **자동 마인드맵 + 포스트잇 보조** 컨셉의 단일 캔버스다.
- **자동**: 워크스페이스를 분석해 노드(파일/함수)와 화살표(호출/참조)를 시스템이 그린다. 사용자는 직접 그리지 않는다.
- **포스트잇**: 노드 위에 사용자가 부착하는 리뷰 코멘트. 소스에 한 줄 마커 주석(`<주석 prefix> review: <id> <title>`) + `.codetrace/reviews/<id>.md` 본문으로 영속화되어 git으로 공유된다.
- **보조 화살표/텍스트**: 캔버스에서만 보이는 시각화 보조. 소스 코드에 영향 없음.

`customData.kind` 분류:
- `'graphNode'` / `'graphEdge'` — 자동 생성, 기본 잠금
- `'reviewSticky'` — 포스트잇
- `'userArrow'` / `'userText'` — 사용자 보조 요소

## Stack
- Language: TypeScript
- Build: esbuild (extension), Vite (frontend)
- Test: Jest (frontend), Mocha + `@vscode/test-cli` (extension unit), `@vscode/test-electron` (extension E2E)
- Coverage: lcov

## Project Structure
```
codetrace/
├── extension/        # VS Code Extension Host
│   ├── src/
│   │   ├── extension.ts             # activate / deactivate, 분석 트리거
│   │   ├── CanvasEditorProvider.ts  # CustomTextEditor — webview ↔ host 메시지 라우팅
│   │   ├── CodeAnalyzer.ts          # 호출 그래프 분석
│   │   ├── analyzer/                # 하이브리드 분석 (TS Compiler API + LSP fallback)
│   │   ├── cache/                   # analysis_cache.json hydrate/persist
│   │   ├── git/                     # 변경 라인 감지 (gitChangedRanges 등)
│   │   ├── reviews/                 # 포스트잇 round-trip (마커 ↔ md 본문)
│   │   ├── removedNodes.ts          # 노드 삭제 영향 분석 + removed.log
│   │   └── test/                    # E2E (@vscode/test-electron)
│   ├── package.json                 # VS Code manifest
│   └── tsconfig.json
├── frontend/         # Webview UI (React + Vite + Excalidraw)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── graph/                   # 자동 노드/엣지 → Excalidraw element 변환
│   │   ├── sticky/                  # 포스트잇 element 생성
│   │   ├── annotations/             # userArrow/userText 정규화
│   │   ├── storage/                 # 캔버스 직렬화
│   │   ├── types/                   # CanvasDocument, 공통 타입 유틸 등
│   │   └── vscodeBridge.ts          # webview ↔ host 메시지 어댑터
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── .github/
│   ├── workflows/                   # CI: unit / integration / system / release
│   └── pull_request_template.md
├── package.json                     # npm workspaces root
├── PLAN.md                          # ADR 모음 (§C·§H·§M)
└── README.md
```

## 저장 포맷 (§H5)
```
<workspace>/.codetrace/
├── canvases/<name>.codetrace   # SoT — Excalidraw scene + 자동 그래프 위치 + 잠금 + 그룹 (commit 권장)
├── reviews/<id>.md             # 포스트잇 본문 (commit 권장)
├── analysis_cache.json         # 분석 캐시, 재생성 가능 (.gitignore)
└── removed.log                 # 노드 삭제 이력 append-only (commit 권장, !.codetrace/removed.log 예외)
```

## Test Structure
- Unit test: one test file per source file, placed alongside source
- Integration test: triggered on PR to develop
- E2E (`@vscode/test-electron`): extension test job — host가 실제 VS Code를 띄워 webview까지 검증

## CI/CD
- Push → unit tests
- PR to develop → integration tests
- PR to main → E2E system tests
- Merge to main → regression → auto release tag + CHANGELOG

## Notes
- Frontend build output goes to `extension/dist/webview/` (consumed by `CanvasEditorProvider`)
- CI detect step keys off `frontend/package.json` — keep that path stable
- 노드는 기본 잠금(§C6). 사용자 자유 그리기 도구는 툴바에서 숨김 (§C4)
