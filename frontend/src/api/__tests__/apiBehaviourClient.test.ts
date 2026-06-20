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
  isSecretsNotLoadedError,
  SECRETS_NOT_LOADED_CODE,
  ApiBehaviourApiError,
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
