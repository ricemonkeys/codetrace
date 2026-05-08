module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/.vscode-test/'],
  watchPathIgnorePatterns: ['/.vscode-test/'],
  modulePathIgnorePatterns: ['/.vscode-test/'],
};
