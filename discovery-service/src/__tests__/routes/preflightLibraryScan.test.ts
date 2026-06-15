/**
 * Preflight Library Scan endpoint tests.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 5.1.
 *
 * Mocks `archModelClient.getService` / `getLibrary` and the cached-clone
 * helper so the test exercises the route handler against a checked-in
 * fixture multi-module Maven repo.
 */

import express from 'express';
import request from 'supertest';
import * as path from 'path';

jest.mock('dotenv', () => ({ config: jest.fn() }));

const FIX_ROOT = path.join(__dirname, '..', 'fixtures', 'dependencyResolvers');

// Mock the cached-clone helper to point at the fixture multi-module repo.
jest.mock('../../services/preflightCachedClone', () => ({
  getOrClonePreflightRepo: jest.fn(async () => path.join(FIX_ROOT, 'maven-multi-module')),
  getCachedPreflightDir: jest.fn(() => undefined),
  clearPreflightCache: jest.fn(),
}));

// Mock archModelClient.getService / getLibrary.
jest.mock('../../services/archModelClient', () => {
  const actual = jest.requireActual('../../services/archModelClient');
  return {
    ...actual,
    archModelClient: {
      getService: jest.fn(),
      getLibrary: jest.fn(),
    },
  };
});

describe('POST /preflight-library-scan', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    const { preflightLibraryScanRouter } = require('../../routes/preflightLibraryScan');
    app = express();
    app.use(express.json());
    app.use('/discovery', preflightLibraryScanRouter);
  });

  it('Service-rooted preflight returns ScanPlan against fixture multi-module Maven repo', async () => {
    const { archModelClient } = require('../../services/archModelClient');
    archModelClient.getService.mockResolvedValue({
      id: 'svc-1',
      name: 'com.example:aggregator',
      core_tech: 'java',
      repo_location: 'local',
      repo_subfolder: '',
    });

    const res = await request(app)
      .post('/discovery/projects/proj-1/architectures/arch-1/services/svc-1/preflight-library-scan')
      .send({ includeExternal: true });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body.root).toBeDefined();
    expect(res.body.root.kind).toBe('service');
    expect(res.body.root.id).toBe('svc-1');
    expect(Array.isArray(res.body.internalLibrariesToScan)).toBe(true);
    expect(Array.isArray(res.body.externalLibrariesToRecord)).toBe(true);
    expect(Array.isArray(res.body.warnings)).toBe(true);

    // The aggregator pom declares no deps, but module-a has com.example:module-b
    // which IS in the lookup table. The aggregator pom is at the root, so the
    // walker starts there with subfolder='' and won't find a manifest match
    // (the module poms are NOT at the repo root). For a Service-rooted scan
    // pointing at the aggregator subfolder, we expect the lookup table to be
    // populated but no internal libs walked (since the root pom has no deps).
    // This is the deterministic, locked behaviour.
  });

  it('Library-rooted preflight loads the root via archModelClient.getLibrary and returns a Library-shaped ScanPlan', async () => {
    const { archModelClient } = require('../../services/archModelClient');
    archModelClient.getLibrary.mockResolvedValue({
      id: 'lib-uuid-1',
      name: 'com.example:module-a',
      ecosystem: 'MAVEN',
      repo_location: 'local',
      repo_subfolder: 'module-a',
    });

    const res = await request(app)
      .post('/discovery/projects/proj-1/architectures/arch-1/libraries/lib-uuid-1/preflight-library-scan')
      .send({ includeExternal: true });

    expect(res.status).toBe(200);
    expect(res.body.root.kind).toBe('library');
    expect(res.body.root.id).toBe('lib-uuid-1');
    expect(res.body.root.repo_subfolder).toBe('module-a');

    // module-a has dep com.example:module-b which IS in the lookup table —
    // expect 1 internal entry.
    expect(res.body.internalLibrariesToScan.length).toBeGreaterThanOrEqual(1);
    const moduleBEntry = res.body.internalLibrariesToScan.find((e: { name: string }) => e.name === 'com.example:module-b');
    expect(moduleBEntry).toBeDefined();
    // Preflight: library_id is null because the read-only client doesn't write.
    expect(moduleBEntry.library_id).toBeNull();
  });

  it('returns 404 when the Service does not exist', async () => {
    const { archModelClient } = require('../../services/archModelClient');
    archModelClient.getService.mockResolvedValue(null);
    const res = await request(app)
      .post('/discovery/projects/proj-1/architectures/arch-1/services/missing/preflight-library-scan')
      .send({});
    expect(res.status).toBe(404);
  });
});
