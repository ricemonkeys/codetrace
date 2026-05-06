import {
  createCanvasDocumentFromScene,
  parseCanvasDocumentContent,
  toExcalidrawInitialData,
} from './canvasStorage';
import { serializeCanvasDocument } from '../types/CanvasDocument';

describe('canvasStorage', () => {
  it('parses blank content as an empty canvas document', () => {
    expect(parseCanvasDocumentContent('')).toEqual({
      version: 2,
      elements: [],
      appState: {},
    });
  });

  it('creates a serializable canvas document from a scene snapshot', () => {
    const document = createCanvasDocumentFromScene({
      elements: [{ id: 'element-1', type: 'rectangle', x: 10 }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
    });

    expect(document).toEqual({
      version: 2,
      elements: [{ id: 'element-1', type: 'rectangle', x: 10 }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
    });
  });

  it('round-trips through document serialization', () => {
    const document = createCanvasDocumentFromScene({
      elements: [{ id: 'element-1', type: 'text', text: 'hello' }],
      appState: { gridSize: 20 },
    });

    expect(parseCanvasDocumentContent(serializeCanvasDocument(document))).toEqual(document);
  });

  it('converts a canvas document into Excalidraw initial data', () => {
    const document = createCanvasDocumentFromScene({
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
    });

    expect(toExcalidrawInitialData(document)).toEqual({
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: {
        viewBackgroundColor: '#ffffff',
        collaborators: new Map(),
      },
      files: {},
    });
  });

  it('sorts graph edges before graph nodes while preserving non-graph element positions', () => {
    // Simulates a saved scene where a graphNode appeared before its graphEdge (old layout),
    // with a reviewSticky sandwiched between them. The sort must not move the sticky.
    const document = createCanvasDocumentFromScene({
      elements: [
        { id: 'node-a', type: 'rectangle', customData: { kind: 'graphNode', source: 'auto' } },
        { id: 'sticky-1', type: 'rectangle', customData: { kind: 'reviewSticky', reviewId: 'r1' } },
        { id: 'edge-ab', type: 'arrow', customData: { kind: 'graphEdge', source: 'auto' } },
        { id: 'node-b', type: 'rectangle', customData: { kind: 'graphNode', source: 'auto' } },
      ],
    });
    const { elements } = toExcalidrawInitialData(document);
    // graphEdge must come before graphNodes
    const edgeIdx = elements.findIndex((e) => e.id === 'edge-ab');
    const nodeAIdx = elements.findIndex((e) => e.id === 'node-a');
    const nodeBIdx = elements.findIndex((e) => e.id === 'node-b');
    expect(edgeIdx).toBeLessThan(nodeAIdx);
    expect(edgeIdx).toBeLessThan(nodeBIdx);
    // sticky-1 must not be displaced to after the graph block
    const stickyIdx = elements.findIndex((e) => e.id === 'sticky-1');
    expect(stickyIdx).toBeLessThan(nodeBIdx);
  });

  it('normalizes v1 canvas documents while ignoring legacy cards', () => {
    const legacy = JSON.stringify({
      version: 1,
      elements: [{ id: 'element-1', type: 'rectangle' }],
      cards: [{ id: 'not-validated-anymore' }],
      appState: { viewBackgroundColor: '#ffffff' },
    });

    expect(parseCanvasDocumentContent(legacy)).toEqual({
      version: 2,
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
    });
  });
});
