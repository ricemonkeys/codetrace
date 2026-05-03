import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, MouseEvent as ReactMouseEvent } from 'react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import {
  CODETRACE_EXCALIDRAW_UI_OPTIONS,
  addMemoToGraphNode,
  getSelectedGraphNode,
  isCodeTraceAllowedTool,
  normalizeUserElements,
} from './annotations/userElements';
import {
  createCanvasDocumentFromScene,
  parseCanvasDocumentContent,
  toExcalidrawInitialData,
} from './storage/canvasStorage';
import { serializeCanvasDocument, type ExcalidrawElementStub } from './types/CanvasDocument';
import type { CodeCard } from './types/CodeCard';
import {
  convertGraphToElements,
  extractNodeGroupIds,
  extractPositions,
  partitionElements,
  setAutoElementsLocked,
} from './graph/converter';
import type { CallGraphPayload } from './graph/types';
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
import './App.css';

type ExcalidrawChangeHandler = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>;
type ExcalidrawPointerDownHandler = NonNullable<ComponentProps<typeof Excalidraw>['onPointerDown']>;

type NodeContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

interface DraftEditorState {
  reviewId: string;
  title: string;
  body: string;
}

function readInitialDocument() {
  return parseCanvasDocumentContent(getInitialDocumentContent() ?? '');
}

function anchorBoxFromElement(
  element: ExcalidrawElementStub | undefined,
): { id: string; x: number; y: number; width: number; height: number } | null {
  if (!element) return null;
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
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const [draft, setDraft] = useState<DraftEditorState | null>(null);

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
      const existingNodeGroupIds = extractNodeGroupIds(current);

      const { elements: autoElements } = convertGraphToElements(
        payload.nodes,
        payload.edges,
        existingPositions,
        { locked: autoLocked, nodeGroupIds: existingNodeGroupIds },
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

  const handleChange = useCallback<ExcalidrawChangeHandler>(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const normalized = normalizeUserElements(elements as unknown as ExcalidrawElementStub[]);
      const sceneElements = normalized.elements;

      setSelectedGraphNodeId(getSelectedGraphNode(sceneElements, appState.selectedElementIds)?.id ?? null);

      if (normalized.changed) {
        apiRef.current?.updateScene({
          elements: sceneElements as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }

      const document = createCanvasDocumentFromScene({
        elements: sceneElements as unknown as ExcalidrawElementStub[],
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

  const handlePointerDown = useCallback<ExcalidrawPointerDownHandler>((activeTool) => {
    setNodeContextMenu(null);
    if (isCodeTraceAllowedTool(activeTool.type)) return;
    apiRef.current?.setActiveTool({ type: 'selection' });
  }, []);

  const addMemo = useCallback((nodeElementId?: string) => {
    const api = apiRef.current;
    if (!api) return;

    const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
    const selectedNode = nodeElementId
      ? current.find((element) => element.id === nodeElementId)
      : getSelectedGraphNode(current, api.getAppState().selectedElementIds);
    const selectedNodeId = selectedNode?.id;
    if (!selectedNodeId) return;

    const result = addMemoToGraphNode(current, selectedNodeId);
    if (!result) return;

    api.updateScene({
      elements: result.elements as unknown as ExcalidrawElement[],
      appState: {
        selectedElementIds: {
          [selectedNodeId]: true,
          [result.memoId]: true,
        },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setSelectedGraphNodeId(selectedNodeId);
    setNodeContextMenu(null);
  }, []);

  const addSticky = useCallback((nodeElementId?: string) => {
    const api = apiRef.current;
    if (!api) return;

    const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
    const selectedNode = nodeElementId
      ? current.find((element) => element.id === nodeElementId)
      : getSelectedGraphNode(current, api.getAppState().selectedElementIds);
    const anchor = anchorBoxFromElement(selectedNode);
    if (!anchor) return;

    const { reviewId, elements: stickyElements } = createStickyForAnchor(anchor, {
      title: '',
      body: '',
    });
    api.updateScene({
      elements: [...current, ...stickyElements] as unknown as ExcalidrawElement[],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setNodeContextMenu(null);
    setDraft({ reviewId, title: '', body: '' });
  }, []);

  const handleAddMemo = useCallback(() => {
    addMemo();
  }, [addMemo]);

  const handleAddSticky = useCallback(() => {
    addSticky();
  }, [addSticky]);

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const api = apiRef.current;
    const container = containerRef.current;
    if (!api || !container) return;

    const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
    const selectedNode = getSelectedGraphNode(current, api.getAppState().selectedElementIds);
    if (!selectedNode) return;

    event.preventDefault();
    const bounds = container.getBoundingClientRect();
    setNodeContextMenu({
      nodeId: selectedNode.id,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  }, []);

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

  return (
    <div ref={containerRef} className="codetrace-canvas" onContextMenu={handleContextMenu}>
      <div className="codetrace-canvas__controls" aria-label="CodeTrace canvas controls">
        <button
          type="button"
          className="codetrace-canvas__button"
          data-active={autoLocked}
          onClick={toggleAutoLock}
          title="자동 생성 노드의 잠금을 토글합니다"
        >
          {autoLocked ? '자동 노드 잠금' : '자동 노드 해제'}
        </button>
        <button
          type="button"
          className="codetrace-canvas__button"
          onClick={handleAddMemo}
          disabled={!selectedGraphNodeId}
          title="선택한 그래프 노드에 텍스트 메모를 추가합니다"
        >
          메모 추가
        </button>
        <button
          type="button"
          className="codetrace-canvas__button"
          onClick={handleAddSticky}
          disabled={!selectedGraphNodeId}
          title="선택한 그래프 노드에 리뷰 포스트잇을 부착합니다"
        >
          포스트잇 추가
        </button>
      </div>
      {nodeContextMenu ? (
        <div
          className="codetrace-canvas__context-menu"
          style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="codetrace-canvas__context-menu-item"
            onClick={() => addMemo(nodeContextMenu.nodeId)}
          >
            메모 추가
          </button>
          <button
            type="button"
            role="menuitem"
            className="codetrace-canvas__context-menu-item"
            onClick={() => addSticky(nodeContextMenu.nodeId)}
          >
            포스트잇 추가
          </button>
        </div>
      ) : null}

      {draft && (
        <div
          className="codetrace-canvas__sticky-editor"
          role="dialog"
          aria-label="포스트잇 작성"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            type="text"
            placeholder="제목"
            value={draft.title}
            onChange={(e) => handleDraftChange({ title: e.target.value })}
            className="codetrace-canvas__sticky-editor-input"
            autoFocus
          />
          <textarea
            placeholder="본문"
            value={draft.body}
            onChange={(e) => handleDraftChange({ body: e.target.value })}
            rows={4}
            className="codetrace-canvas__sticky-editor-textarea"
          />
          <div className="codetrace-canvas__sticky-editor-actions">
            <button type="button" onClick={handleDraftCancel} className="codetrace-canvas__button">
              취소
            </button>
            <button
              type="button"
              onClick={handleDraftSave}
              className="codetrace-canvas__button"
              data-primary
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
        onPointerDown={handlePointerDown}
        UIOptions={CODETRACE_EXCALIDRAW_UI_OPTIONS}
      />
    </div>
  );
}
