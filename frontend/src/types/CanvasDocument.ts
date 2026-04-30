import { type CodeCard, isCodeCard } from './CodeCard';

export const CANVAS_DOCUMENT_VERSION = 1;

export type CanvasDocument = {
  version: typeof CANVAS_DOCUMENT_VERSION;
  elements: Record<string, unknown>[];
  cards: CodeCard[];
  appState?: Record<string, unknown>;
};

export function createEmptyCanvasDocument(): CanvasDocument {
  return {
    version: CANVAS_DOCUMENT_VERSION,
    elements: [],
    cards: [],
  };
}

export function serializeCanvasDocument(document: CanvasDocument): string {
  assertCanvasDocument(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function deserializeCanvasDocument(content: string): CanvasDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Invalid CanvasDocument JSON');
  }

  assertCanvasDocument(parsed);
  return parsed;
}

export function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!isRecord(value)) return false;

  return (
    value.version === CANVAS_DOCUMENT_VERSION &&
    Array.isArray(value.elements) &&
    value.elements.every(isRecord) &&
    Array.isArray(value.cards) &&
    value.cards.every(isCodeCard) &&
    (value.appState === undefined || isRecord(value.appState))
  );
}

export function assertCanvasDocument(value: unknown): asserts value is CanvasDocument {
  if (!isCanvasDocument(value)) {
    throw new Error('Invalid CanvasDocument');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
