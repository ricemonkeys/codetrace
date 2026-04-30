import * as vscode from 'vscode';
import { CanvasEditorProvider } from './CanvasEditorProvider';

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
      const initial = JSON.stringify({ 
        version: 1, 
        elements: [], 
        appState: { 
          collaborators: {} 
        } 
      }, null, 2);
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(initial));

      await vscode.commands.executeCommand('vscode.openWith', file, CanvasEditorProvider.viewType);
    })
  );
}

export function deactivate() {}
