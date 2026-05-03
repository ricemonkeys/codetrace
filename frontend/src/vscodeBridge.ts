import type { CallGraphPayload } from './graph/types';

export type CodetraceUpdateHandler = (content: string) => void;
export type CodetraceAnalysisHandler = (payload: CallGraphPayload) => void;

declare global {
  interface Window {
    __codetrace_initialContent?: string;
    __codetrace_onUpdate?: CodetraceUpdateHandler;
    __codetrace_onAnalysis?: CodetraceAnalysisHandler;
    __codetrace_save?: (content: string) => void;
    __codetrace_saveFile?: (content: string) => void;
  }
}

export function getInitialDocumentContent(): string | undefined {
  return window.__codetrace_initialContent;
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

export function saveDocumentContent(content: string): void {
  window.__codetrace_save?.(content);
}

export function saveDocumentFile(content: string): void {
  window.__codetrace_saveFile?.(content);
}
