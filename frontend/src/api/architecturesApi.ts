/**
 * Architectures API Client
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   Initial GET /api/projects/{projectId}/architectures (listArchitectures).
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *   Adds the three CRUD mutation functions:
 *     - createArchitecture(projectId, payload)
 *     - updateArchitecture(projectId, architectureId, payload)
 *     - archiveArchitecture(projectId, architectureId)
 *   plus the typed `ArchitecturesApiError` so modal callers can branch on
 *   `error.status === 409` / `422` / etc. for inline error rendering (e.g.
 *   the duplicate-name message rendered next to the Name field in
 *   `EditArchitectureModal`).
 *
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 5
 *   Adds `cloneArchitecture(projectId, sourceArchitectureId, payload)` for the
 *   new Clone workflow. Mirrors the shape and error-handling semantics of
 *   `createArchitecture` -- on non-2xx the helper throws `ArchitecturesApiError`
 *   so the upcoming `CloneArchitectureModal` can branch on:
 *     - 409 `duplicate_name` -> inline error under the Name field.
 *     - 422 `archived_source` -> footer error banner.
 *     - 400 validation        -> footer error banner with the server message.
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy (Spec #7) -- Task Group 6
 *   Adds three new helpers powering the Selective Copy wizard:
 *     - getElementsInventory(projectId, architectureId) -- read-only meta
 *       endpoint backing the picker tree.
 *     - selectiveCopyPreflight(projectId, targetArchitectureId, payload) --
 *       returns conflicts + auto-included + summary; no state mutation.
 *     - selectiveCopyCommit(projectId, targetArchitectureId, payload) --
 *       performs the atomic transactional copy; returns counts for the
 *       post-copy toast.
 *
 *   Each throws `ArchitecturesApiError` on non-2xx so the wizard can branch on:
 *     - 422 `archived_source`     -> footer error banner.
 *     - 422 `same_architecture`   -> footer error banner (defence-in-depth).
 *     - 422 `missing_reference`   -> footer error banner (un-tick of an
 *       auto-included element).
 *     - 400 validation            -> footer error banner with the server message.
 *     - 404                       -> generic footer error message.
 *
 *   Typed response interfaces mirror the gateway's
 *   `architectureModelClient.ts` types field-for-field (camelCase wire shape).
 *
 * The modal UX in groups 4-7 depends on:
 *   - Status code preserved on the thrown error (so 409 vs 422 vs other
 *     can be branched on).
 *   - The parsed JSON error envelope (`{code, field?, message}`) preserved
 *     verbatim from the gateway / backend.
 *
 * Follows the established `modelApi.ts` pattern: plain fetch() with API_BASE
 * env variable. The endpoints are routed through the existing Vite /api/
 * catch-all proxy to architecture-model-service on port 8080 in dev, and
 * through the gateway in production.
 */

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Architecture DTO returned by the list and CRUD endpoints.
 *
 * Mirrors the shape of architecture-model-service's `ArchitectureDto`
 * (a Java record). Tags are surfaced as a flat string list mapped from
 * the ArchitectureTagEntity join table.
 */
export interface Architecture {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Error envelope returned by the gateway / backend for non-2xx responses on
 * the architectures CRUD endpoints. Fields are optional because:
 *   - 409 Conflict: `{code: "duplicate_name", field: "name", message: "..."}`
 *   - 422 Unprocessable Entity: `{code: "last_architecture", message: "..."}`
 *     or `{code: "archived_source", message: "..."}` (spec #6 Clone)
 *     or `{code: "same_architecture", message: "..."}` (spec #7 Selective Copy)
 *     or `{code: "missing_reference", message: "..."}` (spec #7 Selective Copy)
 *   - 400 Bad Request: `{message: "..."}` (and optional field-level details)
 *   - 404 Not Found: may be empty
 */
export interface ArchitecturesApiErrorBody {
  code?: string;
  field?: string;
  message?: string;
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Typed error class thrown by the CRUD functions on non-2xx responses.
 * Modal callers branch on `error.status === 409` to render the
 * duplicate-name message inline next to the Name field, and on
 * `error.status === 422` for the last-architecture race condition.
 *
 * The raw response body is preserved on `body` so callers can read
 * `body.message` for inline display.
 */
export class ArchitecturesApiError extends Error {
  readonly status: number;
  readonly body: ArchitecturesApiErrorBody;

  constructor(status: number, body: ArchitecturesApiErrorBody, message?: string) {
    super(message ?? body.message ?? `Architectures API error (status ${status})`);
    this.name = 'ArchitecturesApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Internal helper that parses a non-ok response into an
 * `ArchitecturesApiError`. Tolerates non-JSON bodies by falling back to
 * `{message: <statusText>}` so the modal layer can always render *some*
 * inline error.
 */
async function parseError(res: Response): Promise<ArchitecturesApiError> {
  let body: ArchitecturesApiErrorBody = {};
  try {
    body = (await res.json()) as ArchitecturesApiErrorBody;
  } catch {
    body = { message: res.statusText || `HTTP ${res.status}` };
  }
  return new ArchitecturesApiError(res.status, body);
}

/**
 * Lists all architectures for a project.
 *
 * Calls GET /api/projects/{projectId}/architectures and returns the array
 * (ordered by created_at ascending per the backend service contract).
 *
 * @param projectId - The project UUID
 * @returns Promise resolving to the array of Architecture DTOs
 * @throws Error if the HTTP request fails (non-ok status)
 */
export async function listArchitectures(projectId: string): Promise<Architecture[]> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to list architectures for project "${projectId}": ${res.status}`
    );
  }

  const data: Architecture[] = await res.json();
  return data;
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Payload accepted by `createArchitecture`. Description and tags are both
 * optional so the create modal can submit name-only.
 */
export interface CreateArchitecturePayload {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Payload accepted by `updateArchitecture`. PATCH replaces the full tag set
 * atomically -- empty array clears all tags. Description is required (may be
 * empty string) so the EditArchitectureModal's combined save is unambiguous.
 */
export interface UpdateArchitecturePayload {
  name: string;
  description?: string;
  tags: string[];
}

/**
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 5
 *
 * Payload accepted by `cloneArchitecture`. Mirrors `CreateArchitecturePayload`
 * because the Clone modal collects exactly the same three fields (name,
 * optional description, optional tags) -- defaults differ (`Copy of <source>`
 * for name, source description copied, tags empty), but the wire shape is
 * identical.
 */
export interface CloneArchitecturePayload {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Creates a new architecture in the given project.
 *
 * Calls POST /api/projects/{projectId}/architectures and returns the created
 * row (id, name, description, tags, archived: false, timestamps).
 *
 * On 409 (duplicate name) the rejection is surfaced as
 * `ArchitecturesApiError` with `body.code === "duplicate_name"` so the modal
 * can render the message inline next to the Name field.
 */
export async function createArchitecture(
  projectId: string,
  payload: CreateArchitecturePayload
): Promise<Architecture> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as Architecture;
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Updates an existing architecture. Combined edit: name + description +
 * tags are sent in a single payload and replace the previous values
 * atomically (empty `tags` array clears all tags).
 *
 * Calls PATCH /api/projects/{projectId}/architectures/{architectureId}
 * and returns the updated DTO.
 *
 * Errors are thrown as `ArchitecturesApiError` so the modal can branch on
 * `error.status` (409 duplicate name, 404 wrong project, 400 validation).
 */
export async function updateArchitecture(
  projectId: string,
  architectureId: string,
  payload: UpdateArchitecturePayload
): Promise<Architecture> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as Architecture;
}

/**
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 *
 * Archives (soft-deletes) an architecture. The server rejects with 422
 * `{code: "last_architecture"}` if this would leave the project with zero
 * non-archived architectures -- the `ArchiveArchitectureConfirmModal`
 * surfaces the message inline.
 *
 * Calls POST /api/projects/{projectId}/architectures/{architectureId}/archive
 * and returns the updated DTO with `archived: true`.
 */
export async function archiveArchitecture(
  projectId: string,
  architectureId: string
): Promise<Architecture> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/archive`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as Architecture;
}

/**
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 5
 *
 * Clones an existing architecture (and every architecture-scoped meta-model
 * row) into a brand-new architecture within the same project. The whole
 * clone is wrapped in a single backend `@Transactional` boundary, so the
 * frontend either gets the new architecture DTO back (201) or a clean
 * error envelope -- there is no partial-clone state to reconcile.
 *
 * Calls POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone
 * and returns the newly-created Architecture DTO (same shape as
 * `createArchitecture`'s response).
 *
 * Errors are thrown as `ArchitecturesApiError` so `CloneArchitectureModal`
 * (Group 6) can branch on:
 *   - 409 `duplicate_name`  -> inline error under the Name field.
 *   - 422 `archived_source` -> footer error banner (rare path: UI hides
 *     archived rows but a stale frontend / race could still hit it).
 *   - 400 validation        -> footer error banner with the server message.
 *   - other                 -> generic footer error message.
 *
 * The error envelope round-trips byte-for-byte from
 * architecture-model-service through the gateway proxy (Group 4), so
 * `error.body.code` and `error.body.field` are reliable for branching.
 */
export async function cloneArchitecture(
  projectId: string,
  sourceArchitectureId: string,
  payload: CloneArchitecturePayload
): Promise<Architecture> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(sourceArchitectureId)}/clone`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as Architecture;
}

// ============================================================================
// Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
// (Spec #7) -- Task Group 6
//
// Selective Copy types + three new helpers:
//   - getElementsInventory(projectId, architectureId)
//   - selectiveCopyPreflight(projectId, targetArchitectureId, payload)
//   - selectiveCopyCommit(projectId, targetArchitectureId, payload)
//
// Types mirror the gateway's `architectureModelClient.ts` field-for-field
// (camelCase wire shape) so the same JSON object travels frontend ->
// gateway -> backend without any transformation in the middle.
// ============================================================================

/**
 * One leaf instance in the element inventory tree.
 *
 * `archived` is optional because architecture-scoped element rows do not have
 * an archived flag in V1 (only the architecture itself can be archived); the
 * field is present in the contract for future-proofing per the spec.
 */
export interface ElementInventoryInstance {
  id: string;
  name: string;
  archived?: boolean;
}

/** A grouping of instances by entity type within a domain. */
export interface ElementInventoryType {
  name: string;
  /**
   * The backend entity type identifier (e.g. `application`, `data_entity`).
   * Optional in this typing to remain tolerant of older / minimal payloads;
   * always populated by the spec'd backend response.
   */
  entityType?: string;
  instances: ElementInventoryInstance[];
}

/**
 * One of the six canonical domains: Applications, Data, Business, UI,
 * Behavioural, Diagrams (in that order per spec).
 */
export interface ElementInventoryDomain {
  name: string;
  types: ElementInventoryType[];
}

/**
 * Response shape from
 * `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`.
 *
 * Powers the `SelectiveCopyElementPicker` tree (Spec #7 frontend Group 7).
 */
export interface ElementInventoryResponse {
  domains: ElementInventoryDomain[];
}

/**
 * Request body for
 * `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight`.
 *
 * `elementIds` is the user's raw selection from the picker tree; the backend
 * runs smart cascading to compute auto-included elements + same_uuid conflicts.
 */
export interface SelectiveCopyPreflightRequest {
  sourceArchitectureId: string;
  elementIds: string[];
}

/**
 * One conflict reported by preflight.
 *
 * `conflictReason` is a discriminated string so future variants (e.g. name
 * collision) can extend the enum without breaking the contract per the spec.
 * `referencedBy` lists parent elements that pulled this one in via cascading
 * (only populated when the conflict relates to a referenced/auto-included
 * element).
 */
export interface SelectiveCopyConflict {
  elementId: string;
  elementType: string;
  name: string;
  conflictReason: 'same_uuid' | 'missing_reference';
  referencedBy?: string[];
}

/**
 * One auto-included element reported by preflight.
 *
 * `includedBecause` carries the parent element's name so the picker tree can
 * render the `auto-included` badge tooltip ("Auto-included because referenced
 * by <parent>").
 */
export interface SelectiveCopyAutoIncluded {
  elementId: string;
  elementType: string;
  name: string;
  includedBecause: string;
}

/** Aggregate counts surfaced in the preflight summary header. */
export interface SelectiveCopyPreflightSummary {
  totalSelected: number;
  conflictCount: number;
  autoIncludedCount: number;
  willCopyCount: number;
}

/**
 * Response body from the preflight endpoint. No state mutation occurs --
 * preflight is read-only per the spec.
 */
export interface SelectiveCopyPreflightResponse {
  conflicts: SelectiveCopyConflict[];
  autoIncluded: SelectiveCopyAutoIncluded[];
  summary: SelectiveCopyPreflightSummary;
}

/**
 * One per-element resolution decision sent to the commit endpoint.
 *
 * Defaults to `skip` on the frontend (safest non-destructive action). The
 * three actions match the backend's `ArchitectureSelectiveCopyService.commit`
 * branch logic exactly.
 */
export interface SelectiveCopyResolution {
  elementId: string;
  action: 'skip' | 'overwrite' | 'duplicate';
}

/**
 * Request body for
 * `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit`.
 *
 * `elementIds` mirrors the preflight selection; `resolutions` carries the
 * per-conflict decisions. Backend re-runs preflight defence-in-depth and
 * refuses with 422 `missing_reference` if the user un-ticked an auto-included
 * element (per the spec).
 */
export interface SelectiveCopyCommitRequest {
  sourceArchitectureId: string;
  elementIds: string[];
  resolutions: SelectiveCopyResolution[];
  /**
   * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
   *
   * When `true`, AMS writes one `equivalent` mapping per element actually
   * copied under the same `@Transactional` boundary as the copy itself. The
   * response then carries `createdMappingCount`. Default `false` preserves
   * the existing pure copy behaviour for spec #7's `Copy from…` button.
   */
  autoMap?: boolean;
}

/**
 * Response body from the commit endpoint. Counts feed the post-copy toast
 * ("Copied N elements from <source.name> (skipped: X, overwrote: Y,
 * duplicated: Z)") on the frontend.
 */
export interface SelectiveCopyCommitResponse {
  copied: number;
  skipped: number;
  overwritten: number;
  duplicated: number;
  autoIncluded: number;
  /**
   * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
   *
   * Number of `architecture_element_mappings` rows AMS wrote in the same
   * transaction as the copy. Always `0` when the request omitted `autoMap`
   * or set it to `false`.
   */
  createdMappingCount: number;
}

/**
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 6
 *
 * Fetches the element inventory for an architecture (the read-only meta
 * endpoint backing the picker tree).
 *
 * Calls
 * `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`
 * and returns the parsed `ElementInventoryResponse` on 2xx.
 *
 * Errors are thrown as `ArchitecturesApiError` so the wizard can branch on:
 *   - 404 -- architecture not found within the project.
 *   - other -- generic footer error message.
 */
export async function getElementsInventory(
  projectId: string,
  architectureId: string
): Promise<ElementInventoryResponse> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/elements-inventory`;

  const res = await fetch(url);

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as ElementInventoryResponse;
}

/**
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 6
 *
 * Runs the preflight phase of a selective copy. No state mutation occurs;
 * the response carries the conflict + auto-include + summary information
 * the wizard needs to render its resolution screen.
 *
 * Calls
 * `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight`
 * and returns the parsed `SelectiveCopyPreflightResponse` on 2xx.
 *
 * Errors are thrown as `ArchitecturesApiError` so the wizard can branch on:
 *   - 422 `archived_source`     -> footer error banner.
 *   - 422 `same_architecture`   -> footer error banner (defence-in-depth).
 *   - 404                       -> generic footer error message.
 *   - 400 validation            -> footer error banner with the server message.
 *   - other                     -> generic footer error message.
 */
export async function selectiveCopyPreflight(
  projectId: string,
  targetArchitectureId: string,
  payload: SelectiveCopyPreflightRequest
): Promise<SelectiveCopyPreflightResponse> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(targetArchitectureId)}/selective-copy/preflight`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as SelectiveCopyPreflightResponse;
}

/**
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 6
 *
 * Runs the commit phase of a selective copy. The whole copy is wrapped in
 * a single backend `@Transactional` boundary, so the frontend either gets
 * the success counts back (200) or a clean error envelope -- there is no
 * partial-copy state to reconcile.
 *
 * Calls
 * `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit`
 * and returns the parsed `SelectiveCopyCommitResponse` on 2xx. Counts feed
 * the post-copy toast ("Copied N elements from <source.name> (skipped: X,
 * overwrote: Y, duplicated: Z)").
 *
 * Errors are thrown as `ArchitecturesApiError` so the wizard can branch on:
 *   - 422 `archived_source`     -> footer error banner.
 *   - 422 `same_architecture`   -> footer error banner (defence-in-depth).
 *   - 422 `missing_reference`   -> footer error banner explaining the user
 *                                  un-ticked an auto-included element.
 *   - 404                       -> generic footer error message.
 *   - 400 validation            -> footer error banner with the server message.
 *   - other                     -> generic footer error message.
 */
export async function selectiveCopyCommit(
  projectId: string,
  targetArchitectureId: string,
  payload: SelectiveCopyCommitRequest
): Promise<SelectiveCopyCommitResponse> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(targetArchitectureId)}/selective-copy/commit`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as SelectiveCopyCommitResponse;
}


// ============================================================================
// Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
//
// Architecture Element Mapping types + four typed wrappers:
//   - listArchitectureMappings(projectId, filters?)
//   - createArchitectureMapping(projectId, body)
//   - updateArchitectureMapping(projectId, mappingId, body)
//   - deleteArchitectureMapping(projectId, mappingId)
//
// Types mirror the gateway architectureModelClient.ts (which in turn mirrors
// the AMS DTO) field-for-field. confidence is `number | null` on the wire
// because it is a boxed Double on the JPA entity per the
// project_primitive_double_dto_overwrite.md lesson -- a primitive double
// silently wipes to 0 on PATCH semantics.
// ============================================================================

/**
 * v1 allowed mapping_type values, validated server-side. The string union is
 * intentionally narrow so misuse on the manual-add row gets caught at compile
 * time on the frontend; the server is still the source of truth.
 *
 * `retired` and `new_in_target` are deferred to v2 (mappings without one
 * endpoint), per the spec Out of Scope section.
 */
export type MappingType =
  | 'equivalent'
  | 'renamed'
  | 'replaced_by'
  | 'split'
  | 'merged'
  | 'manual_review_required';

/**
 * v1 allowed status values, validated server-side. Same compile-time-narrow
 * pattern as MappingType.
 */
export type MappingStatus = 'confirmed' | 'proposed' | 'needs_review' | 'rejected';

/**
 * Optional filter object accepted by listArchitectureMappings. Mirrors the
 * AMS controller @RequestParam set 1:1; undefined fields are omitted from
 * the upstream querystring (see buildArchitectureMappingFilterQuery).
 *
 * `q` is a free-text substring search executed server-side across the source
 * and target element ids and the notes column.
 */
export interface ArchitectureMappingFilters {
  sourceArchitectureId?: string;
  targetArchitectureId?: string;
  sourceElementType?: string;
  targetElementType?: string;
  mappingType?: string;
  status?: string;
  q?: string;
}

/**
 * Response shape for the architecture-mapping endpoints.
 *
 * Mirrors ArchitectureElementMappingDto in AMS field-for-field (camelCase
 * wire shape). confidence is `number | null` because the entity column is a
 * boxed Double -- nullable round-trip MUST be preserved through every layer
 * (per project_primitive_double_dto_overwrite.md). notes is similarly
 * nullable.
 */
export interface ArchitectureElementMappingDto {
  id: string;
  projectId: string;
  sourceArchitectureId: string;
  targetArchitectureId: string;
  sourceElementType: string;
  sourceElementId: string;
  targetElementType: string;
  targetElementId: string;
  mappingType: MappingType;
  status: MappingStatus;
  createdByTask: string;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  confidence: number | null;
}

/**
 * Request body for createArchitectureMapping (manual-add path from the
 * Mapping Review modal). The server sets id, createdAt, updatedAt, and
 * createdByTask=mapping-review-modal-add -- callers do NOT send those.
 *
 * confidence and notes are optional and default to null on the server.
 * Per the spec, the manual-add UI MUST default confidence to null (NOT
 * 1.0); the auto-map path is the only path that asserts 1.0.
 */
export interface CreateArchitectureElementMappingRequest {
  sourceArchitectureId: string;
  targetArchitectureId: string;
  sourceElementType: string;
  sourceElementId: string;
  targetElementType: string;
  targetElementId: string;
  mappingType: MappingType;
  status: MappingStatus;
  notes?: string | null;
  confidence?: number | null;
}

/**
 * Request body for updateArchitectureMapping. Only the four mutable fields
 * are accepted by the AMS service; all four are nullable so a PATCH that
 * omits confidence does NOT silently wipe the existing value.
 *
 * created_by_task is set server-side to mapping-review-modal-edit on every
 * PUT -- it is never sent through this endpoint.
 */
export interface UpdateArchitectureElementMappingRequest {
  mappingType?: MappingType;
  status?: MappingStatus;
  notes?: string | null;
  confidence?: number | null;
}

/**
 * Builds a querystring from an ArchitectureMappingFilters object. Omits
 * undefined / null / empty-string values defensively so the upstream URL
 * stays clean. Mirrors the gateway helper of the same name.
 */
function buildArchitectureMappingFilterQuery(
  filters: ArchitectureMappingFilters | undefined
): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
 *
 * Lists architecture element mappings for a project. The optional filter
 * object narrows the result by source/target architecture, element type,
 * mapping type, status, and free-text q (server-side substring search
 * across source/target element ids and notes).
 *
 * Calls
 * GET /api/projects/{projectId}/architecture-mappings[?...]
 * and returns the parsed ArchitectureElementMappingDto[] on 2xx.
 *
 * Throws ArchitecturesApiError on any non-2xx so the wizard / Mapping
 * Review surface can branch on body.code (e.g. surface a generic error
 * banner; the list endpoint does not currently surface coded errors but
 * the envelope is preserved verbatim from the gateway / AMS).
 */
export async function listArchitectureMappings(
  projectId: string,
  filters?: ArchitectureMappingFilters
): Promise<ArchitectureElementMappingDto[]> {
  const qs = buildArchitectureMappingFilterQuery(filters);
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings${qs}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as ArchitectureElementMappingDto[];
}

/**
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
 *
 * Creates a single architecture element mapping (manual-add path from the
 * Mapping Review modal).
 *
 * Calls
 * POST /api/projects/{projectId}/architecture-mappings
 * and returns the parsed ArchitectureElementMappingDto on 201.
 *
 * Throws ArchitecturesApiError on any non-2xx, notably:
 *   - 422 {code: "duplicate_mapping"} -- unique-constraint violation; the
 *     Mapping Review modal surfaces an inline error message.
 *   - 400 validation -- generic inline error.
 */
export async function createArchitectureMapping(
  projectId: string,
  body: CreateArchitectureElementMappingRequest
): Promise<ArchitectureElementMappingDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as ArchitectureElementMappingDto;
}

/**
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
 *
 * Updates the four mutable fields (mappingType, status, notes, confidence)
 * of an existing mapping. The server sets
 * createdByTask=mapping-review-modal-edit on every PUT and bumps updatedAt
 * via @PreUpdate.
 *
 * Calls
 * PUT /api/projects/{projectId}/architecture-mappings/{mappingId}
 * and returns the parsed ArchitectureElementMappingDto on 200.
 *
 * Throws ArchitecturesApiError on any non-2xx (404 not found, 400
 * validation, etc).
 */
export async function updateArchitectureMapping(
  projectId: string,
  mappingId: string,
  body: UpdateArchitectureElementMappingRequest
): Promise<ArchitectureElementMappingDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings/${encodeURIComponent(mappingId)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return (await res.json()) as ArchitectureElementMappingDto;
}

/**
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
 *
 * Hard-deletes a mapping row in v1 (no soft-delete column).
 *
 * Calls
 * DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}
 * and resolves to void on 204.
 *
 * Throws ArchitecturesApiError on any non-2xx (404 not found, etc).
 */
export async function deleteArchitectureMapping(
  projectId: string,
  mappingId: string
): Promise<void> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings/${encodeURIComponent(mappingId)}`;

  const res = await fetch(url, { method: 'DELETE' });

  if (!res.ok) {
    throw await parseError(res);
  }
}
