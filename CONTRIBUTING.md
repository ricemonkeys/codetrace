# Contributing to CodeTrace

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 프로덕션 전용 — 직접 커밋 금지 |
| `develop` | 통합 브랜치 — hotfix 허용 |
| `feat/<name>` | 새 기능 — develop에서 분기, develop으로 PR |
| `fix/<name>` | 버그 수정 — develop에서 분기, develop으로 PR |
| `hotfix/<name>` | 긴급 수정 — develop에서 분기, develop으로 PR |

```
develop
└── feat/my-feature   →  PR  →  develop
                                   │
                               PR to main (릴리즈 시)
```

## 커밋 컨벤션

```
<type>(<scope>): <summary>
```

**type**: `feat` | `fix` | `docs` | `style` | `refactor` | `perf` | `test` | `chore` | `ci`

**규칙**
- 영어, 명령형(현재형), 첫 글자 소문자
- 72자 이내
- Breaking change: `feat!:` 또는 커밋 본문에 `BREAKING CHANGE:`

**예시**
```
feat(extension): add addSelectionToCanvas command
fix(frontend): prevent stale card on file rename
docs: update CONTRIBUTING with branch strategy
```

## PR 절차

1. `develop`에서 브랜치 생성: `git checkout -b feat/<name> develop`
2. 작업 단위로 커밋
3. `develop`으로 PR 오픈 — PR 템플릿 체크리스트 완료
4. CI 통과 + 리뷰어 1명 이상 approve 후 merge
5. merge 후 브랜치 삭제

## 테스트

- 새 소스 파일 작성 시 단위 테스트 파일을 함께 작성 (같은 디렉터리)
- PR to develop → 통합 테스트 자동 실행
- PR to main → E2E 테스트 자동 실행

## 로컬 세팅

```bash
# 의존성 설치
npm install

# Extension 빌드
npm run build --workspace=extension

# Frontend 개발 서버
npm run dev:frontend
```

## 코드 스타일

- TypeScript strict mode 활성화
- 줄 끝: LF (`.editorconfig`, `.gitattributes` 강제)
- 들여쓰기: 공백 2칸
- 경로 구분자: `path.posix` 또는 POSIX 슬래시 (`/`) 사용 — Windows 호환
