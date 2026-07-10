/**
 * Post-reconcile parity-verdict emission (Spec 2026-07-06-i §2–3 — Tier-1
 * batch 2026-07-10).
 *
 * Pins:
 *   - a CLEAN story posts `pass`; a BROKEN story posts `fail` with the
 *     serialized breaks (the repair loop's defect input) — bound to the run
 *     item's (job_id, spec_name);
 *   - a WAIVED break posts `pass` (waiver consumed, same rule as the gate);
 *   - a story with ZERO compared items posts NOTHING (repair cannot fix
 *     "not verified"; the completion gate keeps it blocked);
 *   - POST failures are counted, never thrown (fail-soft emission);
 *   - non-code stories / undispatched stories are ignored.
 */

import { emitParityVerdictsAfterReconcile } from '../services/migrationParityVerdictEmitter';
import type { ReconcileBookOfWorkItem } from '../services/migrationReconciliationNetNewMatch';
import type { ReconciliationDiffItem } from '../services/migrationReconciliationValidationClient';
import type { MigrationExecutionRun } from '../services/migrationExecutionRunClient';

const RUN: MigrationExecutionRun = {
  id: 'run-1',
  project_id: 'proj-1',
  book_of_work_id: 'book-1',
  pinned_current_baseline_id: 'baseline-1',
  items: [
    { id: 'ri-1', work_item_id: 'w-owners', job_id: 'orch-1', spec_name: 'spec-owners-api' },
    { id: 'ri-2', work_item_id: 'w-pets', job_id: 'orch-1', spec_name: 'spec-pets-api' },
    { id: 'ri-3', work_item_id: 'w-uncovered', job_id: 'orch-1', spec_name: 'spec-uncovered' },
  ],
} as unknown as MigrationExecutionRun;

function story(workItemId: string, endpointIds: string[]): ReconcileBookOfWorkItem {
  return {
    id: `blob-${workItemId}`,
    title: `Story ${workItemId}`,
    workItemId,
    provenance: null,
    kind: null,
    netNewOperations: null,
    tags: ['provenance:plan-deterministic', 'stream:target_service_api_implementation'],
    apiEndpointIds: endpointIds,
  };
}

function cleanItem(method: string, path: string): ReconciliationDiffItem {
  return {
    id: `di-${method}-${path}`,
    method,
    path,
    scenario_name: 'happy_path',
    status_classification: 'status_match',
    body_classification: 'body_match',
    header_classification: null,
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
  };
}

function brokenItem(method: string, path: string): ReconciliationDiffItem {
  return {
    ...cleanItem(method, path),
    id: `di-broken-${path}`,
    status_classification: 'status_drift',
    target_response_status: 500,
  };
}

function buildDeps(posts: Array<{ path: string; body: Record<string, unknown> }>, opts: {
  postOk?: boolean;
  waivers?: Array<{ id: string; target: string; reason: string }>;
} = {}) {
  return {
    loadReconcileBookOfWork: jest.fn(async () => [
      story('w-owners', ['ep-owners']),
      story('w-pets', ['ep-pets']),
      story('w-uncovered', ['ep-uncovered']),
      // A manual-gate item and a story with no workItemId must be ignored.
      { ...story('w-manual', ['ep-x']), tags: ['execution:manual-gate'] },
      { ...story('w-unsaved', ['ep-y']), workItemId: null },
    ]),
    fetchEndpointKeyIndex: jest.fn(
      async () =>
        new Map<string, string | null>([
          ['ep-owners', 'GET /owners/{id}'],
          ['ep-pets', 'POST /pets'],
          ['ep-uncovered', 'DELETE /nothing/{id}'],
        ]),
    ),
    fetchWaivers: jest.fn(async () => opts.waivers ?? []),
    implRequest: jest.fn(async (path: string, options?: { body?: unknown }) => {
      posts.push({ path, body: (options?.body ?? {}) as Record<string, unknown> });
      return { ok: opts.postOk ?? true, status: opts.postOk === false ? 500 : 202 } as Response;
    }) as never,
  };
}

const DIFF_ITEMS = [
  cleanItem('GET', '/owners/42'),
  brokenItem('POST', '/pets'),
  // Nothing compared for DELETE /nothing/{id} — w-uncovered stays unverified.
];

test('clean → pass; broken → fail with breaks; zero-compared → no POST', async () => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const emission = await emitParityVerdictsAfterReconcile({
    run: RUN,
    architectureId: 'arch-1',
    diffId: 'diff-1',
    diffItems: DIFF_ITEMS,
    deps: buildDeps(posts),
  });

  expect(emission.storiesEvaluated).toBe(3);
  expect(emission.verdictsPosted).toBe(2);
  expect(emission.storiesUnverified).toBe(1);
  expect(emission.postFailures).toBe(0);

  expect(posts).toHaveLength(2);
  expect(posts.every((p) => p.path === '/api/v2/parity-verdict')).toBe(true);

  const owners = posts.find((p) => p.body.task_group_id === 'spec-owners-api')!;
  expect(owners.body.verdict).toBe('pass');
  expect(owners.body.orchestrate_id).toBe('orch-1');
  expect(owners.body.breaks).toEqual([]);
  expect(owners.body.delivery_id).toBe('diff-1:w-owners');

  const pets = posts.find((p) => p.body.task_group_id === 'spec-pets-api')!;
  expect(pets.body.verdict).toBe('fail');
  const breaks = pets.body.breaks as Array<Record<string, unknown>>;
  expect(breaks).toHaveLength(1);
  expect(breaks[0]).toMatchObject({
    method: 'POST',
    path: '/pets',
    kind: 'status_drift',
    source_status: 200,
    target_status: 500,
  });
  expect(breaks[0].fingerprint).toBe('POST /pets::happy_path::status_drift');
});

test('a waived break posts pass (same waiver rule as the gate)', async () => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const emission = await emitParityVerdictsAfterReconcile({
    run: RUN,
    architectureId: 'arch-1',
    diffId: 'diff-1',
    diffItems: DIFF_ITEMS,
    deps: buildDeps(posts, {
      waivers: [
        {
          id: 'waiver-1',
          target: 'POST /pets::happy_path::status_drift',
          reason: 'known legacy 500',
        },
      ],
    }),
  });
  expect(emission.verdictsPosted).toBe(2);
  const pets = posts.find((p) => p.body.task_group_id === 'spec-pets-api')!;
  expect(pets.body.verdict).toBe('pass');
});

test('POST failures are counted, never thrown', async () => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const emission = await emitParityVerdictsAfterReconcile({
    run: RUN,
    architectureId: 'arch-1',
    diffId: 'diff-1',
    diffItems: DIFF_ITEMS,
    deps: buildDeps(posts, { postOk: false }),
  });
  expect(emission.postFailures).toBe(2);
  expect(emission.verdictsPosted).toBe(0);
});

test('input read failure yields an empty emission (fail-soft, reconcile untouched)', async () => {
  const emission = await emitParityVerdictsAfterReconcile({
    run: RUN,
    architectureId: 'arch-1',
    diffId: 'diff-1',
    diffItems: DIFF_ITEMS,
    deps: {
      loadReconcileBookOfWork: jest.fn(async () => {
        throw new Error('AMS down');
      }),
      fetchEndpointKeyIndex: jest.fn(),
      fetchWaivers: jest.fn(),
      implRequest: jest.fn() as never,
    },
  });
  expect(emission).toEqual({
    storiesEvaluated: 0,
    verdictsPosted: 0,
    storiesUnverified: 0,
    postFailures: 0,
  });
});
