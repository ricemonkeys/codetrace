let randomIdCounter = 0;
function nextRandomId(): string {
  randomIdCounter += 1;
  return `random-id-${randomIdCounter}`;
}

jest.mock('@excalidraw/excalidraw', () => ({
  convertToExcalidrawElements: (
    skeletons: Array<Record<string, unknown>>,
    opts?: { regenerateIds?: boolean },
  ) => {
    const regenerate = opts?.regenerateIds !== false;
    const idMap = new Map<string, string>();
    const resolveId = (id: string): string => {
      if (!regenerate) return id;
      const cached = idMap.get(id);
      if (cached) return cached;
      const next = nextRandomId();
      idMap.set(id, next);
      return next;
    };

    const out: Array<Record<string, unknown>> = [];
    for (const skel of skeletons) {
      if (skel.type === 'rectangle' && skel.label) {
        const { label, ...rest } = skel as {
          label: { text: string; fontSize?: number; strokeColor?: string };
          id: string;
          x: number;
          y: number;
          locked?: boolean;
        };
        const containerId = resolveId(rest.id);
        const labelId = `${containerId}-label`;
        out.push({
          ...rest,
          id: containerId,
          boundElements: [{ id: labelId, type: 'text' }],
        });
        out.push({
          id: labelId,
          type: 'text',
          x: rest.x,
          y: rest.y,
          width: 100,
          height: 20,
          text: label.text,
          containerId,
          fontSize: label.fontSize,
          strokeColor: label.strokeColor,
          locked: rest.locked ?? false,
        });
      } else if (skel.type === 'arrow') {
        const start = (skel as { start?: { id: string }; id: string }).start;
        const end = (skel as { end?: { id: string }; id: string }).end;
        const arrowId = resolveId((skel as { id: string }).id);
        out.push({
          ...skel,
          id: arrowId,
          startBinding: start
            ? { elementId: resolveId(start.id), focus: 0, gap: 0 }
            : undefined,
          endBinding: end
            ? { elementId: resolveId(end.id), focus: 0, gap: 0 }
            : undefined,
        });
      } else {
        const original = (skel as { id?: string }).id;
        out.push({
          ...skel,
          id: typeof original === 'string' ? resolveId(original) : nextRandomId(),
        });
      }
    }
    return out;
  },
}));

beforeEach(() => {
  randomIdCounter = 0;
});

import {
  commitSticky,
  createDetachedSticky,
  createStickyForAnchor,
  getStickyReviewId,
  isStickyElement,
  listStickyGroups,
  removeSticky,
  updateStickyText,
  type AnchorBox,
} from './sticky';
import { STICKY_ELEMENT_KIND, type ReviewStickyCustomData } from './types';
import type { ExcalidrawElementStub } from '../types/CanvasDocument';

const anchor: AnchorBox = { id: 'auto-node-foo', x: 0, y: 0, width: 200, height: 60 };

describe('createStickyForAnchor', () => {
  it('produces a body rectangle and a connector arrow tagged as reviewSticky', () => {
    const result = createStickyForAnchor(anchor, {
      reviewId: 'r1',
      title: 'hi',
      body: 'note',
      anchor: {
        nodeId: 'src/a.ts#foo',
        file: 'src/a.ts',
        range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 },
      },
    });
    const rects = result.elements.filter((e) => e.type === 'rectangle');
    const arrows = result.elements.filter((e) => e.type === 'arrow');
    expect(rects).toHaveLength(1);
    expect(arrows).toHaveLength(1);
    for (const element of result.elements) {
      const data = element.customData as ReviewStickyCustomData;
      expect(data.kind).toBe(STICKY_ELEMENT_KIND);
      expect(data.reviewId).toBe('r1');
      expect(data.draft).toBe(true);
      expect(data.anchorElementId).toBe(anchor.id);
      expect(data.title).toBe('hi');
      expect(data.body).toBe('note');
      expect(data.anchor?.file).toBe('src/a.ts');
    }
  });

  it('marks the bound label as reviewSticky body so it does not leak into other partitions', () => {
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'r2', title: 't', body: 'b' });
    const label = elements.find((e) => e.type === 'text');
    expect(label).toBeDefined();
    const data = label?.customData as ReviewStickyCustomData;
    expect(data.kind).toBe(STICKY_ELEMENT_KIND);
    expect(data.reviewId).toBe('r2');
    expect(data.role).toBe('body');
  });

  it('keeps deterministic ids for body and connector', () => {
    const { elements, bodyElementId, connectorElementId } = createStickyForAnchor(anchor, {
      reviewId: 'r3',
      title: 't',
      body: 'b',
    });
    expect(bodyElementId).toBe('sticky-body-r3');
    expect(connectorElementId).toBe('sticky-connector-r3');
    expect(elements.find((e) => e.id === bodyElementId)).toBeDefined();
    expect(elements.find((e) => e.id === connectorElementId)).toBeDefined();
  });

  it('binds the connector arrow from anchor to sticky body', () => {
    const { elements, bodyElementId } = createStickyForAnchor(anchor, { reviewId: 'r4', title: 't', body: 'b' });
    const arrow = elements.find((e) => e.type === 'arrow');
    const startBinding = arrow?.startBinding as { elementId: string };
    const endBinding = arrow?.endBinding as { elementId: string };
    expect(startBinding?.elementId).toBe(anchor.id);
    expect(endBinding?.elementId).toBe(bodyElementId);
  });

  it('uses dashed connector style and unlocked elements', () => {
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'r5' });
    const arrow = elements.find((e) => e.type === 'arrow');
    expect(arrow?.strokeStyle).toBe('dashed');
    expect(elements.every((e) => e.locked === false)).toBe(true);
  });

  it('generates a ULID when reviewId is not provided', () => {
    const a = createStickyForAnchor(anchor);
    const b = createStickyForAnchor(anchor);
    expect(a.reviewId).not.toBe(b.reviewId);
    // Crockford base32, 26 chars
    expect(a.reviewId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('commitSticky', () => {
  it('clears draft on every element of the matching reviewId', () => {
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'r6', title: 't', body: 'b' });
    const committed = commitSticky(elements, 'r6', { status: 'active', source: 'both' });
    for (const element of committed) {
      const data = element.customData as ReviewStickyCustomData;
      expect(data.draft).toBe(false);
      expect(data.status).toBe('active');
      expect(data.source).toBe('both');
    }
  });

  it('leaves other reviewIds untouched', () => {
    const a = createStickyForAnchor(anchor, { reviewId: 'rA', title: 't', body: 'b' }).elements;
    const b = createStickyForAnchor(anchor, { reviewId: 'rB', title: 't', body: 'b' }).elements;
    const merged = [...a, ...b];
    const committed = commitSticky(merged, 'rA');
    for (const element of committed) {
      const data = element.customData as ReviewStickyCustomData;
      if (data.reviewId === 'rA') expect(data.draft).toBe(false);
      else expect(data.draft).toBe(true);
    }
  });
});

describe('removeSticky', () => {
  it('drops body, connector, and label as a single group', () => {
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'r7', title: 't', body: 'b' });
    const after = removeSticky(elements, 'r7');
    expect(after).toHaveLength(0);
  });

  it('leaves unrelated elements intact', () => {
    const sticky = createStickyForAnchor(anchor, { reviewId: 'r8', title: 't', body: 'b' }).elements;
    const userShape: ExcalidrawElementStub = { id: 'user-1', type: 'ellipse' };
    const after = removeSticky([...sticky, userShape], 'r8');
    expect(after).toEqual([userShape]);
  });
});

describe('updateStickyText', () => {
  it('rewrites the label text without disturbing other elements', () => {
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'r9', title: 'old', body: 'body' });
    const updated = updateStickyText(elements, 'r9', 'NEW', 'BODY2');
    const label = updated.find((e) => e.type === 'text');
    expect(label?.text).toBe('NEW\n\nBODY2');
    expect(label?.originalText).toBe('NEW\n\nBODY2');
    for (const element of updated) {
      const data = element.customData as ReviewStickyCustomData;
      expect(data.title).toBe('NEW');
      expect(data.body).toBe('BODY2');
    }
  });

  it('still produces a label element when sticky was created with empty text', () => {
    // Regression for the App-level draft flow:
    //   createStickyForAnchor(anchor, { title: '', body: '' })
    //   -> updateStickyText(..., '제목', '본문')
    // Previously Excalidraw skipped the label skeleton when text was empty,
    // so updateStickyText found nothing to mutate and the user's typed text
    // never reached the canvas. The placeholder label keeps the slot alive.
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'rEmpty', title: '', body: '' });
    const labelBefore = elements.find((e) => e.type === 'text');
    expect(labelBefore).toBeDefined();

    const updated = updateStickyText(elements, 'rEmpty', '제목', '본문');
    const labelAfter = updated.find((e) => e.type === 'text');
    expect(labelAfter?.text).toBe('제목\n\n본문');
    expect(labelAfter?.originalText).toBe('제목\n\n본문');
  });
});

describe('createDetachedSticky', () => {
  it('restores a persisted sticky without creating a connector', () => {
    const { elements, connectorElementId } = createDetachedSticky({
      reviewId: 'detached',
      title: 'Orphan',
      body: 'Body',
      status: 'orphan-body',
      source: 'body',
      draft: false,
    });

    expect(connectorElementId).toBeUndefined();
    expect(elements.some((element) => element.type === 'arrow')).toBe(false);
    expect(elements.some((element) => element.type === 'rectangle')).toBe(true);
    for (const element of elements) {
      const data = element.customData as ReviewStickyCustomData;
      expect(data.reviewId).toBe('detached');
      expect(data.status).toBe('orphan-body');
      expect(data.draft).toBe(false);
    }
  });
});

describe('listStickyGroups', () => {
  it('groups body, label, and connector by reviewId', () => {
    const a = createStickyForAnchor(anchor, { reviewId: 'rX', title: 't', body: 'b' }).elements;
    const b = createStickyForAnchor(anchor, { reviewId: 'rY', title: 't', body: 'b' }).elements;
    const groups = listStickyGroups([...a, ...b]);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.body).toBeDefined();
      expect(g.connector).toBeDefined();
      expect(g.label).toBeDefined();
    }
  });
});

describe('isStickyElement / getStickyReviewId', () => {
  it('returns true and the reviewId for sticky elements', () => {
    const { elements } = createStickyForAnchor(anchor, { reviewId: 'rZ', title: 't', body: 'b' });
    for (const element of elements) {
      expect(isStickyElement(element)).toBe(true);
      expect(getStickyReviewId(element)).toBe('rZ');
    }
  });

  it('returns false / undefined for non-sticky elements', () => {
    const userShape: ExcalidrawElementStub = { id: 'u', type: 'ellipse' };
    expect(isStickyElement(userShape)).toBe(false);
    expect(getStickyReviewId(userShape)).toBeUndefined();
  });
});
