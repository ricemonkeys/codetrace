import * as vscode from 'vscode';
import { extractWorkspaceCallGraph } from './analyzer/callGraph';
import { CallGraphPanel } from './callGraph/CallGraphPanel';
import { CanvasEditorProvider } from './CanvasEditorProvider';
import { CodeAnalyzer } from './CodeAnalyzer';
import { getStaleStatusesForPath, parseCanvasCodeCards } from './staleDetection';
import { generateUlid } from './ulid';


export function activate(context: vscode.ExtensionContext) {
  const analyzer = new CodeAnalyzer();
  const outputChannel = vscode.window.createOutputChannel('CodeTrace Analysis');
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(CanvasEditorProvider.register(context));
  context.subscriptions.push(registerStaleDetection());

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.openCallGraph', async () => {
      // Capture the active editor's URI BEFORE creating/revealing the webview.
      // Once the panel takes focus, vscode.window.activeTextEditor becomes
      // undefined and we'd lose the analysis target.
      const targetUri = vscode.window.activeTextEditor?.document.uri;
      await CallGraphPanel.createOrShow(context, targetUri);
    }),
  );

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
        return await extractWorkspaceCallGraph(rootPath, {
          searchParentTsconfig: true,
          limitToFiles
        });
      });

      if (!result) return;

      if (result.nodes.length === 0 && result.edges.length === 0) {
        outputChannel.appendLine('No symbols or relationships found.');
        return;
      }

      outputChannel.appendLine(`Analysis complete using ${result.metadata?.engine} (${result.metadata?.precision})!`);
      outputChannel.appendLine(`Found ${result.nodes.length} nodes and ${result.edges.length} edges.`);
      
      const dir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.codetrace');
      await vscode.workspace.fs.createDirectory(dir);
      const fileName = scope ? `analysis_${Date.now()}.json` : 'analysis_result.json';
      const file = vscode.Uri.joinPath(dir, fileName);
      
      const outputData = {
        timestamp: new Date().toISOString(),
        metadata: result.metadata,
        nodes: result.nodes,
        edges: result.edges
      };

      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(outputData, null, 2)));
      outputChannel.appendLine(`\nFull analysis result saved to: ${vscode.workspace.asRelativePath(file)}`);

      if (result.edges.length > 0) {
        outputChannel.appendLine('\nDetected Relationships (Preview):');
        result.edges.slice(0, 50).forEach(edge => {
          const fromNode = result.nodes.find(n => n.id === edge.from);
          const toNode = result.nodes.find(n => n.id === edge.to);
          outputChannel.appendLine(`[call] ${fromNode?.name || 'unknown'} -> ${toNode?.name || 'unknown'}`);
        });
        if (result.edges.length > 50) {
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

  context.subscriptions.push(
    vscode.commands.registerCommand('codetrace.addSelectionToCanvas', async (_, editors?: vscode.TextEditor[]) => {
      const editor = (editors && editors.length > 0 ? editors[0] : null) ?? vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('CodeTrace: 활성 에디터가 없습니다.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showErrorMessage('CodeTrace: 선택된 텍스트가 없습니다.');
        return;
      }

      const panel = CanvasEditorProvider.getActivePanel();
      if (!panel) {
        vscode.window.showErrorMessage('CodeTrace: 열린 캔버스가 없습니다. 먼저 .codetrace 파일을 열어주세요.');
        return;
      }

      const uri = editor.document.uri;
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('CodeTrace: 워크스페이스 외부 파일은 캔버스에 추가할 수 없습니다.');
        return;
      }

      const absolutePath = uri.fsPath;
      const workspacePath = workspaceFolder.uri.fsPath;
      const relativePath = absolutePath
        .slice(workspacePath.length)
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/');

      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      const lines: string[] = [];
      for (let i = selection.start.line; i <= selection.end.line; i++) {
        lines.push(editor.document.lineAt(i).text);
      }
      const snapshot = lines.join('\n');

      const card = {
        id: generateUlid(),
        file: { path: relativePath },
        range: { startLine, endLine },
        snapshot,
        language: editor.document.languageId,
        customData: {},
      };

      panel.webview.postMessage({ type: 'addCard', card });
    })
  );
}

function registerStaleDetection(): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument(event => {
    const filePath = getWorkspaceRelativePosixPath(event.document.uri);
    if (!filePath) return;

    const currentLines = getDocumentLines(event.document);
    CanvasEditorProvider.getOpenCanvasDocuments().forEach(document => {
      const statuses = getStaleStatusesForPath(
        parseCanvasCodeCards(document.getText()),
        filePath,
        currentLines,
      );

      CanvasEditorProvider.postStaleStatuses(document, statuses);
    });
  });
}

function getWorkspaceRelativePosixPath(uri: vscode.Uri): string | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) return undefined;

  return uri.fsPath
    .slice(workspaceFolder.uri.fsPath.length)
    .replace(/^[/\\]/, '')
    .replace(/\\/g, '/');
}

function getDocumentLines(document: vscode.TextDocument): string[] {
  return Array.from({ length: document.lineCount }, (_value, index) => document.lineAt(index).text);
}

export function deactivate() {}
