import {
  createDirectYjsScene,
  directElementsToExcalidraw,
  patchDirectElement,
  upsertDirectElement,
} from './directYjsBindingPoc';
import { exchangeYUpdates, syncYDocs } from './yjsSync';
import {
  adapterElementsToExcalidraw,
  createYExcalidrawAdapterScene,
  patchAdapterElement,
  upsertAdapterElement,
  type PocElement,
} from './yExcalidrawAdapterPoc';
import {
  YJS_EXCALIDRAW_POC_REPORT,
  formatYjsExcalidrawPocComment,
} from './yjsExcalidrawPocReport';

const baseElement: PocElement = {
  id: 'rect-1',
  type: 'rectangle',
  x: 0,
  y: 0,
  version: 1,
};

describe('Yjs + Excalidraw PoC', () => {
  it('round-trips y-excalidraw adapter elements through its Y.Array shape', () => {
    const scene = createYExcalidrawAdapterScene();

    upsertAdapterElement(scene, baseElement);

    expect(adapterElementsToExcalidraw(scene)).toEqual([baseElement]);
  });

  it('shows y-excalidraw adapter conflicts replace the whole element object', () => {
    const left = createYExcalidrawAdapterScene();
    const right = createYExcalidrawAdapterScene();
    upsertAdapterElement(left, baseElement);
    syncYDocs(left.doc, right.doc);

    patchAdapterElement(left, baseElement.id, { x: 10, version: 2 });
    patchAdapterElement(right, baseElement.id, { y: 20, version: 2 });
    exchangeYUpdates(left.doc, right.doc);

    const leftElements = adapterElementsToExcalidraw(left);
    const rightElements = adapterElementsToExcalidraw(right);
    const [merged] = leftElements;

    expect(leftElements).toEqual(rightElements);
    expect(merged.x === 10 && merged.y === 20).toBe(false);
    expect([
      { ...baseElement, x: 10, version: 2 },
      { ...baseElement, y: 20, version: 2 },
    ]).toContainEqual(merged);
  });

  it('merges independent field edits with the direct Y.Map binding', () => {
    const left = createDirectYjsScene();
    const right = createDirectYjsScene();
    upsertDirectElement(left, baseElement);
    syncYDocs(left.doc, right.doc);

    patchDirectElement(left, baseElement.id, { x: 10, version: 2 });
    patchDirectElement(right, baseElement.id, { y: 20 });
    exchangeYUpdates(left.doc, right.doc);

    const leftElements = directElementsToExcalidraw(left);
    const rightElements = directElementsToExcalidraw(right);

    expect(leftElements).toEqual(rightElements);
    expect(leftElements).toEqual([{ ...baseElement, x: 10, y: 20, version: 2 }]);
  });

  it('records the Phase 2 recommendation for PLAN.md and issue #4', () => {
    expect(YJS_EXCALIDRAW_POC_REPORT.decision).toBe('direct-y-map');
    expect(formatYjsExcalidrawPocComment()).toContain('Direct Y.Map binding');
  });
});
