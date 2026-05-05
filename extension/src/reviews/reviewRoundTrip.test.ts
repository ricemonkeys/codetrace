import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { loadReviewStickies, persistReviewSticky, removeReviewStickyArtifacts } from './reviewRoundTrip';

describe('review round-trip storage', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codetrace-review-'));
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('writes a source marker and markdown body, then loads them as one active sticky', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'demo.ts'),
      'export function demo() {\n  return 1;\n}\n',
      'utf8',
    );

    const saved = await persistReviewSticky(workspaceRoot, {
      reviewId: 'r1',
      title: 'Check return value',
      body: 'line one\nline two',
      anchor: {
        nodeId: 'src/demo.ts#demo',
        symbolId: 'src/demo.ts#demo',
        file: 'src/demo.ts',
        range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
      },
    });

    const source = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8');
    expect(source).toContain('// review: r1 Check return value');
    expect(source).toContain('// review-body: r1 line one');
    expect(source).toContain('// review-body: r1 line two');

    const markdown = await fs.readFile(path.join(workspaceRoot, '.codetrace', 'reviews', 'r1.md'), 'utf8');
    expect(markdown).toContain('anchorNodeId: "src/demo.ts#demo"');
    expect(markdown).toContain('file: "src/demo.ts"');
    expect(markdown).toContain('line one\nline two');

    const loaded = await loadReviewStickies(workspaceRoot);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      reviewId: 'r1',
      title: 'Check return value',
      body: 'line one\nline two',
      status: 'active',
      source: 'both',
    });
    expect(loaded[0].anchor?.lineHash).toBe(saved.anchor?.lineHash);
    expect(loaded[0].anchor?.range?.startLine).toBe(4);
  });

  it('keeps long bodies in markdown without expanding source comments', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.py'), 'def demo():\n    return 1\n', 'utf8');

    await persistReviewSticky(workspaceRoot, {
      reviewId: 'long-body',
      title: 'Long note',
      body: ['1', '2', '3', '4', '5', '6'].join('\n'),
      anchor: {
        nodeId: 'src/demo.py#demo',
        symbolId: 'src/demo.py#demo',
        file: 'src/demo.py',
        range: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 12 },
      },
    });

    const source = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.py'), 'utf8');
    expect(source).toContain('# review: long-body Long note');
    expect(source).not.toContain('review-body: long-body');

    const loaded = await loadReviewStickies(workspaceRoot);
    expect(loaded[0].body).toBe('1\n2\n3\n4\n5\n6');
    expect(loaded[0].status).toBe('active');
  });

  it('replaces an existing marker block for the same review id', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'export function demo() {}\n', 'utf8');

    const anchor = {
      nodeId: 'src/demo.ts#demo',
      symbolId: 'src/demo.ts#demo',
      file: 'src/demo.ts',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 26 },
    };

    await persistReviewSticky(workspaceRoot, {
      reviewId: 'replace-me',
      title: 'Old',
      body: 'old body',
      anchor,
    });
    await persistReviewSticky(workspaceRoot, {
      reviewId: 'replace-me',
      title: 'New',
      body: 'new body',
      anchor,
    });

    const source = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8');
    expect(source.match(/review: replace-me/g)).toHaveLength(1);
    expect(source).toContain('// review: replace-me New');
    expect(source).toContain('// review-body: replace-me new body');
    expect(source).not.toContain('Old');
  });

  it('removes persisted review markdown and source marker blocks', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'src', 'remove.ts'), 'export function removeMe() {}\n', 'utf8');
    await persistReviewSticky(workspaceRoot, {
      reviewId: 'remove-me',
      title: 'Remove',
      body: 'body',
      anchor: {
        nodeId: 'src/remove.ts#removeMe',
        symbolId: 'src/remove.ts#removeMe',
        file: 'src/remove.ts',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 29 },
      },
    });

    await removeReviewStickyArtifacts(workspaceRoot, ['remove-me']);

    await expect(
      fs.readFile(path.join(workspaceRoot, '.codetrace', 'reviews', 'remove-me.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const source = await fs.readFile(path.join(workspaceRoot, 'src', 'remove.ts'), 'utf8');
    expect(source).not.toContain('review: remove-me');
    await expect(loadReviewStickies(workspaceRoot)).resolves.toEqual([]);
  });

  it('keeps lineHash stable when an existing marker block changes length', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'hash.ts'),
      'export function hashMe() {\n  return 1;\n}\n',
      'utf8',
    );

    const first = await persistReviewSticky(workspaceRoot, {
      reviewId: 'hash-note',
      title: 'Hash',
      body: 'one',
      anchor: {
        nodeId: 'src/hash.ts#hashMe',
        symbolId: 'src/hash.ts#hashMe',
        file: 'src/hash.ts',
        range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
      },
    });
    const second = await persistReviewSticky(workspaceRoot, {
      reviewId: 'hash-note',
      title: 'Hash',
      body: 'one\ntwo\nthree',
      anchor: first.anchor,
    });

    const loaded = await loadReviewStickies(workspaceRoot);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].anchor?.lineHash).toBe(second.anchor?.lineHash);
    expect(loaded[0].anchor?.range?.startLine).toBe(second.anchor?.range?.startLine);
  });

  it('marks only marker blocks that overlap a merge conflict region', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'conflict.ts'),
      [
        '// review: clean Clean marker',
        '// review-body: clean ok',
        'export function clean() {}',
        '<<<<<<< HEAD',
        '// review: conflicted Conflict marker',
        '// review-body: conflicted left',
        '=======',
        '// review-body: conflicted right',
        '>>>>>>> branch',
        'export function conflicted() {}',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await loadReviewStickies(workspaceRoot);
    const byId = new Map(loaded.map((review) => [review.reviewId, review]));

    expect(byId.get('clean')?.status).toBe('orphan-marker');
    expect(byId.get('conflicted')?.status).toBe('merge-conflict');
  });

  it('rejects source anchors outside the workspace', async () => {
    await expect(
      persistReviewSticky(workspaceRoot, {
        reviewId: 'outside',
        title: 'Outside',
        body: 'Body',
        anchor: {
          file: '../outside.ts',
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        },
      }),
    ).rejects.toThrow('outside the workspace');
  });

  it('reports orphan markers, orphan bodies, and merge conflict records', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'marker.ts'),
      '// review: marker-only Missing body\nexport const value = 1;\n',
      'utf8',
    );
    await fs.mkdir(path.join(workspaceRoot, '.codetrace', 'reviews'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, '.codetrace', 'reviews', 'body-only.md'),
      [
        '---',
        'id: "body-only"',
        'title: "Missing marker"',
        'file: "src/missing.ts"',
        'createdAt: "2026-05-04T00:00:00.000Z"',
        'draft: false',
        '---',
        'Stored body',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(workspaceRoot, '.codetrace', 'reviews', 'conflict.md'),
      [
        '---',
        'id: "conflict"',
        'title: "Conflict"',
        'draft: false',
        '---',
        '<<<<<<< HEAD',
        'body',
        '=======',
        'other',
        '>>>>>>> branch',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await loadReviewStickies(workspaceRoot);
    const byId = new Map(loaded.map((review) => [review.reviewId, review]));

    expect(byId.get('marker-only')?.status).toBe('orphan-marker');
    expect(byId.get('body-only')?.status).toBe('orphan-body');
    expect(byId.get('conflict')?.status).toBe('merge-conflict');
  });
});
