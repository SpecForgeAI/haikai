/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Global guard: overwrite real LLM credentials with a sentinel BEFORE any
  // module (incl. dotenv) loads, so no test can ever reach a live LLM.
  // See src/services/llmTestGuard.ts for the matching runtime check.
  setupFiles: ['<rootDir>/src/testSetup/llmGuard.setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/server.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // Reset modules between tests for clean config loading
  resetModules: true,
  // Clear mocks between tests
  clearMocks: true,
};
