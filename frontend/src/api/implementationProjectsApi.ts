/**
 * Implementation-Service Project API Client
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Groups 3 + 4.
 *
 * Typed snake_case client for the gateway route surface in
 * `gateway/src/routes/implementationProjects.ts` (mounted at
 * `/api/implementation`):
 *
 *   POST   /projects/init                                  — register the
 *          project workspace upstream (clones every repo in the map) and
 *          persist the init outcome into AMS. NEVER blocks project creation:
 *          upstream failure resolves to `{ success: false, detail }` so the
 *          Create/Edit-project modal can surface the detail inline.
 *   GET    /projects/:company/:project/repos?project_id=   — read the live
 *          repo map (external-wins drift auto-sync into AMS; `changed` flags
 *          the "repo map updated from workspace" notice).
 *   POST   /projects/:company/:project/repos               — add a repo
 *          (body `{folder, url, project_id}`).
 *   PUT    /projects/:company/:project/repos/:folder       — re-point a repo
 *          (body `{url, project_id}`; upstream re-clones).
 *   DELETE /projects/:company/:project/repos/:folder?project_id= — remove.
 *
 * Wire format is snake_case throughout (the gateway mirrors the external
 * "Standards Extractor API" contract) — no camelCase mapping layer.
 *
 * `company` / `project` identifiers are the NORMALISED organisation name and
 * product name (see `normalizeIdentifier`, same derivation as
 * `startOrchestrationJob`). `project_id` is the Haikai project UUID the
 * gateway uses as its AMS persistence target — it is never sent upstream.
 *
 * Error parsing follows the `extractGatewayErrorMessage` pattern from
 * `dbMigrationPackApi.ts` / `migrationDeliveryPlanApi.ts`: the gateway
 * answers with the NESTED envelope `{ error: { code, message } }` (plus a
 * top-level `detail` on init failures); a naive
 * `errorBody.message || errorBody.error` read would stringify the nested
 * object into "[object Object]".
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/** Base path of the gateway's implementation-project routes. */
const IMPLEMENTATION_BASE = `${GATEWAY_BASE}/api/implementation`;

// ============================================================================
// Wire DTOs (snake_case — mirrors the gateway response shapes verbatim)
// ============================================================================

/** Per-repo outcome of a successful init (upstream RepoInitResult). */
export interface RepoInitResultDto {
  folder: string;
  dir: string;
  /** Per-repo detected mode: 'greenfield' | 'brownfield'. */
  mode: string;
}

/**
 * Result of `initProjectWorkspace`. This function RESOLVES (never throws)
 * for any well-formed gateway response — including upstream clone failures
 * (all-or-nothing rollback, surfaced as `{ success: false, detail }`) — so
 * the caller can keep the "init never blocks project creation" guarantee.
 * It throws only on network-level failures or unparseable responses.
 */
export interface InitProjectWorkspaceResult {
  success: boolean;
  /** Human-readable upstream detail; present on failure for inline display. */
  detail?: string;
  /** Upstream success message. */
  message?: string;
  /** Workspace root directory upstream (success only). */
  project_dir?: string;
  /** Overall mode: 'brownfield' | 'greenfield' | 'polyrepo' (success only). */
  mode?: string;
  /** Per-repo init outcomes (success only). */
  repos?: RepoInitResultDto[];
  /** True when the gateway persisted the outcome into AMS. */
  persisted?: boolean;
}

/**
 * Gateway response for every repo CRUD route: the upstream RepoMapResponse
 * plus the drift-sync metadata.
 */
export interface RepoMapGatewayResponse {
  company: string;
  project: string;
  /** Folder -> git remote URL map (the external workspace's live map). */
  repos: Record<string, string>;
  /**
   * True when the upstream-reported map differed from the AMS-stored map
   * before this sync. On GET this signals drift — show the
   * "repo map updated from workspace" notice.
   */
  changed: boolean;
  /** True when the AMS-stored map is in sync with upstream after this call. */
  synced: boolean;
}

// ============================================================================
// Error handling (extractGatewayErrorMessage pattern)
// ============================================================================

/**
 * Extract a HUMAN-READABLE message from a gateway error body. Handles the
 * NESTED envelope `{ error: { code, message } }`, the init routes' top-level
 * `detail`, plus `{ error: "string" }` and `{ message: "string" }`. Never
 * feeds an object to `new Error(...)` (which would render
 * "[object Object]").
 */
export function extractGatewayErrorMessage(errorBody: unknown): string {
  if (!errorBody || typeof errorBody !== 'object') return '';
  const top = errorBody as { detail?: unknown; message?: unknown; error?: unknown };
  if (typeof top.detail === 'string' && top.detail) return top.detail;
  if (typeof top.message === 'string' && top.message) return top.message;
  if (typeof top.error === 'string' && top.error) return top.error;
  if (top.error && typeof top.error === 'object') {
    const nested = top.error as { message?: unknown; details?: unknown };
    const message = typeof nested.message === 'string' ? nested.message : '';
    const details = typeof nested.details === 'string' ? nested.details : '';
    if (message && details) return `${message}: ${details}`;
    return message || details;
  }
  return '';
}

async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function throwGatewayError(res: Response, fallback: string): Promise<never> {
  const body = await parseJsonBody(res);
  const serverMessage = extractGatewayErrorMessage(body);
  throw new Error(serverMessage || `${fallback}: ${res.status} ${res.statusText}`);
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Registers the project workspace with the external implementation service
 * via the gateway init proxy, which also persists the outcome into AMS.
 *
 * POST /api/implementation/projects/init
 * Body: `{ company, project, project_id, repos, git_provider }` — `repos` is
 * ALWAYS the map form (folder -> URL), for BOTH single and poly modes (single
 * mode sends a one-entry map keyed by the normalised product name).
 * `git_provider` is the workspace-wide provider ('github' | 'gitlab' |
 * 'bitbucket').
 *
 * Resolution semantics: resolves `{ success: true, ... }` on upstream
 * success, and `{ success: false, detail }` for ANY non-ok gateway response
 * with an extractable message (the project is already created by then —
 * init failure must surface inline, never abort the flow). Throws only on
 * network failures / completely unparseable responses.
 */
export async function initProjectWorkspace(args: {
  company: string;
  project: string;
  /** Haikai project UUID (AMS persistence target). */
  projectId: string;
  /** Folder -> git remote URL map. */
  repos: Record<string, string>;
  /**
   * Git provider backing the workspace -- one of 'github' | 'gitlab' |
   * 'bitbucket'. Forwarded to the IV service so it selects the matching auth
   * strategy/token; required by the upstream `/projects/init` endpoint.
   */
  gitProvider: string;
}): Promise<InitProjectWorkspaceResult> {
  const response = await fetch(`${IMPLEMENTATION_BASE}/projects/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: args.company,
      project: args.project,
      project_id: args.projectId,
      repos: args.repos,
      git_provider: args.gitProvider,
    }),
  });

  const body = await parseJsonBody(response);

  if (response.ok) {
    const ok = (body ?? {}) as InitProjectWorkspaceResult;
    return { ...ok, success: ok.success !== false };
  }

  const detail = extractGatewayErrorMessage(body);
  if (detail) {
    return { success: false, detail };
  }
  throw new Error(
    `Workspace setup failed: ${response.status} ${response.statusText}`
  );
}

function repoBasePath(company: string, project: string): string {
  return `${IMPLEMENTATION_BASE}/projects/${encodeURIComponent(company)}/${encodeURIComponent(project)}/repos`;
}

/**
 * Reads the live repo map from the external workspace via the gateway,
 * which auto-syncs the AMS-stored map (external-wins). `changed: true`
 * means the stored map drifted — show the
 * "repo map updated from workspace" notice.
 *
 * GET /api/implementation/projects/:company/:project/repos?project_id=
 */
export async function getImplementationRepoMap(
  company: string,
  project: string,
  projectId: string
): Promise<RepoMapGatewayResponse> {
  const url = `${repoBasePath(company, project)}?project_id=${encodeURIComponent(projectId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    await throwGatewayError(response, 'Failed to load repo map');
  }
  return (await response.json()) as RepoMapGatewayResponse;
}

/**
 * Adds a repo to the workspace map (upstream clones immediately).
 *
 * POST /api/implementation/projects/:company/:project/repos
 * Body: `{ folder, url, project_id }`
 */
export async function addImplementationRepo(
  company: string,
  project: string,
  projectId: string,
  folder: string,
  url: string
): Promise<RepoMapGatewayResponse> {
  const response = await fetch(repoBasePath(company, project), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, url, project_id: projectId }),
  });
  if (!response.ok) {
    await throwGatewayError(response, 'Failed to add repo');
  }
  return (await response.json()) as RepoMapGatewayResponse;
}

/**
 * Re-points an existing folder to a new URL (upstream re-clones).
 *
 * PUT /api/implementation/projects/:company/:project/repos/:folder
 * Body: `{ url, project_id }`
 */
export async function updateImplementationRepo(
  company: string,
  project: string,
  projectId: string,
  folder: string,
  url: string
): Promise<RepoMapGatewayResponse> {
  const response = await fetch(
    `${repoBasePath(company, project)}/${encodeURIComponent(folder)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, project_id: projectId }),
    }
  );
  if (!response.ok) {
    await throwGatewayError(response, 'Failed to update repo');
  }
  return (await response.json()) as RepoMapGatewayResponse;
}

/**
 * Removes a folder from the workspace map (upstream deletes the clone).
 *
 * DELETE /api/implementation/projects/:company/:project/repos/:folder?project_id=
 */
export async function deleteImplementationRepo(
  company: string,
  project: string,
  projectId: string,
  folder: string
): Promise<RepoMapGatewayResponse> {
  const url =
    `${repoBasePath(company, project)}/${encodeURIComponent(folder)}` +
    `?project_id=${encodeURIComponent(projectId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    await throwGatewayError(response, 'Failed to remove repo');
  }
  return (await response.json()) as RepoMapGatewayResponse;
}
