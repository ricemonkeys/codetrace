# CodeTrace

VS Code 확장. 워크스페이스를 분석해 **자동 마인드맵**을 그리고, 그 위에 **포스트잇**으로 코드 리뷰를 남기는 협업 캔버스.

- **마인드맵 (자동)** — 파일/함수 노드와 호출·참조 화살표를 시스템이 그린다. 사용자는 직접 그리지 않는다.
- **포스트잇 (사용자)** — 노드 위에 부착하는 리뷰 코멘트. 소스 파일에 마커 주석 + `.codetrace/reviews/<id>.md` 본문으로 영속화되어 git으로 공유된다.
- **보조 도구 (사용자)** — 캔버스에서만 보이는 자유 화살표/텍스트. 소스 코드에는 영향 없음.

> **현재 상태**: Phase 1 (MVP) 개발 중. 스크린샷은 MVP 완료 후 추가 예정.

## 설치

> VS Code Marketplace 배포는 Phase 4 예정. 지금은 소스 빌드로 설치한다.

```bash
git clone https://github.com/ricemonkeys/codetrace.git
cd codetrace
npm install
npm run build
```

빌드 후 VS Code에서 `extension/` 폴더를 열고 **F5**로 Extension Development Host를 실행한다.

## 사용 방법

1. VS Code에서 분석할 워크스페이스를 연다.
2. 명령 팔레트(`Cmd+Shift+P`) → **CodeTrace: Open Canvas** 실행.
3. 워크스페이스가 분석되어 파일/함수 노드와 호출 화살표가 자동으로 그려진다.
4. 노드를 클릭해 포스트잇을 부착하면 `.codetrace/reviews/<id>.md`에 저장된다.
5. `.codetrace/` 폴더를 git에 커밋하면 팀원과 리뷰 코멘트를 공유할 수 있다.

## 저장 포맷

```
<workspace>/.codetrace/
├── canvases/<name>.codetrace   # 캔버스 SoT (commit 권장)
├── reviews/<id>.md             # 포스트잇 본문 (commit 권장)
├── analysis_cache.json         # 분석 캐시 (.gitignore)
└── removed.log                 # 노드 삭제 이력 (commit 권장)
```

## 개발 환경 설정

**Prerequisites**: Node.js >= 20, VS Code >= 1.85

```bash
npm install
```

### 빌드

```bash
# extension + frontend 전체 빌드
npm run build

# frontend 개발 서버 (hot reload)
npm run dev:frontend
```

### 테스트

```bash
# frontend 유닛 테스트 (Jest)
npm test --workspace=frontend

# extension 유닛 테스트 (Mocha)
npm test --workspace=extension

# extension E2E 테스트 (실제 VS Code 실행)
npm run test:e2e --workspace=extension
```

### 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 릴리스. 머지 시 자동 태그 + CHANGELOG 생성 |
| `develop` | 통합. PR 대상 기본 브랜치 |
| `feat/<name>` | 신기능 |
| `fix/<name>` | 버그 수정 |
| `hotfix/<name>` | 긴급 수정 |
| `chore/<name>` | 빌드·설정·도구 |
| `docs/<name>` | 문서 |
| `refactor/<name>` | 리팩터링 |

## Roadmap

- **Phase 1 (MVP)** — 자동 마인드맵 렌더, 포스트잇 round-trip(소스 마커 ↔ md 본문), 노드 잠금/위치 보존, 노드 삭제 시 caller 분석 다이얼로그
- **Phase 2** — Yjs + WebSocket 기반 실시간 협업
- **Phase 3** — 분석기 보강 (LSP 약점 언어에 Tree-sitter 적용)
- **Phase 4** — VS Code Marketplace 배포

상세 ADR은 `PLAN.md` 참조 (§C4 컨셉 재정의, §C5 포스트잇 영속화, §C6 잠금/삭제, §C7 element 분류, §H5 저장 포맷).
