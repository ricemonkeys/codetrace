import type { CallGraph } from '../analyzer/types';

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
export interface NodeClickMessage {
  type: 'nodeClick';
  nodeId: string;
}

export interface RequestRefreshMessage {
  type: 'requestRefresh';
}

export type WebviewToExtensionMessage = NodeClickMessage | RequestRefreshMessage;
