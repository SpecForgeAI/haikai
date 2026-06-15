/**
 * migrationDeliveryDashboardApi tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * -- Task Group 7 (Frontend API client).
 *
 * Two focused tests per tasks.md 7.1:
 *   1. `getMigrationDeliveryDashboard(projectId, bookId)` calls the right
 *      gateway URL with `GET` + `Accept: application/json` (the gateway proxy
 *      is mounted at `/api`, NOT `/api/v1`).
 *   2. Returns the typed `MigrationDeliveryDashboardDto` body; a non-2xx
 *      (or thrown fetch) surfaces as a rejected promise.
 *
 * Wire-shape note (Follow-up #10): the inbound JSON is snake_case
 * (`book_of_work_id`, `work_item_id`, ...) because that's the AMS wire shape.
 * The fixture builder below constructs the snake_case wire payload. The
 * returned promise carries the camelCase mapped shape -- assertions exercise
 * the mapping at the boundary.
 *
 * Test strategy: mirrors `apiBehaviourClient.test.ts` /
 * `migrationDiscoveryContextApi.test.ts` -- vi.fn() shimming globalThis.fetch
 * (TS-clean under the project tsconfig), with `vi.resetAllMocks()` in
 * `beforeEach` per Standing Constraint 6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getMigrationDeliveryDashboard } from '../migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-uuid-aaa';
const BOOK_ID = 'book-uuid-bbb';

/**
 * Build a snake_case wire payload (the shape AMS emits). Typed as `unknown`
 * because the wire type is intentionally not exported from the API client --
 * tests only need to construct the inbound JSON, not consume it.
 */
function buildWireFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    book_of_work_id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-current-uuid',
    target_architecture_id: 'arch-target-uuid',
    title: 'Book of Work A',
    status: 'generated',
    generated_at: '2026-05-19T00:00:00Z',
    summary: {
      total_initiative_count: 1,
      total_epic_count: 2,
      total_feature_count: 3,
      total_story_count: 8,
      needs_attention_count: 2,
    },
    hierarchy: [],
    workstream_summaries: [],
    spec_generation_summary: {
      not_attempted_count: 0,
      generated_count: 5,
      generated_with_warnings_count: 1,
      insufficient_context_count: 1,
      failed_count: 1,
      skipped_blocked_count: 0,
    },
    backlog_save_summary: {
      saved_count: 7,
      not_saved_to_backlog_count: 1,
    },
    implementation_summary: {
      not_started_count: 4,
      in_progress_count: 2,
      blocked_count: 1,
      completed_count: 1,
      active_count: 3,
    },
    evidence_summary: {
      evidence_reference_count: 0,
      discovery_finding_reference_count: 0,
      api_baseline_reference_count: 0,
      mapping_reference_count: 0,
      architecture_reference_count: 0,
      any_coverage_count: 0,
    },
    needs_attention: [],
    warnings: [],
    ...overrides,
  };
}

describe('migrationDeliveryDashboardApi -- getMigrationDeliveryDashboard (Task 7.1)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GETs /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard with Accept header AND maps wire keys to camelCase', async () => {
    const wire = buildWireFixture();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => wire,
    });

    const result = await getMigrationDeliveryDashboard(PROJECT_ID, BOOK_ID);

    // URL + headers
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/delivery-dashboard`,
    );
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({ Accept: 'application/json' });

    // Mapped camelCase fields -- spot-check across nested DTOs.
    expect(result.bookOfWorkId).toBe(BOOK_ID);
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.currentArchitectureId).toBe('arch-current-uuid');
    expect(result.targetArchitectureId).toBe('arch-target-uuid');
    expect(result.generatedAt).toBe('2026-05-19T00:00:00Z');
    expect(result.summary.totalInitiativeCount).toBe(1);
    expect(result.summary.totalStoryCount).toBe(8);
    expect(result.specGenerationSummary.generatedCount).toBe(5);
    expect(result.specGenerationSummary.generatedWithWarningsCount).toBe(1);
    expect(result.backlogSaveSummary.savedCount).toBe(7);
    expect(result.backlogSaveSummary.notSavedToBacklogCount).toBe(1);
    expect(result.implementationSummary.notStartedCount).toBe(4);
    expect(result.evidenceSummary.anyCoverageCount).toBe(0);
  });

  it('maps needs_attention items + nested missing_inputs to camelCase; surfaces non-2xx and network errors as rejected promises', async () => {
    // Path A: 200 returns the typed payload with camelCase keys.
    const wire = buildWireFixture({
      warnings: ['workstream_summaries: AMS rollup failed -- retry'],
      needs_attention: [
        {
          book_item_id: 'item-1',
          work_item_id: 'work-1',
          type: 'insufficient_context',
          priority_rank: 1,
          title: 'Story 1',
          workstream: 'auth',
          spec_generation_status: 'insufficient_context',
          spec_generation_confidence: 'low',
          implementation_status: 'not_started',
          reason: 'Two mappings missing',
          missing_inputs: [
            { kind: 'Mapping', id: 'map-1', reason: 'unmapped target' },
            { kind: 'Mapping', id: null, reason: 'category gap' },
          ],
        },
      ],
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => wire,
    });

    const result = await getMigrationDeliveryDashboard(PROJECT_ID, BOOK_ID);

    // Warnings are passed through verbatim (the wire-shape strings inside the
    // warnings array are server-emitted prose, NOT field accesses; the
    // boundary mapper leaves them as-is).
    expect(result.warnings).toEqual(['workstream_summaries: AMS rollup failed -- retry']);

    // Needs-attention rows are mapped to camelCase; missingInputs entries
    // (already camelCase on the wire because they have no underscores in
    // their field names) pass through untouched.
    expect(result.needsAttention).toHaveLength(1);
    const item = result.needsAttention[0];
    expect(item.bookItemId).toBe('item-1');
    expect(item.workItemId).toBe('work-1');
    expect(item.priorityRank).toBe(1);
    expect(item.specGenerationStatus).toBe('insufficient_context');
    expect(item.specGenerationConfidence).toBe('low');
    expect(item.implementationStatus).toBe('not_started');
    expect(item.missingInputs).toEqual([
      { kind: 'Mapping', id: 'map-1', reason: 'unmapped target' },
      { kind: 'Mapping', id: null, reason: 'category gap' },
    ]);

    // Path B: a fetch-level network error surfaces as a rejected promise.
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(getMigrationDeliveryDashboard(PROJECT_ID, BOOK_ID)).rejects.toThrow(
      'network down',
    );

    // Path C: a non-2xx response also rejects (covers gateway 503 envelope).
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: { code: 503, message: 'Architecture model service unavailable' },
      }),
    });
    await expect(getMigrationDeliveryDashboard(PROJECT_ID, BOOK_ID)).rejects.toThrow(
      'Architecture model service unavailable',
    );
  });
});
