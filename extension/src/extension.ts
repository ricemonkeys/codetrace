import * as vscode from 'vscode';
import { extractWorkspaceCallGraph } from './analyzer/callGraph';
import { CanvasEditorProvider } from './CanvasEditorProvider';
import { CodeAnalyzer } from './CodeAnalyzer';
import {
  AnalysisCache,
  decodePersistedFullSnapshotFlag,
  type CallGraphSnapshot,
} from './cache/analysisCache';
import { markChangedFunctions } from './git/changedRanges';
import { collectChangedLineRanges, getConfiguredGitBaseBranch } from './git/vscodeGit';
import { filterRemovedNodes, readRemovedNodeIds } from './removedNodes';

const ANALYSIS_CACHE_FILE = 'analysis_cache.json';
const SAVE_DEBOUNCE_MS = 600;
const ANALYSABLE_LANGS = new Set([
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'python',
  'java',
  'go',
]);

export function activate(context: vscode.ExtensionContext) {
  const analyzer = new CodeAnalyzer();
  const outputChannel = vscode.window.createOutputChannel('CodeTrace Analysis');
  context.subscriptions.push(outputChannel);

  const cache = new AnalysisCache();

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'codetrace.refreshAnalysis';
  statusBar.tooltip = 'CodeTrace: 클릭하면 강제 전체 재분석';
  context.subscriptions.push(statusBar);

  const setStatus = (label: string, busy = false) => {
    statusBar.text = busy ? `$(sync~spin) CodeTrace: ${label}` : `$(graph) CodeTrace: ${label}`;
    statusBar.show();
  };
  setStatus('Idle');

  context.subscriptions.push(CanvasEditorProvider.register(context));

  // ---------- Hydrate from .codetrace/analysis_cache.json on activate ----------
  // Acceptance: same workspace re-open shows the graph immediately, without re-analysing.
  // Note: multi-root workspaces use the first folder for v1; document via output channel.
  // We track hydrate completion so the save watcher can wait — without this guard
  // a save event firing before hydrate finishes would seed the cache from a single
  // partial graph and persist it as the canonical snapshot.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  let hydrateDone: Promise<void> = Promise.resolve();
  if (workspaceRoot) {
    const cacheUri = vscode.Uri.joinPath(workspaceRoot, '.codetrace', ANALYSIS_CACHE_FILE);
    hydrateDone = Promise.resolve(vscode.workspace.fs.readFile(cacheUri)).then(
      async (bytes) => {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
            const wasFullSnapshot = decodePersistedFullSnapshotFlag(parsed);
            const removedNodeIds = await readRemovedNodeIds(workspaceRoot.fsPath);
            const hydratedGraph = filterRemovedNodes(
              { nodes: parsed.nodes, edges: parsed.edges },
              removedNodeIds,
            );
            cache.hydrate(
              workspaceRoot.fsPath,
              hydratedGraph,
              { timestamp: parsed.timestamp, isFullWorkspaceSnapshot: wasFullSnapshot },
            );
            CanvasEditorProvider.broadcast({
              type: 'analysis',
              payload: { nodes: hydratedGraph.nodes, edges: hydratedGraph.edges },
            });
            setStatus(`캐시 복원 (${parsed.nodes.length} nodes)`);
            outputChannel.appendLine(
              `Hydrated cache from ${vscode.workspace.asRelativePath(cacheUri)} (${hydratedGraph.nodes.length} nodes, ${hydratedGraph.edges.length} edges, fullSnapshot=${wasFullSnapshot}).`,
            );
            if (removedNodeIds.size > 0) {
              outputChannel.appendLine(`Filtered ${removedNodeIds.size} removed graph nodes from .codetrace/removed.log.`);
            }
          }
        } catch (err) {
          outputChannel.appendLine(`Failed to hydrate analysis cache: ${err}`);
        }
      },
      () => {
        // No cache file yet — silent; first analysis will create it.
      },
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.analyzeRelationships', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('CodeTrace: 활성 에디터가 없습니다.');
        return;
      }

      const position = editor.selection.active;
      const uri = editor.document.uri;

      outputChannel.show();
      outputChannel.appendLine(`--- Analysis Started: ${uri.fsPath} at ${position.line}:${position.character} ---`);

      try {
        const relationships = await analyzer.traceRelationships(uri, position, 1);
        if (relationships.length === 0) {
          outputChannel.appendLine('No relationships found.');
        } else {
          relationships.forEach(rel => {
            outputChannel.appendLine(`[${rel.type}] ${rel.fromName} (${vscode.workspace.asRelativePath(rel.from.uri)}:${rel.from.range.start.line}) -> ${rel.toName} (${vscode.workspace.asRelativePath(rel.to.uri)}:${rel.to.range.start.line})`);
          });
        }
      } catch (err) {
        outputChannel.appendLine(`Error during analysis: ${err}`);
      }

      outputChannel.appendLine('--- Analysis Finished ---');
    })
  );

  // ---------- Workspace / scoped / incremental analysis ----------
  type RunAnalysisOptions = {
    scope?: vscode.GlobPattern;
    /** When provided, skip workspace scanning and only re-analyse these files (incremental path). */
    incrementalFiles?: string[];
    /**
     * Subset of `incrementalFiles` representing the files the user actually
     * saved (vs caller-expanded). Used by mergeIncremental to decide which
     * incoming edges to drop vs preserve. When omitted the whole
     * incrementalFiles set is treated as originally-changed.
     */
    originallyChangedFiles?: string[];
  };

  const persistCache = async (root: vscode.Uri) => {
    const entry = cache.current;
    if (!entry) return;
    const dir = vscode.Uri.joinPath(root, '.codetrace');
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(dir, ANALYSIS_CACHE_FILE);
    const payload = {
      timestamp: entry.timestamp,
      isFullWorkspaceSnapshot: entry.isFullWorkspaceSnapshot,
      nodes: entry.graph.nodes,
      edges: entry.graph.edges,
    };
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
  };

  const runAnalysis = async (options: RunAnalysisOptions = {}) => {
    const { scope, incrementalFiles, originallyChangedFiles } = options;
    const isIncremental = !!incrementalFiles && incrementalFiles.length > 0;
    const isScoped = !!scope;

    if (!isIncremental) {
      outputChannel.show();
    }
    outputChannel.appendLine(`--- Analysis Started${isIncremental ? ' (incremental)' : ''} ---`);

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        outputChannel.appendLine('Error: No workspace folders open.');
        return;
      }

      const rootUri = workspaceFolders[0].uri;
      const rootPath = rootUri.fsPath;
      let limitToFiles: string[] | undefined = undefined;

      if (isIncremental) {
        limitToFiles = incrementalFiles;
        outputChannel.appendLine(`Incremental scope: ${limitToFiles.length} file(s)`);
      } else if (scope) {
        outputChannel.appendLine(`Scope: ${scope.toString()}`);
        const uris = await vscode.workspace.findFiles(scope);
        limitToFiles = uris.map(u => u.fsPath);
        outputChannel.appendLine(`Resolved ${limitToFiles.length} files in scope.`);
      }

      setStatus(isIncremental ? `재분석 (${limitToFiles?.length})` : '분석 중', true);

      const rawResult = isIncremental
        ? await extractWorkspaceCallGraph(rootPath, { searchParentTsconfig: true, limitToFiles })
        : await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'CodeTrace: Analyzing Workspace...',
            cancellable: true
          }, async (progress) => {
            progress.report({ message: 'Initializing hybrid analyzer...' });
            return await extractWorkspaceCallGraph(rootPath, {
              searchParentTsconfig: true,
              limitToFiles
            });
          });

      if (!rawResult) {
        setStatus('Idle');
        return;
      }

      const baseRef = getConfiguredGitBaseBranch();
      const changes = await collectChangedLineRanges(rootPath, baseRef);
      const markedNodes = markChangedFunctions(rawResult.nodes, changes.ranges);
      const changedNodeCount = markedNodes.filter(node => node.changedSinceBase).length;
      const result = {
        ...rawResult,
        nodes: markedNodes,
        metadata: {
          engine: rawResult.metadata?.engine ?? 'Unknown',
          language: rawResult.metadata?.language ?? 'Unknown',
          precision: rawResult.metadata?.precision ?? 'standard',
          gitBaseRef: changes.baseRef,
          changedNodeCount,
          warnings: changes.unavailableReason
            ? [...(rawResult.metadata?.warnings ?? []), changes.unavailableReason]
            : rawResult.metadata?.warnings,
        },
      };

      const removedNodeIds = await readRemovedNodeIds(rootPath);
      const visibleResult = filterRemovedNodes(result, removedNodeIds);

      if (!isIncremental && visibleResult.nodes.length === 0 && visibleResult.edges.length === 0) {
        outputChannel.appendLine('No symbols or relationships found.');
        setStatus('No symbols');
        return;
      }

      outputChannel.appendLine(
        `Changed nodes vs ${result.metadata.gitBaseRef ?? baseRef}: ${result.metadata.changedNodeCount}.`,
      );
      for (const warning of result.metadata.warnings ?? []) {
        outputChannel.appendLine(`Warning: ${warning}`);
      }

      // Update cache: incremental merges, full analysis replaces.
      // Both the watcher input (document.uri.fsPath) and the analyzer output
      // (path.normalize / uri.fsPath) are absolute, platform-normalized paths,
      // so direct string comparison works. See cache test
      // "matches file paths exactly between watcher input and analyzer output".
      let nextSnapshot: CallGraphSnapshot;
      if (isIncremental) {
        const dirtySet = new Set(incrementalFiles!);
        const changedSet = originallyChangedFiles
          ? new Set(originallyChangedFiles)
          : undefined;
        nextSnapshot = cache.mergeIncremental(
          dirtySet,
          { nodes: visibleResult.nodes, edges: visibleResult.edges },
          changedSet,
        );
      } else {
        nextSnapshot = cache.set(
          rootPath,
          { nodes: visibleResult.nodes, edges: visibleResult.edges },
          { isFullWorkspaceSnapshot: !isScoped },
        ).graph;
      }

      if (removedNodeIds.size > 0) {
        const filteredSnapshot = filterRemovedNodes(nextSnapshot, removedNodeIds);
        if (
          filteredSnapshot.nodes.length !== nextSnapshot.nodes.length ||
          filteredSnapshot.edges.length !== nextSnapshot.edges.length
        ) {
          nextSnapshot = cache.set(
            rootPath,
            filteredSnapshot,
            { isFullWorkspaceSnapshot: cache.current?.isFullWorkspaceSnapshot ?? !isScoped },
          ).graph;
        }
        outputChannel.appendLine(`Filtered ${removedNodeIds.size} removed graph nodes from .codetrace/removed.log.`);
      }

      outputChannel.appendLine(`Analysis ${isIncremental ? 'incrementally merged' : 'complete'} using ${result.metadata?.engine} (${result.metadata?.precision}). Cache: ${nextSnapshot.nodes.length} nodes / ${nextSnapshot.edges.length} edges.`);

      await persistCache(rootUri);

      CanvasEditorProvider.broadcast({
        type: 'analysis',
        payload: { nodes: nextSnapshot.nodes, edges: nextSnapshot.edges },
      });

      setStatus(`${nextSnapshot.nodes.length} nodes (${new Date().toLocaleTimeString()})`);

      if (!isIncremental && visibleResult.edges.length > 0) {
        outputChannel.appendLine('\nDetected Relationships (Preview):');
        visibleResult.edges.slice(0, 50).forEach(edge => {
          const fromNode = visibleResult.nodes.find(n => n.id === edge.from);
          const toNode = visibleResult.nodes.find(n => n.id === edge.to);
          outputChannel.appendLine(`[call] ${fromNode?.name || 'unknown'} -> ${toNode?.name || 'unknown'}`);
        });
        if (visibleResult.edges.length > 50) {
          outputChannel.appendLine('... (truncated for output channel)');
        }
      }
    } catch (err) {
      if (err instanceof vscode.CancellationError) {
        outputChannel.appendLine('Analysis cancelled by user.');
        setStatus('Cancelled');
      } else {
        outputChannel.appendLine(`Error during analysis: ${err}`);
        setStatus('Error');
      }
      return;
    }

    outputChannel.appendLine(`--- Analysis Finished${isIncremental ? ' (incremental)' : ''} ---`);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.analyzeWorkspace', () => runAnalysis())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.analyzeScoped', async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: '분석할 폴더 또는 파일 선택'
        });
        if (selected && selected.length > 0) {
          targetUri = selected[0];
        }
      }

      if (targetUri) {
        const relativePath = vscode.workspace.asRelativePath(targetUri);
        const isFile = (await vscode.workspace.fs.stat(targetUri)).type === vscode.FileType.File;
        const pattern = isFile ? relativePath : `${relativePath}/**/*.{ts,tsx,js,jsx,py,java,go}`;
        await runAnalysis({ scope: pattern });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.refreshAnalysis', async () => {
      cache.invalidate();
      outputChannel.appendLine('Cache invalidated; running full re-analysis.');
      await runAnalysis();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.newCanvas', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('CodeTrace: 워크스페이스를 먼저 열어주세요.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: '캔버스 이름을 입력하세요',
        value: 'canvas',
        validateInput: (v: string) => (v.trim() ? null : '이름을 입력해주세요'),
      });
      if (!name) return;

      const dir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.codetrace', 'canvases');
      await vscode.workspace.fs.createDirectory(dir);

      const file = vscode.Uri.joinPath(dir, `${name.trim()}.codetrace`);
      const initial = `${JSON.stringify(
        {
          version: 2,
          elements: [],
          appState: {
            collaborators: {}
          }
        },
        null,
        2
      )}\n`;
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(initial));

      await vscode.commands.executeCommand('vscode.openWith', file, CanvasEditorProvider.viewType);
    })
  );

  // ---------- Save watcher: coalesce dirty files, run incremental analysis ----------
  const pendingDirty = new Set<string>();
  let debounceHandle: NodeJS.Timeout | undefined;

  const flushDirty = async () => {
    if (pendingDirty.size === 0) return;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return;

    // Wait for hydrate to settle before deciding incremental vs full.
    // Otherwise a save firing during activate would skip the persisted cache
    // and seed the in-memory cache from a single-file partial graph.
    await hydrateDone;

    const changed = [...pendingDirty];
    pendingDirty.clear();

    // No usable baseline cache (fresh workspace, hydrate found no file, the
    // user invalidated, or the current snapshot is from a scoped analysis):
    // partial analysis would persist a single-file or scope-only graph as the
    // canonical snapshot. Run a full workspace analysis instead.
    const baseline = cache.current;
    if (!baseline || !baseline.isFullWorkspaceSnapshot) {
      const reason = !baseline ? 'cache is empty' : 'baseline is scoped';
      outputChannel.appendLine(`onDidSave: ${changed.length} changed but ${reason} — running full analysis.`);
      await runAnalysis();
      return;
    }

    // Expand to include callers via the cached graph.
    // v1: absolute file paths flow straight through (no normalisation indirection).
    // Multi-root: only the first workspace folder is watched; expand here when needed.
    const dirtyFiles = [...cache.computeDirtyFiles(changed)];
    outputChannel.appendLine(`onDidSave: ${changed.length} changed -> ${dirtyFiles.length} files to re-analyse (callers expanded).`);
    await runAnalysis({ incrementalFiles: dirtyFiles, originallyChangedFiles: changed });
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!ANALYSABLE_LANGS.has(document.languageId)) return;
      if (document.uri.scheme !== 'file') return;
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) return;
      // Skip files that are not under the workspace root.
      if (!document.uri.fsPath.startsWith(root.fsPath)) return;

      pendingDirty.add(document.uri.fsPath);
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        debounceHandle = undefined;
        void flushDirty();
      }, SAVE_DEBOUNCE_MS);
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      if (debounceHandle) clearTimeout(debounceHandle);
    },
  });
}

export function deactivate() {}
