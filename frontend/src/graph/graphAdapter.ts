import type { Edge } from '@xyflow/react';
import type { CallEdge } from './types';

/**
 * Convert analyzer call edges into React Flow edges, collapsing duplicates.
 *
 * The analyzer emits one edge per call expression, so a function calling the
 * same callee multiple times produces several `{ from, to }` records. React
 * Flow uses edge id as identity; passing duplicate ids triggers warnings and
 * causes one of the edges to be dropped or have its state cross-contaminated.
 *
 * For visualization the relation "A calls B" is what matters, not the call
 * count. We dedupe by `(from, to)` here. If call counts become a UI need,
 * attach them as edge data without changing the id strategy.
 */
export function toReactFlowEdges(callEdges: readonly CallEdge[]): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const e of callEdges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, source: e.from, target: e.to });
  }
  return out;
}
