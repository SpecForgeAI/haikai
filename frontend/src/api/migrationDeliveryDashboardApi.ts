/**
 * Migration Delivery Dashboard API client.
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * -- Task Group 7 (Frontend API client).
 *
 * Single read-only client function targeting the new gateway proxy:
 *   GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard
 *
 * The gateway router (`migrationDeliveryDashboardRouter`) is mounted at `/api`
 * (NOT `/api/v1`) and pipes the upstream AMS response (status + body) through
 * byte-for-byte. The returned payload is the AMS-shaped DTO -- no envelope, no
 * re-shaping at the gateway.
 *
 * Wire format note (Follow-up #10):
 *   The AMS DTO records use `@JsonProperty(snake_case)` annotations, so the
 *   wire JSON keys are snake_case (e.g. `book_of_work_id`,
 *   `current_architecture_id`). Earlier revisions of this file exported the
 *   snake_case wire shape directly and made all UI components read snake_case
 *   fields. Follow-up #10 normalises the wire shape at THIS boundary: private
 *   `*WireDto` types capture the inbound JSON; `mapDashboard*` functions
 *   convert to the exported camelCase shapes; all UI components consume
 *   idiomatic camelCase. This matches the precedent in
 *   `frontend/src/api/specGenerationApi.ts` and avoids leaking snake_case into
 *   the rest of the frontend (which would friction any future feature that
 *   joins the dashboard DTOs with camelCase data).
 *
 * Reuse contract for Addition A (bulk regenerate):
 *   This module deliberately does NOT expose a bulk-regenerate function. The
 *   existing `specGenerationApi.startBatchGeneration` is reused unchanged --
 *   the needs-attention panel calls it with
 *   `{ regenerateAll: true, targetWorkItemIds: [...] }` as documented in
 *   spec.md (Addition A) and tasks.md (Task Group 10 -- Standing Constraint 10).
 *
 * Conventions mirror `frontend/src/api/specGenerationApi.ts` for naming,
 * URL building (`encodeURIComponent`), structured error parsing on non-2xx,
 * and TypeScript type co-location with the function definitions.
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 6/7/8 extends the
 * hierarchy-node DTO with a nullable `qualityGrade` field (wire key
 * `quality_grade`). The wire->camel mapper picks the new field up and the
 * `MigrationDeliveryHierarchyNodeDto` consumer type now carries it as an
 * optional nullable string so existing test fixtures keep compiling.
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4)
 * -- Task Group 4 adds `defineIntegrationTests(...)`, the POST client for the
 * per-feature/epic "Define Integration/E2E Tests" node action. Unlike the
 * read DTO above, the gateway's holistic-review handler builds its response
 * natively in TypeScript and emits it via `res.json(result)`, so the wire
 * shape is already idiomatic camelCase -- no wire->camel mapping layer is
 * needed for that endpoint.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Exported camelCase types -- consumed by all dashboard UI components.
// ============================================================================

/**
 * A single missing-input entry surfaced on insufficient-context needs-attention
 * rows / hierarchy nodes. Shape is `{ kind, id?, reason }` taken verbatim from
 * `migration_story_spec_generations.missing_inputs_json[]` (Liquibase
 * changeset 140). `id` is nullable because some "missing context" reasons are
 * categorical rather than referential.
 *
 * Field names are already idiomatic camelCase on the wire (single-word keys),
 * so this type is identical between wire + exported shape.
 */
export interface MissingInputEntry {
  kind: string;
  id: string | null;
  reason: string;
}

/** Umbrella counts roll-up. */
export interface MigrationDeliverySummaryDto {
  totalInitiativeCount: number;
  totalEpicCount: number;
  totalFeatureCount: number;
  totalStoryCount: number;
  needsAttentionCount: number;
}

/** A single node in the initiative -> epic -> feature -> story hierarchy. */
export interface MigrationDeliveryHierarchyNodeDto {
  id: string;
  parentId: string | null;
  type: string;
  title: string;
  workstream: string | null;
  sequenceOrder: number | null;
  workItemId: string | null;
  backlogStatus: string;
  specGenerationStatus: string | null;
  specGenerationConfidence: string | null;
  implementationStatus: string | null;
  evidenceStatus: string;
  needsAttentionCount: number;
  missingInputsCount: number | null;
  /**
   * Latest spec-generation row's `stale_reason` discriminator
   * (`target_architecture_changed` or `resolution_reset`); `null` when the
   * row is not stale or no spec exists. Surfaced here (rather than via a
   * separate per-WorkItem map) so the dashboard's stale-specs panel can
   * read the chip variant directly from the node DTO.
   *
   * Optional on the consumer type so legacy test fixtures and callers that
   * predate the AMS wire-shape addition continue to compile; the panel
   * null-coalesces internally.
   */
  staleReason?: string | null;
  /**
   * Spec: 2026-05-20 Spec Quality Scoring (Task Group 4.4 / 6.3).
   * Latest spec-generation row's `quality_grade` column (`A`/`B`/`C`/`D`/`F`)
   * or null when no spec row exists OR the latest row is
   * `insufficient_context`/`failed`. Optional on the consumer type so
   * legacy test fixtures keep compiling.
   */
  qualityGrade?: string | null;
  /**
   * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite (Task Group 4).
   * Latest spec-generation row's `manually_edited` discriminator. `true` when
   * a user has saved a manual edit through the drawer; cleared back to false
   * (or null) on a successful overwrite-regenerate. Optional on the consumer
   * type so legacy test fixtures continue to compile.
   */
  manuallyEdited?: boolean | null;
  /**
   * Spec: 2026-06-14 Net-new backlog items + provenance (D5).
   * The work item's `provenance` marker: `carry_over` (like-for-like, the
   * default -- a null/absent wire value normalises to `carry_over`) or
   * `net_new` (additive work deliberately outside the like-for-like
   * envelope). Surfaced on the node so the tree renders the provenance badge
   * + the dashboard drives the provenance filter. Optional on the consumer
   * type so legacy fixtures keep compiling.
   */
  provenance?: string | null;
  children: MigrationDeliveryHierarchyNodeDto[];
}

/** Per-workstream roll-up. */
export interface MigrationDeliveryWorkstreamSummaryDto {
  workstream: string;
  totalStoryCount: number;
  savedToBacklogCount: number;
  specGeneratedCount: number;
  implementationActiveCount: number;
  evidenceCoveredCount: number;
  needsAttentionCount: number;
}

/** A single row in the needs-attention panel. */
export interface MigrationDeliveryNeedsAttentionItemDto {
  bookItemId: string;
  workItemId: string | null;
  type: string;
  priorityRank: number;
  title: string;
  workstream: string | null;
  specGenerationStatus: string | null;
  specGenerationConfidence: string | null;
  implementationStatus: string | null;
  reason: string;
  missingInputs?: MissingInputEntry[] | null;
}

/** Per-status spec-generation counts. */
export interface MigrationDeliverySpecGenerationSummaryDto {
  notAttemptedCount: number;
  generatedCount: number;
  generatedWithWarningsCount: number;
  insufficientContextCount: number;
  failedCount: number;
  skippedBlockedCount: number;
}

/** Per-status backlog-save counts. */
export interface MigrationDeliveryBacklogSaveSummaryDto {
  savedCount: number;
  notSavedToBacklogCount: number;
}

/** Per-status implementation-workspace counts. */
export interface MigrationDeliveryImplementationSummaryDto {
  notStartedCount: number;
  inProgressCount: number;
  blockedCount: number;
  completedCount: number;
  activeCount: number;
}

/** Per-reference-kind evidence-coverage counts. */
export interface MigrationDeliveryEvidenceSummaryDto {
  evidenceReferenceCount: number;
  discoveryFindingReferenceCount: number;
  apiBaselineReferenceCount: number;
  mappingReferenceCount: number;
  architectureReferenceCount: number;
  anyCoverageCount: number;
}

/**
 * Top-level dashboard payload.
 *
 * `warnings` is the partial-roll-up + orphan + size-threshold surface:
 *   - Q-11 partial-roll-up entries naming each failed subsection.
 *   - Q-5 orphan-id entries naming each orphan book item.
 *   - Q-2 soft-warning entry when story count exceeds the ~500 threshold.
 */
export interface MigrationDeliveryDashboardDto {
  bookOfWorkId: string;
  projectId: string;
  currentArchitectureId: string | null;
  targetArchitectureId: string | null;
  title: string;
  status: string;
  generatedAt: string;
  summary: MigrationDeliverySummaryDto;
  hierarchy: MigrationDeliveryHierarchyNodeDto[];
  workstreamSummaries: MigrationDeliveryWorkstreamSummaryDto[];
  specGenerationSummary: MigrationDeliverySpecGenerationSummaryDto;
  backlogSaveSummary: MigrationDeliveryBacklogSaveSummaryDto;
  implementationSummary: MigrationDeliveryImplementationSummaryDto;
  evidenceSummary: MigrationDeliveryEvidenceSummaryDto;
  needsAttention: MigrationDeliveryNeedsAttentionItemDto[];
  warnings: string[];
}

// ============================================================================
// Private wire types -- inbound JSON shape with snake_case keys.
// Not exported; consumers should not touch these directly.
// ============================================================================

interface MigrationDeliverySummaryWireDto {
  total_initiative_count: number;
  total_epic_count: number;
  total_feature_count: number;
  total_story_count: number;
  needs_attention_count: number;
}

interface MigrationDeliveryHierarchyNodeWireDto {
  id: string;
  parent_id: string | null;
  type: string;
  title: string;
  workstream: string | null;
  sequence_order: number | null;
  work_item_id: string | null;
  backlog_status: string;
  spec_generation_status: string | null;
  spec_generation_confidence: string | null;
  implementation_status: string | null;
  evidence_status: string;
  needs_attention_count: number;
  missing_inputs_count: number | null;
  stale_reason?: string | null;
  // Spec Quality Scoring (2026-05-20): new wire field on the hierarchy node.
  quality_grade?: string | null;
  // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 4):
  // surfaces the latest spec row's `manually_edited` discriminator.
  manually_edited?: boolean | null;
  // Net-new backlog items + provenance (2026-06-14, D5): the work item's
  // `provenance` marker (`carry_over` default | `net_new`).
  provenance?: string | null;
  children: MigrationDeliveryHierarchyNodeWireDto[];
}

interface MigrationDeliveryWorkstreamSummaryWireDto {
  workstream: string;
  total_story_count: number;
  saved_to_backlog_count: number;
  spec_generated_count: number;
  implementation_active_count: number;
  evidence_covered_count: number;
  needs_attention_count: number;
}

interface MigrationDeliveryNeedsAttentionItemWireDto {
  book_item_id: string;
  work_item_id: string | null;
  type: string;
  priority_rank: number;
  title: string;
  workstream: string | null;
  spec_generation_status: string | null;
  spec_generation_confidence: string | null;
  implementation_status: string | null;
  reason: string;
  missing_inputs?: MissingInputEntry[] | null;
}

interface MigrationDeliverySpecGenerationSummaryWireDto {
  not_attempted_count: number;
  generated_count: number;
  generated_with_warnings_count: number;
  insufficient_context_count: number;
  failed_count: number;
  skipped_blocked_count: number;
}

interface MigrationDeliveryBacklogSaveSummaryWireDto {
  saved_count: number;
  not_saved_to_backlog_count: number;
}

interface MigrationDeliveryImplementationSummaryWireDto {
  not_started_count: number;
  in_progress_count: number;
  blocked_count: number;
  completed_count: number;
  active_count: number;
}

interface MigrationDeliveryEvidenceSummaryWireDto {
  evidence_reference_count: number;
  discovery_finding_reference_count: number;
  api_baseline_reference_count: number;
  mapping_reference_count: number;
  architecture_reference_count: number;
  any_coverage_count: number;
}

interface MigrationDeliveryDashboardWireDto {
  book_of_work_id: string;
  project_id: string;
  current_architecture_id: string | null;
  target_architecture_id: string | null;
  title: string;
  status: string;
  generated_at: string;
  summary: MigrationDeliverySummaryWireDto;
  hierarchy: MigrationDeliveryHierarchyNodeWireDto[];
  workstream_summaries: MigrationDeliveryWorkstreamSummaryWireDto[];
  spec_generation_summary: MigrationDeliverySpecGenerationSummaryWireDto;
  backlog_save_summary: MigrationDeliveryBacklogSaveSummaryWireDto;
  implementation_summary: MigrationDeliveryImplementationSummaryWireDto;
  evidence_summary: MigrationDeliveryEvidenceSummaryWireDto;
  needs_attention: MigrationDeliveryNeedsAttentionItemWireDto[];
  warnings: string[];
}

// ============================================================================
// Wire -> camelCase mappers (boundary-only; never invoked by consumers).
// ============================================================================

function mapSummary(
  w: MigrationDeliverySummaryWireDto,
): MigrationDeliverySummaryDto {
  return {
    totalInitiativeCount: w.total_initiative_count,
    totalEpicCount: w.total_epic_count,
    totalFeatureCount: w.total_feature_count,
    totalStoryCount: w.total_story_count,
    needsAttentionCount: w.needs_attention_count,
  };
}

function mapHierarchyNode(
  w: MigrationDeliveryHierarchyNodeWireDto,
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: w.id,
    parentId: w.parent_id,
    type: w.type,
    title: w.title,
    workstream: w.workstream,
    sequenceOrder: w.sequence_order,
    workItemId: w.work_item_id,
    backlogStatus: w.backlog_status,
    specGenerationStatus: w.spec_generation_status,
    specGenerationConfidence: w.spec_generation_confidence,
    implementationStatus: w.implementation_status,
    evidenceStatus: w.evidence_status,
    needsAttentionCount: w.needs_attention_count,
    missingInputsCount: w.missing_inputs_count,
    staleReason: w.stale_reason ?? null,
    qualityGrade: w.quality_grade ?? null,
    manuallyEdited: w.manually_edited ?? null,
    provenance: w.provenance ?? null,
    children: (w.children ?? []).map(mapHierarchyNode),
  };
}

function mapWorkstreamSummary(
  w: MigrationDeliveryWorkstreamSummaryWireDto,
): MigrationDeliveryWorkstreamSummaryDto {
  return {
    workstream: w.workstream,
    totalStoryCount: w.total_story_count,
    savedToBacklogCount: w.saved_to_backlog_count,
    specGeneratedCount: w.spec_generated_count,
    implementationActiveCount: w.implementation_active_count,
    evidenceCoveredCount: w.evidence_covered_count,
    needsAttentionCount: w.needs_attention_count,
  };
}

function mapNeedsAttentionItem(
  w: MigrationDeliveryNeedsAttentionItemWireDto,
): MigrationDeliveryNeedsAttentionItemDto {
  return {
    bookItemId: w.book_item_id,
    workItemId: w.work_item_id,
    type: w.type,
    priorityRank: w.priority_rank,
    title: w.title,
    workstream: w.workstream,
    specGenerationStatus: w.spec_generation_status,
    specGenerationConfidence: w.spec_generation_confidence,
    implementationStatus: w.implementation_status,
    reason: w.reason,
    missingInputs: w.missing_inputs,
  };
}

function mapSpecGenerationSummary(
  w: MigrationDeliverySpecGenerationSummaryWireDto,
): MigrationDeliverySpecGenerationSummaryDto {
  return {
    notAttemptedCount: w.not_attempted_count,
    generatedCount: w.generated_count,
    generatedWithWarningsCount: w.generated_with_warnings_count,
    insufficientContextCount: w.insufficient_context_count,
    failedCount: w.failed_count,
    skippedBlockedCount: w.skipped_blocked_count,
  };
}

function mapBacklogSaveSummary(
  w: MigrationDeliveryBacklogSaveSummaryWireDto,
): MigrationDeliveryBacklogSaveSummaryDto {
  return {
    savedCount: w.saved_count,
    notSavedToBacklogCount: w.not_saved_to_backlog_count,
  };
}

function mapImplementationSummary(
  w: MigrationDeliveryImplementationSummaryWireDto,
): MigrationDeliveryImplementationSummaryDto {
  return {
    notStartedCount: w.not_started_count,
    inProgressCount: w.in_progress_count,
    blockedCount: w.blocked_count,
    completedCount: w.completed_count,
    activeCount: w.active_count,
  };
}

function mapEvidenceSummary(
  w: MigrationDeliveryEvidenceSummaryWireDto,
): MigrationDeliveryEvidenceSummaryDto {
  return {
    evidenceReferenceCount: w.evidence_reference_count,
    discoveryFindingReferenceCount: w.discovery_finding_reference_count,
    apiBaselineReferenceCount: w.api_baseline_reference_count,
    mappingReferenceCount: w.mapping_reference_count,
    architectureReferenceCount: w.architecture_reference_count,
    anyCoverageCount: w.any_coverage_count,
  };
}

function mapDashboard(
  w: MigrationDeliveryDashboardWireDto,
): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: w.book_of_work_id,
    projectId: w.project_id,
    currentArchitectureId: w.current_architecture_id,
    targetArchitectureId: w.target_architecture_id,
    title: w.title,
    status: w.status,
    generatedAt: w.generated_at,
    summary: mapSummary(w.summary),
    hierarchy: (w.hierarchy ?? []).map(mapHierarchyNode),
    workstreamSummaries: (w.workstream_summaries ?? []).map(mapWorkstreamSummary),
    specGenerationSummary: mapSpecGenerationSummary(w.spec_generation_summary),
    backlogSaveSummary: mapBacklogSaveSummary(w.backlog_save_summary),
    implementationSummary: mapImplementationSummary(w.implementation_summary),
    evidenceSummary: mapEvidenceSummary(w.evidence_summary),
    needsAttention: (w.needs_attention ?? []).map(mapNeedsAttentionItem),
    warnings: w.warnings ?? [],
  };
}

// ============================================================================
// API function
// ============================================================================

/**
 * Fetch the Migration Delivery Dashboard for a single
 * `GeneratedMigrationBookOfWork`.
 *
 * GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard
 *
 * The endpoint always returns 200 with whichever subsections succeeded; any
 * failed subsection is named in the response's `warnings[]` list (Q-11). A
 * non-2xx response indicates that the gateway proxy itself failed (e.g.
 * upstream AMS unavailable, 503 envelope), book not found / project mismatch
 * (AMS 404 round-tripped verbatim), or a network-layer failure surfaced by the
 * runtime `fetch` call.
 *
 * Network errors surface as rejected promises so the caller (dashboard screen)
 * can swap the page contents for an error placeholder.
 *
 * @param projectId Project owning the book of work.
 * @param bookId    GeneratedMigrationBookOfWork id.
 * @returns The dashboard DTO (camelCase); rejected promise on any non-2xx response.
 */
export async function getMigrationDeliveryDashboard(
  projectId: string,
  bookId: string,
): Promise<MigrationDeliveryDashboardDto> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/delivery-dashboard`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to fetch migration delivery dashboard for book ${bookId}: ${res.status} ${res.statusText}`,
    );
  }
  const wire = (await res.json()) as MigrationDeliveryDashboardWireDto;
  return mapDashboard(wire);
}

// ============================================================================
// Repair-orphan response (follow-up #2)
// ============================================================================

/**
 * Wire shape returned by the orphan-repair endpoint, exposed as camelCase to
 * consumers. The frontend caller treats this primarily as a success signal --
 * the dashboard re-fetches the full `MigrationDeliveryDashboardDto` afterwards
 * so the panel + tree pick up the repaired item's new state.
 */
export interface RepairOrphanItemResponse {
  bookItemId: string;
  priorWorkItemId: string | null;
  newWorkItemId: string;
  message: string;
}

interface RepairOrphanItemWireResponse {
  book_item_id: string;
  prior_work_item_id: string | null;
  new_work_item_id: string;
  message: string;
}

/**
 * One-click repair for an orphan `book_of_work_json.items[].workItemId`
 * surfaced as a `not_saved_to_backlog` needs-attention row whose `workItemId`
 * field is non-null (the stale id). Clears the stale id and re-creates the
 * WorkItem in a single AMS transaction.
 *
 * 400 from AMS surfaces as a rejected promise carrying the AMS error message
 * (e.g. "book item is not orphan; stored workItemId still resolves: ..."). The
 * caller should re-fetch the dashboard on success to refresh badges + counts.
 *
 * Spec follow-up #2 -- orphan workItemId repair.
 */
export async function repairOrphanItem(
  projectId: string,
  bookId: string,
  bookItemId: string,
): Promise<RepairOrphanItemResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/items/${encodeURIComponent(bookItemId)}/repair-orphan`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to repair orphan book item ${bookItemId}: ${res.status} ${res.statusText}`,
    );
  }
  const wire = (await res.json()) as RepairOrphanItemWireResponse;
  return {
    bookItemId: wire.book_item_id,
    priorWorkItemId: wire.prior_work_item_id,
    newWorkItemId: wire.new_work_item_id,
    message: wire.message,
  };
}

// ============================================================================
// Stale-spec summary (Target Architecture Authoring Flow, Task Group 9)
// ============================================================================

/**
 * Project-scoped stale-spec summary surfaced on the Migration Delivery
 * Dashboard. The dashboard renders {@code staleCount} as a summary card
 * indicator and forwards {@code staleWorkItemIds} to the gateway batch
 * regeneration endpoint as {@code targetWorkItemIds} when the user clicks
 * "Regenerate stale".
 *
 * The AMS write path clears the per-row {@code stale} flag automatically on
 * successful regeneration, so the next refresh drops the count to zero.
 *
 * Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 9.
 */
export interface StaleSpecSummary {
  staleCount: number;
  staleWorkItemIds: string[];
}

/**
 * Fetch the project's stale-spec summary.
 *
 * GET /api/projects/{projectId}/spec-generations/stale-count
 *
 * Used by the Migration Delivery Dashboard's stale-spec indicator + the
 * "Regenerate stale" action. The endpoint is project-scoped, NOT
 * book-scoped: stale is a project-wide concern because target-architecture
 * changes invalidate every spec citing the changed elements regardless of
 * which book they originated from.
 */
export async function getStaleSpecSummary(
  projectId: string,
): Promise<StaleSpecSummary> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/stale-count`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to fetch stale-spec summary for project ${projectId}: ${res.status} ${res.statusText}`,
    );
  }
  const wire = (await res.json()) as Partial<StaleSpecSummary>;
  return {
    staleCount: wire.staleCount ?? 0,
    staleWorkItemIds: wire.staleWorkItemIds ?? [],
  };
}

// ============================================================================
// Define Integration/E2E Tests -- node action
// (Spec 2026-06-14 Holistic Integration/E2E TEST Work Items, Task Group 4)
// ============================================================================

/** The holistic review level the gateway derived from the node `type`. */
export type HolisticReviewLevel = 'feature' | 'epic';

/** One raw test definition the LLM produced (integration|e2e; MAY be empty). */
export interface HolisticTestDefinition {
  title: string;
  description: string;
  type: 'integration' | 'e2e';
}

/**
 * A child skipped by the ALLOW-WITH-WARNING gate: it is not spec-complete
 * (`insufficient_context` / `failed` / not-yet-generated), so the holistic
 * review did not include it. The user may close the gap and re-run.
 */
export interface SkippedChildWarning {
  bookItemId: string;
  workItemId: string | null;
  title: string;
  reason: string;
}

/** A TEST work item the action created (ONE per generated test). */
export interface CreatedTestItem {
  workItemId: string;
  bookItemId: string;
  title: string;
  type: 'integration' | 'e2e';
  sequenceOrder: number;
  /** True iff the `migration_story_spec_generations` row persisted. */
  specPersisted: boolean;
  /** True iff `implement-state.json` was written. */
  implementStateWritten: boolean;
}

/** A per-test failure (R-12 isolation; never aborts the batch). */
export interface FailedTestItem {
  index: number;
  title: string;
  type: 'integration' | 'e2e';
  reason: string;
}

/**
 * The response body of the per-feature/epic define-integration-tests action.
 *
 * The gateway handler builds this natively in TypeScript and emits it via
 * `res.json(result)`, so all keys are already idiomatic camelCase -- no
 * wire->camel mapping layer is needed here (unlike the AMS-shaped DTOs above).
 */
export interface DefineIntegrationTestsResult {
  level: HolisticReviewLevel;
  nodeBookItemId: string;
  nodeWorkItemId: string | null;
  /** The raw test definitions the LLM produced (MAY be empty -- no fabrication). */
  testPlan: HolisticTestDefinition[];
  /** ALLOW-WITH-WARNING: children skipped because they are not spec-complete. */
  skippedChildren: SkippedChildWarning[];
  /** Count of spec-complete children the review ran over. */
  specCompleteChildCount: number;
  /** The TEST items created (ONE per generated test). */
  createdTestItems: CreatedTestItem[];
  /** Per-test failures (isolated; never abort the batch). */
  failedTestItems: FailedTestItem[];
  /** True when the LLM returned no cross-cutting tests (no items created). */
  emptyPlan: boolean;
}

/**
 * Run the per-feature/epic "Define Integration/E2E Tests" holistic review.
 *
 * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/define-integration-tests
 *
 * `bookItemId` is the FEATURE or EPIC node's blob-item id within
 * `book_of_work_json` (the hierarchy node's `id`, NOT its `workItemId`). The
 * gateway runs the headless holistic-review handler over the node's
 * spec-complete children's specs, defines a small set of cross-cutting
 * integration/E2E tests, and creates each as a first-class `TEST` work item
 * placed as a SIBLING (blob item + work_item row + spec row +
 * implement-state.json).
 *
 * Gating is ALLOW-WITH-WARNING: insufficient/not-generated children are skipped
 * and listed in `skippedChildren[]`; the action never hard-blocks. The HTTP
 * status is 200 even when the LLM returned an empty plan (`emptyPlan: true`,
 * `createdTestItems: []`) or some per-test creations failed
 * (`failedTestItems[]`). A non-2xx response indicates a handler-level error
 * (e.g. the node could not be loaded) or a gateway/network failure, surfaced as
 * a rejected promise so the caller can show an error banner. The caller should
 * re-fetch the dashboard on success so the new TEST siblings appear in the
 * tree.
 *
 * @param projectId  Project owning the book of work.
 * @param bookId     GeneratedMigrationBookOfWork id.
 * @param bookItemId The FEATURE/EPIC node's blob-item id.
 * @returns The result body (camelCase); rejected promise on any non-2xx response.
 */
export async function defineIntegrationTests(
  projectId: string,
  bookId: string,
  bookItemId: string,
): Promise<DefineIntegrationTestsResult> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/items/${encodeURIComponent(bookItemId)}/define-integration-tests`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to define integration/E2E tests for node ${bookItemId}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as DefineIntegrationTestsResult;
}

// ============================================================================
// Migrate trigger + Migration Execution run-state + defer-this-story
// (Spec 2026-06-14 Migrate Button + Migration Execution Driver, Spec 3 of 4
//  -- Task Group 5)
// ============================================================================

/**
 * One blocking reason returned by the Migrate trigger when the HARD-BLOCK gate
 * refuses (CD-7). `code` is machine-stable (`story_not_spec_ready` /
 * `missing_current_baseline`); `message` is the human-readable reason; the
 * optional `workItemId` ties a `story_not_spec_ready` reason to its story so the
 * UI can list exactly what to resolve (generate that spec or defer it). Already
 * idiomatic camelCase on the wire (the gateway driver builds it in TypeScript).
 */
export interface MigrateBlockReason {
  code: string;
  message: string;
  workItemId?: string | null;
}

/**
 * The Migrate trigger response union (gateway
 * `POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/migrate`):
 *   - `started`  : the run was created + the first spec dispatched (202).
 *   - `blocked`  : the server-side hard-block refused; `reasons` lists exactly
 *                  what is blocking (409).
 *   - `error`    : a validation / driver error (4xx/5xx); `message` explains.
 *
 * The gateway re-validates the hard-block server-side regardless of the UI, so
 * `blocked` is authoritative: the UI surfaces `reasons` on attempt.
 */
export type TriggerMigrateResult =
  | { status: 'started'; runId: string; itemCount: number }
  | { status: 'blocked'; reasons: MigrateBlockReason[] }
  | { status: 'error'; message: string };

/**
 * One dispatched spec within a Migration Execution run (AMS
 * `migration_execution_run_item`, snake_case wire -- the gateway run-state
 * read proxies the AMS shape through byte-for-byte, so keys stay snake_case).
 */
export interface MigrationExecutionRunItemDto {
  id?: string;
  sequence_position?: number | null;
  work_item_id?: string | null;
  spec_name?: string | null;
  status?: string | null;
  dispatched?: boolean | null;
  job_id?: string | null;
  branch?: string | null;
  pr_url?: string | null;
  outcome?: string | null;
  deploy_on_complete?: boolean | null;
  target_base_url?: string | null;
  error_detail?: string | null;
  auto_answer_decision_log_json?: Array<Record<string, unknown>> | null;
}

/** One Migration Execution Driver run over one book of work (snake_case wire). */
export interface MigrationExecutionRunDto {
  id?: string;
  project_id?: string | null;
  book_of_work_id?: string | null;
  status?: string | null;
  current_sequence_position?: number | null;
  pinned_current_baseline_id?: string | null;
  target_base_url?: string | null;
  decision_log_json?: Array<Record<string, unknown>> | null;
  items?: MigrationExecutionRunItemDto[] | null;
}

/**
 * Kick off the whole big-bang migration for one book of work.
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/migrate
 *
 * The gateway-hosted Migration Execution Driver validates the HARD-BLOCK gate
 * server-side (CD-7): it refuses (409 `blocked`) if ANY in-scope (non-deferred)
 * story is not spec-ready OR no active `kind='current'` baseline exists,
 * returning the offending `reasons` list. On pass it pins the baseline, creates
 * the run, dispatches the FIRST spec, and returns immediately (202 `started`).
 *
 * This client maps each documented status to the {@link TriggerMigrateResult}
 * union rather than throwing on 409: `blocked` is an expected, actionable
 * outcome the UI surfaces (the user resolves by generating the offending specs
 * or deferring them). Only a network-layer failure rejects the promise.
 *
 * @param projectId Project owning the book of work.
 * @param bookId    GeneratedMigrationBookOfWork id.
 * @param body      The orchestration `{ company, project }` scope, plus the
 *                  per-plane scope (2026-07-26): `plane` restricts the run —
 *                  and every gate dimension — to that plane's stories
 *                  ("Start stage N" starts stage N only); `parityOverride`
 *                  is the break-glass past the DB data-parity precedence gate
 *                  when starting the service plane (recorded on the run).
 */
export async function triggerMigrate(
  projectId: string,
  bookId: string,
  body: {
    company: string;
    project: string;
    plane?: 'db' | 'service' | 'ui';
    parityOverride?: boolean;
  },
): Promise<TriggerMigrateResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/migrate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // fall through to the status-based fallback below
  }
  const obj = (payload ?? {}) as Record<string, unknown>;

  if (res.status === 202 || obj.status === 'started') {
    return {
      status: 'started',
      runId: String(obj.runId ?? ''),
      itemCount: typeof obj.itemCount === 'number' ? obj.itemCount : 0,
    };
  }
  if (res.status === 409 || obj.status === 'blocked') {
    return {
      status: 'blocked',
      reasons: Array.isArray(obj.reasons)
        ? (obj.reasons as MigrateBlockReason[])
        : [],
    };
  }
  return {
    status: 'error',
    message:
      typeof obj.message === 'string' && obj.message
        ? obj.message
        : `Failed to start the migration run: ${res.status} ${res.statusText}`,
  };
}

/**
 * Kick off a BATCH migration for a SELECTED subset of a book's work items.
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/migrate-selected
 *
 * The selected stories' specs are submitted to the implement-verify-service as
 * ONE job -> one `feature/<batchName>` branch + one merge request (instead of a
 * job/branch per spec). Same hard-block semantics as {@link triggerMigrate} but
 * scoped to the selection; `blocked`/`error` are mapped (not thrown) exactly as
 * the whole-book trigger, and only a network failure rejects.
 *
 * @param projectId Project owning the book of work.
 * @param bookId    GeneratedMigrationBookOfWork id.
 * @param body      `{ company, project, selectedWorkItemIds, batchName? }`.
 */
export async function triggerMigrateSelected(
  projectId: string,
  bookId: string,
  body: {
    company: string;
    project: string;
    selectedWorkItemIds: string[];
    batchName?: string;
  },
): Promise<TriggerMigrateResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/migrate-selected`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      company: body.company,
      project: body.project,
      // snake_case on the wire (the gateway route reads selected_work_item_ids /
      // batch_name per the AMS wire convention).
      selected_work_item_ids: body.selectedWorkItemIds,
      ...(body.batchName ? { batch_name: body.batchName } : {}),
    }),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // fall through to the status-based fallback below
  }
  const obj = (payload ?? {}) as Record<string, unknown>;

  if (res.status === 202 || obj.status === 'started') {
    return {
      status: 'started',
      runId: String(obj.runId ?? ''),
      itemCount: typeof obj.itemCount === 'number' ? obj.itemCount : 0,
    };
  }
  if (res.status === 409 || obj.status === 'blocked') {
    return {
      status: 'blocked',
      reasons: Array.isArray(obj.reasons) ? (obj.reasons as MigrateBlockReason[]) : [],
    };
  }
  return {
    status: 'error',
    message:
      typeof obj.message === 'string' && obj.message
        ? obj.message
        : `Failed to start the batch migration run: ${res.status} ${res.statusText}`,
  };
}

/**
 * Read the latest Migration Execution run + items for a book of work (the
 * dashboard's run-progress lookup).
 *
 * GET /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/migration-execution-run
 *
 * Returns `null` when no run has been kicked off for the book yet (the gateway
 * returns 404 in that case -- the run-progress view simply renders nothing).
 * A non-404 non-2xx rejects so the caller can surface an error. The payload is
 * the AMS-shaped run DTO (snake_case), proxied through the gateway verbatim.
 */
export async function getLatestMigrationExecutionRun(
  projectId: string,
  bookId: string,
): Promise<MigrationExecutionRunDto | null> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/migration-execution-run`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to read the migration execution run for book ${bookId}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as MigrationExecutionRunDto;
}

/**
 * The resume ("approve & continue") response union (gateway
 * `POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/resume`,
 * Spec W phased execution):
 *   - `resumed`    : the next plane's first spec was dispatched (200); `nextPlane`
 *                    is the plane now executing (`db` | `service` | `ui`).
 *   - `complete`   : nothing left to dispatch; the run is marked deployed (200).
 *   - `not_paused` : the run is not awaiting approval right now (409).
 *   - `blocked`    : the repositioned DB-plane data-parity gate refused; `reasons`
 *                    lists what is unclean — retry with `override` after review (409).
 *   - `error`      : a driver/validation error (4xx/5xx).
 */
export type ResumeMigrationResult =
  | { status: 'resumed'; nextPlane: string }
  | { status: 'complete' }
  | { status: 'not_paused'; message: string }
  | { status: 'blocked'; reasons: MigrateBlockReason[] }
  | { status: 'error'; message: string };

/**
 * Approve a run PAUSED at a plane boundary and dispatch the next plane (Spec W).
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/resume
 *
 * Only a run in `awaiting_approval` resumes. When the plane just completed was
 * the DB plane, the repositioned data-parity gate is re-checked server-side; a
 * non-clean parity returns `blocked` (retry with `override: true` for a human
 * sign-off). Like {@link triggerMigrate}, the documented non-2xx statuses are
 * mapped (not thrown); only a network failure rejects. The caller should refresh
 * the run on success so the progress view advances.
 */
export async function resumeMigrationRun(
  projectId: string,
  runId: string,
  body: { company: string; project: string; override?: boolean },
): Promise<ResumeMigrationResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}/resume`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // fall through to the status-based fallback below
  }
  const obj = (payload ?? {}) as Record<string, unknown>;
  if (obj.status === 'resumed') {
    return { status: 'resumed', nextPlane: String(obj.nextPlane ?? '') };
  }
  if (obj.status === 'complete') {
    return { status: 'complete' };
  }
  if (obj.status === 'not_paused') {
    return {
      status: 'not_paused',
      message: typeof obj.message === 'string' ? obj.message : 'Run is not awaiting approval',
    };
  }
  if (obj.status === 'blocked') {
    return {
      status: 'blocked',
      reasons: Array.isArray(obj.reasons) ? (obj.reasons as MigrateBlockReason[]) : [],
    };
  }
  return {
    status: 'error',
    message:
      typeof obj.message === 'string' && obj.message
        ? obj.message
        : `Failed to resume the migration run: ${res.status} ${res.statusText}`,
  };
}

/** The operator-halt response union (2026-07-28). */
export type HaltMigrationRunResult =
  | { status: 'halted'; itemsFailed: number }
  | { status: 'already_terminal'; runStatus: string }
  | { status: 'error'; message: string };

/**
 * Operator "halt run" — abandon a run wedged in a non-terminal status so a
 * fresh Start is possible (e.g. its IVS job died before the pipeline ran and
 * the failure callback never arrived).
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/halt
 *
 * Non-terminal items are marked failed with the reason; the run is halted.
 * The caller should refresh the latest run so the rail's Start re-enables.
 */
export async function haltMigrationRun(
  projectId: string,
  runId: string,
  reason?: string,
): Promise<HaltMigrationRunResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}/halt`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // fall through to the status-based fallback below
  }
  const obj = (payload ?? {}) as Record<string, unknown>;
  if (obj.status === 'halted') {
    return {
      status: 'halted',
      itemsFailed: typeof obj.itemsFailed === 'number' ? obj.itemsFailed : 0,
    };
  }
  if (obj.status === 'already_terminal') {
    return {
      status: 'already_terminal',
      runStatus: typeof obj.runStatus === 'string' ? obj.runStatus : '',
    };
  }
  return {
    status: 'error',
    message:
      typeof obj.message === 'string' && obj.message
        ? obj.message
        : `Failed to halt the migration run: ${res.status} ${res.statusText}`,
  };
}

/**
 * Set or clear the `deferred` flag on a story's work item (CD-7).
 *
 * PATCH /api/model/projects/{projectId}/work-items/{workItemId}/deferred
 *
 * Defer is implementation-EXCLUSION ONLY: a deferred story is NOT dispatched in
 * the Migrate run, so it drops out of the hard-block in-scope set (the
 * deliberate way to launch without an un-generated story). Deferring NEVER
 * removes the story from reconciliation scope -- because the story was not
 * migrated, it correctly surfaces as a break in Spec 4. The caller should
 * refresh the dashboard on success so the tree reflects the new state.
 *
 * The AMS route targets the work item directly (not via the gateway), matching
 * every other frontend AMS client. Body is snake_case `{ deferred }`; the route
 * 400s on a missing flag (we always send a boolean). A non-2xx rejects.
 */
export async function setStoryDeferred(
  projectId: string,
  workItemId: string,
  deferred: boolean,
): Promise<void> {
  const amsBase = import.meta.env.VITE_API_BASE_URL ?? '';
  const url =
    `${amsBase}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/work-items/${encodeURIComponent(workItemId)}/deferred`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ deferred }),
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to ${deferred ? 'defer' : 'un-defer'} story ${workItemId}: ${res.status} ${res.statusText}`,
    );
  }
}


// ============================================================================
// Add work item (Net-new backlog items + provenance, 2026-06-14, D5)
// ============================================================================

/** The captured add-item form values (camelCase). */
export interface AddWorkItemInput {
  provenance: 'carry_over' | 'net_new';
  kind: 'api' | 'operational';
  title: string;
  description: string;
  /**
   * (D6) The explicit `<METHOD> <path>` operation list for a net_new + api add
   * (the AUTHORITATIVE reconcile-time match source). Forwarded to the gateway
   * add-item route as the snake_case `net_new_operations` wire field, where it
   * rides the book_of_work_json blob item; the AMS service scopes the stamp to
   * net_new + api. Omit/empty for any other add.
   */
  netNewOperations?: string[];
}

/** The created-item result (camelCase, mapped from the snake_case gateway body). */
export interface AddWorkItemResult {
  workItemId: string | null;
  bookItemId: string | null;
  provenance: string | null;
  kind: string | null;
  message: string | null;
}

/**
 * Add ONE manual work item to a SAVED book of work before Migrate, then have the
 * gateway trigger DESCRIPTION-GROUNDED spec-gen for the created story.
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/items/add-item
 *
 * The gateway (1) calls the AMS add-item endpoint, which mints a `type='story'`
 * WorkItem + appends the `book_of_work_json.items[]` blob + stamps `provenance`
 * (column + blob) + the `kind` flavour, in one transaction; then (2) triggers
 * description-grounded generation for that `workItemId` (the human description
 * IS the context; `kind` only tunes the prompt flavour). The body is the
 * snake_case AMS shape; the response is round-tripped verbatim and mapped to
 * camelCase here. A non-2xx (400 missing title / 404 unknown book) rejects so the
 * caller can surface the error + keep the form open.
 */
export async function addWorkItem(
  projectId: string,
  bookId: string,
  input: AddWorkItemInput,
): Promise<AddWorkItemResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/items/add-item`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      provenance: input.provenance,
      kind: input.kind,
      title: input.title,
      description: input.description,
      // D6: forwarded verbatim; the gateway route passes it through to the AMS
      // add-item endpoint, which stamps it on the blob (net_new + api only).
      ...(input.netNewOperations && input.netNewOperations.length > 0
        ? { net_new_operations: input.netNewOperations }
        : {}),
    }),
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to add the work item to book ${bookId}: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    work_item_id?: string | null;
    book_item_id?: string | null;
    provenance?: string | null;
    kind?: string | null;
    message?: string | null;
  };
  return {
    workItemId: body.work_item_id ?? null,
    bookItemId: body.book_item_id ?? null,
    provenance: body.provenance ?? null,
    kind: body.kind ?? null,
    message: body.message ?? null,
  };
}

// ============================================================================
// Migration credentials status + target-DB registration (Residual 2, 2026-07-20)
// ============================================================================

/** The pack-DECLARED target-DB binding (coordinates only — never secrets). */
export interface TargetDbBinding {
  engine: string;
  host: string;
  port: number;
  database: string;
  schema: string;
  username: string;
  note?: string;
}

/**
 * The tool-DECLARED target-service serve-spec defaults (stage-2 Start modal,
 * 2026-07-31): derived from the target-state captured decisions; the
 * operator confirms or overrides. Host is always haibox's 127.0.0.1 and the
 * port is OS-assigned — neither is an input.
 */
export interface ServeSpecBinding {
  command: string;
  health_path: string;
  port_env: string;
  readiness_timeout: number;
  /** Optional bootstrap command run before `command` ('' = none, 2026-08-01). */
  setup: string;
  source: 'derived' | 'fallback';
  runtime_hint: string | null;
}

/** Presence + non-secret coordinates from the gateway's in-memory stores. */
export interface MigrationCredentialsStatus {
  targetBinding: TargetDbBinding | null;
  /** Stage-2 modal prefill (2026-07-31). */
  serviceBinding: ServeSpecBinding | null;
  source: {
    registered: boolean;
    dbType?: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
  };
  /** SOURCE service (current system API) presence — non-secret (2026-07-31). */
  sourceApi: {
    registered: boolean;
    current_base_url?: string;
    auth_type?: string;
  };
  targetRegistered: boolean;
  targetServiceRegistered: boolean;
}

/**
 * GET /api/v1/projects/{projectId}/migration-credentials-status
 *
 * The plan DECLARED the target binding (the plan creates the target DB), so
 * the Start-stage dialog prefills coordinates from here and asks the operator
 * for SECRETS only. Passwords never ride this endpoint.
 */
export async function fetchMigrationCredentialsStatus(
  projectId: string,
  opts: { architectureId?: string; runId?: string } = {},
): Promise<MigrationCredentialsStatus> {
  const params = new URLSearchParams();
  if (opts.architectureId) params.set('architectureId', opts.architectureId);
  if (opts.runId) params.set('runId', opts.runId);
  const qs = params.toString();
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-credentials-status${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to read migration credentials status: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    target_binding?: TargetDbBinding | null;
    service_binding?: ServeSpecBinding | null;
    source?: MigrationCredentialsStatus['source'];
    source_api?: MigrationCredentialsStatus['sourceApi'];
    target_registered?: boolean;
    target_service_registered?: boolean;
  };
  return {
    targetBinding: body.target_binding ?? null,
    serviceBinding: body.service_binding ?? null,
    source: body.source ?? { registered: false },
    sourceApi: body.source_api ?? { registered: false },
    targetRegistered: body.target_registered ?? false,
    targetServiceRegistered: body.target_service_registered ?? false,
  };
}

/**
 * Register the run's TARGET-DB credentials (in gateway memory only — never
 * persisted, never logged). Coordinates come prefilled from the declared
 * binding; the operator supplies the password. `api.type='none'` satisfies the
 * route's api-block requirement for a DB-only registration.
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/target-credentials
 */
export async function registerRunTargetDbCredentials(
  projectId: string,
  runId: string,
  db: {
    host: string;
    port: number;
    database: string;
    schema?: string | null;
    username: string;
    password: string;
  },
): Promise<void> {
  return registerRunStageCredentials(projectId, runId, {
    targetDb: { dbType: 'postgres', ...db },
  });
}

/** One DB credentials block (source or target side). */
export interface StageDbCredentials {
  dbType: 'postgres' | 'sybase';
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  password: string;
}

/** The stage-2 target-service serve spec (operator-confirmed). */
export interface StageServeSpec {
  command: string;
  healthPath: string;
  portEnv: string;
  readinessTimeout?: number;
  /** Optional bootstrap command haibox runs before `command` (2026-08-01). */
  setup?: string;
  env?: Record<string, string>;
}

/**
 * Register a stage's SOURCE + TARGET connection details in ONE call
 * (2026-07-31): stage 1 = source + target databases; stage 2 = source
 * service (current system API) + target service (serve spec). All in-memory
 * gateway-side — never persisted, never logged; lost on a gateway restart.
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/target-credentials
 */
export async function registerRunStageCredentials(
  projectId: string,
  runId: string,
  opts: {
    targetDb?: StageDbCredentials;
    sourceDb?: StageDbCredentials;
    service?: StageServeSpec;
    sourceApi?: { currentBaseUrl: string; authType: string; bearerToken?: string };
    /** Target-API auth for the reconcile replay; defaults to none. */
    apiAuthType?: string;
  },
): Promise<void> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}/target-credentials`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      api: { type: opts.apiAuthType ?? 'none' },
      ...(opts.targetDb ? { db: opts.targetDb } : {}),
      ...(opts.sourceDb ? { source_db: opts.sourceDb } : {}),
      ...(opts.service
        ? {
            service: {
              command: opts.service.command,
              health_path: opts.service.healthPath,
              port_env: opts.service.portEnv,
              ...(opts.service.readinessTimeout !== undefined
                ? { readiness_timeout: opts.service.readinessTimeout }
                : {}),
              ...(opts.service.setup ? { setup: opts.service.setup } : {}),
              ...(opts.service.env ? { env: opts.service.env } : {}),
            },
          }
        : {}),
      ...(opts.sourceApi
        ? {
            source_api: {
              current_base_url: opts.sourceApi.currentBaseUrl,
              api: {
                type: opts.sourceApi.authType,
                ...(opts.sourceApi.bearerToken
                  ? { bearerToken: opts.sourceApi.bearerToken }
                  : {}),
              },
            },
          }
        : {}),
    }),
  });
  if (!res.ok) {
    let message = '';
    try {
      const parsed = (await res.json()) as { error?: string };
      message = parsed.error ?? '';
    } catch {
      // ignore parse failure
    }
    throw new Error(
      message ||
        `Failed to register stage credentials: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Operator "Retry DB build" (2026-07-31): re-run the DB execution chain
 * (assemble -> schema-apply -> load -> reconcile) on a halted run whose
 * specs all implemented — without re-running the specs. 409 carries the
 * driver's fail-closed reason.
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/retry-db-completion
 */
export async function retryRunDbCompletion(
  projectId: string,
  runId: string,
  args: { company: string; project: string; bookId?: string },
): Promise<{ status: string; reason?: string }> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}/retry-db-completion`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      company: args.company,
      project: args.project,
      ...(args.bookId ? { book_id: args.bookId } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    reason?: string;
    error?: string;
  };
  if (!res.ok && res.status !== 409) {
    throw new Error(
      body.error || body.reason || `Failed to retry the DB build: ${res.status} ${res.statusText}`,
    );
  }
  return { status: body.status ?? (res.ok ? 'retrying' : 'error'), reason: body.reason };
}
