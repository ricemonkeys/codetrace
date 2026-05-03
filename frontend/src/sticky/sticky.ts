import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import { ulid } from 'ulid';

import type { ExcalidrawElementStub } from '../types/CanvasDocument';
import { STICKY_ELEMENT_KIND, isReviewStickyCustomData, type ReviewStickyCustomData } from './types';

export const STICKY_WIDTH = 200;
export const STICKY_HEIGHT = 120;
const STICKY_OFFSET_X = 32;
const STICKY_OFFSET_Y = -32;

const STICKY_BG = '#fef9c3';
const STICKY_STROKE = '#ca8a04';
const CONNECTOR_STROKE = '#ca8a04';

export interface AnchorBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreateStickyOptions {
  reviewId?: string;
  title?: string;
  body?: string;
}

export interface CreateStickyResult {
  reviewId: string;
  elements: ExcalidrawElementStub[];
  bodyElementId: string;
  connectorElementId: string;
}

function bodyElementId(reviewId: string): string {
  return `sticky-body-${reviewId}`;
}

function connectorElementId(reviewId: string): string {
  return `sticky-connector-${reviewId}`;
}

function defaultText(title: string, body: string): string {
  if (!title && !body) return '';
  if (!body) return title;
  if (!title) return body;
  return `${title}\n\n${body}`;
}

/**
 * Build a draft sticky note attached to the anchor element box.
 * Returns deterministic ids so the App layer can later locate the body for
 * editing or removal without scanning by reviewId again.
 */
export function createStickyForAnchor(
  anchor: AnchorBox,
  options: CreateStickyOptions = {},
): CreateStickyResult {
  const reviewId = options.reviewId ?? ulid();
  const stickyX = anchor.x + anchor.width + STICKY_OFFSET_X;
  const stickyY = anchor.y + STICKY_OFFSET_Y;

  const body: ReviewStickyCustomData = {
    kind: STICKY_ELEMENT_KIND,
    reviewId,
    draft: true,
    anchorElementId: anchor.id,
    role: 'body',
  };
  const connector: ReviewStickyCustomData = {
    kind: STICKY_ELEMENT_KIND,
    reviewId,
    draft: true,
    anchorElementId: anchor.id,
    role: 'connector',
  };

  const labelText = defaultText(options.title ?? '', options.body ?? '');

  const skeletons: ExcalidrawElementSkeleton[] = [
    {
      type: 'rectangle',
      id: bodyElementId(reviewId),
      x: stickyX,
      y: stickyY,
      width: STICKY_WIDTH,
      height: STICKY_HEIGHT,
      backgroundColor: STICKY_BG,
      strokeColor: STICKY_STROKE,
      fillStyle: 'solid',
      roundness: { type: 3 },
      locked: false,
      customData: body,
      label: labelText
        ? {
            text: labelText,
            fontSize: 14,
            strokeColor: STICKY_STROKE,
            textAlign: 'left',
            verticalAlign: 'top',
          }
        : undefined,
    },
    {
      type: 'arrow',
      id: connectorElementId(reviewId),
      x: 0,
      y: 0,
      strokeColor: CONNECTOR_STROKE,
      strokeStyle: 'dashed',
      locked: false,
      customData: connector,
      start: { id: anchor.id },
      end: { id: bodyElementId(reviewId) },
    },
  ];

  const built = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  }) as unknown as ExcalidrawElement[];

  // Stamp customData on bound label so it travels with the sticky.
  const stubs = built.map((element) => stampStickyCustomData(element as unknown as ExcalidrawElementStub, reviewId, anchor.id));

  return {
    reviewId,
    elements: stubs,
    bodyElementId: bodyElementId(reviewId),
    connectorElementId: connectorElementId(reviewId),
  };
}

function stampStickyCustomData(
  element: ExcalidrawElementStub,
  reviewId: string,
  anchorElementId: string,
): ExcalidrawElementStub {
  const existing = element.customData as ReviewStickyCustomData | undefined;
  if (existing?.kind === STICKY_ELEMENT_KIND) return element;

  // Bound label inside the sticky body inherits sticky tagging.
  if (
    element.type === 'text' &&
    typeof element.containerId === 'string' &&
    element.containerId === bodyElementId(reviewId)
  ) {
    return {
      ...element,
      customData: {
        kind: STICKY_ELEMENT_KIND,
        reviewId,
        draft: true,
        anchorElementId,
        role: 'body',
      } satisfies ReviewStickyCustomData,
    };
  }
  return element;
}

export function isStickyElement(element: ExcalidrawElementStub): boolean {
  return isReviewStickyCustomData(element.customData);
}

export function getStickyReviewId(element: ExcalidrawElementStub): string | undefined {
  const data = element.customData;
  if (!isReviewStickyCustomData(data)) return undefined;
  return data.reviewId;
}

/**
 * Mark every element belonging to a sticky group as committed (draft = false).
 * Used by the save action.
 */
export function commitSticky(
  elements: readonly ExcalidrawElementStub[],
  reviewId: string,
): ExcalidrawElementStub[] {
  return elements.map((element) => {
    const data = element.customData;
    if (!isReviewStickyCustomData(data) || data.reviewId !== reviewId) return element;
    return {
      ...element,
      customData: { ...data, draft: false } satisfies ReviewStickyCustomData,
    };
  });
}

/**
 * Drop every element belonging to a sticky group. Used by cancel and delete.
 */
export function removeSticky(
  elements: readonly ExcalidrawElementStub[],
  reviewId: string,
): ExcalidrawElementStub[] {
  return elements.filter((element) => {
    const data = element.customData;
    return !isReviewStickyCustomData(data) || data.reviewId !== reviewId;
  });
}

/**
 * Update the rendered text on the sticky's bound label.
 * If the label element does not exist (e.g. created without text and Excalidraw
 * did not generate a label), this is a no-op; the App layer is expected to
 * recreate the sticky in that case.
 */
export function updateStickyText(
  elements: readonly ExcalidrawElementStub[],
  reviewId: string,
  title: string,
  body: string,
): ExcalidrawElementStub[] {
  const text = defaultText(title, body);
  return elements.map((element) => {
    const data = element.customData;
    if (!isReviewStickyCustomData(data) || data.reviewId !== reviewId) return element;
    if (element.type !== 'text') return element;
    return {
      ...element,
      text,
      originalText: text,
    };
  });
}

export interface StickyGroup {
  reviewId: string;
  body?: ExcalidrawElementStub;
  connector?: ExcalidrawElementStub;
  label?: ExcalidrawElementStub;
}

export function listStickyGroups(elements: readonly ExcalidrawElementStub[]): StickyGroup[] {
  const groups = new Map<string, StickyGroup>();
  for (const element of elements) {
    const data = element.customData;
    if (!isReviewStickyCustomData(data)) continue;
    const group = groups.get(data.reviewId) ?? { reviewId: data.reviewId };
    if (data.role === 'body') {
      if (element.type === 'rectangle') group.body = element;
      else if (element.type === 'text') group.label = element;
    } else if (data.role === 'connector') {
      group.connector = element;
    }
    groups.set(data.reviewId, group);
  }
  return Array.from(groups.values());
}
