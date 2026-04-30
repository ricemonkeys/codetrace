# CodeTrace

Collaborative code review and visualization canvas — a VS Code extension that lets you drag code blocks onto an Excalidraw canvas, draw connections, and review architecture visually with your team.

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

## Roadmap

- **Phase 1 (MVP)**: Canvas render, code → canvas copy, local save
- **Phase 2**: Real-time collaboration via Yjs + WebSocket
- **Phase 3**: AST-based dependency visualization (Tree-sitter)
- **Phase 4**: VS Code Marketplace release
