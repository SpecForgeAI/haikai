/**
 * Tests for the Implementation-Service project init + repo CRUD proxy routes
 * and the upgraded v2 jobs routes.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * Task Group 2: Gateway Integration Layer
 *
 * Covers the critical behaviours:
 * 1. POST /projects/init forwards {company, project, repos} upstream (never
 *    project_id) and persists init-success=true + mode + project_dir +
 *    per-repo rows to AMS.
 * 2. Init upstream 400 returns the upstream `detail` AND persists
 *    init-success=false -- project creation is never thrown away.
 * 3. Gateway-side folder/URL validation rejects bad maps without any
 *    upstream call.
 * 4. POST /v2/jobs/orchestrations enforces single-spec (400 for >1 and for
 *    empty).
 * 5. GET /v2/jobs/:job_id passes the full JobDetailResponse through
 *    (progress / result / logs_url / started_at / completed_at).
 * 6. GET repos proxies RepoMapResponse, computes the drift `changed` flag,
 *    and syncs the upstream map into AMS (external-wins, workspace_dir/mode
 *    preserved for unchanged folder+URL pairs).
 *
 * No live LLM calls (LLM guard) -- the upstream client and the AMS client
 * are both mocked.
 */

import request from 'supertest';
import express from 'express';

// Mock logger to avoid console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the upstream client -- ALL external calls go through request()
const mockUpstreamRequest = jest.fn();
jest.mock('../services/implementationLlmProxyClient', () => ({
  request: (...args: unknown[]) => mockUpstreamRequest(...args),
}));

// Mock the AMS client persistence helpers (project convention: spread the
// actual module via the shared testSetup helper so unmocked exports work)
const mockUpdateInit = jest.fn();
const mockReplaceRepos = jest.fn();
const mockFetchRepos = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    updateProjectImplementationInit: (...args: unknown[]) => mockUpdateInit(...args),
    replaceProjectImplementationRepos: (...args: unknown[]) => mockReplaceRepos(...args),
    fetchProjectImplementationRepos: (...args: unknown[]) => mockFetchRepos(...args),
  });
});

// Mock config (base URLs + server-side token presence)
jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    implementationLlmServiceBaseUrl: 'http://localhost:8000',
    implementationLlmServiceBearerToken: 'test-server-token',
  })),
}));

import { implementationProjectsRouter } from '../routes/implementationProjects';
import { orchestrationsRouter } from '../routes/orchestrations';

const PROJECT_ID = '6f0a2f6e-1234-4abc-9def-000000000001';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('Implementation-Service init + repo CRUD routes (Spec 2026-06-12)', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/implementation', implementationProjectsRouter);
    app.use('/api', orchestrationsRouter);

    // Default: AMS persistence succeeds
    mockUpdateInit.mockResolvedValue(true);
    mockReplaceRepos.mockResolvedValue(true);
    mockFetchRepos.mockResolvedValue([]);
  });

  describe('POST /api/implementation/projects/init', () => {
    const validInit = {
      company: 'acme',
      project: 'billing-system',
      project_id: PROJECT_ID,
      git_provider: 'github',
      repos: {
        backend: 'https://github.com/acme/backend.git',
        frontend: 'https://github.com/acme/frontend.git',
      },
    };

    it('forwards {company, project, repos} upstream and persists the success outcome to AMS', async () => {
      mockUpstreamRequest.mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          message: 'Initialized 2 repos',
          project_dir: '/workspace/acme/billing-system',
          mode: 'polyrepo',
          repos: [
            { folder: 'backend', dir: '/workspace/acme/billing-system/backend', mode: 'brownfield' },
            { folder: 'frontend', dir: '/workspace/acme/billing-system/frontend', mode: 'greenfield' },
          ],
        })
      );

      const response = await request(app)
        .post('/api/implementation/projects/init')
        .send(validInit);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('polyrepo');
      expect(response.body.project_dir).toBe('/workspace/acme/billing-system');
      expect(response.body.persisted).toBe(true);

      // Upstream payload: repos map form, NO project_id leakage
      const [path, options] = mockUpstreamRequest.mock.calls[0];
      expect(path).toBe('/projects/init');
      expect(options.method).toBe('POST');
      expect(options.body).toEqual({
        company: 'acme',
        project: 'billing-system',
        repos: validInit.repos,
        git_provider: 'github',
      });

      // AMS persistence: init-success=true + overall mode + project_dir
      expect(mockUpdateInit).toHaveBeenCalledWith(PROJECT_ID, {
        initSuccess: true,
        mode: 'polyrepo',
        projectDir: '/workspace/acme/billing-system',
      });

      // AMS persistence: per-repo rows merge request URL + upstream dir/mode
      expect(mockReplaceRepos).toHaveBeenCalledWith(PROJECT_ID, [
        {
          folder: 'backend',
          gitUrl: 'https://github.com/acme/backend.git',
          workspaceDir: '/workspace/acme/billing-system/backend',
          mode: 'brownfield',
        },
        {
          folder: 'frontend',
          gitUrl: 'https://github.com/acme/frontend.git',
          workspaceDir: '/workspace/acme/billing-system/frontend',
          mode: 'greenfield',
        },
      ]);
    });

    it('returns the upstream detail on init 400 AND persists init-success=false (project never thrown away)', async () => {
      mockUpstreamRequest.mockResolvedValueOnce(
        jsonResponse(400, {
          detail: "Clone failed for 'frontend': repository not found (all repos rolled back)",
        })
      );

      const response = await request(app)
        .post('/api/implementation/projects/init')
        .send(validInit);

      // Non-5xx, well-shaped error payload with the upstream detail inline
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.detail).toBe(
        "Clone failed for 'frontend': repository not found (all repos rolled back)"
      );

      // The failed init is RECORDED -- init-success=false (and only that:
      // mode/project_dir are not wiped thanks to AMS null-guards)
      expect(mockUpdateInit).toHaveBeenCalledWith(PROJECT_ID, { initSuccess: false });
      expect(mockReplaceRepos).not.toHaveBeenCalled();
    });

    it('rejects invalid folder names and duplicate URLs gateway-side without calling upstream', async () => {
      const badFolder = await request(app)
        .post('/api/implementation/projects/init')
        .send({ ...validInit, repos: { 'Bad Folder!': 'https://github.com/acme/x.git' } });
      expect(badFolder.status).toBe(400);
      expect(badFolder.body.detail).toContain('Invalid folder name');

      const dupUrl = await request(app)
        .post('/api/implementation/projects/init')
        .send({
          ...validInit,
          repos: {
            one: 'https://github.com/acme/same.git',
            two: 'https://github.com/acme/same.git',
          },
        });
      expect(dupUrl.status).toBe(400);
      expect(dupUrl.body.detail).toContain('Duplicate repo URL');

      expect(mockUpstreamRequest).not.toHaveBeenCalled();
      expect(mockUpdateInit).not.toHaveBeenCalled();
    });

    it('rejects a missing or invalid git_provider gateway-side without calling upstream', async () => {
      const { git_provider: _omit, ...withoutProvider } = validInit;
      const missing = await request(app)
        .post('/api/implementation/projects/init')
        .send(withoutProvider);
      expect(missing.status).toBe(400);
      expect(missing.body.detail).toContain('git_provider');

      const invalid = await request(app)
        .post('/api/implementation/projects/init')
        .send({ ...validInit, git_provider: 'sourcehut' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.detail).toContain('git_provider');

      expect(mockUpstreamRequest).not.toHaveBeenCalled();
      expect(mockUpdateInit).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/implementation/projects/:company/:project/repos (drift sync)', () => {
    it('proxies the RepoMapResponse, reports drift via `changed`, and syncs AMS external-wins', async () => {
      // AMS-stored map: backend (with workspace data) + a stale "legacy" folder
      mockFetchRepos.mockResolvedValueOnce([
        {
          folder: 'backend',
          gitUrl: 'https://github.com/acme/backend.git',
          workspaceDir: '/ws/acme/billing/backend',
          mode: 'brownfield',
        },
        {
          folder: 'legacy',
          gitUrl: 'https://github.com/acme/legacy.git',
          workspaceDir: null,
          mode: null,
        },
      ]);
      // Upstream truth: backend unchanged, legacy gone, docs added
      mockUpstreamRequest.mockResolvedValueOnce(
        jsonResponse(200, {
          company: 'acme',
          project: 'billing-system',
          repos: {
            backend: 'https://github.com/acme/backend.git',
            docs: 'https://github.com/acme/docs.git',
          },
        })
      );

      const response = await request(app)
        .get('/api/implementation/projects/acme/billing-system/repos')
        .query({ project_id: PROJECT_ID });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        company: 'acme',
        project: 'billing-system',
        repos: {
          backend: 'https://github.com/acme/backend.git',
          docs: 'https://github.com/acme/docs.git',
        },
        changed: true,
        synced: true,
      });

      const [path, options] = mockUpstreamRequest.mock.calls[0];
      expect(path).toBe('/projects/acme/billing-system/repos');
      expect(options.method).toBe('GET');

      // External-wins full-map replace: workspace data preserved for the
      // unchanged folder+URL pair, nulls for the new folder, stale row gone.
      expect(mockReplaceRepos).toHaveBeenCalledWith(PROJECT_ID, [
        {
          folder: 'backend',
          gitUrl: 'https://github.com/acme/backend.git',
          workspaceDir: '/ws/acme/billing/backend',
          mode: 'brownfield',
        },
        {
          folder: 'docs',
          gitUrl: 'https://github.com/acme/docs.git',
          workspaceDir: null,
          mode: null,
        },
      ]);
    });
  });

  describe('repo CRUD mutation proxies (Task Group 6 gap analysis)', () => {
    it('POST add: mirrors stored-map uniqueness (400, no upstream call), then proxies AddRepoRequest and syncs the returned map into AMS', async () => {
      const storedBackend = {
        folder: 'backend',
        gitUrl: 'https://github.com/acme/backend.git',
        workspaceDir: '/ws/acme/billing/backend',
        mode: 'brownfield',
      };
      mockFetchRepos.mockResolvedValue([storedBackend]);

      // Duplicate folder against the stored map -> 400 mirror, upstream untouched.
      const dup = await request(app)
        .post('/api/implementation/projects/acme/billing-system/repos')
        .send({
          project_id: PROJECT_ID,
          folder: 'backend',
          url: 'https://github.com/acme/other.git',
        });
      expect(dup.status).toBe(400);
      expect(dup.body.error.message).toContain('already exists');
      expect(mockUpstreamRequest).not.toHaveBeenCalled();
      expect(mockReplaceRepos).not.toHaveBeenCalled();

      // Valid add -> upstream AddRepoRequest {folder, url}, RepoMapResponse
      // returned with changed:true and the full map synced into AMS
      // (workspace data preserved for the unchanged backend pair).
      mockUpstreamRequest.mockResolvedValueOnce(
        jsonResponse(200, {
          company: 'acme',
          project: 'billing-system',
          repos: {
            backend: 'https://github.com/acme/backend.git',
            docs: 'https://github.com/acme/docs.git',
          },
        })
      );
      const added = await request(app)
        .post('/api/implementation/projects/acme/billing-system/repos')
        .send({
          project_id: PROJECT_ID,
          folder: 'docs',
          url: 'https://github.com/acme/docs.git',
        });

      expect(added.status).toBe(200);
      expect(added.body.changed).toBe(true);
      expect(added.body.synced).toBe(true);
      expect(added.body.repos.docs).toBe('https://github.com/acme/docs.git');

      const [path, options] = mockUpstreamRequest.mock.calls[0];
      expect(path).toBe('/projects/acme/billing-system/repos');
      expect(options.method).toBe('POST');
      expect(options.body).toEqual({
        folder: 'docs',
        url: 'https://github.com/acme/docs.git',
      });

      expect(mockReplaceRepos).toHaveBeenCalledWith(PROJECT_ID, [
        storedBackend,
        {
          folder: 'docs',
          gitUrl: 'https://github.com/acme/docs.git',
          workspaceDir: null,
          mode: null,
        },
      ]);
    });

    it('PUT re-point: forwards UpdateRepoRequest, and an upstream 400 detail passes through verbatim WITHOUT syncing AMS', async () => {
      mockFetchRepos.mockResolvedValue([
        {
          folder: 'backend',
          gitUrl: 'https://github.com/acme/backend.git',
          workspaceDir: '/ws/acme/billing/backend',
          mode: 'brownfield',
        },
      ]);
      // Upstream re-clone failed (e.g. new URL unreachable) -> 400 detail.
      mockUpstreamRequest.mockResolvedValueOnce(
        jsonResponse(400, {
          detail: "Clone failed for 'backend': repository not found",
        })
      );

      const response = await request(app)
        .put('/api/implementation/projects/acme/billing-system/repos/backend')
        .send({ project_id: PROJECT_ID, url: 'https://github.com/acme/backend-moved.git' });

      // Upstream error body forwarded transparently for inline display.
      expect(response.status).toBe(400);
      expect(response.body.detail).toBe("Clone failed for 'backend': repository not found");

      const [path, options] = mockUpstreamRequest.mock.calls[0];
      expect(path).toBe('/projects/acme/billing-system/repos/backend');
      expect(options.method).toBe('PUT');
      expect(options.body).toEqual({ url: 'https://github.com/acme/backend-moved.git' });

      // External-wins means we ONLY sync what upstream confirms -- a failed
      // mutation must not touch the stored map.
      expect(mockReplaceRepos).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v2/jobs/orchestrations single-spec enforcement', () => {
    const baseJob = {
      company: 'acme',
      project: 'billing-system',
    };

    it('rejects spec_intents.length > 1 with a clear 400 and still rejects empty', async () => {
      const multi = await request(app)
        .post('/api/v2/jobs/orchestrations')
        .send({
          ...baseJob,
          spec_intents: [
            { spec_name: '2026-06-12-spec-one' },
            { spec_name: '2026-06-12-spec-two' },
          ],
        });
      expect(multi.status).toBe(400);
      expect(multi.body.error.message).toContain('exactly one');
      expect(mockUpstreamRequest).not.toHaveBeenCalled();

      const empty = await request(app)
        .post('/api/v2/jobs/orchestrations')
        .send({ ...baseJob, spec_intents: [] });
      expect(empty.status).toBe(400);
      expect(empty.body.error.message).toContain('at least one');
      expect(mockUpstreamRequest).not.toHaveBeenCalled();

      // Exactly one is accepted and proxied (SpecIntent object shape kept,
      // empty session_id stripped)
      mockUpstreamRequest.mockResolvedValueOnce(
        jsonResponse(200, { job_id: 'job-1', status: 'queued' })
      );
      const single = await request(app)
        .post('/api/v2/jobs/orchestrations')
        .send({
          ...baseJob,
          spec_intents: [{ spec_name: '2026-06-12-spec-one', session_id: '' }],
        });
      expect(single.status).toBe(200);
      expect(single.body.job_id).toBe('job-1');
      const [, options] = mockUpstreamRequest.mock.calls[0];
      expect(options.body.spec_intents).toEqual([{ spec_name: '2026-06-12-spec-one' }]);
    });
  });

  describe('GET /api/v2/jobs/:job_id full JobDetailResponse pass-through', () => {
    it('forwards status, progress, result, logs_url, started_at and completed_at untouched', async () => {
      const jobDetail = {
        job_id: 'job-9',
        type: 'orchestration',
        status: 'completed',
        company: 'acme',
        project: 'billing-system',
        created_at: '2026-06-12T10:00:00Z',
        started_at: '2026-06-12T10:00:05Z',
        completed_at: '2026-06-12T10:12:30Z',
        progress: {
          current_step: 7,
          total_steps: 7,
          step_description: 'Pushing feature branch',
          percentage: 100,
        },
        result: {
          branch: 'feature/2026-06-12-spec-one',
          pr_url: 'https://github.com/acme/backend/pull/55',
          some_undocumented_key: { nested: true },
        },
        error: null,
        logs_url: 'https://jobs.example.com/jobs/job-9/logs',
      };
      mockUpstreamRequest.mockResolvedValueOnce(jsonResponse(200, jobDetail));

      const response = await request(app).get('/api/v2/jobs/job-9');

      expect(response.status).toBe(200);
      // The ENTIRE JobDetailResponse passes through verbatim -- including the
      // untyped result object and the undocumented keys inside it.
      expect(response.body).toEqual(jobDetail);

      const [path] = mockUpstreamRequest.mock.calls[0];
      expect(path).toBe('/api/v2/jobs/job-9');
    });
  });
});
