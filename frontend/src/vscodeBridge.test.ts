import {
  getInitialDocumentContent,
  saveDocumentContent,
  saveDocumentFile,
  subscribeDocumentUpdates,
} from './vscodeBridge';

describe('vscodeBridge', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete window.__codetrace_initialContent;
    delete window.__codetrace_onUpdate;
    delete window.__codetrace_save;
    delete window.__codetrace_saveFile;
    delete (globalThis as { window?: unknown }).window;
  });

  it('reads the initial document content from the webview bootstrap', () => {
    window.__codetrace_initialContent = '{"version":1}';

    expect(getInitialDocumentContent()).toBe('{"version":1}');
  });

  it('subscribes and restores the previous update handler', () => {
    const previous = jest.fn();
    const next = jest.fn();
    window.__codetrace_onUpdate = previous;

    const unsubscribe = subscribeDocumentUpdates(next);
    window.__codetrace_onUpdate?.('content');
    unsubscribe();
    window.__codetrace_onUpdate?.('again');

    expect(next).toHaveBeenCalledWith('content');
    expect(previous).toHaveBeenCalledWith('again');
  });

  it('posts document content to the extension save hook', () => {
    const save = jest.fn();
    window.__codetrace_save = save;

    saveDocumentContent('content');

    expect(save).toHaveBeenCalledWith('content');
  });

  it('posts document content to the extension save-file hook', () => {
    const saveFile = jest.fn();
    window.__codetrace_saveFile = saveFile;

    saveDocumentFile('content');

    expect(saveFile).toHaveBeenCalledWith('content');
  });
});
