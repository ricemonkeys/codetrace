import * as vscode from 'vscode';

export class CanvasEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'codetrace.canvasEditor';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      CanvasEditorProvider.viewType,
      new CanvasEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    webviewPanel.webview.html = await this._getHtml(webviewPanel.webview);

    // document → webview
    const pushContent = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        content: document.getText(),
      });
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        pushContent();
      }
    });

    webviewPanel.onDidDispose(() => changeSubscription.dispose());

    // webview → document
    webviewPanel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'save') {
        this._updateDocument(document, msg.content);
      }
    });

    pushContent();
  }

  private _updateDocument(document: vscode.TextDocument, content: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      content,
    );
    return vscode.workspace.applyEdit(edit);
  }

  private async _getHtml(webview: vscode.Webview): Promise<string> {
    const nonce = this._nonce();
    
    // dist/webview/assets 폴더에서 JS 및 CSS 파일 찾기
    const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets');
    const files = await vscode.workspace.fs.readDirectory(assetsRoot);
    const scriptFile = files.find(([name]) => name.endsWith('.js'))?.[0];
    const cssFile = files.find(([name]) => name.endsWith('.css'))?.[0];
    
    if (!scriptFile) {
      return '<h1>Error: Webview bundle not found</h1>';
    }

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, scriptFile));
    const cssUri = cssFile ? webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, cssFile)) : '';

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://unpkg.com`,
      `script-src 'nonce-${nonce}' ${webview.cspSource} https://unpkg.com 'unsafe-eval'`,
      `img-src ${webview.cspSource} data: blob: https://unpkg.com`,
      `font-src ${webview.cspSource} https://unpkg.com`,
      `connect-src ${webview.cspSource} https://unpkg.com`,
      `worker-src blob:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeTrace Canvas</title>
  ${cssUri ? `<link rel="stylesheet" href="${cssUri}">` : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100vh; overflow: hidden; background-color: #fff; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // 초기 데이터 수신 대기
    window.addEventListener('message', event => {
      const { type, content } = event.data;
      if (type === 'update') {
        window.__codetrace_initialContent = content;
        if (window.__codetrace_onUpdate) {
          window.__codetrace_onUpdate(content);
        }
      }
    });

    window.__codetrace_save = (content) => {
      vscode.postMessage({ type: 'save', content });
    };
  </script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}
