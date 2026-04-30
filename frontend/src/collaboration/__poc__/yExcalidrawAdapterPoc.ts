import * as Y from 'yjs';
import type { ExcalidrawBinding } from 'y-excalidraw';
import type { ExcalidrawElementStub } from '../../types/CanvasDocument';
import { isExcalidrawElementStub } from '../../types/CanvasDocument';
import { cloneJson } from './yjsSync';

export type PocElement = ExcalidrawElementStub & {
  version?: number;
  isDeleted?: boolean;
};

export type YExcalidrawAdapterScene = {
  doc: Y.Doc;
  yElements: Y.Array<Y.Map<unknown>>;
};

export const Y_EXCALIDRAW_ADAPTER_FOOTPRINT = {
  packageName: 'y-excalidraw',
  version: '2.0.12',
  unpackedBytes: 117002,
  extraRuntimeDependencies: ['fractional-indexing'],
  model: 'Y.Array<Y.Map<{ pos, el }>> with whole Excalidraw element objects',
} as const;

export type YExcalidrawBindingInstance = ExcalidrawBinding;

export function createYExcalidrawAdapterScene(doc = new Y.Doc()): YExcalidrawAdapterScene {
  return {
    doc,
    yElements: doc.getArray<Y.Map<unknown>>('y-excalidraw-elements'),
  };
}

export function upsertAdapterElement(
  scene: YExcalidrawAdapterScene,
  element: PocElement,
  pos = element.id,
): void {
  const existing = findAdapterElementMap(scene, element.id);
  if (existing) {
    existing.set('el', cloneJson(element));
    return;
  }

  const yElement = new Y.Map<unknown>();
  yElement.set('pos', pos);
  yElement.set('el', cloneJson(element));
  scene.yElements.push([yElement]);
}

export function patchAdapterElement(
  scene: YExcalidrawAdapterScene,
  elementId: string,
  patch: Partial<PocElement>,
): void {
  const existing = findAdapterElementMap(scene, elementId);
  if (!existing) {
    throw new Error(`Missing adapter element: ${elementId}`);
  }

  const current = existing.get('el');
  if (!isExcalidrawElementStub(current)) {
    throw new Error(`Invalid adapter element: ${elementId}`);
  }

  // Mirrors y-excalidraw's whole-element storage model: a field patch rewrites the entire element object.
  existing.set('el', cloneJson({ ...current, ...patch }));
}

export function adapterElementsToExcalidraw(scene: YExcalidrawAdapterScene): PocElement[] {
  return scene.yElements
    .toArray()
    .sort(compareAdapterElementPosition)
    .map(yElement => yElement.get('el'))
    .filter(isExcalidrawElementStub)
    .map(element => element as PocElement);
}

function findAdapterElementMap(
  scene: YExcalidrawAdapterScene,
  elementId: string,
): Y.Map<unknown> | undefined {
  return scene.yElements
    .toArray()
    .find(yElement => isElementWithId(yElement.get('el'), elementId));
}

function isElementWithId(value: unknown, elementId: string): value is ExcalidrawElementStub {
  return isExcalidrawElementStub(value) && value.id === elementId;
}

function compareAdapterElementPosition(left: Y.Map<unknown>, right: Y.Map<unknown>): number {
  const leftPos = String(left.get('pos') ?? '');
  const rightPos = String(right.get('pos') ?? '');
  return leftPos > rightPos ? 1 : leftPos < rightPos ? -1 : 0;
}
