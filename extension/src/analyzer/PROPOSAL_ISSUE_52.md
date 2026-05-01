# Proposal: Cross-File Function Call Analyzer (Issue #52)

## 1. 개요
이슈 #52의 목적은 현재 단일 파일에 국한된 함수 호출 분석을 프로젝트 단위(Cross-file)로 확장하는 것입니다.

## 2. 제안하는 방식: TypeScript Compiler API 활용
- `ts.createProgram`을 사용하여 프로젝트 전체의 세만틱 모델을 구축.
- `ts.TypeChecker`를 활용해 `import/export`를 추적하고 정확한 심볼 선언부를 식별.

## 3. 예상되는 한계점 (논의 필요)
- **언어 제한**: 이 방식은 TypeScript 및 JavaScript 전용입니다.
- **타 언어 지원**: Python, Go, Java 등 다른 언어는 이 엔진으로 분석할 수 없으며, 추후 Tree-sitter나 LSP(Language Server Protocol) 기반의 별도 엔진이 필요합니다.
- **성능**: 대규모 프로젝트에서 `createProgram` 시 발생하는 메모리 사용량 및 초기 로딩 시간 검증이 필요합니다.

## 4. 논의하고 싶은 점
- 우선 TS/JS 생태계에 집중하여 고정밀 분석 엔진을 구축하는 방향이 우리 프로젝트의 우선순위와 맞을까요?
- 타 언어 지원을 위해 범용적이지만 정밀도가 낮은 LSP 방식을 병행할지, 아니면 언어별 특화 엔진을 순차적으로 늘려갈지 의견을 듣고 싶습니다.

## 5. 향후 계획
- [ ] `extractCallGraph` 함수 리팩토링 (Program/TypeChecker 도입)
- [ ] 파일 간 호출 관계 검증을 위한 테스트 피스처 추가
- [ ] 대규모 워크스페이스 성능 테스트
