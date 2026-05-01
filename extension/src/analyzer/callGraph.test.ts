import * as path from 'path';
import { extractCallGraph, extractWorkspaceCallGraph } from './callGraph';

const fixturePath = path.join(__dirname, '__fixtures__', 'sample.ts');
const crossFileFixtureRoot = path.join(__dirname, '__fixtures__', 'cross-file');

describe('extractCallGraph (single file)', () => {
  const graph = extractCallGraph(fixturePath);

  test('extracts 5 function-like nodes (function, arrow, two methods, helper)', () => {
    const names = graph.nodes.map(n => n.name).sort();
    expect(names).toEqual(['Service.run', 'Service.runInner', 'greet', 'helper', 'sayHi']);
  });

  test('classifies node kinds', () => {
    const kindByName = Object.fromEntries(graph.nodes.map(n => [n.name, n.kind]));
    expect(kindByName).toEqual({
      greet: 'function',
      sayHi: 'arrow',
      'Service.run': 'method',
      'Service.runInner': 'method',
      helper: 'function',
    });
  });

  test('records the three intra-file calls (greet→helper, sayHi→greet, run→runInner)', () => {
    const idByName = Object.fromEntries(graph.nodes.map(n => [n.name, n.id]));
    const pairs = graph.edges.map(e => {
      const fromName = graph.nodes.find(n => n.id === e.from)?.name;
      const toName = graph.nodes.find(n => n.id === e.to)?.name;
      return `${fromName}->${toName}`;
    }).sort();
    expect(pairs).toEqual([
      'Service.run->Service.runInner',
      'greet->helper',
      'sayHi->greet',
    ]);

    // ids are well-formed (no orphan edges)
    for (const edge of graph.edges) {
      expect(Object.values(idByName)).toContain(edge.from);
      expect(Object.values(idByName)).toContain(edge.to);
    }
  });

  test('node ranges are 1-based and contain the declaration', () => {
    const greet = graph.nodes.find(n => n.name === 'greet')!;
    expect(greet.range.startLine).toBeGreaterThan(0);
    expect(greet.range.endLine).toBeGreaterThanOrEqual(greet.range.startLine);
    expect(greet.file).toBe(fixturePath);
  });

  test('node IDs are stable across repeated extraction', () => {
    const again = extractCallGraph(fixturePath);
    const idsA = graph.nodes.map(n => n.id).sort();
    const idsB = again.nodes.map(n => n.id).sort();
    expect(idsB).toEqual(idsA);
  });
});

describe('extractCallGraph — unresolved receivers', () => {
  const unresolvedPath = path.join(__dirname, '__fixtures__', 'unresolved.ts');
  const graph = extractCallGraph(unresolvedPath);

  test('caller(obj).obj.run() does not create any outbound edge', () => {
    const callerNode = graph.nodes.find(n => n.name === 'caller')!;
    const callerSources = graph.edges.filter(e => e.from === callerNode.id);
    expect(callerSources).toEqual([]);
  });

  test('viaReturn() only edges to build, never to .run() target', () => {
    // viaReturn() calls build() (resolvable) and build().run() (NOT resolvable).
    // We expect exactly one outbound edge: viaReturn → build.
    const viaReturnNode = graph.nodes.find(n => n.name === 'viaReturn')!;
    const buildNode = graph.nodes.find(n => n.name === 'build')!;
    const outbound = graph.edges
      .filter(e => e.from === viaReturnNode.id)
      .map(e => graph.nodes.find(n => n.id === e.to)?.name);

    expect(outbound).toEqual([buildNode.name]);
  });

  test('Service.run / Worker.run never appear as edge targets in this fixture', () => {
    const targets = graph.edges.map(e => {
      return graph.nodes.find(n => n.id === e.to)?.name;
    });
    expect(targets).not.toContain('Service.run');
    expect(targets).not.toContain('Worker.run');
  });
});

describe('extractWorkspaceCallGraph (cross-file resolution)', () => {
  const graph = extractWorkspaceCallGraph(crossFileFixtureRoot);

  test('loads all function-like nodes from the tsconfig workspace', () => {
    const names = graph.nodes.map(n => n.name).sort();
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
    const pairs = graph.edges.map(edge => {
      const from = graph.nodes.find(node => node.id === edge.from)!;
      const to = graph.nodes.find(node => node.id === edge.to)!;
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
    const start = graph.nodes.find(node => node.name === 'start')!;
    const buildMessage = graph.nodes.find(node => node.name === 'buildMessage')!;
    const workerRun = graph.nodes.find(node => node.name === 'Worker.run')!;

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
});
