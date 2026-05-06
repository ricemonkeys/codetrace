let randomIdCounter = 0;
function nextRandomId(): string {
  randomIdCounter += 1;
  return `random-id-${randomIdCounter}`;
}

jest.mock('@excalidraw/excalidraw', () => ({
  // Simulate Excalidraw's actual behavior: by default `regenerateIds` is true,
  // so every skeleton.id is replaced with a fresh random id. Bound text and
  // arrow bindings must use the *new* container id, not the skeleton id.
  convertToExcalidrawElements: (
    skeletons: Array<Record<string, unknown>>,
    opts?: { regenerateIds?: boolean },
  ) => {
    const regenerate = opts?.regenerateIds !== false;
    const idMap = new Map<string, string>();
    const resolveId = (originalId: string): string => {
      if (!regenerate) return originalId;
      const cached = idMap.get(originalId);
      if (cached) return cached;
      const next = nextRandomId();
      idMap.set(originalId, next);
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
        // Mirror Excalidraw's placeholder geometry on arrow output (#92).
        out.push({
          ...skel,
          id: arrowId,
          x: 0,
          y: 0,
          width: 100,
          height: 0,
          points: [
            [0.5, 0],
            [99.5, 0],
          ],
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
  convertGraphToElements,
  collectGraphNodeIds,
  extractNodeGroupIds,
  extractPositions,
  getGraphNodeId,
  isAutoElement,
  partitionElements,
  setAutoElementsLocked,
} from './converter';
import type { GraphEdge, GraphNode } from './types';
import { GRAPH_ELEMENT_KIND_EDGE, GRAPH_ELEMENT_KIND_NODE } from './types';
import type { ExcalidrawElementStub } from '../types/CanvasDocument';

if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== 'function') {
  (globalThis as { structuredClone: typeof structuredClone }).structuredClone = (value: unknown) =>
    JSON.parse(JSON.stringify(value));
}

const sampleNodes: GraphNode[] = [
  {
    id: 'a',
    name: 'foo',
    kind: 'function',
    file: 'src/a.ts',
    range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 },
  },
  {
    id: 'b',
    name: 'bar',
    kind: 'function',
    file: 'src/b.ts',
    range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 },
  },
];

const sampleEdges: GraphEdge[] = [{ from: 'a', to: 'b' }];

describe('convertGraphToElements', () => {
  it('produces a rectangle, label, and arrow per node/edge', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges);
    const rects = elements.filter((e) => e.type === 'rectangle');
    const arrows = elements.filter((e) => e.type === 'arrow');
    const labels = elements.filter((e) => e.type === 'text');

    expect(rects).toHaveLength(2);
    expect(arrows).toHaveLength(1);
    expect(labels).toHaveLength(2);
  });

  it('marks generated elements with customData.kind and source=auto', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges);
    for (const element of elements) {
      const data = element.customData as { kind: string; source?: string };
      expect([GRAPH_ELEMENT_KIND_NODE, GRAPH_ELEMENT_KIND_EDGE]).toContain(data.kind);
      expect(data.source).toBe('auto');
    }
  });

  it('locks auto elements by default', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges);
    expect(elements.every((e) => e.locked === true)).toBe(true);
  });

  it('respects locked: false option', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges, new Map(), { locked: false });
    expect(elements.every((e) => e.locked === false)).toBe(true);
  });

  it('preserves existing positions and only lays out new nodes', () => {
    const existing = new Map([['a', { x: 1000, y: 2000 }]]);
    const { positions } = convertGraphToElements(sampleNodes, sampleEdges, existing);
    expect(positions.get('a')).toEqual({ x: 1000, y: 2000 });
    expect(positions.get('b')).toBeDefined();
    expect(positions.get('b')?.x).not.toBe(1000);
  });

  it('drops positions for nodes that no longer exist', () => {
    const existing = new Map([
      ['a', { x: 1000, y: 2000 }],
      ['ghost', { x: 5, y: 5 }],
    ]);
    const { positions } = convertGraphToElements(sampleNodes, sampleEdges, existing);
    expect(positions.has('ghost')).toBe(false);
  });

  it('binds arrow start/end to the auto-node element ids', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges);
    const arrow = elements.find((e) => e.type === 'arrow');
    expect(arrow).toBeDefined();
    const startBinding = arrow?.startBinding as { elementId: string };
    const endBinding = arrow?.endBinding as { elementId: string };
    expect(startBinding?.elementId).toBe('auto-node-a');
    expect(endBinding?.elementId).toBe('auto-node-b');
  });

  it('routes arrows as L-shape avoiding node bodies (#92)', () => {
    // Regression for #92: arrows must not pass through node rectangles on first
    // render. anchorAutoArrowsToBindings replaces Excalidraw placeholder geometry
    // ([0.5,0]->[99.5,0]) with orthogonal points clipped to node boundaries.
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 400, y: 200 }],
    ]);
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges, positions);
    const arrow = elements.find((e) => e.type === 'arrow') as
      | { points?: [number, number][]; startBinding?: { elementId: string }; endBinding?: { elementId: string } }
      | undefined;
    expect(arrow).toBeDefined();
    // Points must be replaced from the placeholder [[0.5,0],[99.5,0]].
    expect(arrow?.points?.length).toBeGreaterThanOrEqual(2);
    // First point is always [0, 0] (relative origin = arrow.x, arrow.y).
    expect(arrow?.points?.[0]).toEqual([0, 0]);
    // Bindings must still reference the correct node element ids.
    expect(arrow?.startBinding?.elementId).toBe('auto-node-a');
    expect(arrow?.endBinding?.elementId).toBe('auto-node-b');
  });

  it('routes around intermediate node bodies including horizontal legs (#92)', () => {
    // Layout: A(0,0) -> B(600,0), with C(300,0) directly on the L-shape path.
    // The midX=300 vertical segment would clip C, and the horizontal legs at y=25
    // would also pass through C. The router must shift midX past C's boundary.
    const nodeWidth = 150;
    const nodeHeight = 50;
    const threeNodes: GraphNode[] = [
      { id: 'a', name: 'A', kind: 'function', file: 'a.ts', range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 } },
      { id: 'b', name: 'B', kind: 'function', file: 'b.ts', range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 } },
      { id: 'c', name: 'C', kind: 'function', file: 'c.ts', range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 } },
    ];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 600, y: 0 }],
      ['c', { x: 275, y: 0 }],  // sits exactly on the default midX=375 path
    ]);
    const edge: GraphEdge = { from: 'a', to: 'b' };
    const { elements } = convertGraphToElements(threeNodes, [edge], positions);
    const arrow = elements.find((e) => e.type === 'arrow') as
      | { points?: [number, number][]; x?: number }
      | undefined;
    expect(arrow).toBeDefined();

    // Reconstruct absolute coordinates for each point in the polyline.
    const ox = arrow!.x ?? 0;
    const oy = (arrow as { y?: number }).y ?? 0;
    const pts = (arrow!.points ?? []) as [number, number][];
    const absPoints = pts.map(([px, py]) => [px + ox, py + oy] as [number, number]);

    // Verify no horizontal segment passes through node C's x-range.
    const cLeft = 275;
    const cRight = cLeft + nodeWidth;
    const cTop = 0;
    const cBottom = cTop + nodeHeight;

    for (let i = 0; i + 1 < absPoints.length; i++) {
      const [x1, y1] = absPoints[i];
      const [x2, y2] = absPoints[i + 1];
      if (y1 === y2) {
        // horizontal segment
        const segLeft = Math.min(x1, x2);
        const segRight = Math.max(x1, x2);
        const clipsC =
          segLeft < cRight && segRight > cLeft && y1 > cTop && y1 < cBottom;
        expect(clipsC).toBe(false);
      } else if (x1 === x2) {
        // vertical segment
        const segTop = Math.min(y1, y2);
        const segBottom = Math.max(y1, y2);
        const clipsC =
          x1 > cLeft && x1 < cRight && segTop < cBottom && segBottom > cTop;
        expect(clipsC).toBe(false);
      }
    }
  });

  it('U-shape fallback does not clip obstacle adjacent to source (#92)', () => {
    // Regression: U-shape midX1=startRight+gap clips an obstacle that starts
    // immediately to the right of the source node (preserved/manual position).
    // Layout: A(0,0) -> B(600,0), obstacle C at x=205 (5px gap from A's right edge).
    // All 3-segment candidates fail, so the router falls back to U-shape.
    // The fallback must pick midX1 outside C's x-range, not startRight+gap=212.
    const threeNodes: GraphNode[] = [
      { id: 'a', name: 'A', kind: 'function', file: 'a.ts', range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 } },
      { id: 'b', name: 'B', kind: 'function', file: 'b.ts', range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 } },
      { id: 'c', name: 'C', kind: 'function', file: 'c.ts', range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 } },
    ];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 600, y: 0 }],
      ['c', { x: 205, y: 0 }],  // adjacent to source right edge (200), forces U-shape
    ]);
    const edge: GraphEdge = { from: 'a', to: 'b' };
    const { elements } = convertGraphToElements(threeNodes, [edge], positions);
    const arrow = elements.find((e) => e.type === 'arrow') as
      | { points?: [number, number][]; x?: number; y?: number }
      | undefined;
    expect(arrow).toBeDefined();

    const ox = arrow!.x ?? 0;
    const oy = arrow!.y ?? 0;
    const pts = (arrow!.points ?? []) as [number, number][];
    const absPoints = pts.map(([px, py]) => [px + ox, py + oy] as [number, number]);



    const cLeft = 205;
    const cRight = cLeft + 200; // NODE_WIDTH
    const cTop = 0;
    const cBottom = cTop + 60;  // NODE_HEIGHT

    for (let i = 0; i + 1 < absPoints.length; i++) {
      const [x1, y1] = absPoints[i];
      const [x2, y2] = absPoints[i + 1];
      if (y1 === y2) {
        const segLeft = Math.min(x1, x2);
        const segRight = Math.max(x1, x2);
        expect(segLeft < cRight && segRight > cLeft && y1 > cTop && y1 < cBottom).toBe(false);
      } else if (x1 === x2) {
        const segTop = Math.min(y1, y2);
        const segBottom = Math.max(y1, y2);
        expect(x1 > cLeft && x1 < cRight && segTop < cBottom && segBottom > cTop).toBe(false);
      }
    }
  });

  it('skips edges whose endpoints have no position', () => {
    const orphanEdges: GraphEdge[] = [{ from: 'a', to: 'missing' }];
    const { elements } = convertGraphToElements(sampleNodes, orphanEdges);
    expect(elements.find((e) => e.type === 'arrow')).toBeUndefined();
  });

  it('stamps customData on bound labels even when Excalidraw would regenerate ids', () => {
    // Regression: convertToExcalidrawElements defaults to regenerateIds=true.
    // We pass regenerateIds: false so containerIds keep their `auto-node-{id}`
    // shape and stampAutoCustomData can mark labels as auto.
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges);
    const labels = elements.filter((e) => e.type === 'text');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const data = label.customData as { kind: string; source?: string; nodeId?: string };
      expect(data?.source).toBe('auto');
      expect(data?.kind).toBe(GRAPH_ELEMENT_KIND_NODE);
      expect(typeof data?.nodeId).toBe('string');
    }
  });

  it('does not leak labels into the user partition on a re-render cycle', () => {
    // Simulate the App.tsx flow: first analysis -> partition -> second analysis
    // with the user side preserved. If labels are not stamped as auto, they
    // would accumulate as stale "user" elements across re-analyses.
    const first = convertGraphToElements(sampleNodes, sampleEdges).elements;
    const { user, auto } = partitionElements(first);
    expect(user).toHaveLength(0);
    expect(auto.length).toBe(first.length);
  });

  it('preserves node groupIds on regenerated nodes and bound labels', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges, new Map(), {
      nodeGroupIds: new Map([['a', ['node-note-a']]]),
    });
    const node = elements.find((e) => e.id === 'auto-node-a');
    const label = elements.find((e) => e.containerId === 'auto-node-a');

    expect(node?.groupIds).toEqual(['node-note-a']);
    expect(label?.groupIds).toEqual(['node-note-a']);
  });

  it('visually highlights changed function nodes and stamps the flag on labels', () => {
    const { elements } = convertGraphToElements(
      [{ ...sampleNodes[0], changedSinceBase: true }, sampleNodes[1]],
      sampleEdges,
    );
    const changedNode = elements.find((e) => e.id === 'auto-node-a');
    const unchangedNode = elements.find((e) => e.id === 'auto-node-b');
    const changedLabel = elements.find((e) => e.containerId === 'auto-node-a');

    expect(changedNode).toMatchObject({
      strokeColor: '#ea580c',
      backgroundColor: '#fff7ed',
      strokeWidth: 3,
    });
    expect(changedNode?.customData).toMatchObject({ changedSinceBase: true });
    expect(changedLabel?.customData).toMatchObject({ changedSinceBase: true });
    expect(unchangedNode).toMatchObject({
      strokeColor: '#4f46e5',
      backgroundColor: '#eef2ff',
      strokeWidth: 1,
    });
  });
});

describe('extractPositions', () => {
  it('reads positions from auto graphNode rectangles', () => {
    const elements: ExcalidrawElementStub[] = [
      {
        id: 'auto-node-a',
        type: 'rectangle',
        x: 10,
        y: 20,
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
      },
      {
        id: 'user-shape',
        type: 'rectangle',
        x: 99,
        y: 99,
      },
    ];
    const positions = extractPositions(elements);
    expect(positions.get('a')).toEqual({ x: 10, y: 20 });
    expect(positions.size).toBe(1);
  });
});

describe('graph node id helpers', () => {
  it('reads unique graph node ids from rectangles and bound labels', () => {
    const { elements } = convertGraphToElements(sampleNodes, sampleEdges);
    expect(collectGraphNodeIds(elements)).toEqual(new Set(['a', 'b']));
    expect(getGraphNodeId(elements.find((element) => element.id === 'auto-node-a')!)).toBe('a');
  });

  it('ignores graph edges and user elements', () => {
    const elements: ExcalidrawElementStub[] = [
      { id: 'edge', type: 'arrow', customData: { kind: GRAPH_ELEMENT_KIND_EDGE, source: 'auto' } },
      { id: 'user', type: 'rectangle' },
    ];

    expect(collectGraphNodeIds(elements).size).toBe(0);
    expect(getGraphNodeId(elements[0])).toBeUndefined();
  });
});

describe('extractNodeGroupIds', () => {
  it('reads groupIds from auto graphNode rectangles', () => {
    const elements: ExcalidrawElementStub[] = [
      {
        id: 'auto-node-a',
        type: 'rectangle',
        groupIds: ['node-note-a'],
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
      },
      {
        id: 'auto-node-a-label',
        type: 'text',
        groupIds: ['node-note-a'],
        containerId: 'auto-node-a',
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
      },
    ];

    expect(extractNodeGroupIds(elements).get('a')).toEqual(['node-note-a']);
  });
});

describe('partitionElements', () => {
  it('separates auto elements from user elements', () => {
    const elements: ExcalidrawElementStub[] = [
      {
        id: 'auto-node-a',
        type: 'rectangle',
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, source: 'auto' },
      },
      { id: 'user-1', type: 'ellipse' },
    ];
    const { auto, user } = partitionElements(elements);
    expect(auto).toHaveLength(1);
    expect(user).toHaveLength(1);
    expect(isAutoElement(auto[0])).toBe(true);
    expect(isAutoElement(user[0])).toBe(false);
  });
});

describe('setAutoElementsLocked', () => {
  it('toggles locked only on auto elements', () => {
    const elements: ExcalidrawElementStub[] = [
      {
        id: 'auto-node-a',
        type: 'rectangle',
        locked: true,
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, source: 'auto' },
      },
      { id: 'user-1', type: 'ellipse', locked: false },
    ];
    const updated = setAutoElementsLocked(elements, false);
    expect(updated[0].locked).toBe(false);
    expect(updated[1].locked).toBe(false);
  });
});
