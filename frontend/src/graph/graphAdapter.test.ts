import { toReactFlowEdges } from './graphAdapter';
import type { CallEdge } from './types';

describe('toReactFlowEdges', () => {
  test('collapses duplicate (from, to) pairs into a single edge', () => {
    const input: CallEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' }, // same pair (e.g., foo() calls helper() twice)
      { from: 'a', to: 'b' },
    ];
    const edges = toReactFlowEdges(input);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ id: 'a->b', source: 'a', target: 'b' });
  });

  test('keeps distinct edges and preserves first-seen order', () => {
    const input: CallEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'a', to: 'b' }, // dup of #1
      { from: 'b', to: 'c' },
    ];
    const edges = toReactFlowEdges(input);
    expect(edges.map(e => e.id)).toEqual(['a->b', 'a->c', 'b->c']);
  });

  test('produces unique React Flow edge ids', () => {
    const input: CallEdge[] = [
      { from: 'x', to: 'y' },
      { from: 'x', to: 'y' },
      { from: 'y', to: 'x' },
    ];
    const edges = toReactFlowEdges(input);
    const ids = edges.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('returns an empty array for empty input', () => {
    expect(toReactFlowEdges([])).toEqual([]);
  });
});
