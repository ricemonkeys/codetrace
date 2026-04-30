import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import App from './App';
import { createCodeCardElements } from './codeCards/codeCardElements';
import { serializeCanvasDocument, type CanvasDocument, type ExcalidrawElementStub } from './types/CanvasDocument';
import type { CodeCard } from './types/CodeCard';

type MockExcalidrawProps = {
  excalidrawAPI?: (api: MockExcalidrawAPI) => void;
  initialData?: {
    elements?: readonly ExcalidrawElementStub[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  onChange?: (
    elements: readonly ExcalidrawElementStub[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ) => void;
};

type MockExcalidrawAPI = {
  getSceneElements: () => readonly ExcalidrawElementStub[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  addFiles: (files: readonly { id: string }[]) => void;
  updateScene: (scene: {
    elements?: readonly ExcalidrawElementStub[];
    appState?: Record<string, unknown>;
  }) => void;
};

const mockDefaultAppState: Record<string, unknown> = {
  width: 1200,
  height: 800,
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
  selectedElementIds: {},
  collaborators: {},
};

const mockExcalidrawStore: {
  api: MockExcalidrawAPI | null;
  props: MockExcalidrawProps | null;
  emitChange: () => void;
  reset: () => void;
} = {
  api: null,
  props: null,
  emitChange() {
    if (!this.api || !this.props?.onChange) return;
    this.props.onChange(this.api.getSceneElements(), this.api.getAppState(), this.api.getFiles());
  },
  reset() {
    this.api = null;
    this.props = null;
  },
};

jest.mock('@excalidraw/excalidraw', () => {
  const React = require('react') as typeof import('react');

  function readCodetraceData(element: ExcalidrawElementStub) {
    const customData = element.customData;
    if (typeof customData !== 'object' || customData === null) return undefined;

    const codetrace = (customData as Record<string, unknown>).codetrace;
    return typeof codetrace === 'object' && codetrace !== null
      ? (codetrace as Record<string, unknown>)
      : undefined;
  }

  function Excalidraw(props: MockExcalidrawProps): ReactElement {
    const [elements, setElements] = React.useState<readonly ExcalidrawElementStub[]>(
      () => props.initialData?.elements ?? [],
    );
    const elementsRef = React.useRef(elements);
    const appStateRef = React.useRef<Record<string, unknown>>({
      ...mockDefaultAppState,
      ...(props.initialData?.appState ?? {}),
      collaborators: {},
    });
    const filesRef = React.useRef<Record<string, unknown>>(props.initialData?.files ?? {});

    elementsRef.current = elements;

    const api = React.useMemo<MockExcalidrawAPI>(
      () => ({
        getSceneElements: () => elementsRef.current,
        getAppState: () => appStateRef.current,
        getFiles: () => filesRef.current,
        addFiles: files => {
          filesRef.current = {
            ...filesRef.current,
            ...Object.fromEntries(files.map(file => [file.id, file])),
          };
        },
        updateScene: scene => {
          if (scene.appState) {
            appStateRef.current = {
              ...appStateRef.current,
              ...scene.appState,
              collaborators: {},
            };
          }

          if (scene.elements) {
            setElements(scene.elements);
          }
        },
      }),
      [],
    );

    React.useEffect(() => {
      mockExcalidrawStore.api = api;
      mockExcalidrawStore.props = props;
      props.excalidrawAPI?.(api);
    }, [api, props]);

    return (
      <div data-testid="excalidraw">
        {elements.map(element => {
          const codetrace = readCodetraceData(element);
          const role = typeof codetrace?.role === 'string' ? codetrace.role : undefined;
          const cardId = typeof codetrace?.cardId === 'string' ? codetrace.cardId : undefined;
          const text = typeof element.text === 'string' ? element.text : undefined;

          return (
            <div
              data-card-id={cardId}
              data-codetrace-role={role}
              data-testid={element.id}
              key={element.id}
            >
              {text}
            </div>
          );
        })}
      </div>
    );
  }

  return { Excalidraw };
});

const saveDocumentContent = jest.fn();

function makeCard(overrides: Partial<CodeCard> = {}): CodeCard {
  return {
    id: '01H' + 'Z'.repeat(23),
    file: {
      path: 'src/example.ts',
    },
    range: {
      startLine: 2,
      endLine: 3,
    },
    snapshot: 'const value = 1;\nconsole.log(value);',
    language: 'typescript',
    customData: {},
    ...overrides,
  };
}

function makeDocument(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    version: 1,
    elements: [],
    cards: [],
    appState: mockDefaultAppState,
    ...overrides,
  };
}

async function waitForAddCardSubscription() {
  await waitFor(() => {
    expect(window.__codetrace_onAddCard).toEqual(expect.any(Function));
  });
}

beforeEach(() => {
  mockExcalidrawStore.reset();
  saveDocumentContent.mockReset();
  window.__codetrace_initialContent = undefined;
  window.__codetrace_onUpdate = undefined;
  window.__codetrace_onAddCard = undefined;
  window.__codetrace_onStaleStatus = undefined;
  window.__codetrace_save = saveDocumentContent;
});

afterEach(() => {
  cleanup();
});

test('renders a received code card into the Excalidraw scene', async () => {
  const card = makeCard();

  render(<App />);
  await waitForAddCardSubscription();

  act(() => {
    window.__codetrace_onAddCard?.(card);
  });

  const container = await screen.findByTestId(`codetrace-card-${card.id}-container`);
  expect(container).toHaveAttribute('data-card-id', card.id);
  expect(container).toHaveAttribute('data-codetrace-role', 'container');
  expect(saveDocumentContent).toHaveBeenCalledTimes(1);
});

test('renders a stale marker when a stale code card is added', async () => {
  const card = makeCard({
    id: '01J' + 'Y'.repeat(23),
    customData: { stale: true },
  });

  render(<App />);
  await waitForAddCardSubscription();

  act(() => {
    window.__codetrace_onAddCard?.(card);
  });

  expect(await screen.findByText('STALE')).toBeInTheDocument();
});

test('dedupes an Excalidraw echo matching the latest serialized content', async () => {
  const card = makeCard();
  const elements = createCodeCardElements(card, { x: 24, y: 32, updated: 1 });
  const content = serializeCanvasDocument(makeDocument({ elements, cards: [card] }));

  window.__codetrace_initialContent = content;

  render(<App />);

  await waitFor(() => {
    expect(mockExcalidrawStore.api).not.toBeNull();
  });

  act(() => {
    mockExcalidrawStore.emitChange();
  });

  expect(saveDocumentContent).not.toHaveBeenCalled();
});
