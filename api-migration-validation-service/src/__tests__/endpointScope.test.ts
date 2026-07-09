/**
 * Endpoint-scoped replay + diff (Spec 2026-07-06-i — Parity Verify Loop &
 * Execution Gates).
 *
 * Pins:
 *   MATCH  — key normalisation + template-tolerant scope matching.
 *   REPLAY — runTargetReplay with deps.endpointScope replays ONLY in-scope
 *            items (out-of-scope counted skipped) and stamps the scope blob
 *            onto the auto-created diff (endpoint_scope_json audit).
 *   DIFF   — runDiff on a SCOPED diff row pairs only in-scope items: an
 *            out-of-scope source item must NOT surface as source_only.
 */

import {
  buildEndpointScopeBlob,
  normalizeEndpointKey,
  parseEndpointScopeKeys,
  scopeKeysFromBlob,
  scopeMatches,
} from '../services/endpointScope';
import { runTargetReplay, type TargetReplayDeps } from '../services/targetReplayRunner';
import { runDiff } from '../services/diffRunner';
import { RunManager } from '../services/runManager';
import { SecretsStore } from '../services/secretsStore';
import type {
  BaselineDto,
  BaselineItemDto,
  CaptureSessionDto,
} from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';

// ---------------------------------------------------------------------------
// MATCH
// ---------------------------------------------------------------------------

test('MATCH: normalisation + template-tolerant matching in both directions', () => {
  expect(normalizeEndpointKey('get', '/owners/')).toBe('GET /owners');
  expect(parseEndpointScopeKeys(['get /owners', 'POST /owners/{id}/pets'])).toEqual([
    'GET /owners',
    'POST /owners/{id}/pets',
  ]);
  expect(parseEndpointScopeKeys('not-an-array')).toBeNull();
  expect(parseEndpointScopeKeys([])).toBeNull();

  // Template scope key vs concrete item path.
  expect(scopeMatches(['GET /owners/{id}'], 'GET', '/owners/42')).toBe(true);
  // Concrete scope key vs templated baseline path.
  expect(scopeMatches(['GET /owners/42'], 'get', '/owners/{ownerId}')).toBe(true);
  // Verb mismatch.
  expect(scopeMatches(['GET /owners/{id}'], 'DELETE', '/owners/42')).toBe(false);
  // Out-of-scope path.
  expect(scopeMatches(['GET /owners/{id}'], 'GET', '/pets/42')).toBe(false);
  // Null scope = full surface.
  expect(scopeMatches(null, 'GET', '/anything')).toBe(true);

  // Blob round-trip.
  const blob = buildEndpointScopeBlob(['GET /owners'], 'parity');
  expect(blob).toEqual({ keys: ['GET /owners'], purpose: 'parity' });
  expect(scopeKeysFromBlob(blob)).toEqual(['GET /owners']);
  expect(buildEndpointScopeBlob(null, null)).toBeNull();
  expect(scopeKeysFromBlob(null)).toBeNull();
  expect(scopeKeysFromBlob({ keys: null, purpose: 'drift_check' })).toBeNull();
});

// ---------------------------------------------------------------------------
// REPLAY
// ---------------------------------------------------------------------------

const RP_PROJECT_ID = '00000000-0000-0000-0000-0000000000a1';
const RP_ARCH_ID = '00000000-0000-0000-0000-0000000000b1';
const RP_SESSION_ID = '00000000-0000-0000-0000-0000000000c1';
const RP_SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000d1';

function buildReplaySession(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: RP_SESSION_ID,
    project_id: RP_PROJECT_ID,
    architecture_id: RP_ARCH_ID,
    name: 'scoped-replay',
    status: 'running',
    env_name: 'target-uat',
    api_base_url: 'https://target.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    kind: 'target',
    source_baseline_id: RP_SOURCE_BASELINE_ID,
    created_at: now,
    updated_at: now,
  } as CaptureSessionDto;
}

function buildItem(i: number, method: string, path: string): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: `item-${i}`,
    baseline_id: RP_SOURCE_BASELINE_ID,
    capture_id: `cap-${i}`,
    operation_id: `op-${i}`,
    scenario_id: `scen-${i}`,
    method,
    path,
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: 200,
    response_json: { ok: true },
    business_notes: null,
    created_at: now,
    updated_at: now,
  } as BaselineItemDto;
}

test('REPLAY: only in-scope items replay; the diff carries the scope blob', async () => {
  const sourceBaseline: BaselineDto = {
    id: RP_SOURCE_BASELINE_ID,
    project_id: RP_PROJECT_ID,
    architecture_id: RP_ARCH_ID,
    session_id: 'src-session',
    name: 'src',
    status: 'active',
    accepted_capture_count: 3,
    operation_count: 3,
    notes: null,
    kind: 'current',
    paired_with_baseline_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const items = [
    buildItem(1, 'GET', '/owners/42'),
    buildItem(2, 'GET', '/pets/1'),
    buildItem(3, 'POST', '/owners/42/things'),
  ];

  const capturesCreated: Array<Record<string, unknown>> = [];
  const diffsCreated: Array<Record<string, unknown>> = [];
  const archMock = {
    listAllCaptureSessionsByStatus: jest.fn(async () => [buildReplaySession()]),
    getBaseline: jest.fn(async () => sourceBaseline),
    listBaselineItems: jest.fn(async () => items),
    createBaseline: jest.fn(async () => ({
      ...sourceBaseline,
      id: 'target-baseline-scoped',
      kind: 'target',
      status: 'draft',
    })),
    patchBaseline: jest.fn(async () => ({})),
    createCapture: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      capturesCreated.push(body);
      return { id: `cap-row-${capturesCreated.length}`, response_headers_redacted_json: {}, response_body_json: {} };
    }),
    patchCapture: jest.fn(async () => ({})),
    createBaselineItem: jest.fn(async (_p: string, body: Record<string, unknown>) => ({
      id: 'ti',
      ...body,
    })),
    patchCaptureSession: jest.fn(async () => ({})),
    createDiagnostic: jest.fn(async () => ({})),
    createDiff: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      diffsCreated.push(body);
      return { id: 'diff-scoped-1', ...body };
    }),
  };

  const secretsStore = new SecretsStore();
  secretsStore.set({
    sessionId: RP_SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext' },
    loadedAt: Date.now(),
  });
  const runManager = new RunManager();
  runManager.start({
    sessionId: RP_SESSION_ID,
    projectId: RP_PROJECT_ID,
    architectureId: RP_ARCH_ID,
  });
  const deps: TargetReplayDeps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    secretsStore,
    runManager,
    createHttpExecutor: () =>
      ({
        request: jest.fn(async () => ({
          data: { ok: true },
          status: 200,
          statusText: '',
          headers: { 'content-type': 'application/json' },
          config: {} as never,
        })),
        requestWithAuthOverride: jest.fn(),
        setAuth: jest.fn(),
        dispose: jest.fn(),
      }) as unknown as SessionHttpExecutor,
    now: () => 1700000000000,
    // Scope: the owners interface only — the /pets item must be skipped.
    endpointScope: ['GET /owners/{id}', 'POST /owners/{id}/things'],
    scopePurpose: 'parity',
    // Suppress the auto-diff runner spawn (mock records createDiff body only).
    runDiffFn: jest.fn(async () => undefined),
  };

  const outcome = await runTargetReplay(RP_SESSION_ID, deps);
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(2);
  expect(outcome.itemsSkipped).toBe(1);
  // Only the two in-scope requests reached the wire.
  expect(capturesCreated).toHaveLength(2);
  expect(capturesCreated.map((c) => c.request_path)).toEqual(['/owners/42', '/owners/42/things']);
  // The auto-created diff carries the scope audit blob.
  expect(diffsCreated).toHaveLength(1);
  expect(diffsCreated[0].endpoint_scope_json).toEqual({
    keys: ['GET /owners/{id}', 'POST /owners/{id}/things'],
    purpose: 'parity',
  });
});

// ---------------------------------------------------------------------------
// DIFF
// ---------------------------------------------------------------------------

test('DIFF: a scoped diff pairs only in-scope items — no source_only spam', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('no ams in test'));
  const DIFF_ID = 'diff-scope-filter-1';
  const now = new Date().toISOString();

  const mkItem = (id: string, method: string, path: string): BaselineItemDto =>
    ({
      id,
      baseline_id: 'b',
      capture_id: 'c',
      operation_id: 'o',
      scenario_id: 's',
      method,
      path,
      scenario_name: 'happy_path',
      request_json: {},
      response_status: 200,
      response_json: { ok: true },
      business_notes: null,
      created_at: now,
      updated_at: now,
    }) as BaselineItemDto;

  // Source has owners + pets; target (scoped replay) has owners only.
  const sourceItems = [mkItem('s-1', 'GET', '/owners/42'), mkItem('s-2', 'GET', '/pets/1')];
  const targetItems = [mkItem('t-1', 'GET', '/owners/42')];

  const diffItemsCreated: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const archMock = {
    getDiff: jest.fn(async () => ({
      id: DIFF_ID,
      project_id: 'proj-scope',
      architecture_id: 'arch-scope',
      source_baseline_id: 'src-b',
      target_baseline_id: 'tgt-b',
      status: 'computing',
      comparison_profile: null,
      endpoint_scope_json: { keys: ['GET /owners/{id}'], purpose: 'parity' },
    })),
    getBaseline: jest.fn(async (_p: string, id: string) => ({
      id,
      status: 'active',
      updated_at: now,
    })),
    getBaselineIntegrity: jest.fn(async () => ({
      content_hash: null,
      recomputed_hash: null,
      integrity_verified: false,
    })),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) =>
      baselineId === 'src-b' ? sourceItems : targetItems,
    ),
    createDiffItem: jest.fn(async (_p: string, _d: string, body: Record<string, unknown>) => {
      diffItemsCreated.push(body);
      return { id: `di-${diffItemsCreated.length}`, ...body };
    }),
    updateDiff: jest.fn(async (_p: string, _d: string, body: Record<string, unknown>) => {
      updates.push(body);
      return {};
    }),
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => undefined),
    createDiffFinding: jest.fn(async () => ({})),
  };

  const runManager = new RunManager();
  runManager.start({ sessionId: DIFF_ID, projectId: 'proj-scope', architectureId: 'arch-scope' });

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    runManager,
    now: () => 1700000000000,
    classifyDiffItem: () => ({ shouldEmit: false }) as never,
  });

  // ONLY the in-scope pairing was persisted — the out-of-scope /pets source
  // item did NOT surface as source_only.
  expect(diffItemsCreated).toHaveLength(1);
  expect(diffItemsCreated[0].path).toBe('/owners/42');
  expect(diffItemsCreated[0].status_classification).toBe('status_match');
  const completed = updates.find((u) => u.status === 'completed')!;
  expect(completed.source_only_count).toBe(0);
  jest.restoreAllMocks();
});
