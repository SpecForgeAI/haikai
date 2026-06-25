/**
 * migrationDiscoveryContextApi — estimated-reduction roll-up block tests
 * (Spec 4 — 2026-06-24-vulnerability-reduction-and-steering, Task Group 7.1 case (d)).
 *
 * Task 7.5 rolls the estimated current->target CVE reduction up into the Migration
 * Discovery Context as an ADDITIONAL, nullable, fail-soft summary block
 * (`estimatedReduction`). These two focused assertions cover the contract:
 *   (d-1) FAIL-SOFT ABSENT: the wire WITHOUT an `estimatedReduction` block parses
 *         cleanly and the field is `undefined` (no target snapshot => the roll-up
 *         is hidden by consumers; never a thrown error, never a zeroed block).
 *   (d-2) PRESENT: when the wire carries the block, it round-trips verbatim with
 *         the per-bucket totals and the `estimate` flag (so the roll-up surface
 *         inherits the ESTIMATE label).
 *
 * Mirrors the existing `migrationDiscoveryContextApi.test.ts` fetch-shim pattern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  fetchMigrationDiscoveryContext,
  type MigrationDiscoveryContext,
  type MigrationEstimatedReductionSummary,
} from '../migrationDiscoveryContextApi';

const PROJECT_ID = 'proj-er-1';
const ARCH_ID = 'arch-er-1';

function buildContextFixture(
  overrides: Partial<MigrationDiscoveryContext> = {},
): MigrationDiscoveryContext {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: [],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-06-24T00:00:00Z',
    summary: 'ctx',
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

describe('migrationDiscoveryContextApi estimatedReduction roll-up (Task 7.1 case (d))', () => {
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

  it('(d-1) parses cleanly + is fail-soft when the estimatedReduction block is ABSENT', async () => {
    // No `estimatedReduction` on the wire (the strict ABSENT-when-no-target case).
    const ctx = buildContextFixture();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ctx,
    });

    const result = await fetchMigrationDiscoveryContext(PROJECT_ID, {
      currentArchitectureId: ARCH_ID,
    });

    // Field is simply absent — consumers hide the roll-up; nothing throws.
    expect(result.estimatedReduction).toBeUndefined();
  });

  it('(d-2) round-trips the estimatedReduction block (per-bucket totals + estimate flag) when present', async () => {
    const estimatedReduction: MigrationEstimatedReductionSummary = {
      estimate: true,
      total: 5,
      eliminated: 3,
      remaining: 2,
      newlyIntroduced: null, // OSV scan did not run (graceful degrade) — null, not 0
    };
    const ctx = buildContextFixture({
      targetArchitectureId: 'target-er-1',
      estimatedReduction,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ctx,
    });

    const result = await fetchMigrationDiscoveryContext(PROJECT_ID, {
      currentArchitectureId: ARCH_ID,
      targetArchitectureId: 'target-er-1',
    });

    expect(result.estimatedReduction).toBeDefined();
    expect(result.estimatedReduction?.estimate).toBe(true);
    expect(result.estimatedReduction?.total).toBe(5);
    expect(result.estimatedReduction?.eliminated).toBe(3);
    expect(result.estimatedReduction?.remaining).toBe(2);
    // newlyIntroduced null distinguishes "scan did not run" from a present 0.
    expect(result.estimatedReduction?.newlyIntroduced).toBeNull();
  });
});
