# Proposal: Multi-Language Hybrid Analyzer Architecture (Relates to #52)

## 1. 개요
본 제안서는 이슈 #52 및 #53의 구현 성과(TypeScript Compiler API 도입)를 바탕으로, CodeTrace가 지향해야 할 **'고정밀 분석'과 '범용성'**을 동시에 충족하기 위한 하이브리드 분석기 아키텍처를 정의합니다.

## 2. 분석 정밀도 계층 (Precision Tiers)
CodeTrace는 사용자에게 혼란을 줄 수 있는 저정밀 분석(단순 AST)을 지양하고, 신뢰할 수 있는 수준의 두 가지 정밀도 계층을 운영합니다.

- **Standard Tier (LSP-based)**: VS Code의 Language Server Protocol 정보를 활용합니다. 여러 언어를 지원하는 범용적인 방식이며, `CodeAnalyzer.ts`의 로직을 어댑터화하여 재활용합니다. (에디터 의존적이지만 폭넓은 언어 지원)
- **Premium Tier (Compiler API-based)**: 언어별 특화 엔진(예: TS Compiler API)을 사용하여 타입 및 심볼 참조를 완벽하게 추적합니다. (현재 TS/JS 전용 구현 완료, 에디터 독립적 분석 가능)

## 3. 하이브리드 아키텍처 (Hybrid Architecture)
겉은 하나의 표준 인터페이스로 통합하되, 상황에 따라 최적의 엔진을 선택하는 **전략 패턴(Strategy Pattern)**을 도입합니다.

### 3.1 공통 인터페이스 (`Analyzer` Interface)
모든 분석 엔진은 내부 구현에 상관없이 동일한 데이터 구조를 반환합니다.
```ts
interface Analyzer {
  // 프로젝트 루트를 받아 분석된 호출 그래프를 반환
  analyze(workspaceRoot: string): Promise<CallGraph>;
}
```

### 3.2 엔진 구성 및 역할 분담
- **`TypeScriptAnalyzer` (Premium)**: TS/JS 프로젝트에서 동작하며, `ts.createProgram`을 통해 가장 정밀한 결과를 제공합니다.
- **`GenericLspAnalyzer` (Standard)**: 그 외 모든 언어에서 동작하며, 기존 `CodeAnalyzer.ts`의 LSP 통신 로직을 통해 기본적인 관계를 찾아냅니다.

## 4. 논의 및 향후 계획
- [x] **Premium 엔진(TS/JS) 구현** (PR #64 완료)
- [x] **아키텍처 리팩토링**: 현재 TS에 결합된 로직을 위 `Analyzer` 인터페이스 기반으로 분리.
- [x] **Standard 어댑터 개발**: `CodeAnalyzer.ts` 로직을 독립적인 `Analyzer` 구현체로 이식.
- [x] **엔진 자동 선택**: 언어 환경에 따라 `Premium` 지원 시 우선 사용, 미지원 시 `Standard`로 폴백(Fallback).

---
불완전한 분석(Level 1)을 배제하고 **'검증된 데이터'**만을 제공함으로써, CodeTrace는 사용자에게 더욱 신뢰받는 시각화 도구가 될 것입니다.
