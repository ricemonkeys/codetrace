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

    webviewPanel.webview.html = await this._getHtml(webviewPanel.webview, document.getText());

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

    // webview → document
    const saveSubscription = webviewPanel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'save' && typeof msg.content === 'string') {
        await this._updateDocument(document, msg.content);
      } else if (msg.type === 'saveFile' && typeof msg.content === 'string') {
        await this._updateDocument(document, msg.content);
        await document.save();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      saveSubscription.dispose();
    });

    pushContent();
  }

  private async _updateDocument(document: vscode.TextDocument, content: string) {
    if (document.getText() === content) return;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      content,
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async _getHtml(webview: vscode.Webview, initialContent: string): Promise<string> {
    const nonce = this._nonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    const indexUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'index.html');
    const html = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));

    return this._rewriteWebviewUris(html, webview)
      .replace(
        '<head>',
        `<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
      .replace(/<script(\s)/g, `<script nonce="${nonce}"$1`)
      .replace(
        '<body>',
        `<body>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    window.__codetrace_initialContent = ${this._scriptString(initialContent)};

    window.addEventListener('message', event => {
      const { type, content } = event.data ?? {};
      if (type === 'update' && typeof content === 'string') {
        window.__codetrace_initialContent = content;
        if (window.__codetrace_onUpdate) window.__codetrace_onUpdate(content);
      }
    });

    window.__codetrace_save = (content) => {
      vscode.postMessage({ type: 'save', content });
    };

    window.__codetrace_saveFile = (content) => {
      vscode.postMessage({ type: 'saveFile', content });
    };
  </script>
`,
      );
  }

  private _rewriteWebviewUris(html: string, webview: vscode.Webview): string {
    const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');

    return html.replace(/\b(src|href)="\/([^"]+)"/g, (_match, attribute: string, resourcePath: string) => {
      const resourceUri = vscode.Uri.joinPath(webviewRoot, ...resourcePath.split('/'));
      return `${attribute}="${webview.asWebviewUri(resourceUri)}"`;
    });
  }

  private _scriptString(value: string): string {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  private _nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}
