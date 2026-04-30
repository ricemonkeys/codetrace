import {
  createCanvasDocumentFromScene,
  parseCanvasDocumentContent,
  toExcalidrawInitialData,
} from './canvasStorage';
import { serializeCanvasDocument } from '../types/CanvasDocument';
import type { CodeCard } from '../types/CodeCard';

const card: CodeCard = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  file: {
    path: 'frontend/src/App.tsx',
  },
  range: {
    startLine: 1,
    endLine: 8,
  },
  snapshot: 'export default function App() {}',
  language: 'typescriptreact',
  customData: {},
};

describe('canvasStorage', () => {
  it('parses blank content as an empty canvas document', () => {
    expect(parseCanvasDocumentContent('')).toEqual({
      version: 1,
      elements: [],
      cards: [],
      appState: {},
    });
  });

  it('creates a serializable canvas document from a scene snapshot', () => {
    const document = createCanvasDocumentFromScene({
      elements: [{ id: 'element-1', type: 'rectangle', x: 10 }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
      cards: [card],
    });

    expect(document).toEqual({
      version: 1,
      elements: [{ id: 'element-1', type: 'rectangle', x: 10 }],
      cards: [card],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
    });
  });

  it('round-trips through document serialization', () => {
    const document = createCanvasDocumentFromScene({
      elements: [{ id: 'element-1', type: 'text', text: 'hello' }],
      appState: { gridSize: 20 },
      cards: [card],
    });

    expect(parseCanvasDocumentContent(serializeCanvasDocument(document))).toEqual(document);
  });

  it('converts a canvas document into Excalidraw initial data', () => {
    const document = createCanvasDocumentFromScene({
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
      cards: [],
    });

    expect(toExcalidrawInitialData(document)).toEqual({
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    });
  });
});
