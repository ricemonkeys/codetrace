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
