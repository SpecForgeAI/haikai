/**
 * Tests for the Database Discovery Pack test-connection Gateway Proxy
 *
 * Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Task
 * Group 5 (Phase 5.1).
 *
 * Scope: thin proxy pass-through to discovery-service. The tests pin
 *  - URL translation (gateway /api/v1/discovery/db/test-connection
 *    -> discovery-service /discovery/db/test-connection)
 *  - body forwarding verbatim (engine + host + port + credentials)
 *  - upstream error status + body forwarding (400 connection failure)
 *  - 503 surfaced when the discovery-service is unreachable
 *
 * No business logic. No defaulting. Per the spec the gateway is a pure
 * proxy for the DB endpoints; defaults / validation live in the
 * discovery-service route handler.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Discovery DB test-connection proxy (Spec 2026-05-16, Task Group 5)', () => {
  let app: express.Application;

  // Match the gateway's default `discoveryServiceBaseUrl` -- this is what
  // `getConfig()` returns when DISCOVERY_SERVICE_URL is not set in the env.
  const discoveryServiceBase = 'http://localhost:8091';
  const downstreamUrl = `${discoveryServiceBase}/discovery/db/test-connection`;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/v1/discovery', discoveryRouter);
    mockFetch.mockReset();
    resetConfig();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  // ===========================================================================
  // Test 1: success path -- URL translation + body forwarded verbatim
  // ===========================================================================
  it('POST /db/test-connection proxies to discovery-service with body forwarded verbatim', async () => {
    const requestBody = {
      dbEngine: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      databaseName: 'demo',
      username: 'ro_user',
      password: 'super-secret',
      profilingMode: 'standard',
      readOnlyConfirmed: true,
    };
    const downstreamResponse = {
      success: true,
      engine: 'postgres',
      serverVersion: 'PostgreSQL 16.0',
      serverEdition: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => downstreamResponse,
    });

    const response = await request(app)
      .post('/api/v1/discovery/db/test-connection')
      .send(requestBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(downstreamResponse);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    // URL translation: gateway path -> discovery-service path
    expect(url).toBe(downstreamUrl);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Accept']).toBe('application/json');

    // Body forwarded verbatim -- including the password field (the gateway
    // does NOT strip it; the discovery-service holds it in-memory for the
    // probe and purges it on completion).
    expect(JSON.parse(options.body)).toEqual(requestBody);
  });

  // ===========================================================================
  // Test 2: discovery-service surfaces a 400 connection failure verbatim
  // ===========================================================================
  it('forwards a 400 connection-failure body verbatim from the discovery-service', async () => {
    const requestBody = {
      dbEngine: 'postgres',
      host: 'unreachable.invalid',
      port: 5432,
      databaseName: 'demo',
      username: 'ro_user',
      password: 'pw',
      readOnlyConfirmed: true,
    };
    const downstreamError = {
      success: false,
      engine: 'postgres',
      error: {
        code: 400,
        message: 'connect ENOTFOUND unreachable.invalid',
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => downstreamError,
    });

    const response = await request(app)
      .post('/api/v1/discovery/db/test-connection')
      .send(requestBody);

    // Upstream status preserved AND body forwarded verbatim so the UI can
    // render the engine error message without translation.
    expect(response.status).toBe(400);
    expect(response.body).toEqual(downstreamError);
  });

  // ===========================================================================
  // Test 3: discovery-service unreachable -> 503 envelope
  // ===========================================================================
  it('surfaces a 503 when the discovery-service is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app)
      .post('/api/v1/discovery/db/test-connection')
      .send({
        dbEngine: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        databaseName: 'demo',
        username: 'ro_user',
        password: 'pw',
        readOnlyConfirmed: true,
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: 503,
        message: 'Discovery service unavailable',
      },
    });
  });
});
