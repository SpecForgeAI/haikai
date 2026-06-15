/**
 * Tests for Library-Scan Discovery Proxy Routes
 *
 * Spec 2026-05-06: Library Discovery Integration -- Task Group 6
 *
 * Verifies the 4 new gateway proxy routes for the library-aware discovery
 * flow forward correctly to discovery-service:
 *   - POST .../services/:serviceId/preflight-library-scan
 *   - POST .../libraries/:libraryId/preflight-library-scan
 *   - POST .../services/:serviceId/start-library-scan
 *   - POST .../libraries/:libraryId/start-library-scan
 *
 * Tests:
 * 1. All 4 routes proxy to the correct discovery-service URL with the body
 *    intact / synthesised correctly and forward the discovery-service response.
 * 2. Non-2xx responses (400 from discovery-service) are propagated transparently.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

// Mock fetch globally for proxying to discovery-service
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock logger to avoid console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Library-Scan Discovery Proxy Routes (Spec 2026-05-06, Task Group 6)', () => {
  let app: express.Application;

  const projectId = 'proj-uuid-1';
  const architectureId = 'arch-uuid-1';
  const serviceId = 'svc-aaa';
  const libraryId = 'lib-bbb';

  const sampleScanPlan = {
    root: {
      kind: 'service',
      id: serviceId,
      name: 'OrderService',
      repo_location: 'https://github.com/example/repo.git',
      repo_subfolder: 'services/order',
      ecosystem: 'MAVEN',
    },
    internalLibrariesToScan: [],
    externalLibrariesToRecord: [],
    warnings: [],
  };

  const sampleRunStarted = {
    id: 'run-xyz',
    project_id: projectId,
    architecture_id: architectureId,
    status: 'PENDING',
  };

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

  // --------------------------------------------------------------------------
  // Test 1: All 4 routes proxy correctly
  // --------------------------------------------------------------------------

  it('Test 1: proxies all 4 library-scan routes to discovery-service with the correct URL and body', async () => {
    // Service-rooted preflight
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleScanPlan,
    });

    let response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/services/${serviceId}/preflight-library-scan`
      )
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.root.kind).toBe('service');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    let [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain(
      `/discovery/projects/${projectId}/architectures/${architectureId}/services/${serviceId}/preflight-library-scan`
    );
    expect(options.method).toBe('POST');

    // Library-rooted preflight
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...sampleScanPlan, root: { ...sampleScanPlan.root, kind: 'library', id: libraryId } }),
    });

    response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/libraries/${libraryId}/preflight-library-scan`
      )
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.root.kind).toBe('library');
    [url] = mockFetch.mock.calls[1];
    expect(url).toContain(
      `/discovery/projects/${projectId}/architectures/${architectureId}/libraries/${libraryId}/preflight-library-scan`
    );

    // Service-rooted start-library-scan -- forwards to .../runs with library-scoped body
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => sampleRunStarted,
    });

    response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/services/${serviceId}/start-library-scan`
      )
      .send({ includeExternal: true });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('run-xyz');
    [url, options] = mockFetch.mock.calls[2];
    expect(url).toContain(
      `/discovery/projects/${projectId}/architectures/${architectureId}/runs`
    );
    const sentBody = JSON.parse(options.body);
    expect(sentBody.runMode).toBe('library-scoped');
    expect(sentBody.serviceId).toBe(serviceId);
    expect(sentBody.includeExternal).toBe(true);

    // Library-rooted start-library-scan -- forwards to .../runs with library-scoped body
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => sampleRunStarted,
    });

    response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/libraries/${libraryId}/start-library-scan`
      )
      .send({ includeExternal: false });

    expect(response.status).toBe(201);
    [url, options] = mockFetch.mock.calls[3];
    expect(url).toContain(
      `/discovery/projects/${projectId}/architectures/${architectureId}/runs`
    );
    const sentBody2 = JSON.parse(options.body);
    expect(sentBody2.runMode).toBe('library-scoped');
    expect(sentBody2.libraryId).toBe(libraryId);
    expect(sentBody2.includeExternal).toBe(false);

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  // --------------------------------------------------------------------------
  // Test 2: Non-2xx propagation (400 from discovery-service)
  // --------------------------------------------------------------------------

  it('Test 2: forwards non-2xx responses (400) from discovery-service transparently', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 400, message: 'Invalid serviceId' } }),
    });

    const response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/services/${serviceId}/preflight-library-scan`
      )
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Invalid serviceId');
  });
});
