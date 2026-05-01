import type { CallGraph } from '../types';

// Demo data shaped to match what extension/src/analyzer produces.
// Used by App.tsx until the messaging flow (#50) wires real analysis results.
export const SAMPLE_GRAPH: CallGraph = {
  nodes: [
    {
      id: 'demo#greet',
      name: 'greet',
      kind: 'function',
      file: 'src/sample.ts',
      range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 },
    },
    {
      id: 'demo#sayHi',
      name: 'sayHi',
      kind: 'arrow',
      file: 'src/sample.ts',
      range: { startLine: 5, startColumn: 1, endLine: 7, endColumn: 2 },
    },
    {
      id: 'demo#Service.run',
      name: 'Service.run',
      kind: 'method',
      file: 'src/sample.ts',
      range: { startLine: 10, startColumn: 3, endLine: 12, endColumn: 4 },
    },
    {
      id: 'demo#Service.runInner',
      name: 'Service.runInner',
      kind: 'method',
      file: 'src/sample.ts',
      range: { startLine: 14, startColumn: 3, endLine: 16, endColumn: 4 },
    },
    {
      id: 'demo#helper',
      name: 'helper',
      kind: 'function',
      file: 'src/sample.ts',
      range: { startLine: 18, startColumn: 1, endLine: 20, endColumn: 2 },
    },
  ],
  edges: [
    { from: 'demo#greet', to: 'demo#helper' },
    { from: 'demo#sayHi', to: 'demo#greet' },
    { from: 'demo#Service.run', to: 'demo#Service.runInner' },
    { from: 'demo#sayHi', to: 'demo#Service.run' },
  ],
};
