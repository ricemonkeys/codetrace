import { render, screen, within } from '@testing-library/react';
import { CallGraphCanvas } from './CallGraphCanvas';
import { SAMPLE_GRAPH } from './__demo__/sampleGraph';

// React Flow needs container size to render; jsdom returns 0 by default.
// Stub ResizeObserver and getBoundingClientRect for the test surface.
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

  // React Flow uses DOMMatrixReadOnly for transforms; jsdom omits it.
  if (typeof (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly === 'undefined') {
    (globalThis as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class {
      m22 = 1;
      constructor() {}
    };
  }
});

describe('CallGraphCanvas', () => {
  test('renders all sample nodes via custom node component', () => {
    const { container } = render(<CallGraphCanvas graph={SAMPLE_GRAPH} />);

    const rendered = container.querySelectorAll('.codetrace-fn-node');
    expect(rendered.length).toBe(SAMPLE_GRAPH.nodes.length);

    for (const node of SAMPLE_GRAPH.nodes) {
      // function name should be visible in at least one custom node
      expect(screen.getAllByText(node.name).length).toBeGreaterThan(0);
    }
  });

  test('renders the layout direction toolbar', () => {
    render(<CallGraphCanvas graph={SAMPLE_GRAPH} />);
    const select = screen.getByLabelText(/layout/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const options = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value);
    expect(options).toEqual(['TB', 'LR']);
  });
});
