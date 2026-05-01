// Mirrors the analyzer types in extension/src/analyzer/types.ts.
// Duplicated to keep the frontend independent of the extension package import path.
// When messaging is wired in #50, both ends will agree on this shape.

export type FunctionKind = 'function' | 'method' | 'arrow';

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface FunctionNode {
  id: string;
  name: string;
  kind: FunctionKind;
  file: string;
  range: SourceRange;
}

export interface CallEdge {
  from: string;
  to: string;
}

export interface CallGraph {
  nodes: FunctionNode[];
  edges: CallEdge[];
}

export type LayoutDirection = 'TB' | 'LR';
