/**
 * Target Architectures API client.
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 6
 *
 * Frontend boundary for the new target-architecture endpoints proxied through
 * the gateway (mounted at `/api`, see `gateway/src/routes/targetArchitectures.ts`):
 *
 *   POST   /api/projects/{projectId}/target-architectures/seed
 *   GET    /api/projects/{projectId}/target-architectures
 *   POST   /api/projects/{projectId}/target-architectures/{id}/promote
 *   DELETE /api/projects/{projectId}/target-architectures/{id}
 *
 * Wire-shape note:
 *   AMS returns the standard `ArchitectureDto` (id, projectId, name, description,
 *   tags, archived, kind, draftState, createdAt, updatedAt). The two
 *   discriminators (`kind` / `draftState`) now flow through `ArchitectureMapper`
 *   and `ArchitectureDto` on every response, so the boundary mapper here trusts
 *   the wire value directly. The mapper retains camelCase / snake_case
 *   tolerance for `draftState` / `draft_state` so an older AMS build (or any
 *   future endpoint that omits the field) still parses cleanly -- absent
 *   values map to `null` (NOT a default) so the UI can branch on a real
 *   "unknown" signal rather than silently treating it as a draft.
 *
 * Boundary mapper:
 *   Even though the bulk of fields are already camelCase on the wire, we still
 *   route every response through a `mapTargetArchitectureWireToDto` function
 *   so:
 *     (a) Future AMS revisions that surface `draft_state` etc. as snake_case
 *         are absorbed at this single boundary (precedent:
 *         `migrationDeliveryDashboardApi.ts`).
 *     (b) Consumers always see the documented camelCase shape, never the raw
 *         wire object.
 *
 * Conventions follow `migrationDeliveryDashboardApi.ts` and
 * `epicCapturedDecisionsApi.ts` for naming, URL building, and error parsing.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Exported camelCase types -- consumed by all target-architecture UI components.
// ============================================================================

/**
 * Architecture `kind` discriminator. Only target rows are returned by the
 * target-architecture endpoints; the type is intentionally narrow so callers
 * cannot accidentally treat a current row as a draft.
 */
export type ArchitectureKind = 'current' | 'target';

/**
 * Architecture `draft_state` discriminator. Drives the drafts panel's
 * "active row" highlight + the delete-disable rule (per Group 6 acceptance:
 * delete is disabled for the active draft).
 */
export type DraftState = 'active' | 'draft';

/**
 * The target-architecture row as consumed by Group 6 components. Stays a
 * narrow subset of the underlying architecture row -- enough to drive the
 * drafts panel, active-highlight, and delete-gating rules.
 */
export interface TargetArchitectureDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  tags: string[];
  /**
   * Architecture kind from the AMS wire. May be `null` if an older AMS build
   * has not yet surfaced the field; consumers branch on `null` as "unknown"
   * rather than silently defaulting.
   */
  kind: ArchitectureKind | null;
  /**
   * Draft state from the AMS wire. May be `null` if an older AMS build has
   * not yet surfaced the field; consumers branch on `null` as "unknown".
   */
  draftState: DraftState | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Aggregated count of in-scope elements across the four user-visible
   * supertype tables (Architecture Model Service: `application_components`,
   * `interfaces`, `data_entity_points`, `infrastructure_points`). Surfaced by
   * the Four-Spec Hardening Pass (2026-05-25, Item 3) so the Drafts panel can
   * badge every empty draft, not just the selected one. May be `null` if an
   * older Architecture Model Service build has not yet surfaced the field;
   * consumers branch on `null` as "unknown" rather than silently treating it
   * as `0`.
   */
  elementCount: number | null;
}

/** Seed mode discriminator -- mirrors the AMS request contract. */
export type SeedTargetArchitectureMode = 'clone-current' | 'blank' | 'from-template';

/** Body for `POST /api/projects/{projectId}/target-architectures/seed`. */
export interface SeedTargetArchitectureRequest {
  mode: SeedTargetArchitectureMode;
  /** Required when `mode='clone-current'`; otherwise AMS resolves the canonical current architecture. */
  currentArchitectureId?: string;
  /** Optional explicit name; AMS auto-names when absent. */
  draftName?: string;
  /** Only consulted when `mode='from-template'`; v1 returns 501. */
  templateId?: string;
}

/**
 * Structured error envelope returned by the gateway proxy on a non-2xx. AMS
 * round-trips its own error body verbatim, so callers can branch on
 * `body.code` (e.g. `active_cannot_be_deleted`,
 * `template_mode_not_implemented`).
 */
export interface TargetArchitecturesApiErrorBody {
  code?: string;
  field?: string;
  message?: string;
}

/**
 * Typed error class thrown by every function on non-2xx. Mirrors the
 * `ArchitecturesApiError` pattern from `architecturesApi.ts` so existing
 * modal callers can branch consistently on `error.status` /
 * `error.body.code`.
 */
export class TargetArchitecturesApiError extends Error {
  readonly status: number;
  readonly body: TargetArchitecturesApiErrorBody;

  constructor(
    status: number,
    body: TargetArchitecturesApiErrorBody,
    message?: string,
  ) {
    super(
      message ?? body.message ?? `Target Architectures API error (status ${status})`,
    );
    this.name = 'TargetArchitecturesApiError';
    this.status = status;
    this.body = body;
  }
}

// ============================================================================
// Private wire types -- inbound JSON shape (mix of camel + possible snake).
// Not exported; consumers should not touch these directly.
// ============================================================================

/**
 * Inbound shape from the AMS-proxied response. Optional fields are absent in
 * v1 builds that have not yet surfaced `kind` / `draftState` on the wire; the
 * mapper below applies sensible defaults so the UI keeps working as those
 * fields land.
 */
interface TargetArchitectureWireDto {
  id: string;
  // AMS uses camelCase `projectId` already.
  projectId: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  // The two schema-addition fields. We accept either camelCase or snake_case
  // so the same client works against an AMS that has (or has not yet) updated
  // its DTO.
  kind?: ArchitectureKind | null;
  draftState?: DraftState | null;
  draft_state?: DraftState | null;
  // Four-Spec Hardening Pass (2026-05-25), Item 3: nullable element count
  // aggregated server-side over the four user-visible supertype tables.
  // Accept both camelCase and snake_case to match the existing tolerance
  // pattern -- the Architecture Model Service uses snake_case wire format
  // globally so the canonical inbound key is `element_count`.
  elementCount?: number | null;
  element_count?: number | null;
}

// ============================================================================
// Wire -> camelCase mappers (boundary-only; never invoked by consumers).
// ============================================================================

function readDraftState(wire: TargetArchitectureWireDto): DraftState | null {
  // AMS now surfaces draftState on every ArchitectureDto. Accept camelCase
  // first, then snake_case, then null. We deliberately do NOT fall back to a
  // default -- a null surfaces "unknown" to the UI so a stale wire (or a
  // future endpoint that legitimately omits the field) is detectable rather
  // than silently coerced.
  const value = wire.draftState ?? wire.draft_state ?? null;
  if (value === 'active') return 'active';
  if (value === 'draft') return 'draft';
  return null;
}

function readKind(wire: TargetArchitectureWireDto): ArchitectureKind | null {
  // AMS now surfaces kind on every ArchitectureDto. No fallback default --
  // null means the wire didn't carry the field (e.g. older AMS build).
  if (wire.kind === 'current') return 'current';
  if (wire.kind === 'target') return 'target';
  return null;
}

function readElementCount(wire: TargetArchitectureWireDto): number | null {
  // Architecture Model Service global config emits snake_case (`element_count`)
  // by default; the canonical camelCase form is accepted as well for parity
  // with the existing `draftState` / `draft_state` tolerance pattern. Anything
  // outside `number | null | undefined` lands as `null` so a stale wire is
  // surfaced as "unknown" rather than silently coerced to `0`.
  const value =
    typeof wire.elementCount === 'number'
      ? wire.elementCount
      : typeof wire.element_count === 'number'
        ? wire.element_count
        : null;
  return value;
}

export function mapTargetArchitectureWireToDto(
  wire: TargetArchitectureWireDto,
): TargetArchitectureDto {
  return {
    id: wire.id,
    projectId: wire.projectId,
    name: wire.name,
    description: wire.description ?? null,
    tags: wire.tags ?? [],
    kind: readKind(wire),
    draftState: readDraftState(wire),
    archived: !!wire.archived,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    elementCount: readElementCount(wire),
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

async function parseError(res: Response): Promise<TargetArchitecturesApiError> {
  let body: TargetArchitecturesApiErrorBody = {};
  try {
    const raw = (await res.json()) as
      | TargetArchitecturesApiErrorBody
      | { error?: TargetArchitecturesApiErrorBody | string };
    // Some gateway error envelopes nest the body under `.error`.
    if (
      raw &&
      typeof raw === 'object' &&
      'error' in raw &&
      raw.error &&
      typeof raw.error === 'object'
    ) {
      body = raw.error as TargetArchitecturesApiErrorBody;
    } else {
      body = raw as TargetArchitecturesApiErrorBody;
    }
  } catch {
    body = { message: res.statusText || `HTTP ${res.status}` };
  }
  return new TargetArchitecturesApiError(res.status, body);
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Lists every target architecture for a project (active + drafts).
 *
 * Calls `GET /api/projects/{projectId}/target-architectures`.
 *
 * AMS sorts the response active-first then most-recent; this helper preserves
 * that ordering verbatim so the drafts panel can render directly from the
 * returned array.
 */
export async function listTargetArchitectures(
  projectId: string,
): Promise<TargetArchitectureDto[]> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  const wire = (await res.json()) as TargetArchitectureWireDto[];
  return (wire ?? []).map(mapTargetArchitectureWireToDto);
}

/**
 * Seeds a new target architecture in one of three modes.
 *
 * Calls `POST /api/projects/{projectId}/target-architectures/seed`.
 *
 * The from-template mode returns 501 in v1 (see
 * `TemplateModeNotImplementedException` on the AMS side); the UI should
 * render the option as disabled with an explanatory tooltip and only call
 * this function for `clone-current` / `blank`.
 */
export async function seedTargetArchitecture(
  projectId: string,
  payload: SeedTargetArchitectureRequest,
): Promise<TargetArchitectureDto> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/seed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  const wire = (await res.json()) as TargetArchitectureWireDto;
  return mapTargetArchitectureWireToDto(wire);
}

/**
 * Soft-deletes a target architecture (sets `archived=true`).
 *
 * Calls `DELETE /api/projects/{projectId}/target-architectures/{id}`.
 *
 * AMS returns 409 `{code: "active_cannot_be_deleted"}` when called on the
 * currently-active target; the error round-trips so the UI can surface the
 * message and keep the row visible.
 */
export async function deleteTargetArchitecture(
  projectId: string,
  targetArchId: string,
  force = false,
): Promise<void> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchId)}` +
    (force ? '?force=true' : '');
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
}

// ============================================================================
// Group 7 additions: promote + unmapped-current-elements + mapping-suggest +
// mark-current-element-decommissioned.
// ============================================================================

/**
 * Body for the AMS-side mark-decommissioned write path.
 *
 * Sent by the unmapped-elements panel when the user clicks "mark
 * decommissioned" on a current-architecture element. The atomic AMS call
 * writes a NEW target-side row with provenance='user-authored' and
 * decommissioning_status='decommissioned', plus an
 * architecture_element_mappings row with mapping_type='decommissioned' and
 * createdByTask='unmapped-panel-mark-decom'.
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 7.
 */
export interface MarkDecommissionedRequest {
  /** Current-architecture element id (the row id on the supertype table). */
  currentElementId: string;
  /**
   * One of `application_components` / `interfaces` / `data_entity_points` /
   * `infrastructure_points`. Backed by the AMS supertype table inventory.
   */
  currentElementType: string;
  /**
   * The architecture id the current element belongs to (so the mapping row
   * can record the pair). When omitted, AMS resolves the canonical current
   * architecture.
   */
  currentArchitectureId?: string;
}

/** Response from the mark-decommissioned write. */
export interface MarkDecommissionedResponse {
  /** Newly-inserted target-side element id. */
  targetElementId: string;
  /** Newly-inserted mapping row id. */
  mappingId: string;
}

/** Row in the unmapped-current-elements response. */
export interface UnmappedCurrentElement {
  elementId: string;
  elementType: string;
  name: string;
}

/** Promote response (also used for dry-run preview). */
export interface PromoteTargetArchitectureResponse {
  architecture: TargetArchitectureDto;
  previousActiveId: string | null;
  specsMarkedStale: number;
}

/**
 * Read-only mapping-suggest candidate returned by the gateway. AMS produces
 * the deterministic name-similarity list; the gateway reranks it via a small
 * LLM call (enabled by default since 2026-06-11, fail-soft back to the
 * deterministic order; `TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK=0` opts out).
 * The LLM may refine `confidence` and `rationale` on the way through.
 */
export interface MappingSuggestCandidate {
  elementId: string;
  elementType: string | null;
  name: string | null;
  confidence: number | null;
  rationale: string | null;
}

/**
 * Target-side element snapshot sent to mapping-suggest. The current
 * read-only path only consults `name`; the other fields are reserved for the
 * LLM rerank.
 */
export interface MappingSuggestTargetSnapshot {
  name: string | null;
  elementType?: string | null;
  description?: string | null;
}

/** Body for mapping-suggest. */
export interface MappingSuggestRequest {
  /** Target-side element id (null when the user has not yet saved). */
  targetElementId?: string | null;
  targetElementSnapshot: MappingSuggestTargetSnapshot;
}

/**
 * Lists current-architecture elements that have no mapping into the
 * project's active target. Powers the right-side warning panel in the
 * authoring workspace.
 *
 * Calls `GET /api/projects/{projectId}/architectures/{archId}/unmapped-current-elements`.
 */
export async function listUnmappedCurrentElements(
  projectId: string,
  architectureId: string,
  targetArchitectureId?: string | null,
): Promise<UnmappedCurrentElement[]> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/unmapped-current-elements` +
    (targetArchitectureId
      ? `?targetArchitectureId=${encodeURIComponent(targetArchitectureId)}`
      : '');
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  const wire = (await res.json()) as UnmappedCurrentElement[];
  return wire ?? [];
}

/**
 * Marks a current-architecture element as decommissioned by writing a new
 * target-side row + a `mapping_type='decommissioned'` mapping in a single
 * atomic AMS call.
 *
 * Calls `POST /api/projects/{projectId}/target-architectures/{targetArchId}/decommission`.
 */
export async function markCurrentElementDecommissioned(
  projectId: string,
  targetArchitectureId: string,
  payload: MarkDecommissionedRequest,
): Promise<MarkDecommissionedResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/decommission`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as MarkDecommissionedResponse;
}

/**
 * Fetches up to three current-architecture candidate mappings ranked by
 * name similarity. Read-only; AMS persists nothing.
 *
 * Calls `POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest`.
 *
 * The LLM hint chip in the add-element inline expansion uses this to surface
 * a suggestion to the user. The suggestion is NEVER auto-applied -- the user
 * must explicitly click the chip to populate the mapping picker.
 */
export async function mappingSuggest(
  projectId: string,
  architectureId: string,
  payload: MappingSuggestRequest,
): Promise<MappingSuggestCandidate[]> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/mapping-suggest`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  const body = (await res.json()) as { candidates?: MappingSuggestCandidate[] };
  return body.candidates ?? [];
}

/**
 * Promote a draft target architecture to active. When `dryRun=true` AMS
 * returns the impact-preview (count of specs that WOULD be marked stale)
 * WITHOUT committing the transition. The promote-to-active confirm modal
 * calls this twice:
 *   1. with `dryRun=true` to render the impact preview line BEFORE the user
 *      confirms,
 *   2. without `dryRun` to commit on confirm.
 *
 * Calls `POST /api/projects/{projectId}/target-architectures/{id}/promote[?dryRun=true]`.
 */
export async function promoteTargetArchitecture(
  projectId: string,
  targetArchId: string,
  options?: { dryRun?: boolean },
): Promise<PromoteTargetArchitectureResponse> {
  const dryRun = !!options?.dryRun;
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchId)}/promote` +
    (dryRun ? '?dryRun=true' : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  const wire = (await res.json()) as {
    architecture: TargetArchitectureWireDto;
    previousActiveId: string | null;
    specsMarkedStale: number;
  };
  return {
    architecture: mapTargetArchitectureWireToDto(wire.architecture),
    previousActiveId: wire.previousActiveId ?? null,
    specsMarkedStale: wire.specsMarkedStale ?? 0,
  };
}

// ============================================================================
// Group 8 additions (residual): decommissioned-in-target annotations
// (read-only) used by the compare view.
//
// Note: The Group 8 LLM "suggest-target-architecture" one-shot stack was
// removed in spec 2026-05-24 (Task Group 4.2) -- the deterministic
// `suggestTargetFromCurrent` below replaces it. The decommissioned-in-target
// annotations endpoint remains in service and powers the compare view chips.
// ============================================================================

/**
 * Reason discriminator surfaced on each
 * `DecommissionedInTargetAnnotation` row. Mirrors the AMS-side constants
 * defined on `DecommissionedInTargetAnnotationDto` -- if the AMS layer
 * adds a new reason later, this union widens by hand at the boundary.
 */
export type DecommissionedInTargetReason =
  | 'no-mapping-to-active-target'
  | 'all-mappings-decommissioned';

/**
 * Derived annotation row returned by
 * `GET /api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations`.
 *
 * The compare view groups these annotations alongside the current-side
 * rows so the user can see "this current element has no equivalent in the
 * target" inline with the matched-pair rows. The reason discriminator
 * lets the UI render different copy depending on whether the absence is
 * because there is no mapping at all vs. every mapping points at a
 * decommissioned target element.
 */
export interface DecommissionedInTargetAnnotation {
  elementId: string;
  elementType: string;
  name: string;
  reason: DecommissionedInTargetReason;
}

/**
 * Fetches the derived "decommissioned in target" annotations for a
 * current-architecture. Powers the compare-view chips per task 8.4.
 *
 * Calls
 * `GET /api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations`
 * (proxied through gateway -> AMS).
 *
 * Read-only: AMS persists nothing.
 */
export async function listDecommissionedInTargetAnnotations(
  projectId: string,
  currentArchitectureId: string,
  targetArchitectureId?: string | null,
): Promise<DecommissionedInTargetAnnotation[]> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(currentArchitectureId)}` +
    `/decommissioned-in-target-annotations` +
    (targetArchitectureId
      ? `?targetArchitectureId=${encodeURIComponent(targetArchitectureId)}`
      : '');
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  const wire = (await res.json()) as DecommissionedInTargetAnnotation[];
  return wire ?? [];
}

// ============================================================================
// Spec 2026-05-24: Target State Sub-tab + Deterministic Suggest
// (Task Group 2, sub-task 2.1 -- client function consumed by Task Group 4)
// ============================================================================

/**
 * Request body for `POST /api/projects/{projectId}/target-architectures/suggest-from-current`.
 *
 * Wire shape mirrors the AMS `SuggestFromCurrentRequest` record (which carries
 * the `@JsonNaming(LowerCamelCaseStrategy.class)` annotation per the
 * selective-copy DTO pattern). The gateway proxy is a pure pass-through, so
 * the camelCase contract here matches AMS exactly.
 */
export interface SuggestFromCurrentRequest {
  /**
   * The current architecture id to clone, captured at click time on the
   * client so a mid-flight architecture switch cannot redirect the clone to
   * the wrong source. AMS uses ONLY this value for source attribution; any
   * "active architecture" header / session value is ignored server-side.
   */
  currentArchitectureId: string;
}

/**
 * Response body for `POST /api/projects/{projectId}/target-architectures/suggest-from-current`.
 *
 * Mirrors the AMS `SuggestFromCurrentResponse` record. Used by the frontend
 * to (a) auto-select the new draft in the Drafts panel via `newDraftId` and
 * (b) optionally surface `resolvedName` inline (handy when the same-day
 * suffix kicks in: `"Target State - Suggested 2026-05-24 (2)"`).
 */
export interface SuggestFromCurrentResponse {
  /** Id of the freshly-created target draft. */
  newDraftId: string;
  /**
   * The auto-resolved draft name (e.g. `"Target State - Suggested 2026-05-24"`
   * or with a `" (2)"` suffix when a same-day collision was resolved).
   */
  resolvedName: string;
  /** Count of elements cloned in Phase 2 of the AMS service. */
  clonedElementCount: number;
  /**
   * Count of `architecture_element_mappings` rows written in Phase 3. Equal
   * to `clonedElementCount` on success.
   */
  mappingRowCount: number;
}

/**
 * Calls the deterministic "Suggest target architecture from current"
 * endpoint. Replaces the broken May-20 LLM Suggest path entirely -- there is
 * no LLM in the loop, no streaming, no per-element fan-out from the gateway.
 *
 * Endpoint (gateway -> AMS):
 *   `POST /api/projects/{projectId}/target-architectures/suggest-from-current`
 *
 * The AMS service:
 *   1. Loads the current architecture by id and rejects with HTTP 422
 *      (`{code: "empty_current_architecture"}`) if it has zero in-scope
 *      elements.
 *   2. Deep-clones every meta-model entity (applications, components,
 *      services, interfaces, endpoints, data entities + attributes,
 *      infrastructure nodes, etc.) into a new `kind='target'`,
 *      `draft_state='draft'` row whose name auto-resolves to
 *      `"Target State - Suggested YYYY-MM-DD"` (with same-day numeric
 *      suffix on collision).
 *   3. Writes one `architecture_element_mappings` row per cloned element
 *      with `mapping_type='equivalent'`, `status='confirmed'`,
 *      `confidence=1.0`, `created_by_task='target-state-suggest'`, all in
 *      the same `@Transactional` boundary as the clone.
 *
 * Error contract (round-tripped verbatim by the gateway proxy):
 *   - 422 `{code: "empty_current_architecture", message: "Current architecture
 *     has no elements to suggest from"}` -- nothing to clone.
 *   - 409 `{code: "recent_duplicate_suggest", ...}` -- server-side
 *     5-second double-click guard fired (a draft with the resolved
 *     auto-name was created within the last 5 seconds).
 *   - 404 -- the supplied `currentArchitectureId` does not belong to the
 *     project.
 *
 * Callers should branch on `error.body.code` to surface the right toast.
 *
 * Spec: 2026-05-24 Target State Sub-tab + Deterministic Suggest --
 * Task Group 2 (sub-task 2.1, gateway proxy + client function) and
 * Task Group 4 (Suggest button rewire consumes this function).
 */
export async function suggestTargetFromCurrent(
  projectId: string,
  body: SuggestFromCurrentRequest,
): Promise<SuggestFromCurrentResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/suggest-from-current`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as SuggestFromCurrentResponse;
}
