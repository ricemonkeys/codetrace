import * as assert from 'assert';
import * as path from 'path';
import { buildAnalysisMessage } from '../../callGraph/buildAnalysisMessage';

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

suite('buildAnalysisMessage', () => {
  test('returns analysisResult with the extracted graph for a .ts file', () => {
    const msg = buildAnalysisMessage(fixturePath);
    assert.strictEqual(msg.type, 'analysisResult');
    if (msg.type !== 'analysisResult') return;
    const names = msg.graph.nodes.map(n => n.name).sort();
    assert.deepStrictEqual(names, [
      'Service.run',
      'Service.runInner',
      'greet',
      'helper',
      'sayHi',
    ]);
  });

  test('returns analysisError for non-TS files', () => {
    const msg = buildAnalysisMessage('/tmp/whatever.js');
    assert.strictEqual(msg.type, 'analysisError');
    if (msg.type !== 'analysisError') return;
    assert.ok(msg.message.includes('TypeScript 파일'));
  });

  test('returns analysisError when the file cannot be read', () => {
    const msg = buildAnalysisMessage('/nonexistent/path/file.ts');
    assert.strictEqual(msg.type, 'analysisError');
    if (msg.type !== 'analysisError') return;
    assert.ok(/분석 중 오류/.test(msg.message));
  });
});
