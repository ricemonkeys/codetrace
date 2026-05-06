import {
  CANVAS_DOCUMENT_VERSION,
  type CanvasDocument,
  createEmptyCanvasDocument,
  deserializeCanvasDocument,
  isCanvasDocument,
  serializeCanvasDocument,
} from './CanvasDocument';

describe('CanvasDocument', () => {
  it('creates an empty versioned canvas document', () => {
    expect(createEmptyCanvasDocument()).toEqual({
      version: CANVAS_DOCUMENT_VERSION,
      elements: [],
      appState: {},
    });
  });

  it('round-trips through serialization and deserialization', () => {
    const document: CanvasDocument = {
      version: CANVAS_DOCUMENT_VERSION,
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
    };

    expect(deserializeCanvasDocument(serializeCanvasDocument(document))).toEqual(document);
  });

  it('rejects invalid JSON', () => {
    expect(() => deserializeCanvasDocument('{')).toThrow('Invalid CanvasDocument JSON');
  });

  it('migrates v1 documents by dropping cards and normalizing to v2', () => {
    const legacyDocument = {
      version: 1,
      elements: [{ id: 'element-1', type: 'rectangle' }],
      cards: [{ file: { path: 'C:\\legacy.ts' }, snapshot: '' }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
    };

    expect(isCanvasDocument(legacyDocument)).toBe(true);
    expect(deserializeCanvasDocument(JSON.stringify(legacyDocument))).toEqual({
      version: CANVAS_DOCUMENT_VERSION,
      elements: [{ id: 'element-1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { fileId: { id: 'fileId', dataURL: 'data:image/png;base64,', mimeType: 'image/png' } },
    });
  });

  it('requires elements to include an id and type', () => {
    expect(
      isCanvasDocument({
        version: CANVAS_DOCUMENT_VERSION,
        elements: [{}],
        appState: {},
      }),
    ).toBe(false);
  });

  it('requires files to include Excalidraw binary file metadata', () => {
    expect(
      isCanvasDocument({
        version: CANVAS_DOCUMENT_VERSION,
        elements: [],
        appState: {},
        files: { fileId: { id: 'fileId' } },
      }),
    ).toBe(false);
  });
});
