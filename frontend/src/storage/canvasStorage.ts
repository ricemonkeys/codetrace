import {
  CANVAS_DOCUMENT_VERSION,
  type CanvasDocument,
  type ExcalidrawElementStub,
  assertCanvasDocument,
  createEmptyCanvasDocument,
  deserializeCanvasDocument,
  isExcalidrawElementStub,
} from '../types/CanvasDocument';
import type { CodeCard } from '../types/CodeCard';
import { isRecord } from '../types/utils';

export type CanvasSceneSnapshot = {
  elements: readonly ExcalidrawElementStub[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  cards?: readonly CodeCard[];
};

export type ExcalidrawInitialDataSnapshot = {
  elements: readonly ExcalidrawElementStub[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export function parseCanvasDocumentContent(content: string): CanvasDocument {
  if (content.trim().length === 0) {
    return createEmptyCanvasDocument();
  }

  return deserializeCanvasDocument(content);
}

export function createCanvasDocumentFromScene(scene: CanvasSceneSnapshot): CanvasDocument {
  const document: CanvasDocument = {
    version: CANVAS_DOCUMENT_VERSION,
    elements: cloneElements(scene.elements),
    cards: [...(scene.cards ?? [])],
    appState: cloneRecord(scene.appState ?? {}),
  };

  const files = cloneRecord(scene.files ?? {});
  if (Object.keys(files).length > 0) {
    document.files = files;
  }

  assertCanvasDocument(document);
  return document;
}

export function toExcalidrawInitialData(document: CanvasDocument): ExcalidrawInitialDataSnapshot {
  return {
    elements: document.elements,
    appState: document.appState ?? {},
    files: document.files ?? {},
  };
}

function cloneElements(elements: readonly ExcalidrawElementStub[]): ExcalidrawElementStub[] {
  const cloned = cloneJsonValue(elements, []);
  if (!Array.isArray(cloned)) return [];

  return cloned.filter(isExcalidrawElementStub);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = cloneJsonValue(value, {});
  return isRecord(cloned) ? cloned : {};
}

function cloneJsonValue(value: unknown, fallback: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? fallback : JSON.parse(serialized);
  } catch {
    return fallback;
  }
}
