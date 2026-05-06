import { layoutGraph } from './layout';
import type { GraphEdge, GraphNode } from './types';

if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== 'function') {
  (globalThis as { structuredClone: typeof structuredClone }).structuredClone = (value: unknown) =>
    JSON.parse(JSON.stringify(value));
}

const node = (id: string): GraphNode => ({
  id,
  name: id,
  kind: 'function',
  file: `${id}.ts`,
  range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
});

describe('layoutGraph', () => {
  it('returns a position for every node', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges: GraphEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const { positions } = layoutGraph(nodes, edges);
    expect(positions.size).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      const pos = positions.get(id);
      expect(pos).toBeDefined();
      expect(typeof pos?.x).toBe('number');
      expect(typeof pos?.y).toBe('number');
    }
  });

  it('places connected nodes at distinct x positions for LR layout', () => {
    const nodes = [node('a'), node('b')];
    const edges: GraphEdge[] = [{ from: 'a', to: 'b' }];
    const { positions } = layoutGraph(nodes, edges);
    expect(positions.get('a')?.x).not.toBe(positions.get('b')?.x);
  });

  it('skips edges that reference unknown nodes', () => {
    const nodes = [node('a')];
    const edges: GraphEdge[] = [{ from: 'a', to: 'missing' }];
    expect(() => layoutGraph(nodes, edges)).not.toThrow();
  });

  it('returns edge waypoints for each laid-out edge', () => {
    const nodes = [node('a'), node('b')];
    const edges: GraphEdge[] = [{ from: 'a', to: 'b' }];
    const { edgeWaypoints } = layoutGraph(nodes, edges);
    const wp = edgeWaypoints.get('a->b');
    expect(wp).toBeDefined();
    expect(wp?.points.length).toBeGreaterThanOrEqual(2);
    for (const pt of wp?.points ?? []) {
      expect(typeof pt.x).toBe('number');
      expect(typeof pt.y).toBe('number');
    }
  });
});
