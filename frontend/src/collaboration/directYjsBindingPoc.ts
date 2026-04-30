import * as Y from 'yjs';
import type { ExcalidrawElementStub } from '../types/CanvasDocument';
import { isExcalidrawElementStub } from '../types/CanvasDocument';
import { cloneJson } from './yjsSync';
import type { PocElement } from './yExcalidrawAdapterPoc';

export type DirectYjsScene = {
  doc: Y.Doc;
  yElementsById: Y.Map<Y.Map<unknown>>;
  yElementOrder: Y.Array<string>;
};

export const DIRECT_YJS_BINDING_FOOTPRINT = {
  packageName: 'codetrace-direct-yjs-binding',
  extraRuntimeDependencies: [],
  model: 'Y.Map<elementId, Y.Map<field, value>> plus a Y.Array element order',
} as const;

export function createDirectYjsScene(doc = new Y.Doc()): DirectYjsScene {
  return {
    doc,
    yElementsById: doc.getMap<Y.Map<unknown>>('codetrace-elements-by-id'),
    yElementOrder: doc.getArray<string>('codetrace-element-order'),
  };
}

export function upsertDirectElement(scene: DirectYjsScene, element: PocElement): void {
  scene.doc.transact(() => {
    const yElement = ensureElementMap(scene, element);
    const nextKeys = new Set(Object.keys(element));

    yElement.forEach((_value, key) => {
      if (!nextKeys.has(key)) {
        yElement.delete(key);
      }
    });

    Object.entries(element).forEach(([key, value]) => {
      yElement.set(key, cloneJson(value));
    });
  });
}

export function patchDirectElement(
  scene: DirectYjsScene,
  elementId: string,
  patch: Partial<PocElement>,
): void {
  const yElement = scene.yElementsById.get(elementId);
  if (!yElement) {
    throw new Error(`Missing direct element: ${elementId}`);
  }

  scene.doc.transact(() => {
    Object.entries(patch).forEach(([key, value]) => {
      yElement.set(key, cloneJson(value));
    });
  });
}

export function directElementsToExcalidraw(scene: DirectYjsScene): PocElement[] {
  const orderedIds = scene.yElementOrder.toArray();
  const unorderedIds = Array.from(scene.yElementsById.keys()).filter(id => !orderedIds.includes(id));

  return [...orderedIds, ...unorderedIds]
    .map(id => scene.yElementsById.get(id)?.toJSON())
    .filter(isExcalidrawElementStub)
    .map(element => element as ExcalidrawElementStub as PocElement);
}

function ensureElementMap(scene: DirectYjsScene, element: PocElement): Y.Map<unknown> {
  const existing = scene.yElementsById.get(element.id);
  if (existing) return existing;

  const yElement = new Y.Map<unknown>();
  scene.yElementsById.set(element.id, yElement);
  if (!scene.yElementOrder.toArray().includes(element.id)) {
    scene.yElementOrder.push([element.id]);
  }
  return yElement;
}
