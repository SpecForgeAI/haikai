/**
 * Focused test for the gateway "Scan for vulnerabilities" trigger PROXY route
 * (Spec 2 -- Automated Vulnerability Enrichment, Task Group 3, task 3.1b).
 *
 * Scope (tight -- one proxy contract):
 *   the gateway proxy route forwards the trigger TRANSPARENTLY (status + body)
 *   to the discovery-service `.../vulnerabilities/scan` endpoint, mirroring the
 *   existing `discovery.ts` run-create / resume / rescore proxy precedent. The
 *   gateway runs NO OSV and holds NO graph -- it is a thin proxy.
 *
 * The discovery-service is stubbed via a mocked global `fetch`; the test asserts
 * the deterministic plumbing (downstream URL, forwarded body, status + body
 * relayed back) and that a transport failure surfaces as 503.
 */

import request from 'supertest';
import express from 'express';
import { vulnerabilitiesRouter } from '../vulnerabilities';

// Quiet logger.
jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Config: the scan proxy reads discoveryServiceBaseUrl (the other routes read
// architectureModelServiceBaseUrl -- supply both).
jest.mock('../../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://ams.test',
    discoveryServiceBaseUrl: 'http://discovery.test',
  }),
}));

// The upload route adapts the LLM client at import; stub it so importing the
// router is side-effect-free.
jest.mock('../../services/llmClient', () => ({
  getLlmClient: () => ({ sendChatRequest: jest.fn() }),
}));

describe('Vulnerabilities gateway scan-trigger proxy (task 3.1b)', () => {
  let app: express.Application;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/', vulnerabilitiesRouter);

    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  it('forwards the trigger to the discovery-service scan endpoint and relays status + body transparently', async () => {
    const upstreamBody = {
      status: 'ok',
      availability: { available: true, rowsMinted: 2, note: 'ran' },
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => upstreamBody,
    });

    const res = await request(app)
      .post('/projects/p1/architectures/a1/vulnerabilities/scan')
      .send({ refresh: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstreamBody);

    // Forwarded to the DISCOVERY-SERVICE scan endpoint (not AMS), with the body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'http://discovery.test/discovery/projects/p1/architectures/a1/vulnerabilities/scan',
    );
    expect(calledInit.method).toBe('POST');
    expect(JSON.parse(calledInit.body)).toEqual({ refresh: true });
  });

  it('relays a degraded (available=false) discovery response verbatim WITHOUT turning it into an error', async () => {
    const degraded = {
      status: 'unavailable',
      availability: { available: false, reason: 'timeout', note: 'continues on the internal report alone' },
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => degraded,
    });

    const res = await request(app)
      .post('/projects/p1/architectures/a1/vulnerabilities/scan')
      .send({});

    // The discovery-service already returns 200 for the degraded state; the
    // proxy relays it verbatim (no re-interpretation into a 4xx/5xx).
    expect(res.status).toBe(200);
    expect(res.body.availability.available).toBe(false);
  });

  it('surfaces a discovery-service transport failure as 503 (thin proxy, benign)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED discovery'));

    const res = await request(app)
      .post('/projects/p1/architectures/a1/vulnerabilities/scan')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe(503);
    expect(res.body.error.message).toMatch(/discovery service unavailable/i);
  });
});
