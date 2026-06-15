/**
 * Discovery Capabilities API Client
 *
 * Spec: 2026-06-14 D2 -- Capability Synthesis + Batch Spines -- Task Group 5.
 *
 * Frontend client for the synthesised `discovery_capability` records exposed by
 * the gateway under
 *
 *   /api/v1/discovery/projects/:projectId/architectures/:architectureId
 *     /capabilities[...]
 *
 * which in turn proxies the architecture-model-service path
 *
 *   /api/model/projects/:projectId/architectures/:architectureId
 *     /discovery/capabilities[...]  (and .../runs/:runId/capabilities)
 *
 * D2's capability synthesis turns scattered per-file operational findings into
 * coherent, durable, migrate-able CAPABILITIES (e.g. "Daily Risk Hierarchy Load
 * Pipeline") with their batch spine (the JIL-DAG topology + the typed
 * `invocations[]` cross-language edges). This client is READ-ONLY: the D2
 * frontend surface is a read-only "Capabilities" section inside the Findings
 * review (no review actions / cascade UI -- the patch-review endpoint exists on
 * AMS but is forward-needed by the later D4-gate spec, not wired here).
 *
 * The TypeScript DTO shapes mirror the AMS `DiscoveryCapabilityDto` /
 * `DiscoveryCapabilityMemberDto` records verbatim using snake_case to match the
 * global Jackson SNAKE_CASE serialiser (the capability entity carries NO
 * `@CamelCaseWire`). Sibling clients (`findingsApi.ts`, `discoveryApi.ts`)
 * follow the same convention.
 *
 * Per-spec constraints honoured here:
 *   - `confidence` is `number | null` per the boxed-Double pitfall
 *     (`project_primitive_double_dto_overwrite.md`).
 *   - `detail_json` typed as `Record<string, unknown> | null` (the JIL-DAG
 *     topology / invocations[] / schedule / externalSystems / behaviourBearing
 *     payload rides here).
 *   - All URLs include `:projectId` AND `:architectureId` (forgetting
 *     `:architectureId` 404s at the gateway router -- by design, mirroring the
 *     findings proxies).
 *   - The AppShell model cache (`project_appshell_model_cache.md`) is NOT
 *     touched -- capabilities live outside the architecture model, and this
 *     client is read-only anyway.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Gateway base URL from env. Defaults to empty string (same origin) for the
 * Vite dev proxy. Mirrors `findingsApi.ts` / `discoveryApi.ts`.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface CapabilitiesApiErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

/**
 * Typed error thrown on non-2xx responses. Mirrors `FindingsApiError` so the
 * Capabilities section can branch on `error.status` / `error.body.message`
 * with the same idiom the Findings surface already uses.
 */
export class CapabilitiesApiError extends Error {
  readonly status: number;
  readonly body: CapabilitiesApiErrorBody;

  constructor(status: number, body: CapabilitiesApiErrorBody, message?: string) {
    super(message ?? body.message ?? `Capabilities API error (status ${status})`);
    this.name = 'CapabilitiesApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<CapabilitiesApiErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        if (wrapped && typeof wrapped === 'object') {
          return wrapped as CapabilitiesApiErrorBody;
        }
        return obj as CapabilitiesApiErrorBody;
      }
      return { message: res.statusText };
    }
    const text = await res.text();
    return { message: text || res.statusText };
  } catch {
    return { message: res.statusText };
  }
}

// ============================================================================
// DTOs (snake_case -- matches AMS Jackson SNAKE_CASE)
// ============================================================================

/**
 * Capability review-disposition vocabulary (`review_status` field). String-typed
 * at the wire; mirrors the finding / candidate vocabulary. The D2 UI is
 * read-only so it only DISPLAYS this; no transitions are issued here.
 */
export type DiscoveryCapabilityStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'deferred';

/**
 * Polymorphic membership `member_type` vocabulary. Mirrors the AMS
 * `member_type` value set: a member references a row in one of these tables by
 * its `member_id`.
 */
export type DiscoveryCapabilityMemberType =
  | 'discovery_finding'
  | 'discovery_candidate'
  | 'architecture_element'
  | 'discovery_relationship';

/**
 * A single polymorphic membership edge from a capability to a referenced member.
 * Mirrors the AMS `DiscoveryCapabilityMemberDto` record exactly.
 */
export interface DiscoveryCapabilityMemberDto {
  id: string;
  capability_id: string;
  member_type: DiscoveryCapabilityMemberType | string;
  member_id: string;
  created_at: string | null;
}

/**
 * Response shape for a single `discovery_capability` row, with embedded members.
 * Mirrors the AMS `DiscoveryCapabilityDto` record (snake_case via the global
 * Jackson SNAKE_CASE strategy).
 *
 * `confidence` is `number | null` per the boxed-Double pitfall. `detail_json`
 * carries the batch spine -- the JIL-DAG topology snapshot, the typed
 * `invocations[]` edges, schedule / external systems, and the aggregated
 * `behaviourBearing` hint. `members` is populated on the GET-by-id read and on
 * the list reads (the AMS service embeds them).
 */
export interface DiscoveryCapabilityDto {
  id: string;
  run_id: string | null;
  project_id: string;
  architecture_id: string;
  name: string;
  kind: string | null;
  summary: string | null;
  review_status: DiscoveryCapabilityStatus | string;
  previous_review_status: string | null;
  confidence: number | null;
  detail_json: Record<string, unknown> | null;
  source: string | null;
  created_by_stage: string | null;
  created_at: string;
  updated_at: string;
  members: DiscoveryCapabilityMemberDto[];
}

// ============================================================================
// detail_json sub-shapes (the batch spine)
// ============================================================================

/**
 * One typed cross-language invocation edge inside `detail_json.invocations[]`
 * (D8). Structural edges (the JIL box-member / condition DAG) carry high
 * confidence; inferred (FQCN / string-matched) edges carry an explicit lower
 * confidence so the UI can distinguish them.
 *
 * Mirrors the discovery-service `InvocationEdge` shape. All fields are optional
 * in the type because `detail_json` is free-form JSONB on the wire -- the
 * Capabilities section renders defensively.
 */
export interface CapabilityInvocationEdge {
  from?: string;
  fromKind?: string;
  to?: string;
  toKind?: string;
  mechanism?: string;
  confidence?: number;
}

/**
 * The JIL-DAG topology snapshot inside `detail_json.jilTopology` (jil_dag-mode
 * seeds only; `null` for co-location seeds). Mirrors the projection the
 * synthesis step lands (`jobs` / `boxes` / `fileWatchers` / `edges`).
 */
export interface CapabilityJilTopology {
  jobs?: Array<Record<string, unknown>>;
  boxes?: string[];
  fileWatchers?: string[];
  edges?: Array<Record<string, unknown>>;
}

/**
 * One folded operational-artifact entry inside `detail_json.artifacts[]`. At
 * synthesis time these are NOT yet AMS findings with ids, so their substance
 * rides in `detail_json` (the graceful-degradation contract).
 */
export interface CapabilityArtifactRef {
  filePath?: string;
  artifactKind?: string;
  behaviourBearing?: boolean;
  invokes?: string[];
  externalSystems?: string[];
  purpose?: string | null;
}

/**
 * A typed read-only view over a capability's `detail_json` batch spine. Built by
 * {@link readCapabilityDetail} from the free-form JSONB so the UI never reaches
 * into untyped `Record<string, unknown>` directly.
 */
export interface CapabilityDetail {
  seedKey?: string;
  seedMode?: string;
  jilTopology: CapabilityJilTopology | null;
  invocations: CapabilityInvocationEdge[];
  schedule: Record<string, unknown> | null;
  externalSystems: string[];
  behaviourBearing: boolean | null;
  artifacts: CapabilityArtifactRef[];
}

/**
 * Coerce a capability's free-form `detail_json` into the typed
 * {@link CapabilityDetail} view. Tolerant of missing / malformed fields (the
 * payload is JSONB) -- every field defaults to an empty / null shape so the
 * Capabilities section can render unconditionally.
 */
export function readCapabilityDetail(
  detailJson: Record<string, unknown> | null | undefined,
): CapabilityDetail {
  const d = (detailJson ?? {}) as Record<string, unknown>;
  const topologyRaw = d.jilTopology;
  const jilTopology =
    topologyRaw && typeof topologyRaw === 'object'
      ? (topologyRaw as CapabilityJilTopology)
      : null;
  const invocations = Array.isArray(d.invocations)
    ? (d.invocations as CapabilityInvocationEdge[])
    : [];
  const externalSystems = Array.isArray(d.externalSystems)
    ? (d.externalSystems as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const artifacts = Array.isArray(d.artifacts)
    ? (d.artifacts as CapabilityArtifactRef[])
    : [];
  return {
    seedKey: typeof d.seedKey === 'string' ? d.seedKey : undefined,
    seedMode: typeof d.seedMode === 'string' ? d.seedMode : undefined,
    jilTopology,
    invocations,
    schedule:
      d.schedule && typeof d.schedule === 'object'
        ? (d.schedule as Record<string, unknown>)
        : null,
    externalSystems,
    behaviourBearing:
      typeof d.behaviourBearing === 'boolean' ? d.behaviourBearing : null,
    artifacts,
  };
}

// ============================================================================
// Internal URL + fetch helpers
// ============================================================================

/**
 * Build the gateway capabilities path prefix for a given
 * `(projectId, architectureId)` -- the project + architecture scope (no run
 * filter). Both ids are URL-encoded.
 */
function capabilitiesPathPrefix(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/discovery` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/capabilities`
  );
}

/**
 * Build the gateway run-scoped capabilities path prefix for a given
 * `(projectId, architectureId, runId)`. All three ids are URL-encoded.
 */
function runCapabilitiesPathPrefix(
  projectId: string,
  architectureId: string,
  runId: string,
): string {
  return (
    `${GATEWAY_BASE}/api/v1/discovery` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/runs/${encodeURIComponent(runId)}/capabilities`
  );
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new CapabilitiesApiError(res.status, body);
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

// ============================================================================
// Public API (read-only -- D2 frontend scope)
// ============================================================================

/**
 * List the synthesised capabilities for a discovery run (members embedded).
 *
 * This is the per-run read the Findings Capabilities section uses: the
 * FindingsTab is already scoped to a single `runId`, so the Capabilities
 * section it hosts reads the SAME run's capabilities (matching how the tab
 * fetches its findings by run). Returns the AMS list verbatim.
 */
export async function listCapabilitiesByRun(
  projectId: string,
  architectureId: string,
  runId: string,
): Promise<DiscoveryCapabilityDto[]> {
  const url = runCapabilitiesPathPrefix(projectId, architectureId, runId);
  return jsonRequest<DiscoveryCapabilityDto[]>(url, { method: 'GET' });
}

/**
 * List ALL synthesised capabilities for a project + architecture (no run
 * filter; members embedded). Exposed for a future cross-run Capabilities view
 * (Option-B); the D2 Findings section uses the run-scoped read above.
 */
export async function listCapabilitiesByProjectAndArchitecture(
  projectId: string,
  architectureId: string,
): Promise<DiscoveryCapabilityDto[]> {
  const url = capabilitiesPathPrefix(projectId, architectureId);
  return jsonRequest<DiscoveryCapabilityDto[]>(url, { method: 'GET' });
}

/**
 * Fetch a single capability by id (members embedded). Exposed for completeness;
 * the run-scoped list already embeds members so the Capabilities section does
 * not need a second round-trip on expand.
 */
export async function getCapability(
  projectId: string,
  architectureId: string,
  capabilityId: string,
): Promise<DiscoveryCapabilityDto> {
  const url =
    capabilitiesPathPrefix(projectId, architectureId) +
    `/${encodeURIComponent(capabilityId)}`;
  return jsonRequest<DiscoveryCapabilityDto>(url, { method: 'GET' });
}
