import {
  getInitialDocumentContent,
  getInitialReviewStickies,
  confirmGraphNodeRemoval,
  requestGraphNodeDeletionImpact,
  saveDocumentContent,
  saveDocumentFile,
  saveReviewSticky,
  subscribeGraphNodeDeletionImpact,
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
    delete window.__codetrace_initialReviewStickies;
    delete window.__codetrace_onUpdate;
    delete window.__codetrace_save;
    delete window.__codetrace_saveFile;
    delete window.__codetrace_saveReviewSticky;
    delete window.__codetrace_onGraphNodeDeletionImpact;
    delete window.__codetrace_analyzeGraphNodeDeletion;
    delete window.__codetrace_confirmGraphNodeRemoval;
    delete (globalThis as { window?: unknown }).window;
  });

  it('reads the initial document content from the webview bootstrap', () => {
    window.__codetrace_initialContent = '{"version":1}';

    expect(getInitialDocumentContent()).toBe('{"version":1}');
  });

  it('filters initial review stickies from the webview bootstrap', () => {
    window.__codetrace_initialReviewStickies = [
      { reviewId: 'r1', title: 'Title', body: 'Body' },
      { reviewId: '', title: 'Nope', body: 'Body' },
      { reviewId: 'r2', title: 'Missing body' },
    ];

    expect(getInitialReviewStickies()).toEqual([{ reviewId: 'r1', title: 'Title', body: 'Body' }]);
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

  it('posts review sticky payloads to the extension save hook', () => {
    const saveReview = jest.fn();
    window.__codetrace_saveReviewSticky = saveReview;

    saveReviewSticky({ reviewId: 'r1', title: 'Title', body: 'Body' });

    expect(saveReview).toHaveBeenCalledWith({ reviewId: 'r1', title: 'Title', body: 'Body' });
  });

  it('subscribes and restores the previous graph node deletion impact handler', () => {
    const previous = jest.fn();
    const next = jest.fn();
    window.__codetrace_onGraphNodeDeletionImpact = previous;

    const unsubscribe = subscribeGraphNodeDeletionImpact(next);
    window.__codetrace_onGraphNodeDeletionImpact?.({
      requestId: 'req',
      node: {
        id: 'n',
        name: 'node',
        kind: 'function',
        file: 'src/a.ts',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      },
      impacts: [],
    });
    unsubscribe();
    window.__codetrace_onGraphNodeDeletionImpact?.({
      requestId: 'again',
      node: {
        id: 'n',
        name: 'node',
        kind: 'function',
        file: 'src/a.ts',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      },
      impacts: [],
    });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req' }));
    expect(previous).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'again' }));
  });

  it('posts graph node deletion analysis requests when the hook exists', () => {
    const analyze = jest.fn();
    window.__codetrace_analyzeGraphNodeDeletion = analyze;
    const request = {
      requestId: 'req',
      node: {
        id: 'n',
        name: 'node',
        kind: 'function' as const,
        file: 'src/a.ts',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      },
      callers: [],
    };

    expect(requestGraphNodeDeletionImpact(request)).toBe(true);
    expect(analyze).toHaveBeenCalledWith(request);
  });

  it('returns false for graph node deletion analysis when the hook is absent', () => {
    expect(requestGraphNodeDeletionImpact({
      requestId: 'req',
      node: {
        id: 'n',
        name: 'node',
        kind: 'function',
        file: 'src/a.ts',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      },
      callers: [],
    })).toBe(false);
  });

  it('posts confirmed graph node removals to the extension hook', () => {
    const confirm = jest.fn();
    window.__codetrace_confirmGraphNodeRemoval = confirm;
    const entry = {
      node: {
        id: 'n',
        name: 'node',
        kind: 'function' as const,
        file: 'src/a.ts',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      },
      callerCount: 0,
      stickyCount: 0,
      decision: 'confirmed' as const,
      impacts: [],
    };

    confirmGraphNodeRemoval(entry);

    expect(confirm).toHaveBeenCalledWith(entry);
  });
});
