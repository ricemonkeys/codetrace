import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'unitTests',
    files: ['out/test/**/*.test.js', '!out/test/**/e2e.test.js'],
    version: 'insiders',
    workspaceFolder: './test-workspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000,
    }
  },
  {
    label: 'e2e',
    files: 'out/test/**/e2e.test.js',
    version: 'stable',
    workspaceFolder: './test-workspace',
    mocha: {
      ui: 'tdd',
      timeout: 120000,
    }
  }
]);
