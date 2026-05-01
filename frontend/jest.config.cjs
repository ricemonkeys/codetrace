const tsJestPreset = {
  preset: 'ts-jest',
};

module.exports = {
  projects: [
    {
      ...tsJestPreset,
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
    },
    {
      ...tsJestPreset,
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/*.dom.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/src/test/setupTests.ts'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': '<rootDir>/src/test/styleMock.cjs',
      },
    },
  ],
};
