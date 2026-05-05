import { REVIEW_STICKY_KIND } from '../graph/types';
import type { GraphSourceRange } from '../graph/types';
import { isNonEmptyString, isRecord } from '../types/utils';

/**
 * Re-export the canonical kind constant from graph/types so the sticky module
 * stays in lockstep with userElements / partition logic that already classifies
 * by REVIEW_STICKY_KIND.
 */
export const STICKY_ELEMENT_KIND = REVIEW_STICKY_KIND;

export type ReviewStickyStatus =
  | 'active'
  | 'orphan-marker'
  | 'orphan-body'
  | 'merge-conflict'
  | 'anchor-lost';

export interface ReviewStickyAnchor {
  nodeId?: string;
  symbolId?: string;
  file?: string;
  range?: GraphSourceRange;
  lineHash?: string;
}

export interface ReviewStickyRoundTripData {
  reviewId: string;
  title: string;
  body: string;
  draft?: boolean;
  createdAt?: string;
  anchor?: ReviewStickyAnchor;
  status?: ReviewStickyStatus;
  source?: 'marker' | 'body' | 'both' | 'canvas' | 'roundtrip';
  warning?: string;
}

export interface ReviewStickyCustomData {
  kind: typeof STICKY_ELEMENT_KIND;
  /** ULID assigned at creation; stable across renames and re-renders. */
  reviewId: string;
  /** True while the sticky is being authored and not yet committed. */
  draft?: boolean;
  /** Element id of the anchor (auto-generated graph node) the sticky is attached to. */
  anchorElementId?: string;
  /** Source/symbol anchor used by the extension to restore the sticky later. */
  anchor?: ReviewStickyAnchor;
  /** Last committed title/body pair mirrored into source markers and markdown. */
  title?: string;
  body?: string;
  /** Round-trip reconciliation status from extension-side load. */
  status?: ReviewStickyStatus;
  source?: ReviewStickyRoundTripData['source'];
  warning?: string;
  /**
   * Distinguishes the sticky body element from its anchor connector.
   * Both share the same reviewId so cancellation/save can clean them up together.
   */
  role: 'body' | 'connector';
}

export function isReviewStickyCustomData(value: unknown): value is ReviewStickyCustomData {
  if (!isRecord(value)) return false;
  if (value.kind !== STICKY_ELEMENT_KIND) return false;
  if (!isNonEmptyString(value.reviewId)) return false;
  if (value.role !== 'body' && value.role !== 'connector') return false;
  return true;
}

export function isReviewStickyRoundTripData(value: unknown): value is ReviewStickyRoundTripData {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.reviewId)) return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.body !== 'string') return false;
  return true;
}
