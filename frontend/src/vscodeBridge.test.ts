import {
  getInitialDocumentContent,
  saveDocumentContent,
  saveDocumentFile,
  subscribeAddCard,
  subscribeDocumentUpdates,
  subscribeStaleStatus,
} from './vscodeBridge';
import type { CodeCard } from './types/CodeCard';

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
    delete window.__codetrace_onAddCard;
    delete window.__codetrace_onStaleStatus;
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

  it('subscribes and restores the previous addCard handler', () => {
    const card: CodeCard = {
      id: '01JVMH2N8S7T3K4P6Q8X9Y0Z12',
      file: { path: 'src/index.ts' },
      range: { startLine: 1, endLine: 3 },
      snapshot: 'const x = 1;',
      language: 'typescript',
      customData: {},
    };

    const previous = jest.fn();
    const next = jest.fn();
    window.__codetrace_onAddCard = previous;

    const unsubscribe = subscribeAddCard(next);
    window.__codetrace_onAddCard?.(card);
    unsubscribe();
    window.__codetrace_onAddCard?.(card);

    expect(next).toHaveBeenCalledWith(card);
    expect(previous).toHaveBeenCalledWith(card);
  });

  it('subscribes and restores the previous stale status handler', () => {
    const statuses = [{ cardId: '01JVMH2N8S7T3K4P6Q8X9Y0Z12', stale: true }];
    const previous = jest.fn();
    const next = jest.fn();
    window.__codetrace_onStaleStatus = previous;

    const unsubscribe = subscribeStaleStatus(next);
    window.__codetrace_onStaleStatus?.(statuses);
    unsubscribe();
    window.__codetrace_onStaleStatus?.(statuses);

    expect(next).toHaveBeenCalledWith(statuses);
    expect(previous).toHaveBeenCalledWith(statuses);
  });
});
