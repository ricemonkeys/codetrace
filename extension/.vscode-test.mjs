import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'unitTests',
    // `@vscode/test-cli` 0.0.4 의 `files` 는 negated glob을 ignore로 해석하지
    // 않는다 (positive glob만 수집해 `glob(file, { ignore })` 로 넘김 — 음수
    // 패턴은 매칭 0건의 dead glob일 뿐). E2E를 unit 라벨에서 제외하려면 npm
    // 스크립트(`npm test --workspace=extension`)에서 CLI에 직접 `--ignore` 를
    // 넘긴다. 근거: node_modules/@vscode/test-cli/out/bin.mjs:361-378.
    files: 'out/test/**/*.test.js',
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
