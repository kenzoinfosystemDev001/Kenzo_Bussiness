/** @type {import('jest').Config} */
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: { '^@kenzo/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};

module.exports = {
  testTimeout: 60_000,
  projects: [
    { ...shared, displayName: 'unit', rootDir: __dirname, testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...shared,
      displayName: 'integration',
      rootDir: __dirname,
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
      setupFiles: ['<rootDir>/test/integration/env-setup.ts'],
    },
  ],
};
