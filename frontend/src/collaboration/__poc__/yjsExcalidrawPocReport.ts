import {
  DIRECT_YJS_BINDING_FOOTPRINT,
} from './directYjsBindingPoc';
import {
  Y_EXCALIDRAW_ADAPTER_FOOTPRINT,
} from './yExcalidrawAdapterPoc';

export type PocDecision = 'direct-y-map';

export const YJS_EXCALIDRAW_POC_REPORT = {
  issue: 4,
  evaluatedAt: '2026-05-01',
  decision: 'direct-y-map' as PocDecision,
  candidates: {
    thirdPartyAdapter: {
      ...Y_EXCALIDRAW_ADAPTER_FOOTPRINT,
      conflictResult:
        'Concurrent edits to different fields of the same element converge, but one full element object wins; an independent field edit can be lost.',
      maintenanceResult:
        'Fastest to integrate, but the adapter owns Excalidraw diff semantics; direct Jest/CJS import also hits its fractional-indexing ESM dependency.',
    },
    directBinding: {
      ...DIRECT_YJS_BINDING_FOOTPRINT,
      conflictResult:
        'Concurrent edits to different fields of the same element merge because each field is a separate Y.Map entry; same-field edits remain deterministic Yjs conflict resolution.',
      maintenanceResult:
        'More implementation work, but the data model stays explicit and can preserve CodeTrace card customData without depending on adapter internals.',
    },
  },
  bundleNotes: [
    'Both candidates require yjs; npm reported yjs@13.6.30 dist.unpackedSize as 2,304,938 bytes on 2026-05-01.',
    'The third-party adapter adds y-excalidraw@2.0.12, reported dist.unpackedSize 117,002 bytes, plus fractional-indexing.',
    'y-excalidraw is kept as a devDependency for PoC/reference use; it is not part of the current webview runtime bundle.',
    'The direct binding adds no adapter package beyond yjs, but requires CodeTrace-owned sync logic.',
  ],
  recommendation:
    'Use the direct Y.Map<elementId, Y.Map<field, value>> binding for Phase 2. Keep y-excalidraw as a reference implementation, not as the primary adapter.',
} as const;

export function formatYjsExcalidrawPocComment(): string {
  const report = YJS_EXCALIDRAW_POC_REPORT;

  return [
    '## Yjs + Excalidraw binding PoC result',
    '',
    `Decision: **${report.recommendation}**`,
    '',
    '### Comparison',
    '',
    '| Candidate | Conflict behavior | Bundle / dependency impact | Maintenance |',
    '|---|---|---|---|',
    `| (B) ${report.candidates.thirdPartyAdapter.packageName}@${report.candidates.thirdPartyAdapter.version} | ${report.candidates.thirdPartyAdapter.conflictResult} | Adds y-excalidraw (~117 KB unpacked) and fractional-indexing on top of yjs. | ${report.candidates.thirdPartyAdapter.maintenanceResult} |`,
    `| (C) Direct Y.Map binding | ${report.candidates.directBinding.conflictResult} | Adds only yjs at runtime; no adapter package. | ${report.candidates.directBinding.maintenanceResult} |`,
    '',
    '### Validation',
    '',
    '- Added deterministic Yjs unit tests for both candidates.',
    '- Verified adapter behavior using the `y-excalidraw` Y.Array/Y.Map storage shape.',
    '- Verified direct binding behavior using `Y.Map<elementId, Y.Map<field, value>>`.',
    '',
    '### Follow-up',
    '',
    '- Phase 2 should implement the direct binding behind a small CodeTrace-owned adapter interface.',
    '- Same-field conflicts still need product semantics such as version comparison or user-facing conflict hints.',
  ].join('\n');
}
