jest.mock('@excalidraw/excalidraw', () => ({
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => {
    // Simulate Excalidraw's behavior: container `label` becomes a separate text element
    // with a containerId pointing back to the container.
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
        out.push({ ...rest, boundElements: [{ id: `${rest.id}-label`, type: 'text' }] });
        out.push({
          id: `${rest.id}-label`,
          type: 'text',
          x: rest.x,
          y: rest.y,
          width: 100,
          height: 20,
          text: label.text,
          containerId: rest.id,
          fontSize: label.fontSize,
          strokeColor: label.strokeColor,
          locked: rest.locked ?? false,
        });
      } else if (skel.type === 'arrow') {
        const start = (skel as { start?: { id: string } }).start;
        const end = (skel as { end?: { id: string } }).end;
        out.push({
          ...skel,
          startBinding: start ? { elementId: start.id, focus: 0, gap: 0 } : undefined,
          endBinding: end ? { elementId: end.id, focus: 0, gap: 0 } : undefined,
        });
      } else {
        out.push(skel);
      }
    }
    return out;
  },
}));

import {
  convertGraphToElements,
  extractPositions,
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

  it('skips edges whose endpoints have no position', () => {
    const orphanEdges: GraphEdge[] = [{ from: 'a', to: 'missing' }];
    const { elements } = convertGraphToElements(sampleNodes, orphanEdges);
    expect(elements.find((e) => e.type === 'arrow')).toBeUndefined();
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
