/**
 * apiBehaviourClient tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
 * Task 7.1 sub-test #1: confirm `createCaptureSession` POSTs to the right
 * gateway URL with the right body and returns the parsed DTO on success.
 *
 * Test strategy:
 *   - Vitest with vi.fn() shimming globalThis.fetch (mirrors the existing
 *     architecturesApi.test.ts pattern but uses `globalThis` so this new
 *     file is TS-clean under the project's tsconfig -- the older tests
 *     reference `global` which is the long-standing pre-existing TS noise).
 *   - Single focused test; AMS CRUD and action endpoint surface is wide,
 *     this test just nails the URL contract for the one verb the wizard
 *     uses first. The wizard tests cover the rest of the surface
 *     transitively through component-level assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createCaptureSession,
  testApiConnectionStateless,
  type ApiBehaviourCaptureSessionDto,
  manualCapture,
  addOperation,
  type AddOperationRequest,
  type AddOperationResponse,
  type ApiBehaviourOperationDto,
  isSecretsNotLoadedError,
  SECRETS_NOT_LOADED_CODE,
  ApiBehaviourApiError,
  dataTypeDefaultsPreview,
  type DataTypeDefaultsPreviewResponse,
  createBaselineItemsBatch,
  chunkBaselineItemsForBatch,
  MAX_BASELINE_ITEMS_PER_BATCH,
  MAX_BASELINE_ITEMS_BATCH_BYTES,
  updateCapturesBatch,
  type BatchCreateBaselineItemsResponse,
  type BatchUpdateCapturesResponse,
  type CreateApiBehaviourBaselineItemRequest,
  type ApiBehaviourBaselineItemDto,
  type ApiBehaviourCaptureDto,
  type CreateApiBehaviourCaptureSessionRequest,
  type UpdateApiBehaviourCaptureSessionRequest,
} from '../apiBehaviourClient';

const PROJECT_ID = 'proj-uuid-aaa';
const ARCH_ID = 'arch-uuid-bbb';

function buildSessionFixture(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: 'session-uuid-1',
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Test session',
    status: 'draft',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'none',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

describe('apiBehaviourClient -- createCaptureSession (Task 7.1 #1)', () => {
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

  it('POSTs to /api/v1/projects/:projectId/architectures/:architectureId/api-behaviour/capture-sessions with the JSON body', async () => {
    const created = buildSessionFixture({ name: 'My non-prod capture' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => created,
    });

    const result = await createCaptureSession(PROJECT_ID, ARCH_ID, {
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      name: 'My non-prod capture',
      environment_name: 'non-prod',
      api_base_url: 'https://api.example.com',
      auth_type: 'none',
      mutating_calls_confirmed: false,
    });

    expect(result).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    // Gateway URL shape per spec: /api/v1/projects/:p/architectures/:a/api-behaviour/<resource>
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/capture-sessions`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(options.body);
    expect(body.project_id).toBe(PROJECT_ID);
    expect(body.architecture_id).toBe(ARCH_ID);
    expect(body.name).toBe('My non-prod capture');
    expect(body.mutating_calls_confirmed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bug fix (2026-05-17): submitSecrets must reshape the friendly camelCase
// payload `{ apiAuth, dbPassword }` into the backend wire shape
// `{ api: { type, ... }, db: { password } | null }` and remap the wizard's
// 'header' auth type to the backend vocab 'custom_header'. Before the fix
// every secrets POST 400'd with "secrets body must include { api: ... }".
// ---------------------------------------------------------------------------

describe('apiBehaviourClient -- submitSecrets payload reshape (Bug fix 2026-05-17)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reshapes { apiAuth: { type: 'bearer', token }, dbPassword } to { api, db }", async () => {
    const { submitSecrets } = await import('../apiBehaviourClient');
    await submitSecrets(PROJECT_ID, ARCH_ID, 'session-1', {
      apiAuth: { type: 'bearer', token: 'tok-abc' },
      dbPassword: 'db-pwd-xyz',
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.api).toEqual({ type: 'bearer', token: 'tok-abc' });
    expect(body.db).toEqual({ password: 'db-pwd-xyz' });
    // Pre-fix shape (apiAuth / dbPassword on the wire) must NOT be present.
    expect(body.apiAuth).toBeUndefined();
    expect(body.dbPassword).toBeUndefined();
  });

  it("maps wizard authType 'header' -> backend 'custom_header'", async () => {
    const { submitSecrets } = await import('../apiBehaviourClient');
    await submitSecrets(PROJECT_ID, ARCH_ID, 'session-1', {
      apiAuth: { type: 'header', headerName: 'X-Key', headerValue: 'v' },
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.api.type).toBe('custom_header');
    expect(body.api.headerName).toBe('X-Key');
    expect(body.api.headerValue).toBe('v');
  });

  it('sends db: null when dbPassword is null / absent', async () => {
    const { submitSecrets } = await import('../apiBehaviourClient');
    await submitSecrets(PROJECT_ID, ARCH_ID, 'session-1', {
      apiAuth: { type: 'none' },
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.db).toBeNull();
  });

  it("passes 'bearer' / 'basic' / 'none' through unchanged", async () => {
    const { submitSecrets } = await import('../apiBehaviourClient');
    for (const t of ['bearer', 'basic', 'none']) {
      fetchMock.mockClear();
      await submitSecrets(PROJECT_ID, ARCH_ID, 'session-1', {
        apiAuth: { type: t },
      });
      const [, options] = fetchMock.mock.calls[0];
      expect(JSON.parse(options.body).api.type).toBe(t);
    }
  });

  it('carries the read-only observation login as db.readonly_* (Kiro run-3 Issue 4)', async () => {
    const { submitSecrets } = await import('../apiBehaviourClient');
    await submitSecrets(PROJECT_ID, ARCH_ID, 'session-1', {
      apiAuth: { type: 'none' },
      dbPassword: 'write-pwd',
      dbReadonlyUsername: 'obs_reader',
      dbReadonlyPassword: 'obs-pwd',
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.db).toEqual({
      password: 'write-pwd',
      readonly_username: 'obs_reader',
      readonly_password: 'obs-pwd',
    });
  });

  it('a LONE read-only value is dropped (both-or-nothing, matching the backend rule)', async () => {
    const { submitSecrets } = await import('../apiBehaviourClient');
    await submitSecrets(PROJECT_ID, ARCH_ID, 'session-1', {
      apiAuth: { type: 'none' },
      dbPassword: 'write-pwd',
      dbReadonlyUsername: 'obs_reader',
      dbReadonlyPassword: null,
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.db).toEqual({ password: 'write-pwd' });
  });
});

// ---------------------------------------------------------------------------
// Fix C (2026-06-02): stateless in-wizard "Test API connection" probe.
// `testApiConnectionStateless` POSTs the full connection config to the
// gateway's stateless endpoint
//   POST /api/v1/projects/:p/architectures/:a/api-behaviour/test-connection
// (NO session id in the path -- it is pre-session) and returns the probe
// result `{ success, status, durationMs, error? }`.
// ---------------------------------------------------------------------------

describe('apiBehaviourClient -- testApiConnectionStateless (Fix C 2026-06-02)', () => {
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

  it('POSTs the baseUrl/auth/defaultHeaders body to the stateless test-connection endpoint and returns the result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => ({ success: true, status: 200, durationMs: 88 }),
    });

    const result = await testApiConnectionStateless(PROJECT_ID, ARCH_ID, {
      baseUrl: 'https://api.nonprod.example.com',
      auth: { type: 'header', headerName: 'ssoToken', headerValue: 'sec' },
      defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
    });

    expect(result).toEqual({ success: true, status: 200, durationMs: 88 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    // Stateless endpoint: NO capture-sessions/:id segment -- it is pre-session.
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/test-connection`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(options.body);
    expect(body.baseUrl).toBe('https://api.nonprod.example.com');
    expect(body.auth).toEqual({ type: 'header', headerName: 'ssoToken', headerValue: 'sec' });
    expect(body.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'acme' }]);
  });
});

// ---------------------------------------------------------------------------
// Manual capture ("Add New Behaviour", spec 2026-06-20, Task 4.1).
// Mirrors the createCaptureSession/testApiConnectionStateless fetch-shim style.
// ---------------------------------------------------------------------------
describe('apiBehaviourClient -- manualCapture (Task 4.1)', () => {
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

  it('POSTs to the manual-capture action URL with the camelCase body shape', async () => {
    const capture = { id: 'cap-1', session_id: 'session-uuid-1', scenario_id: 'scn-1' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => ({ sessionId: 'session-uuid-1', scenarioId: 'scn-1', capture }),
    });

    const result = await manualCapture(PROJECT_ID, ARCH_ID, 'session-uuid-1', {
      operationId: 'op-1',
      method: 'POST',
      path: '/pets/42',
      query: { q: '1' },
      headers: { 'X-Tenant': 'acme' },
      body: { name: 'Rex' },
      mutatingCallsConfirmed: true,
    });

    expect(result.scenarioId).toBe('scn-1');
    expect(result.capture).toEqual(capture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/capture-sessions/session-uuid-1/manual-capture`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(options.body);
    expect(body.operationId).toBe('op-1');
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/pets/42');
    expect(body.query).toEqual({ q: '1' });
    expect(body.headers).toEqual({ 'X-Tenant': 'acme' });
    expect(body.body).toEqual({ name: 'Rex' });
    expect(body.mutatingCallsConfirmed).toBe(true);
  });

  it('surfaces a 409 SECRETS_NOT_LOADED as a detectable typed error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => ({ error: { code: SECRETS_NOT_LOADED_CODE, message: 'Secrets not loaded' } }),
    });

    let caught: unknown;
    try {
      await manualCapture(PROJECT_ID, ARCH_ID, 'session-uuid-1', {
        operationId: 'op-1',
        method: 'GET',
        path: '/pets',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiBehaviourApiError);
    expect((caught as ApiBehaviourApiError).status).toBe(409);
    expect((caught as ApiBehaviourApiError).body.code).toBe(SECRETS_NOT_LOADED_CODE);
    expect(isSecretsNotLoadedError(caught)).toBe(true);
  });

  it('does not flag a non-secrets error as SECRETS_NOT_LOADED', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => ({ error: { code: 'OPERATION_NOT_INCLUDED', message: 'nope' } }),
    });

    let caught: unknown;
    try {
      await manualCapture(PROJECT_ID, ARCH_ID, 'session-uuid-1', {
        operationId: 'op-1',
        method: 'GET',
        path: '/pets',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiBehaviourApiError);
    expect(isSecretsNotLoadedError(caught)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Data-type format defaults (Spec 2026-06-20, Task 5.1).
//   #1 dataTypeDefaultsPreview POSTs to the right action URL and returns the
//      typed rows verbatim (category, code/contract formats, seeded Col-4,
//      contributing fields).
//   #2 the session DTO + Create/Update request types round-trip
//      data_type_defaults_json INCLUDING a null map value.
// Mirrors the createCaptureSession / manualCapture fetch-shim style above.
// ---------------------------------------------------------------------------
describe('apiBehaviourClient -- dataTypeDefaultsPreview (Task 5.1 #1)', () => {
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

  it('POSTs to the data-type-defaults-preview action URL and returns the typed rows', async () => {
    const preview: DataTypeDefaultsPreviewResponse = {
      sessionId: 'session-uuid-1',
      rows: [
        {
          category: 'date',
          code_formats: ['dd-MMM-yyyy'],
          contract_formats: ['date'],
          default_format: 'dd-MMM-yyyy',
          contributing_fields: [
            {
              name: 'startDate',
              location: 'query',
              code_format: 'dd-MMM-yyyy',
              contract_format: null,
            },
          ],
        },
        {
          category: 'enum',
          code_formats: [],
          contract_formats: [],
          default_format: null,
          contributing_fields: [
            { name: 'status', location: 'body', code_format: null, contract_format: null },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => preview,
    });

    const result = await dataTypeDefaultsPreview(PROJECT_ID, ARCH_ID, 'session-uuid-1');

    // The typed rows come back verbatim, including a null default_format and
    // a null contract_format inside a contributing field.
    expect(result).toEqual(preview);
    expect(result.rows[0].category).toBe('date');
    expect(result.rows[0].default_format).toBe('dd-MMM-yyyy');
    expect(result.rows[1].default_format).toBeNull();
    expect(result.rows[0].contributing_fields[0].contract_format).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/capture-sessions/session-uuid-1/data-type-defaults-preview`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    // No body fields required -- the action reads everything server-side.
    expect(JSON.parse(options.body)).toEqual({});
  });
});

describe('apiBehaviourClient -- data_type_defaults_json round-trip (Task 5.1 #2)', () => {
  it('carries data_type_defaults_json (with a null map value) on the session DTO', () => {
    // A map that mixes a chosen default AND an explicit null (no-default).
    // The null value must survive as a typed property of the DTO -- it is
    // distinct from an absent key.
    const session = buildSessionFixture({
      data_type_defaults_json: { date: 'dd-MMM-yyyy', enum: null },
    });
    expect(session.data_type_defaults_json).toEqual({ date: 'dd-MMM-yyyy', enum: null });
    expect(session.data_type_defaults_json).toHaveProperty('enum', null);
    // JSON.stringify keeps the null value (not dropped like undefined).
    const wire = JSON.parse(JSON.stringify(session)) as typeof session;
    expect(wire.data_type_defaults_json).toEqual({ date: 'dd-MMM-yyyy', enum: null });
    expect('enum' in (wire.data_type_defaults_json ?? {})).toBe(true);
  });

  it('accepts data_type_defaults_json (incl. a null value) on Create + Update request types', () => {
    const createReq: CreateApiBehaviourCaptureSessionRequest = {
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      data_type_defaults_json: { date: 'dd-MMM-yyyy', enum: null },
    };
    const updateReq: UpdateApiBehaviourCaptureSessionRequest = {
      data_type_defaults_json: { datetime: "yyyy-MM-dd'T'HH:mm:ss", enum: null },
    };
    // The null map value round-trips through JSON on both request shapes.
    expect(JSON.parse(JSON.stringify(createReq)).data_type_defaults_json).toEqual({
      date: 'dd-MMM-yyyy',
      enum: null,
    });
    expect(JSON.parse(JSON.stringify(updateReq)).data_type_defaults_json.enum).toBeNull();
    // The whole map itself may also be null (explicit empty state).
    const cleared: UpdateApiBehaviourCaptureSessionRequest = { data_type_defaults_json: null };
    expect(cleared.data_type_defaults_json).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Batch baseline-items + captures (Spec 2026-06-20 Baseline Save & Review --
// Batch + Activate + Export, Task 3.1). These two helpers collapse the per-item
// save / accept-all / reject-all loops into a single best-effort batch call.
//   #1 createBaselineItemsBatch POSTs `{ items }` to .../baseline-items/batch
//      and returns the typed `{ created, failed }` (failed carries index +
//      capture_id + reason).
//   #2 updateCapturesBatch PATCHes `{ items: [{ id, patch }] }` to
//      .../captures/batch and returns the typed `{ updated, failed }`.
// Mirrors the createCaptureSession / manualCapture fetch-shim style above.
// ---------------------------------------------------------------------------
describe('apiBehaviourClient -- createBaselineItemsBatch (Task 3.1 #1)', () => {
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

  it('POSTs { items } to the .../baseline-items/batch URL and returns { created, failed }', async () => {
    const createdItem: Partial<ApiBehaviourBaselineItemDto> = {
      id: 'item-1',
      baseline_id: 'bl-1',
      capture_id: 'cap-ok',
    };
    const response: BatchCreateBaselineItemsResponse = {
      created: [createdItem as ApiBehaviourBaselineItemDto],
      failed: [{ index: 1, capture_id: 'cap-bad', reason: 'capture_id not found' }],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => response,
    });

    const items: CreateApiBehaviourBaselineItemRequest[] = [
      { baseline_id: 'bl-1', capture_id: 'cap-ok', operation_id: 'op-1', scenario_id: 'scn-1' },
      { baseline_id: 'bl-1', capture_id: 'cap-bad', operation_id: 'op-2', scenario_id: 'scn-2' },
    ];
    const result = await createBaselineItemsBatch(PROJECT_ID, ARCH_ID, items);

    // The typed { created, failed } shape comes back verbatim.
    expect(result).toEqual(response);
    expect(result.created).toHaveLength(1);
    expect(result.failed[0]).toEqual({
      index: 1,
      capture_id: 'cap-bad',
      reason: 'capture_id not found',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    // Literal `batch` sub-path on the baseline-items collection.
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/baseline-items/batch`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    // The whole array is sent in ONE request under the `items` envelope.
    const body = JSON.parse(options.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].capture_id).toBe('cap-ok');
    expect(body.items[1].capture_id).toBe('cap-bad');
  });
});

describe('apiBehaviourClient -- createBaselineItemsBatch chunking (413 / 500-cap fix 2026-09-02)', () => {
  // A whole-session save used to go out as ONE request and hit two caps at
  // once: the gateway's 30 MB body-parser limit (413 `request entity too
  // large`) and AMS's 500-item batch cap (400). The client now splits by
  // size AND count, sends chunks sequentially, and re-bases per-request
  // failure indexes onto the caller's original items[].
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

  function tinyItem(i: number): CreateApiBehaviourBaselineItemRequest {
    return {
      baseline_id: 'bl-1',
      capture_id: `cap-${i}`,
      operation_id: `op-${i}`,
      scenario_id: 'scn-1',
    };
  }

  function jsonResponse(body: BatchCreateBaselineItemsResponse) {
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => body,
    };
  }

  it('splits at the AMS item cap: 501 tiny items -> a 500-item chunk + a 1-item chunk with correct startIndex', () => {
    const items = Array.from({ length: MAX_BASELINE_ITEMS_PER_BATCH + 1 }, (_, i) => tinyItem(i));

    const chunks = chunkBaselineItemsForBatch(items);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].items).toHaveLength(MAX_BASELINE_ITEMS_PER_BATCH);
    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[1].items).toHaveLength(1);
    expect(chunks[1].startIndex).toBe(MAX_BASELINE_ITEMS_PER_BATCH);
    expect(chunks[1].items[0].capture_id).toBe(`cap-${MAX_BASELINE_ITEMS_PER_BATCH}`);
  });

  it('splits on the BYTE budget, not the count: four ~3 MB items -> two chunks, every chunk fits, nothing dropped or reordered', () => {
    // Size is the trigger here: 4 items is nowhere near the 500 cap.
    const bigBody = 'x'.repeat(3 * 1024 * 1024);
    const items = Array.from({ length: 4 }, (_, i) => ({
      ...tinyItem(i),
      response_json: { body: bigBody },
    }));

    const chunks = chunkBaselineItemsForBatch(items);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const serialised = new TextEncoder().encode(JSON.stringify({ items: chunk.items })).length;
      expect(serialised).toBeLessThanOrEqual(MAX_BASELINE_ITEMS_BATCH_BYTES);
    }
    // Flattening the chunks reproduces the original list exactly (order + identity).
    const flattened = chunks.flatMap((c) => c.items.map((it) => it.capture_id));
    expect(flattened).toEqual(items.map((it) => it.capture_id));
    // startIndex values are the running offsets of each chunk.
    let expectedStart = 0;
    for (const chunk of chunks) {
      expect(chunk.startIndex).toBe(expectedStart);
      expectedStart += chunk.items.length;
    }
  });

  it('sends chunks as separate sequential requests and re-bases failed[].index onto the original items[]', async () => {
    const items = Array.from({ length: MAX_BASELINE_ITEMS_PER_BATCH + 1 }, (_, i) => tinyItem(i));
    // Chunk 1: index 2 failed. Chunk 2: ITS index 0 failed -- which is
    // original index 500; the modal names failures by index as the fallback
    // identity, so an un-rebased index would blame the wrong capture.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          created: [{ id: 'item-0' } as ApiBehaviourBaselineItemDto],
          failed: [{ index: 2, capture_id: 'cap-2', reason: 'capture_id not found' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          created: [],
          failed: [
            { index: 0, capture_id: `cap-${MAX_BASELINE_ITEMS_PER_BATCH}`, reason: 'duplicate' },
          ],
        }),
      );

    const result = await createBaselineItemsBatch(PROJECT_ID, ARCH_ID, items);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.items).toHaveLength(MAX_BASELINE_ITEMS_PER_BATCH);
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0].capture_id).toBe(`cap-${MAX_BASELINE_ITEMS_PER_BATCH}`);
    // Merged created + re-based failures.
    expect(result.created).toHaveLength(1);
    expect(result.failed.map((f) => f.index)).toEqual([2, MAX_BASELINE_ITEMS_PER_BATCH]);
    expect(result.failed[1].capture_id).toBe(`cap-${MAX_BASELINE_ITEMS_PER_BATCH}`);
  });

  it('an empty items[] makes ZERO requests and returns empty created/failed', async () => {
    const result = await createBaselineItemsBatch(PROJECT_ID, ARCH_ID, []);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ created: [], failed: [] });
  });
});

describe('apiBehaviourClient -- updateCapturesBatch (Task 3.1 #2)', () => {
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

  it('PATCHes { items: [{ id, patch }] } to the .../captures/batch URL and returns { updated, failed }', async () => {
    const updatedCapture: Partial<ApiBehaviourCaptureDto> = {
      id: 'cap-ok',
      session_id: 'session-uuid-1',
      accepted: true,
    };
    const response: BatchUpdateCapturesResponse = {
      updated: [updatedCapture as ApiBehaviourCaptureDto],
      failed: [{ id: 'cap-bad', reason: 'capture not found' }],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => response,
    });

    // reject-all-style: each entry carries its OWN id + patch (notes preserved).
    const result = await updateCapturesBatch(PROJECT_ID, ARCH_ID, [
      { id: 'cap-ok', patch: { accepted: true, accepted_at: '2026-06-20T00:00:00Z' } },
      { id: 'cap-bad', patch: { accepted: false, accepted_at: null, reviewer_notes: 'n' } },
    ]);

    // The typed { updated, failed } shape comes back verbatim.
    expect(result).toEqual(response);
    expect(result.updated).toHaveLength(1);
    expect(result.failed[0]).toEqual({ id: 'cap-bad', reason: 'capture not found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    // Literal `batch` sub-path on the captures collection; PATCH verb.
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/captures/batch`,
    );
    expect(options.method).toBe('PATCH');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    // One request carries every { id, patch } entry under `items`.
    const body = JSON.parse(options.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      id: 'cap-ok',
      patch: { accepted: true, accepted_at: '2026-06-20T00:00:00Z' },
    });
    expect(body.items[1].id).toBe('cap-bad');
    expect(body.items[1].patch.reviewer_notes).toBe('n');
  });
});

// ---------------------------------------------------------------------------
// Add-operation client (Spec 2026-06-23 Import a Postman Collection into
// Capture, Task 2.1). The new add-operation client posts a CAMELCASE request
// body (this client owns its shape, like manualCapture) to the add-operation
// action URL and parses the SNAKE_CASE AMS operation DTO verbatim (R8). The
// other two Task 2.1 behaviours -- manualCapture body stays camelCase, and
// isSecretsNotLoadedError detects the 409 SECRETS_NOT_LOADED -- are already
// pinned by the manualCapture describe block above; these tests add the new
// surface.
// ---------------------------------------------------------------------------
describe('apiBehaviourClient -- addOperation (Task 2.1)', () => {
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

  it('POSTs a camelCase body to the add-operation action URL and parses the snake_case operation row', async () => {
    // The created operation row comes back as the snake_case AMS DTO.
    const operation: ApiBehaviourOperationDto = {
      id: 'op-row-1',
      session_id: 'session-uuid-1',
      operation_id: 'POST_/pets',
      method: 'POST',
      path: '/pets',
      summary: 'Create pet',
      description: null,
      included: true,
      safe_to_execute: null,
      request_schema_json: null,
      response_schema_json: null,
      oas_operation_json: null,
      created_at: '2026-06-23T00:00:00Z',
      updated_at: '2026-06-23T00:00:00Z',
    };
    const response: AddOperationResponse = {
      sessionId: 'session-uuid-1',
      operation,
      created: true,
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => response,
    });

    const req: AddOperationRequest = {
      endpointId: 'endpoint-9',
      method: 'POST',
      path: '/pets',
      operationId: 'POST_/pets',
      summary: 'Create pet',
    };
    const result = await addOperation(PROJECT_ID, ARCH_ID, 'session-uuid-1', req);

    // The snake_case AMS row is parsed verbatim (included=true so the
    // subsequent manual-capture send passes the OPERATION_NOT_INCLUDED guard).
    expect(result).toEqual(response);
    expect(result.operation.included).toBe(true);
    expect(result.operation.session_id).toBe('session-uuid-1');
    expect(result.created).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/capture-sessions/session-uuid-1/add-operation`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    // The request body is the camelCase shape this client owns -- NOT snake_case.
    const body = JSON.parse(options.body);
    expect(body.endpointId).toBe('endpoint-9');
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/pets');
    expect(body.operationId).toBe('POST_/pets');
    // Snake_case keys must NOT leak into the request body.
    expect(body.endpoint_id).toBeUndefined();
    expect(body.operation_id).toBeUndefined();
  });

  it('omits endpointId for an architecture-unmatched endpoint the user kept', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
      json: async () => ({ sessionId: 'session-uuid-1', operation: { id: 'op-2', included: true }, created: true }),
    });

    await addOperation(PROJECT_ID, ARCH_ID, 'session-uuid-1', {
      method: 'GET',
      path: '/widgets/7',
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/widgets/7');
    // No endpointId field at all (architecture-unmatched, kept-and-run path).
    expect('endpointId' in body).toBe(false);
  });
});
