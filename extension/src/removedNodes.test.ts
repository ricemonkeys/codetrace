import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  analyzeNodeDeletionImpact,
  appendRemovedNodeLog,
  filterRemovedNodes,
  readRemovedNodeIds,
  type DeletionGraphNode,
} from './removedNodes';

const target: DeletionGraphNode = {
  id: 'src/lib.ts#target@1:1',
  name: 'target',
  kind: 'function',
  file: 'src/lib.ts',
  range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
};

const caller = (name: string, file: string): DeletionGraphNode => ({
  id: `${file}#${name}@1:1`,
  name,
  kind: 'function',
  file,
  range: { startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 },
});

describe('removed node impact analysis', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codetrace-removed-'));
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('classifies simple calls, value-used calls, and named imports', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'entry.ts'),
      [
        "import { target } from './lib';",
        'export function simple() {',
        '  target();',
        '}',
        'export function valued() {',
        '  return target();',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const response = await analyzeNodeDeletionImpact(workspaceRoot, {
      requestId: 'req',
      node: target,
      callers: [
        {
          ...caller('simple', 'src/entry.ts'),
          range: { startLine: 2, startColumn: 1, endLine: 4, endColumn: 1 },
        },
        {
          ...caller('valued', 'src/entry.ts'),
          range: { startLine: 5, startColumn: 1, endLine: 7, endColumn: 1 },
        },
      ],
    });

    expect(response.impacts.map((impact) => impact.caseType)).toEqual([
      'named-import',
      'simple-call',
      'value-used-call',
    ]);
    expect(response.impacts[1]).toMatchObject({
      file: 'src/entry.ts',
      range: { startLine: 3 },
      preview: 'target();',
    });
  });

  it('falls back to unknown when the caller source cannot be read', async () => {
    const response = await analyzeNodeDeletionImpact(workspaceRoot, {
      requestId: 'req',
      node: target,
      callers: [caller('missing', 'src/missing.ts')],
    });

    expect(response.impacts).toEqual([
      expect.objectContaining({
        caseType: 'unknown',
        callerName: 'missing',
      }),
    ]);
  });

  it('appends removed.log and reads confirmed removed node ids', async () => {
    await appendRemovedNodeLog(workspaceRoot, {
      timestamp: '2026-05-05T00:00:00.000Z',
      node: target,
      callerCount: 2,
      stickyCount: 1,
      decision: 'confirmed',
      impacts: [],
    });

    const log = await fs.readFile(path.join(workspaceRoot, '.codetrace', 'removed.log'), 'utf8');
    expect(log).toContain('"callerCount":2');
    await expect(readRemovedNodeIds(workspaceRoot)).resolves.toEqual(new Set([target.id]));
  });

  it('filters removed nodes and incident edges from a graph', () => {
    const graph = {
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'a', to: 'c' },
      ],
      metadata: { engine: 'test' },
    };

    expect(filterRemovedNodes(graph, new Set(['b']))).toEqual({
      nodes: [{ id: 'a' }, { id: 'c' }],
      edges: [{ from: 'a', to: 'c' }],
      metadata: { engine: 'test' },
    });
  });
});
