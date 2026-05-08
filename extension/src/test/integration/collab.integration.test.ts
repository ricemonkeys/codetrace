/**
 * Phase 1 통합 테스트 — 두 사용자 협업 시나리오 (#97)
 *
 * git bare repo + 두 worktree(userA, userB) 구성으로 실제 push/pull 흐름을 시뮬레이션.
 * @vscode/test-electron 없이 순수 노드 레벨에서 검증.
 */

import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  loadReviewStickies,
  persistReviewSticky,
} from '../../reviews/reviewRoundTrip';
import {
  analyzeNodeDeletionImpact,
  appendRemovedNodeLog,
  filterRemovedNodes,
  readRemovedNodeIds,
  type DeletionGraphNode,
  type RemovedNodeLogEntry,
} from '../../removedNodes';

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

interface CollabHarness {
  bare: string;
  userA: string;
  userB: string;
}

async function createHarness(): Promise<CollabHarness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codetrace-collab-'));
  const bare = path.join(root, 'origin.git');
  const userA = path.join(root, 'userA');
  const userB = path.join(root, 'userB');

  exec(`git init --bare -b main "${bare}"`);
  exec(`git clone "${bare}" "${userA}"`);
  exec(`git clone "${bare}" "${userB}"`);

  // Seed: one TS file so both repos have a common commit
  await fs.mkdir(path.join(userA, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(userA, 'src', 'api.ts'),
    'export function fetchUser(id: string) {\n  return fetch(`/users/${id}`);\n}\n',
    'utf8',
  );
  execIn(userA, 'git add -A && git commit -m "init" && git push origin main');
  execIn(userB, 'git pull origin main');

  return { bare, userA, userB };
}

async function cleanHarness(harness: CollabHarness): Promise<void> {
  const root = path.dirname(harness.bare);
  await fs.rm(root, { recursive: true, force: true });
}

function exec(cmd: string): void {
  execSync(cmd, { stdio: 'pipe' });
}

function execIn(cwd: string, cmd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Scenario A — sticky round-trip
// ---------------------------------------------------------------------------

describe('Scenario A — sticky round-trip across git push/pull', () => {
  let h: CollabHarness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await cleanHarness(h);
  });

  it('userB restores the same sticky on the same node after userA pushes', async () => {
    // userA: persist a sticky
    await persistReviewSticky(h.userA, {
      reviewId: 'r-collab-1',
      title: 'Check fetch error handling',
      body: 'Add try/catch for network failure',
      anchor: {
        nodeId: 'src/api.ts#fetchUser',
        symbolId: 'src/api.ts#fetchUser',
        file: 'src/api.ts',
        range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
      },
    });

    // userA: commit & push
    execIn(
      h.userA,
      'git add -A && git commit -m "add sticky review" && git push origin main',
    );

    // userB: pull
    execIn(h.userB, 'git pull origin main');

    // userB: load stickies — should find exactly one active sticky
    const stickies = await loadReviewStickies(h.userB);

    expect(stickies).toHaveLength(1);
    expect(stickies[0]).toMatchObject({
      reviewId: 'r-collab-1',
      title: 'Check fetch error handling',
      body: 'Add try/catch for network failure',
      status: 'active',
      source: 'both',
    });
    expect(stickies[0].anchor?.nodeId).toBe('src/api.ts#fetchUser');
  });
});

// ---------------------------------------------------------------------------
// Scenario B — node position preservation across re-analysis
// ---------------------------------------------------------------------------

describe('Scenario B — node position preservation after re-analysis', () => {
  it('positions serialized to .codetrace file survive a userB pull', async () => {
    const h = await createHarness();
    try {
      // userA: write a .codetrace canvas file with explicit node positions
      const canvasDir = path.join(h.userA, '.codetrace', 'canvases');
      await fs.mkdir(canvasDir, { recursive: true });

      const canvasDoc = {
        version: 1,
        elements: [
          {
            id: 'auto-node-src/api.ts#fetchUser',
            type: 'rectangle',
            x: 450,
            y: 280,
            width: 160,
            height: 40,
            customData: { kind: 'graphNode', nodeId: 'src/api.ts#fetchUser' },
          },
        ],
        appState: {},
      };
      await fs.writeFile(
        path.join(canvasDir, 'main.codetrace'),
        JSON.stringify(canvasDoc, null, 2),
        'utf8',
      );

      execIn(
        h.userA,
        'git add -A && git commit -m "add canvas with positions" && git push origin main',
      );
      execIn(h.userB, 'git pull origin main');

      // userB: read the canvas and verify positions are intact
      const raw = await fs.readFile(
        path.join(h.userB, '.codetrace', 'canvases', 'main.codetrace'),
        'utf8',
      );
      const parsed = JSON.parse(raw);
      const node = parsed.elements[0];

      expect(node.x).toBe(450);
      expect(node.y).toBe(280);
      expect(node.customData.nodeId).toBe('src/api.ts#fetchUser');
    } finally {
      await cleanHarness(h);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario C — node deletion log + impact analysis
//
// Caller source transformation (주석 치환·import 제거) is not yet implemented
// in the codebase (no ts-morph apply layer exists as of #93). Those assertions
// belong in future tests once the apply layer ships. This suite covers:
//   - removed.log append/read round-trip over git push/pull
//   - filterRemovedNodes graph pruning
//   - analyzeNodeDeletionImpact classification of caller source
// ---------------------------------------------------------------------------

describe('Scenario C — node deletion log consistency across git push/pull', () => {
  let h: CollabHarness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await cleanHarness(h);
  });

  it('userB sees deleted node ids after userA deletes and pushes', async () => {
    const node: DeletionGraphNode = {
      id: 'src/api.ts#fetchUser',
      name: 'fetchUser',
      kind: 'function',
      file: 'src/api.ts',
      range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
    };

    const entry: RemovedNodeLogEntry = {
      node,
      callerCount: 0,
      stickyCount: 0,
      decision: 'confirmed',
      impacts: [],
    };

    // userA: append deletion log, commit, push
    await appendRemovedNodeLog(h.userA, entry);
    execIn(
      h.userA,
      'git add -A && git commit -m "delete fetchUser node" && git push origin main',
    );

    // userB: pull and read removed ids
    execIn(h.userB, 'git pull origin main');
    const removedIds = await readRemovedNodeIds(h.userB);

    expect(removedIds.has('src/api.ts#fetchUser')).toBe(true);
  });

  it('filterRemovedNodes removes deleted nodes and their incident edges from the graph', () => {
    const graph = {
      nodes: [
        { id: 'src/api.ts#fetchUser', name: 'fetchUser', file: 'src/api.ts' },
        { id: 'src/api.ts#buildUrl', name: 'buildUrl', file: 'src/api.ts' },
      ],
      edges: [
        { from: 'src/api.ts#fetchUser', to: 'src/api.ts#buildUrl' },
        { from: 'src/app.ts#main', to: 'src/api.ts#fetchUser' },
      ],
    };

    const filtered = filterRemovedNodes(graph, new Set(['src/api.ts#fetchUser']));

    expect(filtered.nodes).toEqual([
      { id: 'src/api.ts#buildUrl', name: 'buildUrl', file: 'src/api.ts' },
    ]);
    expect(filtered.edges).toHaveLength(0);
  });

  it('analyzeNodeDeletionImpact classifies simple call in caller source', async () => {
    const h2 = await createHarness();
    try {
      await fs.writeFile(
        path.join(h2.userA, 'src', 'app.ts'),
        'import { fetchUser } from "./api";\nfetchUser("u1");\n',
        'utf8',
      );

      const request = {
        requestId: 'req-1',
        node: {
          id: 'src/api.ts#fetchUser',
          name: 'fetchUser',
          kind: 'function',
          file: 'src/api.ts',
          range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
        },
        callers: [
          {
            id: 'src/app.ts#main',
            name: 'main',
            file: 'src/app.ts',
            range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 20 },
          },
        ],
      };

      const result = await analyzeNodeDeletionImpact(h2.userA, request);

      expect(result.requestId).toBe('req-1');
      const callImpact = result.impacts.find((i) => i.caseType === 'simple-call');
      expect(callImpact).toBeDefined();
      expect(callImpact?.preview).toContain('fetchUser');
    } finally {
      await cleanHarness(h2);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario D — edge cases (orphan marker / orphan body)
// ---------------------------------------------------------------------------

describe('Scenario D — edge cases per §C5', () => {
  let h: CollabHarness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await cleanHarness(h);
  });

  it('orphan marker (marker present, md missing) → status=orphan-marker', async () => {
    // Write a source marker without the corresponding md file
    const srcPath = path.join(h.userA, 'src', 'api.ts');
    await fs.writeFile(
      srcPath,
      '// review: orphan-r1 Orphaned title\nexport function fetchUser(id: string) {\n  return fetch(`/users/${id}`);\n}\n',
      'utf8',
    );

    const stickies = await loadReviewStickies(h.userA);

    expect(stickies).toHaveLength(1);
    expect(stickies[0].status).toBe('orphan-marker');
    expect(stickies[0].reviewId).toBe('orphan-r1');
  });

  it('orphan body (md present, marker missing) → status=orphan-body, preserved', async () => {
    // Write only the md body, no source marker
    const reviewDir = path.join(h.userA, '.codetrace', 'reviews');
    await fs.mkdir(reviewDir, { recursive: true });
    await fs.writeFile(
      path.join(reviewDir, 'orphan-r2.md'),
      [
        '---',
        'reviewId: "orphan-r2"',
        'title: "Orphaned body"',
        'anchorNodeId: "src/api.ts#fetchUser"',
        'file: "src/api.ts"',
        '---',
        '',
        'This body has no source marker.',
      ].join('\n'),
      'utf8',
    );

    const stickies = await loadReviewStickies(h.userA);

    expect(stickies).toHaveLength(1);
    expect(stickies[0].status).toBe('orphan-body');
    expect(stickies[0].reviewId).toBe('orphan-r2');
  });

  it('both sides (marker + md) survive a full git round-trip → status=active on userB', async () => {
    await persistReviewSticky(h.userA, {
      reviewId: 'round-r3',
      title: 'Round-trip check',
      body: 'Verify this survives push/pull',
      anchor: {
        nodeId: 'src/api.ts#fetchUser',
        symbolId: 'src/api.ts#fetchUser',
        file: 'src/api.ts',
        range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 },
      },
    });

    execIn(
      h.userA,
      'git add -A && git commit -m "sticky round-trip" && git push origin main',
    );
    execIn(h.userB, 'git pull origin main');

    const stickies = await loadReviewStickies(h.userB);

    expect(stickies).toHaveLength(1);
    expect(stickies[0]).toMatchObject({
      reviewId: 'round-r3',
      status: 'active',
      source: 'both',
    });
  });
});
