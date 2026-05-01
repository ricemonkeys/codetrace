import * as vscode from 'vscode';
import { buildAnalysisMessage } from './buildAnalysisMessage';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from './messages';

export class CallGraphPanel {
  static readonly viewType = 'codetrace.callGraph';
  private static current: CallGraphPanel | undefined;

  /**
   * Creates the panel if needed, then analyzes `targetUri`. Pass the URI
   * captured at command-invocation time — once the webview takes focus,
   * `vscode.window.activeTextEditor` becomes undefined, so reading it later
   * (e.g., on Refresh from the webview) loses the analysis target.
   */
  static async createOrShow(
    context: vscode.ExtensionContext,
    targetUri: vscode.Uri | undefined,
  ): Promise<CallGraphPanel> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CallGraphPanel.current) {
      CallGraphPanel.current.panel.reveal(column);
      await CallGraphPanel.current.analyze(targetUri);
      return CallGraphPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      CallGraphPanel.viewType,
      'CodeTrace Call Graph',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      },
    );

    const instance = new CallGraphPanel(panel, context, targetUri);
    CallGraphPanel.current = instance;
    return instance;
  }

  private lastAnalyzedUri: vscode.Uri | undefined;
  // Webview message listener mounts asynchronously after HTML loads. Delivering
  // analysisResult before then would silently drop the first render. We hold
  // the latest target URI and flush it once the webview signals webviewReady.
  private webviewReady = false;
  private pendingTargetUri: vscode.Uri | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    initialTargetUri: vscode.Uri | undefined,
  ) {
    this.lastAnalyzedUri = initialTargetUri;
    this.pendingTargetUri = initialTargetUri;

    this.panel.onDidDispose(() => {
      if (CallGraphPanel.current === this) {
        CallGraphPanel.current = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'webviewReady') {
        this.webviewReady = true;
        const target = this.pendingTargetUri;
        this.pendingTargetUri = undefined;
        await this.analyze(target);
      } else if (msg.type === 'requestRefresh') {
        // Reuse the URI captured at command time; activeTextEditor is unreliable
        // because the webview itself is focused when the user clicks Refresh.
        await this.analyze(this.lastAnalyzedUri);
      } else if (msg.type === 'nodeClick') {
        // Navigation lands in #51; for now just ignore.
        return;
      }
    });

    this.bootstrap().catch(err => {
      console.error('CodeTrace: failed to load call graph webview', err);
    });
  }

  /**
   * Analyze a specific URI and post the result. If the webview hasn't reported
   * `webviewReady` yet, the target is queued and flushed once the listener is
   * mounted; otherwise the message is posted immediately. `uri === undefined`
   * means "reuse the last captured target" (e.g., Refresh from webview).
   */
  async analyze(uri: vscode.Uri | undefined): Promise<void> {
    if (uri) {
      this.lastAnalyzedUri = uri;
    }

    if (!this.webviewReady) {
      // Defer until the webview reports it is ready.
      this.pendingTargetUri = uri ?? this.pendingTargetUri ?? this.lastAnalyzedUri;
      return;
    }

    const target = uri ?? this.lastAnalyzedUri;
    if (!target) {
      this.post({
        type: 'analysisError',
        message: '분석할 파일이 없습니다. 파일을 열고 Open Call Graph를 다시 실행하세요.',
      });
      return;
    }

    this.post(await buildAnalysisMessage(target.fsPath));
  }

  private async bootstrap(): Promise<void> {
    try {
      this.panel.webview.html = await this.getHtml();
    } catch (error) {
      console.error('CodeTrace: failed to load call graph webview assets', error);
      this.panel.webview.html = this.getFallbackHtml(
        'CodeTrace webview build is missing. Run `npm run build --workspace=frontend` and reopen the call graph.',
      );
      vscode.window.showErrorMessage(
        'CodeTrace: webview build is missing. Run `npm run build --workspace=frontend`.',
      );
      return;
    }
    // Do NOT post analysis here. The webview will send `webviewReady` once its
    // message listener is attached, and the handler above flushes the queued
    // target then.
  }

  private post(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  private async getHtml(): Promise<string> {
    const nonce = randomNonce();
    const webview = this.panel.webview;
    const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const indexUri = vscode.Uri.joinPath(webviewRoot, 'callgraph.html');
    const html = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');

    return rewriteWebviewUris(html, webview, webviewRoot)
      .replace(
        '<head>',
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
      .replace(/<script(\s)/g, `<script nonce="${nonce}"$1`)
      .replace(
        '<body>',
        `<body>\n  <script nonce="${nonce}">window.__codetrace_vscode = acquireVsCodeApi();</script>`,
      );
  }

  private getFallbackHtml(message: string): string {
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`].join('; ');
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>CodeTrace Call Graph</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#1f2937;}code{background:#eef2ff;padding:2px 6px;border-radius:4px;}</style>
</head><body><h2>CodeTrace Call Graph</h2><p>${escapeHtml(message)}</p><p><code>npm run build --workspace=frontend</code></p></body></html>`;
  }
}

function rewriteWebviewUris(html: string, webview: vscode.Webview, webviewRoot: vscode.Uri): string {
  return html.replace(/\b(src|href)="([^"]+)"/g, (_match, attribute: string, resourcePath: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(resourcePath)) {
      return `${attribute}="${resourcePath}"`;
    }
    const normalizedPath = resourcePath.replace(/^\.?\//, '').replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.startsWith('..')) {
      return `${attribute}="${resourcePath}"`;
    }
    const resourceUri = vscode.Uri.joinPath(webviewRoot, ...normalizedPath.split('/'));
    return `${attribute}="${webview.asWebviewUri(resourceUri)}"`;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
