import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { loadReviewStickies, persistReviewSticky } from './reviewRoundTrip';

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

    await persistReviewSticky(workspaceRoot, {
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
