/**
 * Gateway Client
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 5)
 *
 * Thin fetch wrapper around the gateway's discovery endpoints used by
 * interactive frontend features (currently: save-time tech hints resolve).
 *
 * The single-purpose `resolveTechHints` method mirrors the pattern used by
 * `discoveryApi.ts` but is located under `services/` so unrelated UI code can
 * import it without dragging in the broader discovery API surface. An optional
 * `AbortSignal` is forwarded to `fetch` so the caller (TechHintsCell) can
 * cancel an in-flight resolve when the user re-edits the row.
 */

import type {
  ResolveTechHintsRequest,
  TechHintResolution,
} from '../types/techHints';

/**
 * Gateway API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 * Mirrors the convention used by `src/api/discoveryApi.ts`.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Error shape returned by the gateway relay (and discovery-service below it)
 * for any non-2xx status code. `reason` is preserved end-to-end from
 * discovery-service through the gateway pass-through.
 */
export interface TechHintsResolveError extends Error {
  status: number;
  reason?: 'clone_timeout' | 'llm_timeout' | 'llm_malformed' | 'network_error' | string;
}

function buildResolveError(status: number, message: string, reason?: string): TechHintsResolveError {
  const err = new Error(message) as TechHintsResolveError;
  err.name = 'TechHintsResolveError';
  err.status = status;
  if (reason) {
    err.reason = reason;
  }
  return err;
}

/**
 * Resolve a service's free-text `core_tech` against the registered language
 * and framework packs via the gateway relay route.
 *
 * POST /api/v1/discovery/tech-hints/resolve
 *
 * @param request - `{ freeText, repoLocation?, repoSubfolder? }`.
 * @param signal  - Optional AbortSignal; passing `controller.signal` allows the
 *                  caller to cancel the in-flight resolve on re-edit.
 * @returns The `TechHintResolution` envelope returned by discovery-service.
 * @throws  TechHintsResolveError on non-2xx response. The error carries the
 *          response `status` and the preserved `reason` field when the body
 *          included one (LLM timeout, clone timeout, etc).
 * @throws  DOMException with name 'AbortError' when the caller aborts.
 */
export async function resolveTechHints(
  request: ResolveTechHintsRequest,
  signal?: AbortSignal
): Promise<TechHintResolution> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/tech-hints/resolve`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // fall through to bare error
    }
    const envelope = parsed as { error?: string; reason?: string } | null;
    throw buildResolveError(
      res.status,
      envelope?.error ?? `Resolve tech hints failed: ${res.status}`,
      envelope?.reason
    );
  }

  return res.json() as Promise<TechHintResolution>;
}

// ============================================================================
// Discovery Run Start (2026-04-22 — Start Discovery Run context-menu action)
// ============================================================================

/**
 * Subset of the discovery-service run DTO that the Start-Discovery-Run
 * UX cares about. The full DTO carries more fields (config_snapshot,
 * steps_payload, etc.) but the context-menu flow only needs id/tier.
 */
export interface StartDiscoveryRunResult {
  id: string;
  project_id: string;
  service_id: string | null;
  tier: 'A' | 'B' | 'C';
  mode: string;
  status: string;
}

/**
 * Error shape returned by the gateway relay when the discovery-service
 * rejects the run start. The two 409 codes the UI reads explicitly:
 *
 * - `TECH_HINTS_UNRESOLVED` — `core_tech_resolved` is NULL on the service.
 *   The UI surfaces a toast directing the user to resolve tech hints.
 *
 * - `LLM_SOLO_CONFIRMATION_REQUIRED` — the service resolved to Tier C
 *   (no language or framework pack matched). The UI surfaces a confirm
 *   dialog; if the user accepts, it re-invokes with `confirmLlmSolo: true`.
 */
export interface StartDiscoveryRunError extends Error {
  status: number;
  code?: string;
  warnings?: string[];
}

function buildStartRunError(
  status: number,
  message: string,
  code?: string,
  warnings?: string[],
): StartDiscoveryRunError {
  const err = new Error(message) as StartDiscoveryRunError;
  err.name = 'StartDiscoveryRunError';
  err.status = status;
  if (code) err.code = code;
  if (warnings) err.warnings = warnings;
  return err;
}

/**
 * Kick off a service-scoped discovery run through the gateway relay.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
 *   The URL now embeds the run's bound `architectureId` -- the picker
 *   in StartDiscoveryRunConfirmModal is the source of truth, NOT
 *   useActiveArchitectureId(). projectId + architectureId travel via
 *   the URL path; only `serviceId` and `confirmLlmSolo` go in the body.
 *
 * POST /api/v1/discovery/projects/{projectId}/architectures/{architectureId}/runs
 *
 * @param projectId      The owning project UUID.
 * @param architectureId The architecture the run is bound to for life
 *                       (picked at run start; persisted on the run row).
 * @param serviceId      The service ID (e.g. `svc-xxxxxxxx-xxxxx`).
 * @param confirmLlmSolo Pass `true` only on the retry after the user
 *                       confirmed the Tier-C LLM-only warning dialog.
 *                       Defaults to `false` for first-attempt calls.
 * @returns StartDiscoveryRunResult with the new run's id + tier + status.
 * @throws  StartDiscoveryRunError on non-2xx. `status` carries the HTTP
 *          code and `code` carries the discovery-service error code
 *          (`TECH_HINTS_UNRESOLVED` / `LLM_SOLO_CONFIRMATION_REQUIRED`)
 *          when the body provided one.
 */
/**
 * Spec 2026-05-16 Database Discovery Packs -- Group 5
 *
 * Optional run-create extras. When `discoveryKind === 'database'`, the
 * discovery-service branches on the `discovery_kind` field server-side and
 * dispatches to the database orchestrator. The `databaseConfig` carries the
 * connection metadata + credentials for the run; the password lives in the
 * request body only and is purged by the discovery-service on completion.
 * The frontend MUST NOT persist the password.
 */
export interface StartDiscoveryRunDatabaseExtras {
  discoveryKind: 'code' | 'database' | 'combined';
  databaseConfig?: Record<string, unknown>;
  /**
   * Username/password for the database connection. The discovery-service
   * expects these as a SEPARATE `database_credentials` field on the
   * run-create body (not inside `database_config`). It holds them
   * in-memory for the run's lifetime and purges them on completion.
   */
  databaseCredentials?: { username: string; password: string };
}

export async function startDiscoveryRun(
  projectId: string,
  architectureId: string,
  serviceId: string,
  confirmLlmSolo: boolean = false,
  extras?: StartDiscoveryRunDatabaseExtras,
): Promise<StartDiscoveryRunResult> {
  // Spec #4 Task Group 6: hard cutover to architecture-scoped path. The
  // gateway proxy at `gateway/src/routes/discovery.ts` matches this exact
  // shape and forwards to discovery-service
  // `POST /discovery/projects/:projectId/architectures/:architectureId/runs`.
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs`;

  // Spec 2026-05-16 Group 5: when `extras` is supplied (database source),
  // include `discovery_kind` + `database_config` in the body. The discovery-
  // service branches server-side; the gateway is transparent.
  const body: Record<string, unknown> = { serviceId, confirmLlmSolo };
  if (extras) {
    body.discovery_kind = extras.discoveryKind;
    if (extras.databaseConfig) {
      body.database_config = extras.databaseConfig;
    }
    if (extras.databaseCredentials) {
      body.database_credentials = extras.databaseCredentials;
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // fall through
    }
    // Two error envelope shapes surface from discovery-service:
    //   1. `{ error: { code, message, warnings? } }` — tier / tech-hints gates.
    //   2. `{ error: 'msg' }` — gateway proxy errors (502/504, bad validation).
    const envelope = parsed as
      | { error?: { code?: string; message?: string; warnings?: string[] } | string }
      | null;
    let message = `Start discovery run failed: ${res.status}`;
    let code: string | undefined;
    let warnings: string[] | undefined;
    if (envelope && typeof envelope.error === 'object' && envelope.error !== null) {
      message = envelope.error.message ?? message;
      code = envelope.error.code;
      warnings = envelope.error.warnings;
    } else if (envelope && typeof envelope.error === 'string') {
      message = envelope.error;
    }
    throw buildStartRunError(res.status, message, code, warnings);
  }

  return res.json() as Promise<StartDiscoveryRunResult>;
}

// ============================================================================
// Library Discovery Integration (2026-05-06 -- Spec 3 of 3 in the Library arc)
// ============================================================================

/**
 * Locked snake_case ScanPlan response shape returned by both preflight
 * endpoints. Mirrors the shape PreflightModal expects -- snake_case at
 * the wire boundary, which matches the Spec 1 / Spec 2 / Spec 3 JSON
 * convention end-to-end.
 */
export interface ScanPlanResponse {
  root: {
    kind: 'service' | 'library';
    id: string;
    name: string;
    repo_location?: string;
    repo_subfolder?: string;
    ecosystem?: string;
  };
  internalLibrariesToScan: Array<{
    library_id: string | null;
    name: string;
    repo_subfolder?: string;
    depth: number;
    status: 'new' | 're-scan' | 'skipped-cycle' | 'skipped-depth-cap';
  }>;
  externalLibrariesToRecord: Array<{
    library_id?: string | null;
    name: string;
    declared_coordinates: string;
    scope: string;
  }>;
  warnings: Array<{
    type: 'cycle' | 'depth-cap' | 'unresolvable-internal';
    message: string;
    library_name?: string;
  }>;
}

export interface StartLibraryScanResult {
  id: string;
  project_id?: string;
  architecture_id?: string;
  status: string;
}

async function postLibraryScanEndpoint<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // fall through
    }
    const envelope = parsed as
      | { error?: { code?: string; message?: string } | string }
      | null;
    let message = `Library-scan request failed: ${res.status}`;
    if (envelope && typeof envelope.error === 'object' && envelope.error !== null) {
      message = envelope.error.message ?? message;
    } else if (envelope && typeof envelope.error === 'string') {
      message = envelope.error;
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/**
 * Service-rooted preflight library scan.
 *
 * POST /api/v1/discovery/projects/{projectId}/architectures/{architectureId}/services/{serviceId}/preflight-library-scan
 */
export async function previewLibraryScanForService(
  projectId: string,
  architectureId: string,
  serviceId: string,
  includeExternal: boolean = true,
): Promise<ScanPlanResponse> {
  const url =
    `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/services/${encodeURIComponent(serviceId)}/preflight-library-scan`;
  return postLibraryScanEndpoint<ScanPlanResponse>(url, { includeExternal });
}

/**
 * Library-rooted preflight library scan.
 *
 * POST /api/v1/discovery/projects/{projectId}/architectures/{architectureId}/libraries/{libraryId}/preflight-library-scan
 */
export async function previewLibraryScanForLibrary(
  projectId: string,
  architectureId: string,
  libraryId: string,
  includeExternal: boolean = true,
): Promise<ScanPlanResponse> {
  const url =
    `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/libraries/${encodeURIComponent(libraryId)}/preflight-library-scan`;
  return postLibraryScanEndpoint<ScanPlanResponse>(url, { includeExternal });
}

/**
 * Service-rooted library-scan run start.
 *
 * POST /api/v1/discovery/projects/{projectId}/architectures/{architectureId}/services/{serviceId}/start-library-scan
 * with body { includeExternal }. Gateway forwards to discovery-service
 * /runs with body { runMode: 'library-scoped', serviceId, includeExternal }.
 */
export async function startLibraryScanForService(
  projectId: string,
  architectureId: string,
  serviceId: string,
  includeExternal: boolean,
): Promise<StartLibraryScanResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/services/${encodeURIComponent(serviceId)}/start-library-scan`;
  return postLibraryScanEndpoint<StartLibraryScanResult>(url, { includeExternal });
}

/**
 * Library-rooted library-scan run start.
 *
 * POST /api/v1/discovery/projects/{projectId}/architectures/{architectureId}/libraries/{libraryId}/start-library-scan
 */
export async function startLibraryScanForLibrary(
  projectId: string,
  architectureId: string,
  libraryId: string,
  includeExternal: boolean,
): Promise<StartLibraryScanResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/libraries/${encodeURIComponent(libraryId)}/start-library-scan`;
  return postLibraryScanEndpoint<StartLibraryScanResult>(url, { includeExternal });
}
