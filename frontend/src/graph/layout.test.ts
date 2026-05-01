import type { Edge, Node } from '@xyflow/react';
import { layoutCallGraph } from './layout';

interface DemoData extends Record<string, unknown> {
  label: string;
}

function makeNodes(ids: string[]): Node<DemoData>[] {
  return ids.map(id => ({
    id,
    position: { x: 0, y: 0 },
    data: { label: id },
  }));
}

function makeEdges(pairs: [string, string][]): Edge[] {
  return pairs.map(([source, target]) => ({ id: `${source}->${target}`, source, target }));
}

describe('layoutCallGraph', () => {
  test('positions every node and preserves edges', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    const edges = makeEdges([
      ['a', 'b'],
      ['a', 'c'],
    ]);

    const result = layoutCallGraph(nodes, edges);

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toEqual(edges);

    const positions = Object.fromEntries(result.nodes.map(n => [n.id, n.position]));
    // root above its children with default TB direction
    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.a.y).toBeLessThan(positions.c.y);
  });

  test('LR direction lays children to the right', () => {
    const nodes = makeNodes(['root', 'leaf']);
    const edges = makeEdges([['root', 'leaf']]);

    const { nodes: laid } = layoutCallGraph(nodes, edges, { direction: 'LR' });
    const map = Object.fromEntries(laid.map(n => [n.id, n.position]));

    expect(map.leaf.x).toBeGreaterThan(map.root.x);
  });

  test('keeps disconnected nodes (no edge into the dagre graph)', () => {
    const nodes = makeNodes(['x', 'y']);
    const { nodes: laid } = layoutCallGraph(nodes, []);
    expect(laid.map(n => n.id).sort()).toEqual(['x', 'y']);
    for (const node of laid) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
    }
  });
});
