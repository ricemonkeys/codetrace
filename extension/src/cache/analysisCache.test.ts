import {
  AnalysisCache,
  decodePersistedFullSnapshotFlag,
  type CallGraphSnapshot,
} from './analysisCache';

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

  it('set defaults isFullWorkspaceSnapshot to true and respects an explicit false', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', { nodes: [], edges: [] });
    expect(cache.current?.isFullWorkspaceSnapshot).toBe(true);

    cache.set('/repo', { nodes: [], edges: [] }, { isFullWorkspaceSnapshot: false });
    expect(cache.current?.isFullWorkspaceSnapshot).toBe(false);
  });

  it('mergeIncremental preserves the scope flag of the existing entry', () => {
    // Regression for the 2nd review P1-B: scoped baselines must stay scoped
    // even after watcher merges, so the watcher can keep refusing to seed
    // incremental analysis from them.
    const cache = new AnalysisCache();
    cache.set('/repo', { nodes: [node('a', 'a.ts')], edges: [] }, { isFullWorkspaceSnapshot: false });
    cache.mergeIncremental(new Set(['a.ts']), { nodes: [node('a', 'a.ts')], edges: [] });
    expect(cache.current?.isFullWorkspaceSnapshot).toBe(false);
  });

  it('invalidate clears the entry', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', { nodes: [], edges: [] });
    cache.invalidate();
    expect(cache.isEmpty()).toBe(true);
  });

  it('hydrate seeds the cache from a persisted snapshot', () => {
    const cache = new AnalysisCache();
    cache.hydrate(
      '/repo',
      { nodes: [node('a', 'a.ts')], edges: [] },
      { timestamp: '2026-05-04T00:00:00Z', isFullWorkspaceSnapshot: true },
    );
    expect(cache.current?.timestamp).toBe('2026-05-04T00:00:00Z');
    expect(cache.current?.graph.nodes[0].id).toBe('a');
    expect(cache.current?.isFullWorkspaceSnapshot).toBe(true);
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

  it('preserves caller-expanded incoming edges that the partial does not regenerate', () => {
    // Regression for the 2nd review P1: when b.ts is saved, computeDirtyFiles
    // expands to {b.ts, a.ts(caller)}. The TypeScript analyzer redraws outgoing
    // edges from those files only, so c.ts -> a.ts is NOT in the partial. The
    // merge must keep that edge; otherwise valid call relationships disappear
    // until the next full reanalysis.
    const cache = new AnalysisCache();
    cache.set('/repo', {
      nodes: [
        node('cFn', 'c.ts'),
        node('aFn', 'a.ts'),
        node('bFn', 'b.ts'),
      ],
      edges: [edge('cFn', 'aFn'), edge('aFn', 'bFn')],
    });

    // Originally changed: b.ts. Caller-expanded: a.ts. Partial reanalyses both
    // and emits outgoing edges: a -> b. Survivors include cFn.
    const partial: CallGraphSnapshot = {
      nodes: [node('aFn', 'a.ts'), node('bFn', 'b.ts')],
      edges: [edge('aFn', 'bFn')],
    };
    const merged = cache.mergeIncremental(
      new Set(['a.ts', 'b.ts']),
      partial,
      new Set(['b.ts']),
    );

    const edgeKeys = merged.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgeKeys).toEqual(['aFn->bFn', 'cFn->aFn']);
  });

  it('still drops incoming edges into originally-changed files', () => {
    // The dual of the previous test: when the originally-changed file is the
    // edge target, the symbol may have been renamed/removed and the partial
    // is the source of truth for those incoming edges.
    const cache = new AnalysisCache();
    cache.set('/repo', {
      nodes: [node('aFn', 'a.ts'), node('bFn', 'b.ts')],
      edges: [edge('aFn', 'bFn')],
    });

    // b.ts changed, bFn was renamed; partial replaces it with bFn2. The stale
    // aFn -> bFn edge must be dropped (a.ts is caller-expanded, b.ts is the
    // originally-changed target).
    const partial: CallGraphSnapshot = {
      nodes: [node('aFn', 'a.ts'), node('bFn2', 'b.ts')],
      edges: [edge('aFn', 'bFn2')],
    };
    const merged = cache.mergeIncremental(
      new Set(['a.ts', 'b.ts']),
      partial,
      new Set(['b.ts']),
    );

    const edgeKeys = merged.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgeKeys).toEqual(['aFn->bFn2']);
  });

  it('falls back to legacy drop-all-dirty behavior when originallyChanged is omitted', () => {
    const cache = new AnalysisCache();
    cache.set('/repo', {
      nodes: [node('cFn', 'c.ts'), node('aFn', 'a.ts'), node('bFn', 'b.ts')],
      edges: [edge('cFn', 'aFn'), edge('aFn', 'bFn')],
    });

    const partial: CallGraphSnapshot = {
      nodes: [node('aFn', 'a.ts'), node('bFn', 'b.ts')],
      edges: [edge('aFn', 'bFn')],
    };
    // No originallyChanged passed: behaves as before — incoming edge into a.ts
    // is dropped because every dirty file is treated as originally-changed.
    const merged = cache.mergeIncremental(new Set(['a.ts', 'b.ts']), partial);

    const edgeKeys = merged.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgeKeys).toEqual(['aFn->bFn']);
  });

  it('dedupes nodes when partial includes a non-dirty callee that already survives', () => {
    // Regression for the analyzer behavior where TypeScriptAnalyzer pulls in
    // callee nodes living OUTSIDE the dirty file set so the partial graph stays
    // self-contained. Without node-id dedup the merged snapshot ends up with
    // duplicate `bar` entries (one from survivors, one from partial).
    const cache = new AnalysisCache();
    cache.set('/repo', {
      nodes: [node('foo', 'a.ts'), node('bar', 'b.ts')],
      edges: [edge('foo', 'bar')],
    });

    // a.ts is dirty. The partial includes both the dirty-file node `foo` and
    // the referenced non-dirty callee `bar` (the analyzer needs it to materialize
    // the edge endpoint).
    const partial: CallGraphSnapshot = {
      nodes: [node('foo', 'a.ts'), node('bar', 'b.ts')],
      edges: [edge('foo', 'bar')],
    };
    const merged = cache.mergeIncremental(new Set(['a.ts']), partial);

    const ids = merged.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['bar', 'foo']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('decodePersistedFullSnapshotFlag', () => {
  // P2 (3차 리뷰): develop이 이미 디스크에 써둔 옛 캐시는 `scope` 필드로 scoped
  // 분석 결과를 표시했고 `isFullWorkspaceSnapshot`은 갖고 있지 않다. 이 PR이
  // hydrate 시점에 그 차이를 무시하면 watcher가 partial baseline을 다시 incremental
  // seed로 써서 P1-B가 마이그레이션 경로에서 재현된다.

  it('returns the explicit flag when post-P1-B writes set it to true', () => {
    expect(decodePersistedFullSnapshotFlag({ isFullWorkspaceSnapshot: true })).toBe(true);
  });

  it('returns the explicit flag when post-P1-B writes set it to false', () => {
    expect(decodePersistedFullSnapshotFlag({ isFullWorkspaceSnapshot: false })).toBe(false);
  });

  it('treats legacy full-analysis cache (scope: null) as full snapshot', () => {
    expect(decodePersistedFullSnapshotFlag({ scope: null })).toBe(true);
  });

  it('treats legacy scoped-analysis cache (scope: "src/**") as NOT a full snapshot', () => {
    // The migration regression flagged in 3차 리뷰: existing develop users may
    // have an analysis_cache.json whose `scope` is non-null because they last
    // ran `Analyze Scoped`. Hydrating it as full would re-introduce P1-B.
    expect(decodePersistedFullSnapshotFlag({ scope: 'src/**' })).toBe(false);
  });

  it('defaults to full snapshot when neither field is present (very old cache)', () => {
    expect(decodePersistedFullSnapshotFlag({})).toBe(true);
  });

  it('honours an explicit false even when scope is null (explicit wins)', () => {
    // Priority order check: post-P1-B writers always set the boolean. If they
    // wrote `false`, that's the source of truth even if scope happens to be
    // null in the same blob.
    expect(decodePersistedFullSnapshotFlag({ isFullWorkspaceSnapshot: false, scope: null })).toBe(false);
  });
});
