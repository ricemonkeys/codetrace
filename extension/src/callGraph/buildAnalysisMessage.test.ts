import * as path from 'path';
import { buildAnalysisMessage } from './buildAnalysisMessage';

const fixturePath = path.join(__dirname, '..', 'analyzer', '__fixtures__', 'sample.ts');

describe('buildAnalysisMessage', () => {
  test('returns analysisResult with the extracted graph for a .ts file', () => {
    const msg = buildAnalysisMessage(fixturePath);
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

  test('returns analysisError for non-TS files', () => {
    const msg = buildAnalysisMessage('/tmp/whatever.js');
    expect(msg).toEqual({
      type: 'analysisError',
      message: expect.stringContaining('TypeScript 파일'),
    });
  });

  test('returns analysisError when the file cannot be read', () => {
    const msg = buildAnalysisMessage('/nonexistent/path/file.ts');
    expect(msg.type).toBe('analysisError');
    if (msg.type !== 'analysisError') return;
    expect(msg.message).toMatch(/분석 중 오류/);
  });

  test('accepts .tsx as well as .ts', () => {
    // The extension allow-list should cover tsx; we exercise the regex branch
    // with a missing file (which still passes the extension check, then errors).
    const msg = buildAnalysisMessage('/nonexistent/path/file.tsx');
    expect(msg.type).toBe('analysisError');
    if (msg.type !== 'analysisError') return;
    // Error must be the read error, NOT the "only .ts/.tsx" guard.
    expect(msg.message).not.toContain('TypeScript 파일');
    expect(msg.message).toMatch(/분석 중 오류/);
  });
});
