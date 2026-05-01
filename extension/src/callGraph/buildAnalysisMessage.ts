import { extractCallGraph } from '../analyzer/callGraph';
import type { CallGraph } from '../analyzer/types';
import type { ExtensionToWebviewMessage } from './messages';

/**
 * Pure helper: given a filesystem path, produce the extension→webview message
 * to post (analysisResult or analysisError). Kept free of `vscode.*` so jest
 * can exercise it without spinning up an extension host.
 */
export function buildAnalysisMessage(fsPath: string): ExtensionToWebviewMessage {
  if (!/\.(ts|tsx)$/.test(fsPath)) {
    return { type: 'analysisError', message: 'TypeScript 파일(.ts, .tsx)만 분석할 수 있습니다.' };
  }

  try {
    const graph: CallGraph = extractCallGraph(fsPath);
    return { type: 'analysisResult', graph };
  } catch (err) {
    return {
      type: 'analysisError',
      message: `분석 중 오류: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
