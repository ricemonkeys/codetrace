import { Excalidraw, CaptureUpdateAction } from '@excalidraw/excalidraw';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import {
  createCanvasDocumentFromScene,
  parseCanvasDocumentContent,
  toExcalidrawInitialData,
} from './storage/canvasStorage';
import { serializeCanvasDocument, type ExcalidrawElementStub } from './types/CanvasDocument';
import type { CodeCard } from './types/CodeCard';
import {
  convertGraphToElements,
  extractPositions,
  partitionElements,
  setAutoElementsLocked,
} from './graph/converter';
import { GRAPH_ELEMENT_KIND_NODE, type CallGraphPayload, type GraphCustomData } from './graph/types';
import {
  commitSticky,
  createStickyForAnchor,
  removeSticky,
  updateStickyText,
} from './sticky/sticky';
import { isReviewStickyCustomData } from './sticky/types';
import {
  getInitialDocumentContent,
  saveDocumentContent,
  saveDocumentFile,
  subscribeAnalysisUpdates,
  subscribeDocumentUpdates,
} from './vscodeBridge';

type ExcalidrawChangeHandler = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>;

interface DraftEditorState {
  reviewId: string;
  title: string;
  body: string;
}

function readInitialDocument() {
  return parseCanvasDocumentContent(getInitialDocumentContent() ?? '');
}

function findGraphNodeAnchor(element: ExcalidrawElementStub | null | undefined): {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!element) return null;
  const data = element.customData as GraphCustomData | undefined;
  if (data?.kind !== GRAPH_ELEMENT_KIND_NODE) return null;
  // Labels carry the same kind but live as text inside the rectangle.
  if (element.type !== 'rectangle') return null;
  const x = element.x;
  const y = element.y;
  const width = element.width;
  const height = element.height;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  return { id: String(element.id), x, y, width, height };
}

export default function App() {
  const initialDocument = useMemo(readInitialDocument, []);
  const initialContent = useMemo(() => serializeCanvasDocument(initialDocument), [initialDocument]);
  const initialData = useMemo(() => toExcalidrawInitialData(initialDocument), [initialDocument]);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const cardsRef = useRef<CodeCard[]>([]);
  const latestContentRef = useRef<string>(initialContent);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoLocked, setAutoLocked] = useState(true);
  const [stickyMode, setStickyMode] = useState(false);
  const stickyModeRef = useRef(stickyMode);
  const [draft, setDraft] = useState<DraftEditorState | null>(null);

  useEffect(() => {
    stickyModeRef.current = stickyMode;
  }, [stickyMode]);

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
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  useEffect(() => subscribeDocumentUpdates(applyDocumentContent), [applyDocumentContent]);

  const applyAnalysis = useCallback(
    (payload: CallGraphPayload) => {
      const api = apiRef.current;
      if (!api) return;

      const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
      const { user } = partitionElements(current);
      const stickyElements = current.filter((el) => isReviewStickyCustomData(el.customData));
      const userOnly = user.filter((el) => !isReviewStickyCustomData(el.customData));
      const existingPositions = extractPositions(current);

      const { elements: autoElements } = convertGraphToElements(
        payload.nodes,
        payload.edges,
        existingPositions,
        { locked: autoLocked },
      );

      const next = [...autoElements, ...userOnly, ...stickyElements];
      api.updateScene({
        elements: next as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [autoLocked],
  );

  useEffect(() => subscribeAnalysisUpdates(applyAnalysis), [applyAnalysis]);

  const toggleAutoLock = useCallback(() => {
    setAutoLocked((prev) => {
      const next = !prev;
      const api = apiRef.current;
      if (api) {
        const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
        const updated = setAutoElementsLocked(current, next);
        api.updateScene({
          elements: updated as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
      return next;
    });
  }, []);

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  // Wire post-it click-to-attach: when sticky mode is on, the next click on a
  // graphNode rectangle creates a draft sticky anchored to that node.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const unsubscribe = api.onPointerDown((_tool, pointerDownState) => {
      if (!stickyModeRef.current) return;
      const hit = pointerDownState.hit?.element as ExcalidrawElementStub | null;
      const anchor = findGraphNodeAnchor(hit);
      if (!anchor) return;

      const { reviewId, elements: stickyElements } = createStickyForAnchor(anchor, {
        title: '',
        body: '',
      });
      const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
      api.updateScene({
        elements: [...current, ...stickyElements] as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setStickyMode(false);
      setDraft({ reviewId, title: '', body: '' });
    });
    return unsubscribe;
  }, [apiRef.current]);

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

  const handleDraftChange = useCallback(
    (patch: Partial<Pick<DraftEditorState, 'title' | 'body'>>) => {
      setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  const handleDraftSave = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev;
      const api = apiRef.current;
      if (api) {
        const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
        const withText = updateStickyText(current, prev.reviewId, prev.title, prev.body);
        const committed = commitSticky(withText, prev.reviewId);
        api.updateScene({
          elements: committed as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
      return null;
    });
  }, []);

  const handleDraftCancel = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev;
      const api = apiRef.current;
      if (api) {
        const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
        const without = removeSticky(current, prev.reviewId);
        api.updateScene({
          elements: without as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
      return null;
    });
  }, []);

  const toggleStickyMode = useCallback(() => {
    setStickyMode((prev) => !prev);
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={toggleStickyMode}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            background: stickyMode ? '#fde68a' : '#fef9c3',
            border: '1px solid #ca8a04',
            borderRadius: 6,
            cursor: 'pointer',
          }}
          title="포스트잇 모드: 켜고 노드를 클릭하면 메모를 부착합니다"
        >
          {stickyMode ? '포스트잇 모드 ON (노드 클릭)' : '포스트잇'}
        </button>
        <button
          type="button"
          onClick={toggleAutoLock}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            background: autoLocked ? '#eef2ff' : '#fef3c7',
            border: '1px solid #4f46e5',
            borderRadius: 6,
            cursor: 'pointer',
          }}
          title="자동 생성 노드의 잠금을 토글합니다"
        >
          {autoLocked ? '자동 노드 잠금' : '자동 노드 해제'}
        </button>
      </div>

      {draft && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 12,
            zIndex: 11,
            width: 280,
            padding: 12,
            background: '#fef9c3',
            border: '1px solid #ca8a04',
            borderRadius: 8,
            boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            type="text"
            placeholder="제목"
            value={draft.title}
            onChange={(e) => handleDraftChange({ title: e.target.value })}
            style={{
              padding: '6px 8px',
              fontSize: 13,
              border: '1px solid #ca8a04',
              borderRadius: 4,
              background: '#fffbeb',
            }}
            autoFocus
          />
          <textarea
            placeholder="본문"
            value={draft.body}
            onChange={(e) => handleDraftChange({ body: e.target.value })}
            rows={4}
            style={{
              padding: '6px 8px',
              fontSize: 13,
              border: '1px solid #ca8a04',
              borderRadius: 4,
              background: '#fffbeb',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              onClick={handleDraftCancel}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                background: 'transparent',
                border: '1px solid #ca8a04',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleDraftSave}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                background: '#ca8a04',
                color: 'white',
                border: '1px solid #ca8a04',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              저장
            </button>
          </div>
        </div>
      )}

      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        initialData={initialData as unknown as ExcalidrawInitialDataState}
        onChange={handleChange}
      />
    </div>
  );
}
