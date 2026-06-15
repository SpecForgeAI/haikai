/**
 * Gateway typed-client wrapper tests for the diff-engine surface.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 4
 * sub-task 4.1 (the fourth gateway test in the 4-test budget).
 *
 * Focused on the wire-shape contract for the new `createDiff` wrapper --
 * POSTs to the right gateway URL with the right body shape and returns
 * the typed `ApiBehaviourDiffDto` response shape with all six count
 * fields typed `number | null` (matching the AMS boxed `Integer` contract).
 *
 * The proxy URL-forwarding contract is covered by
 * `apiMigrationValidation-diff-proxy.test.ts`; this file exercises the
 * in-process client surface only.
 */

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
  createDiff,
  type ApiBehaviourDiffDto,
  type CreateApiBehaviourDiffRequest,
} from '../services/apiBehaviourClient';

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 201 ? 'Created' : status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    } as any,
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test: createDiff POSTs to the right gateway URL with the right body shape
// and returns the typed `ApiBehaviourDiffDto` response shape.
//
// The type-level assertions (`diff.matched_count`, etc.) hold by virtue of
// the typed return; if the wrapper ever drifts away from the documented
// shape, the compile step will catch it before the runtime assertions do.
// All count fields MUST be `number | null` to match the AMS boxed `Integer`
// contract (PATCH safety per `project_primitive_double_dto_overwrite.md`).
// ---------------------------------------------------------------------------
test('createDiff POSTs body verbatim and returns typed diff DTO with nullable count fields', async () => {
  const projectId = 'proj-diff-1';
  const architectureId = 'arch-diff-1';
  const sourceBaselineId = 'base-src-1';
  const targetBaselineId = 'base-tgt-1';

  // Server returns the freshly-created diff in `status='computing'` with
  // every count field null (computation hasn't started yet -- the runner
  // PATCHes them in later when it completes).
  const createdDiff: ApiBehaviourDiffDto = {
    id: 'diff-9',
    project_id: projectId,
    architecture_id: architectureId,
    source_baseline_id: sourceBaselineId,
    target_baseline_id: targetBaselineId,
    status: 'computing',
    matched_count: null,
    status_drift_count: null,
    body_shape_drift_count: null,
    body_value_drift_count: null,
    source_only_count: null,
    target_only_count: null,
    source_baseline_updated_at: '2026-05-25T10:00:00Z',
    target_baseline_updated_at: '2026-05-25T10:15:00Z',
    computed_at: null,
    error_message: null,
    created_at: '2026-05-25T10:29:00Z',
    updated_at: '2026-05-25T10:29:00Z',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, createdDiff));

  const body: CreateApiBehaviourDiffRequest = {
    projectId,
    architectureId,
    sourceBaselineId,
    targetBaselineId,
  };

  const diff = await createDiff('http://localhost:3001', body);

  // Type-level assertions: these compile only because the wrapper's return
  // signature is `ApiBehaviourDiffDto` and the count fields are typed
  // `number | null`. The runtime assertions confirm the wire round-trips.
  expect(diff.id).toBe('diff-9');
  expect(diff.status).toBe('computing');
  expect(diff.source_baseline_id).toBe(sourceBaselineId);
  expect(diff.target_baseline_id).toBe(targetBaselineId);
  expect(diff.matched_count).toBeNull();
  expect(diff.status_drift_count).toBeNull();
  expect(diff.body_shape_drift_count).toBeNull();
  expect(diff.body_value_drift_count).toBeNull();
  expect(diff.source_only_count).toBeNull();
  expect(diff.target_only_count).toBeNull();

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe('http://localhost:3001/api/v1/api-migration-validation/diffs');
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(JSON.parse(calledInit.body as string)).toEqual(body);
});
