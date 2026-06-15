/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  // Custom environment loads native tree-sitter ONCE per worker (real context),
  // avoiding the per-file re-`require` that desyncs node-tree-sitter's native
  // transfer buffer. See jest/treeSitterEnvironment.cjs for the full rationale.
  testEnvironment: '<rootDir>/jest/treeSitterEnvironment.cjs',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
