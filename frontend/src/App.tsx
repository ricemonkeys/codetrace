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
import {
  collectGraphNodeIds,
  convertGraphToElements,
  extractNodeGroupIds,
  extractPositions,
  getGraphNodeId,
  partitionElements,
  setAutoElementsLocked,
} from './graph/converter';
import type { CallGraphPayload, GraphEdge, GraphNode } from './graph/types';
import {
  commitSticky,
  createDetachedSticky,
  createStickyForAnchor,
  listStickyGroups,
  removeSticky,
  updateStickyText,
} from './sticky/sticky';
import { isReviewStickyCustomData, type ReviewStickyAnchor, type ReviewStickyRoundTripData } from './sticky/types';
import {
  getInitialDocumentContent,
  getInitialReviewStickies,
  confirmGraphNodeRemoval,
  requestGraphNodeDeletionImpact,
  saveDocumentContent,
  saveDocumentFile,
  saveReviewSticky,
  subscribeAnalysisUpdates,
  subscribeDocumentUpdates,
  subscribeGraphNodeDeletionImpact,
  type GraphNodeDeletionImpact,
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

interface PendingNodeDeletionState {
  requestId: string;
  node: GraphNode;
  callers: GraphNode[];
  snapshotElements: ExcalidrawElementStub[];
  stickyReviewIds: string[];
  impacts: GraphNodeDeletionImpact[] | null;
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

function graphNodeIdFromElement(element: ExcalidrawElementStub | undefined): string | undefined {
  if (!element) return undefined;
  const data = element.customData;
  if (data && typeof data === 'object') {
    const nodeId = (data as { nodeId?: unknown }).nodeId;
    if (typeof nodeId === 'string' && nodeId.length > 0) return nodeId;
  }
  if (typeof element.id === 'string' && element.id.startsWith('auto-node-')) {
    return element.id.replace(/^auto-node-/, '');
  }
  return undefined;
}

function findAnchorBoxForReview(
  elements: readonly ExcalidrawElementStub[],
  anchor: ReviewStickyAnchor | undefined,
  analysisNodes: readonly (CallGraphPayload['nodes'][number])[] = [],
): ReturnType<typeof anchorBoxFromElement> {
  let nodeId = anchor?.nodeId ?? anchor?.symbolId;
  if (!nodeId && anchor?.file && anchor.range) {
    const targetFile = normalizeFilePath(anchor.file);
    const node = analysisNodes.find((candidate) => {
      const candidateFile = normalizeFilePath(candidate.file);
      return (
        (candidateFile === targetFile || candidateFile.endsWith(`/${targetFile}`)) &&
        candidate.range.startLine === anchor.range?.startLine
      );
    });
    nodeId = node?.id;
  }
  if (!nodeId) return null;

  const byId = anchorBoxFromElement(elements.find((element) => element.id === `auto-node-${nodeId}`));
  if (byId) return byId;

  const byCustomData = elements.find((element) => graphNodeIdFromElement(element) === nodeId);
  return anchorBoxFromElement(byCustomData);
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function readReviewAnchorFromScene(
  elements: readonly ExcalidrawElementStub[],
  analysisNodes: readonly (CallGraphPayload['nodes'][number])[],
  reviewId: string,
): ReviewStickyAnchor | undefined {
  const group = listStickyGroups(elements).find((item) => item.reviewId === reviewId);
  const bodyData = group?.body?.customData;
  const connectorData = group?.connector?.customData;
  const stickyData = isReviewStickyCustomData(bodyData)
    ? bodyData
    : isReviewStickyCustomData(connectorData)
      ? connectorData
      : undefined;
  const anchorElementId = stickyData?.anchorElementId;
  const anchorElement = anchorElementId
    ? elements.find((element) => element.id === anchorElementId)
    : undefined;
  const nodeId = graphNodeIdFromElement(anchorElement);
  const graphNode = nodeId ? analysisNodes.find((node) => node.id === nodeId) : undefined;

  if (graphNode) {
    return {
      nodeId: graphNode.id,
      symbolId: graphNode.id,
      file: graphNode.file,
      range: graphNode.range,
    };
  }

  return stickyData?.anchor;
}

function findDeletedGraphNode(
  previousElements: readonly ExcalidrawElementStub[],
  currentElements: readonly ExcalidrawElementStub[],
  analysisNodes: readonly GraphNode[],
  removedNodeIds: ReadonlySet<string>,
): GraphNode | undefined {
  if (analysisNodes.length === 0 || previousElements.length === 0) return undefined;
  const previousIds = collectGraphNodeIds(previousElements);
  const currentIds = collectGraphNodeIds(currentElements);
  return analysisNodes.find(
    (node) => previousIds.has(node.id) && !currentIds.has(node.id) && !removedNodeIds.has(node.id),
  );
}

function callerNodesFor(nodeId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const callers: GraphNode[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.to !== nodeId || seen.has(edge.from)) continue;
    const caller = byId.get(edge.from);
    if (!caller) continue;
    seen.add(edge.from);
    callers.push(caller);
  }
  return callers;
}

function stickyReviewIdsForNode(
  elements: readonly ExcalidrawElementStub[],
  nodeId: string,
): string[] {
  const anchorElementId = `auto-node-${nodeId}`;
  const ids = new Set<string>();

  for (const group of listStickyGroups(elements)) {
    const data = [group.body, group.connector, group.label]
      .map((element) => element?.customData)
      .find(isReviewStickyCustomData);
    if (!data) continue;
    if (
      data.anchorElementId === anchorElementId ||
      data.anchor?.nodeId === nodeId ||
      data.anchor?.symbolId === nodeId
    ) {
      ids.add(group.reviewId);
    }
  }

  return Array.from(ids);
}

function fallbackDeletionImpacts(callers: readonly GraphNode[]): GraphNodeDeletionImpact[] {
  return callers.map((caller) => ({
    caseType: 'unknown',
    callerId: caller.id,
    callerName: caller.name,
    file: caller.file,
    range: caller.range,
    preview: `${caller.name} (${caller.range.startLine}:${caller.range.startColumn})`,
  }));
}

function removeGraphNodeElements(
  elements: readonly ExcalidrawElementStub[],
  nodeId: string,
  edges: readonly GraphEdge[],
  stickyReviewIds: readonly string[],
): ExcalidrawElementStub[] {
  const stickyIds = new Set(stickyReviewIds);
  const incidentEdgeKeys = new Set(
    edges
      .filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => `${edge.from}->${edge.to}`),
  );

  return elements.filter((element) => {
    const data = element.customData;
    if (isReviewStickyCustomData(data) && stickyIds.has(data.reviewId)) return false;
    if (getGraphNodeId(element) === nodeId) return false;
    if (
      data &&
      typeof data === 'object' &&
      (data as { edgeKey?: unknown }).edgeKey &&
      incidentEdgeKeys.has(String((data as { edgeKey: unknown }).edgeKey))
    ) {
      return false;
    }
    return true;
  });
}

function noop() {}

/** Returns true when a connector arrow still has Excalidraw's placeholder geometry
 * (x=0, y=0, height=0, two-point horizontal line). These connectors were never
 * anchored by anchorStickyConnector and need to be recreated. */
function isPlaceholderConnector(connector: ExcalidrawElementStub): boolean {
  const points = connector.points as [number, number][] | undefined;
  return (
    connector.x === 0 &&
    connector.y === 0 &&
    (connector.height === 0 || connector.height === undefined) &&
    Array.isArray(points) &&
    points.length === 2 &&
    points[0][1] === 0 &&
    points[1][1] === 0
  );
}

export default function App() {
  const initialDocument = useMemo(readInitialDocument, []);
  const initialContent = useMemo(() => serializeCanvasDocument(initialDocument), [initialDocument]);
  const initialData = useMemo(() => toExcalidrawInitialData(initialDocument), [initialDocument]);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestContentRef = useRef<string>(initialContent);
  const latestAnalysisNodesRef = useRef<CallGraphPayload['nodes']>([]);
  const latestAnalysisEdgesRef = useRef<CallGraphPayload['edges']>([]);
  const initialReviewStickiesRef = useRef<ReviewStickyRoundTripData[]>(getInitialReviewStickies());
  const previousSceneElementsRef = useRef<ExcalidrawElementStub[]>(initialData.elements as unknown as ExcalidrawElementStub[]);
  const previousAppStateRef = useRef<AppState | null>(null);
  const removedGraphNodeIdsRef = useRef<Set<string>>(new Set());
  const suppressDeletionDetectionRef = useRef(false);
  const pendingDeletionRef = useRef<PendingNodeDeletionState | null>(null);
  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveCallbackRef = useRef<() => void>(noop);
  const queuedAnalysisPayloadRef = useRef<CallGraphPayload | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoLocked, setAutoLocked] = useState(true);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const [draft, setDraft] = useState<DraftEditorState | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingNodeDeletionState | null>(null);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        // Flush any pending debounced save first so latestContentRef is up-to-date
        // before saveDocumentFile reads it. Without this, a Ctrl+S within the 200ms
        // debounce window would write the previous content to disk.
        if (saveDebounceTimerRef.current !== null) {
          clearTimeout(saveDebounceTimerRef.current);
          pendingSaveCallbackRef.current();
        }
        saveDocumentFile(latestContentRef.current);
      }
    };

    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, []);

  const mergeInitialReviewStickies = useCallback(
    (elements: readonly ExcalidrawElementStub[]): ExcalidrawElementStub[] => {
      const reviews = initialReviewStickiesRef.current;
      if (reviews.length === 0) return [...elements];

      const existingGroups = new Map(listStickyGroups(elements).map((group) => [group.reviewId, group]));
      let next = [...elements];
      let detachedIndex = 0;

      for (const review of reviews) {
        const existingGroup = existingGroups.get(review.reviewId);
        const anchorBox = findAnchorBoxForReview(next, review.anchor, latestAnalysisNodesRef.current);
        // Skip if the group already exists and has real connector geometry.
        // A connector with placeholder geometry (height === 0, points length === 2
        // with x=0/y=0 origin) was never properly anchored — fall through to
        // recreate it via createStickyForAnchor so the corrected geometry applies.
        const connectorIsReal =
          existingGroup?.connector &&
          !isPlaceholderConnector(existingGroup.connector);
        if (existingGroup && (!anchorBox || connectorIsReal)) continue;

        const status = anchorBox
          ? review.status ?? 'active'
          : review.status === 'active' || !review.status
            ? 'anchor-lost'
            : review.status;
        const warning = anchorBox
          ? review.warning
          : review.warning ?? 'Source symbol anchor was not found on this canvas.';
        const restored = anchorBox
          ? createStickyForAnchor(anchorBox, {
              ...review,
              draft: false,
              status,
              warning,
              source: review.source ?? 'roundtrip',
            }).elements
          : createDetachedSticky({
              ...review,
              draft: false,
              status,
              warning,
              source: review.source ?? 'roundtrip',
              x: 80 + detachedIndex * 24,
              y: 80 + detachedIndex * 24,
            }).elements;

        if (existingGroup) {
          next = removeSticky(next, review.reviewId);
        }
        detachedIndex += anchorBox ? 0 : 1;
        next = [...next, ...restored];
        const restoredGroup = listStickyGroups(restored)[0];
        if (restoredGroup) existingGroups.set(review.reviewId, restoredGroup);
      }

      return next;
    },
    [],
  );

  const applyDocumentContent = useCallback((content: string) => {
    const document = parseCanvasDocumentContent(content);
    const initialData = toExcalidrawInitialData(document);
    const api = apiRef.current;

    latestContentRef.current = content;

    if (!api) return;

    const files = Object.values(document.files ?? {}) as BinaryFileData[];
    if (files.length > 0) {
      api.addFiles(files);
    }
    const elements = mergeInitialReviewStickies(initialData.elements as unknown as ExcalidrawElementStub[]);
    previousSceneElementsRef.current = elements;
    suppressDeletionDetectionRef.current = true;
    api.updateScene({
      elements: elements as unknown as ExcalidrawElement[],
      appState: {
        ...(initialData.appState as unknown as AppState),
        collaborators: new Map(),
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [mergeInitialReviewStickies]);

  useEffect(() => subscribeDocumentUpdates(applyDocumentContent), [applyDocumentContent]);

  useEffect(
    () =>
      subscribeGraphNodeDeletionImpact((response) => {
        setPendingDeletion((prev) => {
          if (!prev || prev.requestId !== response.requestId) return prev;
          const next = {
            ...prev,
            impacts: response.impacts,
          };
          pendingDeletionRef.current = next;
          return next;
        });
      }),
    [],
  );

  const applyAnalysis = useCallback(
    (payload: CallGraphPayload) => {
      if (pendingDeletionRef.current) {
        queuedAnalysisPayloadRef.current = payload;
        latestAnalysisNodesRef.current = payload.nodes;
        latestAnalysisEdgesRef.current = payload.edges;
        return;
      }

      latestAnalysisNodesRef.current = payload.nodes;
      latestAnalysisEdgesRef.current = payload.edges;
      const api = apiRef.current;
      if (!api) return;

      const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
      const { user } = partitionElements(current);
      const stickyElements = current.filter((el) => isReviewStickyCustomData(el.customData));
      const userOnly = user.filter((el) => !isReviewStickyCustomData(el.customData));
      const existingPositions = extractPositions(current);
      const existingNodeGroupIds = extractNodeGroupIds(current);

      const removedNodeIds = removedGraphNodeIdsRef.current;
      const visibleNodes = payload.nodes.filter((node) => !removedNodeIds.has(node.id));
      const visibleEdges = payload.edges.filter(
        (edge) => !removedNodeIds.has(edge.from) && !removedNodeIds.has(edge.to),
      );

      const { elements: autoElements } = convertGraphToElements(
        visibleNodes,
        visibleEdges,
        existingPositions,
        { locked: autoLocked, nodeGroupIds: existingNodeGroupIds },
      );

      const next = mergeInitialReviewStickies([...autoElements, ...userOnly, ...stickyElements]);
      previousSceneElementsRef.current = next;
      suppressDeletionDetectionRef.current = true;
      api.updateScene({
        elements: next as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [autoLocked, mergeInitialReviewStickies],
  );

  useEffect(() => {
    pendingDeletionRef.current = pendingDeletion;
    if (pendingDeletion) return;

    const queuedPayload = queuedAnalysisPayloadRef.current;
    if (!queuedPayload) return;
    queuedAnalysisPayloadRef.current = null;
    applyAnalysis(queuedPayload);
  }, [applyAnalysis, pendingDeletion]);

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
    const current = api.getSceneElements() as unknown as ExcalidrawElementStub[];
    const restored = mergeInitialReviewStickies(current);
    previousSceneElementsRef.current = restored;
    if (restored.length !== current.length) {
      suppressDeletionDetectionRef.current = true;
      api.updateScene({
        elements: restored as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }, [mergeInitialReviewStickies]);

  const handleChange = useCallback<ExcalidrawChangeHandler>(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const prevApp = previousAppStateRef.current;
      const prevElements = previousSceneElementsRef.current;

      // Pure pan/zoom frames: only viewport changed, no element or selection diff.
      // Skip the heavy synchronous prefix entirely to keep panning smooth.
      // selectedElementIds is a new object every frame; compare by stable string key.
      const selIds = appState.selectedElementIds;
      const prevSelIds = prevApp?.selectedElementIds;
      const selChanged =
        prevSelIds === undefined ||
        Object.keys(selIds).length !== Object.keys(prevSelIds).length ||
        Object.keys(selIds).some((k) => !prevSelIds[k]);
      // Sum element versions to detect same-length scene mutations (e.g. drag
      // during auto-scroll where viewport and elements change in the same frame).
      const elementVersionSum = (elements as unknown as { version?: number }[]).reduce(
        (sum, el) => sum + (el.version ?? 0),
        0,
      );
      const prevVersionSum = (prevElements as { version?: number }[]).reduce(
        (sum, el) => sum + (el.version ?? 0),
        0,
      );
      if (
        prevApp !== null &&
        elements.length === prevElements.length &&
        elementVersionSum === prevVersionSum &&
        !selChanged &&
        (appState.scrollX !== prevApp.scrollX ||
          appState.scrollY !== prevApp.scrollY ||
          appState.zoom.value !== prevApp.zoom.value) &&
        appState.editingTextElement === prevApp.editingTextElement
      ) {
        // Defer any pending save so JSON.stringify doesn't fire mid-pan.
        if (saveDebounceTimerRef.current !== null) {
          clearTimeout(saveDebounceTimerRef.current);
          saveDebounceTimerRef.current = setTimeout(pendingSaveCallbackRef.current, 200);
        }
        previousAppStateRef.current = appState;
        return;
      }
      previousAppStateRef.current = appState;

      const normalized = normalizeUserElements(elements as unknown as ExcalidrawElementStub[]);
      const sceneElements = normalized.elements;
      const previousElements = previousSceneElementsRef.current;

      // Selection update is cheap — always run it.
      setSelectedGraphNodeId(getSelectedGraphNode(sceneElements, appState.selectedElementIds)?.id ?? null);

      if (normalized.changed) {
        apiRef.current?.updateScene({
          elements: sceneElements as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }

      // Deletion detection must run immediately so the undo snapshot is taken
      // before the deleted element is gone from the array.
      if (suppressDeletionDetectionRef.current) {
        suppressDeletionDetectionRef.current = false;
      } else if (!pendingDeletionRef.current) {
        const deletedNode = findDeletedGraphNode(
          previousElements,
          sceneElements,
          latestAnalysisNodesRef.current,
          removedGraphNodeIdsRef.current,
        );

        if (deletedNode) {
          const callers = callerNodesFor(
            deletedNode.id,
            latestAnalysisNodesRef.current,
            latestAnalysisEdgesRef.current,
          );
          const stickyReviewIds = stickyReviewIdsForNode(previousElements, deletedNode.id);
          const requestId = `delete-${Date.now()}-${deletedNode.id}`;
          const fallbackImpacts = fallbackDeletionImpacts(callers);

          const nextPendingDeletion = {
            requestId,
            node: deletedNode,
            callers,
            snapshotElements: previousElements,
            stickyReviewIds,
            impacts: null,
          };
          pendingDeletionRef.current = nextPendingDeletion;
          setPendingDeletion(nextPendingDeletion);

          const requested = requestGraphNodeDeletionImpact({
            requestId,
            node: deletedNode,
            callers,
          });

          if (!requested) {
            setPendingDeletion((prev) => {
              if (prev?.requestId !== requestId) return prev;
              const next = { ...prev, impacts: fallbackImpacts };
              pendingDeletionRef.current = next;
              return next;
            });
          }

          suppressDeletionDetectionRef.current = true;
          apiRef.current?.updateScene({
            elements: previousElements as unknown as ExcalidrawElement[],
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          return;
        }
      }

      previousSceneElementsRef.current = sceneElements as unknown as ExcalidrawElementStub[];

      // Debounce the expensive serialize + save path so that rapid pan/zoom/
      // selection changes (which fire onChange every frame) don't block the
      // render thread with JSON.stringify on every tick.
      if (saveDebounceTimerRef.current !== null) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      const capturedElements = sceneElements;
      const capturedAppState = appState;
      const capturedFiles = files;
      const doSave = () => {
        saveDebounceTimerRef.current = null;
        pendingSaveCallbackRef.current = noop;
        const document = createCanvasDocumentFromScene({
          elements: capturedElements as unknown as ExcalidrawElementStub[],
          appState: capturedAppState as unknown as Record<string, unknown>,
          files: capturedFiles as unknown as Record<string, unknown>,
        });
        const content = serializeCanvasDocument(document);
        if (content === latestContentRef.current) return;
        latestContentRef.current = content;
        saveDocumentContent(content);
      };
      pendingSaveCallbackRef.current = doSave;
      saveDebounceTimerRef.current = setTimeout(doSave, 200);
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
    const nodeId = graphNodeIdFromElement(selectedNode);
    const graphNode = nodeId ? latestAnalysisNodesRef.current.find((node) => node.id === nodeId) : undefined;
    const reviewAnchor = graphNode
      ? {
          nodeId: graphNode.id,
          symbolId: graphNode.id,
          file: graphNode.file,
          range: graphNode.range,
        }
      : undefined;

    const { reviewId, elements: stickyElements } = createStickyForAnchor(anchor, {
      title: '',
      body: '',
      anchor: reviewAnchor,
      source: 'canvas',
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
        const anchor = readReviewAnchorFromScene(current, latestAnalysisNodesRef.current, prev.reviewId);
        const withText = updateStickyText(current, prev.reviewId, prev.title, prev.body);
        const committed = commitSticky(withText, prev.reviewId, {
          title: prev.title,
          body: prev.body,
          anchor,
          status: 'active',
          source: 'canvas',
        });
        api.updateScene({
          elements: committed as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        saveReviewSticky({
          reviewId: prev.reviewId,
          title: prev.title,
          body: prev.body,
          draft: false,
          anchor,
          status: 'active',
          source: 'canvas',
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

  const handleDeletionCancel = useCallback(() => {
    setPendingDeletion((prev) => {
      if (!prev) return prev;
      previousSceneElementsRef.current = prev.snapshotElements;
      suppressDeletionDetectionRef.current = true;
      apiRef.current?.updateScene({
        elements: prev.snapshotElements as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      pendingDeletionRef.current = null;
      return null;
    });
  }, []);

  const handleDeletionConfirm = useCallback(() => {
    setPendingDeletion((prev) => {
      if (!prev) return prev;
      const api = apiRef.current;
      const impacts = prev.impacts ?? fallbackDeletionImpacts(prev.callers);
      const baseElements = api
        ? (api.getSceneElements() as unknown as ExcalidrawElementStub[])
        : prev.snapshotElements;
      const next = removeGraphNodeElements(
        baseElements,
        prev.node.id,
        latestAnalysisEdgesRef.current,
        prev.stickyReviewIds,
      );

      removedGraphNodeIdsRef.current = new Set([
        ...Array.from(removedGraphNodeIdsRef.current),
        prev.node.id,
      ]);
      initialReviewStickiesRef.current = initialReviewStickiesRef.current.filter(
        (review) => !prev.stickyReviewIds.includes(review.reviewId),
      );
      previousSceneElementsRef.current = next;
      confirmGraphNodeRemoval({
        timestamp: new Date().toISOString(),
        node: prev.node,
        callerCount: prev.callers.length,
        stickyCount: prev.stickyReviewIds.length,
        stickyReviewIds: prev.stickyReviewIds,
        decision: 'confirmed',
        impacts,
      });

      if (api) {
        suppressDeletionDetectionRef.current = true;
        api.updateScene({
          elements: next as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }

      pendingDeletionRef.current = null;
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

      {pendingDeletion && (
        <div
          className="codetrace-canvas__delete-dialog"
          role="dialog"
          aria-label="Delete graph node"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="codetrace-canvas__delete-dialog-header">
            <h2>{pendingDeletion.node.name}</h2>
            <span>{pendingDeletion.callers.length} callers</span>
          </div>
          <div className="codetrace-canvas__delete-dialog-meta">
            <span>{pendingDeletion.node.file}</span>
            <span>
              {pendingDeletion.stickyReviewIds.length} stickies will be removed
            </span>
          </div>
          <div className="codetrace-canvas__delete-dialog-list">
            {pendingDeletion.impacts ? (
              pendingDeletion.impacts.length > 0 ? (
                pendingDeletion.impacts.map((impact, index) => (
                  <div className="codetrace-canvas__delete-dialog-row" key={`${impact.file}-${impact.range.startLine}-${index}`}>
                    <span data-case={impact.caseType}>{impact.caseType}</span>
                    <strong>{impact.callerName ?? 'workspace'}</strong>
                    <code>
                      {impact.file}:{impact.range.startLine}
                    </code>
                    <p>{impact.preview}</p>
                  </div>
                ))
              ) : (
                <p className="codetrace-canvas__delete-dialog-empty">No callers found.</p>
              )
            ) : (
              <p className="codetrace-canvas__delete-dialog-empty">Analyzing callers...</p>
            )}
          </div>
          <div className="codetrace-canvas__delete-dialog-actions">
            <button type="button" onClick={handleDeletionCancel} className="codetrace-canvas__button">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeletionConfirm}
              className="codetrace-canvas__button"
              data-danger
              disabled={!pendingDeletion.impacts}
            >
              Delete node
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
