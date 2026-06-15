/**
 * Tests for the gateway Tech Hints Resolve relay route.
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 3
 *
 * The gateway forwards POST /api/v1/discovery/tech-hints/resolve to
 * discovery-service POST /discovery/tech-hints/resolve as a thin pass-through
 * that mirrors the structural pattern of `discoveryGapFill.ts` for the
 * user-facing contract:
 *   - 200 pass-through on downstream success.
 *   - 502 downstream unreachable (network error).
 *   - 504 downstream timeout.
 *   - 4xx/5xx body passthrough with `reason` preserved.
 *   - 400 validation on missing freeText.
 */

import request from 'supertest';
import express from 'express';
import { techHintsResolveRouter } from '../routes/techHintsResolve';
import { resetConfig } from '../config';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('POST /api/v1/discovery/tech-hints/resolve (gateway relay)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-req-id';
      next();
    });
    app.use('/api/v1/discovery', techHintsResolveRouter);
    mockFetch.mockReset();
    resetConfig();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('happy path: forwards body to discovery-service and returns 200 body unchanged', async () => {
    const downstreamBody = {
      language: { name: 'Java', version: '21' },
      frameworks: [{ name: 'Spring Boot', version: '3' }],
      languagePack: 'java-lang',
      frameworkPacks: ['java-spring-boot'],
      confirmationSentence: 'Detected Java 21 service using Spring Boot 3.',
      repoCrossCheck: { status: 'confirmed', note: 'pom.xml confirms Spring Boot.' },
      confidence: 'high',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => downstreamBody,
    });

    const res = await request(app)
      .post('/api/v1/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java 21 (Spring Boot 3)',
        repoLocation: 'https://github.com/acme/orders.git',
        repoSubfolder: 'services/orders',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(downstreamBody);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:8091/discovery/tech-hints/resolve');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.freeText).toBe('Java 21 (Spring Boot 3)');
    expect(body.repoLocation).toBe('https://github.com/acme/orders.git');
    expect(body.repoSubfolder).toBe('services/orders');
  });

  it('downstream 502 with reason body is preserved (502 + reason)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'LLM provider error', reason: 'llm_malformed' }),
    });

    const res = await request(app)
      .post('/api/v1/discovery/tech-hints/resolve')
      .send({ freeText: 'Java 21' });

    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('llm_malformed');
  });

  it('downstream 504 preserved as 504', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 504,
      json: async () => ({ error: 'clone timeout', reason: 'clone_timeout' }),
    });

    const res = await request(app)
      .post('/api/v1/discovery/tech-hints/resolve')
      .send({
        freeText: 'Java 21',
        repoLocation: 'https://github.com/acme/orders.git',
      });

    expect(res.status).toBe(504);
    expect(res.body.reason).toBe('clone_timeout');
  });

  it('missing freeText returns 400 without calling downstream', async () => {
    const res = await request(app)
      .post('/api/v1/discovery/tech-hints/resolve')
      .send({});
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('downstream unreachable (network error) returns 502', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .post('/api/v1/discovery/tech-hints/resolve')
      .send({ freeText: 'Java 21' });

    expect(res.status).toBe(502);
  });
});
