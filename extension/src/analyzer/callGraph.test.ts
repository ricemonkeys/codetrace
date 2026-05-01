import * as path from 'path';
import { extractCallGraph } from './callGraph';

const fixturePath = path.join(__dirname, '__fixtures__', 'sample.ts');

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
