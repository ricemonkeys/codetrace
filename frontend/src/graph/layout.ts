import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from './types';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 60;

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  rankdir?: 'TB' | 'LR' | 'BT' | 'RL';
  ranksep?: number;
  nodesep?: number;
}

export interface EdgeWaypoints {
  from: string;
  to: string;
  /** Absolute-coordinate waypoints including the clipped start/end points. */
  points: { x: number; y: number }[];
}

export interface LayoutResult {
  positions: Map<string, LayoutPosition>;
  edgeWaypoints: Map<string, EdgeWaypoints>;
}

export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: options.rankdir ?? 'LR',
    ranksep: options.ranksep ?? 80,
    nodesep: options.nodesep ?? 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const w = options.width ?? NODE_WIDTH;
  const h = options.height ?? NODE_HEIGHT;

  for (const node of nodes) {
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of edges) {
    if (g.hasNode(edge.from) && g.hasNode(edge.to)) {
      g.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const dagreNode = g.node(node.id);
    if (!dagreNode) continue;
    positions.set(node.id, {
      x: dagreNode.x - w / 2,
      y: dagreNode.y - h / 2,
    });
  }

  const edgeWaypoints = new Map<string, EdgeWaypoints>();
  for (const edge of edges) {
    const dagreEdge = g.edge(edge.from, edge.to);
    if (!dagreEdge?.points?.length) continue;
    const key = `${edge.from}->${edge.to}`;
    edgeWaypoints.set(key, {
      from: edge.from,
      to: edge.to,
      points: dagreEdge.points as { x: number; y: number }[],
    });
  }

  return { positions, edgeWaypoints };
}
