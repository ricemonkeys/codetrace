import type { CallGraphPayload } from './graph/types';
import type { GraphNode, GraphSourceRange } from './graph/types';
import { isReviewStickyRoundTripData, type ReviewStickyRoundTripData } from './sticky/types';

export type CodetraceUpdateHandler = (content: string) => void;
export type CodetraceAnalysisHandler = (payload: CallGraphPayload) => void;
export type CodetraceReviewStickySaveHandler = (review: ReviewStickyRoundTripData) => void;
export type CodetraceGraphNodeDeletionImpactHandler = (response: GraphNodeDeletionImpactResponse) => void;

export type GraphNodeDeletionImpactCase =
  | 'simple-call'
  | 'value-used-call'
  | 'named-import'
  | 'unknown';

export interface GraphNodeDeletionImpact {
  caseType: GraphNodeDeletionImpactCase;
  callerId?: string;
  callerName?: string;
  file: string;
  range: GraphSourceRange;
  preview: string;
}

export interface GraphNodeDeletionImpactRequest {
  requestId: string;
  node: GraphNode;
  callers: GraphNode[];
}

export interface GraphNodeDeletionImpactResponse {
  requestId: string;
  node: GraphNode;
  impacts: GraphNodeDeletionImpact[];
}

export interface GraphNodeRemovalLogEntry {
  timestamp?: string;
  node: GraphNode;
  callerCount: number;
  stickyCount: number;
  stickyReviewIds?: string[];
  decision: 'confirmed';
  impacts: GraphNodeDeletionImpact[];
}

declare global {
  interface Window {
    __codetrace_initialContent?: string;
    __codetrace_initialReviewStickies?: unknown[];
    __codetrace_onUpdate?: CodetraceUpdateHandler;
    __codetrace_onAnalysis?: CodetraceAnalysisHandler;
    __codetrace_save?: (content: string) => void;
    __codetrace_saveFile?: (content: string) => void;
    __codetrace_saveReviewSticky?: CodetraceReviewStickySaveHandler;
    __codetrace_onGraphNodeDeletionImpact?: CodetraceGraphNodeDeletionImpactHandler;
    __codetrace_analyzeGraphNodeDeletion?: (request: GraphNodeDeletionImpactRequest) => void;
    __codetrace_confirmGraphNodeRemoval?: (entry: GraphNodeRemovalLogEntry) => void;
  }
}

export function getInitialDocumentContent(): string | undefined {
  return window.__codetrace_initialContent;
}

export function getInitialReviewStickies(): ReviewStickyRoundTripData[] {
  const raw = window.__codetrace_initialReviewStickies;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isReviewStickyRoundTripData);
}

export function subscribeDocumentUpdates(handler: CodetraceUpdateHandler): () => void {
  const previousHandler = window.__codetrace_onUpdate;
  window.__codetrace_onUpdate = handler;

  return () => {
    window.__codetrace_onUpdate = previousHandler;
  };
}

export function subscribeAnalysisUpdates(handler: CodetraceAnalysisHandler): () => void {
  const previousHandler = window.__codetrace_onAnalysis;
  window.__codetrace_onAnalysis = handler;

  return () => {
    window.__codetrace_onAnalysis = previousHandler;
  };
}

export function subscribeGraphNodeDeletionImpact(
  handler: CodetraceGraphNodeDeletionImpactHandler,
): () => void {
  const previousHandler = window.__codetrace_onGraphNodeDeletionImpact;
  window.__codetrace_onGraphNodeDeletionImpact = handler;

  return () => {
    window.__codetrace_onGraphNodeDeletionImpact = previousHandler;
  };
}

export function saveDocumentContent(content: string): void {
  window.__codetrace_save?.(content);
}

export function saveDocumentFile(content: string): void {
  window.__codetrace_saveFile?.(content);
}

export function saveReviewSticky(review: ReviewStickyRoundTripData): void {
  window.__codetrace_saveReviewSticky?.(review);
}

export function requestGraphNodeDeletionImpact(request: GraphNodeDeletionImpactRequest): boolean {
  if (!window.__codetrace_analyzeGraphNodeDeletion) return false;
  window.__codetrace_analyzeGraphNodeDeletion(request);
  return true;
}

export function confirmGraphNodeRemoval(entry: GraphNodeRemovalLogEntry): void {
  window.__codetrace_confirmGraphNodeRemoval?.(entry);
}
