/**
 * Focused tests for the raw-query OSV batch endpoint (Spec C
 * 2026-06-27-live-vuln-reduction-recompute-osv-bridge-logging, Task Group 1,
 * task 1.1).
 *
 *   POST /discovery/vulnerabilities/osv-query-batch
 *
 * Scope (intentionally tight; 2-8 tests, the full degradation MATRIX is the
 * gateway adapter's Group 2 concern):
 *   (a) happy-path projection of the rich BatchQueryResult `Advisory` DOWN to the
 *       lean TargetQueryResult shape ({ outcome, advisories: [{ cveId,
 *       nativeAdvisoryId, severity, affectedCoordinate, ecosystem }] }) with the
 *       heavy `Advisory` fields DROPPED;
 *   (b) STRICTLY NON-BLOCKING -- when the source resolves UNAVAILABLE (OSV
 *       degraded) the route STILL returns HTTP 200 carrying
 *       `outcome: 'unavailable'` + the classified `unavailableReason`;
 *   (c) the raw `{ coordinate, version, ecosystem }` body is forwarded to
 *       `queryBatch` verbatim.
 *
 * The OSV source is injected via the route's DI seam (`setOsvBatchSourceFactory`)
 * as a real OsvDevVulnerabilitySource built with a STUB axios client -- mirroring
 * `services/__tests__/osvVulnerabilitySource.test.ts`. Nothing hits the network.
 */

// Mock dotenv so importing config does not read a real .env.
jest.mock('dotenv', () => ({ config: jest.fn() }));

import request from 'supertest';
import express from 'express';
import type { AxiosInstance } from 'axios';
import {
  vulnerabilityEnrichmentRouter,
  setOsvBatchSourceFactory,
  resetOsvBatchSourceFactory,
} from '../vulnerabilityEnrichment';
import { OsvDevVulnerabilitySource } from '../../services/vulnerabilityEnrichment/osvDevVulnerabilitySource';
import type { OsvHttpConfig } from '../../services/vulnerabilityEnrichment/osvHttpAgent';

// A direct-connection config fixture (no proxy / no CA) for the source under test.
const DIRECT_CONFIG: OsvHttpConfig = {
  baseUrl: 'https://api.osv.dev',
  timeoutMs: 15000,
  proxyUrl: '',
  noProxy: '',
  caCertFile: '',
};

/**
 * Build an axios stub whose `post(url, ...)` returns a per-url payload and whose
 * `get(url)` resolves the `vulns/{id}` hydration. `posts` records the bodies so a
 * test can assert the raw queries were forwarded verbatim.
 */
function stubClient(opts: {
  batch: unknown;
  hydrate?: Record<string, unknown>;
  posts?: unknown[];
}): AxiosInstance {
  const post = jest.fn((url: string, body: unknown) => {
    if (opts.posts) opts.posts.push({ url, body });
    if (url.includes('/v1/querybatch')) return Promise.resolve({ data: opts.batch });
    return Promise.resolve({ data: {} });
  });
  const get = jest.fn((url: string) => {
    const id = decodeURIComponent(url.split('/').pop() || '');
    const record = opts.hydrate?.[id];
    return Promise.resolve({ data: record ?? null });
  });
  return { post, get } as unknown as AxiosInstance;
}

/** An axios stub whose querybatch POST rejects (drives the UNAVAILABLE degrade). */
function failingClient(err: unknown): AxiosInstance {
  return {
    post: jest.fn().mockRejectedValue(err),
    get: jest.fn(),
  } as unknown as AxiosInstance;
}

describe('discovery raw-query OSV batch endpoint (Spec C, task 1.1)', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    // Mount at root so the router-internal /vulnerabilities/... path matches
    // directly (in index.ts the same router is mounted under /discovery).
    app.use('/', vulnerabilityEnrichmentRouter);
  });

  afterEach(() => {
    resetOsvBatchSourceFactory();
  });

  it('projects the rich BatchQueryResult down to the lean TargetQueryResult shape (heavy Advisory fields dropped) and returns 200', async () => {
    const osvRecord = {
      id: 'GHSA-jjjj-1234-aaaa',
      aliases: ['CVE-2024-9999'],
      summary: 'Remote code execution in widget-core',
      details: 'A crafted payload allows RCE.',
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
      database_specific: { cwe_ids: ['CWE-502'], severity: 'CRITICAL' },
      affected: [
        {
          package: { ecosystem: 'Maven', name: 'com.example:widget-core' },
          ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '1.0.0' }, { fixed: '1.4.2' }] }],
        },
      ],
    };
    // querybatch returns ids only; the source hydrates each via GET /v1/vulns/{id}.
    const client = stubClient({
      batch: { results: [{ vulns: [{ id: 'GHSA-jjjj-1234-aaaa' }] }] },
      hydrate: { 'GHSA-jjjj-1234-aaaa': osvRecord },
    });
    setOsvBatchSourceFactory(() => new OsvDevVulnerabilitySource(DIRECT_CONFIG, client));

    const res = await request(app)
      .post('/vulnerabilities/osv-query-batch')
      .send({ queries: [{ coordinate: 'com.example:widget-core', version: '1.2.0', ecosystem: 'Maven' }] });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('ok');
    expect(res.body.advisories).toHaveLength(1);
    const adv = res.body.advisories[0];
    // Lean projection: exactly these five keys, nothing else.
    expect(Object.keys(adv).sort()).toEqual(
      ['affectedCoordinate', 'cveId', 'ecosystem', 'nativeAdvisoryId', 'severity'].sort(),
    );
    expect(adv.cveId).toBe('CVE-2024-9999');
    expect(adv.nativeAdvisoryId).toBe('GHSA-jjjj-1234-aaaa');
    expect(adv.severity).toBe('critical');
    expect(adv.affectedCoordinate).toBe('com.example:widget-core');
    expect(adv.ecosystem).toBe('Maven');
    // Heavy Advisory fields are DROPPED.
    expect(adv).not.toHaveProperty('rawOsvRecord');
    expect(adv).not.toHaveProperty('details');
    expect(adv).not.toHaveProperty('title');
    expect(adv).not.toHaveProperty('fixedInVersions');
    expect(adv).not.toHaveProperty('cvss');
    // outcome=ok => no unavailableReason key.
    expect(res.body).not.toHaveProperty('unavailableReason');
  });

  it('forwards the raw { coordinate, version, ecosystem } queries verbatim to querybatch', async () => {
    const posts: unknown[] = [];
    const client = stubClient({ batch: { results: [{ vulns: [] }, { vulns: [] }] }, posts });
    setOsvBatchSourceFactory(() => new OsvDevVulnerabilitySource(DIRECT_CONFIG, client));

    await request(app)
      .post('/vulnerabilities/osv-query-batch')
      .send({
        queries: [
          { coordinate: 'org.springframework.boot:spring-boot', version: '3.2.0', ecosystem: 'Maven' },
          { coordinate: 'react', version: '18.2.0', ecosystem: 'npm' },
        ],
      });

    const batchPost = (posts as Array<{ url: string; body: { queries: unknown[] } }>).find((p) =>
      p.url.includes('/v1/querybatch'),
    );
    expect(batchPost).toBeDefined();
    expect(batchPost!.body.queries).toEqual([
      { version: '3.2.0', package: { name: 'org.springframework.boot:spring-boot', ecosystem: 'Maven' } },
      { version: '18.2.0', package: { name: 'react', ecosystem: 'npm' } },
    ]);
  });

  it('returns HTTP 200 with outcome=unavailable + classified reason when OSV degrades (timeout) -- never a 5xx', async () => {
    // Mirror an axios timeout error so classifyOsvFailure -> 'timeout'.
    const timeoutErr = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
    setOsvBatchSourceFactory(
      () => new OsvDevVulnerabilitySource(DIRECT_CONFIG, failingClient(timeoutErr)),
    );

    const res = await request(app)
      .post('/vulnerabilities/osv-query-batch')
      .send({ queries: [{ coordinate: 'left-pad', version: '1.3.0', ecosystem: 'npm' }] });

    // STRICTLY NON-BLOCKING: a degraded lookup is structured data, not an error.
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('unavailable');
    expect(res.body.unavailableReason).toBe('timeout');
    expect(res.body.advisories).toEqual([]);
  });

  it('returns HTTP 200 with outcome=ok + empty advisories for an empty query batch', async () => {
    // queryBatch short-circuits an empty batch to OK with no advisories; the
    // route must still answer 200 (no source / network involved).
    const client = stubClient({ batch: { results: [] } });
    setOsvBatchSourceFactory(() => new OsvDevVulnerabilitySource(DIRECT_CONFIG, client));

    const res = await request(app).post('/vulnerabilities/osv-query-batch').send({ queries: [] });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('ok');
    expect(res.body.advisories).toEqual([]);
  });
});
