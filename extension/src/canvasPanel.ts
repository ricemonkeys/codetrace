import * as vscode from 'vscode';

export class CanvasPanel {
  static currentPanel: CanvasPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;

    if (CanvasPanel.currentPanel) {
      CanvasPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codetraceCanvas',
      'CodeTrace Canvas',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      }
    );

    CanvasPanel.currentPanel = new CanvasPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => {
      CanvasPanel.currentPanel = undefined;
    });
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeTrace Canvas</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
  }
}
