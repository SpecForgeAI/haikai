/**
 * Stateless wizard pre-flight `POST /api/test-connection` tests (Fix 2).
 *
 * Spec: 2026-05-25 API Test Harness -- wizard pre-flight stateless
 * test-connection endpoint.
 *
 * The endpoint probes a target DIRECTLY from the request body -- no session,
 * no secretsStore write. It reuses the SAME probe path as the session-bound
 * `test-api-connection` (the shared `probeApiConnection` helper). These tests
 * spin up a real ephemeral HTTP server so the REAL probe path is exercised
 * end-to-end (auth header actually applied on the wire), then assert the
 * `{ success, status, durationMs }` response shape for both the bearer and
 * the custom-header (`'header'`) auth variants.
 *
 * Test inventory:
 *   1. bearer auth -> Authorization: Bearer <token> reaches the target;
 *      response is { success: true, status: 200, durationMs: number }.
 *   2. custom-header (`type: 'header'`) auth -> the named header + value reach
 *      the target; success shape returned.
 *   3. default headers (`{ name, value }[]`) reach the target.
 *   4. 5xx target -> success=false but still a real HTTP status.
 *   5. missing baseUrl -> 400.
 *   6. unreachable target (transport failure) -> 200 with
 *      { success: false, status: 0, error: <string> }.
 *   7. NEVER writes to the secretsStore.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { buildTestConnectionActionRouter } from '../routes/testConnectionAction';
import { secretsStore } from '../services/secretsStore';

// ---------------------------------------------------------------------------
// Ephemeral target server -- records the headers of the last request so the
// tests can assert the probe applied auth on the wire.
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

let targetServer: http.Server;
let targetBaseUrl: string;
let lastRequest: CapturedRequest | null = null;
let nextStatus = 200;

beforeAll((done) => {
  targetServer = http.createServer((req, res) => {
    lastRequest = {
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
    };
    res.statusCode = nextStatus;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  targetServer.listen(0, '127.0.0.1', () => {
    const addr = targetServer.address() as AddressInfo;
    targetBaseUrl = `http://127.0.0.1:${addr.port}`;
    done();
  });
});

afterAll((done) => {
  targetServer.close(() => done());
});

beforeEach(() => {
  lastRequest = null;
  nextStatus = 200;
  secretsStore.clearAll();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  // Production wiring uses the default probe (real network). We exercise that
  // real path here against the ephemeral local server.
  app.use(buildTestConnectionActionRouter());
  return app;
}

// ---------------------------------------------------------------------------
// Test 1: bearer auth reaches the target; success shape returned.
// ---------------------------------------------------------------------------
test('probes with bearer auth and returns { success, status, durationMs }', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/test-connection')
    .send({
      baseUrl: targetBaseUrl,
      auth: { type: 'bearer', token: 'plaintext-bearer-123' },
    });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.status).toBe(200);
  expect(typeof res.body.durationMs).toBe('number');
  expect(res.body.durationMs).toBeGreaterThanOrEqual(0);

  // The probe actually hit the target with the bearer header on the wire.
  expect(lastRequest).not.toBeNull();
  expect(lastRequest!.method).toBe('GET');
  expect(lastRequest!.headers.authorization).toBe('Bearer plaintext-bearer-123');
});

// ---------------------------------------------------------------------------
// Test 2: custom-header (`type: 'header'`) auth reaches the target.
// ---------------------------------------------------------------------------
test('probes with a custom header (type=header) and applies it on the wire', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/test-connection')
    .send({
      baseUrl: targetBaseUrl,
      auth: { type: 'header', headerName: 'X-Custom-Key', headerValue: 'secret-key-value' },
    });

  expect(res.status).toBe(200);
  // `authRejected` rides every probe result since the REST-XML capture round
  // (XML3): a 401/403 on the probe surfaces as an explicit flag.
  expect(res.body).toEqual({
    success: true,
    status: 200,
    durationMs: expect.any(Number),
    authRejected: false,
  });

  expect(lastRequest).not.toBeNull();
  expect(lastRequest!.headers['x-custom-key']).toBe('secret-key-value');
  // No Authorization header was set for a pure custom-header probe.
  expect(lastRequest!.headers.authorization).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Test 3: defaultHeaders ({ name, value }[]) reach the target.
// ---------------------------------------------------------------------------
test('applies defaultHeaders on the probe request', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/test-connection')
    .send({
      baseUrl: targetBaseUrl,
      auth: { type: 'none' },
      defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
    });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(lastRequest!.headers['x-tenant']).toBe('acme');
});

// ---------------------------------------------------------------------------
// Test 4: 5xx target -> success=false but still a real HTTP status.
// ---------------------------------------------------------------------------
test('a 5xx target yields success=false with the real status', async () => {
  nextStatus = 503;
  const app = buildApp();
  const res = await request(app)
    .post('/api/test-connection')
    .send({ baseUrl: targetBaseUrl, auth: { type: 'none' } });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(false);
  expect(res.body.status).toBe(503);
  expect(typeof res.body.durationMs).toBe('number');
});

// ---------------------------------------------------------------------------
// Test 5: missing baseUrl -> 400.
// ---------------------------------------------------------------------------
test('missing baseUrl returns 400', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/api/test-connection')
    .send({ auth: { type: 'bearer', token: 't' } });

  expect(res.status).toBe(400);
  expect(res.body.error.message).toContain('baseUrl');
});

// ---------------------------------------------------------------------------
// Test 6: unreachable target -> 200 with success=false + status 0 + error.
// Uses a port we never bind so the connection is refused.
// ---------------------------------------------------------------------------
test('unreachable target returns success=false, status=0, and an error string', async () => {
  const app = buildApp();
  // 127.0.0.1:1 is a privileged/unused port -> ECONNREFUSED.
  const res = await request(app)
    .post('/api/test-connection')
    .send({ baseUrl: 'http://127.0.0.1:1', auth: { type: 'none' } });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(false);
  expect(res.body.status).toBe(0);
  expect(typeof res.body.error).toBe('string');
  expect(res.body.error.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Test 7: the stateless endpoint NEVER writes to the secretsStore. A probe
// carrying secret material must leave the store with zero loaded sessions
// (the route has no session id and never calls secretsStore.set).
// ---------------------------------------------------------------------------
test('does not persist any secrets to the secretsStore', async () => {
  const app = buildApp();
  await request(app)
    .post('/api/test-connection')
    .send({
      baseUrl: targetBaseUrl,
      auth: { type: 'bearer', token: 'must-not-be-stored' },
    });

  expect(secretsStore.listLoadedSessionIds()).toHaveLength(0);
});
