/**
 * Spec 3 (Stored Proc & Function Behaviour Program, 2026-09-09): the proc
 * behaviour gateway proxies — AMVS session actions (path → downstream URL
 * with projectId/architectureId as query params) and the AMS data-plane
 * passthrough (method + body + query preserved). Downstream `fetch` mocked.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../config', () => ({
  getConfig: () => ({
    apiMigrationValidationServiceBaseUrl: 'http://amvs.test',
    architectureModelServiceBaseUrl: 'http://ams.test',
  }),
}));
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

import { procBehaviourRouter } from '../routes/procBehaviour';

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', procBehaviourRouter);
  return a;
}

describe('proc behaviour proxies', () => {
  beforeEach(() => mockFetch.mockReset());

  it('forwards session actions to AMVS with projectId/architectureId as query params', async () => {
    mockFetch.mockResolvedValue(jsonResponse(202, { accepted: true, routines: 3 }));
    const res = await request(app())
      .post('/api/v1/projects/p1/architectures/a1/proc-behaviour/capture-sessions/s1/start')
      .send({ anything: true });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, routines: 3 });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://amvs.test/api-migration-validation/api/proc-capture-sessions/s1/start?projectId=p1&architectureId=a1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ anything: true });
  });

  it('forwards the status read as a GET', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { run: { in_flight: false } }));
    const res = await request(app()).get('/api/v1/projects/p1/architectures/a1/proc-behaviour/capture-sessions/s1/status');
    expect(res.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/proc-capture-sessions/s1/status?projectId=p1&architectureId=a1');
    expect(init.method).toBe('GET');
  });

  it('passes the AMS data plane through with method, body and query preserved', async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { id: 'sess-1' }));
    const create = await request(app())
      .post('/api/v1/projects/p1/architectures/a1/proc-behaviour/capture-sessions')
      .send({ name: 'n', kind: 'current' });
    expect(create.status).toBe(201);
    let [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ams.test/api/projects/p1/architectures/a1/proc-behaviour/capture-sessions');
    expect(init.method).toBe('POST');

    mockFetch.mockResolvedValue(jsonResponse(200, []));
    const list = await request(app()).get('/api/v1/projects/p1/architectures/a1/proc-behaviour/baselines/pinned?kind=current');
    expect(list.status).toBe(200);
    [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('http://ams.test/api/projects/p1/architectures/a1/proc-behaviour/baselines/pinned?kind=current');
    expect(init.method).toBe('GET');

    mockFetch.mockResolvedValue(jsonResponse(200, [{ id: 'r1' }]));
    const routines = await request(app()).get('/api/v1/projects/p1/architectures/a1/db-routines?kind=procedure');
    expect(routines.status).toBe(200);
    [url] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('http://ams.test/api/projects/p1/architectures/a1/db-routines?kind=procedure');
  });

  it('answers 502 when a downstream is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app()).post('/api/v1/projects/p1/architectures/a1/proc-behaviour/capture-sessions/s1/cancel').send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unreachable/);
  });
});
