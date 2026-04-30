import {
  CANVAS_DOCUMENT_VERSION,
  type CanvasDocument,
  createEmptyCanvasDocument,
  deserializeCanvasDocument,
  isCanvasDocument,
  serializeCanvasDocument,
} from './CanvasDocument';
import type { CodeCard } from './CodeCard';

const card: CodeCard = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  file: {
    path: 'frontend/src/App.tsx',
    gitCommit: 'e66b616',
  },
  range: {
    startLine: 1,
    endLine: 8,
  },
  snapshot: 'export default function App() {}',
  language: 'typescriptreact',
  customData: {},
};

describe('CanvasDocument', () => {
  it('creates an empty versioned canvas document', () => {
    expect(createEmptyCanvasDocument()).toEqual({
      version: CANVAS_DOCUMENT_VERSION,
      elements: [],
      cards: [],
      appState: {},
    });
  });

  it('round-trips through serialization and deserialization', () => {
    const document: CanvasDocument = {
      version: CANVAS_DOCUMENT_VERSION,
      elements: [{ id: 'element-1', type: 'rectangle' }],
      cards: [card],
      appState: { viewBackgroundColor: '#ffffff' },
    };

    expect(deserializeCanvasDocument(serializeCanvasDocument(document))).toEqual(document);
  });

  it('rejects invalid JSON', () => {
    expect(() => deserializeCanvasDocument('{')).toThrow('Invalid CanvasDocument JSON');
  });

  it('requires cards to match the CodeCard schema', () => {
    expect(
      isCanvasDocument({
        version: CANVAS_DOCUMENT_VERSION,
        elements: [],
        cards: [{ ...card, file: { path: 'C:\\App.tsx' } }],
      }),
    ).toBe(false);
  });

  it('requires elements to include an id and type', () => {
    expect(
      isCanvasDocument({
        version: CANVAS_DOCUMENT_VERSION,
        elements: [{}],
        cards: [],
        appState: {},
      }),
    ).toBe(false);
  });
});
