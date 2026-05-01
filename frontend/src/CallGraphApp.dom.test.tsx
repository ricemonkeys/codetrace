import { act, render, screen } from '@testing-library/react';
import { CallGraphApp } from './CallGraphApp';
import { SAMPLE_GRAPH } from './graph/__demo__/sampleGraph';
import type { ExtensionToWebviewMessage } from './graph/messages';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
  });

  if (typeof (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly === 'undefined') {
    (globalThis as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class {
      m22 = 1;
      constructor() {}
    };
  }
});

function dispatchHostMessage(message: ExtensionToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

describe('CallGraphApp', () => {
  beforeEach(() => {
    window.__codetrace_vscode = undefined;
  });

  test('starts in idle state', () => {
    render(<CallGraphApp />);
    expect(screen.getByText(/분석을 기다리는 중/)).toBeInTheDocument();
  });

  test('renders the call graph after receiving analysisResult', () => {
    const { container } = render(<CallGraphApp />);
    dispatchHostMessage({ type: 'analysisResult', graph: SAMPLE_GRAPH });
    const renderedNodes = container.querySelectorAll('.codetrace-fn-node');
    expect(renderedNodes.length).toBe(SAMPLE_GRAPH.nodes.length);
  });

  test('shows analysisError message', () => {
    render(<CallGraphApp />);
    dispatchHostMessage({ type: 'analysisError', message: 'TS 파일이 아닙니다.' });
    expect(screen.getByText('TS 파일이 아닙니다.')).toBeInTheDocument();
  });

  test('posts webviewReady to host on mount, after the message listener attaches', () => {
    const postMessage = jest.fn();
    window.__codetrace_vscode = { postMessage };

    render(<CallGraphApp />);

    expect(postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    // The very first post must be webviewReady so the extension knows the
    // listener is mounted before delivering analysisResult.
    expect(postMessage.mock.calls[0][0]).toEqual({ type: 'webviewReady' });
  });

  test('refresh button posts requestRefresh to host', () => {
    const postMessage = jest.fn();
    window.__codetrace_vscode = { postMessage };

    render(<CallGraphApp />);
    screen.getByRole('button', { name: /refresh/i }).click();

    expect(postMessage).toHaveBeenCalledWith({ type: 'requestRefresh' });
  });
});
