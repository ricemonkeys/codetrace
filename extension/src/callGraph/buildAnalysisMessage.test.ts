import * as path from 'path';
import { buildAnalysisMessage } from './buildAnalysisMessage';

const fixturePath = path.join(__dirname, '..', 'analyzer', '__fixtures__', 'sample.ts');

describe('buildAnalysisMessage', () => {
  test('returns analysisResult with the extracted graph for a .ts file', async () => {
    const msg = await buildAnalysisMessage(fixturePath);
    expect(msg.type).toBe('analysisResult');
    if (msg.type !== 'analysisResult') return;
    // sample.ts has 5 function-like nodes (see analyzer fixture)
    expect(msg.graph.nodes.map(n => n.name).sort()).toEqual([
      'Service.run',
      'Service.runInner',
      'greet',
      'helper',
      'sayHi',
    ]);
  });

  test('returns analysisError when the file cannot be read', async () => {
    const msg = await buildAnalysisMessage('/nonexistent/path/file.ts');
    expect(msg.type).toBe('analysisError');
    if (msg.type !== 'analysisError') return;
    expect(msg.message).toMatch(/분석 중 오류/);
  });
});
