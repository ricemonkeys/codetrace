import * as vscode from 'vscode';
import { CanvasEditorProvider } from './CanvasEditorProvider';
import { generateUlid } from './ulid';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(CanvasEditorProvider.register(context));

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
    vscode.commands.registerCommand('codetrace.addSelectionToCanvas', async () => {
      const editor = vscode.window.activeTextEditor;
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

export function deactivate() {}
