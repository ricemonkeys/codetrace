# codetrace

## Stack
- Language: TypeScript
- Build: esbuild (extension), Vite (frontend)
- Test: Jest (frontend), Playwright (E2E)
- Coverage: lcov
- E2E: Playwright

## Project Structure
```
codetrace/
├── extension/        # VS Code Extension Host
│   ├── src/
│   │   ├── extension.ts    # activate / deactivate
│   │   └── canvasPanel.ts  # WebviewPanel management
│   ├── package.json        # VS Code manifest
│   └── tsconfig.json
├── frontend/         # Webview UI (React + Excalidraw)
│   ├── src/
│   │   ├── main.tsx
│   │   └── App.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── .github/
│   ├── workflows/          # CI: unit / integration / system / release
│   └── pull_request_template.md
├── package.json            # npm workspaces root
└── README.md
```

## Test Structure
- Unit test: one test file per source file, placed alongside source
- Integration test: triggered on PR to develop
- E2E (Playwright): triggered on PR to main

## CI/CD
- Push → unit tests
- PR to develop → integration tests
- PR to main → E2E system tests
- Merge to main → regression → auto release tag + CHANGELOG

## Notes
- Frontend build output goes to `extension/dist/webview/` (consumed by CanvasPanel)
- CI detect step keys off `frontend/package.json` — keep that path stable
