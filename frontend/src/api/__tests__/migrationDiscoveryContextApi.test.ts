/**
 * migrationDiscoveryContextApi tests
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 4
 * Task 4.1 sub-test #1: confirm the client builds the right gateway URL and
 * forwards the request body verbatim to the proxy route.
 *
 * Test strategy:
 *   - Vitest with vi.fn() shimming globalThis.fetch (mirrors the
 *     apiBehaviourClient.test.ts pattern that keeps things TS-clean under
 *     the project's tsconfig).
 *   - Two assertions: with-defaults call and with-filters call. The wire
 *     contract is what matters; field-by-field response parsing is
 *     transitively covered by the wizard component tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  fetchMigrationDiscoveryContext,
  type MigrationDiscoveryContext,
} from '../migrationDiscoveryContextApi';

const PROJECT_ID = 'proj-uuid-aaa';
const ARCH_ID = 'arch-uuid-bbb';

function buildContextFixture(
  overrides: Partial<MigrationDiscoveryContext> = {},
): MigrationDiscoveryContext {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: [],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-05-16T00:00:00Z',
    summary: 'No discovery runs available.',
    currentArchitectureSummary: null,
    targetArchitectureSummary: null,
    discoveryRunsSummary: null,
    findingsSummary: null,
    highPriorityFindings: [],
    findingsByCategory: {},
    evidenceHighlights: [],
    candidateSummary: null,
    unresolvedDecisionTasks: [],
    runtimeUsageSummary: null,
    databaseDiscoverySummary: null,
    apiBehaviourBaselineSummary: null,
    architectureMappingsSummary: null,
    readinessAssessment: null,
    contextWarnings: [],
    ...overrides,
  };
}

describe('migrationDiscoveryContextApi -- fetchMigrationDiscoveryContext (Task 4.1 #1)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('POSTs to /api/v1/projects/:projectId/migration-discovery-context with the body forwarded verbatim', async () => {
    const ctx = buildContextFixture();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ctx,
    });

    const result = await fetchMigrationDiscoveryContext(PROJECT_ID, {
      currentArchitectureId: ARCH_ID,
      includeFindings: true,
    });

    expect(result).toEqual(ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/v1/projects/${PROJECT_ID}/migration-discovery-context`);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(options.body);
    expect(body.currentArchitectureId).toBe(ARCH_ID);
    expect(body.includeFindings).toBe(true);
  });

  it('forwards discoveryRunIds + maxFindings + maxEvidenceItems in the request body', async () => {
    const ctx = buildContextFixture();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ctx,
    });

    await fetchMigrationDiscoveryContext(PROJECT_ID, {
      currentArchitectureId: ARCH_ID,
      discoveryRunIds: ['run-1', 'run-2'],
      maxFindings: 50,
      maxEvidenceItems: 75,
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.discoveryRunIds).toEqual(['run-1', 'run-2']);
    expect(body.maxFindings).toBe(50);
    expect(body.maxEvidenceItems).toBe(75);
  });
});
