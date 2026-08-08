/**
 * Tests for GET /discovery/projects/.../runs/:runId/source-index
 * (2026-08-08 Retry-uncovered budget/context fix — the file-path search
 * companion to the /source/* fetch, consumed by AMVS's
 * `search_source_files` LLM tool).
 *
 * Mirrors runsSourceEndpoint.test.ts's harness: a real on-disk clone drives
 * the genuine fs walk; archModelClient is mocked.
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

const PROJECT_ID = 'aaaaaaaa-0000-0000-0000-000000000011';
const ARCH_ID = 'bbbbbbbb-0000-0000-0000-000000000012';
const RUN_ID = 'cccccccc-0000-0000-0000-000000000013';
const REPO_URL = 'https://example.test/checkout.git';

const CLONE_ROOT = path.join(
  os.tmpdir(),
  `discovery-${RUN_ID}`,
  repoSlug(REPO_URL),
);

function buildApp() {
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
    created_at: '2026-08-08T10:00:00Z',
    updated_at: '2026-08-08T10:00:00Z',
    architecture_id: ARCH_ID,
    ...extra,
  };
}

async function setupCloneRoot(): Promise<void> {
  const javaDir = path.join(CLONE_ROOT, 'src', 'main', 'java', 'com', 'foo');
  await fs.mkdir(javaDir, { recursive: true });
  await fs.writeFile(
    path.join(javaDir, 'OrderController.java'),
    'public class OrderController { }\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(javaDir, 'OrderValidator.java'),
    'public class OrderValidator { }\n',
    'utf-8',
  );
  // Binary-ish extension: must never be surfaced.
  await fs.writeFile(path.join(javaDir, 'orders.jar'), 'not-really-a-jar', 'utf-8');
  // Skip-dir content: a path match inside .git must never be surfaced.
  const gitDir = path.join(CLONE_ROOT, '.git', 'objects');
  await fs.mkdir(gitDir, { recursive: true });
  await fs.writeFile(path.join(gitDir, 'OrderController.java'), 'x', 'utf-8');
}

async function teardownCloneRoot(): Promise<void> {
  await fs
    .rm(path.join(os.tmpdir(), `discovery-${RUN_ID}`), { recursive: true, force: true })
    .catch(() => {});
}

describe('GET /discovery/.../runs/:runId/source-index', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await teardownCloneRoot();
  });

  afterEach(async () => {
    await teardownCloneRoot();
  });

  test('finds repo-relative paths by case-insensitive substring; skips VCS dirs and non-source extensions', async () => {
    await setupCloneRoot();
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(makeRun());

    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source-index?q=ordercontroller`,
    );

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual(['src/main/java/com/foo/OrderController.java']);
    expect(res.body.truncated).toBe(false);
  });

  test('respects the limit and reports truncation', async () => {
    await setupCloneRoot();
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(makeRun());

    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source-index?q=order&limit=1`,
    );

    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.truncated).toBe(true);
  });

  test('rejects a sub-2-character query with 400', async () => {
    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source-index?q=x`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_query');
  });

  test('returns 410 clone_evicted when the clone is off-disk (never auto-reclones)', async () => {
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(makeRun());
    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source-index?q=order`,
    );
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('clone_evicted');
  });

  test('returns 404 when the run is unknown', async () => {
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(null);
    const app = buildApp();
    const res = await supertest(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/source-index?q=order`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('run_not_found');
  });
});
