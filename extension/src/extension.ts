import * as vscode from 'vscode';
import { CanvasEditorProvider } from './CanvasEditorProvider';
import { CodeAnalyzer } from './CodeAnalyzer';

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
    if (scope) {
      outputChannel.appendLine(`Scope: ${scope.toString()}`);
    }

    try {
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'CodeTrace: Analyzing Workspace...',
        cancellable: true
      }, async (progress, token) => {
        return await analyzer.analyzeWorkspace(
          scope, 
          (msg, increment) => {
            outputChannel.appendLine(`> ${msg}`);
            if (increment) {
              progress.report({ message: msg, increment });
            } else {
              progress.report({ message: msg });
            }
          },
          token
        );
      });

      if (!result) return;

      if (result.symbols.length === 0 && result.relationships.length === 0) {
        outputChannel.appendLine('No symbols or relationships found in the specified scope.');
        return;
      }

      outputChannel.appendLine(`Analysis complete! Found ${result.symbols.length} symbols and ${result.relationships.length} relationships.`);
      
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        const dir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.codetrace');
        await vscode.workspace.fs.createDirectory(dir);
        const fileName = scope ? `analysis_${Date.now()}.json` : 'analysis_result.json';
        const file = vscode.Uri.joinPath(dir, fileName);
        
        const outputData = {
          timestamp: new Date().toISOString(),
          scope: scope ? scope.toString() : 'workspace',
          summary: {
            totalSymbols: result.symbols.length,
            totalRelationships: result.relationships.length
          },
          symbols: result.symbols.map(s => ({
            name: s.name,
            kind: vscode.SymbolKind[s.kind],
            uri: vscode.workspace.asRelativePath(s.uri),
            range: s.range
          })),
          relationships: result.relationships.map(rel => ({
            type: rel.type,
            from: {
              name: rel.fromName,
              uri: vscode.workspace.asRelativePath(rel.from.uri),
              range: rel.from.range
            },
            to: {
              name: rel.toName,
              uri: vscode.workspace.asRelativePath(rel.to.uri),
              range: rel.to.range
            }
          }))
        };

        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(outputData, null, 2)));
        outputChannel.appendLine(`\nFull analysis result saved to: ${vscode.workspace.asRelativePath(file)}`);
      }

      if (result.relationships.length > 0) {
        outputChannel.appendLine('\nDetected Relationships (Preview):');
        result.relationships.slice(0, 50).forEach(rel => {
          outputChannel.appendLine(`[${rel.type}] ${rel.fromName} -> ${rel.toName}`);
        });
        if (result.relationships.length > 50) {
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

      const dir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.codetrace');
      await vscode.workspace.fs.createDirectory(dir);

      const file = vscode.Uri.joinPath(dir, `${name.trim()}.codetrace`);
      const initial = JSON.stringify({ version: 1, elements: [], appState: {} }, null, 2);
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(initial));

      await vscode.commands.executeCommand('vscode.openWith', file, CanvasEditorProvider.viewType);
    })
  );
}

export function deactivate() {}
