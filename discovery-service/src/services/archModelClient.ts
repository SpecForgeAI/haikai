import axios, { AxiosInstance, AxiosError } from 'axios';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import { EvidenceCluster, ClusterMember } from '../types/cluster';
import { DiscoveryCandidate } from '../types/candidate';
import { DecisionTask } from '../types/decisionTask';
import { getRunArchitectureId } from './runArchitectureRegistry';

/**
 * Response shape from the discovery run endpoints
 * in the architecture-model-service.
 */
export interface DiscoveryRunResponseDto {
  id: string;
  project_id: string;
  service_id: string | null;
  /**
   * V3 pipeline computed tier (A/B/C) persisted on the run row.
   * Null for pre-V3 / pre-migration rows.
   * Spec: V3 Discovery Pipeline Foundation.
   */
  mode: string | null;
  /**
   * V3 tier derived from `mode` by the Java DTO (single-char `A|B|C` or null).
   * Duplicates `mode` for API consumer clarity.
   * Spec: V3 Tier UX.
   */
  tier?: string | null;
  /**
   * JSON-encoded `string[]` of tier warnings synthesized by the discovery-service
   * gate and persisted verbatim. Null when absent.
   * Spec: V3 Tier UX.
   */
  warnings?: string | null;
  /**
   * Advisory run-integrity `degraded` flag (Spec 2026-05-30 Oracle Integrity &
   * Determinism). TRUE when the run COMPLETED but the captured model may be
   * partial; rides alongside `status`. Null when absent (legacy / not computed).
   */
  degraded?: boolean | null;
  /**
   * JSON-encoded `string[]` of the reasons `degraded` tripped, passed through
   * verbatim. Null when absent. Spec: Oracle Integrity & Determinism.
   */
  degraded_reasons?: string | null;
  /**
   * TRUE when the run is an explicit Tier C LLM-solo opt-in (operator supplied
   * `confirmLlmSolo: true`); FALSE otherwise.
   * Spec: V3 Tier UX.
   */
  confirmed_llm_solo?: boolean | null;
  status: string;
  current_step: string | null;
  config_snapshot: object;
  steps_payload: object;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The architecture this run is bound to for life. Persisted by
   * architecture-model-service Spec #4 Group 1 changeset 095.
   * Discovery-service code reads this to resolve the architectureId for
   * URL construction when the in-process binding is absent (e.g. after a
   * process restart).
   */
  architecture_id?: string | null;
  /**
   * Run kind: `'code'` (V3 code/log pipeline) or `'database'` (DB pack
   * pipeline). Persisted by AMS (Spec 2026-05-16 Database Discovery Packs, D3);
   * AMS defaults to `'code'` when the column is absent. `'combined'` is in the
   * type-union for forward-compat but is never produced today. Read by the
   * deterministic review-model endpoint to classify each selected run's scan
   * kind (Spec 1 — Deterministic Review Model + Cascade/Dependency Graph).
   */
  discovery_kind?: 'code' | 'database' | 'combined' | null;
}

/**
 * Response shape from the discovery config endpoints
 * in the architecture-model-service.
 */
export interface DiscoveryConfigResponseDto {
  id: string;
  project_id: string;
  service_id: string | null;
  config_payload: object;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Response shape for a service entity from the architecture-model-service.
 * All fields use snake_case to match the Jackson property-naming-strategy.
 *
 * Spec: Service-Scoped Discovery (TG5)
 */
export interface ServiceResponseDto {
  id: string;
  name: string;
  description: string | null;
  application_id: string | null;
  app_component_id: string | null;
  service_type: string | null;
  core_tech: string | null;
  repo_location: string | null;
  repo_subfolder: string | null;
  tags: string | null;
  valid_from: string | null;
  valid_to: string | null;
  package_set_id: string | null;
  is_internal: boolean | null;
  /**
   * Structured resolver response persisted as jsonb. Holds
   * `{ language, frameworks, confirmationSentence, repoCrossCheck, ... }`
   * verbatim from `POST /discovery/tech-hints/resolve`. NULL when the
   * service has never been resolved (pre-migration / new row).
   * Spec: 2026-04-20 Tech Hints LLM Resolution.
   */
  core_tech_resolved: Record<string, unknown> | null;
  /**
   * Denormalised language pack id (e.g. `'java-21'`) used by the V3 tier
   * gate to decide tier A/B without walking the jsonb map. NULL = no
   * matching language pack.
   */
  core_tech_language_pack: string | null;
  /**
   * Denormalised framework pack ids (e.g. `['spring-boot-3']`) used by
   * the V3 tier gate to decide tier A vs B. Empty array allowed; NULL
   * means the service has never been resolved.
   */
  core_tech_framework_packs: string[] | null;
  /**
   * Five-value confidence enum emitted by the resolver:
   * `'high' | 'low' | 'none' | 'tech-only' | 'manual-override'`.
   * NULL means unresolved.
   */
  core_tech_resolution_confidence: string | null;
  /**
   * ISO-8601 timestamp set by architecture-model-service when the resolved
   * columns were last written. Used frontend-side to compute staleness
   * against subsequent edits of `core_tech` / `repo_location` / `repo_subfolder`.
   */
  core_tech_resolved_at: string | null;
}

/**
 * Response shape for an application entity from the architecture-model-service.
 * Contains the minimum fields needed to build LLM service context.
 *
 * Spec: Service-Scoped Discovery (TG5)
 */
export interface ApplicationResponseDto {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
}

/**
 * Response shape for an application component entity from the
 * architecture-model-service. Contains the minimum fields needed
 * to build LLM service context.
 *
 * Spec: Service-Scoped Discovery (TG5)
 */
export interface AppComponentResponseDto {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
}

/**
 * Response shape for an architecture entity from the architecture-model-service.
 * Mirrors the `ArchitectureResponseDto` Java DTO (snake_case via Jackson).
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing — discovery-service Task Group 5.
 * Used by {@link ArchModelClient.resolveDefaultArchitectureId} to pick the
 * project's `Default` architecture (oldest non-archived).
 */
export interface ArchitectureResponseDto {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Library DTO — mirrors the LibraryDto Java DTO (snake_case).
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 4.
 */
export interface LibraryDto {
  id: string;
  name: string;
  ecosystem: string;
  repo_location?: string | null;
  repo_subfolder?: string | null;
  source_origin?: string | null;
  source_system?: string | null;
  source_reference?: string | null;
  last_verified_at?: string | null;
  generation_status?: string | null;
}

/**
 * CodeUnitDependency DTO — mirrors the CodeUnitDependencyDto Java DTO (snake_case).
 */
export interface CodeUnitDependencyDto {
  id: string;
  source_application_point_id: string;
  target_application_point_id: string;
  declared_name: string;
  declared_version?: string | null;
  declared_version_range?: string | null;
  scope: string;
  manifest_path: string;
  manifest_line?: number | null;
  evidence_source?: string | null;
  confidence?: number | null;
}

/**
 * Request body for POST /libraries (find-or-create).
 *
 * Source provenance fields are populated by the caller (typically
 * via the buildLibraryFindOrCreatePayload helper) to satisfy the
 * locked discovery-source contract:
 *   - source_origin = 'DISCOVERED'
 *   - source_system = 'discovery-service'
 *   - source_reference = <runId>
 *   - last_verified_at = now()
 *   - generation_status = 'completed'
 */
export interface LibraryFindOrCreateRequest {
  name: string;
  ecosystem: string;
  repo_location?: string | null;
  repo_subfolder?: string | null;
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  last_verified_at?: string;
  generation_status?: string;
}

export interface LibraryFindOrCreateResponse {
  id: string;
  derived_application_point_id: string;
  is_new: boolean;
  library: LibraryDto;
}

/**
 * ApplicationPoint DTO subset used by the by-target lookup + find-or-create
 * endpoints (Fix #5 -- synthetic-placeholder removal). Mirrors the
 * Java {@code ApplicationPointDto} record fields the discovery-service
 * needs; additive fields the discovery-service does not consume are
 * marked optional.
 */
export interface ApplicationPointDto {
  id: string;
  name?: string | null;
  description?: string | null;
  kind?: string | null;
  application_id?: string | null;
  application_component_id?: string | null;
  service_id?: string | null;
  interface_id?: string | null;
  target_type?: string | null;
  target_ref_id?: string | null;
  point_type?: string | null;
  tags?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
}

/**
 * Request body for POST /application-points (find-or-create).
 *
 * Identity tuple is (model_file_id, target_type, target_ref_id) -- model_file_id
 * is resolved server-side from the (projectId, architectureId) URL path.
 *
 * Fix #5 (synthetic-placeholder removal): the discovery-service uses this
 * to self-heal a missing AP for a Service or Library root before pushing a
 * source_application_point_id FK to code_unit_dependencies.
 */
export interface ApplicationPointFindOrCreateRequest {
  name?: string;
  description?: string | null;
  kind: string;
  target_type: string;
  target_ref_id: string;
  application_id?: string | null;
  application_component_id?: string | null;
  service_id?: string | null;
  interface_id?: string | null;
}

export interface ApplicationPointFindOrCreateResponse {
  id: string;
  is_new: boolean;
  application_point: ApplicationPointDto;
}


/**
 * Request body for POST /code-unit-dependencies (find-or-create).
 */
export interface CodeUnitDependencyFindOrCreateRequest {
  source_application_point_id: string;
  target_application_point_id: string;
  declared_name: string;
  declared_version?: string | null;
  declared_version_range?: string | null;
  scope: string;
  manifest_path: string;
  manifest_line?: number | null;
  evidence_source?: string;
  confidence?: number;
}

export interface CodeUnitDependencyFindOrCreateResponse {
  id: string;
  is_new: boolean;
  code_unit_dependency: CodeUnitDependencyDto;
}


/**
 * Optional additive fields accepted by {@link ArchModelClient.createDiscoveryRun}
 * so the discovery-service tier gate at `POST /discovery/runs` can pass the
 * computed V3 tier metadata through to archmodel in a single call.
 *
 * Spec: 2026-04-20 V3 Tier UX — Task Group 4. All fields are additive and
 * backward-compatible: existing callers that omit them continue to work.
 */
export interface CreateDiscoveryRunOptions {
  /**
   * V3 pipeline tier ('A' | 'B' | 'C' — single-char value) persisted on the
   * `mode` column. When omitted, archmodel stores NULL.
   */
  mode?: 'A' | 'B' | 'C';
  /**
   * Tier warnings synthesized at the gate. Serialized to a JSON-encoded
   * string before transmission so the Java `warnings TEXT` column stores
   * the raw JSON payload verbatim.
   */
  warnings?: string[];
  /**
   * TRUE only when tier C proceeded via the explicit opt-in; FALSE for
   * tier A/B and omitted/undefined cases.
   */
  confirmedLlmSolo?: boolean;
  /**
   * Optional six-field identity snapshot of the bound service taken at run
   * create time. Persisted by AMS into
   * `config_snapshot.serviceIdentitySnapshot` so an orphaned run (created
   * before the service was deleted, FK now NULL via ON DELETE SET NULL)
   * still carries enough information for the UI to render the original
   * service name plus a "Service deleted" chip.
   *
   * Captured only when the route already fetched the service for tier
   * computation (i.e. `serviceId` is non-null). Library-scoped and
   * project-scoped runs without a service skip the snapshot.
   *
   * Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
   */
  serviceIdentitySnapshot?: ServiceIdentitySnapshot;
  /**
   * Discovery kind: `'code'` (default — V3 code/log pipeline), `'database'`
   * (DB pack pipeline), or `'combined'` (future). Forwarded to AMS as
   * `discovery_kind`. AMS defaults to `'code'` when omitted.
   *
   * Spec: 2026-05-16 Database Discovery Packs (Sybase + PostgreSQL) -- D3.
   */
  discoveryKind?: 'code' | 'database' | 'combined';
}

/**
 * Six identifier-ish fields captured from `ServiceResponseDto` at run-create
 * time so an orphaned discovery run (its `service_id` FK nulled by the
 * `ON DELETE SET NULL` action from Liquibase changeset 126) still carries
 * enough identity for the UI surfaces to render the original service.
 *
 * Skip `description`, `tags`, and the resolved-tech columns -- they are not
 * identifier-like and would needlessly bloat the snapshot.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
 */
export interface ServiceIdentitySnapshot {
  serviceId: string;
  serviceName: string;
  serviceType: string | null;
  applicationId: string | null;
  repoLocation: string | null;
  repoSubfolder: string | null;
}


// =============================================================================
// Discovery Findings DTOs (Spec 2026-05-16 -- Task Group 4)
// =============================================================================
// Mirrors the Java DTO surface exposed by architecture-model-service under
// `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/
// runs/{runId}/findings`. Field names are camelCase here -- Jackson on the
// AMS side uses `property-naming-strategy: SNAKE_CASE`, so the HTTP payload
// is snake_case on the wire. The mapper helpers below translate between the
// two so the rest of the discovery-service can stay idiomatically camelCase.
//
// Per Spec F (2026-06-02), `review_status` defaults to `pending_review` on the
// AMS side and is OMITTED from the emit payload. Numeric PATCH-eligible fields
// are boxed (`number | null`) per `project_primitive_double_dto_overwrite.md`.
// =============================================================================

/**
 * Allowed values for `discovery_finding_links.target_type` in v1.
 * `work_item` and `api_behaviour_baseline` are documented future targets but
 * are NOT emitted in v1 (see spec). Source G `unsupported_pattern` is also
 * deferred per D4.
 */
export type DiscoveryFindingLinkTargetType =
  | 'discovery_candidate'
  | 'discovery_decision_task'
  | 'discovery_relationship'
  | 'discovery_evidence'
  | 'discovery_cluster'
  | 'architecture_element';

/**
 * Link payload included when creating a finding (inline shape) or when
 * calling the standalone `POST .../findings/{findingId}/links` endpoint.
 */
export interface DiscoveryFindingLinkPayload {
  linkType: string;
  targetType: DiscoveryFindingLinkTargetType;
  targetId: string;
  label?: string | null;
}

/**
 * Response shape for a single `discovery_finding_links` row.
 */
export interface DiscoveryFindingLinkDto {
  id: string;
  findingId: string;
  linkType: string;
  targetType: string;
  targetId: string;
  label: string | null;
  createdAt: string;
}

/**
 * Create-finding payload accepted by AMS `POST .../findings` and (in bulk)
 * by `POST .../findings/bulk`. Scoping ids (run/project/architecture) come
 * from the URL path, not the body. `links` is validated per D6: target must
 * exist and belong to the same run / architecture; 400 on failure.
 */
export interface DiscoveryFindingCreatePayload {
  findingType: string;
  category: string;
  severity: string;
  confidence?: number | null;
  reviewStatus?: string;
  title: string;
  summary?: string | null;
  detailJson?: Record<string, unknown> | null;
  source?: string | null;
  createdByStage?: string | null;
  reviewerNotes?: string | null;
  links?: DiscoveryFindingLinkPayload[];
}

/**
 * PATCH payload. Every field is optional; `null` means "leave the persisted
 * value alone" -- never wipe. The AMS service-layer null-guards every field
 * per `project_primitive_double_dto_overwrite.md`. `confidence` is boxed
 * because zero is a legal value.
 */
export interface DiscoveryFindingUpdatePayload {
  findingType?: string;
  category?: string;
  severity?: string;
  confidence?: number | null;
  reviewStatus?: string;
  title?: string;
  summary?: string | null;
  detailJson?: Record<string, unknown> | null;
  source?: string | null;
  createdByStage?: string | null;
  reviewerNotes?: string | null;
}

/**
 * Convenience review payload: sets `status` (+ optional `reviewerNotes`) and
 * stamps `reviewed_at` on the row. Status transitions are validated by AMS.
 */
export interface DiscoveryFindingReviewPayload {
  reviewStatus: string;
  reviewerNotes?: string | null;
}

/**
 * Response shape for a single `discovery_findings` row, including its
 * embedded `links` array.
 */
export interface DiscoveryFindingDto {
  id: string;
  runId: string;
  projectId: string;
  architectureId: string;
  findingType: string;
  category: string;
  severity: string;
  confidence: number | null;
  reviewStatus: string;
  previousReviewStatus: string | null;
  title: string;
  summary: string | null;
  detailJson: Record<string, unknown> | null;
  source: string | null;
  createdByStage: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  links: DiscoveryFindingLinkDto[];
}

/**
 * Pagination envelope returned by AMS `GET .../findings`.
 */
export interface DiscoveryFindingSearchResponse {
  items: DiscoveryFindingDto[];
  total: number;
  page: number;
  size: number;
}

/**
 * Filter set for the list endpoint. All fields are optional. The text-search
 * field `text` matches against title + summary on the AMS side.
 */
export interface DiscoveryFindingListFilters {
  category?: string;
  findingType?: string;
  severity?: string;
  status?: string;
  source?: string;
  createdByStage?: string;
  linkedTargetType?: string;
  linkedTargetId?: string;
  text?: string;
  page?: number;
  size?: number;
}

// ===========================================================================
// Discovery Capability types (Liquibase changeset 184)
// Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines, Task Group 4.
// ===========================================================================

/**
 * Polymorphic member-type discriminator for a `discovery_capability_member`.
 * Mirrors the AMS `member_type` value set. `discovery_finding` is in the set
 * but is NOT a `DiscoveryFindingLink` target -- different mechanism (D1).
 */
export type DiscoveryCapabilityMemberType =
  | 'discovery_finding'
  | 'discovery_candidate'
  | 'architecture_element'
  | 'discovery_relationship';

/**
 * One membership edge to create alongside a capability. snake_case on the wire
 * (`member_type` / `member_id`); the TS shape is camelCase and mapped at the
 * boundary.
 */
export interface DiscoveryCapabilityMemberPayload {
  memberType: DiscoveryCapabilityMemberType;
  /** UUID of the referenced member (a discovery_candidate id, ...). */
  memberId: string;
}

/**
 * Create payload for one `discovery_capability` + its members, posted to the
 * AMS create / bulk-create endpoints. `projectId` / `architectureId` / `runId`
 * come from the URL path, NOT this body.
 */
export interface DiscoveryCapabilityCreatePayload {
  /** The LLM-named capability label (required). */
  name: string;
  /** The LLM-classified kind (free-text, NO enum). */
  kind?: string | null;
  /** The LLM one-line summary. */
  summary?: string | null;
  /** Synthesis confidence (boxed Double on the wire). */
  confidence?: number | null;
  /** The structured capability payload (JIL topology, invocations[], ...). */
  detailJson?: Record<string, unknown> | null;
  /** Synthesis provenance. */
  source?: string | null;
  /** Emitting pipeline stage. */
  createdByStage?: string | null;
  /** Deterministically-seeded membership edges, created atomically. */
  members?: DiscoveryCapabilityMemberPayload[];
}

/** A member edge as returned by AMS (mapped to camelCase). */
export interface DiscoveryCapabilityMemberDto {
  id: string;
  capabilityId: string;
  memberType: string;
  memberId: string;
  createdAt: string | null;
}

/** A `discovery_capability` row as returned by AMS (mapped to camelCase). */
export interface DiscoveryCapabilityDto {
  id: string;
  runId: string | null;
  projectId: string;
  architectureId: string;
  name: string;
  kind: string | null;
  summary: string | null;
  reviewStatus: string;
  previousReviewStatus: string | null;
  confidence: number | null;
  detailJson: Record<string, unknown> | null;
  source: string | null;
  createdByStage: string | null;
  createdAt: string;
  updatedAt: string;
  members: DiscoveryCapabilityMemberDto[];
}

/** Maps a TS capability create payload onto the AMS snake_case wire shape. */
function mapCapabilityCreateToBackend(
  p: DiscoveryCapabilityCreatePayload,
): Record<string, unknown> {
  return {
    name: p.name,
    kind: p.kind ?? null,
    summary: p.summary ?? null,
    confidence: p.confidence ?? null,
    detail_json: p.detailJson ?? null,
    source: p.source ?? null,
    created_by_stage: p.createdByStage ?? null,
    members: (p.members ?? []).map((m) => ({
      member_type: m.memberType,
      member_id: m.memberId,
    })),
  };
}

/** Maps an AMS snake_case capability member back to camelCase. */
function mapCapabilityMemberFromBackend(
  raw: Record<string, unknown>,
): DiscoveryCapabilityMemberDto {
  return {
    id: String(raw.id),
    capabilityId: String(raw.capability_id ?? raw.capabilityId),
    memberType: String(raw.member_type ?? raw.memberType),
    memberId: String(raw.member_id ?? raw.memberId),
    createdAt: (raw.created_at as string | null | undefined) ?? null,
  };
}

/** Maps an AMS snake_case capability row (with embedded members) to camelCase. */
function mapCapabilityFromBackend(raw: Record<string, unknown>): DiscoveryCapabilityDto {
  const rawMembers = (raw.members ?? []) as Record<string, unknown>[];
  return {
    id: String(raw.id),
    runId: (raw.run_id ?? raw.runId) != null ? String(raw.run_id ?? raw.runId) : null,
    projectId: String(raw.project_id ?? raw.projectId),
    architectureId: String(raw.architecture_id ?? raw.architectureId),
    name: String(raw.name),
    kind: (raw.kind as string | null | undefined) ?? null,
    summary: (raw.summary as string | null | undefined) ?? null,
    reviewStatus: String(raw.review_status ?? raw.reviewStatus ?? 'pending_review'),
    previousReviewStatus:
      (raw.previous_review_status as string | null | undefined) ??
      (raw.previousReviewStatus as string | null | undefined) ??
      null,
    confidence:
      typeof raw.confidence === 'number' ? (raw.confidence as number) : null,
    detailJson: (raw.detail_json ?? raw.detailJson ?? null) as Record<string, unknown> | null,
    source: (raw.source as string | null | undefined) ?? null,
    createdByStage:
      (raw.created_by_stage as string | null | undefined) ??
      (raw.createdByStage as string | null | undefined) ??
      null,
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ''),
    members: rawMembers.map(mapCapabilityMemberFromBackend),
  };
}

/** Maps a backend snake_case finding link to a camelCase DTO. */
function mapFindingLinkFromBackend(raw: Record<string, unknown>): DiscoveryFindingLinkDto {
  return {
    id: String(raw.id),
    findingId: String(raw.finding_id ?? raw.findingId),
    linkType: String(raw.link_type ?? raw.linkType),
    targetType: String(raw.target_type ?? raw.targetType),
    targetId: String(raw.target_id ?? raw.targetId),
    label: (raw.label as string | null | undefined) ?? null,
    createdAt: String(raw.created_at ?? raw.createdAt),
  };
}

/** Maps a backend snake_case finding row (with embedded links) to camelCase. */
function mapFindingFromBackend(raw: Record<string, unknown>): DiscoveryFindingDto {
  const rawLinks = (raw.links ?? []) as Record<string, unknown>[];
  return {
    id: String(raw.id),
    runId: String(raw.run_id ?? raw.runId),
    projectId: String(raw.project_id ?? raw.projectId),
    architectureId: String(raw.architecture_id ?? raw.architectureId),
    findingType: String(raw.finding_type ?? raw.findingType),
    category: String(raw.category),
    severity: String(raw.severity),
    confidence: (raw.confidence as number | null | undefined) ?? null,
    reviewStatus: String(raw.review_status ?? raw.reviewStatus),
    previousReviewStatus: ((raw.previous_review_status ?? raw.previousReviewStatus) as string | null) ?? null,
    title: String(raw.title),
    summary: (raw.summary as string | null | undefined) ?? null,
    detailJson: (raw.detail_json ?? raw.detailJson) as Record<string, unknown> | null,
    source: (raw.source as string | null | undefined) ?? null,
    createdByStage: (raw.created_by_stage ?? raw.createdByStage) as string | null,
    createdAt: String(raw.created_at ?? raw.createdAt),
    updatedAt: String(raw.updated_at ?? raw.updatedAt),
    reviewedAt: (raw.reviewed_at ?? raw.reviewedAt) as string | null,
    reviewerNotes: (raw.reviewer_notes ?? raw.reviewerNotes) as string | null,
    links: rawLinks.map(mapFindingLinkFromBackend),
  };
}

/** Maps a camelCase create payload to the snake_case body the AMS DTO expects. */
function mapFindingCreateToBackend(
  payload: DiscoveryFindingCreatePayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    finding_type: payload.findingType,
    category: payload.category,
    severity: payload.severity,
    title: payload.title,
  };
  if (payload.confidence !== undefined) body.confidence = payload.confidence;
  if (payload.reviewStatus !== undefined) body.review_status = payload.reviewStatus;
  if (payload.summary !== undefined) body.summary = payload.summary;
  if (payload.detailJson !== undefined) body.detail_json = payload.detailJson;
  if (payload.source !== undefined) body.source = payload.source;
  if (payload.createdByStage !== undefined) body.created_by_stage = payload.createdByStage;
  if (payload.reviewerNotes !== undefined) body.reviewer_notes = payload.reviewerNotes;
  if (payload.links !== undefined) {
    body.links = payload.links.map((l) => ({
      link_type: l.linkType,
      target_type: l.targetType,
      target_id: l.targetId,
      label: l.label ?? null,
    }));
  }
  return body;
}

/** Maps a camelCase patch payload to the snake_case body the AMS PATCH expects. */
function mapFindingUpdateToBackend(
  payload: DiscoveryFindingUpdatePayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (payload.findingType !== undefined) body.finding_type = payload.findingType;
  if (payload.category !== undefined) body.category = payload.category;
  if (payload.severity !== undefined) body.severity = payload.severity;
  if (payload.confidence !== undefined) body.confidence = payload.confidence;
  if (payload.reviewStatus !== undefined) body.review_status = payload.reviewStatus;
  if (payload.title !== undefined) body.title = payload.title;
  if (payload.summary !== undefined) body.summary = payload.summary;
  if (payload.detailJson !== undefined) body.detail_json = payload.detailJson;
  if (payload.source !== undefined) body.source = payload.source;
  if (payload.createdByStage !== undefined) body.created_by_stage = payload.createdByStage;
  if (payload.reviewerNotes !== undefined) body.reviewer_notes = payload.reviewerNotes;
  return body;
}

// =============================================================================
// Backend ↔ TypeScript field mappers (snake_case ↔ camelCase)
// =============================================================================

/** Maps a backend snake_case evidence atom to a camelCase EvidenceAtom. */
function mapEvidenceFromBackend(raw: Record<string, unknown>): EvidenceAtom {
  return {
    id: raw.id as string,
    runId: (raw.run_id ?? raw.runId) as string,
    repoUrl: (raw.repo_url ?? raw.repoUrl) as string,
    filePath: (raw.file_path ?? raw.filePath) as string,
    type: raw.type as EvidenceAtom['type'],
    data: raw.data as EvidenceAtom['data'],
    extractedAt: (raw.extracted_at ?? raw.extractedAt) as string,
    source: (raw.source as EvidenceAtom['source']) ?? undefined,
    logOrigin: (raw.log_origin ?? raw.logOrigin) as EvidenceAtom['logOrigin'],
    qaOrigin: (raw.qa_origin ?? raw.qaOrigin) as EvidenceAtom['qaOrigin'],
  };
}

/** Maps a backend snake_case relationship to a camelCase EvidenceRelationship. */
function mapRelationshipFromBackend(raw: Record<string, unknown>): EvidenceRelationship {
  return {
    id: raw.id as string,
    runId: (raw.run_id ?? raw.runId) as string,
    sourceAtomId: (raw.source_atom_id ?? raw.sourceAtomId) as string,
    targetAtomId: (raw.target_atom_id ?? raw.targetAtomId) as string,
    relationshipType: (raw.relationship_type ?? raw.relationshipType) as EvidenceRelationship['relationshipType'],
    confidence: raw.confidence as number,
    data: raw.data as EvidenceRelationship['data'],
    inferredAt: (raw.inferred_at ?? raw.inferredAt) as string,
  };
}

/** Maps a camelCase EvidenceRelationship to snake_case for the backend. */
function mapRelationshipToBackend(rel: EvidenceRelationship): Record<string, unknown> {
  return {
    id: rel.id,
    run_id: rel.runId,
    source_atom_id: rel.sourceAtomId,
    target_atom_id: rel.targetAtomId,
    relationship_type: rel.relationshipType,
    confidence: rel.confidence,
    data: rel.data,
    inferred_at: rel.inferredAt,
  };
}

/** Maps a backend snake_case cluster to a camelCase EvidenceCluster. */
function mapClusterFromBackend(raw: Record<string, unknown>): EvidenceCluster {
  const rawMembers = (raw.members ?? []) as Record<string, unknown>[];
  return {
    id: raw.id as string,
    runId: (raw.run_id ?? raw.runId) as string,
    clusterType: (raw.cluster_type ?? raw.clusterType) as EvidenceCluster['clusterType'],
    name: raw.name as string | undefined,
    confidence: raw.confidence as number,
    members: rawMembers.map(m => ({
      memberType: (m.member_type ?? m.memberType) as ClusterMember['memberType'],
      memberId: (m.member_id ?? m.memberId) as string,
    })),
    data: raw.data as Record<string, unknown>,
    formedAt: (raw.formed_at ?? raw.formedAt) as string,
  };
}

/** Maps a camelCase EvidenceCluster to snake_case for the backend. */
function mapClusterToBackend(cluster: EvidenceCluster): Record<string, unknown> {
  return {
    id: cluster.id,
    run_id: cluster.runId,
    cluster_type: cluster.clusterType,
    name: cluster.name,
    confidence: cluster.confidence,
    members: cluster.members.map(m => ({
      member_type: m.memberType,
      member_id: m.memberId,
    })),
    data: cluster.data,
    formed_at: cluster.formedAt,
  };
}

/** Maps a backend snake_case candidate to a camelCase DiscoveryCandidate. */
function mapCandidateFromBackend(raw: Record<string, unknown>): DiscoveryCandidate {
  return {
    id: raw.id as string,
    runId: (raw.run_id ?? raw.runId) as string,
    candidateType: (raw.candidate_type ?? raw.candidateType) as DiscoveryCandidate['candidateType'],
    name: raw.name as string,
    confidence: raw.confidence as number,
    status: raw.status as DiscoveryCandidate['status'],
    // AMS `review_status` (the review DISPOSITION) is a DISTINCT column from
    // `status` (the lifecycle). The discovery-review model reads this for a node's
    // `review_status`, so a bulk-review-cascade / resolve-conflict disposition is
    // reflected on the NEXT review-model read. Without it the node falsely reads as
    // un-reviewed and the Review Room loops on the same family.
    reviewStatus: (raw.review_status ?? raw.reviewStatus) as string | undefined,
    sourceClusterIds: (raw.source_cluster_ids ?? raw.sourceClusterIds) as string[],
    data: raw.data as Record<string, unknown>,
    synthesizedAt: (raw.synthesized_at ?? raw.synthesizedAt) as string,
    parentCandidateId: (raw.parent_candidate_id ?? raw.parentCandidateId) as string | undefined,
    logEnrichment: (raw.log_enrichment ?? raw.logEnrichment) as DiscoveryCandidate['logEnrichment'],
    // Model-Aware Discovery (2026-05-30): operation dimension. snake_case wire
    // `operation`; absence coerces to 'create' (matches the AMS column default).
    operation: (raw.operation as DiscoveryCandidate['operation']) ?? 'create',
  };
}

/** Maps a camelCase DiscoveryCandidate to snake_case for the backend. */
function mapCandidateToBackend(candidate: DiscoveryCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    run_id: candidate.runId,
    candidate_type: candidate.candidateType,
    name: candidate.name,
    confidence: candidate.confidence,
    status: candidate.status,
    source_cluster_ids: candidate.sourceClusterIds,
    data: candidate.data,
    synthesized_at: candidate.synthesizedAt,
    parent_candidate_id: candidate.parentCandidateId ?? null,
    log_enrichment: candidate.logEnrichment ?? null,
    // Model-Aware Discovery (2026-05-30): operation dimension. Default 'create'
    // so operation-agnostic callers and create candidates round-trip correctly.
    operation: candidate.operation ?? 'create',
  };
}

/** Maps a backend snake_case decision task to a camelCase DecisionTask. */
function mapDecisionTaskFromBackend(raw: Record<string, unknown>): DecisionTask {
  return {
    id: raw.id as string,
    runId: (raw.run_id ?? raw.runId) as string,
    taskType: (raw.task_type ?? raw.taskType) as DecisionTask['taskType'],
    status: raw.status as DecisionTask['status'],
    inputData: (raw.input_data ?? raw.inputData) as DecisionTask['inputData'],
    outputData: (raw.output_data ?? raw.outputData) as DecisionTask['outputData'],
    createdAt: (raw.created_at ?? raw.createdAt) as string,
    resolvedAt: (raw.resolved_at ?? raw.resolvedAt) as string | null,
  };
}

/** Maps a camelCase DecisionTask to snake_case for the backend. */
function mapDecisionTaskToBackend(task: DecisionTask): Record<string, unknown> {
  return {
    id: task.id,
    run_id: task.runId,
    task_type: task.taskType,
    status: task.status,
    input_data: task.inputData,
    output_data: task.outputData,
    created_at: task.createdAt,
    resolved_at: task.resolvedAt,
  };
}

/**
 * HTTP client for communicating with the architecture-model-service backend.
 * Provides methods for discovery run, config, evidence, relationship,
 * cluster, candidate, decision task, and entity retrieval operations.
 *
 * --------------------------------------------------------------------------
 * Architecture-scoped URL contract (Spec 2026-05-01 Multi-Architecture
 * Discovery Integration -- Spec #4):
 *
 * Every Discovery* controller in the architecture-model-service is mounted
 * at `/api/model/projects/{projectId}/architectures/{architectureId}/...`.
 * Forgetting `architectureId` produces a Spring `NoResourceFoundException`
 * (HTTP 404 "no static resource ...").
 *
 * Every method below that addresses a run-scoped resource resolves the
 * `architectureId` from the in-process {@link runArchitectureRegistry} via
 * {@link _resolveArchitectureForRun}. The route layer (`runs.ts`,
 * `logEnrichment.ts`, `hypothesisQa.ts`) is responsible for binding the
 * registry entry on entry; this contract keeps the URL-shape change
 * confined to a single file (this one) and avoids threading
 * `architectureId` through every internal helper.
 *
 * For the two methods that do NOT have a `runId` --
 * {@link createDiscoveryRun} (the run does not exist yet) and
 * {@link getDiscoveryConfig} (project-scoped) -- callers MUST pass
 * `architectureId` explicitly.
 * --------------------------------------------------------------------------
 */
/**
 * One vulnerability row as returned by the Spec 1 store
 * (`GET .../vulnerabilities`). Snake_case wire (AMS default -- the AMS
 * `VulnerabilityDto` carries NO `@CamelCaseWire`). Only the fields the
 * discovery-service enrichment path reads/forwards are typed here; the row
 * carries more (see the AMS `VulnerabilityDto`).
 *
 * Spec 2 -- Automated Vulnerability Enrichment, Task Group 2.
 */
export interface VulnerabilityRowDto {
  id: string;
  project_id: string;
  architecture_id: string;
  report_id: string;
  ingested_at: string;
  cve_id: string | null;
  cwe: string | null;
  title: string | null;
  details: string | null;
  cvss: number | null;
  severity: string;
  severity_raw: string | null;
  affected_coordinate: string | null;
  ecosystem: string | null;
  affected_version: string | null;
  affected_version_range: string | null;
  fixed_in_versions: string[];
  source: string;
  raw_row: Record<string, unknown> | null;
  match_status: string;
  matched_library_id: string | null;
  matched_declared_version: string | null;
}

/**
 * Paged list envelope from `GET .../vulnerabilities` -- mirrors the AMS
 * `VulnerabilitySearchResponse` (`items / total / page / size`, snake_case).
 */
export interface VulnerabilitySearchResponseDto {
  items: VulnerabilityRowDto[];
  total: number;
  page: number;
  size: number;
}

/**
 * Minimal view of the AMS meta-model summary
 * (`GET /api/projects/{projectId}/architectures/{architectureId}/meta-model-summary`).
 * Only the `services` entity list is consumed by the OSV SBOM gatherer (Spec 2,
 * Task Group 3) -- each `EntitySummary` carries `id` / `name` / `entity_type`
 * (snake_case). Other summary sections are ignored here.
 */
export interface ArchMetaModelSummaryDto {
  services?: Array<{ id?: string; name?: string; entity_type?: string }>;
  [key: string]: unknown;
}

/**
 * One already-parsed row for `POST .../vulnerabilities/reports` -- mirrors the
 * AMS `IngestVulnerabilityRowDto` on the snake_case wire. AMS computes the
 * normalized `severity` from `severity_raw` + `cvss` and stamps
 * `source`/`project_id`/`architecture_id`/`ingested_at`/match-status at ingest.
 */
export interface IngestVulnerabilityRowDto {
  cve_id: string | null;
  cwe: string | null;
  title: string | null;
  details: string | null;
  cvss: number | null;
  severity_raw: string | null;
  affected_coordinate: string | null;
  ecosystem: string | null;
  affected_version: string | null;
  affected_version_range: string | null;
  fixed_in_versions: string[];
  native_advisory_id: string | null;
  raw_row: Record<string, unknown>;
}

/**
 * Request body for `POST .../vulnerabilities/reports` -- mirrors the AMS
 * `IngestVulnerabilityReportRequest` (snake_case). For automated enrichment
 * `source: 'automated'`, `format: 'osv'`, `parse_strategy: 'osv_api'`.
 */
export interface IngestVulnerabilityReportRequestDto {
  source: string;
  original_filename?: string | null;
  format?: string | null;
  parse_strategy?: string | null;
  parser_dropped_count?: number | null;
  parser_notes?: string | null;
  rows: IngestVulnerabilityRowDto[];
}

/** Persisted report row from the Spec 1 store (subset; snake_case). */
export interface VulnerabilityReportDto {
  id: string;
  project_id: string;
  architecture_id: string;
  source: string;
  original_filename: string | null;
  format: string | null;
  is_latest: boolean;
  parse_strategy: string | null;
  row_count_ingested: number | null;
  row_count_dropped: number | null;
  notes: string | null;
  uploaded_at: string | null;
}

/**
 * Response from `POST .../vulnerabilities/reports` -- mirrors the AMS
 * `VulnerabilityReportSummaryDto` (snake_case): the persisted report plus the
 * ingested / dropped / matched tallies.
 */
export interface VulnerabilityReportSummaryDto {
  report: VulnerabilityReportDto;
  rows_received: number | null;
  ingested_count: number | null;
  dropped_duplicates: number | null;
  dropped_unparseable: number | null;
  matched_count: number | null;
  unmatched_count: number | null;
}

class ArchModelClient {
  private readonly client: AxiosInstance;

  /**
   * Per-project, per-run cache for the project's `Default` architecture id
   * (the oldest non-archived architecture for that project).
   *
   * Stores the in-flight Promise so concurrent callers within the same run
   * coalesce to a single upstream HTTP request. The cache is reset between
   * runs via {@link resetDefaultArchitectureCache} which is called at the
   * top of `startRun` / `resumeRun` in the run manager.
   *
   * Spec: 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
   */
  private readonly defaultArchitectureCache: Map<string, Promise<string>> = new Map();

  /**
   * Per-run cache for the architectureId derived from the discovery_runs row
   * via {@link _resolveArchitectureForRun}'s fallback path. Populated on
   * cache miss and cleared by {@link resetDefaultArchitectureCache} between
   * runs (the same fenceposts as the default-architecture cache, since
   * runs are tied to project lifecycles).
   */
  private readonly runArchitectureCache: Map<string, Promise<string>> = new Map();

  constructor() {
    this.client = axios.create({
      baseURL: ARCHITECTURE_MODEL_SERVICE_BASE_URL,
      timeout: 240000, // 4 minutes — bulk saves with 28k+ atoms need more time
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Log response body on HTTP errors for diagnosability
    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response) {
          const { status, config } = error.response;
          const method = config?.method?.toUpperCase() || '?';
          const url = config?.url || '?';
          const body = error.response.data;
          const bodySnippet = typeof body === 'string'
            ? body.substring(0, 500)
            : JSON.stringify(body).substring(0, 500);
          console.error(
            `[ArchModelClient] ${method} ${url} returned ${status}: ${bodySnippet}`
          );
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Resolves the architectureId for a run-scoped URL. Order of precedence:
   *   1. The in-process {@link runArchitectureRegistry} binding -- written
   *      at run-start by the route layer (see `runs.ts`).
   *   2. Internal {@link runArchitectureCache} for run-id-derived values.
   *   3. The project's `Default` architecture id (spec #1 fallback) AS A
   *      LAST RESORT, guarded by a warn-log so misuse is observable.
   *
   * Throws when no resolution is possible (project has no architectures).
   *
   * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) --
   * Task Group 4 (run-architecture binding) + this class's
   * architecture-scoped URL contract.
   */
  private async _resolveArchitectureForRun(
    projectId: string,
    runId: string,
  ): Promise<string> {
    // 1. In-process registry binding -- the canonical source while a run
    // is in flight.
    const bound = getRunArchitectureId(runId);
    if (bound !== undefined) {
      return bound;
    }

    // 2. Per-run cache from a previous fallback resolution this process.
    const cachedRun = this.runArchitectureCache.get(runId);
    if (cachedRun !== undefined) {
      return cachedRun;
    }

    // 3. Last-resort fallback: project default. This branch should only fire
    // on out-of-band callers (test scripts / post-restart code paths). When
    // it fires for a run that already has a different bound architecture in
    // the DB, the architecture-model-service will 404 via its scoped lookup
    // (cross-architecture leakage prevention), which surfaces the bug
    // loudly rather than silently writing to the wrong architecture.
    console.warn(
      `[ArchModelClient] No registry binding for run ${runId} (project ${projectId}). ` +
      `Falling back to project's Default architecture. This indicates a missing ` +
      `bindRunArchitecture(runId, projectId, architectureId) call in the route layer.`,
    );
    const inflight = this.resolveDefaultArchitectureId(projectId);
    this.runArchitectureCache.set(runId, inflight);
    inflight.catch(() => {
      if (this.runArchitectureCache.get(runId) === inflight) {
        this.runArchitectureCache.delete(runId);
      }
    });
    return inflight;
  }

  // ===========================================================================
  // Discovery Run methods
  // ===========================================================================

  /**
   * Creates a new discovery run for a given project and architecture.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs.
   *
   * When serviceId is provided, the backend stores the service_id on the run entity
   * to associate this discovery run with a specific service.
   *
   * Spec: V3 Tier UX — accepts optional `options.mode`, `options.warnings`,
   * `options.confirmedLlmSolo` so the discovery-service gate at
   * `POST /discovery/runs` can pass the computed tier metadata through to
   * archmodel in a single call. Backend persists the values verbatim; no
   * server-side re-validation of the Tier C gate.
   *
   * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) --
   * the `architectureId` is required and is persisted onto the new
   * discovery_runs row; the resulting run is bound to that architecture for life.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID the new run is bound to for life
   * @param serviceId - Optional service ID for service-scoped runs
   * @param options   - Optional V3 tier metadata (`mode`, `warnings`, `confirmedLlmSolo`)
   * @returns Promise resolving to the created DiscoveryRunResponseDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async createDiscoveryRun(
    projectId: string,
    architectureId: string,
    serviceId?: string,
    options?: CreateDiscoveryRunOptions
  ): Promise<DiscoveryRunResponseDto> {
    const body: Record<string, unknown> = {};
    if (serviceId) {
      body.service_id = serviceId;
    }
    if (options?.mode !== undefined) {
      body.mode = options.mode;
    }
    if (options?.warnings !== undefined) {
      // Java-side `warnings` column stores a JSON-encoded string[] verbatim.
      body.warnings = JSON.stringify(options.warnings);
    }
    if (options?.confirmedLlmSolo !== undefined) {
      body.confirm_llm_solo = options.confirmedLlmSolo;
    }
    if (options?.serviceIdentitySnapshot !== undefined) {
      // Map camelCase TS snapshot -> snake_case JSON for AMS's
      // CreateDiscoveryRunRequest.serviceIdentitySnapshot (Map<String, Object>).
      const snap = options.serviceIdentitySnapshot;
      body.service_identity_snapshot = {
        service_id: snap.serviceId,
        service_name: snap.serviceName,
        service_type: snap.serviceType,
        application_id: snap.applicationId,
        repo_location: snap.repoLocation,
        repo_subfolder: snap.repoSubfolder,
      };
    }
    if (options?.discoveryKind !== undefined) {
      body.discovery_kind = options.discoveryKind;
    }
    const response = await this.client.post<DiscoveryRunResponseDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs`,
      Object.keys(body).length > 0 ? body : undefined
    );
    return response.data;
  }

  /**
   * Updates an existing discovery run for a given project.
   * Calls PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param payload - The fields to update (status, current_step, steps_payload, error_message)
   * @returns Promise resolving to the updated DiscoveryRunResponseDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async updateDiscoveryRun(
    projectId: string,
    runId: string,
    payload: {
      status?: string;
      current_step?: string | null;
      steps_payload?: object;
      error_message?: string | null;
      /**
       * V3 pipeline computed tier (A/B/C) to persist on the run row.
       * Omitted (undefined) leaves the current value unchanged on the server.
       * Spec: V3 Discovery Pipeline Foundation.
       */
      mode?: string | null;
      /**
       * Advisory run-integrity `degraded` flag (Spec 2026-05-30 Oracle Integrity
       * & Determinism). TRUE when the run COMPLETED but the captured model may be
       * partial. Rides ALONGSIDE `status: 'COMPLETED'` -- it is NOT a status
       * value. The AMS PUT body is non-clobber: omitting it (undefined) or
       * sending null leaves the server value unchanged (the boxed-Boolean
       * null-guard on the AMS service). Boxed-style here too -- only sent when a
       * value was computed.
       * Spec: Oracle Integrity & Determinism.
       */
      degraded?: boolean | null;
      /**
       * JSON-encoded `string[]` of the reasons `degraded` tripped, passed
       * through verbatim to the AMS `degraded_reasons TEXT` column (mirrors the
       * advisory `warnings` precedent). Null/omitted leaves the value unchanged.
       * Spec: Oracle Integrity & Determinism.
       */
      degraded_reasons?: string | null;
    }
  ): Promise<DiscoveryRunResponseDto> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.put<DiscoveryRunResponseDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`,
      payload
    );
    return response.data;
  }

  /**
   * Bulk-upsert the profiled routine catalog (Stored Proc & Function
   * Behaviour Program, Spec 1, 2026-09-09) as first-class `db_routines`
   * facts keyed by (architecture, schema, name, kind). Records are the
   * engine-neutral snake_case `RoutineRecord`s — sent verbatim.
   */
  async bulkUpsertDbRoutines(
    projectId: string,
    architectureId: string,
    runId: string,
    routines: import('./databasePacks/routineTypes').RoutineRecord[],
  ): Promise<{ upserted: number }> {
    const response = await this.client.put<{ upserted: number }>(
      `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/db-routines/bulk`,
      { discovery_run_id: runId, routines }
    );
    return response.data;
  }

  /**
   * Lists ALL discovery runs for an architecture (2026-08-23; the CODE scan
   * fetches the latest COMPLETED database run's live proc harvest from its
   * steps_payload). Returns [] on 404.
   */
  async listDiscoveryRuns(
    projectId: string,
    architectureId: string,
  ): Promise<DiscoveryRunResponseDto[]> {
    try {
      const response = await this.client.get<DiscoveryRunResponseDto[]>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs`
      );
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Retrieves a discovery run by ID from the architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}.
   *
   * Returns null if the run does not exist (404 response).
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the DiscoveryRunResponseDto, or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getDiscoveryRun(
    projectId: string,
    runId: string,
    architectureId?: string
  ): Promise<DiscoveryRunResponseDto | null> {
    // When the caller passes an explicit architectureId (e.g. from a URL
    // path segment), use it verbatim so the controller-level cross-arch
    // check can return the canonical 404 / surface as a 409 mismatch in
    // the calling route. Falling back to `_resolveArchitectureForRun`
    // would lose that mismatch signal because the registry / project
    // default would be substituted.
    const arch = architectureId ?? (await this._resolveArchitectureForRun(projectId, runId));
    try {
      const response = await this.client.get<DiscoveryRunResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(arch)}/discovery/runs/${encodeURIComponent(runId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Retrieves the discovery config for a project from the architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/config.
   *
   * Returns null if no config exists for the project (404 response).
   *
   * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) --
   * the `architectureId` is required because the config is now per-architecture.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID
   * @returns Promise resolving to the DiscoveryConfigResponseDto, or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getDiscoveryConfig(
    projectId: string,
    architectureId: string
  ): Promise<DiscoveryConfigResponseDto | null> {
    try {
      const response = await this.client.get<DiscoveryConfigResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/config`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Retrieves the project record by id from the architecture-model-service.
   * Calls GET /api/projects/{projectId}.
   *
   * Returns null on 404 so callers can skip the runtime evidence stage when
   * the project record is missing rather than failing the whole run.
   *
   * Spec: 2026-05-10 Web Access Log Runtime Endpoint Evidence -- Task Group 4.
   * The runtime evidence orchestrator needs `project_parent_folder` to resolve
   * the on-disk log file paths recorded in
   * `config_snapshot.inputArtifacts.logFiles[].relativePath`.
   *
   * @param projectId - The project UUID
   * @returns The minimal project DTO carrying `project_parent_folder`, or null on 404
   */
  async getProject(
    projectId: string
  ): Promise<{ id: string; project_parent_folder?: string | null } | null> {
    try {
      const response = await this.client.get<{ id: string; project_parent_folder?: string | null }>(
        `/api/projects/${encodeURIComponent(projectId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetches the full architecture model for a run's bound (project,
   * architecture) pair.
   *
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}
   * with NO filename query param, so AMS resolves the architecture's
   * default/latest model file (matching the model-as-input contract: the run
   * reads the SAME (project, architecture) model that save-back GET-merge-PUTs).
   *
   * Returns null on 404 (FIRST RUN / empty-or-absent model) so the caller can
   * proceed with no existing-entity section -- model-awareness is additive and
   * MUST tolerate a project that has never had a model persisted yet.
   *
   * The `architectureId` is resolved from the in-process run binding via
   * {@link _resolveArchitectureForRun} (the route layer binds it at run start),
   * keeping this read on the same architecture-scoped contract as every other
   * run-scoped call in this client.
   *
   * Spec: 2026-05-30 Model-Aware Discovery -- Task Group 2 (model-as-input).
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID (used to resolve the bound architecture)
   * @returns The full ArchitectureModelDto (shape
   *          `{ metaModel: { entities, relationships }, ... }`), or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getModel(
    projectId: string,
    runId: string
  ): Promise<Record<string, unknown> | null> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    try {
      const response = await this.client.get<Record<string, unknown>>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ===========================================================================
  // Evidence Atom methods (Layer 1a)
  // ===========================================================================

  /**
   * Persists evidence atoms in bulk for a given discovery run.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param atoms - The evidence atoms to persist
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkSaveEvidence(
    projectId: string,
    runId: string,
    atoms: EvidenceAtom[]
  ): Promise<void> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    // Map camelCase TypeScript fields to snake_case for the Java backend DTO
    const payload = atoms.map(atom => ({
      id: atom.id,
      run_id: atom.runId,
      repo_url: atom.repoUrl,
      file_path: atom.filePath,
      type: atom.type,
      data: atom.data,
      extracted_at: atom.extractedAt,
      source: atom.source ?? null,
      log_origin: atom.logOrigin ?? null,
    }));
    await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/evidence`,
      payload
    );
  }

  /**
   * Retrieves evidence atoms for a discovery run, optionally filtered by type.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence
   * with optional ?type= query parameter.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param type - Optional evidence atom type filter (e.g., 'file_structure', 'symbol', 'string_pattern')
   * @returns Promise resolving to an array of EvidenceAtom
   * @throws AxiosError with status code preserved for caller handling
   */
  async getEvidenceByRun(
    projectId: string,
    runId: string,
    type?: string
  ): Promise<EvidenceAtom[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/evidence`;
    const params: Record<string, string> = {};
    if (type) {
      params.type = type;
    }
    const response = await this.client.get<Record<string, unknown>[]>(url, { params });
    return response.data.map(mapEvidenceFromBackend);
  }

  /**
   * Retrieves evidence atoms for a discovery run using paginated fetches.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence
   * with offset and limit query parameters, accumulating pages into a single array.
   *
   * Used when the total atom count exceeds the pagination threshold to avoid
   * loading the entire set in a single HTTP response.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param totalCount - The total number of atoms (used to determine page count)
   * @param pageSize - The number of atoms per page
   * @returns Promise resolving to the full accumulated array of EvidenceAtom
   * @throws AxiosError with status code preserved for caller handling
   */
  async getEvidenceByRunPaginated(
    projectId: string,
    runId: string,
    totalCount: number,
    pageSize: number
  ): Promise<EvidenceAtom[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/evidence`;
    const allAtoms: EvidenceAtom[] = [];

    for (let offset = 0; offset < totalCount; offset += pageSize) {
      const params: Record<string, string | number> = {
        offset,
        limit: pageSize,
      };
      const response = await this.client.get<Record<string, unknown>[]>(url, { params });
      allAtoms.push(...response.data.map(mapEvidenceFromBackend));

      // If the server returned fewer items than the page size, we've reached the end
      if (response.data.length < pageSize) {
        break;
      }
    }

    return allAtoms;
  }

  /**
   * Retrieves the count of evidence atoms for a discovery run.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence/count.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the numeric count
   * @throws AxiosError with status code preserved for caller handling
   */
  async getEvidenceCount(
    projectId: string,
    runId: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.get<number>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/evidence/count`
    );
    return response.data;
  }

  // ===========================================================================
  // Relationship methods (Layer 1b)
  // ===========================================================================

  /**
   * Persists evidence relationships in bulk for a given discovery run.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param relationships - The evidence relationships to persist
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkSaveRelationships(
    projectId: string,
    runId: string,
    relationships: EvidenceRelationship[]
  ): Promise<void> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const payload = relationships.map(mapRelationshipToBackend);
    await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/relationships`,
      payload
    );
  }

  /**
   * Retrieves evidence relationships for a discovery run, optionally filtered by type.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships
   * with optional ?type= query parameter.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param type - Optional relationship type filter (e.g., 'imports', 'calls', 'extends')
   * @returns Promise resolving to an array of EvidenceRelationship
   * @throws AxiosError with status code preserved for caller handling
   */
  async getRelationshipsByRun(
    projectId: string,
    runId: string,
    type?: string
  ): Promise<EvidenceRelationship[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/relationships`;
    const params: Record<string, string> = {};
    if (type) {
      params.type = type;
    }
    const response = await this.client.get<Record<string, unknown>[]>(url, { params });
    return response.data.map(mapRelationshipFromBackend);
  }

  /**
   * Retrieves evidence relationships for a discovery run using paginated fetches.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships
   * with offset and limit query parameters, accumulating pages into a single array.
   *
   * Used when the total relationship count exceeds the pagination threshold to avoid
   * loading the entire set in a single HTTP response.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param totalCount - The total number of relationships (used to determine page count)
   * @param pageSize - The number of relationships per page
   * @returns Promise resolving to the full accumulated array of EvidenceRelationship
   * @throws AxiosError with status code preserved for caller handling
   */
  async getRelationshipsByRunPaginated(
    projectId: string,
    runId: string,
    totalCount: number,
    pageSize: number
  ): Promise<EvidenceRelationship[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/relationships`;
    const allRelationships: EvidenceRelationship[] = [];

    for (let offset = 0; offset < totalCount; offset += pageSize) {
      const params: Record<string, string | number> = {
        offset,
        limit: pageSize,
      };
      const response = await this.client.get<Record<string, unknown>[]>(url, { params });
      allRelationships.push(...response.data.map(mapRelationshipFromBackend));

      // If the server returned fewer items than the page size, we've reached the end
      if (response.data.length < pageSize) {
        break;
      }
    }

    return allRelationships;
  }

  /**
   * Retrieves the count of evidence relationships for a discovery run.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships/count.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the numeric count
   * @throws AxiosError with status code preserved for caller handling
   */
  async getRelationshipCount(
    projectId: string,
    runId: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.get<number>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/relationships/count`
    );
    return response.data;
  }

  // ===========================================================================
  // Cluster methods (Layer 1c)
  // ===========================================================================

  /**
   * Persists evidence clusters in bulk for a given discovery run.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param clusters - The evidence clusters to persist (each including member lists)
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkSaveClusters(
    projectId: string,
    runId: string,
    clusters: EvidenceCluster[]
  ): Promise<void> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const payload = clusters.map(mapClusterToBackend);
    await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/clusters`,
      payload
    );
  }

  /**
   * Retrieves evidence clusters for a discovery run, optionally filtered by type.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters
   * with optional ?type= query parameter.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param type - Optional cluster type filter (e.g., 'service_boundary', 'data_domain')
   * @returns Promise resolving to an array of EvidenceCluster
   * @throws AxiosError with status code preserved for caller handling
   */
  async getClustersByRun(
    projectId: string,
    runId: string,
    type?: string
  ): Promise<EvidenceCluster[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/clusters`;
    const params: Record<string, string> = {};
    if (type) {
      params.type = type;
    }
    const response = await this.client.get<Record<string, unknown>[]>(url, { params });
    return response.data.map(mapClusterFromBackend);
  }

  /**
   * Retrieves the count of evidence clusters for a discovery run.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters/count.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the numeric count
   * @throws AxiosError with status code preserved for caller handling
   */
  async getClusterCount(
    projectId: string,
    runId: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.get<number>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/clusters/count`
    );
    return response.data;
  }

  /**
   * Deletes all evidence clusters (and their cascade-deleted members) for a given
   * discovery run. Used for delete-and-recreate semantics after cluster adjudication.
   * Calls DELETE /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the number of clusters deleted
   * @throws AxiosError with status code preserved for caller handling
   */
  async deleteClustersByRunId(
    projectId: string,
    runId: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.delete<{ deleted: number }>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/clusters`
    );
    return response.data.deleted;
  }

  // ===========================================================================
  // Candidate methods (Layer 1d)
  // ===========================================================================

  /**
   * Persists discovery candidates in bulk for a given discovery run.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param candidates - The discovery candidates to persist
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkSaveCandidates(
    projectId: string,
    runId: string,
    candidates: DiscoveryCandidate[]
  ): Promise<void> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const payload = candidates.map(mapCandidateToBackend);
    await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates`,
      payload
    );
  }

  /**
   * Retrieves discovery candidates for a discovery run, optionally filtered
   * by candidate type and/or status.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates
   * with optional ?type= and ?status= query parameters.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param type - Optional candidate type filter (e.g., 'application', 'service')
   * @param status - Optional candidate status filter (e.g., 'proposed', 'accepted')
   * @param architectureId - Optional explicit architecture (e.g. from a URL path
   *   segment). When supplied it is used VERBATIM, exactly like
   *   {@link getDiscoveryRun}; only when absent do we fall back to
   *   {@link _resolveArchitectureForRun}. READ callers (e.g. the review-model
   *   endpoint) MUST pass it: there is no in-flight registry binding on a read,
   *   so the fallback would resolve to the project's DEFAULT architecture and a
   *   run bound to a non-default architecture would 404 via the AMS run guard.
   * @returns Promise resolving to an array of DiscoveryCandidate
   * @throws AxiosError with status code preserved for caller handling
   */
  async getCandidatesByRun(
    projectId: string,
    runId: string,
    type?: string,
    status?: string,
    architectureId?: string
  ): Promise<DiscoveryCandidate[]> {
    const arch = architectureId ?? (await this._resolveArchitectureForRun(projectId, runId));
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(arch)}/discovery/runs/${encodeURIComponent(runId)}/candidates`;
    const params: Record<string, string> = {};
    if (type) {
      params.type = type;
    }
    if (status) {
      params.status = status;
    }
    const response = await this.client.get<Record<string, unknown>[]>(url, { params });
    return response.data.map(mapCandidateFromBackend);
  }

  /**
   * Retrieves the count of discovery candidates for a discovery run.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates/count.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the numeric count
   * @throws AxiosError with status code preserved for caller handling
   */
  async getCandidateCount(
    projectId: string,
    runId: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.get<number>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/count`
    );
    return response.data;
  }

  /**
   * Updates an existing discovery candidate (e.g., for status changes).
   * Calls PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates/{candidateId}.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param candidateId - The candidate UUID to update
   * @param update - The fields to update on the candidate
   * @returns Promise resolving to the updated DiscoveryCandidate
   * @throws AxiosError with status code preserved for caller handling
   */
  async updateCandidate(
    projectId: string,
    runId: string,
    candidateId: string,
    update: Partial<DiscoveryCandidate>
  ): Promise<DiscoveryCandidate> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const payload = mapCandidateToBackend(update as DiscoveryCandidate);
    const response = await this.client.put<Record<string, unknown>>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`,
      payload
    );
    return mapCandidateFromBackend(response.data);
  }

  /**
   * Deletes all discovery candidates for a given discovery run.
   * Used for delete-and-recreate semantics after candidate adjudication.
   * Calls DELETE /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the number of candidates deleted
   * @throws AxiosError with status code preserved for caller handling
   */
  async deleteCandidatesByRunId(
    projectId: string,
    runId: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.delete<{ deleted: number }>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates`
    );
    return response.data.deleted;
  }

  // ===========================================================================
  // DecisionTask methods (Phase 1b)
  // ===========================================================================

  /**
   * Persists decision tasks in bulk for a given discovery run.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param tasks - The decision tasks to persist
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkSaveDecisionTasks(
    projectId: string,
    runId: string,
    tasks: DecisionTask[]
  ): Promise<void> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const payload = tasks.map(mapDecisionTaskToBackend);
    await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks`,
      payload
    );
  }

  /**
   * Retrieves decision tasks for a discovery run, optionally filtered by
   * status and/or taskType.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks
   * with optional ?status= and ?taskType= query parameters.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param status - Optional decision task status filter (e.g., 'pending', 'resolved', 'failed')
   * @param taskType - Optional decision task type filter (e.g., 'confirm_relationship', 'resolve_competing_relationships')
   * @returns Promise resolving to an array of DecisionTask
   * @throws AxiosError with status code preserved for caller handling
   */
  async getDecisionTasksByRun(
    projectId: string,
    runId: string,
    status?: string,
    taskType?: string
  ): Promise<DecisionTask[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks`;
    const params: Record<string, string> = {};
    if (status) {
      params.status = status;
    }
    if (taskType) {
      params.taskType = taskType;
    }
    const response = await this.client.get<Record<string, unknown>[]>(url, { params });
    return response.data.map(mapDecisionTaskFromBackend);
  }

  /**
   * Retrieves the count of decision tasks for a discovery run.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks/count
   * with optional ?status= query parameter.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param status - Optional decision task status filter (e.g., 'pending', 'resolved', 'failed')
   * @returns Promise resolving to the numeric count
   * @throws AxiosError with status code preserved for caller handling
   */
  async getDecisionTaskCount(
    projectId: string,
    runId: string,
    status?: string
  ): Promise<number> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks/count`;
    const params: Record<string, string> = {};
    if (status) {
      params.status = status;
    }
    const response = await this.client.get<number>(url, { params });
    return response.data;
  }

  /**
   * Updates an existing decision task (e.g., for recording LLM resolution results).
   * Calls PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks/{taskId}.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param taskId - The decision task UUID to update
   * @param update - The fields to update on the decision task
   * @returns Promise resolving to the updated DecisionTask
   * @throws AxiosError with status code preserved for caller handling
   */
  async updateDecisionTask(
    projectId: string,
    runId: string,
    taskId: string,
    update: Partial<DecisionTask>
  ): Promise<DecisionTask> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const payload = mapDecisionTaskToBackend(update as DecisionTask);
    const response = await this.client.put<Record<string, unknown>>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks/${encodeURIComponent(taskId)}`,
      payload
    );
    return mapDecisionTaskFromBackend(response.data);
  }

  // ===========================================================================
  // Architecture resolution (multi-architecture plumbing — spec #1)
  // ===========================================================================

  /**
   * Resolves the project's `Default` architecture id (the oldest non-archived
   * architecture for the given project).
   *
   * Calls `GET /api/projects/{projectId}/architectures` once per project per run
   * and caches the resulting Promise. Subsequent calls within the same run for
   * the same `projectId` return the cached value with no additional HTTP
   * traffic. The cache is reset between runs via
   * {@link resetDefaultArchitectureCache}, which `startRun` / `resumeRun` in
   * the run manager invokes at the top of each run lifecycle.
   *
   * Why "oldest non-archived" rather than a flag: this is the same rule the
   * frontend uses (see `ArchitectureContext`) and survives renames and the
   * addition of further architectures without any maintenance overhead.
   *
   * Spec: 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
   *
   * @param projectId - The project UUID
   * @returns Promise resolving to the architecture id (UUID string) of the project's `Default` architecture
   * @throws Error when the project has no non-archived architectures, or
   *         AxiosError when the upstream call fails (preserved for caller handling)
   */
  async resolveDefaultArchitectureId(projectId: string): Promise<string> {
    const cached = this.defaultArchitectureCache.get(projectId);
    if (cached !== undefined) {
      return cached;
    }

    const inflight = (async () => {
      const response = await this.client.get<ArchitectureResponseDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/architectures`
      );
      const architectures = response.data ?? [];

      // Pick oldest non-archived. The backend is expected to return them in
      // `created_at` ascending order (per `ArchitectureService.listForProject`)
      // but we sort defensively in case future changes alter that ordering.
      const nonArchived = architectures
        .filter(a => !a.archived)
        .sort((a, b) => {
          const ta = Date.parse(a.created_at);
          const tb = Date.parse(b.created_at);
          if (!isFinite(ta) && !isFinite(tb)) return 0;
          if (!isFinite(ta)) return 1;
          if (!isFinite(tb)) return -1;
          return ta - tb;
        });

      if (nonArchived.length === 0) {
        throw new Error(
          `Project ${projectId} has no non-archived architectures. ` +
          `Cannot resolve default architecture for discovery-service entity fetches.`
        );
      }

      return nonArchived[0].id;
    })();

    // Store the promise so concurrent callers coalesce to a single HTTP request.
    // If the request fails we evict the entry so a retry can issue a new request.
    this.defaultArchitectureCache.set(projectId, inflight);
    inflight.catch(() => {
      // Evict so a future call can retry. The `catch` here is purely for
      // cache hygiene; the original Promise rejection still propagates to
      // the awaiting caller through the returned `inflight` reference.
      if (this.defaultArchitectureCache.get(projectId) === inflight) {
        this.defaultArchitectureCache.delete(projectId);
      }
    });
    return inflight;
  }

  /**
   * Clears the per-run default-architecture cache and the run-architecture
   * fallback cache.
   *
   * Invoked at the top of `startRun` / `resumeRun` so each run resolves
   * the project's Default architecture afresh. Without this reset a long
   * running discovery-service process would serve stale data for the
   * lifetime of the process when an operator renames / archives /
   * re-orders architectures via spec #3 UI between runs.
   *
   * Spec: 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
   */
  resetDefaultArchitectureCache(): void {
    this.defaultArchitectureCache.clear();
    this.runArchitectureCache.clear();
  }

  // ===========================================================================
  // Meta-model Entity methods (Service-Scoped Discovery)
  // ===========================================================================

  /**
   * Retrieves a single service entity by ID from the architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}.
   *
   * Returns null if the service does not exist or does not belong to the
   * project / architecture (404 response).
   *
   * Spec: Service-Scoped Discovery (TG5);
   * URL re-shaped by 2026-05-01 Multi-Architecture Plumbing — Task Group 5
   * (was `/api/model/projects/{projectId}/entities/services/{serviceId}`).
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (resolved via {@link resolveDefaultArchitectureId})
   * @param serviceId - The service entity ID
   * @returns Promise resolving to the ServiceResponseDto, or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getService(
    projectId: string,
    architectureId: string,
    serviceId: string
  ): Promise<ServiceResponseDto | null> {
    try {
      const response = await this.client.get<ServiceResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/entities/services/${encodeURIComponent(serviceId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Retrieves a single application entity by ID from the architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/applications/{applicationId}.
   *
   * Returns null if the application does not exist or does not belong to the
   * project / architecture (404 response).
   *
   * Spec: Service-Scoped Discovery (TG5);
   * URL re-shaped by 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (resolved via {@link resolveDefaultArchitectureId})
   * @param applicationId - The application entity ID
   * @returns Promise resolving to the ApplicationResponseDto, or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getApplication(
    projectId: string,
    architectureId: string,
    applicationId: string
  ): Promise<ApplicationResponseDto | null> {
    try {
      const response = await this.client.get<ApplicationResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/entities/applications/${encodeURIComponent(applicationId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Retrieves a single application component entity by ID from the
   * architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/app_components/{appComponentId}.
   *
   * Returns null if the app component does not exist or does not belong to the
   * project / architecture (404 response).
   *
   * Spec: Service-Scoped Discovery (TG5);
   * URL re-shaped by 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (resolved via {@link resolveDefaultArchitectureId})
   * @param appComponentId - The application component entity ID
   * @returns Promise resolving to the AppComponentResponseDto, or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getAppComponent(
    projectId: string,
    architectureId: string,
    appComponentId: string
  ): Promise<AppComponentResponseDto | null> {
    try {
      const response = await this.client.get<AppComponentResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/entities/app_components/${encodeURIComponent(appComponentId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ===========================================================================
  // Library + CodeUnitDependency methods (Spec 2026-05-06 — Task Group 4)
  // ===========================================================================

  /**
   * Retrieves a single Library row by id, scoped by (projectId, architectureId).
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/libraries/{libraryId}.
   *
   * Returns null on 404 (library not in this project/architecture).
   *
   * Spec 2026-05-06 Library Discovery Integration — Task Group 4.
   *
   * @param projectId      - The project UUID
   * @param architectureId - The architecture UUID
   * @param libraryId      - The library UUID
   * @returns Promise resolving to the LibraryDto, or null on 404.
   */
  async getLibrary(
    projectId: string,
    architectureId: string,
    libraryId: string,
  ): Promise<LibraryDto | null> {
    try {
      const response = await this.client.get<LibraryDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/libraries/${encodeURIComponent(libraryId)}`,
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find-or-create a Library row identified by (model_file_id, name, ecosystem).
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/libraries.
   *
   * Source provenance fields (source_origin, source_system, source_reference,
   * last_verified_at, generation_status) are written by the caller per the
   * locked discovery-source contract:
   *   - source_origin = 'DISCOVERED'
   *   - source_system = 'discovery-service'
   *   - source_reference = <runId>
   *   - last_verified_at = <ISO timestamp now>
   *   - generation_status = 'completed'
   *
   * Helper {@link buildLibraryFindOrCreatePayload} adds these defaults.
   *
   * Spec 2026-05-06 Library Discovery Integration — Task Group 4.
   */
  async findOrCreateLibrary(
    projectId: string,
    architectureId: string,
    payload: LibraryFindOrCreateRequest,
  ): Promise<LibraryFindOrCreateResponse> {
    const response = await this.client.post<LibraryFindOrCreateResponse>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/libraries`,
      payload,
    );
    return response.data;
  }

  /**
   * Look up an ApplicationPoint by the canonical (target_type, target_ref_id)
   * tuple within the (projectId, architectureId) scope.
   *
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/application-points/by-target.
   *
   * Returns null on 404 (no AP for the target tuple in this scope).
   *
   * Fix #5 (synthetic-placeholder removal): used by the discovery-service to
   * resolve a real AP UUID for a Service / Library root before pushing a
   * source_application_point_id FK value to code_unit_dependencies.
   */
  async getApplicationPointByTarget(
    projectId: string,
    architectureId: string,
    targetType: string,
    targetRefId: string,
  ): Promise<ApplicationPointDto | null> {
    try {
      const response = await this.client.get<ApplicationPointDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/application-points/by-target`,
        { params: { targetType, targetRefId } },
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find-or-create an ApplicationPoint identified by (model_file_id,
   * target_type, target_ref_id). On insert, the server resolves a sentinel
   * application_id (FK to applications.id) from the first Application of
   * the model file (mirrors Fix #4).
   *
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/application-points.
   *
   * Fix #5 (self-heal branch): used by the discovery-service when the
   * by-target lookup misses, so a Service / Library root always has a real
   * AP UUID to feed code_unit_dependencies.source_application_point_id.
   */
  async findOrCreateApplicationPoint(
    projectId: string,
    architectureId: string,
    payload: ApplicationPointFindOrCreateRequest,
  ): Promise<ApplicationPointFindOrCreateResponse> {
    const response = await this.client.post<ApplicationPointFindOrCreateResponse>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/application-points`,
      payload,
    );
    return response.data;
  }

  /**
   * Find-or-create a CodeUnitDependency edge identified by
   * (source_application_point_id, target_application_point_id, declared_name,
   * declared_version) — null-tolerant on declared_version per Spec 1.
   *
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/code-unit-dependencies.
   *
   * Locked evidence-source defaults (per Spec 2026-05-06 Group 4.4):
   *   - evidence_source = 'DISCOVERY_RESOLVER'
   *   - confidence = 1.0
   *
   * Helper {@link buildCodeUnitDependencyFindOrCreatePayload} adds those defaults.
   */
  async findOrCreateCodeUnitDependency(
    projectId: string,
    architectureId: string,
    payload: CodeUnitDependencyFindOrCreateRequest,
  ): Promise<CodeUnitDependencyFindOrCreateResponse> {
    const response = await this.client.post<CodeUnitDependencyFindOrCreateResponse>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/code-unit-dependencies`,
      payload,
    );
    return response.data;
  }

  // ===========================================================================
  // Discovery Findings methods (Spec 2026-05-16 -- Task Group 4)
  // ===========================================================================
  //
  // All methods hit the AMS findings surface directly:
  //   /api/model/projects/{projectId}/architectures/{architectureId}
  //      /discovery/runs/{runId}/findings[...]
  //
  // Architecture resolution follows the established run-scoped pattern via
  // `_resolveArchitectureForRun` so callers do not have to thread the
  // architectureId through the v1 emission sites. Failures are propagated
  // verbatim -- the `FindingEmitter` is the soft-fail boundary.
  // ===========================================================================

  /**
   * Create a single finding under a run. Calls
   * `POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings`.
   *
   * Per D6, any `links` in the payload are validated server-side: target must
   * exist and belong to the same run (for run-scoped target types) or
   * architecture (for `architecture_element`). The server returns
   * `{code: 'invalid_link_target'}` 400 on failure.
   *
   * Spec: 2026-05-16 Discovery Findings -- Task Group 4.
   */
  async createDiscoveryFinding(
    projectId: string,
    runId: string,
    payload: DiscoveryFindingCreatePayload,
  ): Promise<DiscoveryFindingDto> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.post<Record<string, unknown>>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings`,
      mapFindingCreateToBackend(payload),
    );
    return mapFindingFromBackend(response.data);
  }

  /**
   * Bulk-create findings under a run via
   * `POST .../findings/bulk`. Used by `FindingEmitter.emitFindings` so a
   * scanner that produces N findings per run takes one HTTP round-trip
   * rather than N. Body shape mirrors {@code BulkCreateDiscoveryFindingsRequest}
   * on the AMS side: `{ findings: [...create payloads...] }`.
   *
   * CHUNKED (2026-08-02): AMS enforces `MAX_BULK_FINDINGS = 500` per call
   * and REJECTS over-cap requests with a 400 (never truncates) -- a large
   * emission (runtime evidence alone can exceed 500 findings) previously
   * failed wholesale (`findingsEmit failed:true, persisted:0`). Chunks post
   * sequentially; a failed chunk logs a warning and the remaining chunks
   * continue (the FindingEmitter's never-propagate posture). Only when
   * NOTHING persisted does the last error propagate, so a total failure
   * stays loud.
   *
   * Spec: 2026-05-16 Discovery Findings -- Task Group 4.
   */
  async bulkCreateDiscoveryFindings(
    projectId: string,
    runId: string,
    payloads: DiscoveryFindingCreatePayload[],
  ): Promise<DiscoveryFindingDto[]> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    // Matches AMS DiscoveryFindingService.MAX_BULK_FINDINGS.
    const BULK_FINDINGS_CHUNK_SIZE = 500;
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings/bulk`;
    const totalChunks = Math.ceil(payloads.length / BULK_FINDINGS_CHUNK_SIZE);
    const created: DiscoveryFindingDto[] = [];
    let lastError: unknown = null;
    for (let i = 0; i < payloads.length; i += BULK_FINDINGS_CHUNK_SIZE) {
      const chunk = payloads.slice(i, i + BULK_FINDINGS_CHUNK_SIZE);
      try {
        const response = await this.client.post<Record<string, unknown>[]>(url, {
          findings: chunk.map(mapFindingCreateToBackend),
        });
        created.push(...(response.data ?? []).map(mapFindingFromBackend));
      } catch (err) {
        lastError = err;
        console.warn(
          `[archModelClient] bulk findings chunk ${Math.floor(i / BULK_FINDINGS_CHUNK_SIZE) + 1}` +
            `/${totalChunks} failed (${chunk.length} findings): ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
    if (created.length === 0 && payloads.length > 0 && lastError) {
      throw lastError;
    }
    return created;
  }

  /**
   * List findings for a run with optional filters. Forwards every supplied
   * filter as a query parameter; the AMS controller applies them as a
   * conjunction.
   *
   * Spec: 2026-05-16 Discovery Findings -- Task Group 4.
   *
   * @param architectureId - Optional explicit architecture (e.g. from a URL path
   *   segment). Used VERBATIM when supplied, exactly like {@link getDiscoveryRun}.
   *   READ callers (e.g. the review-model endpoint) MUST pass it: there is no
   *   in-flight registry binding on a read, so the {@link _resolveArchitectureForRun}
   *   fallback would resolve to the project's DEFAULT architecture and a run bound
   *   to a non-default architecture would 404 via the AMS run guard.
   */
  async listDiscoveryFindings(
    projectId: string,
    runId: string,
    filters?: DiscoveryFindingListFilters,
    architectureId?: string,
  ): Promise<DiscoveryFindingSearchResponse> {
    const arch = architectureId ?? (await this._resolveArchitectureForRun(projectId, runId));
    const params: Record<string, string | number> = {};
    if (filters) {
      if (filters.category !== undefined) params.category = filters.category;
      if (filters.findingType !== undefined) params.findingType = filters.findingType;
      if (filters.severity !== undefined) params.severity = filters.severity;
      if (filters.status !== undefined) params.status = filters.status;
      if (filters.source !== undefined) params.source = filters.source;
      if (filters.createdByStage !== undefined) params.createdByStage = filters.createdByStage;
      if (filters.linkedTargetType !== undefined) params.linkedTargetType = filters.linkedTargetType;
      if (filters.linkedTargetId !== undefined) params.linkedTargetId = filters.linkedTargetId;
      if (filters.text !== undefined) params.text = filters.text;
      if (filters.page !== undefined) params.page = filters.page;
      if (filters.size !== undefined) params.size = filters.size;
    }
    const response = await this.client.get<{
      items: Record<string, unknown>[];
      total: number;
      page: number;
      size: number;
    }>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(arch)}/discovery/runs/${encodeURIComponent(runId)}/findings`,
      { params },
    );
    return {
      items: (response.data.items ?? []).map(mapFindingFromBackend),
      total: response.data.total,
      page: response.data.page,
      size: response.data.size,
    };
  }

  /**
   * Partial update of a finding. The AMS service-layer null-guards each
   * field per `project_primitive_double_dto_overwrite.md`, so omitting a
   * field (or sending `undefined`) leaves the persisted value untouched.
   *
   * Spec: 2026-05-16 Discovery Findings -- Task Group 4.
   */
  async updateDiscoveryFinding(
    projectId: string,
    runId: string,
    findingId: string,
    patch: DiscoveryFindingUpdatePayload,
  ): Promise<DiscoveryFindingDto> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const response = await this.client.patch<Record<string, unknown>>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}`,
      mapFindingUpdateToBackend(patch),
    );
    return mapFindingFromBackend(response.data);
  }

  /**
   * Convenience review action: sets `review_status` (+ optional `reviewer_notes`)
   * on a finding and stamps `reviewed_at`. Transitions are unrestricted; AMS
   * captures the prior value into `previous_review_status`.
   *
   * Spec: 2026-05-16 Discovery Findings -- Task Group 4.
   */
  async reviewDiscoveryFinding(
    projectId: string,
    runId: string,
    findingId: string,
    body: DiscoveryFindingReviewPayload,
  ): Promise<DiscoveryFindingDto> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const wireBody: Record<string, unknown> = { review_status: body.reviewStatus };
    if (body.reviewerNotes !== undefined) wireBody.reviewer_notes = body.reviewerNotes;
    const response = await this.client.post<Record<string, unknown>>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/review`,
      wireBody,
    );
    return mapFindingFromBackend(response.data);
  }

  /**
   * Attach a link to an existing finding. Target validation per D6 is
   * server-side: missing or out-of-scope targets are rejected with 400
   * `{code: 'invalid_link_target'}`.
   *
   * Spec: 2026-05-16 Discovery Findings -- Task Group 4.
   */
  async createDiscoveryFindingLink(
    projectId: string,
    runId: string,
    findingId: string,
    link: DiscoveryFindingLinkPayload,
  ): Promise<DiscoveryFindingLinkDto> {
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const wireBody = {
      link_type: link.linkType,
      target_type: link.targetType,
      target_id: link.targetId,
      label: link.label ?? null,
    };
    const response = await this.client.post<Record<string, unknown>>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/links`,
      wireBody,
    );
    return mapFindingLinkFromBackend(response.data);
  }

  // ===========================================================================
  // Discovery Capability methods (Liquibase changeset 184)
  // Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines, Task Group 4.
  // ===========================================================================

  /**
   * Bulk-create synthesised capabilities (each with its members) under a run via
   * `POST .../runs/{runId}/capabilities/bulk`. The discovery-service synthesis
   * step posts the whole run's capabilities in one transaction. Body shape
   * mirrors AMS `BulkCreateDiscoveryCapabilitiesRequest`:
   * `{ capabilities: [...create payloads...] }` (snake_case wire).
   *
   * Returns the created capabilities (with assigned ids + members). An empty
   * input is a no-op (returns `[]` without an HTTP call) -- the zero-signal
   * graceful path (D9).
   */
  async bulkCreateDiscoveryCapabilities(
    projectId: string,
    runId: string,
    payloads: DiscoveryCapabilityCreatePayload[],
  ): Promise<DiscoveryCapabilityDto[]> {
    if (!payloads || payloads.length === 0) return [];
    const architectureId = await this._resolveArchitectureForRun(projectId, runId);
    const body = { capabilities: payloads.map(mapCapabilityCreateToBackend) };
    const response = await this.client.post<Record<string, unknown>[]>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/capabilities/bulk`,
      body,
    );
    return (response.data ?? []).map(mapCapabilityFromBackend);
  }

  // ===========================================================================
  // Vulnerability store methods (Spec 2 -- Automated Vulnerability Enrichment,
  // Task Group 2, task 2.4).
  //
  // These read + write the SHARED Spec 1 `vulnerabilities` store via the SAME
  // discovery -> gateway -> AMS path (this.client, snake_case wire) as the
  // library/edge/findings methods above -- NO parallel persistence channel.
  // The Spec 1 ingest endpoint (`POST .../vulnerabilities/reports`) already does
  // replace-latest BY SOURCE, so minting an `automated` report supersedes only
  // the prior `automated` rows and leaves manual/internal rows untouched
  // (task 2.6 refresh). Reconciliation reads existing rows via the list
  // endpoint. Both are architecture-scoped (NOT run-scoped): enrichment runs for
  // an architecture, so callers pass `architectureId` explicitly.
  // ===========================================================================

  /**
   * List the latest vulnerability rows for an architecture
   * (`GET /api/model/projects/{projectId}/architectures/{architectureId}/vulnerabilities`).
   * Used by enrichment reconciliation to read the existing (manual/internal)
   * rows before minting the `automated` set. Paged; this pulls a large page so
   * reconciliation sees the whole latest report in one call. 404-tolerant: a
   * project/architecture with no report yet yields an empty list (enrichment
   * then mints the first automated report).
   */
  async listVulnerabilities(
    projectId: string,
    architectureId: string,
    options?: { source?: string; page?: number; size?: number },
  ): Promise<VulnerabilitySearchResponseDto> {
    const params: Record<string, string | number> = {
      page: options?.page ?? 0,
      size: options?.size ?? 500,
    };
    if (options?.source) {
      params.source = options.source;
    }
    try {
      const response = await this.client.get<VulnerabilitySearchResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/vulnerabilities`,
        { params },
      );
      return response.data ?? { items: [], total: 0, page: 0, size: 0 };
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return { items: [], total: 0, page: 0, size: 0 };
      }
      throw error;
    }
  }

  /**
   * Ingest an already-built vulnerability report into the Spec 1 store
   * (`POST /api/model/projects/{projectId}/architectures/{architectureId}/vulnerabilities/reports`).
   * For automated enrichment the caller passes `source: 'automated'` and the
   * mapped rows; AMS normalizes severity, dedups within the report, matches
   * coordinates, and runs the replace-latest/keep-history lifecycle (demoting
   * only the prior `automated` latest -- task 2.6 refresh). Returns the report
   * summary (ingested / dropped / matched counts).
   */
  async ingestVulnerabilityReport(
    projectId: string,
    architectureId: string,
    request: IngestVulnerabilityReportRequestDto,
  ): Promise<VulnerabilityReportSummaryDto> {
    const response = await this.client.post<VulnerabilityReportSummaryDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/vulnerabilities/reports`,
      request,
    );
    return response.data;
  }

  /**
   * Read the architecture's meta-model summary
   * (`GET /api/projects/{projectId}/architectures/{architectureId}/meta-model-summary`).
   * Used by the OSV SBOM gatherer (Spec 2, Task Group 3) to ENUMERATE the
   * architecture's services (it then `getService`s each id for its
   * `repo_location`). Read-only; 404-tolerant -- an architecture with no summary
   * yields an empty `services` list (the SBOM is then empty and enrichment
   * no-ops, non-blocking). NB the path is `/api/projects/...` (the summary
   * controller's mapping), NOT the `/api/model/...` prefix the entity reads use.
   */
  async getMetaModelSummary(
    projectId: string,
    architectureId: string,
  ): Promise<ArchMetaModelSummaryDto> {
    try {
      const response = await this.client.get<ArchMetaModelSummaryDto>(
        `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/meta-model-summary`,
      );
      return response.data ?? { services: [] };
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return { services: [] };
      }
      throw error;
    }
  }


}

/**
 * Builds a {@link LibraryFindOrCreateRequest} payload with locked source-provenance
 * defaults applied. Caller supplies `runId`; the helper sets the rest:
 *   - source_origin = 'DISCOVERED'
 *   - source_system = 'discovery-service'
 *   - source_reference = runId
 *   - last_verified_at = ISO now
 *   - generation_status = 'completed'
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 4.
 */
export function buildLibraryFindOrCreatePayload(args: {
  name: string;
  ecosystem: string;
  runId: string;
  repo_location?: string | null;
  repo_subfolder?: string | null;
}): LibraryFindOrCreateRequest {
  return {
    name: args.name,
    ecosystem: args.ecosystem,
    repo_location: args.repo_location ?? null,
    repo_subfolder: args.repo_subfolder ?? null,
    source_origin: 'DISCOVERED',
    source_system: 'discovery-service',
    source_reference: args.runId,
    last_verified_at: new Date().toISOString(),
    generation_status: 'completed',
  };
}

/**
 * Builds a {@link CodeUnitDependencyFindOrCreateRequest} payload with locked
 * evidence-source defaults applied:
 *   - evidence_source = 'DISCOVERY_RESOLVER'
 *   - confidence = 1.0
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 4.
 */
export function buildCodeUnitDependencyFindOrCreatePayload(args: {
  source_application_point_id: string;
  target_application_point_id: string;
  declared_name: string;
  declared_version?: string | null;
  declared_version_range?: string | null;
  scope: string;
  manifest_path: string;
  manifest_line?: number | null;
}): CodeUnitDependencyFindOrCreateRequest {
  return {
    source_application_point_id: args.source_application_point_id,
    target_application_point_id: args.target_application_point_id,
    declared_name: args.declared_name,
    declared_version: args.declared_version ?? null,
    declared_version_range: args.declared_version_range ?? null,
    scope: args.scope,
    manifest_path: args.manifest_path,
    manifest_line: args.manifest_line ?? null,
    evidence_source: 'DISCOVERY_RESOLVER',
    confidence: 1.0,
  };
}
/**
 * Singleton instance of the architecture model client
 */
export const archModelClient = new ArchModelClient();
