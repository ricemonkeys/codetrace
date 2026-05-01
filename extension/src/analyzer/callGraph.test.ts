import * as path from 'path';
import {
  DEFAULT_ANALYZER_IGNORED_DIRECTORIES,
  extractCallGraphFromFiles,
  extractWorkspaceCallGraph,
} from './callGraph';

const fixturePath = path.join(__dirname, '__fixtures__', 'sample.ts');
const crossFileFixtureRoot = path.join(__dirname, '__fixtures__', 'cross-file');
const crossFileFixtureFiles = [
  path.join(crossFileFixtureRoot, 'entry.ts'),
  path.join(crossFileFixtureRoot, 'messages.ts'),
  path.join(crossFileFixtureRoot, 'worker.ts'),
];

describe('extractWorkspaceCallGraph (cross-file resolution)', () => {
  let graph: any;

  beforeAll(async () => {
    graph = await extractWorkspaceCallGraph(crossFileFixtureRoot);
  });

  test('loads all function-like nodes from the tsconfig workspace', () => {
    const names = graph.nodes.map((n: any) => n.name).sort();
    expect(names).toEqual([
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
      .filter((edge: any) => !edge.unresolved)
      .map((edge: any) => {
        const from = graph.nodes.find((node: any) => node.id === edge.from)!;
        const to = graph.nodes.find((node: any) => node.id === edge.to)!;
        return `${from.name}->${to.name}`;
      }).sort();

    expect(pairs).toEqual([
      'Worker.run->Worker.decorate',
      'buildMessage->normalize',
      'runAll->start',
      'start->Worker.run',
      'start->buildMessage',
    ]);
  });

  test('records cross-file edge endpoints with their declaring files', () => {
    const start = graph.nodes.find((node: any) => node.name === 'start')!;
    const buildMessage = graph.nodes.find((node: any) => node.name === 'buildMessage')!;
    const workerRun = graph.nodes.find((node: any) => node.name === 'Worker.run')!;

    expect(start.file).toContain(path.join('cross-file', 'entry.ts'));
    expect(buildMessage.file).toContain(path.join('cross-file', 'messages.ts'));
    expect(workerRun.file).toContain(path.join('cross-file', 'worker.ts'));

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: start.id, to: buildMessage.id },
        { from: start.id, to: workerRun.id },
      ]),
    );
  });

  test('does not implicitly climb to a parent tsconfig from a nested folder', async () => {
    const graph = await extractWorkspaceCallGraph(path.join(crossFileFixtureRoot, 'nested'), {
      searchParentTsconfig: false
    });

    expect(graph.nodes.map((node: any) => node.name)).toEqual(['nestedEntry']);
  });

  test('supports explicit file-list extraction for caller-owned discovery', async () => {
    const graph = await extractCallGraphFromFiles(crossFileFixtureFiles);
    const pairs = graph.edges.map((edge: any) => {
      const from = graph.nodes.find((node: any) => node.id === edge.from)!;
      const to = graph.nodes.find((node: any) => node.id === edge.to)!;
      return `${from.name}->${to.name}`;
    }).sort();

    expect(pairs).toEqual([
      'Worker.run->Worker.decorate',
      'buildMessage->normalize',
      'runAll->start',
      'start->Worker.run',
      'start->buildMessage',
    ]);
  });

  test('reports hybrid dispatcher metadata', () => {
    expect(graph.metadata.precision).toBe('premium');
    expect(graph.metadata.engine).toBe('Hybrid Dispatcher');
  });

  test('handles mixed-language buckets by merging results', async () => {
    // We mix a TS file (Premium) and a nonexistent JS file (Standard fallback/LSP)
    // Note: Standard analyzer will fail to find symbols for nonexistent, but should still return a graph
    const mixedFiles = [
      path.join(crossFileFixtureRoot, 'entry.ts'),
      path.join(crossFileFixtureRoot, 'nonexistent.js')
    ];
    
    const result = await extractWorkspaceCallGraph(crossFileFixtureRoot, {
      limitToFiles: mixedFiles
    });

    // Should have nodes from entry.ts (at least 'runAll' and 'start')
    const names = result.nodes.map(n => n.name);
    expect(names).toContain('runAll');
    expect(names).toContain('start');
    expect(result.metadata!.engine).toBe('Hybrid Dispatcher');
    // Precision should be premium because at least one bucket was premium
    expect(result.metadata!.precision).toBe('premium');
  });

  test('exposes the default fallback ignore policy', () => {
    expect(DEFAULT_ANALYZER_IGNORED_DIRECTORIES).toEqual(
      expect.arrayContaining(['.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out']),
    );
  });
});
