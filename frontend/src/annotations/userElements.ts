import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';

import {
  GRAPH_ELEMENT_KIND_EDGE,
  GRAPH_ELEMENT_KIND_NODE,
  REVIEW_STICKY_KIND,
  USER_ELEMENT_KIND_ARROW,
  USER_ELEMENT_KIND_TEXT,
  type CodetraceElementKind,
} from '../graph/types';
import type { ExcalidrawElementStub } from '../types/CanvasDocument';
import { isRecord } from '../types/utils';

const USER_ARROW_STROKE = '#d6336c';
const USER_TEXT_STROKE = '#0f766e';
const USER_ELEMENT_SOURCE = 'user';
const DEFAULT_MEMO_TEXT = 'Memo';
const MEMO_OFFSET_X = 24;
const MEMO_OFFSET_Y = 8;

export const CODETRACE_ALLOWED_TOOL_TYPES = new Set(['selection', 'hand', 'arrow', 'text']);

export const CODETRACE_EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    toggleTheme: null,
  },
  tools: {
    image: false,
  },
} as const;

export type SelectedElementIds = Record<string, boolean>;

export type NormalizeUserElementsResult = {
  elements: readonly ExcalidrawElementStub[];
  changed: boolean;
};

export type AddNodeMemoOptions = {
  groupId?: string;
  id?: string;
  text?: string;
};

export type AddNodeMemoResult = {
  elements: ExcalidrawElementStub[];
  groupId: string;
  memoId: string;
};

export function isCodeTraceAllowedTool(toolType: unknown): boolean {
  return typeof toolType === 'string' && CODETRACE_ALLOWED_TOOL_TYPES.has(toolType);
}

export function normalizeUserElements(
  elements: readonly ExcalidrawElementStub[],
): NormalizeUserElementsResult {
  let changed = false;
  const next = elements.map((element) => {
    const normalized = normalizeUserElement(element);
    changed ||= normalized !== element;
    return normalized;
  });

  return {
    elements: changed ? next : elements,
    changed,
  };
}

export function getSelectedGraphNode(
  elements: readonly ExcalidrawElementStub[],
  selectedElementIds: unknown,
): ExcalidrawElementStub | undefined {
  const selectedIds = normalizeSelectedElementIds(selectedElementIds);
  const selected = elements.filter((element) => selectedIds[element.id]);

  for (const element of selected) {
    if (isGraphNodeElement(element)) return element;
  }

  for (const element of selected) {
    if (typeof element.containerId !== 'string') continue;
    const container = elements.find((candidate) => candidate.id === element.containerId);
    if (container && isGraphNodeElement(container)) return container;
  }

  return undefined;
}

export function addMemoToGraphNode(
  elements: readonly ExcalidrawElementStub[],
  nodeElementId: string,
  options: AddNodeMemoOptions = {},
): AddNodeMemoResult | null {
  const node = elements.find((element) => element.id === nodeElementId);
  if (!node || !isGraphNodeElement(node)) return null;

  const groupIds = getElementGroupIds(node);
  const groupId = options.groupId ?? groupIds[0] ?? `node-note-${node.id}`;
  const nextGroupIds = groupIds.includes(groupId) ? groupIds : [groupId, ...groupIds];
  const memoId = options.id ?? createElementId('user-text');
  const memo = createMemoElement(node, nextGroupIds, memoId, options.text ?? DEFAULT_MEMO_TEXT);

  const updatedElements = elements.map((element) =>
    isNodeOrBoundLabel(element, node.id) ? withGroupIds(element, nextGroupIds) : element,
  );

  return {
    elements: [...updatedElements, memo],
    groupId,
    memoId,
  };
}

export function getElementKind(element: ExcalidrawElementStub): CodetraceElementKind | undefined {
  const data = getCustomData(element);
  const kind = data.kind;
  return isCodetraceElementKind(kind) ? kind : undefined;
}

function normalizeUserElement(element: ExcalidrawElementStub): ExcalidrawElementStub {
  if (isManagedElement(element)) return element;

  if (element.type === 'arrow') {
    return {
      ...element,
      strokeColor: USER_ARROW_STROKE,
      strokeWidth: 3,
      strokeStyle: 'dashed',
      endArrowhead: element.endArrowhead ?? 'arrow',
      customData: {
        ...getCustomData(element),
        kind: USER_ELEMENT_KIND_ARROW,
        label: 'user-drawn',
        source: USER_ELEMENT_SOURCE,
      },
    };
  }

  if (element.type === 'text') {
    return {
      ...element,
      strokeColor: USER_TEXT_STROKE,
      customData: {
        ...getCustomData(element),
        kind: USER_ELEMENT_KIND_TEXT,
        source: USER_ELEMENT_SOURCE,
      },
    };
  }

  return element;
}

function createMemoElement(
  node: ExcalidrawElementStub,
  groupIds: readonly string[],
  memoId: string,
  text: string,
): ExcalidrawElementStub {
  const skeleton: ExcalidrawElementSkeleton = {
    type: 'text',
    id: memoId,
    x: asNumber(node.x) + asNumber(node.width) + MEMO_OFFSET_X,
    y: asNumber(node.y) + MEMO_OFFSET_Y,
    text,
    fontSize: 16,
    strokeColor: USER_TEXT_STROKE,
    groupIds: [...groupIds],
    customData: {
      kind: USER_ELEMENT_KIND_TEXT,
      source: USER_ELEMENT_SOURCE,
      anchoredTo: node.id,
    },
  };
  const [memo] = convertToExcalidrawElements([skeleton], {
    regenerateIds: false,
  }) as unknown as ExcalidrawElementStub[];

  return memo ?? (skeleton as ExcalidrawElementStub);
}

function getCustomData(element: ExcalidrawElementStub): Record<string, unknown> {
  return isRecord(element.customData) ? element.customData : {};
}

function isManagedElement(element: ExcalidrawElementStub): boolean {
  return getElementKind(element) !== undefined;
}

function isGraphNodeElement(element: ExcalidrawElementStub): boolean {
  return getElementKind(element) === GRAPH_ELEMENT_KIND_NODE;
}

function isNodeOrBoundLabel(element: ExcalidrawElementStub, nodeElementId: string): boolean {
  return element.id === nodeElementId || element.containerId === nodeElementId;
}

function withGroupIds(
  element: ExcalidrawElementStub,
  groupIds: readonly string[],
): ExcalidrawElementStub {
  if (arraysEqual(getElementGroupIds(element), groupIds)) return element;
  return {
    ...element,
    groupIds: [...groupIds],
  };
}

function getElementGroupIds(element: ExcalidrawElementStub): string[] {
  return Array.isArray(element.groupIds)
    ? element.groupIds.filter((groupId): groupId is string => typeof groupId === 'string')
    : [];
}

function normalizeSelectedElementIds(value: unknown): SelectedElementIds {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[0] === 'string' && entry[1] === true,
    ),
  );
}

function isCodetraceElementKind(value: unknown): value is CodetraceElementKind {
  return (
    value === GRAPH_ELEMENT_KIND_NODE ||
    value === GRAPH_ELEMENT_KIND_EDGE ||
    value === REVIEW_STICKY_KIND ||
    value === USER_ELEMENT_KIND_ARROW ||
    value === USER_ELEMENT_KIND_TEXT
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function createElementId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
