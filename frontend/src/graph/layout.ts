import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { LayoutDirection } from './types';

export interface LayoutOptions {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  direction: 'TB',
  nodeWidth: 220,
  nodeHeight: 64,
  rankSep: 80,
  nodeSep: 32,
};

export function layoutCallGraph<NodeData extends Record<string, unknown>>(
  nodes: Node<NodeData>[],
  edges: Edge[],
  options: LayoutOptions = {},
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const { direction, nodeWidth, nodeHeight, rankSep, nodeSep } = { ...DEFAULTS, ...options };

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });

  for (const node of nodes) {
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positionedNodes = nodes.map(node => {
    const { x, y } = graph.node(node.id);
    // dagre returns center coordinates; React Flow expects top-left.
    return {
      ...node,
      position: { x: x - nodeWidth / 2, y: y - nodeHeight / 2 },
      // Hint to React Flow about node sizing for connector routing.
      width: nodeWidth,
      height: nodeHeight,
    };
  });

  return { nodes: positionedNodes, edges };
}
