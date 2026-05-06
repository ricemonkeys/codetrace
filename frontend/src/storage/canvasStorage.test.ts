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
