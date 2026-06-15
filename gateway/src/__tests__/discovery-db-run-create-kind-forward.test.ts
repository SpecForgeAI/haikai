/**
 * Cross-stack gap-fill test: gateway run-create proxy forwards
 * `discovery_kind` and `database_config` verbatim to discovery-service.
 *
 * Spec 2026-05-16: Database Discovery Packs -- Task Group 6.
 *
 * Existing tests cover:
 *   - Gateway DB test-connection proxy (URL translation + body forwarding +
 *     error envelopes) in `discovery-db-test-connection-proxy.test.ts`.
 *   - AMS discovery_kind controller / persistence in Group 1.
 *   - Frontend modal builds the body shape with discoveryKind='database' in
 *     `StartDiscoveryRunModal.dbSource.test.tsx` (UI behaviour only).
 *
 * Gap: nothing pins the gateway run-create proxy specifically forwarding the
 * `discovery_kind` and `database_config` keys for the DB-source flow. The
 * gateway is supposed to be a transparent passthrough -- this test is the
 * regression net for that property at the cross-stack boundary.
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

describe('Gateway run-create proxy forwards discovery_kind + database_config (Spec 2026-05-16, Group 6)', () => {
  let app: express.Application;

  const discoveryServiceBase = 'http://localhost:8091';
  const projectId = '11111111-1111-1111-1111-111111111111';
  const architectureId = '22222222-2222-2222-2222-222222222222';
  const downstreamUrl =
    `${discoveryServiceBase}/discovery/projects/${projectId}` +
    `/architectures/${architectureId}/runs`;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id-group6';
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

  it('forwards discovery_kind="database" + database_config in the request body to the discovery-service run-create endpoint', async () => {
    // This is the exact body shape `frontend/src/services/gatewayClient.ts`
    // (`startDiscoveryRun` extras branch) sends when the user picks the
    // Database source. The password ridealong is intentional -- the
    // discovery-service needs it in-memory for the run's lifetime; the
    // gateway must NOT strip it.
    const requestBody = {
      serviceId: 'svc-1',
      confirmLlmSolo: false,
      discovery_kind: 'database',
      database_config: {
        dbEngine: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        databaseName: 'demo',
        profilingMode: 'standard',
        readOnlyConfirmed: true,
        username: 'ro_user',
        password: 'super-secret',
      },
    };
    const downstreamResponse = {
      id: 'run-xyz',
      project_id: projectId,
      architecture_id: architectureId,
      discovery_kind: 'database',
      status: 'PENDING',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => downstreamResponse,
    });

    const response = await request(app)
      .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`)
      .send(requestBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(downstreamResponse);

    // The gateway forwarded exactly one POST to the discovery-service run
    // endpoint, with the run-create body byte-for-byte.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(downstreamUrl);
    expect(options.method).toBe('POST');

    const forwardedBody = JSON.parse(options.body);
    // discovery_kind and database_config both present (the gap-fill).
    expect(forwardedBody.discovery_kind).toBe('database');
    expect(forwardedBody.database_config).toBeDefined();
    expect(forwardedBody.database_config.dbEngine).toBe('postgres');
    // Password ridealong preserved (gateway does NOT strip).
    expect(forwardedBody.database_config.password).toBe('super-secret');
    // Existing fields still present (regression net for the code path).
    expect(forwardedBody.serviceId).toBe('svc-1');
    expect(forwardedBody.confirmLlmSolo).toBe(false);
  });

  it('omits discovery_kind for legacy code-source POSTs (regression net for existing code runs)', async () => {
    // Existing flow: the modal does NOT set extras for the code source, so
    // the body has neither discovery_kind nor database_config. The gateway
    // must still forward cleanly and not fabricate either field.
    const requestBody = {
      serviceId: 'svc-1',
      confirmLlmSolo: false,
    };
    const downstreamResponse = {
      id: 'run-code-abc',
      project_id: projectId,
      architecture_id: architectureId,
      discovery_kind: 'code',
      status: 'PENDING',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => downstreamResponse,
    });

    await request(app)
      .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`)
      .send(requestBody)
      .expect(200);

    const [, options] = mockFetch.mock.calls[0];
    const forwardedBody = JSON.parse(options.body);
    // No fabrication: legacy body shape is untouched.
    expect(forwardedBody.discovery_kind).toBeUndefined();
    expect(forwardedBody.database_config).toBeUndefined();
    expect(forwardedBody.serviceId).toBe('svc-1');
  });
});
