/**
 * Discovery API Client
 *
 * API client for Gateway discovery read endpoints.
 * Provides typed fetch functions for discovery runs, candidates,
 * summary metrics, and entity-origin mappings.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 3: Frontend Discovery API Client
 *
 * Extended: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 5: reviewCandidate, saveApprovedCandidates, review fields on DTO
 *
 * Extended: V3 Tier UX (Spec 2026-04-20) -- Task Group 6
 * - DiscoveryRunDto gains `mode`, `tier`, `warnings`, `confirmed_llm_solo`.
 * - createDiscoveryRun accepts `confirmLlmSolo` and surfaces Tier C 409s via
 *   LlmSoloConfirmationRequiredError for the UI to prompt on.
 *
 * Extended: Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7
 * - Every read / write client function now takes `architectureId: string` and
 *   embeds it in the URL after `/projects/{projectId}/`. Hard cutover --
 *   forgetting `architectureId` 404s at the gateway router boundary
 *   (mirrors the architecture-model-service backend's path-segment safety
 *   property (b)).
 * - `DiscoveryRunDto` gains an `architecture_id` field so detail-page UI can
 *   resolve the bound architecture's name from `ArchitectureContext.architectures`.
 * - `saveApprovedCandidates` is updated by Group 8 (save-back confirm modal).
 *
 * Extended: Spec 2026-05-30 Oracle Integrity & Determinism (Spec #3) -- Task Group 6
 * - `DiscoveryRunDto` gains the advisory `degraded` (boxed Boolean) flag PLUS a
 *   `degraded_reasons` payload (the set of reasons it tripped), riding ALONGSIDE
 *   the `COMPLETED` status -- modelled on the existing advisory `warnings` field.
 *   Both are snake_case wire names (the run record is snake_case, NO
 *   `@CamelCaseWire`); `degraded_reasons` arrives JSON-encoded (like `warnings`)
 *   so the run-detail surface tolerates either a JSON string or a parsed array.
 * - `SaveApprovedResult` gains the optional `belowGateCount` produced by the MCP
 *   `SaveBackResult` (TG5) -- the count of below-auto-accept reviewable
 *   candidates -- which already flows verbatim through the gateway save-approved
 *   proxy onto the save-back outcome the run-detail page renders.
 *
 * Extended: Spec 2026-06-02 Deterministic Review Model + Cascade/Dependency Graph
 *   + Aggregation Backbone (Spec 1) -- Task Group 6
 * - `getReviewModel` fetches the deterministic, live-computed review model for a
 *   single run (the backbone API can span two runs via `secondRunId`, but the
 *   grid is single-run and never passes it). snake_case wire. The grid re-points
 *   its count/aggregation memos onto this backbone; it adds NO blast-radius /
 *   cascade UI (that is Spec 2).
 *
 * Extended: Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression
 *   (Spec 2) -- Task Group 5
 * - The single-run `ReviewModel` client type is WIDENED to add the two cascade
 *   arms the grid's blast-radius preview renders (and the frontend
 *   `resolveBulkActionSet` MIRROR reads): `blast_radius` + `findings`. They
 *   mirror the gateway `reviewModelWire.ts` subset field-for-field (parity held
 *   by the Group-4 wire-shape contract test, NOT a code import).
 * - `bulkReviewCascade` posts the curated candidate-id + finding-id sets to the
 *   gateway's ATOMIC cascade endpoint (sibling of `bulkReviewCandidates`),
 *   REPLACING the best-effort per-row fan-out for the cascade-apply path.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Gateway API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// TypeScript Interfaces
// ============================================================================

/**
 * Aggregated discovery summary metrics for a project.
 *
 * Contains the latest run's status and key count-based metrics
 * used by the Dashboard discovery summary card.
 *
 * Field names use snake_case to match the JSON serialization
 * from the backend DiscoverySummaryDto (via @JsonProperty).
 */
export interface DiscoveryRunSummaryDto {
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_created_at: string | null;
  total_candidates: number;
  candidate_counts_by_status: Record<string, number>;
  entities_saved: number;
  entity_type_coverage: number;
}

/**
 * Discovery run record.
 *
 * Represents a single discovery run with its lifecycle status,
 * step progression, and metadata timestamps.
 *
 * V3 Tier UX additive fields (all optional so older responses still parse):
 * - mode: 'pack-supervised' | 'language-only' | 'llm-solo'
 * - tier: 'A' | 'B' | 'C' (derived from mode on the backend DTO)
 * - warnings: string[] (populated for Tier B/C, typically empty/NULL for A)
 * - confirmed_llm_solo: boolean (true only when a Tier C run was opted in via `confirmLlmSolo: true`)
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 * - architecture_id: the architecture this run is bound to for life. Marked
 *   optional here so older responses (pre-migration test fixtures) still
 *   parse, but in practice the backend always emits it post-Group 1's
 *   NOT-NULL migration.
 */
/**
 * Six identifier-ish fields snapshotted at run-create time from the bound
 * service entity. Lives inside `config_snapshot.serviceIdentitySnapshot`.
 *
 * WIRE REALITY (reconciled 2026-06-05, spec
 * `2026-06-05-per-service-scan-selection`, Task Group 4.2): the discovery-service
 * WRITES this snapshot in **camelCase** (`serviceName`, `serviceType`, ... at
 * `discovery-service/src/routes/runs.ts:369-376`), and AMS persists the
 * `Map<String,Object>` verbatim -- so the keys on the wire are camelCase, NOT
 * the snake_case this type previously declared. That mismatch meant the bound
 * service name never surfaced in the review-room per-service picker's fallback.
 *
 * Reconciliation chosen (the low-risk client-side fix): align the TYPE to the
 * persisted camelCase shape and leave the discovery-service WRITE untouched, so
 * existing persisted snapshots stay valid (changing the write would desync every
 * pre-existing run). The legacy snake_case keys are kept present + optional for
 * dual-tolerance reads of any older record. Readers MUST prefer the camelCase
 * key and fall back to snake_case (e.g. `snapshot.serviceName ??
 * snapshot.service_name`) -- mirroring the established
 * `serviceDeletedHelpers.computeServiceDeletedState` read.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2 (origin);
 *       2026-06-05 Per-Service Scan Selection -- Task Group 4.2 (reconciliation).
 */
export interface ServiceIdentitySnapshot {
  /** The bound service's id (camelCase = the persisted wire key). */
  serviceId?: string | null;
  /** The bound service's human name (camelCase = the persisted wire key). */
  serviceName?: string | null;
  /** The bound service's type (camelCase = the persisted wire key). */
  serviceType?: string | null;
  /** The bound application id (camelCase = the persisted wire key). */
  applicationId?: string | null;
  /** The repo location (camelCase = the persisted wire key). */
  repoLocation?: string | null;
  /** The repo subfolder (camelCase = the persisted wire key). */
  repoSubfolder?: string | null;

  // Legacy snake_case aliases, retained optional for dual-tolerance reads of any
  // older record that might have been written snake_case. Prefer the camelCase
  // keys above; fall back to these.
  service_id?: string | null;
  service_name?: string | null;
  service_type?: string | null;
  application_id?: string | null;
  repo_location?: string | null;
  repo_subfolder?: string | null;
}

export interface DiscoveryRunDto {
  id: string;
  project_id: string;
  status: string;
  current_step: string | null;
  config_snapshot: Record<string, unknown> | null;
  steps_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  mode?: string | null;
  tier?: 'A' | 'B' | 'C' | null;
  warnings?: string[] | null;
  confirmed_llm_solo?: boolean;
  architecture_id?: string;
  /**
   * Service FK. Nullable since Liquibase changeset 126 -- a service-deletion
   * nulls the FK via ON DELETE SET NULL. Use together with the snapshot at
   * `config_snapshot.serviceIdentitySnapshot` to render the orphan-run UI.
   *
   * Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
   */
  service_id?: string | null;
  /**
   * Source kind of the run: 'code' | 'database' | 'combined'. Defaults to
   * 'code' on the backend so legacy callers / older responses parse cleanly.
   *
   * Spec: 2026-05-16 Database Discovery Packs -- Task Group 1 (AMS column)
   * + Task Group 5 (frontend surfacing as a small list badge).
   */
  discovery_kind?: 'code' | 'database' | 'combined' | string | null;
  /**
   * Advisory run-integrity flag (Oracle Integrity & Determinism, Spec #3,
   * Task Group 1). TRUE when the run completed but the captured model may be
   * partial/incomplete (a scanner failed, files failed gap-fill, a method/token
   * cap was hit, or a contract/runtime pass failed). It rides ALONGSIDE the
   * `COMPLETED` status -- it is NOT a new terminal status, never blocks, and a
   * non-degraded run leaves it null/false. snake_case wire name (`degraded`);
   * the run record is snake_case (no `@CamelCaseWire`). Optional + absence-
   * tolerant so older / non-degraded responses parse cleanly.
   */
  degraded?: boolean | null;
  /**
   * The set of reasons `degraded` tripped (Oracle Integrity & Determinism,
   * Spec #3, Task Group 1). Modelled on `warnings`: AMS persists + emits it as
   * a JSON-encoded `string[]` (verbatim, null when absent), so this field may
   * arrive as a JSON-encoded string OR an already-parsed array. The run-detail
   * surface tolerates both (it parses a string, passes an array through). Wire
   * name `degraded_reasons` (snake_case). Null/absent on a non-degraded run.
   */
  degraded_reasons?: string | string[] | null;
}

/**
 * Read the human service name from a run's
 * `config_snapshot.serviceIdentitySnapshot` with camelCase-first dual tolerance,
 * defending against a null / oddly-shaped `config_snapshot`. Returns `null` when
 * no usable name is present. Pure; used by the review-room per-service picker for
 * its display-name fallback (spec `2026-06-05-per-service-scan-selection`, Task
 * Group 4.4). Mirrors the read in `serviceDeletedHelpers.computeServiceDeletedState`.
 */
export function readSnapshotServiceName(run: DiscoveryRunDto): string | null {
  const snapshotRaw =
    run.config_snapshot && typeof run.config_snapshot === 'object'
      ? (run.config_snapshot as Record<string, unknown>).serviceIdentitySnapshot
      : undefined;
  if (!snapshotRaw || typeof snapshotRaw !== 'object') return null;
  const snap = snapshotRaw as Record<string, unknown>;
  const name = snap.serviceName ?? snap.service_name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * Discovery candidate record.
 *
 * Represents a synthesized meta-model element proposal produced
 * during Phase 1d candidate synthesis.
 *
 * Review fields added in Increment 13 (Candidate Review and Approval Workflow):
 * - review_status: current review state (pending_review, approved, rejected, deferred)
 * - reviewed_by: who performed the last review action (nullable)
 * - reviewed_at: when the last review action was performed (nullable ISO-8601)
 * - previous_review_status: review state before the last action (nullable)
 *
 * V3 Tier UX note (Spec 2026-04-20):
 * - `confidence` may be null for legacy rows (treated as "unmarked").
 * - `data._addedBy` carries the tag for tier badges:
 *   `'<framework>-adapter'`, `'llm-gap-fill'`, `'llm-ir-guided'`, `'llm-solo'`.
 */
export interface DiscoveryCandidateDto {
  id: string;
  run_id: string;
  /**
   * The candidate's meta-model type, e.g. `application` / `service` /
   * `endpoints` / `interfaces` / `logical_data_entities` /
   * `endpoint_data_effects` -- mirrors the discovery-service `CandidateType`
   * union verbatim. Kept as a wide `string` (NOT a closed union) so new
   * candidate types surface without a frontend type bump (absence-tolerant).
   *
   * Spec 2026-05-30 Outbound Integration Graph for Discovery (Spec #5) -- Task
   * Group 6 adds `'data_movements'`: ONE per resolved OUTBOUND edge (an HTTP
   * call / published message / secondary store / file/object / email-SMS /
   * third-party SDK the source calls out to). Its `data` carries the source
   * service/endpoint NAME + verbatim target + the integration kind (read by the
   * candidate-details surface; resolved LATE to `application_point`s + the
   * mixed-case {@link DataMovementDto} row at save-back). See
   * `candidateDetailsSupport.readDataMovementDisplay`.
   */
  candidate_type: string;
  name: string;
  confidence: number | null;
  status: string;
  source_cluster_ids: string[];
  data: Record<string, unknown>;
  synthesized_at: string;
  parent_candidate_id: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  previous_review_status: string | null;
  /**
   * Model-Aware Discovery (Spec 2026-05-30) -- the candidate OPERATION
   * dimension. snake_case wire field `operation` (AMS speaks snake_case;
   * no `@CamelCaseWire`). Values:
   *   - `'create'` (default): mint a brand-new entity.
   *   - `'enrich'`: add attributes / relationships to ONE existing entity
   *     (the resolved target NAME rides on `data`, e.g. `targetEntityName`).
   *   - `'link'`: a logical<->physical mapping between TWO existing entities
   *     (both endpoint NAMES ride on `data`, e.g. `logicalEntityName` +
   *     `physicalEntityName`).
   *
   * Optional + absence-tolerant: older candidate rows persisted before the
   * `166-discovery-candidate-operation` changeset have no `operation` on the
   * wire, so consumers MUST treat an absent / unknown value as `'create'`
   * (see `readCandidateOperation` in `candidateOperationSupport.ts`). The
   * resolved target NAME(s) for enrich / link ride on `data`, NOT here -- the
   * authoritative target match happens deterministically at save-back.
   */
  operation?: 'create' | 'enrich' | 'link' | string | null;
  /**
   * Wide outer envelope for the AMS `@JsonProperty("log_enrichment")` field.
   *
   * Increment-14 keys (`enriched`, `logAtomCount`, `signalSummary`) and
   * Spec 5's `runtime` block (`{ matched: MatchedRuntimeEvidence }` |
   * `NoUsageRuntimeEvidence`) all live inside this map. Per-section
   * builders narrow `runtime` to a strict `LogEnrichmentRuntimeBlock`
   * (declared in `candidateEvidenceTypes.ts`) at the call site.
   *
   * AMS exposes the field via `@JsonProperty("log_enrichment")` and the
   * gateway proxies the response verbatim (no field stripping), so the
   * field arrives end-to-end whenever the backend has populated it.
   */
  log_enrichment?: Record<string, unknown>;
}

/**
 * Discovery candidate-to-entity mapping record.
 *
 * Represents a provenance link between a discovery candidate
 * and a canonical meta-model entity created during save-back.
 */
export interface DiscoveryCandidateEntityMappingDto {
  id: string;
  candidate_id: string;
  run_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  created_at: string;
}

// ============================================================================
// Deterministic Review Model (Spec 2026-06-02 -- Deterministic Review Model +
// Cascade/Dependency Graph + Aggregation Backbone, of the discovery-review-
// unification program F -> 0 -> 1 -> 2 -> 3). Task Group 6.
//
// The discovery-service computes this model LIVE on read (it is NEVER persisted)
// and the gateway proxies it verbatim. The grid consumes it SINGLE-run (it passes
// its one `runId`; the backbone API can span two runs via the optional
// `secondRunId`, but the grid never does and adds NO blast-radius / cascade UI --
// that is Spec 2).
//
// WIRE FORMAT: the discovery-service authors these interfaces snake_case and
// serializes the model object verbatim (no camelCase->snake_case mapper), so the
// client types below are snake_case to match the wire exactly -- mirroring the
// existing snake_case discovery DTOs in this module.
//
// The interfaces below mirror ONLY the fields the single-run grid re-point
// consumes; every field is absence-tolerant so a partial / older response still
// parses. The full backbone shape (edges, the rest of the aggregation dimensions)
// is intentionally NOT typed here because the grid neither reads nor renders it.
//
// Spec 2 (2026-06-02) Task Group 5 WIDENS this with `blast_radius` + `findings`
// (the two cascade arms the grid's blast-radius PREVIEW renders).
// ============================================================================

/**
 * The Spec 0 conflict lens carried on each review-model node. `has_live_conflict`
 * is the precomputed predicate that matches the grid's `getUnresolvedConflicts`
 * EXACTLY (a `data._conflicts[attr]` entry with no matching
 * `data._conflictResolutions[attr]`). The grid joins this onto its displayed rows
 * by node id so the filtered conflict count agrees with the whole-run count.
 */
export interface ReviewModelNodeConflictState {
  has_live_conflict: boolean;
  /** The attribute names still live (unresolved); informational. */
  live_conflict_attrs?: string[];
}

/**
 * One review-model node -- one per candidate (the backbone EXCLUDES `*_points`
 * wrappers). `id` is the AMS candidate id, used to join a node onto the grid's
 * displayed row. Only the fields the single-run grid consumes are typed.
 */
export interface ReviewModelNode {
  /** AMS candidate id -- globally unique; the join key onto the grid's rows. */
  id: string;
  /** The Spec F review status (read-only; the grid never writes it here). */
  review_status: string;
  /** TRUE when the candidate is committed (`status === 'committed'`). */
  committed: boolean;
  /** The Spec 0 conflict lens (precomputed live-conflict predicate). */
  conflict_state: ReviewModelNodeConflictState;
  /** The source-tier precedence bucket (NOT the grid's display tier label). */
  source_tier?: string;
}

/**
 * The precomputed aggregation scalars the grid header reads. These are
 * WHOLE-RUN (unfiltered) counts; the grid uses them for the unfiltered
 * `committedCount` / `actionableCount` / `unresolvedConflictCount` and derives
 * the FILTERED variants from the per-node `nodes[]` join. Only the scalars the
 * grid consumes are typed; the full dimension maps are omitted.
 */
export interface ReviewModelAggregations {
  /** Total candidate node count (excludes findings). */
  total_candidates?: number;
  /**
   * Total finding count across the whole run. Read by the Spec 2 cascade
   * resolver mirror to populate the preview's "x of N findings" context.
   * Optional + absence-tolerant (older payloads omit it).
   */
  total_findings?: number;
  /** Committed candidates across the whole run. */
  committed_count: number;
  /** Non-committed (actionable) candidates across the whole run. */
  actionable_count: number;
  /** Unresolved-conflict candidates across the whole run. */
  live_conflict_count: number;
  /**
   * Distinct source-tier precedence labels present in the run. NOTE: these are
   * the `SourceTier` precedence buckets (`structural-framework-pack` etc.), NOT
   * the grid's display tier labels (`adapter`, `adapter + logs`, ...). The grid's
   * Tier filter dropdown therefore keeps deriving its display labels locally via
   * `getDisplayTierLabel` (which folds in the log-evidence ` + logs` suffix the
   * backbone deliberately omits); this field is exposed for completeness but is
   * NOT the grid's filter-option source.
   */
  source_tier_labels?: string[];
}

// ============================================================================
// Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression (Spec 2) --
// Task Group 5. The grid surfaces the blast-radius PREVIEW + an atomic
// cascade-aware bulk apply. The preview renders over `reviewModel.blast_radius`
// + `findings` (ALREADY fetched on mount via `getReviewModel`); the FRONTEND
// MIRROR of the gateway's pure `resolveBulkActionSet` (in
// `components/Discovery/resolveBulkActionSet.ts`) reads these snake_case fields.
//
// The fields below MIRROR the gateway's `reviewModelWire.ts` SUBSET field-for-
// field -- parity is guarded by the Group-4 wire-shape contract test, NOT a code
// import (the frontend never imports gateway source across the build boundary).
// All fields are absence-tolerant so a partial / older payload still parses.
// ============================================================================

/**
 * The typed-edge discriminator carried on each cascade dependent. Mirror of the
 * gateway's `EdgeKind` (and Spec 1's `reviewModel/types.ts`). Kept a wide-ish
 * union so a new edge kind on the wire still parses (it is rendered as a label).
 */
export type ReviewModelEdgeKind =
  | 'parent_child'
  | 'interface_logical_entities'
  | 'endpoint_data_effects'
  | 'logical_data_entity_physical_data_entities'
  | 'logical_data_attribute_physical_data_attributes'
  | 'logical_data_entity_relationships'
  | 'data_movements'
  | string;

/**
 * One dependent reached by a candidate's reject/defer blast radius, recording
 * WHICH edge pulled it in. Mirror of the gateway's `BlastRadiusDependent`.
 */
export interface ReviewModelBlastRadiusDependent {
  /** The dependent candidate id reached by the closure. */
  dependent_id: string;
  /** The `edge_kind` of the edge that pulled this dependent into the radius. */
  via_edge_kind: ReviewModelEdgeKind;
  /** The immediate predecessor node id that reached this dependent. */
  via_predecessor_id: string;
}

/**
 * The surface-only blast radius for a single candidate: the downward transitive
 * closure of dependents a reject/defer WOULD affect. Mirror of the gateway's
 * `BlastRadiusEntry` (the resolver reads `candidate_id` + `dependents`; the
 * advisory `would_be_orphaned_parent_ids` is carried for shape parity but is
 * NOT part of the hard touched set).
 */
export interface ReviewModelBlastRadiusEntry {
  /** The candidate whose hypothetical reject this radius describes. */
  candidate_id: string;
  /** The transitive dependents, each tagged with the edge that pulled it in. */
  dependents: ReviewModelBlastRadiusDependent[];
  /** ADVISORY-ONLY would-be-orphan parent ids (NOT part of the hard radius). */
  would_be_orphaned_parent_ids?: string[];
}

/**
 * One review-model finding node. The cascade resolver reads `id` (to add the
 * finding to the touched set) and `candidate_link_ids` (the
 * `target_type==='discovery_candidate'` join Spec 1 resolved) to decide which
 * findings a touched candidate pulls in. `title` is carried so the preview can
 * label the linked finding for the reviewer. Mirror of the subset of the
 * gateway's `ReviewFindingNode` the resolver consumes (+ the display `title`).
 */
export interface ReviewModelFindingNode {
  /** AMS finding id. */
  id: string;
  /**
   * The candidate node ids this finding links to. A finding is pulled into the
   * touched set when ANY of these ids is a touched candidate. Empty when the
   * finding links to no candidate.
   */
  candidate_link_ids: string[];
  /** Human-readable finding title (for the preview row label); optional. */
  title?: string;
}

/**
 * The single-run subset of the deterministic review model the grid consumes.
 * The discovery-service returns the FULL model (nodes, edges, findings,
 * blast_radius, aggregations); the grid reads `nodes` (Spec 1's per-node
 * conflict/committed join driving the filtered counts), `aggregations` (the
 * whole-run scalar counts), and -- for Spec 2's cascade preview -- `blast_radius`
 * (the cascade) + `findings` (the linked-finding arm). `blast_radius` + `findings`
 * are OPTIONAL so the Spec 1 grid re-point (which fetched the same endpoint
 * without rendering them) and any partial / older payload still parse. Untyped
 * fields on the wire are simply ignored.
 */
export interface ReviewModel {
  nodes: ReviewModelNode[];
  aggregations: ReviewModelAggregations;
  /** Per-candidate surface-only blast radius (Spec 1 Group 2; Spec 2 renders it). */
  blast_radius?: ReviewModelBlastRadiusEntry[];
  /** The unioned finding nodes (with their `candidate_link_ids`). */
  findings?: ReviewModelFindingNode[];
}

/**
 * Per-entity-kind sub-counts returned by the atomic cascade bulk-review
 * endpoint. Mirrors the AMS `BulkReviewCascadeResponse.KindResult` wire shape
 * (snake_case). `delta_by_from_status` is the server's exact pre-mutation
 * accumulator; `skipped_by_reason.transition_not_allowed` counts committed
 * candidate rows skipped (always 0 for the finding block).
 */
export interface BulkReviewCascadeKindResult {
  updated_count: number;
  skipped_count: number;
  skipped_by_reason?: {
    already_in_target: number;
    transition_not_allowed: number;
  };
  delta_by_from_status?: Record<string, number>;
}

/**
 * Response body for the atomic cascade bulk-review endpoint -- one per-kind
 * block for candidates and one for findings (mirrors AMS
 * `BulkReviewCascadeResponse`). Both kinds transitioned (or skipped) inside ONE
 * AMS transaction; a single-entity failure surfaces as an HTTP error with the
 * whole batch rolled back (no partial result).
 */
export interface BulkReviewCascadeResponse {
  candidates: BulkReviewCascadeKindResult;
  findings: BulkReviewCascadeKindResult;
}

/** Request body for the atomic cascade bulk-review endpoint (snake_case wire). */
export interface BulkReviewCascadeRequest {
  candidate_ids: string[];
  finding_ids: string[];
  review_status: string;
  reviewer_notes?: string;
}

/**
 * Persisted `data_movements` relationship row (the OUTBOUND-integration edge).
 *
 * Spec 2026-05-30 Outbound Integration Graph for Discovery (Spec #5) -- Task
 * Group 6. The discovery-service emits a `data_movements` CANDIDATE per resolved
 * outbound edge (HTTP call / published message / secondary store / file/object /
 * email-SMS / third-party SDK); the MCP Group-5 save-back producer resolves the
 * source/target NAMES LATE to `application_point`s and writes THIS row shape,
 * which AMS already persists (NO new AMS table / changeset).
 *
 * This interface mirrors the AMS `DataMovementDto.java` wire shape EXACTLY -- it
 * is intentionally MIXED-case (the Java record carries explicit per-field
 * `@JsonProperty`, NO `@CamelCaseWire`):
 *   - snake_case: `id`, `source_application_point_id`,
 *     `target_application_point_id`, `movement_type`, `description`, `tags`,
 *     `valid_from`, `valid_to`.
 *   - camelCase: `dataEntityPointId`, `interfaceWithSchemaId`, `biDirectional`.
 *
 * XOR: at most one of `dataEntityPointId` / `interfaceWithSchemaId` is set; for
 * an OUTBOUND dependency BOTH are typically ABSENT, and `movement_type` carries
 * the `integration_kind` (e.g. `outbound-rest`, `messaging-producer`,
 * `cache-store`). For a PURELY-EXTERNAL target the `target_application_point_id`
 * is NULL/absent (the architecture records the outbound dependency without
 * minting a fake counterpart -- the verbatim external detail rides on the
 * companion `external_integration_dependency` Finding). Every field is optional
 * here so partial / older rows parse cleanly (absence-tolerant).
 */
export interface DataMovementDto {
  id?: string;
  source_application_point_id?: string | null;
  target_application_point_id?: string | null;
  /** camelCase on the wire (XOR with `interfaceWithSchemaId`; absent for outbound). */
  dataEntityPointId?: string | null;
  /** camelCase on the wire (XOR with `dataEntityPointId`; absent for outbound). */
  interfaceWithSchemaId?: string | null;
  /** camelCase on the wire. */
  biDirectional?: boolean | null;
  /** Carries the `integration_kind` for an outbound-integration edge. */
  movement_type?: string | null;
  description?: string | null;
  tags?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
}

/**
 * Result of saving approved candidates to the canonical model.
 *
 * Spec 2026-05-30 Oracle Integrity & Determinism (Spec #3) -- Task Group 6:
 * - `belowGateCount` is the count of candidates whose OWN confidence sits below
 *   the 0.75 auto-accept gate (a whole Tier-C `llm-solo` run scores 0.4 and sits
 *   entirely below it). The MCP `SaveBackResult` (TG5) records these as explicit
 *   "below auto-accept" reviewable items rather than dropping them, and emits the
 *   count on the save-back result. That result already flows verbatim through the
 *   gateway save-approved proxy onto the frontend, so the run-detail page surfaces
 *   the count on the existing save-back outcome line. Optional + absence-tolerant
 *   so pre-Spec-#3 responses (which omit it) parse cleanly.
 */
/**
 * One per-candidate entry on the save-back REASON ARM
 * ({@link SaveApprovedResult.reasons}).
 *
 * Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 5. The MCP `SaveBackResult` collects ONE
 * entry for EVERY candidate that was created / reused / suppressed / left a
 * possible-duplicate / blocked / committed-with-a-quality-gap, so the honest
 * breakdown chip (Group 6) and the C1 remediation panel (Group 7) can split the
 * opaque `entitiesSkipped` integer by reason CLASS instead of guessing.
 *
 * WIRE FORMAT: camelCase. Unlike the snake_case AMS discovery DTOs in this
 * module, the save-back result is authored by the MCP server (a TypeScript
 * service) and the gateway save-approved proxy forwards that JS object VERBATIM,
 * so the field names reach the browser camelCase exactly as the MCP
 * `SaveBackReasonEntry` declares them. Every field is absence-tolerant.
 */
export interface SaveBackReasonEntry {
  /** The discovery candidate this entry describes. */
  candidateId: string;
  /** The candidate type (e.g. `business_logics`, `endpoints`). */
  candidateType: string;
  /** The candidate (display) name at save-back time. */
  name: string;
  /**
   * The parent/owning class context when known (e.g. a `business_logics`
   * candidate's `data.controllerClassName ?? data.className`); empty string when
   * no class context is available.
   */
  class: string;
  /**
   * The broad reason CLASS for this candidate's outcome: `created` (newly
   * minted), `reused` (matched an existing/earlier entity -- see
   * `reusedSubclass`), `suppressed` (auto-suppressed exact duplicate),
   * `possible` (normalized-only possible duplicate, reviewable), `blocked` (did
   * NOT commit -- missing/unresolved reference or bad type), or `quality_gap`
   * (committed but missing an important field). Kept a wide-ish union so a new
   * class on the wire still parses.
   */
  reason: 'created' | 'reused' | 'suppressed' | 'possible' | 'blocked' | 'quality_gap' | string;
  /**
   * For `reused`, which sub-class of reuse occurred: `intra-scan` (matched an
   * entity an EARLIER candidate in THIS save minted), `pre-existing` (matched an
   * entity that existed BEFORE this save), or `already-saved` (this exact
   * candidate was committed in a PRIOR save run). These three MUST stay
   * distinguished -- never collapsed into one "skipped".
   */
  reusedSubclass?: 'intra-scan' | 'pre-existing' | 'already-saved' | string;
  /**
   * The specific field that is missing/unresolved (blocked) or empty
   * (quality_gap), so the C1 panel can GROUP affected candidates by it. Omitted
   * for created/reused/suppressed/possible.
   */
  missingField?: string;
}

/**
 * A re-discovered entity AUTO-SUPPRESSED as an EXACT duplicate of an
 * already-persisted entity (the `suppressedDuplicates[]` arm). camelCase wire
 * (MCP-authored, forwarded verbatim). Absence-tolerant.
 */
export interface SaveApprovedSuppressedDuplicate {
  candidateId: string;
  candidateName: string;
  entityType: string;
  existingEntityId: string;
}

/**
 * A re-discovered entity that matched an existing entity only AFTER
 * normalization (below the auto-accept gate) -- kept reviewable, never
 * auto-applied (the `possibleDuplicates[]` arm). camelCase wire. Absence-tolerant.
 */
export interface SaveApprovedPossibleDuplicate {
  candidateId: string;
  candidateName: string;
  entityType: string;
  existingEntityId: string;
  confidence: number;
}

export interface SaveApprovedResult {
  entitiesCreated: number;
  entitiesSkipped: number;
  candidatesCommitted: number;
  belowGateCount?: number;
  /**
   * The per-candidate REASON ARM (Skipped-candidate visibility + grouped
   * bulk-fill (C1), 2026-06-20, Task Group 5). One {@link SaveBackReasonEntry}
   * per candidate so the breakdown chip + C1 panel can split the opaque skip
   * count by reason CLASS (and distinguish intra-scan / pre-existing /
   * already-saved reuse). Already rides the wire on the MCP `SaveBackResult`;
   * optional + absence-tolerant so pre-reason-arm responses parse cleanly.
   */
  reasons?: SaveBackReasonEntry[];
  /**
   * The auto-suppressed EXACT-duplicate set (the chip's `Suppressed duplicate`
   * class). Already reaches the browser but was previously dropped by this type.
   * Optional + absence-tolerant.
   */
  suppressedDuplicates?: SaveApprovedSuppressedDuplicate[];
  /**
   * The normalized-only POSSIBLE-duplicate set (the chip's `Possible duplicate`
   * class). Already reaches the browser but was previously dropped by this type.
   * Optional + absence-tolerant.
   */
  possibleDuplicates?: SaveApprovedPossibleDuplicate[];
}

/**
 * Thrown by `createDiscoveryRun` when the backend returns 409
 * `LLM_SOLO_CONFIRMATION_REQUIRED`. The caller can prompt the user
 * and retry the same request with `confirmLlmSolo: true`.
 */
export class LlmSoloConfirmationRequiredError extends Error {
  public readonly code = 'LLM_SOLO_CONFIRMATION_REQUIRED' as const;
  public readonly tier: 'C';
  public readonly mode: string;
  public readonly warnings: string[];

  constructor(tier: 'C', mode: string, warnings: string[]) {
    super('LLM-only discovery run requires explicit confirmation.');
    this.name = 'LlmSoloConfirmationRequiredError';
    this.tier = tier;
    this.mode = mode;
    this.warnings = warnings;
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Retrieves the aggregated discovery summary for a project + architecture.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId` between `:projectId` and `summary`. Hard
 *   cutover -- callers must read `useActiveArchitectureId()` and pass it
 *   in. Forgetting it 404s at the gateway router boundary.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @returns Promise resolving to the DiscoveryRunSummaryDto
 * @throws Error if the request fails (non-ok response)
 */
export async function getDiscoveryRunSummary(
  projectId: string,
  architectureId: string
): Promise<DiscoveryRunSummaryDto> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/summary`;

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Discovery summary request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryRunSummaryDto>;
}

/**
 * Retrieves all discovery runs for a project + architecture (most recent first).
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   The backend filters by `(projectId, architectureId)` so the list returns
 *   only runs bound to the URL's active architecture (safety property (c)).
 *   Frontend run-list components must read `useActiveArchitectureId()` and
 *   thread it in -- cross-architecture runs are hidden by design.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @returns Promise resolving to an array of DiscoveryRunDto
 * @throws Error if the request fails (non-ok response)
 */
export async function getDiscoveryRuns(
  projectId: string,
  architectureId: string
): Promise<DiscoveryRunDto[]> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs`;

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Discovery runs request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryRunDto[]>;
}

/**
 * Retrieves a single discovery run by ID.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`. The architecture-model-service joins
 *   discovery_runs on (projectId, architectureId, runId) so a run from
 *   a different architecture under the same project 404s here -- defence
 *   in depth in addition to the run's bound architectureId stored on the
 *   DTO.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @param runId - The discovery run identifier
 * @returns Promise resolving to a DiscoveryRunDto
 * @throws Error if the request fails (non-ok response)
 */
export async function getDiscoveryRun(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<DiscoveryRunDto> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}`;

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Discovery run request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryRunDto>;
}

/**
 * Deletes a discovery run and all of its child data (candidates, evidence,
 * relationships, clusters, decision tasks, findings, capabilities). Powers the
 * Discovery Runs list right-click "Delete" action so a user can clean up
 * test/iteration runs without starting a fresh project.
 *
 * Scoped to (projectId, architectureId): a run bound to a different
 * architecture 404s server-side (cross-architecture deletion prevention),
 * matching the GET scoping.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @param runId - The discovery run identifier
 * @returns Promise that resolves once the run is deleted (HTTP 204)
 * @throws Error if the request fails (non-ok response, e.g. 404 / 503)
 */
export async function deleteDiscoveryRun(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<void> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}`;

  const res = await fetch(url, { method: 'DELETE' });

  if (!res.ok) {
    throw new Error(`Discovery run delete failed: ${res.status}`);
  }
}

/**
 * Retrieves candidates for a specific discovery run.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`. Backend JOIN-filters child candidate rows
 *   via the parent run's architecture, so cross-architecture candidates are
 *   excluded.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @param runId - The discovery run identifier
 * @param type - Optional candidate type filter (e.g., 'application', 'service')
 * @param status - Optional candidate status filter (e.g., 'proposed', 'accepted')
 * @returns Promise resolving to an array of DiscoveryCandidateDto
 * @throws Error if the request fails (non-ok response)
 */
export async function getDiscoveryCandidates(
  projectId: string,
  architectureId: string,
  runId: string,
  type?: string,
  status?: string
): Promise<DiscoveryCandidateDto[]> {
  let url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates`;

  const params = new URLSearchParams();
  if (type) {
    params.set('type', type);
  }
  if (status) {
    params.set('status', status);
  }
  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Discovery candidates request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryCandidateDto[]>;
}

/**
 * Stage ONE imported (Postman) endpoint as an un-approved discovery candidate
 * scoped to a (project, architecture) pair -- the client side of "Add to
 * architecture" for the Postman import flow.
 *
 * Spec 2026-06-23 Import a Postman Collection into Capture, R5 / A4 -- Task
 * Group 5. The candidate is staged UN-APPROVED (`review_status: 'pending_review'`,
 * `status: 'proposed'`) so it flows through the normal discovery review/approve
 * path; it is NEVER a committed-architecture write. Task Group 8 binds this
 * function to the `onStageDiscoveryCandidate` seam in
 * `PostmanImportArchMatchStep`.
 *
 * The request + response are snake_case (R8): the AMS discovery candidate data
 * plane is snake_case. `method` + `path` are required (the resolved imported
 * request); `sourceItemName` / `summary` are optional traceability fields carried
 * into the candidate `data`.
 *
 * NOTE (Task Group 8 follow-up): the AMS endpoint
 * `POST .../discovery/stage-imported-candidate` is not yet proxied by the gateway
 * `/api/v1/discovery/*` router; Group 8 must add the matching proxy hop before
 * this call resolves end-to-end. The contract here is final so the binding is a
 * thin pass-through.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture identifier the candidate is scoped to
 * @param request - The imported endpoint (method + path required)
 * @returns Promise resolving to the staged, un-approved candidate DTO
 * @throws Error if the request fails (non-ok response)
 */
export async function stageImportedDiscoveryCandidate(
  projectId: string,
  architectureId: string,
  request: {
    method: string;
    path: string;
    name?: string | null;
    sourceItemName?: string | null;
    summary?: string | null;
  }
): Promise<DiscoveryCandidateDto> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/stage-imported-candidate`;

  const body: Record<string, string> = {
    method: request.method,
    path: request.path,
  };
  if (request.name) {
    body.name = request.name;
  }
  if (request.sourceItemName) {
    body.source_item_name = request.sourceItemName;
  }
  if (request.summary) {
    body.summary = request.summary;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Stage imported candidate request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryCandidateDto>;
}

/**
 * Retrieves the candidate count for a specific discovery run.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @param runId - The discovery run identifier
 * @returns Promise resolving to an object with count property
 * @throws Error if the request fails (non-ok response)
 */
export async function getDiscoveryCandidateCount(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<{ count: number }> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/count`;

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Discovery candidate count request failed: ${res.status}`);
  }

  return res.json() as Promise<{ count: number }>;
}

/**
 * Retrieves the deterministic review model for a discovery run.
 *
 * Spec 2026-06-02 Deterministic Review Model + Cascade/Dependency Graph +
 * Aggregation Backbone (Spec 1) -- Task Group 6.2.
 *
 * The discovery-service computes the model LIVE on read (it is never persisted)
 * and the gateway proxies it verbatim:
 *   GET /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/review-model
 *       [?secondRunId=<run-id>]
 *
 * SINGLE-RUN consumption: the grid passes only its one `runId`. The backbone API
 * can span two runs (one code-kind + one database-kind) via an OPTIONAL
 * `secondRunId` -- this client deliberately OMITS that param so the grid stays
 * single-run (no cross-scan edges, no multi-run UI). The model the grid reads
 * carries the whole-run aggregation scalars (`committed_count`,
 * `actionable_count`, `live_conflict_count`) plus the per-node conflict/committed
 * lens used to derive the FILTERED counts by joining on node id, plus -- for
 * Spec 2's cascade preview -- the `blast_radius` + `findings` arms.
 *
 * snake_case wire (mirrors `getDiscoveryCandidates`).
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier (the run's bound id)
 * @param runId - The discovery run identifier (the single run the grid views)
 * @returns Promise resolving to the ReviewModel (nodes + aggregations + cascade arms)
 * @throws Error if the request fails (non-ok response)
 */
export async function getReviewModel(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<ReviewModel> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/review-model`;

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Review model request failed: ${res.status}`);
  }

  return res.json() as Promise<ReviewModel>;
}

/**
 * Retrieves entity-origin mappings for a project + architecture (across all runs).
 *
 * Returns all candidate-entity-mappings for the project + architecture, used
 * to determine which entities in the Meta-Model originated from discovery in
 * the active architecture's runs.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`. Mappings from runs in other architectures
 *   are excluded so the meta-model "Discovered" badge correctly reflects
 *   only the architecture currently being viewed.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @returns Promise resolving to an array of DiscoveryCandidateEntityMappingDto
 * @throws Error if the request fails (non-ok response)
 */
export async function getDiscoveryOriginEntities(
  projectId: string,
  architectureId: string
): Promise<DiscoveryCandidateEntityMappingDto[]> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/entity-origins`;

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Discovery entity origins request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryCandidateEntityMappingDto[]>;
}

/**
 * Bulk review all candidates for a discovery run.
 * Sets the review_status on every candidate in one server-side operation.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`.
 *
 * Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression (Spec 2):
 *   This best-effort per-row fan-out is REPLACED by the ATOMIC
 *   `bulkReviewCascade` below for the cascade-apply path (the grid's
 *   blast-radius confirm modal). It is retained for any non-cascade callers.
 */
export async function bulkReviewCandidates(
  projectId: string,
  architectureId: string,
  runId: string,
  reviewStatus: string,
  candidateIds?: string[]
): Promise<{ review_status: string; total: number; succeeded: number; failed: number }> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/bulk-review`;

  const body: { review_status: string; candidate_ids?: string[] } = {
    review_status: reviewStatus,
  };
  if (candidateIds !== undefined) body.candidate_ids = candidateIds;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Bulk review request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Atomic CASCADE-aware bulk review of a curated set spanning candidates AND
 * their linked findings.
 *
 * Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression (Spec 2) --
 * Task Group 5. Sibling of `bulkReviewCandidates`, but POSTs the CURATED
 * `candidate_ids` + `finding_ids` (resolved client-side from the Spec 1
 * blast-radius preview, then deselected by the reviewer) to the gateway's
 * ATOMIC cascade endpoint:
 *   POST .../runs/:runId/candidates/bulk-review-cascade
 *
 * The gateway is a pure proxy; the AMS endpoint applies the disposition across
 * BOTH entity kinds in ONE `@Transactional` boundary -- any single-entity
 * failure rolls the WHOLE batch back (so this resolves with the full per-kind
 * result, or REJECTS on a non-2xx with NOTHING mutated; there is no partial
 * success). Committed candidate rows are skipped (counted) server-side, not
 * failed. snake_case wire.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run is bound to
 * @param runId - The discovery run identifier
 * @param body - The curated `candidate_ids` + `finding_ids` + `review_status`
 *               (+ optional `reviewer_notes`)
 * @returns Promise resolving to the per-kind `BulkReviewCascadeResponse`
 * @throws Error if the request fails (non-2xx -> the atomic batch rolled back)
 */
export async function bulkReviewCascade(
  projectId: string,
  architectureId: string,
  runId: string,
  body: BulkReviewCascadeRequest
): Promise<BulkReviewCascadeResponse> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/bulk-review-cascade`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Bulk review cascade request failed: ${res.status}`);
  }

  return res.json() as Promise<BulkReviewCascadeResponse>;
}

/**
 * Request body for the durable single-attribute conflict-resolution write
 * (snake_case wire). Mirrors the gateway proxy + AMS
 * `@PatchMapping("/{candidateId}/resolve-conflict")` contract:
 *   - `attr`          : the conflicted attribute name being settled.
 *   - `chosen_value`  : the value the reviewer picked (written to the canonical
 *                       `data[attr]` slot AND stamped into
 *                       `data._conflictResolutions[attr].chosenValue` by AMS).
 *   - `chosen_source` : the source the chosen value came from (stamped into
 *                       `data._conflictResolutions[attr].chosenSource`).
 *   - `resolved_by`   : optional reviewer label (defaults server-side).
 *   - `resolved_at`   : optional ISO-8601 timestamp (defaults server-side).
 *
 * AMS writes the camelCase resolution keys INSIDE the JSONB itself; this request
 * body is snake_case, matching every other discovery wire DTO in this module.
 */
export interface ResolveDiscoveryConflictBody {
  attr: string;
  chosen_value: unknown;
  chosen_source: string;
  resolved_by?: string;
  resolved_at?: string;
}

/**
 * DURABLE single-attribute conflict resolution for one discovery candidate.
 *
 * Spec 2026-06-02 Conversational Discovery-Review "Architect" Persona (Spec 3) --
 * Task Group 1 (AMS endpoint) + Group 3 (gateway proxy). The grid's conflict
 * chooser was previously CLIENT-SIDE ONLY (it mutated React state via
 * `onCandidatesChange` and never persisted), so a post-Approve re-read of the
 * candidate from the server still carried the unresolved `_conflicts[attr]` and
 * the conflict REAPPEARED. This client calls the EXISTING durable proxy so a grid
 * resolution is persisted immediately (not save-back-deferred), exactly like the
 * Review Room's resolve path:
 *   PATCH .../runs/:runId/candidates/:candidateId/resolve-conflict
 *
 * The endpoint is SINGLE-attribute: AMS stamps `data._conflictResolutions[attr]`
 * (camelCase keys inside the JSONB), sets the canonical `data[attr]` slot, and
 * clears `data._conflicts[attr]` in ONE write, returning the updated
 * DiscoveryCandidateDto. Callers resolving several attributes invoke it once per
 * attribute. snake_case wire (mirrors `reviewCandidate`).
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run is bound to
 * @param runId - The discovery run identifier
 * @param candidateId - The candidate whose conflict is being resolved
 * @param body - The single-attribute resolution (`attr` + `chosen_value` +
 *               `chosen_source` + optional `resolved_by` / `resolved_at`)
 * @returns Promise resolving to the updated DiscoveryCandidateDto
 * @throws Error if the request fails (non-ok response)
 */
export async function resolveDiscoveryConflict(
  projectId: string,
  architectureId: string,
  runId: string,
  candidateId: string,
  body: ResolveDiscoveryConflictBody
): Promise<DiscoveryCandidateDto> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/resolve-conflict`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Resolve discovery conflict request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryCandidateDto>;
}

/**
 * Reviews a discovery candidate by updating its review_status.
 *
 * Sends a PATCH request to update the candidate's review state
 * (approved, rejected, or deferred) with optional reviewer identity.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`.
 *
 * @param projectId - The project identifier
 * @param architectureId - The active architecture identifier
 * @param runId - The discovery run identifier
 * @param candidateId - The candidate identifier to review
 * @param reviewStatus - The new review status (approved, rejected, deferred)
 * @param reviewedBy - Optional reviewer identity label
 * @returns Promise resolving to the updated DiscoveryCandidateDto
 * @throws Error if the request fails (non-ok response)
 */
export async function reviewCandidate(
  projectId: string,
  architectureId: string,
  runId: string,
  candidateId: string,
  reviewStatus: string,
  reviewedBy?: string
): Promise<DiscoveryCandidateDto> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/review`;

  const body: Record<string, string> = { review_status: reviewStatus };
  if (reviewedBy) {
    body.reviewed_by = reviewedBy;
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Review candidate request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryCandidateDto>;
}

/**
 * Saves all approved candidates for a discovery run to the canonical model.
 *
 * Triggers the manual save-back path which selects only candidates
 * with review_status === 'approved' and persists them as canonical
 * meta-model entities.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   URL embeds `:architectureId`. Group 8 wires the save-back confirmation
 *   modal that gates this call.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture identifier (the run's bound id,
 *                         per Group 8 -- defensive even though it should
 *                         match the URL active id)
 * @param runId - The discovery run identifier
 * @returns Promise resolving to the save result with counts
 * @throws Error if the request fails (non-ok response)
 */
export async function saveApprovedCandidates(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<SaveApprovedResult> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/save-approved`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Save approved candidates request failed: ${res.status}`);
  }

  return res.json() as Promise<SaveApprovedResult>;
}

/**
 * DRY-RUN variant of {@link saveApprovedCandidates} (Skipped-candidate
 * visibility + grouped bulk-fill (C1), 2026-06-20, Task Group 5).
 *
 * Sends `?commit=false` so the gateway threads the flag through to the MCP
 * `save_approved_candidates` tool, which runs the REAL ~25-branch save-back
 * resolution against the (already-drafted) candidate state and returns the
 * would-commit / would-still-block PROJECTION WITHOUT persisting anything (no
 * model PUT, no candidate transition, no finding emission). This is the C1
 * panel's PREVIEW: because it runs the real path it CANNOT drift from the
 * subsequent commit (mirrors the `commit=false` preview / `commit=true` commit
 * pattern in `MigrationDeliveryBulkResolveModal`).
 *
 * Returns the SAME {@link SaveApprovedResult} shape as the committing call --
 * including the `reasons[]` arm + `suppressedDuplicates[]` / `possibleDuplicates[]`
 * -- so the preview renders identically to a real save outcome.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run is bound to
 * @param runId - The discovery run identifier
 * @returns Promise resolving to the would-commit / would-still-block projection
 * @throws Error if the request fails (non-ok response)
 */
export async function previewSaveApprovedCandidates(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<SaveApprovedResult> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/save-approved?commit=false`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The flag also rides the body for transports that drop the query string;
    // the gateway accepts either. Default (no flag) stays a real commit.
    body: JSON.stringify({ commit: false }),
  });

  if (!res.ok) {
    throw new Error(`Preview save approved candidates request failed: ${res.status}`);
  }

  return res.json() as Promise<SaveApprovedResult>;
}

/**
 * Full per-candidate field UPDATE over the existing AMS `PUT /{candidateId}`
 * (Skipped-candidate visibility + grouped bulk-fill (C1), 2026-06-20, Task
 * Group 5). The AMS server has always supported a full-field candidate edit (it
 * takes a whole {@link DiscoveryCandidateDto} and replaces the persisted row,
 * `data` blob included) but the UI never wired it; this is the single-row
 * companion to {@link bulkCandidateEdit} for a one-off per-candidate fix.
 *
 * snake_case wire (mirrors {@link reviewCandidate} / {@link getDiscoveryCandidates}).
 * The PUT body is the FULL candidate DTO (the AMS endpoint does a wholesale
 * replace, NOT a partial overlay -- for a partial `data` overlay across many
 * rows use {@link bulkCandidateEdit}). Returns the updated DiscoveryCandidateDto.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run is bound to
 * @param runId - The discovery run identifier
 * @param candidateId - The candidate being updated
 * @param update - The full candidate DTO to persist
 * @returns Promise resolving to the updated DiscoveryCandidateDto
 * @throws Error if the request fails (non-ok response)
 */
export async function updateCandidate(
  projectId: string,
  architectureId: string,
  runId: string,
  candidateId: string,
  update: DiscoveryCandidateDto
): Promise<DiscoveryCandidateDto> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });

  if (!res.ok) {
    throw new Error(`Update candidate request failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryCandidateDto>;
}

/**
 * One curated candidate patch in a {@link BulkCandidateEditRequest} (snake_case
 * wire -- mirrors the AMS `BulkCandidateEditRequest.Patch`). PATCH-style: an
 * omitted (undefined) top-level field leaves the persisted value untouched, and
 * `data` is a PARTIAL OVERLAY merged onto the existing candidate `data` JSONB
 * (supplied keys win; absent keys preserved; a key mapped to `null` clears that
 * one key). `candidate_id` is required. The `data` map keys are a passthrough
 * blob Jackson serializes VERBATIM (it does NOT snake_case map keys), so a
 * camelCase `data` key like `controllerClassName` round-trips unchanged.
 */
export interface BulkCandidateEditPatch {
  candidate_id: string;
  name?: string;
  candidate_type?: string;
  status?: string;
  review_status?: string;
  confidence?: number;
  operation?: string;
  data?: Record<string, unknown>;
}

/** Request body for the atomic bulk-candidate-EDIT endpoint (snake_case wire). */
export interface BulkCandidateEditRequest {
  patches: BulkCandidateEditPatch[];
}

/**
 * Response body for the atomic bulk-candidate-EDIT endpoint (snake_case wire --
 * mirrors the AMS `BulkCandidateEditResponse`). The endpoint is ATOMIC: on a 2xx
 * EVERY curated patch applied, so `applied_count === requested_count` and
 * `applied` carries the FULL updated candidate rows (so the caller can refresh
 * its grid directly without a follow-up GET). There is deliberately NO per-item
 * `failed[]` arm -- any single-patch failure rolls the WHOLE batch back and
 * surfaces as a non-2xx `{ error }` (handled by {@link bulkCandidateEdit}
 * rejecting).
 */
export interface BulkCandidateEditResponse {
  applied_count: number;
  requested_count: number;
  ids: string[];
  applied: DiscoveryCandidateDto[];
}

/**
 * ATOMIC bulk per-candidate field EDIT over a curated candidate set
 * (Skipped-candidate visibility + grouped bulk-fill (C1), 2026-06-20, Task
 * Group 5). POSTs the curated `patches` (each a per-candidate top-level field +
 * `data`-overlay change) to the gateway bulk-edit route:
 *   POST .../runs/:runId/candidates/bulk-edit
 *
 * The gateway is a pure proxy; the AMS endpoint applies all patches in ONE
 * `@Transactional` -- so this resolves with the full applied result, or REJECTS
 * on a non-2xx with NOTHING mutated (the whole batch rolled back). There is no
 * partial success: treat any non-2xx as a WHOLE-BATCH failure. This is the
 * primitive the C1 panel uses to bulk-fill the missing field(s) that blocked or
 * degraded a group of candidates before re-attempting the save. snake_case wire.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run is bound to
 * @param runId - The discovery run identifier
 * @param patches - The curated per-candidate field patches
 * @returns Promise resolving to the atomic { applied_count, requested_count, ids, applied[] }
 * @throws Error if the request fails (non-2xx -> the atomic batch rolled back)
 */
export async function bulkCandidateEdit(
  projectId: string,
  architectureId: string,
  runId: string,
  patches: BulkCandidateEditPatch[]
): Promise<BulkCandidateEditResponse> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/candidates/bulk-edit`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patches } as BulkCandidateEditRequest),
  });

  if (!res.ok) {
    // Non-2xx == the whole atomic batch rolled back (no partial result).
    throw new Error(`Bulk candidate edit request failed: ${res.status}`);
  }

  return res.json() as Promise<BulkCandidateEditResponse>;
}

/**
 * Creates a new discovery run for a project, triggering the pipeline.
 *
 * V3 Tier UX (Spec 2026-04-20):
 * - Optional `confirmLlmSolo` forwarded to the backend. When omitted and the
 *   backend determines Tier C applies, it returns 409 with
 *   `LLM_SOLO_CONFIRMATION_REQUIRED`. This method throws
 *   `LlmSoloConfirmationRequiredError` in that case so callers can prompt
 *   the user and retry with `confirmLlmSolo: true`.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6:
 *   The URL now embeds `:architectureId` (the run's bound architecture for
 *   life). projectId + architectureId travel via the URL only -- they are
 *   NOT sent in the body. Hard cutover -- forgetting `architectureId` 404s
 *   at the gateway router boundary.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run will be bound to for life
 * @param options - Optional flags. `confirmLlmSolo: true` opts the request into a Tier C run.
 * @returns Promise resolving to the created DiscoveryRunDto
 * @throws LlmSoloConfirmationRequiredError on 409 LLM_SOLO_CONFIRMATION_REQUIRED
 * @throws Error if the request fails for any other reason
 */
export async function createDiscoveryRun(
  projectId: string,
  architectureId: string,
  options?: { confirmLlmSolo?: boolean; serviceId?: string }
): Promise<DiscoveryRunDto> {
  // Spec #4 Task Group 6: hard cutover to architecture-scoped path. The
  // gateway proxy at `gateway/src/routes/discovery.ts` matches
  //   POST /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs
  // and forwards to discovery-service
  //   POST /discovery/projects/:projectId/architectures/:architectureId/runs.
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs`;

  // projectId and architectureId travel via the URL path. Only the
  // optional discovery-service inputs (serviceId, confirmLlmSolo) go in
  // the body -- matches the runs router contract in
  // discovery-service/src/routes/runs.ts.
  const body: Record<string, unknown> = {};
  if (options?.confirmLlmSolo) {
    body.confirmLlmSolo = true;
  }
  if (options?.serviceId) {
    body.serviceId = options.serviceId;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    // Parse the error envelope and, when it is an LLM-solo confirmation
    // request, surface a typed error so the UI can open a confirm dialog.
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // fall through to generic error
    }
    const envelope = (parsed as { error?: { code?: string; tier?: string; mode?: string; warnings?: string[] } } | null)?.error;
    if (envelope?.code === 'LLM_SOLO_CONFIRMATION_REQUIRED') {
      throw new LlmSoloConfirmationRequiredError(
        (envelope.tier as 'C') ?? 'C',
        envelope.mode ?? 'llm-solo',
        Array.isArray(envelope.warnings) ? envelope.warnings : []
      );
    }
    throw new Error(`Create discovery run failed: 409`);
  }

  if (!res.ok) {
    throw new Error(`Create discovery run failed: ${res.status}`);
  }

  return res.json() as Promise<DiscoveryRunDto>;
}

/**
 * Spec 2026-05-10 Runtime Log Input at Discovery Run Start -- Task Group 4
 * Spec 2026-05-11 Discovery Run Robustness -- Section 1
 *
 * Multipart upload of one-or-more runtime log files for a discovery run
 * that has already been created. The file inputs are appended under the
 * field name `logFiles` (multer accepts any field name; the gateway route
 * reads via `multer().any()`).
 *
 * Spec 2026-05-11 Section 1:
 *   - Optional 5th argument `maxLogPathPrefixSegments` rides the same
 *     multipart request as a JSON-string field named `runtimeEvidenceConfig`
 *     with value `JSON.stringify({ maxLogPathPrefixSegments })`. When omitted
 *     the field is NOT appended, preserving backwards-compat for callers that
 *     don't yet pass an M value.
 *
 * IMPORTANT: do NOT set Content-Type manually. The browser supplies the
 * multipart boundary parameter automatically when `body` is a `FormData`.
 *
 * @param projectId - The project identifier
 * @param architectureId - The architecture the run is bound to
 * @param runId - The discovery run identifier (already created)
 * @param files - The selected File[] from the modal
 * @param maxLogPathPrefixSegments - Optional M value for the tier-3 matcher
 * @throws Error if the request fails (non-ok response)
 */
export async function uploadDiscoveryRunLogFiles(
  projectId: string,
  architectureId: string,
  runId: string,
  files: File[],
  maxLogPathPrefixSegments?: number
): Promise<unknown> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/log-files`;

  const formData = new FormData();
  for (const file of files) {
    formData.append('logFiles', file);
  }

  // Spec 2026-05-11 Section 1: rider field carrying the M value. Only
  // appended when the caller supplies a number, so existing callers that
  // omit this 5th argument produce a byte-for-byte identical request body.
  if (typeof maxLogPathPrefixSegments === 'number') {
    formData.append(
      'runtimeEvidenceConfig',
      JSON.stringify({ maxLogPathPrefixSegments })
    );
  }

  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = text ? `: ${text}` : '';
    } catch {
      // ignore
    }
    throw new Error(`Failed to upload discovery run log files (${res.status})${detail}`);
  }

  return res.json();
}

/**
 * Upload operator-supplied API contract files (WADL/WSDL/XSD) to a discovery
 * run (2026-08-02) — the service-discovery analogue of API Baseline Capture's
 * contract upload. Multipart field `contractFiles`; the gateway inlines each
 * file's text onto `config_snapshot.contractFiles[]` so the pipeline reads
 * them as an authoritative Interface/Endpoint source. Fire AFTER the run is
 * created and BEFORE it processes (mirrors `uploadDiscoveryRunLogFiles`).
 */
export async function uploadDiscoveryRunContractFiles(
  projectId: string,
  architectureId: string,
  runId: string,
  files: File[]
): Promise<unknown> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/contract-files`;

  const formData = new FormData();
  for (const file of files) {
    formData.append('contractFiles', file);
  }

  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = text ? `: ${text}` : '';
    } catch {
      // ignore
    }
    throw new Error(`Failed to upload discovery run contract files (${res.status})${detail}`);
  }
  return res.json();
}

// ============================================================================
// Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Group 5
//
// DB-specific API surface:
//   testDatabaseConnection(config) -- exercises the discovery-service probe.
//     The connection metadata + credentials live in the request body only;
//     the discovery-service holds the password in-memory for the probe and
//     purges it on completion. The frontend never persists username /
//     password beyond the in-form state.
// ============================================================================

/**
 * Supported DB engines for the v1 Database Discovery Packs spec. PostgreSQL
 * is fully executable in Group 3; Sybase ASE is executable via the
 * `sybase-discovery-sidecar/` JVM helper (Group 4) so both are enabled in
 * the v1 UI.
 */
export type DiscoveryDatabaseEngine = 'postgres' | 'sybase';

/**
 * Profiling-mode ladder (D8): `none | basic | standard | deep`. Default is
 * 'standard'. `deep` requires an explicit second-click confirmation in the
 * UI before the run starts.
 */
export type DiscoveryDatabaseProfilingMode = 'none' | 'basic' | 'standard' | 'deep';

/**
 * Sybase-only driver choice. `auto` (default) lets the sidecar try jTDS
 * first and fall through to jConnect on failure; explicit values force one
 * driver. Ignored when `dbEngine !== 'sybase'`.
 */
export type DiscoverySybaseDriverChoice = 'auto' | 'jtds' | 'jconnect';

/**
 * DTO sent to the gateway's `/api/v1/discovery/db/test-connection` endpoint.
 *
 * The gateway is a pure pass-through -- the discovery-service validates,
 * defaults missing fields, and runs the probe via the engine pack.
 *
 * `password` is on the request body ONLY; the discovery-service stores it
 * in-process for the probe and purges it on completion. The frontend MUST
 * NOT persist the password beyond the form lifetime (no localStorage,
 * sessionStorage, or context).
 */
export interface DiscoveryDatabaseConnectionConfig {
  dbEngine: DiscoveryDatabaseEngine;
  host: string;
  port: number;
  databaseName: string;
  /** Optional schema-list filters; null/undefined means "no filter". */
  includeSchemas?: string[] | null;
  excludeSchemas?: string[] | null;
  includeTables?: string[] | null;
  excludeTables?: string[] | null;
  profilingMode?: DiscoveryDatabaseProfilingMode;
  /** Required confirmation flag -- gates the Start Run button in the UI. */
  readOnlyConfirmed: boolean;
  /** Second-confirmation flag for `deep` profiling mode (D8). */
  deepProfilingConfirmed?: boolean;
  username: string;
  password: string;
  /**
   * Sybase-only: which JDBC driver flavour the sidecar should attempt.
   * `auto` is the default. Ignored when `dbEngine !== 'sybase'`.
   */
  sybaseDriver?: DiscoverySybaseDriverChoice;
}

/**
 * Result of the connectivity probe.
 *
 * `success: true` with optional server metadata when the engine pack
 * connected and ran a trivial liveness query. `success: false` with the
 * engine's error message verbatim when the probe failed (invalid
 * credentials, host unreachable, etc.). The gateway forwards a 400 HTTP
 * status alongside the failure body so the UI can render the error inline.
 */
export interface DiscoveryDatabaseTestConnectionResult {
  success: boolean;
  engine: DiscoveryDatabaseEngine;
  serverVersion?: string | null;
  serverEdition?: string | null;
  /**
   * Sybase-only: which driver flavour actually opened (or last attempted) the
   * connection. Populated by the sidecar in `auto` mode so the UI can show
   * which one worked; null for non-Sybase engines.
   */
  driverUsed?: string | null;
  error?: { code: number; message: string };
}

/**
 * Calls the gateway's `POST /api/v1/discovery/db/test-connection` proxy
 * with the given config + credentials. Returns the parsed body on success
 * AND on connection-failure (400) -- both shapes carry `success` so the UI
 * branches on that. Throws only on 5xx / network errors that the user
 * cannot recover from inline.
 */
export async function testDatabaseConnection(
  config: DiscoveryDatabaseConnectionConfig,
): Promise<DiscoveryDatabaseTestConnectionResult> {
  const url = `${GATEWAY_BASE}/api/v1/discovery/db/test-connection`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  // 400 == probe ran but the connection failed -- the engine error message
  // is in the body. Parse and return the body so the caller can render it
  // alongside the success path.
  if (res.status === 400) {
    return (await res.json()) as DiscoveryDatabaseTestConnectionResult;
  }
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = text ? `: ${text}` : '';
    } catch {
      // ignore
    }
    throw new Error(`Test connection failed (${res.status})${detail}`);
  }
  return (await res.json()) as DiscoveryDatabaseTestConnectionResult;
}
