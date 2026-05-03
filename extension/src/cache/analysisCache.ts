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

  set(workspaceRoot: string, graph: CallGraphSnapshot): AnalysisCacheEntry {
    this.entry = {
      workspaceRoot,
      timestamp: new Date().toISOString(),
      graph: {
        nodes: [...graph.nodes],
        edges: [...graph.edges],
      },
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
   * Returns the merged snapshot (also stored in the cache).
   */
  mergeIncremental(
    dirtyFiles: ReadonlySet<string>,
    partial: CallGraphSnapshot,
  ): CallGraphSnapshot {
    if (!this.entry) {
      return this.set(
        // Without a prior workspaceRoot we cannot key the entry; the wiring
        // layer is expected to call set() first on cold start.
        '',
        partial,
      ).graph;
    }

    const survivors = this.entry.graph.nodes.filter((n) => !dirtyFiles.has(n.file));
    const survivorIds = new Set(survivors.map((n) => n.id));

    // Drop any edges whose endpoints disappeared OR whose endpoint sits in a
    // dirty file (the partial result will reintroduce the live ones).
    const partialIds = new Set(partial.nodes.map((n) => n.id));
    const allLiveIds = new Set([...survivorIds, ...partialIds]);

    const survivingEdges = this.entry.graph.edges.filter((edge) => {
      if (!allLiveIds.has(edge.from) || !allLiveIds.has(edge.to)) return false;
      // If either endpoint lived in a dirty file, the partial result is the
      // authoritative source for that edge — drop the stale copy here.
      const fromFile = this.fileOf(edge.from);
      const toFile = this.fileOf(edge.to);
      if (fromFile && dirtyFiles.has(fromFile)) return false;
      if (toFile && dirtyFiles.has(toFile)) return false;
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
   */
  hydrate(workspaceRoot: string, graph: CallGraphSnapshot, timestamp?: string): AnalysisCacheEntry {
    this.entry = {
      workspaceRoot,
      timestamp: timestamp ?? new Date().toISOString(),
      graph: {
        nodes: [...graph.nodes],
        edges: [...graph.edges],
      },
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
