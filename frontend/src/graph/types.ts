import { isNonEmptyString, isRecord } from '../types/utils';

export type GraphNodeKind = 'function' | 'method' | 'arrow';

export interface GraphSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface GraphNode {
  id: string;
  name: string;
  kind: GraphNodeKind;
  file: string;
  range: GraphSourceRange;
}

export interface GraphEdge {
  from: string;
  to: string;
  unresolved?: boolean;
}

export interface CallGraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const GRAPH_ELEMENT_KIND_NODE = 'graphNode' as const;
export const GRAPH_ELEMENT_KIND_EDGE = 'graphEdge' as const;

export type GraphElementKind =
  | typeof GRAPH_ELEMENT_KIND_NODE
  | typeof GRAPH_ELEMENT_KIND_EDGE;

export interface GraphCustomData {
  kind: GraphElementKind;
  nodeId?: string;
  edgeKey?: string;
  source?: 'auto';
}

export function isGraphNode(value: unknown): value is GraphNode {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.file)
  );
}

export function isGraphEdge(value: unknown): value is GraphEdge {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.from) && isNonEmptyString(value.to);
}

export function isCallGraphPayload(value: unknown): value is CallGraphPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isGraphNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isGraphEdge)
  );
}

export function edgeKey(edge: GraphEdge): string {
  return `${edge.from}->${edge.to}`;
}

export const ANALYSIS_MESSAGE_TYPE = 'analysis' as const;

export interface AnalysisMessage {
  type: typeof ANALYSIS_MESSAGE_TYPE;
  payload: CallGraphPayload;
}

export function isAnalysisMessage(value: unknown): value is AnalysisMessage {
  if (!isRecord(value)) return false;
  return value.type === ANALYSIS_MESSAGE_TYPE && isCallGraphPayload(value.payload);
}
