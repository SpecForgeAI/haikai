/**
 * Implementation-Service Project routes for the Gateway API
 *
 * Proxies the external implementation/verification service's workspace
 * registration (POST /projects/init) and polyrepo CRUD endpoints
 * (GET/POST /projects/{company}/{project}/repos,
 * PUT/DELETE /projects/{company}/{project}/repos/{folder}), and persists the
 * outcome into AMS (project init-status fields + the
 * project_implementation_repos map).
 *
 * Key behaviours:
 * - ALL upstream calls go through implementationLlmProxyClient (server-side
 *   Bearer auth -- never browser auth), mirroring routes/orchestrations.ts.
 * - Init NEVER fails project creation: the Haikai project is created by the
 *   frontend BEFORE calling init; on upstream failure this route persists
 *   init-success=false and returns the upstream `detail` with a non-5xx
 *   status so the Create/Edit-project modal can surface it inline.
 * - Drift auto-sync (external-wins): on every successful repo read/mutation
 *   the upstream-reported map is synced into AMS wholesale, and the response
 *   carries a `changed` flag so the frontend can show the
 *   "repo map updated from workspace" notice. The gateway NEVER pushes the
 *   AMS-stored map upstream.
 * - Error conventions follow routes/orchestrations.ts: opaque 502 on
 *   upstream 401/403, 503 on network errors/timeouts, generic 500 when the
 *   Bearer token is not configured.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 2
 *
 * Spec 2026-06-14: Migrate Button + Migration Execution Driver (Spec 3 of 4) --
 * Task Group 3. ADDS the single inbound build-results door
 * (POST /api/implementation/build-results) the external implementation/
 * verification service calls after every unit of work. The door is
 * snake_case + camelCase-tolerant, has a NEW inbound service-token check (the
 * routes above are outbound-auth ONLY), and dispatches the `job_id` paths into
 * the Migration Execution Driver advance. The `bug_id` paths remain a clean
 * seam for Spec 4.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../services';
import { request } from '../services/implementationLlmProxyClient';
import {
  ImplementationRepo,
  fetchProjectImplementationRepos,
  replaceProjectImplementationRepos,
  updateProjectImplementationInit,
} from '../services/architectureModelClient';
import {
  processBuildResult,
  checkInboundServiceToken,
  BuildResultCallbackBody,
} from '../services/buildResultsReceiver';
import {
  defaultMigrationDriverDeps,
  MigrationDriverDeps,
} from '../services/migrationExecutionDriver';
import { buildResultsCallbackUrl } from './migrationExecution';

/** User-Agent header value for proxy requests (matches orchestrations.ts). */
const RIVVY_USER_AGENT = 'Rivvy-Portal-UI';

/** Timeout for repo CRUD proxy requests in milliseconds (60 seconds). */
const PROXY_TIMEOUT_MS = 60000;

/**
 * Timeout for POST /projects/init in milliseconds (5 minutes) -- the upstream
 * clones every repo in the map before responding (all-or-nothing rollback).
 */
const INIT_TIMEOUT_MS = 300000;

/**
 * Folder-name rule for repo-map folders, mirroring the client-side rule:
 * lowercase alphanumeric start, then lowercase alphanumerics / dot /
 * underscore-free slug charset (dot, hyphen, underscore-like chars allowed
 * per the agreed rule `^[a-z0-9][a-z0-9._-]*$`).
 */
export const FOLDER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

// ============================================================================
// Types (wire shapes -- snake_case, matching the external openapi.json)
// ============================================================================

/**
 * Request body for POST /projects/init (gateway shape).
 *
 * `repos` is ALWAYS the map form (folder -> git URL) for BOTH single and poly
 * modes (per contract exactly one of `repos`/`repo_url` may be set upstream;
 * the gateway always sends `repos`). `project_id` is the Haikai project UUID
 * used to persist the init outcome into AMS -- it is NOT forwarded upstream.
 */
export interface InitProjectRequest {
  /** Normalised organisation name (company identifier upstream). */
  company: string;
  /** Normalised product name (project identifier upstream). */
  project: string;
  /** Haikai project UUID (AMS persistence target; not sent upstream). */
  project_id: string;
  /** Folder -> git remote URL map. Folders AND URLs must be unique. */
  repos: Record<string, string>;
  /**
   * Workspace-wide git provider, forwarded upstream so the IV service picks
   * the matching auth strategy/token. One of the GIT_PROVIDERS values.
   */
  git_provider: string;
}

/** The three providers the upstream IV service `/projects/init` accepts. */
export const GIT_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;

/** Per-repo outcome of init (upstream RepoInitResult). */
export interface RepoInitResult {
  folder: string;
  dir: string;
  mode: string;
}

/** Upstream ProjectInitResponse shape. */
export interface ProjectInitResponse {
  success: boolean;
  message: string;
  project_dir: string;
  /** 'brownfield' | 'greenfield' (one-entry init) | 'polyrepo' (N-entry init). */
  mode: string;
  repos?: RepoInitResult[];
}

/** Upstream RepoMapResponse shape -- returned by every repo CRUD endpoint. */
export interface RepoMapResponse {
  company: string;
  project: string;
  repos: Record<string, string>;
}

/**
 * Gateway response for the repo CRUD routes: the upstream RepoMapResponse
 * plus the drift-sync metadata.
 */
export interface RepoMapGatewayResponse extends RepoMapResponse {
  /**
   * True when the upstream-reported map differed from the AMS-stored map
   * BEFORE this sync (drift, or the effect of the mutation itself) -- the
   * frontend shows the "repo map updated from workspace" notice on GET drift.
   */
  changed: boolean;
  /** True when the AMS-stored map was successfully synced from upstream. */
  synced: boolean;
}

// ============================================================================
// Validation helpers
// ============================================================================

/**
 * Validates a repos map (folder -> URL): non-empty, folder slug rule, and
 * uniqueness of BOTH folders (inherent in object keys, but blank/invalid
 * checked) and URLs. Returns an error message or null.
 */
export function validateReposMap(repos: unknown): string | null {
  if (!repos || typeof repos !== 'object' || Array.isArray(repos)) {
    return 'repos must be an object mapping folder names to git URLs';
  }
  const entries = Object.entries(repos as Record<string, unknown>);
  if (entries.length < 1) {
    return 'repos must contain at least one folder -> URL entry';
  }
  const seenUrls = new Set<string>();
  for (const [folder, url] of entries) {
    if (!FOLDER_NAME_PATTERN.test(folder)) {
      return `Invalid folder name "${folder}": must match ^[a-z0-9][a-z0-9._-]*$`;
    }
    if (typeof url !== 'string' || url.trim() === '') {
      return `Repo URL for folder "${folder}" must be a non-empty string`;
    }
    const normalizedUrl = url.trim();
    if (seenUrls.has(normalizedUrl)) {
      return `Duplicate repo URL in map: ${normalizedUrl}`;
    }
    seenUrls.add(normalizedUrl);
  }
  return null;
}

function validateInitRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }
  const req = body as Partial<InitProjectRequest>;
  if (!req.company || typeof req.company !== 'string' || req.company.trim() === '') {
    return 'company is required';
  }
  if (!req.project || typeof req.project !== 'string' || req.project.trim() === '') {
    return 'project is required';
  }
  if (!req.project_id || typeof req.project_id !== 'string' || req.project_id.trim() === '') {
    return 'project_id is required';
  }
  if (
    !req.git_provider ||
    typeof req.git_provider !== 'string' ||
    !GIT_PROVIDERS.includes(req.git_provider.trim().toLowerCase() as (typeof GIT_PROVIDERS)[number])
  ) {
    return `git_provider is required and must be one of: ${GIT_PROVIDERS.join(', ')}`;
  }
  return validateReposMap(req.repos);
}

/**
 * Extracts a human-readable `detail` from an upstream error body. FastAPI
 * emits `{detail: string}` for 400s and `{detail: [...]}` for 422 validation
 * errors -- tolerate any shape.
 */
export function extractUpstreamDetail(body: unknown): string {
  if (body && typeof body === 'object') {
    const detail = (body as Record<string, unknown>).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (detail !== undefined) {
      try {
        return JSON.stringify(detail);
      } catch {
        /* fall through */
      }
    }
    try {
      return JSON.stringify(body);
    } catch {
      /* fall through */
    }
  }
  if (typeof body === 'string' && body.trim() !== '') {
    return body;
  }
  return 'Implementation service request failed';
}

/** True when two folder->URL maps differ in keys or values. */
export function repoMapsDiffer(
  stored: ImplementationRepo[],
  upstream: Record<string, string>
): boolean {
  const storedMap = new Map(stored.map((r) => [r.folder, r.gitUrl]));
  const upstreamEntries = Object.entries(upstream);
  if (storedMap.size !== upstreamEntries.length) {
    return true;
  }
  return upstreamEntries.some(([folder, url]) => storedMap.get(folder) !== url);
}

/**
 * Builds the AMS replacement rows from the upstream-reported map, preserving
 * workspace_dir/mode for folders whose URL did not change (the external
 * service's RepoMapResponse carries only folder -> URL).
 */
export function buildSyncRows(
  stored: ImplementationRepo[] | null,
  upstream: Record<string, string>
): ImplementationRepo[] {
  const storedByFolder = new Map((stored ?? []).map((r) => [r.folder, r]));
  return Object.entries(upstream).map(([folder, url]) => {
    const existing = storedByFolder.get(folder);
    const sameUrl = existing !== undefined && existing.gitUrl === url;
    return {
      folder,
      gitUrl: url,
      workspaceDir: sameUrl ? existing.workspaceDir : null,
      mode: sameUrl ? existing.mode : null,
    };
  });
}

// ============================================================================
// Upstream call helper (shared error conventions from orchestrations.ts)
// ============================================================================

interface UpstreamResult {
  /** Set when the route should respond immediately with this status/body. */
  earlyResponse?: { status: number; body: unknown };
  /** Set on success or forwardable upstream error. */
  status?: number;
  ok?: boolean;
  body?: unknown;
}

async function callUpstream(
  requestId: string,
  label: string,
  path: string,
  options: { method: string; body?: unknown; timeoutMs: number }
): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': RIVVY_USER_AGENT,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await request(path, {
      method: options.method,
      headers,
      body: options.body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Opaque 502 for upstream auth failures -- never expose auth details.
    if (response.status === 401 || response.status === 403) {
      logger.error(`Upstream authentication failed for ${label}`, {
        requestId,
        path,
        status: response.status,
      });
      return { earlyResponse: { status: 502, body: { error: 'Upstream authentication failed' } } };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
    }

    return { status: response.status, ok: response.ok, body };
  } catch (fetchError) {
    clearTimeout(timeoutId);

    const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
    if (errorMessage.includes('Implementation LLM Service Bearer token is not configured')) {
      logger.error(`${label} failed: token not configured`, { requestId, path });
      // Generic 500 -- do NOT expose token absence to the frontend.
      return { earlyResponse: { status: 500, body: { error: 'Internal server error' } } };
    }

    if (fetchError instanceof Error && fetchError.name === 'AbortError') {
      logger.error(`${label} request timed out`, {
        requestId,
        path,
        timeoutMs: options.timeoutMs,
      });
    } else {
      logger.error(`${label} request failed`, { requestId, path, error: errorMessage });
    }
    return {
      earlyResponse: {
        status: 503,
        body: {
          success: false,
          error: { code: 503, message: 'Implementation service unavailable' },
        },
      },
    };
  }
}

// ============================================================================
// Router
// ============================================================================

export const implementationProjectsRouter = Router();

/**
 * Lazily-built Driver deps for the inbound build-results door. Resolving the
 * callback URL at call time keeps config mockable per-test; the no-op
 * auto-answerer default is fine here because the door only ADVANCES run-state
 * (it never drives a shape-spec stream itself -- the per-spec runner does, and
 * the advance re-kicks the next runner through the same default).
 */
function buildResultsDeps(): MigrationDriverDeps {
  return defaultMigrationDriverDeps(buildResultsCallbackUrl());
}

/**
 * POST /build-results -- the single inbound door the external implementation/
 * verification service calls after every unit of work. Resolves to
 * /api/implementation/build-results.
 *
 * NEW inbound service-token check (the other /api/implementation routes are
 * outbound-auth only): a bad/missing token is a 401. Contract validation maps
 * to 422 (neither id / both ids / bad outcome / deployed without
 * target_base_url) and 404 (unknown job_id). On a valid job_id callback the
 * Driver advance is invoked (Group 2): implemented -> advance + dispatch next;
 * failed/rejected -> halt + record; deployed -> mark run deployed + record
 * target_base_url (clean Spec-4 reconcile seam). Idempotent (CD-6): a duplicate
 * callback for an already-terminal run-item is a no-op 202. The bug_id paths
 * stay a clean seam for Spec 4. Always 202 { acknowledged: true } on success.
 */
implementationProjectsRouter.post(
  '/build-results',
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    try {
      // NEW inbound service-token check.
      const authorised = checkInboundServiceToken({
        authorization: req.get('authorization') ?? undefined,
        'x-service-token': req.get('x-service-token') ?? undefined,
      });
      if (!authorised) {
        logger.warn('[diag-gateway] migration_execution_driver build_results_unauthorised', {
          requestId,
        });
        return res.status(401).json({ error: 'Missing or invalid service token' });
      }

      const body = (req.body ?? {}) as BuildResultCallbackBody;
      const outcome = await processBuildResult(body, buildResultsDeps());
      return res.status(outcome.status).json(outcome.body);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver build_results_error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  }
);

/**
 * POST /projects/init - Register the project workspace upstream and persist
 * the outcome into AMS.
 *
 * Frontend body: { company, project, project_id, repos } -- the repos MAP
 * form is sent upstream for BOTH single and poly modes. Project creation has
 * already happened; this route NEVER produces a project-creation failure:
 * - upstream success -> persist init-success=true + mode + project_dir +
 *   per-repo rows, respond 200 with the upstream ProjectInitResponse fields.
 * - upstream failure (all-or-nothing rollback, 400 with detail) -> persist
 *   init-success=false, respond 400 with the `detail` for inline display.
 */
implementationProjectsRouter.post(
  '/projects/init',
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || 'unknown';

    try {
      const validationError = validateInitRequest(req.body);
      if (validationError) {
        logger.warn('Project init request validation failed', {
          requestId,
          error: validationError,
        });
        return res.status(400).json({
          success: false,
          detail: validationError,
          error: { code: 400, message: validationError },
        });
      }

      const body = req.body as InitProjectRequest;
      logger.info('Processing project init request', {
        requestId,
        company: body.company,
        project: body.project,
        projectId: body.project_id,
        repoCount: Object.keys(body.repos).length,
      });

      const upstream = await callUpstream(requestId, 'Project init', '/projects/init', {
        method: 'POST',
        body: {
          company: body.company,
          project: body.project,
          repos: body.repos,
          git_provider: body.git_provider.trim().toLowerCase(),
        },
        timeoutMs: INIT_TIMEOUT_MS,
      });
      if (upstream.earlyResponse) {
        return res.status(upstream.earlyResponse.status).json(upstream.earlyResponse.body);
      }

      if (upstream.ok) {
        const initResponse = (upstream.body ?? {}) as ProjectInitResponse;

        // Persist: init-success=true + overall mode + project_dir, then the
        // per-repo rows (folder + request URL + upstream dir/mode).
        const initPersisted = await updateProjectImplementationInit(body.project_id, {
          initSuccess: true,
          mode: initResponse.mode ?? null,
          projectDir: initResponse.project_dir ?? null,
        });

        const upstreamRepoResults = new Map(
          (initResponse.repos ?? []).map((r) => [r.folder, r])
        );
        const rows: ImplementationRepo[] = Object.entries(body.repos).map(
          ([folder, url]) => ({
            folder,
            gitUrl: url.trim(),
            workspaceDir: upstreamRepoResults.get(folder)?.dir ?? null,
            mode: upstreamRepoResults.get(folder)?.mode ?? null,
          })
        );
        const reposPersisted = await replaceProjectImplementationRepos(
          body.project_id,
          rows
        );

        logger.info('Project init succeeded', {
          requestId,
          company: body.company,
          project: body.project,
          mode: initResponse.mode,
          persisted: initPersisted && reposPersisted,
        });

        return res.status(200).json({
          success: true,
          message: initResponse.message,
          project_dir: initResponse.project_dir,
          mode: initResponse.mode,
          repos: initResponse.repos ?? [],
          persisted: initPersisted && reposPersisted,
        });
      }

      // Upstream failure. All-or-nothing rollback upstream; the project
      // remains created in Haikai with init-success=false. Surface the
      // upstream detail inline with a NON-5xx, well-shaped payload.
      const detail = extractUpstreamDetail(upstream.body);
      const persisted = await updateProjectImplementationInit(body.project_id, {
        initSuccess: false,
      });

      logger.warn('Project init failed upstream', {
        requestId,
        company: body.company,
        project: body.project,
        upstreamStatus: upstream.status,
        detail,
        persisted,
      });

      if ((upstream.status ?? 500) >= 500) {
        // Upstream blew up -- opaque 502 (still after persisting failure).
        return res.status(502).json({
          success: false,
          detail,
          error: { code: 502, message: 'Implementation service error' },
        });
      }

      return res.status(400).json({
        success: false,
        detail,
        error: { code: 400, message: detail },
        persisted,
      });
    } catch (error) {
      logger.error('Project init error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  }
);

// ============================================================================
// Repo CRUD proxy routes
// ============================================================================

/**
 * Shared post-processing for every successful repo CRUD upstream response:
 * computes the drift flag against the AMS-stored map, syncs the
 * upstream-reported map into AMS wholesale (external-wins), and responds
 * with the RepoMapResponse + {changed, synced}.
 */
async function syncAndRespond(
  res: Response,
  requestId: string,
  projectId: string,
  upstreamBody: unknown
): Promise<Response> {
  const repoMap = (upstreamBody ?? {}) as RepoMapResponse;
  const upstreamRepos =
    repoMap.repos && typeof repoMap.repos === 'object' ? repoMap.repos : {};

  const stored = await fetchProjectImplementationRepos(projectId);
  const changed = stored === null ? false : repoMapsDiffer(stored, upstreamRepos);

  let synced = false;
  if (stored === null || changed) {
    synced = await replaceProjectImplementationRepos(
      projectId,
      buildSyncRows(stored, upstreamRepos)
    );
  } else {
    synced = true; // already in sync -- nothing to write
  }

  logger.info('Repo map synced from workspace', {
    requestId,
    projectId,
    changed,
    synced,
    repoCount: Object.keys(upstreamRepos).length,
  });

  const response: RepoMapGatewayResponse = {
    company: repoMap.company,
    project: repoMap.project,
    repos: upstreamRepos,
    changed,
    synced,
  };
  return res.status(200).json(response);
}

function requireProjectId(req: Request): string | null {
  const fromQuery = req.query.project_id;
  if (typeof fromQuery === 'string' && fromQuery.trim() !== '') {
    return fromQuery;
  }
  const fromBody =
    req.body && typeof req.body === 'object'
      ? (req.body as Record<string, unknown>).project_id
      : undefined;
  if (typeof fromBody === 'string' && fromBody.trim() !== '') {
    return fromBody;
  }
  return null;
}

function repoBasePath(req: Request): string {
  const company = encodeURIComponent(req.params.company);
  const project = encodeURIComponent(req.params.project);
  return `/projects/${company}/${project}/repos`;
}

/**
 * GET /projects/:company/:project/repos?project_id=... - Read the live repo
 * map from the workspace, auto-syncing AMS (drift notice via `changed`).
 */
implementationProjectsRouter.get(
  '/projects/:company/:project/repos',
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    try {
      const projectId = requireProjectId(req);
      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: 'project_id query parameter is required' },
        });
      }

      const upstream = await callUpstream(requestId, 'Repo map read', repoBasePath(req), {
        method: 'GET',
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (upstream.earlyResponse) {
        return res.status(upstream.earlyResponse.status).json(upstream.earlyResponse.body);
      }
      if (!upstream.ok) {
        return res.status(upstream.status as number).json(upstream.body);
      }
      return await syncAndRespond(res, requestId, projectId, upstream.body);
    } catch (error) {
      logger.error('Repo map read error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  }
);

/**
 * POST /projects/:company/:project/repos - Add a repo to the map
 * (upstream AddRepoRequest {folder, url}; clones immediately).
 */
implementationProjectsRouter.post(
  '/projects/:company/:project/repos',
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    try {
      const projectId = requireProjectId(req);
      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: 'project_id is required' },
        });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const folder = typeof body.folder === 'string' ? body.folder : '';
      const url = typeof body.url === 'string' ? body.url.trim() : '';

      if (!FOLDER_NAME_PATTERN.test(folder)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 400,
            message: `Invalid folder name "${folder}": must match ^[a-z0-9][a-z0-9._-]*$`,
          },
        });
      }
      if (url === '') {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: 'url is required' },
        });
      }

      // Mirror of the client-side uniqueness rules against the stored map
      // (the external service remains the hard enforcement; its 400 detail
      // is forwarded transparently below).
      const stored = await fetchProjectImplementationRepos(projectId);
      if (stored) {
        if (stored.some((r) => r.folder === folder)) {
          return res.status(400).json({
            success: false,
            error: { code: 400, message: `Folder "${folder}" already exists in the repo map` },
          });
        }
        if (stored.some((r) => r.gitUrl === url)) {
          return res.status(400).json({
            success: false,
            error: { code: 400, message: `Repo URL is already mapped to another folder: ${url}` },
          });
        }
      }

      const upstream = await callUpstream(requestId, 'Repo add', repoBasePath(req), {
        method: 'POST',
        body: { folder, url },
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (upstream.earlyResponse) {
        return res.status(upstream.earlyResponse.status).json(upstream.earlyResponse.body);
      }
      if (!upstream.ok) {
        return res.status(upstream.status as number).json(upstream.body);
      }
      return await syncAndRespond(res, requestId, projectId, upstream.body);
    } catch (error) {
      logger.error('Repo add error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  }
);

/**
 * PUT /projects/:company/:project/repos/:folder - Re-point an existing folder
 * to a new URL (upstream UpdateRepoRequest {url}; re-clones).
 */
implementationProjectsRouter.put(
  '/projects/:company/:project/repos/:folder',
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    try {
      const projectId = requireProjectId(req);
      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: 'project_id is required' },
        });
      }

      const folder = req.params.folder;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (url === '') {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: 'url is required' },
        });
      }

      // URL uniqueness mirror: the new URL must not belong to ANOTHER folder.
      const stored = await fetchProjectImplementationRepos(projectId);
      if (stored && stored.some((r) => r.folder !== folder && r.gitUrl === url)) {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: `Repo URL is already mapped to another folder: ${url}` },
        });
      }

      const upstream = await callUpstream(
        requestId,
        'Repo re-point',
        `${repoBasePath(req)}/${encodeURIComponent(folder)}`,
        { method: 'PUT', body: { url }, timeoutMs: PROXY_TIMEOUT_MS }
      );
      if (upstream.earlyResponse) {
        return res.status(upstream.earlyResponse.status).json(upstream.earlyResponse.body);
      }
      if (!upstream.ok) {
        return res.status(upstream.status as number).json(upstream.body);
      }
      return await syncAndRespond(res, requestId, projectId, upstream.body);
    } catch (error) {
      logger.error('Repo re-point error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  }
);

/**
 * DELETE /projects/:company/:project/repos/:folder?project_id=... - Remove a
 * folder from the map (upstream deletes the cloned sub-directory).
 */
implementationProjectsRouter.delete(
  '/projects/:company/:project/repos/:folder',
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    try {
      const projectId = requireProjectId(req);
      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: { code: 400, message: 'project_id query parameter is required' },
        });
      }

      const upstream = await callUpstream(
        requestId,
        'Repo delete',
        `${repoBasePath(req)}/${encodeURIComponent(req.params.folder)}`,
        { method: 'DELETE', timeoutMs: PROXY_TIMEOUT_MS }
      );
      if (upstream.earlyResponse) {
        return res.status(upstream.earlyResponse.status).json(upstream.earlyResponse.body);
      }
      if (!upstream.ok) {
        return res.status(upstream.status as number).json(upstream.body);
      }
      return await syncAndRespond(res, requestId, projectId, upstream.body);
    } catch (error) {
      logger.error('Repo delete error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  }
);
