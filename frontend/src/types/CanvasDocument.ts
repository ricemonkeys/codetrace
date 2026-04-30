import { type CodeCard, isCodeCard } from './CodeCard';
import { isNonEmptyString, isRecord } from './utils';

export const CANVAS_DOCUMENT_VERSION = 1;

export type ExcalidrawElementStub = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export type CanvasDocument = {
  version: typeof CANVAS_DOCUMENT_VERSION;
  elements: ExcalidrawElementStub[];
  cards: CodeCard[];
  appState?: Record<string, unknown>;
};

export function createEmptyCanvasDocument(): CanvasDocument {
  return {
    version: CANVAS_DOCUMENT_VERSION,
    elements: [],
    cards: [],
    appState: {},
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
    value.elements.every(isExcalidrawElementStub) &&
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

export function isExcalidrawElementStub(value: unknown): value is ExcalidrawElementStub {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.type);
}
