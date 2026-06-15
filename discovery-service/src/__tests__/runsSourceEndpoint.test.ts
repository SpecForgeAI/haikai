/**
 * Tests for GET /discovery/projects/.../runs/:runId/source/...
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 *  -- Task Group 1.
 *
 * Covers the six required scenarios:
 *   1. Happy path (cached clone present + valid repo-relative path -> 200
 *      with file contents).
 *   2. Cache GC'd (clone dir missing -> 410 with structured error body).
 *   3. Path traversal `..` -> 400.
 *   4. Absolute path attempt -> 400.
 *   5. Non-existent file under valid clone -> 404.
 *   6. Run id not found in AMS -> 404.
 *
 * The clone dir is materialised as a real on-disk directory under
 * `os.tmpdir()/discovery-<runId>/<repoSlug>/` so the route's
 * `fs.stat` / `fs.realpath` calls exercise their genuine code paths.
 * `archModelClient` is mocked so no real HTTP traffic flows.
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../services/archModelClient', () => {
  const actual = jest.requireActual('../services/archModelClient');
  return {
    ...actual,
    archModelClient: {
      getDiscoveryRun: jest.fn(),
      getService: jest.fn(),
    },
  };
});

import express from 'express';
import supertest from 'supertest';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { archModelClient } from '../services/archModelClient';
import { repoSlug } from '../services/repoAccess';

const mockArchModelClient = archModelClient as unknown as {
  getDiscoveryRun: jest.Mock;
  getService: jest.Mock;
};

const PROJECT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ARCH_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const RUN_ID = 'cccccccc-0000-0000-0000-000000000003';
const REPO_URL = 'https://example.test/checkout.git';

/**
 * The clone directory the route resolves to for a `(runId, repoUrl)` tuple,
 * exactly as {@link buildTempDir} would compute it. Kept here so the tests
 * can both populate and tear it down explicitly.
 */
const CLONE_ROOT = path.join(
  os.tmpdir(),
  `discovery-${RUN_ID}`,
  repoSlug(REPO_URL),
);

function buildApp() {
  // Late-require so the mocked archModelClient is in place when the route
  // module loads.
  const { sourceRouter } = require('../routes/source');
  const app = express();
  app.use(express.json());
  app.use('/discovery/projects/:projectId/architectures/:architectureId/runs', sourceRouter);
  return app;
}

function makeRun(extra: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    service_id: null,
    mode: null,
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: {
      repos: [{ url: REPO_URL, branch: 'main' }],
    },
    steps_payload: {},
    error_message: null,
    created_at: '2026-05-17T10:00:00Z',
    updated_at: '2026-05-17T10:00:00Z',
    architecture_id: ARCH_ID,
    ...extra,
  };
}

async function setupCloneRoot(): Promise<void> {
  // A real on-disk clone is the easiest way to drive `fs.stat` / `fs.realpath`
  // through their genuine paths. The whole tree is torn down in afterEach.
  await fs.mkdir(path.join(CLONE_ROOT, 'src', 'main', 'java', 'com', 'foo'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(CLONE_ROOT, 'src', 'main', 'java', 'com', 'foo', 'Bar.java'),
    'package com.foo;\n\npublic class Bar { }\n',
    'utf-8',
  );
}

async function teardownCloneRoot(): Promise<void> {
  // Best-effort cleanup. The directory may already be absent (the GC-fallback
  // test deletes it before the request) -- that's fine, `recursive: true,
  // force: true` makes this a no-op.
  await fs
    .rm(path.join(os.tmpdir(), `discovery-${RUN_ID}`), {
      recursive: true,
      force: true,
    })
    .catch(() => {});
}

describe('GET /discovery/.../runs/:runId/source/* -- Task Group 1', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await teardownCloneRoot();
  });

  afterEach(async () => {
    await teardownCloneRoot();
  });

  test('Test 1 (happy path): returns 200 with file contents when clone present + path valid', async () => {
    await setupCloneRoot();
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(makeRun());

    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source/src/main/java/com/foo/Bar.java`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('package com.foo;');
    expect(res.text).toContain('public class Bar');

    // AMS call signature: projectId, runId, architectureId (this last
    // argument is the URL-derived value, NOT a fallback resolution).
    expect(mockArchModelClient.getDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      ARCH_ID,
    );
  });

  test('Test 2 (cache GC fallback): returns 410 with structured payload when clone directory is missing', async () => {
    // Deliberately do NOT call setupCloneRoot -- the directory is absent so
    // `fs.stat` will throw ENOENT and the route surfaces the 410.
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(makeRun());

    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source/src/main/java/com/foo/Bar.java`,
    );

    expect(res.status).toBe(410);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'clone_evicted',
        runId: RUN_ID,
        message: expect.stringContaining('evicted'),
      }),
    );
  });

  test('Test 3 (path traversal `..`): returns 400 with path_traversal_rejected and does NOT touch the filesystem', async () => {
    // Node's URL parser collapses literal `..` segments before Express
    // routes the request. To preserve the traversal segments and reach
    // the handler with `..` in `req.params[0]` we URL-encode the path
    // SEPARATORS as `%2F` -- the `..` tokens themselves stay literal,
    // and Express then decodes the whole captured tail to the verbatim
    // attack string `../../etc/passwd`. This is the actual attack shape
    // a malicious caller would send when the standard path-normalising
    // layer is unavailable.
    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source/..%2F..%2Fetc%2Fpasswd`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'path_traversal_rejected',
      }),
    );
    expect(mockArchModelClient.getDiscoveryRun).not.toHaveBeenCalled();
  });

  test('Test 4 (absolute path attempt): returns 400 path_traversal_rejected for absolute paths', async () => {
    // Encode the leading `/` so it survives URL normalisation and reaches
    // the route as a literal leading-slash absolute path. Both POSIX-style
    // (`/etc/...`) and Windows drive-letter shapes (`C:\...` / `C:/...`)
    // are rejected by isAbsolutePath; we cover the POSIX shape here.
    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source/%2Fetc%2Fpasswd`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'path_traversal_rejected',
      }),
    );
    expect(mockArchModelClient.getDiscoveryRun).not.toHaveBeenCalled();
  });

  test('Test 5 (non-existent file under valid clone): returns 404 file_not_found', async () => {
    await setupCloneRoot();
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(makeRun());

    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source/src/main/java/com/foo/Missing.java`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'file_not_found',
      }),
    );
  });

  test('Test 6 (run id not found in AMS): returns 404 run_not_found', async () => {
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(null);

    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source/src/main/java/com/foo/Bar.java`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'run_not_found',
      }),
    );
  });
});
