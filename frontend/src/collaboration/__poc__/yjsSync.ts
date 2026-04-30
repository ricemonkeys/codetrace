import * as Y from 'yjs';

export function syncYDocs(source: Y.Doc, target: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
}

export function exchangeYUpdates(left: Y.Doc, right: Y.Doc): void {
  const leftUpdate = Y.encodeStateAsUpdate(left);
  const rightUpdate = Y.encodeStateAsUpdate(right);

  Y.applyUpdate(right, leftUpdate);
  Y.applyUpdate(left, rightUpdate);
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
