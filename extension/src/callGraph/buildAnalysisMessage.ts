import { extractWorkspaceCallGraph } from '../analyzer/callGraph';
import type { CallGraph } from '../analyzer/types';
import type { ExtensionToWebviewMessage } from './messages';

/**
 * Pure helper: given a filesystem path, produce the extension→webview message
 * to post (analysisResult or analysisError). Kept free of `vscode.*` so jest
 * can exercise it without spinning up an extension host.
 */
export async function buildAnalysisMessage(fsPath: string): Promise<ExtensionToWebviewMessage> {
  try {
    const graph: CallGraph = await extractWorkspaceCallGraph(fsPath);
    return { type: 'analysisResult', graph };
  } catch (err) {
    return {
      type: 'analysisError',
      message: `분석 중 오류: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
