import * as vscode from 'vscode';
import { extractCallGraph } from '../analyzer/callGraph';
import type { CallGraph } from '../analyzer/types';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from './messages';

export class CallGraphPanel {
  static readonly viewType = 'codetrace.callGraph';
  private static current: CallGraphPanel | undefined;

  static createOrShow(context: vscode.ExtensionContext): CallGraphPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CallGraphPanel.current) {
      CallGraphPanel.current.panel.reveal(column);
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

    CallGraphPanel.current = new CallGraphPanel(panel, context);
    return CallGraphPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel.onDidDispose(() => {
      if (CallGraphPanel.current === this) {
        CallGraphPanel.current = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'requestRefresh') {
        await this.analyzeAndPost();
      } else if (msg.type === 'nodeClick') {
        // Navigation lands in #51; for now just ignore.
        return;
      }
    });

    this.bootstrap().catch(err => {
      console.error('CodeTrace: failed to load call graph webview', err);
    });
  }

  async analyzeActiveFile(): Promise<void> {
    await this.analyzeAndPost();
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

    await this.analyzeAndPost();
  }

  private async analyzeAndPost(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.post({ type: 'analysisError', message: '활성 에디터가 없습니다. .ts 파일을 열고 다시 시도하세요.' });
      return;
    }

    const fsPath = editor.document.uri.fsPath;
    if (!/\.(ts|tsx)$/.test(fsPath)) {
      this.post({ type: 'analysisError', message: 'TypeScript 파일(.ts, .tsx)만 분석할 수 있습니다.' });
      return;
    }

    let graph: CallGraph;
    try {
      graph = extractCallGraph(fsPath);
    } catch (err) {
      this.post({
        type: 'analysisError',
        message: `분석 중 오류: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    this.post({ type: 'analysisResult', graph });
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
