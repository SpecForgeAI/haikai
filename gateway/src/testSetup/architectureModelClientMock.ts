/**
 * Shared jest.mock factory helper for `../services/architectureModelClient`.
 *
 * Why this exists: Spec 2026-05-01 (Multi-Architecture Plumbing) added an
 * architecture-resolution step (`resolveDefaultArchitectureId`) that now
 * precedes every Bucket A AMS call. Test suites that partially mock
 * `architectureModelClient` WITHOUT `jest.requireActual` blow up with
 * "resolveDefaultArchitectureId is not a function", and suites that DO
 * spread the actual module accidentally run the real resolver (a live
 * fetch that resolves to null). This helper gives both camps the project
 * convention in one place:
 *
 *   - spreads `jest.requireActual` so unmocked exports keep working, and
 *   - stubs `resolveDefaultArchitectureId` to resolve a stable test id
 *     (`DEFAULT_TEST_ARCHITECTURE_ID`) so Bucket A calls proceed.
 *
 * Usage (inside a hoisted jest.mock factory -- `jest.requireActual` is the
 * only require form allowed there):
 *
 *   jest.mock('../services/architectureModelClient', () => {
 *     const { buildArchitectureModelClientMock } = jest.requireActual(
 *       '../testSetup/architectureModelClientMock'
 *     );
 *     return buildArchitectureModelClientMock({
 *       fetchProjectFolder: (...args: unknown[]) => mockFetchProjectFolder(...args),
 *     });
 *   });
 *
 * Per-suite overrides win over both the actual module and the default
 * resolver stub.
 */

/** Stable architecture id resolved by the default resolver stub. */
export const DEFAULT_TEST_ARCHITECTURE_ID = 'arch-default-1';

/**
 * Builds a mock module object for `architectureModelClient`:
 * actual exports, then a `resolveDefaultArchitectureId` stub, then overrides.
 */
export function buildArchitectureModelClientMock(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    resolveDefaultArchitectureId: jest
      .fn()
      .mockResolvedValue(DEFAULT_TEST_ARCHITECTURE_ID),
    ...overrides,
  };
}
