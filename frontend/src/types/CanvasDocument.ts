import { isNonEmptyString, isRecord } from './utils';

export const CANVAS_DOCUMENT_VERSION = 2;
const LEGACY_CANVAS_DOCUMENT_VERSION = 1;

export type ExcalidrawElementStub = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export type CanvasBinaryFile = {
  id: string;
  dataURL: string;
  mimeType: string;
  [key: string]: unknown;
};

export type CanvasDocument = {
  version: typeof CANVAS_DOCUMENT_VERSION;
  elements: ExcalidrawElementStub[];
  appState?: Record<string, unknown>;
  files?: Record<string, CanvasBinaryFile>;
};

export function createEmptyCanvasDocument(): CanvasDocument {
  return {
    version: CANVAS_DOCUMENT_VERSION,
    elements: [],
    appState: {},
  };
}

export function serializeCanvasDocument(document: CanvasDocument): string {
  const normalized = normalizeCanvasDocument(document);
  if (!normalized) {
    throw new Error('Invalid CanvasDocument');
  }
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function deserializeCanvasDocument(content: string): CanvasDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Invalid CanvasDocument JSON');
  }

  const normalized = normalizeCanvasDocument(parsed);
  if (!normalized) {
    throw new Error('Invalid CanvasDocument');
  }
  return normalized;
}

export function isCanvasDocument(value: unknown): value is CanvasDocument {
  return normalizeCanvasDocument(value) !== null;
}

export function assertCanvasDocument(value: unknown): asserts value is CanvasDocument {
  if (!isCanvasDocument(value)) {
    throw new Error('Invalid CanvasDocument');
  }
}

export function isExcalidrawElementStub(value: unknown): value is ExcalidrawElementStub {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.type);
}

export function isCanvasBinaryFile(value: unknown): value is CanvasBinaryFile {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.dataURL) &&
    isNonEmptyString(value.mimeType)
  );
}

function normalizeCanvasDocument(value: unknown): CanvasDocument | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== CANVAS_DOCUMENT_VERSION &&
    value.version !== LEGACY_CANVAS_DOCUMENT_VERSION
  ) {
    return null;
  }
  if (!Array.isArray(value.elements) || !value.elements.every(isExcalidrawElementStub)) {
    return null;
  }
  if (value.appState !== undefined && !isRecord(value.appState)) return null;
  if (
    value.files !== undefined &&
    (!isRecord(value.files) || !Object.values(value.files).every(isCanvasBinaryFile))
  ) {
    return null;
  }

  const document: CanvasDocument = {
    version: CANVAS_DOCUMENT_VERSION,
    elements: value.elements,
  };
  if (value.appState !== undefined) {
    document.appState = value.appState;
  }
  if (value.files !== undefined) {
    document.files = value.files as Record<string, CanvasBinaryFile>;
  }
  return document;
}
