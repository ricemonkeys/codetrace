import * as assert from 'assert';
import * as path from 'path';
import {
  markChangedFunctions,
  parseUnifiedDiffChangedRanges,
} from '../../git/changedRanges';
import type { FunctionNode } from '../../analyzer/types';

suite('git changed range detection', () => {
  test('collects changed line ranges from unified diff hunks', () => {
    const workspaceRoot = path.resolve('/repo');
    const file = path.resolve(workspaceRoot, 'src/sample.ts');
    const diff = [
      'diff --git a/src/sample.ts b/src/sample.ts',
      'index 1111111..2222222 100644',
      '--- a/src/sample.ts',
      '+++ b/src/sample.ts',
      '@@ -2,8 +2,9 @@ export function greet(name: string) {',
      '   const upper = name.toUpperCase();',
      '-  return helper(upper);',
      '+  const message = helper(upper);',
      '+  return message;',
      ' }',
      '',
    ].join('\n');

    assert.deepStrictEqual(parseUnifiedDiffChangedRanges(diff, workspaceRoot).get(file), [
      { startLine: 3, endLine: 4 },
    ]);
  });

  test('marks only nodes whose source range intersects changed lines', () => {
    const workspaceRoot = path.resolve('/repo');
    const file = path.resolve(workspaceRoot, 'src/sample.ts');
    const nodes: FunctionNode[] = [
      node('greet', file, 2, 6),
      node('Service.run', file, 10, 14),
      node('helper', file, 20, 22),
    ];
    const ranges = new Map([[file, [{ startLine: 11, endLine: 11 }]]]);

    assert.deepStrictEqual(
      markChangedFunctions(nodes, ranges).map((n) => [n.name, n.changedSinceBase]),
      [
        ['greet', false],
        ['Service.run', true],
        ['helper', false],
      ],
    );
  });
});

function node(name: string, file: string, startLine: number, endLine: number): FunctionNode {
  return {
    id: `${file}#${name}@${startLine}:1`,
    name,
    kind: 'function',
    file,
    range: {
      startLine,
      startColumn: 1,
      endLine,
      endColumn: 1,
    },
  };
}
