import { Excalidraw } from '@excalidraw/excalidraw';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentProps } from 'react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types/types';
import { CODE_CARD_WIDTH, createCodeCardElements } from './codeCards/codeCardElements';
import {
  createCanvasDocumentFromScene,
  parseCanvasDocumentContent,
  toExcalidrawInitialData,
} from './storage/canvasStorage';
import { serializeCanvasDocument, type ExcalidrawElementStub } from './types/CanvasDocument';
import type { CodeCard } from './types/CodeCard';
import {
  getInitialDocumentContent,
  saveDocumentContent,
  saveDocumentFile,
  subscribeAddCard,
  subscribeDocumentUpdates,
} from './vscodeBridge';

type ExcalidrawChangeHandler = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>;

const CARD_STACK_COLUMNS = 4;
const CARD_STACK_COLUMN_OFFSET = 32;
const CARD_STACK_ROW_OFFSET = 220;

function readInitialDocument() {
  return parseCanvasDocumentContent(getInitialDocumentContent() ?? '');
}

function getNextCodeCardPosition(appState: Record<string, unknown> | undefined, cardIndex: number) {
  const zoom = getZoomValue(appState);
  const viewport = getViewportSize(appState);
  const scrollX = getNumber(appState?.scrollX, 0);
  const scrollY = getNumber(appState?.scrollY, 0);
  const stackColumn = cardIndex % CARD_STACK_COLUMNS;
  const stackRow = Math.floor(cardIndex / CARD_STACK_COLUMNS);
  const xOffset = stackColumn * CARD_STACK_COLUMN_OFFSET;
  const yOffset = stackColumn * CARD_STACK_COLUMN_OFFSET + stackRow * CARD_STACK_ROW_OFFSET;

  return {
    x: Math.round((viewport.width / 2 - scrollX) / zoom - CODE_CARD_WIDTH / 2 + xOffset),
    y: Math.round((viewport.height * 0.25 - scrollY) / zoom + yOffset),
  };
}

function getZoomValue(appState: Record<string, unknown> | undefined): number {
  const zoom = appState?.zoom;
  if (typeof zoom !== 'object' || zoom === null || !('value' in zoom)) return 1;

  const value = (zoom as { value?: unknown }).value;
  return typeof value === 'number' && value > 0 ? value : 1;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getViewportSize(appState: Record<string, unknown> | undefined) {
  const fallbackWidth = getNumber(appState?.width, 1200);
  const fallbackHeight = getNumber(appState?.height, 800);

  if (typeof window === 'undefined') {
    return { width: fallbackWidth, height: fallbackHeight };
  }

  return {
    width: window.innerWidth || fallbackWidth,
    height: window.innerHeight || fallbackHeight,
  };
}

export default function App() {
  const initialDocument = useMemo(readInitialDocument, []);
  const initialContent = useMemo(() => serializeCanvasDocument(initialDocument), [initialDocument]);
  const initialData = useMemo(() => toExcalidrawInitialData(initialDocument), [initialDocument]);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const cardsRef = useRef<CodeCard[]>([]);
  const latestContentRef = useRef<string>(initialContent);

  useEffect(() => {
    cardsRef.current = initialDocument.cards;
  }, [initialDocument]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDocumentFile(latestContentRef.current);
      }
    };

    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, []);

  const applyDocumentContent = useCallback((content: string) => {
    const document = parseCanvasDocumentContent(content);
    const initialData = toExcalidrawInitialData(document);
    const api = apiRef.current;

    cardsRef.current = document.cards;
    latestContentRef.current = content;

    if (!api) return;

    const files = Object.values(document.files ?? {}) as BinaryFileData[];
    if (files.length > 0) {
      api.addFiles(files);
    }
    api.updateScene({
      elements: initialData.elements as unknown as ExcalidrawElement[],
      appState: {
        ...(initialData.appState as unknown as AppState),
        collaborators: new Map(),
      },
      commitToHistory: false,
    });
  }, []);

  useEffect(() => subscribeDocumentUpdates(applyDocumentContent), [applyDocumentContent]);

  const handleAddCard = useCallback((card: CodeCard) => {
    const newCards = [...cardsRef.current, card];
    cardsRef.current = newCards;

    const api = apiRef.current;
    let elements = api ? (api.getSceneElements() as unknown as ExcalidrawElementStub[]) : [];
    let appState = api ? (api.getAppState() as unknown as Record<string, unknown>) : undefined;
    let files = api ? (api.getFiles() as unknown as Record<string, unknown>) : undefined;

    if (api) {
      const nextElements = [
        ...elements,
        ...createCodeCardElements(card, getNextCodeCardPosition(appState, newCards.length - 1)),
      ];

      api.updateScene({
        elements: nextElements as unknown as ExcalidrawElement[],
        commitToHistory: true,
      });

      elements = api.getSceneElements() as unknown as ExcalidrawElementStub[];
      appState = api.getAppState() as unknown as Record<string, unknown>;
      files = api.getFiles() as unknown as Record<string, unknown>;
    }

    const document = createCanvasDocumentFromScene({
      elements,
      appState,
      files,
      cards: newCards,
    });
    const content = serializeCanvasDocument(document);
    latestContentRef.current = content;
    saveDocumentContent(content);
  }, []);

  useEffect(() => subscribeAddCard(handleAddCard), [handleAddCard]);

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  const handleChange = useCallback<ExcalidrawChangeHandler>(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const document = createCanvasDocumentFromScene({
        elements: elements as unknown as ExcalidrawElementStub[],
        appState: appState as unknown as Record<string, unknown>,
        files: files as unknown as Record<string, unknown>,
        cards: cardsRef.current,
      });
      const content = serializeCanvasDocument(document);

      if (content === latestContentRef.current) return;

      latestContentRef.current = content;
      saveDocumentContent(content);
    },
    [],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        initialData={initialData as unknown as ExcalidrawInitialDataState}
        onChange={handleChange}
      />
    </div>
  );
}
