import { REVIEW_STICKY_KIND } from '../graph/types';
import { isNonEmptyString, isRecord } from '../types/utils';

/**
 * Re-export the canonical kind constant from graph/types so the sticky module
 * stays in lockstep with userElements / partition logic that already classifies
 * by REVIEW_STICKY_KIND.
 */
export const STICKY_ELEMENT_KIND = REVIEW_STICKY_KIND;

export interface ReviewStickyCustomData {
  kind: typeof STICKY_ELEMENT_KIND;
  /** ULID assigned at creation; stable across renames and re-renders. */
  reviewId: string;
  /** True while the sticky is being authored and not yet committed. */
  draft?: boolean;
  /** Element id of the anchor (auto-generated graph node) the sticky is attached to. */
  anchorElementId?: string;
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
