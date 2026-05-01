import * as assert from 'assert';
import * as path from 'path';
import {
  DEFAULT_ANALYZER_IGNORED_DIRECTORIES,
  extractCallGraphFromFiles,
  extractWorkspaceCallGraph,
} from '../../analyzer/callGraph';

// __dirname at runtime is `out/test/suite/`, but the fixture is a .ts source file
// kept under `src/`. Resolve back to the workspace src tree.
const fixturePath = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'analyzer',
  '__fixtures__',
  'sample.ts',
);
const crossFileFixtureRoot = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'analyzer',
  '__fixtures__',
  'cross-file',
);
const crossFileFixtureFiles = [
  path.join(crossFileFixtureRoot, 'entry.ts'),
  path.join(crossFileFixtureRoot, 'messages.ts'),
  path.join(crossFileFixtureRoot, 'worker.ts'),
];

suite('extractWorkspaceCallGraph (cross-file resolution)', () => {
  let graph: any;

  setup(async () => {
    graph = await extractWorkspaceCallGraph(crossFileFixtureRoot);
  });

  test('loads all function-like nodes from the tsconfig workspace', () => {
    const names = graph.nodes.map((n: any) => n.name).sort();
    assert.deepStrictEqual(names, [
      'Worker.decorate',
      'Worker.run',
      'buildMessage',
      'normalize',
      'runAll',
      'start',
    ]);
  });

  test('resolves imported functions and typed method calls across files', () => {
    const pairs = graph.edges
      .map((edge: any) => {
        const from = graph.nodes.find((node: any) => node.id === edge.from);
        const to = graph.nodes.find((node: any) => node.id === edge.to);
        return `${from?.name}->${to?.name}`;
      })
      .sort();

    assert.deepStrictEqual(pairs, [
      'Worker.run->Worker.decorate',
      'buildMessage->normalize',
      'runAll->start',
      'start->Worker.run',
      'start->buildMessage',
    ]);
  });

  test('records cross-file edge endpoints with their declaring files', () => {
    const start = graph.nodes.find((node: any) => node.name === 'start');
    const buildMessage = graph.nodes.find((node: any) => node.name === 'buildMessage');
    const workerRun = graph.nodes.find((node: any) => node.name === 'Worker.run');
    assert.ok(start, 'start node missing');
    assert.ok(buildMessage, 'buildMessage node missing');
    assert.ok(workerRun, 'Worker.run node missing');

    assert.ok(start!.file.includes(path.join('cross-file', 'entry.ts')));
    assert.ok(buildMessage!.file.includes(path.join('cross-file', 'messages.ts')));
    assert.ok(workerRun!.file.includes(path.join('cross-file', 'worker.ts')));

    assert.ok(graph.edges.some((edge: any) => edge.from === start!.id && edge.to === buildMessage!.id));
    assert.ok(graph.edges.some((edge: any) => edge.from === start!.id && edge.to === workerRun!.id));
  });

  test('does not implicitly climb to a parent tsconfig from a nested folder', async () => {
    const graph = await extractWorkspaceCallGraph(path.join(crossFileFixtureRoot, 'nested'), {
      searchParentTsconfig: false
    });

    assert.deepStrictEqual(graph.nodes.map((node: any) => node.name), ['nestedEntry']);
  });

  test('supports explicit file-list extraction for caller-owned discovery', async () => {
    const graph = await extractCallGraphFromFiles(crossFileFixtureFiles);
    const pairs = graph.edges
      .map((edge: any) => {
        const from = graph.nodes.find((node: any) => node.id === edge.from);
        const to = graph.nodes.find((node: any) => node.id === edge.to);
        return `${from?.name}->${to?.name}`;
      })
      .sort();

    assert.deepStrictEqual(pairs, [
      'Worker.run->Worker.decorate',
      'buildMessage->normalize',
      'runAll->start',
      'start->Worker.run',
      'start->buildMessage',
    ]);
  });

  test('reports hybrid dispatcher metadata', () => {
    assert.strictEqual(graph.metadata?.precision, 'premium');
    assert.strictEqual(graph.metadata?.engine, 'Hybrid Dispatcher');
  });

  test('exposes the default fallback ignore policy', () => {
    const ignoredDirectories: readonly string[] = DEFAULT_ANALYZER_IGNORED_DIRECTORIES;
    for (const directory of ['.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out']) {
      assert.ok(ignoredDirectories.includes(directory));
    }
  });
});
