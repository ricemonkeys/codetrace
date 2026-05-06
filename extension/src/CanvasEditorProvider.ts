import * as vscode from 'vscode';
import * as path from 'path';

import {
  loadReviewStickies,
  persistReviewSticky,
  removeReviewStickyArtifacts,
  type PersistReviewStickyInput,
} from './reviews/reviewRoundTrip';
import {
  analyzeNodeDeletionImpact,
  appendRemovedNodeLog,
  type DeletionImpactRequest,
  type RemovedNodeLogEntry,
} from './removedNodes';

export class CanvasEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'codetrace.canvasEditor';

  private static readonly activePanels = new Set<vscode.WebviewPanel>();

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

  static broadcast(message: unknown): void {
    for (const panel of CanvasEditorProvider.activePanels) {
      panel.webview.postMessage(message);
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const workspaceRoot = this._getWorkspaceRoot(document);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    let reviewStickies: unknown[] = [];
    if (workspaceRoot) {
      try {
        reviewStickies = await loadReviewStickies(workspaceRoot);
      } catch (error) {
        console.error('CodeTrace: failed to load review stickies', error);
        vscode.window.showWarningMessage('CodeTrace: failed to load review stickies for this canvas.');
      }
    }

    try {
      webviewPanel.webview.html = await this._getHtml(
        webviewPanel.webview,
        document.getText(),
        reviewStickies,
      );
    } catch (error) {
      console.error('CodeTrace: failed to load webview assets', error);
      webviewPanel.webview.html = this._getFallbackHtml(
        'CodeTrace webview build is missing. Run npm run build --workspace=frontend and reopen this file.',
      );
      vscode.window.showErrorMessage(
        'CodeTrace: webview build is missing. Run npm run build --workspace=frontend.',
      );
    }

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

    const saveSubscription = webviewPanel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'save' && typeof msg.content === 'string') {
        await this._updateDocument(document, msg.content);
      } else if (msg.type === 'saveFile' && typeof msg.content === 'string') {
        await this._updateDocument(document, msg.content);
        await document.save();
      } else if (isReviewStickyCommitMessage(msg)) {
        if (!workspaceRoot) {
          vscode.window.showWarningMessage('CodeTrace: open a workspace before saving review stickies.');
          return;
        }
        try {
          await persistReviewSticky(workspaceRoot, msg.review);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`CodeTrace: failed to save review sticky. ${message}`);
        }
      } else if (isGraphNodeDeletionImpactMessage(msg)) {
        if (!workspaceRoot) {
          webviewPanel.webview.postMessage({
            type: 'graphNode:deletionImpact',
            response: { requestId: msg.request.requestId, node: msg.request.node, impacts: [] },
          });
          return;
        }
        try {
          const response = await analyzeNodeDeletionImpact(workspaceRoot, msg.request);
          webviewPanel.webview.postMessage({ type: 'graphNode:deletionImpact', response });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`CodeTrace: failed to analyze node deletion. ${message}`);
          webviewPanel.webview.postMessage({
            type: 'graphNode:deletionImpact',
            response: { requestId: msg.request.requestId, node: msg.request.node, impacts: [] },
          });
        }
      } else if (isGraphNodeRemovalConfirmMessage(msg)) {
        if (!workspaceRoot) {
          vscode.window.showWarningMessage('CodeTrace: open a workspace before logging removed graph nodes.');
          return;
        }
        try {
          await removeReviewStickyArtifacts(workspaceRoot, msg.entry.stickyReviewIds ?? []);
          await appendRemovedNodeLog(workspaceRoot, msg.entry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`CodeTrace: failed to write removed.log. ${message}`);
        }
      }
    });

    CanvasEditorProvider.activePanels.add(webviewPanel);

    webviewPanel.onDidDispose(() => {
      CanvasEditorProvider.activePanels.delete(webviewPanel);
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

  private async _getHtml(
    webview: vscode.Webview,
    initialContent: string,
    reviewStickies: unknown[],
  ): Promise<string> {
    const nonce = this._nonce();

    const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets');
    const files = await vscode.workspace.fs.readDirectory(assetsRoot);
    const scriptFile = files.find(([name]) => name.endsWith('.js'))?.[0];

    if (!scriptFile) {
      throw new Error('Webview bundle not found');
    }

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource}`,
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
    window.__codetrace_initialReviewStickies = ${this._scriptJson(reviewStickies)};

    window.addEventListener('message', event => {
      const data = event.data ?? {};
      if (data.type === 'update' && typeof data.content === 'string') {
        window.__codetrace_initialContent = data.content;
        if (window.__codetrace_onUpdate) window.__codetrace_onUpdate(data.content);
      } else if (data.type === 'analysis' && data.payload) {
        if (window.__codetrace_onAnalysis) window.__codetrace_onAnalysis(data.payload);
      } else if (data.type === 'graphNode:deletionImpact' && data.response) {
        if (window.__codetrace_onGraphNodeDeletionImpact) {
          window.__codetrace_onGraphNodeDeletionImpact(data.response);
        }
      }
    });

    window.__codetrace_save = (content) => {
      vscode.postMessage({ type: 'save', content });
    };

    window.__codetrace_saveFile = (content) => {
      vscode.postMessage({ type: 'saveFile', content });
    };

    window.__codetrace_saveReviewSticky = (review) => {
      vscode.postMessage({ type: 'reviewSticky:commit', review });
    };

    window.__codetrace_analyzeGraphNodeDeletion = (request) => {
      vscode.postMessage({ type: 'graphNode:analyzeDeletion', request });
    };

    window.__codetrace_confirmGraphNodeRemoval = (entry) => {
      vscode.postMessage({ type: 'graphNode:confirmRemoval', entry });
    };
  </script>
`,
      );
  }

  private _rewriteWebviewUris(html: string, webview: vscode.Webview): string {
    const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');

    return html.replace(/\b(src|href)="([^"]+)"/g, (_match, attribute: string, resourcePath: string) => {
      if (this._isExternalResource(resourcePath)) {
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

  private _getFallbackHtml(message: string): string {
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeTrace Canvas</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #1f2937; background: #f9fafb; }
    main { max-width: 520px; padding: 24px; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    p { margin: 0; line-height: 1.5; }
    code { display: inline-block; margin-top: 16px; padding: 4px 6px; border-radius: 4px; background: #eef2ff; }
  </style>
</head>
<body>
  <main>
    <h1>CodeTrace Canvas</h1>
    <p>${this._escapeHtml(message)}</p>
    <code>npm run build --workspace=frontend</code>
  </main>
</body>
</html>`;
  }

  private _isExternalResource(resourcePath: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(resourcePath);
  }

  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private _scriptString(value: string): string {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  private _scriptJson(value: unknown): string {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  private _getWorkspaceRoot(document: vscode.TextDocument): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) return folder.uri.fsPath;
    if (document.uri.scheme === 'file') return path.dirname(document.uri.fsPath);
    return undefined;
  }

  private _nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}

function isReviewStickyCommitMessage(
  value: unknown,
): value is { type: 'reviewSticky:commit'; review: PersistReviewStickyInput } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.type !== 'reviewSticky:commit') return false;
  if (!record.review || typeof record.review !== 'object') return false;
  const review = record.review as Record<string, unknown>;
  return (
    typeof review.reviewId === 'string' &&
    typeof review.title === 'string' &&
    typeof review.body === 'string'
  );
}

function isGraphNodeDeletionImpactMessage(
  value: unknown,
): value is { type: 'graphNode:analyzeDeletion'; request: DeletionImpactRequest } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.type !== 'graphNode:analyzeDeletion') return false;
  if (!record.request || typeof record.request !== 'object') return false;
  const request = record.request as Record<string, unknown>;
  return (
    typeof request.requestId === 'string' &&
    isDeletionGraphNode(request.node) &&
    Array.isArray(request.callers) &&
    request.callers.every(isDeletionGraphNode)
  );
}

function isGraphNodeRemovalConfirmMessage(
  value: unknown,
): value is { type: 'graphNode:confirmRemoval'; entry: RemovedNodeLogEntry } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.type !== 'graphNode:confirmRemoval') return false;
  if (!record.entry || typeof record.entry !== 'object') return false;
  const entry = record.entry as Record<string, unknown>;
  return (
    entry.decision === 'confirmed' &&
    isDeletionGraphNode(entry.node) &&
    typeof entry.callerCount === 'number' &&
    typeof entry.stickyCount === 'number' &&
    Array.isArray(entry.impacts)
  );
}

function isDeletionGraphNode(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.id === 'string' &&
    typeof node.name === 'string' &&
    typeof node.file === 'string' &&
    !!node.range &&
    typeof node.range === 'object'
  );
}
