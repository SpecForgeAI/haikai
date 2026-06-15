/**
 * diffActions route handler tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3
 * sub-task 3.1.
 *
 * Test inventory:
 *   1. POST /diffs returns 400 when target baseline is in `draft`.
 *   2. POST /diffs/:id/recompute returns 409 when the diff is currently
 *      computing (runManager has a live entry for the diffId).
 */

import express from 'express';
import request from 'supertest';
import { buildDiffActionsRouter } from '../routes/diffActions';
import { runManager } from '../services/runManager';
import type {
  ApiBehaviourDiffDto,
  BaselineDto,
} from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const DIFF_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';
const TARGET_BASELINE_ID = '00000000-0000-0000-0000-0000000000ee';

function buildBaseline(
  id: string,
  kind: 'current' | 'target',
  status: 'draft' | 'active' = 'active',
): BaselineDto {
  const now = new Date().toISOString();
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 's-x',
    name: `${kind}-baseline`,
    status,
    accepted_capture_count: null,
    operation_count: null,
    notes: null,
    kind,
    paired_with_baseline_id: kind === 'target' ? SOURCE_BASELINE_ID : null,
    created_at: now,
    updated_at: now,
  };
}

function buildDiff(): ApiBehaviourDiffDto {
  const now = new Date().toISOString();
  return {
    id: DIFF_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    source_baseline_id: SOURCE_BASELINE_ID,
    target_baseline_id: TARGET_BASELINE_ID,
    status: 'computing',
    matched_count: null,
    status_drift_count: null,
    body_shape_drift_count: null,
    body_value_drift_count: null,
    source_only_count: null,
    target_only_count: null,
    source_baseline_updated_at: null,
    target_baseline_updated_at: null,
    computed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildApp(deps: Parameters<typeof buildDiffActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildDiffActionsRouter(deps));
  return app;
}

beforeEach(() => {
  if (runManager.has(DIFF_ID)) runManager.end(DIFF_ID);
});

// ---------------------------------------------------------------------------
// Test 1: POST /diffs returns 400 when target baseline is draft
// ---------------------------------------------------------------------------
test('POST /api/diffs rejects draft target baseline with HTTP 400', async () => {
  const draftTarget = buildBaseline(TARGET_BASELINE_ID, 'target', 'draft');
  const archMock = {
    getBaseline: jest.fn(async () => draftTarget),
    createDiff: jest.fn(),
  };
  const spawnRunner = jest.fn(async () => undefined);
  const app = buildApp({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    spawnRunner,
  });

  const res = await request(app)
    .post(`/api/diffs?projectId=${PROJECT_ID}`)
    .send({
      architectureId: ARCH_ID,
      sourceBaselineId: SOURCE_BASELINE_ID,
      targetBaselineId: TARGET_BASELINE_ID,
    });

  expect(res.status).toBe(400);
  expect(res.body.error.error).toBe('target_baseline_not_finalised');
  // No diff row was created and no runner was spawned.
  expect(archMock.createDiff).not.toHaveBeenCalled();
  expect(spawnRunner).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 2: POST /diffs/:id/recompute returns 409 when already computing
// ---------------------------------------------------------------------------
test('POST /api/diffs/:id/recompute returns 409 when runManager reports live', async () => {
  // Pre-register the diffId in runManager to simulate an in-flight run.
  runManager.start({
    sessionId: DIFF_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
  const archMock = {
    getDiff: jest.fn(async () => buildDiff()),
    getBaseline: jest.fn(),
    deleteDiffItemsByDiffId: jest.fn(),
    updateDiff: jest.fn(),
  };
  const spawnRunner = jest.fn(async () => undefined);
  const app = buildApp({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    spawnRunner,
  });

  const res = await request(app)
    .post(`/api/diffs/${DIFF_ID}/recompute?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body.error.currentStatus).toBe('computing');
  // None of the recompute flow ran since the 409 short-circuits.
  expect(archMock.getDiff).not.toHaveBeenCalled();
  expect(archMock.deleteDiffItemsByDiffId).not.toHaveBeenCalled();
  expect(spawnRunner).not.toHaveBeenCalled();
});
