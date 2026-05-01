// Mirrors extension/src/callGraph/messages.ts.
// Both ends agree on this shape until a shared workspace package emerges.

import type { CallGraph } from './types';

// extension → webview
export interface AnalysisResultMessage {
  type: 'analysisResult';
  graph: CallGraph;
}

export interface AnalysisErrorMessage {
  type: 'analysisError';
  message: string;
}

export type ExtensionToWebviewMessage = AnalysisResultMessage | AnalysisErrorMessage;

// webview → extension
export interface WebviewReadyMessage {
  type: 'webviewReady';
}

export interface NodeClickMessage {
  type: 'nodeClick';
  nodeId: string;
}

export interface RequestRefreshMessage {
  type: 'requestRefresh';
}

export type WebviewToExtensionMessage =
  | WebviewReadyMessage
  | NodeClickMessage
  | RequestRefreshMessage;

export interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
}

declare global {
  interface Window {
    __codetrace_vscode?: VsCodeApi;
  }
}
