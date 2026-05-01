import { useEffect, useState } from 'react';
import { CallGraphCanvas } from './graph/CallGraphCanvas';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from './graph/messages';
import type { CallGraph } from './graph/types';
import './CallGraphApp.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'loaded'; graph: CallGraph }
  | { kind: 'error'; message: string };

function postToHost(message: WebviewToExtensionMessage): void {
  window.__codetrace_vscode?.postMessage(message);
}

export function CallGraphApp() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'analysisResult') {
        setStatus({ kind: 'loaded', graph: msg.graph });
      } else if (msg.type === 'analysisError') {
        setStatus({ kind: 'error', message: msg.message });
      }
    };
    window.addEventListener('message', onMessage);
    // Tell extension we're ready *after* the listener is attached. Posting
    // earlier would race with extension's initial analysisResult delivery.
    postToHost({ type: 'webviewReady' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="codetrace-callgraph-app">
      <header className="codetrace-callgraph-app__bar">
        <span className="codetrace-callgraph-app__title">Call Graph</span>
        <button
          type="button"
          className="codetrace-callgraph-app__refresh"
          onClick={() => postToHost({ type: 'requestRefresh' })}
        >
          Refresh
        </button>
      </header>
      <main className="codetrace-callgraph-app__main">
        {status.kind === 'idle' && (
          <p className="codetrace-callgraph-app__placeholder">
            분석을 기다리는 중입니다…
          </p>
        )}
        {status.kind === 'error' && (
          <p className="codetrace-callgraph-app__error">{status.message}</p>
        )}
        {status.kind === 'loaded' && <CallGraphCanvas graph={status.graph} />}
      </main>
    </div>
  );
}
