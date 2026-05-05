// Pure cache + dirty-propagation logic for the workspace call graph.
// Intentionally has NO `vscode` import so extension/src/test (jest) can
// exercise it without a VS Code runtime.

export interface CallGraphNode {
  id: string;
  name: string;
  kind: string;
  file: string;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface CallGraphEdge {
  from: string;
  to: string;
  unresolved?: boolean;
}

export interface CallGraphSnapshot {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

export interface AnalysisCacheEntry {
  workspaceRoot: string;
  timestamp: string;
  graph: CallGraphSnapshot;
  /**
   * True when the cached graph reflects a full-workspace analysis. Scoped
   * (folder/file) analyses set this to false so the save watcher can refuse
   * to use such a partial baseline as the seed for incremental merges.
   */
  isFullWorkspaceSnapshot: boolean;
}

export interface CacheSetOptions {
  isFullWorkspaceSnapshot: boolean;
}

/**
 * In-memory cache of the most recent analysis result for a workspace.
 * Treat one cache instance per workspace; the workspaceRoot is the implicit key.
 */
export class AnalysisCache {
  private entry: AnalysisCacheEntry | null = null;

  get current(): AnalysisCacheEntry | null {
    return this.entry;
  }

  isEmpty(): boolean {
    return this.entry === null;
  }

  set(
    workspaceRoot: string,
    graph: CallGraphSnapshot,
    options: CacheSetOptions = { isFullWorkspaceSnapshot: true },
  ): AnalysisCacheEntry {
    this.entry = {
      workspaceRoot,
      timestamp: new Date().toISOString(),
      graph: {
        nodes: [...graph.nodes],
        edges: [...graph.edges],
      },
      isFullWorkspaceSnapshot: options.isFullWorkspaceSnapshot,
    };
    return this.entry;
  }

  invalidate(): void {
    this.entry = null;
  }

  /**
   * Compute the *callers* of the given changed files. We re-analyze a file F
   * AND every file that contains a node calling something defined in F, because
   * the caller's edge target may now be invalid (renamed/removed symbol).
   *
   * Callees of F do NOT need re-analysis — their text didn't change.
   */
  computeDirtyFiles(changedFiles: readonly string[]): Set<string> {
    const dirty = new Set<string>(changedFiles);
    if (!this.entry) return dirty;

    const changedSet = new Set(changedFiles);
    const nodeFile = new Map<string, string>();
    for (const node of this.entry.graph.nodes) {
      nodeFile.set(node.id, node.file);
    }

    for (const edge of this.entry.graph.edges) {
      const calleeFile = nodeFile.get(edge.to);
      if (calleeFile !== undefined && changedSet.has(calleeFile)) {
        const callerFile = nodeFile.get(edge.from);
        if (callerFile !== undefined) {
          dirty.add(callerFile);
        }
      }
    }
    return dirty;
  }

  /**
   * Replace the per-file slice of the cache with the freshly-analysed partial
   * result. Nodes/edges that belonged to one of `dirtyFiles` are dropped from
   * the existing snapshot, then the new partial graph is appended.
   *
   * `dirtyFiles` is the union of (a) files the user actually changed and
   * (b) caller-expansion: files that contain a node calling something defined
   * in (a). `originallyChanged` (when provided) carries just (a). The
   * distinction matters for edges:
   *   - Edges *out of* a dirty file are redrawn by the partial analysis
   *     (TypeScript analyzer regenerates outgoing edges for limitToFiles).
   *   - Edges *into* an originally-changed file may be stale (the target
   *     symbol could have been renamed/removed) — drop them so the partial
   *     can reintroduce the live ones.
   *   - Edges into a caller-expanded file are NOT in the partial (the
   *     analyzer only redraws outgoing edges of dirty files), so they must
   *     be preserved from the cache.
   * If `originallyChanged` is omitted the function falls back to the legacy
   * behavior (treats every dirty file as originally-changed), which is safe
   * but loses caller incoming edges.
   *
   * Returns the merged snapshot (also stored in the cache).
   */
  mergeIncremental(
    dirtyFiles: ReadonlySet<string>,
    partial: CallGraphSnapshot,
    originallyChanged?: ReadonlySet<string>,
  ): CallGraphSnapshot {
    if (!this.entry) {
      return this.set(
        // Without a prior workspaceRoot we cannot key the entry; the wiring
        // layer is expected to call set() first on cold start.
        '',
        partial,
        { isFullWorkspaceSnapshot: false },
      ).graph;
    }

    const changedFiles = originallyChanged ?? dirtyFiles;

    const survivors = this.entry.graph.nodes.filter((n) => !dirtyFiles.has(n.file));
    const survivorIds = new Set(survivors.map((n) => n.id));

    const partialIds = new Set(partial.nodes.map((n) => n.id));
    const allLiveIds = new Set([...survivorIds, ...partialIds]);

    const survivingEdges = this.entry.graph.edges.filter((edge) => {
      if (!allLiveIds.has(edge.from) || !allLiveIds.has(edge.to)) return false;
      const fromFile = this.fileOf(edge.from);
      const toFile = this.fileOf(edge.to);
      // Drop edges whose source file was reanalysed; the partial owns those.
      if (fromFile && dirtyFiles.has(fromFile)) return false;
      // Drop edges into originally-changed files — the callee symbol may have
      // moved or disappeared, so trust the partial analysis to redraw them.
      // Keep edges into caller-expanded files: the partial does not contain
      // them and dropping would silently delete valid incoming relationships.
      if (toFile && changedFiles.has(toFile)) return false;
      return true;
    });

    // Dedupe nodes by id. The TypeScript analyzer may include callee nodes
    // that live OUTSIDE the dirty file set when an edge from a dirty file
    // points to them — those callees are also present in `survivors`. Without
    // dedup the cache (and persisted JSON) ends up with duplicate node ids.
    // Survivors win for non-dirty ids; dirty-file ids only come from `partial`
    // because survivors filtered them out above.
    const survivorById = new Map(survivors.map((n) => [n.id, n] as const));
    const mergedNodes = [...survivors];
    for (const node of partial.nodes) {
      if (survivorById.has(node.id)) continue;
      mergedNodes.push(node);
    }

    const seenEdge = new Set<string>();
    const mergedEdges: CallGraphEdge[] = [];
    for (const edge of [...survivingEdges, ...partial.edges]) {
      const key = `${edge.from}->${edge.to}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      mergedEdges.push(edge);
    }

    this.entry = {
      ...this.entry,
      timestamp: new Date().toISOString(),
      graph: { nodes: mergedNodes, edges: mergedEdges },
    };
    return this.entry.graph;
  }

  /**
   * Hydrate from a previously-persisted snapshot (e.g. .codetrace/analysis_cache.json).
   * The persisted file is produced by full or scoped analyses; the caller must
   * pass through the recorded scope flag so the watcher refuses to seed
   * incremental work from a scoped baseline.
   */
  hydrate(
    workspaceRoot: string,
    graph: CallGraphSnapshot,
    options: { timestamp?: string; isFullWorkspaceSnapshot: boolean },
  ): AnalysisCacheEntry {
    this.entry = {
      workspaceRoot,
      timestamp: options.timestamp ?? new Date().toISOString(),
      graph: {
        nodes: [...graph.nodes],
        edges: [...graph.edges],
      },
      isFullWorkspaceSnapshot: options.isFullWorkspaceSnapshot,
    };
    return this.entry;
  }

  private fileOf(nodeId: string): string | undefined {
    if (!this.entry) return undefined;
    for (const n of this.entry.graph.nodes) {
      if (n.id === nodeId) return n.file;
    }
    return undefined;
  }
}
