/**
 * Wire-case regression test for the spec-generation BATCH response read-back.
 *
 * Bug: the gateway `generate-batch` route returns its handler's INTERNAL
 * camelCase `MigrationStorySpecGenerationDto` rows verbatim (e.g.
 * `missingInputsJson`, `warningsJson`, `predictedReadiness`), but the frontend
 * `mapRowDtoToRow` originally read ONLY snake_case keys
 * (`missing_inputs_json`, ...). So a freshly-run batch dropped every multi-word
 * field -- most visibly, an `insufficient_context` story with 4 server-computed
 * missing inputs rendered "Missing inputs = 0" and the "Resolve the missing
 * inputs below" panel listed nothing, until a page reload re-fetched the
 * snake_case rows from AMS.
 *
 * These tests pin BOTH producers through the public `startBatchGeneration`:
 *   - the camelCase gateway batch shape now reads back correctly;
 *   - the snake_case shape (AMS persist / reload) still reads back correctly.
 *
 * `mapRowDtoToRow` / `mapBatchResultDto` are module-private; they are exercised
 * via `startBatchGeneration` with a mocked `globalThis.fetch`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { startBatchGeneration } from './specGenerationApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const WORK_ITEM_ID = '29b6afc3-8833-4d64-88df-7b26d7730b3f';

const MISSING_INPUTS = [
  { kind: 'baseline', reason: 'no API behaviour baseline captured for this endpoint' },
  { kind: 'mapping', reason: 'no current->target mapping resolved' },
  { kind: 'contract', reason: 'no OAS contract on the endpoint' },
  { kind: 'decision_task', id: 'dt-1', reason: 'target runtime decision unresolved' },
];

function mockFetchReturningBatch(envelope: Record<string, unknown>): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => envelope,
  } as unknown as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('spec-generation batch response wire-case read-back', () => {
  it('reads the gateway camelCase insufficient_context row (missingInputsJson) into row.missingInputs', async () => {
    // Mirrors the gateway handler's internal camelCase row shape returned
    // verbatim by the generate-batch route.
    mockFetchReturningBatch({
      perStoryResults: [
        {
          projectId: PROJECT_ID,
          workItemId: WORK_ITEM_ID,
          bookOfWorkId: BOOK_ID,
          bookItemId:
            'target_service_api_implementation:epic-tsa-1-s-ep-mqwofuij-9v25d',
          status: 'insufficient_context',
          confidence: null,
          predictedReadiness: null,
          generatedSpecText: null,
          warningsJson: [],
          missingInputsJson: MISSING_INPUTS,
          generationAttemptNumber: 1,
        },
      ],
      persistedCount: 1,
      resultsCouldNotPersist: 0,
      unpersistedResults: [],
      nextBatchStart: 0,
      summary: {
        generated: 0,
        generated_with_warnings: 0,
        insufficient_context: 1,
        failed: 0,
        skipped_blocked: 0,
      },
    });

    const result = await startBatchGeneration({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
    });

    expect(result.perStoryResults).toHaveLength(1);
    const row = result.perStoryResults[0];
    expect(row.status).toBe('insufficient_context');
    // The bug: these were dropped (read as snake_case only) and rendered 0.
    expect(row.missingInputs).toEqual(MISSING_INPUTS);
    expect(row.missingInputs).toHaveLength(4);
    expect(row.warnings).toEqual([]);
    // Identity must survive too -- the workspace merges batch rows by workItemId.
    expect(row.workItemId).toBe(WORK_ITEM_ID);
  });

  it('still reads the snake_case (AMS persist / reload) row shape', async () => {
    mockFetchReturningBatch({
      perStoryResults: [
        {
          project_id: PROJECT_ID,
          work_item_id: WORK_ITEM_ID,
          book_of_work_id: BOOK_ID,
          status: 'insufficient_context',
          confidence: null,
          predicted_readiness: null,
          generated_spec_text: null,
          warnings_json: [],
          missing_inputs_json: MISSING_INPUTS,
          generation_attempt_number: 1,
        },
      ],
      persistedCount: 1,
      resultsCouldNotPersist: 0,
      unpersistedResults: [],
      nextBatchStart: 0,
      summary: {
        generated: 0,
        generated_with_warnings: 0,
        insufficient_context: 1,
        failed: 0,
        skipped_blocked: 0,
      },
    });

    const result = await startBatchGeneration({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
    });

    const row = result.perStoryResults[0];
    expect(row.missingInputs).toEqual(MISSING_INPUTS);
    expect(row.workItemId).toBe(WORK_ITEM_ID);
  });
});
