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
  const fresh = layoutGraph(newNodes, newEdges);

  const merged = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const pos = existingPositions.get(node.id) ?? fresh.get(node.id);
    if (pos) merged.set(node.id, pos);
  }

  const skeletons: ExcalidrawElementSkeleton[] = [];

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
    skeletons.push({
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

  for (const edge of edges) {
    if (!merged.has(edge.from) || !merged.has(edge.to)) continue;
    const customData: GraphCustomData = {
      kind: GRAPH_ELEMENT_KIND_EDGE,
      edgeKey: edgeKey(edge),
      source: 'auto',
    };
    skeletons.push({
      type: 'arrow',
      id: `auto-edge-${edgeKey(edge)}`,
      x: 0,
      y: 0,
      strokeColor: AUTO_EDGE_STROKE,
      locked,
      customData,
      start: { id: nodeElementId(edge.from) },
      end: { id: nodeElementId(edge.to) },
    });
  }

  // Keep deterministic ids so bound text containerId / arrow bindings still
  // reference the `auto-node-{nodeId}` ids we generated. Without this Excalidraw
  // regenerates ids and we lose the ability to stamp customData on labels by
  // matching containerId, which causes stale labels to leak into the user
  // partition on re-analysis.
  const built = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  }) as unknown as ExcalidrawElement[];

  // Stamp customData on auto-generated bound labels so partitionElements()
  // and the lock toggle treat them as auto elements.
  const stubs = built.map((element) =>
    stampAutoCustomData(element as unknown as ExcalidrawElementStub, built as unknown as ExcalidrawElementStub[]),
  );

  return { elements: stubs, positions: merged };
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
