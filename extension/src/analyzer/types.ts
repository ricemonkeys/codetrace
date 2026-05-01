export type FunctionKind = 'function' | 'method' | 'arrow';

export type PrecisionTier = 'standard' | 'premium';

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
  unresolved?: boolean;
}

export interface CallGraph {
  nodes: FunctionNode[];
  edges: CallEdge[];
  metadata?: {
    engine: string;
    language: string;
    precision: PrecisionTier;
    warnings?: string[];
  };
}

export interface AnalyzerOptions {
  tsconfigPath?: string;
  searchParentTsconfig?: boolean;
  ignoredDirectories?: readonly string[];
  limitToFiles?: string[];
}

export interface Analyzer {
  getName(): string;
  getPrecision(): PrecisionTier;
  canAnalyze(filePaths: string[]): boolean;
  analyze(workspaceRoot: string, filePaths: string[], options?: AnalyzerOptions): Promise<CallGraph>;
}
