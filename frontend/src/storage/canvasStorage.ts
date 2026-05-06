import {
  CANVAS_DOCUMENT_VERSION,
  type CanvasDocument,
  type CanvasBinaryFile,
  type ExcalidrawElementStub,
  assertCanvasDocument,
  createEmptyCanvasDocument,
  deserializeCanvasDocument,
  isCanvasBinaryFile,
  isExcalidrawElementStub,
} from '../types/CanvasDocument';
import { isRecord } from '../types/utils';

export type CanvasSceneSnapshot = {
  elements: readonly ExcalidrawElementStub[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export type ExcalidrawInitialDataSnapshot = {
  elements: readonly ExcalidrawElementStub[];
  appState: Record<string, unknown>;
  files: Record<string, CanvasBinaryFile>;
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
    appState: cloneRecord(scene.appState ?? {}),
  };

  const files = cloneFiles(scene.files ?? {});
  if (Object.keys(files).length > 0) {
    document.files = files;
  }

  assertCanvasDocument(document);
  return document;
}

export function toExcalidrawInitialData(document: CanvasDocument): ExcalidrawInitialDataSnapshot {
  return {
    elements: sortEdgesBehindNodes(document.elements),
    appState: {
      ...(document.appState ?? {}),
      collaborators: new Map(),
    },
    files: document.files ?? {},
  };
}

/**
 * Excalidraw renders elements in array order — earlier = lower z-order (behind).
 * Saved files may have auto graph nodes before edges (old layout). Re-sort so
 * edges render behind nodes, while non-graph elements stay at their original
 * array positions to preserve their persisted z-order.
 *
 * Only the slots occupied by graph elements are reshuffled (edges first, then
 * nodes); reviewSticky, userArrow, userText, and any other elements keep their
 * relative order relative to each other and to the graph block.
 */
function sortEdgesBehindNodes(elements: readonly ExcalidrawElementStub[]): ExcalidrawElementStub[] {
  // Collect the indices of graph elements in their current order.
  const graphSlots: number[] = [];
  const edgeIndices: number[] = [];
  const nodeIndices: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    const kind = (elements[i].customData as { kind?: string } | undefined)?.kind;
    if (kind === 'graphEdge') {
      graphSlots.push(i);
      edgeIndices.push(i);
    } else if (kind === 'graphNode') {
      graphSlots.push(i);
      nodeIndices.push(i);
    }
  }

  // If graph elements are already in edge-first order, nothing to do.
  const alreadySorted =
    graphSlots.length === edgeIndices.length + nodeIndices.length &&
    [...edgeIndices, ...nodeIndices].every((idx, j) => idx === graphSlots[j]);
  if (alreadySorted) return elements as ExcalidrawElementStub[];

  // Re-assign graph slots: edges first, then nodes. Non-graph slots are untouched.
  const result = [...elements] as ExcalidrawElementStub[];
  const reorderedSources = [...edgeIndices, ...nodeIndices];
  for (let j = 0; j < graphSlots.length; j++) {
    result[graphSlots[j]] = elements[reorderedSources[j]];
  }
  return result;
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

function cloneFiles(value: Record<string, unknown>): Record<string, CanvasBinaryFile> {
  return Object.fromEntries(
    Object.entries(cloneRecord(value)).filter((entry): entry is [string, CanvasBinaryFile] =>
      isCanvasBinaryFile(entry[1]),
    ),
  );
}

function cloneJsonValue(value: unknown, fallback: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? fallback : JSON.parse(serialized);
  } catch {
    return fallback;
  }
}
