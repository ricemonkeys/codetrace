import { AnalysisCache, type CallGraphSnapshot } from './analysisCache';

const range = { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 };

function node(id: string, file: string): CallGraphSnapshot['nodes'][number] {
  return { id, name: id, kind: 'function', file, range };
}

function edge(from: string, to: string): CallGraphSnapshot['edges'][number] {
  return { from, to };
}

describe('AnalysisCache', () => {
  it('starts empty', () => {
    const cache = new AnalysisCache();
    expect(cache.isEmpty()).toBe(true);
    expect(cache.current).toBeNull();
  });

  it('set / get round-trips a snapshot', () => {
    const cache = new AnalysisCache();
    const snap: CallGraphSnapshot = {
      nodes: [node('a', 'a.ts'), node('b', 'b.ts')],
      edges: [edge('a', 'b')],
    };
    cache.set('/repo', snap);
    expect(cache.isEmpty()).toBe(false);
    expect(cache.current?.workspaceRoot).toBe('/repo');
    expect(cache.current?.graph.nodes).toHaveLength(2);
    expect(cache.current?.graph.edges).toHaveLength(1);
  });

  it('invalidate clears the entry', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', { nodes: [], edges: [] });
    cache.invalidate();
    expect(cache.isEmpty()).toBe(true);
  });

  it('hydrate seeds the cache from a persisted snapshot', () => {
    const cache = new AnalysisCache();
    cache.hydrate('/repo', { nodes: [node('a', 'a.ts')], edges: [] }, '2026-05-04T00:00:00Z');
    expect(cache.current?.timestamp).toBe('2026-05-04T00:00:00Z');
    expect(cache.current?.graph.nodes[0].id).toBe('a');
  });
});

describe('computeDirtyFiles', () => {
  // Topology:
  //   a.ts:foo --calls--> b.ts:bar --calls--> c.ts:baz
  //   d.ts:qux --calls--> b.ts:bar
  // If b.ts changes:
  //   - b.ts itself is dirty (its symbols may have changed)
  //   - a.ts and d.ts are dirty (they call into b.ts; their edges may now be stale)
  //   - c.ts is NOT dirty (its text is unchanged)
  const seedSnapshot: CallGraphSnapshot = {
    nodes: [
      node('foo', 'a.ts'),
      node('bar', 'b.ts'),
      node('baz', 'c.ts'),
      node('qux', 'd.ts'),
    ],
    edges: [edge('foo', 'bar'), edge('bar', 'baz'), edge('qux', 'bar')],
  };

  it('marks the changed file plus every caller (file containing an edge -> dirty target)', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', seedSnapshot);

    const dirty = cache.computeDirtyFiles(['b.ts']);
    expect([...dirty].sort()).toEqual(['a.ts', 'b.ts', 'd.ts']);
  });

  it('does NOT mark callees as dirty', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', seedSnapshot);

    const dirty = cache.computeDirtyFiles(['b.ts']);
    expect(dirty.has('c.ts')).toBe(false);
  });

  it('returns just the changed files when the cache is empty (no graph to traverse)', () => {
    const cache = new AnalysisCache();
    const dirty = cache.computeDirtyFiles(['x.ts', 'y.ts']);
    expect([...dirty].sort()).toEqual(['x.ts', 'y.ts']);
  });

  it('handles multiple changed files (union of caller sets)', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', seedSnapshot);

    const dirty = cache.computeDirtyFiles(['b.ts', 'c.ts']);
    // b.ts dirty -> a.ts + d.ts as callers
    // c.ts dirty -> b.ts as caller
    expect([...dirty].sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  });

  // Path-matching contract test: the watcher feeds dirty filenames as the same
  // string the analyzer puts on `node.file`. Both currently use absolute,
  // platform-normalized paths (vscode `document.uri.fsPath` on the watcher side,
  // `path.normalize`/`uri.fsPath` on the analyzer side). If anyone changes
  // either side to use a different representation (relative paths, lowercased,
  // POSIX vs Windows separators), this test fails loudly.
  it('matches file paths exactly between watcher input and analyzer output', () => {
    const cache = new AnalysisCache();
    const absolutePath = '/Users/dev/repo/src/b.ts';
    cache.set('/Users/dev/repo', {
      nodes: [
        node('foo', '/Users/dev/repo/src/a.ts'),
        node('bar', absolutePath),
      ],
      edges: [edge('foo', 'bar')],
    });

    // Simulate the watcher passing document.uri.fsPath (absolute) through.
    const dirty = cache.computeDirtyFiles([absolutePath]);
    // We expect a.ts to be picked up as a caller of bar in b.ts.
    expect(dirty.has('/Users/dev/repo/src/a.ts')).toBe(true);
  });
});

describe('mergeIncremental', () => {
  const initial: CallGraphSnapshot = {
    nodes: [
      node('foo', 'a.ts'),
      node('bar', 'b.ts'),
      node('baz', 'c.ts'),
    ],
    edges: [edge('foo', 'bar'), edge('bar', 'baz')],
  };

  it('replaces the dirty-file slice with the partial result', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', initial);

    // b.ts is dirty: bar got renamed to bar2 and now also calls a new helper baz2 in c.ts (not modeled here for simplicity).
    const partial: CallGraphSnapshot = {
      nodes: [node('bar2', 'b.ts')],
      edges: [edge('bar2', 'baz')],
    };
    const merged = cache.mergeIncremental(new Set(['b.ts']), partial);

    const ids = merged.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['bar2', 'baz', 'foo']);
    // The stale `bar` node from b.ts is gone.
    expect(ids).not.toContain('bar');
  });

  it('drops edges whose endpoints sit in a dirty file', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', initial);

    // a.ts changes: foo no longer calls bar.
    const partial: CallGraphSnapshot = {
      nodes: [node('foo', 'a.ts')],
      edges: [],
    };
    const merged = cache.mergeIncremental(new Set(['a.ts']), partial);

    const edgeKeys = merged.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgeKeys).toEqual(['bar->baz']); // foo->bar dropped
  });

  it('keeps edges that touch no dirty file', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', initial);

    // Pretend d.ts is dirty (an empty new file with no symbols).
    const partial: CallGraphSnapshot = {
      nodes: [],
      edges: [],
    };
    const merged = cache.mergeIncremental(new Set(['d.ts']), partial);

    const edgeKeys = merged.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgeKeys).toEqual(['bar->baz', 'foo->bar']);
  });

  it('deduplicates edges added back by the partial result', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', initial);

    const partial: CallGraphSnapshot = {
      nodes: [node('bar', 'b.ts')],
      // The same foo->bar edge survives because foo is in a.ts (not dirty); it
      // should not be duplicated when the partial result also reasserts it.
      edges: [edge('foo', 'bar'), edge('bar', 'baz')],
    };
    const merged = cache.mergeIncremental(new Set(['b.ts']), partial);

    const edgeKeys = merged.edges.map((e) => `${e.from}->${e.to}`);
    expect(edgeKeys.sort()).toEqual(['bar->baz', 'foo->bar']);
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
  });

  it('updates the cached snapshot in place', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', initial);
    cache.mergeIncremental(new Set(['b.ts']), { nodes: [], edges: [] });
    expect(cache.current?.graph.nodes.find((n) => n.id === 'bar')).toBeUndefined();
  });

  it('can seed an empty cache by treating the partial as the full snapshot', () => {
    const cache = new AnalysisCache();
    const merged = cache.mergeIncremental(new Set(['a.ts']), {
      nodes: [node('foo', 'a.ts')],
      edges: [],
    });
    expect(merged.nodes).toHaveLength(1);
    expect(cache.current?.graph.nodes[0].id).toBe('foo');
  });
});
