import * as vscode from 'vscode';
import { extractWorkspaceCallGraph } from './analyzer/callGraph';
import { CanvasEditorProvider } from './CanvasEditorProvider';
import { CodeAnalyzer } from './CodeAnalyzer';
import { markChangedFunctions } from './git/changedRanges';
import { collectChangedLineRanges, getConfiguredGitBaseBranch } from './git/vscodeGit';
import { filterRemovedNodes, readRemovedNodeIds } from './removedNodes';


export function activate(context: vscode.ExtensionContext) {
  const analyzer = new CodeAnalyzer();
  const outputChannel = vscode.window.createOutputChannel('CodeTrace Analysis');
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(CanvasEditorProvider.register(context));

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

  const runAnalysis = async (scope?: vscode.GlobPattern) => {
    outputChannel.show();
    outputChannel.appendLine('--- Analysis Started ---');
    
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        outputChannel.appendLine('Error: No workspace folders open.');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      let limitToFiles: string[] | undefined = undefined;

      if (scope) {
        outputChannel.appendLine(`Scope: ${scope.toString()}`);
        const uris = await vscode.workspace.findFiles(scope);
        limitToFiles = uris.map(u => u.fsPath);
        outputChannel.appendLine(`Resolved ${limitToFiles.length} files in scope.`);
      }

      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'CodeTrace: Analyzing Workspace...',
        cancellable: true
      }, async (progress, token) => {
        progress.report({ message: 'Initializing hybrid analyzer...' });
        const graph = await extractWorkspaceCallGraph(rootPath, {
          searchParentTsconfig: true,
          limitToFiles
        });
        progress.report({ message: 'Checking Git changes...' });
        const baseRef = getConfiguredGitBaseBranch();
        const changes = await collectChangedLineRanges(rootPath, baseRef);
        const nodes = markChangedFunctions(graph.nodes, changes.ranges);
        const changedNodeCount = nodes.filter(node => node.changedSinceBase).length;

        return {
          ...graph,
          nodes,
          metadata: {
            engine: graph.metadata?.engine ?? 'Unknown',
            language: graph.metadata?.language ?? 'Unknown',
            precision: graph.metadata?.precision ?? 'standard',
            gitBaseRef: changes.baseRef,
            changedNodeCount,
            warnings: changes.unavailableReason
              ? [...(graph.metadata?.warnings ?? []), changes.unavailableReason]
              : graph.metadata?.warnings,
          },
        };
      });

      if (!result) return;

      const removedNodeIds = await readRemovedNodeIds(rootPath);
      const visibleResult = filterRemovedNodes(result, removedNodeIds);

      if (visibleResult.nodes.length === 0 && visibleResult.edges.length === 0) {
        outputChannel.appendLine('No symbols or relationships found.');
        return;
      }

      outputChannel.appendLine(`Analysis complete using ${result.metadata?.engine} (${result.metadata?.precision})!`);
      outputChannel.appendLine(`Found ${visibleResult.nodes.length} nodes and ${visibleResult.edges.length} edges.`);
      if (removedNodeIds.size > 0) {
        outputChannel.appendLine(`Filtered ${removedNodeIds.size} removed graph nodes from .codetrace/removed.log.`);
      }
      outputChannel.appendLine(
        `Changed nodes vs ${result.metadata?.gitBaseRef ?? getConfiguredGitBaseBranch()}: ${result.metadata?.changedNodeCount ?? 0}.`,
      );
      for (const warning of result.metadata?.warnings ?? []) {
        outputChannel.appendLine(`Warning: ${warning}`);
      }
      
      const dir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.codetrace');
      await vscode.workspace.fs.createDirectory(dir);
      const file = vscode.Uri.joinPath(dir, 'analysis_cache.json');

      const outputData = {
        timestamp: new Date().toISOString(),
        scope: scope ? scope.toString() : null,
        metadata: visibleResult.metadata,
        nodes: visibleResult.nodes,
        edges: visibleResult.edges
      };

      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(outputData, null, 2)));
      outputChannel.appendLine(`\nFull analysis result saved to: ${vscode.workspace.asRelativePath(file)}`);

      CanvasEditorProvider.broadcast({
        type: 'analysis',
        payload: { nodes: visibleResult.nodes, edges: visibleResult.edges },
      });

      if (visibleResult.edges.length > 0) {
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
      } else {
        outputChannel.appendLine(`Error during analysis: ${err}`);
      }
      return;
    }

    outputChannel.appendLine('--- Analysis Finished ---');
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
        await runAnalysis(pattern);
      }
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
          version: 1, 
          elements: [], 
          cards: [], 
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
}

export function deactivate() {}
