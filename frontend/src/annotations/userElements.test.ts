jest.mock('@excalidraw/excalidraw', () => ({
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) =>
    skeletons.map((skeleton) => ({
      ...skeleton,
      width: skeleton.width ?? 120,
      height: skeleton.height ?? 32,
    })),
}));

import {
  addMemoToGraphNode,
  getSelectedGraphNode,
  isCodeTraceAllowedTool,
  normalizeUserElements,
} from './userElements';
import type { ExcalidrawElementStub } from '../types/CanvasDocument';
import {
  GRAPH_ELEMENT_KIND_EDGE,
  GRAPH_ELEMENT_KIND_NODE,
  USER_ELEMENT_KIND_ARROW,
  USER_ELEMENT_KIND_TEXT,
} from '../graph/types';

describe('normalizeUserElements', () => {
  it('marks user arrows while preserving Excalidraw bindings', () => {
    const elements: ExcalidrawElementStub[] = [
      {
        id: 'arrow-1',
        type: 'arrow',
        startBinding: { elementId: 'auto-node-a', focus: 0, gap: 4 },
        endBinding: { elementId: 'auto-node-b', focus: 0, gap: 4 },
      },
    ];

    const result = normalizeUserElements(elements);
    const arrow = result.elements[0];

    expect(result.changed).toBe(true);
    expect(arrow.customData).toMatchObject({
      kind: USER_ELEMENT_KIND_ARROW,
      label: 'user-drawn',
      source: 'user',
    });
    expect(arrow.startBinding).toEqual(elements[0].startBinding);
    expect(arrow.endBinding).toEqual(elements[0].endBinding);
    expect(arrow.strokeWidth).toBe(3);
    expect(arrow.strokeStyle).toBe('dashed');
  });

  it('marks user text separately from auto graph labels', () => {
    const elements: ExcalidrawElementStub[] = [
      { id: 'text-1', type: 'text', text: 'note' },
      {
        id: 'label-1',
        type: 'text',
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, source: 'auto' },
      },
    ];

    const result = normalizeUserElements(elements);

    expect(result.elements[0].customData).toMatchObject({
      kind: USER_ELEMENT_KIND_TEXT,
      source: 'user',
    });
    expect(result.elements[1]).toBe(elements[1]);
  });

  it('does not rewrite managed graph edges', () => {
    const edge: ExcalidrawElementStub = {
      id: 'auto-edge-a-b',
      type: 'arrow',
      customData: { kind: GRAPH_ELEMENT_KIND_EDGE, source: 'auto' },
    };

    const result = normalizeUserElements([edge]);

    expect(result.changed).toBe(false);
    expect(result.elements[0]).toBe(edge);
  });
});

describe('addMemoToGraphNode', () => {
  it('adds a user text memo to the same group as the selected node', () => {
    const elements: ExcalidrawElementStub[] = [
      {
        id: 'auto-node-a',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 180,
        height: 64,
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
      },
      {
        id: 'auto-node-a-label',
        type: 'text',
        containerId: 'auto-node-a',
        customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
      },
    ];

    const result = addMemoToGraphNode(elements, 'auto-node-a', {
      groupId: 'node-note-a',
      id: 'memo-a',
      text: 'memo text',
    });

    expect(result).not.toBeNull();
    expect(result?.groupId).toBe('node-note-a');

    const node = result?.elements.find((element) => element.id === 'auto-node-a');
    const label = result?.elements.find((element) => element.id === 'auto-node-a-label');
    const memo = result?.elements.find((element) => element.id === 'memo-a');

    expect(node?.groupIds).toEqual(['node-note-a']);
    expect(label?.groupIds).toEqual(['node-note-a']);
    expect(memo?.groupIds).toEqual(['node-note-a']);
    expect(memo?.customData).toMatchObject({
      kind: USER_ELEMENT_KIND_TEXT,
      source: 'user',
      anchoredTo: 'auto-node-a',
    });
  });

  it('keeps memo and node movement in sync through shared groupIds', () => {
    const result = addMemoToGraphNode(
      [
        {
          id: 'auto-node-a',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 180,
          customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
        },
      ],
      'auto-node-a',
      { groupId: 'node-note-a', id: 'memo-a' },
    );
    expect(result).not.toBeNull();

    const moved = result!.elements.map((element) =>
      Array.isArray(element.groupIds) && element.groupIds.includes('node-note-a')
        ? {
            ...element,
            x: Number(element.x ?? 0) + 30,
            y: Number(element.y ?? 0) + 10,
          }
        : element,
    );

    expect(moved.find((element) => element.id === 'auto-node-a')).toMatchObject({ x: 40, y: 30 });
    expect(moved.find((element) => element.id === 'memo-a')).toMatchObject({ x: 244, y: 38 });
  });

  it('resolves a graph node from a selected bound label', () => {
    const node: ExcalidrawElementStub = {
      id: 'auto-node-a',
      type: 'rectangle',
      customData: { kind: GRAPH_ELEMENT_KIND_NODE, nodeId: 'a', source: 'auto' },
    };
    const label: ExcalidrawElementStub = {
      id: 'label-a',
      type: 'text',
      containerId: 'auto-node-a',
    };

    expect(getSelectedGraphNode([node, label], { 'label-a': true })).toBe(node);
  });
});

describe('isCodeTraceAllowedTool', () => {
  it('allows the curated canvas tools and rejects shape/freehand tools', () => {
    expect(isCodeTraceAllowedTool('selection')).toBe(true);
    expect(isCodeTraceAllowedTool('hand')).toBe(true);
    expect(isCodeTraceAllowedTool('arrow')).toBe(true);
    expect(isCodeTraceAllowedTool('text')).toBe(true);

    expect(isCodeTraceAllowedTool('rectangle')).toBe(false);
    expect(isCodeTraceAllowedTool('ellipse')).toBe(false);
    expect(isCodeTraceAllowedTool('freedraw')).toBe(false);
    expect(isCodeTraceAllowedTool('eraser')).toBe(false);
  });
});
