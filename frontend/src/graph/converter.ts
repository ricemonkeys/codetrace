import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';

import type { ExcalidrawElementStub } from '../types/CanvasDocument';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH, type LayoutPosition } from './layout';
import {
  GRAPH_ELEMENT_KIND_EDGE,
  GRAPH_ELEMENT_KIND_NODE,
  edgeKey,
  type GraphCustomData,
  type GraphEdge,
  type GraphNode,
} from './types';

const AUTO_NODE_BG = '#eef2ff';
const AUTO_NODE_STROKE = '#4f46e5';
const AUTO_EDGE_STROKE = '#4f46e5';
const CHANGED_NODE_BG = '#fff7ed';
const CHANGED_NODE_STROKE = '#ea580c';

export interface ConvertOptions {
  locked?: boolean;
  nodeGroupIds?: ReadonlyMap<string, readonly string[]>;
}

export interface ConvertResult {
  elements: ExcalidrawElementStub[];
  positions: Map<string, LayoutPosition>;
}

function nodeElementId(nodeId: string): string {
  return `auto-node-${nodeId}`;
}

/**
 * Builds Excalidraw elements for a call graph payload.
 * Existing positions are preserved per node id; new nodes are placed via dagre layout.
 * Uses Excalidraw's `convertToExcalidrawElements` so all required element fields
 * (seed, version, boundElements, ...) are populated and bindings are wired.
 */
export function convertGraphToElements(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  existingPositions: ReadonlyMap<string, LayoutPosition> = new Map(),
  options: ConvertOptions = {},
): ConvertResult {
  const locked = options.locked ?? true;
  const newNodes = nodes.filter((n) => !existingPositions.has(n.id));
  const newEdges = edges.filter(
    (e) => newNodes.some((n) => n.id === e.from) || newNodes.some((n) => n.id === e.to),
  );
  const { positions: fresh } = layoutGraph(newNodes, newEdges);

  const merged = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const pos = existingPositions.get(node.id) ?? fresh.get(node.id);
    if (pos) merged.set(node.id, pos);
  }

  // Excalidraw renders elements in array order: earlier = lower z-order (behind).
  // Arrows must come before rectangles so nodes are drawn on top of edges.
  const edgeSkeletons: ExcalidrawElementSkeleton[] = [];
  const nodeSkeletons: ExcalidrawElementSkeleton[] = [];

  for (const edge of edges) {
    if (!merged.has(edge.from) || !merged.has(edge.to)) continue;
    const customData: GraphCustomData = {
      kind: GRAPH_ELEMENT_KIND_EDGE,
      edgeKey: edgeKey(edge),
      source: 'auto',
    };
    edgeSkeletons.push({
      type: 'arrow',
      id: `auto-edge-${edgeKey(edge)}`,
      x: 0,
      y: 0,
      strokeColor: AUTO_EDGE_STROKE,
      locked,
      customData,
      start: { id: nodeElementId(edge.from) },
      end: { id: nodeElementId(edge.to) },
    } as ExcalidrawElementSkeleton);
  }

  for (const node of nodes) {
    const pos = merged.get(node.id);
    if (!pos) continue;
    const customData: GraphCustomData = {
      kind: GRAPH_ELEMENT_KIND_NODE,
      nodeId: node.id,
      source: 'auto',
      changedSinceBase: node.changedSinceBase === true,
    };
    const strokeColor = node.changedSinceBase ? CHANGED_NODE_STROKE : AUTO_NODE_STROKE;
    nodeSkeletons.push({
      type: 'rectangle',
      id: nodeElementId(node.id),
      x: pos.x,
      y: pos.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      groupIds: [...(options.nodeGroupIds?.get(node.id) ?? [])],
      strokeColor,
      backgroundColor: node.changedSinceBase ? CHANGED_NODE_BG : AUTO_NODE_BG,
      fillStyle: 'solid',
      roundness: { type: 3 },
      strokeWidth: node.changedSinceBase ? 3 : 1,
      locked,
      customData,
      label: {
        text: node.name,
        fontSize: 14,
        strokeColor,
      },
    });
  }

  const skeletons = [...edgeSkeletons, ...nodeSkeletons];

  // Keep deterministic ids so bound text containerId / arrow bindings still
  // reference the `auto-node-{nodeId}` ids we generated. Without this Excalidraw
  // regenerates ids and we lose the ability to stamp customData on labels by
  // matching containerId, which causes stale labels to leak into the user
  // partition on re-analysis.
  const built = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  }) as unknown as ExcalidrawElement[];

  // `convertToExcalidrawElements` fills `startBinding`/`endBinding` for arrows
  // but leaves their geometry as a placeholder (`points: [[0.5, 0], [99.5, 0]]`,
  // `width: 100, height: 0`). Replace with orthogonal L-shape routes that avoid
  // passing through intermediate node bodies. (Issue #92.)
  anchorAutoArrowsToBindings(built);

  // Stamp customData on auto-generated bound labels so partitionElements()
  // and the lock toggle treat them as auto elements.
  const stubs = built.map((element) =>
    stampAutoCustomData(
      element as unknown as ExcalidrawElementStub,
      built as unknown as ExcalidrawElementStub[],
    ),
  );

  return { elements: stubs, positions: merged };
}

/**
 * Walk from rect center in direction (dx, dy) and return where the ray
 * exits the rect. Used to clip arrow endpoints to node boundaries so they
 * don't appear to pass through nodes on first render.
 */
function clipToRectBoundary(
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * `convertToExcalidrawElements` leaves arrows with placeholder geometry; the
 * binding-driven recompute only fires on element movement, not on scene load.
 * Replace placeholder points with orthogonal L-shape routes that avoid
 * passing through intermediate node bodies.
 */
function anchorAutoArrowsToBindings(elements: ExcalidrawElement[]): void {
  const nodesById = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    if (el.type === 'rectangle') nodesById.set(el.id, el);
  }

  for (const el of elements) {
    if (el.type !== 'arrow') continue;
    const arrow = el as ExcalidrawElement & {
      startBinding?: { elementId?: string } | null;
      endBinding?: { elementId?: string } | null;
    };
    const startId = arrow.startBinding?.elementId;
    const endId = arrow.endBinding?.elementId;
    if (!startId || !endId) continue;
    const start = nodesById.get(startId);
    const end = nodesById.get(endId);
    if (!start || !end) continue;

    const mutable = arrow as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
      points: [number, number][];
    };

    const allPoints = routeAroundNodes(start, end, nodesById, startId, endId);
    const xs = allPoints.map(([px]) => px);
    const ys = allPoints.map(([, py]) => py);
    const ox = allPoints[0][0];
    const oy = allPoints[0][1];
    const relative: [number, number][] = allPoints.map(([px, py]) => [px - ox, py - oy]);
    const relXs = relative.map(([px]) => px);
    const relYs = relative.map(([, py]) => py);

    mutable.x = ox;
    mutable.y = oy;
    mutable.width = Math.max(...relXs) - Math.min(...relXs);
    mutable.height = Math.max(...relYs) - Math.min(...relYs);
    mutable.points = relative;
  }
}

/** Returns true if a horizontal segment from (x1, y) to (x2, y) passes through node. */
function hSegmentClipsNode(x1: number, x2: number, y: number, node: ExcalidrawElement): boolean {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  return left < node.x + node.width && right > node.x && y > node.y && y < node.y + node.height;
}

/** Returns true if a vertical segment from (x, y1) to (x, y2) passes through node. */
function vSegmentClipsNode(x: number, y1: number, y2: number, node: ExcalidrawElement): boolean {
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return x > node.x && x < node.x + node.width && top < node.y + node.height && bottom > node.y;
}

/** Returns an orthogonal route (absolute coords) from source right edge to target left edge.
 *  Uses 3-segment L-shape: right → mid-x turn → arrive at target left.
 *  Validates all three segments against intermediate node bodies and offsets midX
 *  until none of the segments clip a node. Falls back to a straight clipped line
 *  if no clear orthogonal route can be found.
 */
function routeAroundNodes(
  start: ExcalidrawElement,
  end: ExcalidrawElement,
  nodesById: Map<string, ExcalidrawElement>,
  startId: string,
  endId: string,
): [number, number][] {
  const startRight = start.x + start.width;
  const startCy = start.y + start.height / 2;
  const endLeft = end.x;
  const endCy = end.y + end.height / 2;

  // Source is to the right of target — use a straight boundary-clipped line.
  if (startRight >= endLeft) {
    const scx = start.x + start.width / 2;
    const scy = startCy;
    const ecx = end.x + end.width / 2;
    const ecy = endCy;
    const dx = ecx - scx;
    const dy = ecy - scy;
    const sp = clipToRectBoundary(scx, scy, start.width / 2, start.height / 2, dx, dy);
    const ep = clipToRectBoundary(ecx, ecy, end.width / 2, end.height / 2, -dx, -dy);
    return [
      [sp.x, sp.y],
      [ep.x, ep.y],
    ];
  }

  // 3-segment orthogonal route: (startRight, startCy) → (midX, startCy) → (midX, endCy) → (endLeft, endCy)
  // Collect obstacle nodes (exclude start and end).
  const obstacles: ExcalidrawElement[] = [];
  for (const [id, node] of nodesById) {
    if (id !== startId && id !== endId) obstacles.push(node);
  }

  const gap = 12;
  let midX = (startRight + endLeft) / 2;

  // Iteratively shift midX until all three segments clear every obstacle.
  // Limit iterations to avoid infinite loops on dense graphs.
  for (let iter = 0; iter < obstacles.length * 2 + 1; iter++) {
    let clippingNode: ExcalidrawElement | undefined;
    for (const node of obstacles) {
      if (
        vSegmentClipsNode(midX, startCy, endCy, node) ||
        hSegmentClipsNode(startRight, midX, startCy, node) ||
        hSegmentClipsNode(midX, endLeft, endCy, node)
      ) {
        clippingNode = node;
        break;
      }
    }
    if (!clippingNode) break;

    const leftX = clippingNode.x - gap;
    const rightX = clippingNode.x + clippingNode.width + gap;
    midX = Math.abs(leftX - midX) <= Math.abs(rightX - midX) ? leftX : rightX;
  }

  return [
    [startRight, startCy],
    [midX, startCy],
    [midX, endCy],
    [endLeft, endCy],
  ];
}

function stampAutoCustomData(
  element: ExcalidrawElementStub,
  elements: readonly ExcalidrawElementStub[],
): ExcalidrawElementStub {
  const existing = element.customData as GraphCustomData | undefined;
  if (existing?.source === 'auto') return element;

  // Bound text inside an auto-node container: tag as graphNode with parent's nodeId.
  if (element.type === 'text' && typeof element.containerId === 'string') {
    const containerId = element.containerId;
    if (containerId.startsWith('auto-node-')) {
      const nodeId = containerId.replace(/^auto-node-/, '');
      const container = elements.find((candidate) => candidate.id === containerId);
      const groupIds =
        Array.isArray(element.groupIds) && element.groupIds.length > 0
          ? element.groupIds
          : Array.isArray(container?.groupIds)
            ? container.groupIds
            : [];
      return {
        ...element,
        groupIds,
        customData: {
          kind: GRAPH_ELEMENT_KIND_NODE,
          nodeId,
          source: 'auto',
          changedSinceBase: isChangedGraphNode(container?.customData),
        },
      };
    }
  }
  return element;
}

function isChangedGraphNode(customData: unknown): boolean {
  return (
    typeof customData === 'object' &&
    customData !== null &&
    'changedSinceBase' in customData &&
    (customData as { changedSinceBase?: unknown }).changedSinceBase === true
  );
}

export function isAutoElement(element: ExcalidrawElementStub): boolean {
  const data = element.customData as GraphCustomData | undefined;
  return data?.source === 'auto';
}

export function getGraphNodeId(element: ExcalidrawElementStub): string | undefined {
  const data = element.customData as GraphCustomData | undefined;
  if (data?.kind !== GRAPH_ELEMENT_KIND_NODE) return undefined;
  return typeof data.nodeId === 'string' ? data.nodeId : undefined;
}

export function collectGraphNodeIds(elements: readonly ExcalidrawElementStub[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    const nodeId = getGraphNodeId(element);
    if (nodeId) ids.add(nodeId);
  }
  return ids;
}

export function extractPositions(
  elements: readonly ExcalidrawElementStub[],
): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  for (const element of elements) {
    if (element.type !== 'rectangle') continue;
    const data = element.customData as GraphCustomData | undefined;
    if (data?.kind !== GRAPH_ELEMENT_KIND_NODE) continue;
    const nodeId = data.nodeId;
    if (typeof nodeId !== 'string') continue;
    const x = element.x;
    const y = element.y;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    positions.set(nodeId, { x, y });
  }
  return positions;
}

export function extractNodeGroupIds(
  elements: readonly ExcalidrawElementStub[],
): Map<string, readonly string[]> {
  const groupIds = new Map<string, readonly string[]>();
  for (const element of elements) {
    if (element.type !== 'rectangle') continue;
    const data = element.customData as GraphCustomData | undefined;
    if (data?.kind !== GRAPH_ELEMENT_KIND_NODE) continue;
    if (typeof data.nodeId !== 'string') continue;
    if (!Array.isArray(element.groupIds) || element.groupIds.length === 0) continue;
    groupIds.set(data.nodeId, [...element.groupIds]);
  }
  return groupIds;
}

export function partitionElements(
  elements: readonly ExcalidrawElementStub[],
): { auto: ExcalidrawElementStub[]; user: ExcalidrawElementStub[] } {
  const auto: ExcalidrawElementStub[] = [];
  const user: ExcalidrawElementStub[] = [];
  for (const element of elements) {
    if (isAutoElement(element)) {
      auto.push(element);
    } else {
      user.push(element);
    }
  }
  return { auto, user };
}

export function setAutoElementsLocked(
  elements: readonly ExcalidrawElementStub[],
  locked: boolean,
): ExcalidrawElementStub[] {
  return elements.map((element) =>
    isAutoElement(element) ? { ...element, locked } : element,
  );
}

