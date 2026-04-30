import type { CodeCard } from './types/CodeCard';

export type CodetraceUpdateHandler = (content: string) => void;
export type CodetraceAddCardHandler = (card: CodeCard) => void;

declare global {
  interface Window {
    __codetrace_initialContent?: string;
    __codetrace_onUpdate?: CodetraceUpdateHandler;
    __codetrace_onAddCard?: CodetraceAddCardHandler;
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

export function saveDocumentContent(content: string): void {
  window.__codetrace_save?.(content);
}

export function saveDocumentFile(content: string): void {
  window.__codetrace_saveFile?.(content);
}

export function subscribeAddCard(handler: CodetraceAddCardHandler): () => void {
  const previousHandler = window.__codetrace_onAddCard;
  window.__codetrace_onAddCard = handler;

  return () => {
    window.__codetrace_onAddCard = previousHandler;
  };
}
