import * as assert from 'assert';
import * as path from 'path';
import { extractCallGraph } from '../../analyzer/callGraph';

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

suite('extractCallGraph (single file)', () => {
  const graph = extractCallGraph(fixturePath);

  test('extracts five function-like nodes', () => {
    const names = graph.nodes.map(n => n.name).sort();
    assert.deepStrictEqual(names, [
      'Service.run',
      'Service.runInner',
      'greet',
      'helper',
      'sayHi',
    ]);
  });

  test('classifies node kinds', () => {
    const kindByName = Object.fromEntries(graph.nodes.map(n => [n.name, n.kind]));
    assert.deepStrictEqual(kindByName, {
      greet: 'function',
      sayHi: 'arrow',
      'Service.run': 'method',
      'Service.runInner': 'method',
      helper: 'function',
    });
  });

  test('records the three intra-file calls', () => {
    const pairs = graph.edges
      .map(e => {
        const fromName = graph.nodes.find(n => n.id === e.from)?.name;
        const toName = graph.nodes.find(n => n.id === e.to)?.name;
        return `${fromName}->${toName}`;
      })
      .sort();
    assert.deepStrictEqual(pairs, [
      'Service.run->Service.runInner',
      'greet->helper',
      'sayHi->greet',
    ]);
  });

  test('node IDs are stable across repeated extraction', () => {
    const again = extractCallGraph(fixturePath);
    const idsA = graph.nodes.map(n => n.id).sort();
    const idsB = again.nodes.map(n => n.id).sort();
    assert.deepStrictEqual(idsB, idsA);
  });
});

suite('extractCallGraph — unresolved receivers', () => {
  const unresolvedPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'src',
    'analyzer',
    '__fixtures__',
    'unresolved.ts',
  );
  const graph = extractCallGraph(unresolvedPath);

  test('caller(obj).obj.run() does not create any outbound edge', () => {
    const callerNode = graph.nodes.find(n => n.name === 'caller');
    assert.ok(callerNode, 'caller node missing');
    const outbound = graph.edges.filter(e => e.from === callerNode!.id);
    assert.deepStrictEqual(outbound, []);
  });

  test('viaReturn() only edges to build, never to .run() target', () => {
    const viaReturnNode = graph.nodes.find(n => n.name === 'viaReturn');
    const buildNode = graph.nodes.find(n => n.name === 'build');
    assert.ok(viaReturnNode, 'viaReturn node missing');
    assert.ok(buildNode, 'build node missing');

    const outbound = graph.edges
      .filter(e => e.from === viaReturnNode!.id)
      .map(e => graph.nodes.find(n => n.id === e.to)?.name);

    assert.deepStrictEqual(outbound, [buildNode!.name]);
  });

  test('Service.run / Worker.run never appear as edge targets', () => {
    const targets = graph.edges.map(e => graph.nodes.find(n => n.id === e.to)?.name);
    assert.ok(!targets.includes('Service.run'));
    assert.ok(!targets.includes('Worker.run'));
  });
});
