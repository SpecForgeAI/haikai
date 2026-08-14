/**
 * Spec-Generation API Client
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 *
 * Frontend client for two HTTP surfaces consumed by the new
 * Migration Shape-Spec Generation workspace (Task Groups 9 - 11):
 *
 *   1. Architecture-Model-Service (direct) — the spec-generation persistence
 *      and summary endpoints from Task Group 8. The workspace reads these to
 *      render summary totals, batch results, and per-WorkItem rows.
 *
 *      - GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary
 *      - GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations
 *      - GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations
 *
 *   2. Gateway (orchestration) — the batch-generation entry point exposed by
 *      Task Group 6's handler (`runShapeSpecGenerationBatch`). This client
 *      POSTs the batch request and receives the per-batch result. A single
 *      story regenerate is the same handler invoked with a single-story
 *      target.
 *
 *      - POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/generate-batch
 *      - POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/regenerate-single
 *
 * 2026-05-20 (Cross-Story Context Injection, Task Group 7) extension:
 *   - Per-row mapper surfaces the new pass-2 fields the gateway returns
 *     (`generation_pass`, `pass1_spec_text`, `pass2_changes_summary`,
 *     `budget_meta_json`, `no_meaningful_change`, `decisions_json`,
 *     `interfaces_json`, `assumptions_json`).
 *   - `startBatchGeneration` and `regenerateSingleStory` recognise the
 *     gateway's HTTP 409 `WorkstreamLockedError` envelope and throw a
 *     typed error so the dialog/dashboard can render a "Batch in progress"
 *     banner instead of a generic error toast.
 *
 * 2026-05-20 (Spec Quality Scoring, Task Group 7/8) extension:
 *   - `recomputeSpecQuality(projectId, specId)` POSTs the gateway proxy for
 *     single-row quality recompute, returning the four quality fields.
 *   - `recomputeAllSpecQuality(projectId)` POSTs the gateway proxy for the
 *     project-wide bulk recompute, returning the summary with grade
 *     breakdown.
 *
 * 2026-05-20 (In-Product Spec Editor + Confirm-Overwrite, Task Groups 7+9)
 * extension:
 *   - Per-row mapper surfaces the new manual-edit audit fields (`manually_edited`,
 *     `last_manually_edited_at`, `last_manually_edited_by`, `previous_spec_text`).
 *   - `manualEditSpec(projectId, specId, specText, editedBy)` POSTs the gateway
 *     manual-edit proxy with `X-User-Id` carrying `editedBy`.
 *   - `fetchManuallyEditedInScope(projectId, bookOfWorkId, workItemIds?)`
 *     GETs the gateway pre-flight proxy used by the bulk overwrite picker.
 *   - `startBatchGeneration` and `regenerateSingleStory` accept the new
 *     `overwriteManuallyEdited` + `manuallyEditedWorkItemIdsToOverwrite`
 *     fields so the confirm-overwrite modals can opt the batch in.
 *
 * 2026-06-14 (Implementation-Ready Migration Spec Generation, Spec 1 of 4)
 * extension:
 *   - Per-row mapper surfaces the two new persisted fields (`structured_tests_json`
 *     -> `structuredTestsJson`; `covered_endpoint_ids` -> `coveredEndpointIds`)
 *     so the review surfaces can render the read-only unit/functional Test Pack
 *     tile (D6) and carry the forward-only endpoint-coverage groundwork (D9).
 *     The scope-in/out + acceptance-criteria tiles are derived read-only from
 *     `generatedSpecText` (see `utils/migrationSpecSection.ts`) -- they are NOT
 *     separate AMS columns.
 *
 * Notes for tests:
 *   - All call sites in the workspace components import the named functions
 *     from this module so Vitest tests can stub them with
 *     `vi.mock('../../../api/specGenerationApi')`.
 *   - This module mirrors `frontend/src/api/implementWorkspaceApi.ts` and
 *     `frontend/src/api/migrationDeliveryPlanApi.ts` patterns.
 */

const MODEL_SERVICE_BASE = import.meta.env.VITE_MODEL_SERVICE_BASE_URL ?? '';
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Status + confidence vocabularies
// ============================================================================

export type SpecGenerationStatus =
  | 'not_attempted'
  | 'generated'
  | 'generated_with_warnings'
  | 'insufficient_context'
  | 'failed'
  | 'skipped_blocked';

export type SpecGenerationConfidence = 'high' | 'medium' | 'low';

export type SpecGenerationPredictedReadiness =
  | 'ready_for_spec'
  | 'needs_focused_context'
  | 'needs_user_decision'
  | 'blocked';

// ============================================================================
// Summary endpoint DTO (matches `SpecGenerationSummary` record on AMS)
// ============================================================================

/**
 * Wire shape returned by GET `.../spec-generation-summary`.
 *
 * The AMS `SpecGenerationSummary` record is serialised by Jackson with the
 * default camelCase naming (no `@JsonProperty` annotations on that record),
 * so the wire shape matches the camelCase fields below.
 */
export interface SpecGenerationSummaryDto {
  totalStories: number;
  savedStoryCount: number;
  attemptedCount: number;
  generatedCount: number;
  generatedWithWarningsCount: number;
  insufficientContextCount: number;
  failedCount: number;
  skippedBlockedCount: number;
  notAttemptedCount: number;
  nextBatchStart: number;
  nextBatchSize: number;
}

// ============================================================================
// Per-row DTO (matches `MigrationStorySpecGenerationDto` record on AMS,
// which uses snake_case `@JsonProperty` keys on the wire)
// ============================================================================

interface SpecGenerationRowDto {
  id: string | null;
  project_id: string | null;
  work_item_id: string | null;
  book_of_work_id: string | null;
  book_item_id: string | null;
  status: SpecGenerationStatus;
  confidence: SpecGenerationConfidence | null;
  predicted_readiness: SpecGenerationPredictedReadiness | null;
  generated_spec_text: string | null;
  warnings_json: Array<Record<string, unknown>> | null;
  missing_inputs_json: Array<Record<string, unknown>> | null;
  focused_context_refs_json: Record<string, unknown> | null;
  evidence_refs_json: string[] | null;
  generated_at: string | null;
  error_message: string | null;
  generation_attempt_number: number | null;
  created_by_task: string | null;
  created_at: string | null;
  updated_at: string | null;
  // Cross-Story Context Injection (2026-05-20, Task Group 5 enrichment).
  generation_pass?: number | null;
  pass1_spec_text?: string | null;
  pass2_changes_summary?: string | null;
  budget_meta_json?: Record<string, unknown> | null;
  no_meaningful_change?: boolean | null;
  decisions_json?: string[] | null;
  interfaces_json?: string[] | null;
  assumptions_json?: string[] | null;
  // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 1 entity
  // surfacing through AMS DTO). Wire keys are snake_case from the AMS @JsonProperty
  // annotations.
  manually_edited?: boolean | null;
  last_manually_edited_at?: string | null;
  last_manually_edited_by?: string | null;
  previous_spec_text?: string | null;
  // Implementation-Ready Migration Spec Generation (2026-06-14, Spec 1 of 4).
  // Wire keys are snake_case from the AMS @JsonProperty annotations; the gateway
  // batch response emits the same keys via its `toAmsWireShape`.
  structured_tests_json?: Array<Record<string, unknown>> | null;
  covered_endpoint_ids?: string[] | null;
}

/** Camel-cased per-row shape that components consume. */
export interface SpecGenerationRow {
  id: string | null;
  projectId: string | null;
  workItemId: string | null;
  bookOfWorkId: string | null;
  bookItemId: string | null;
  status: SpecGenerationStatus;
  confidence: SpecGenerationConfidence | null;
  predictedReadiness: SpecGenerationPredictedReadiness | null;
  generatedSpecText: string | null;
  warnings: Array<Record<string, unknown>>;
  missingInputs: Array<Record<string, unknown>>;
  focusedContextRefs: Record<string, unknown> | null;
  evidenceRefs: string[];
  generatedAt: string | null;
  errorMessage: string | null;
  generationAttemptNumber: number;
  createdByTask: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * Optional joined display fields supplied by the gateway batch response
   * (story title + parent epic/feature title) so the table can avoid a
   * second WorkItem fetch. These are populated by the gateway, NOT AMS.
   */
  storyTitle?: string;
  parentTitle?: string;
  parentType?: 'feature' | 'epic' | null;
  workstream?: string | null;
  recommendedNextAction?: string | null;
  reason?: string | null;
  /**
   * Manual-ready marker (Phase 1a, 2026-07-20): explicit story-by-story
   * acceptance of a human-supplied/edited spec. Gate semantics: satisfied =
   * status in (generated, generated_with_warnings) OR manualReady.
   */
  manualReady?: boolean;
  manualReadyBy?: string | null;
  /**
   * Stale marker (carry-over triage, 2026-07-26): a story AMENDED for a
   * finding keeps its generated spec but is marked stale server-side — it
   * drops out of the stage gate (server `isStorySpecReady` refuses stale) and
   * regenerates through the normal Generate-specs batch (which clears it).
   */
  stale?: boolean;
  staleReason?: string | null;
  // ---- Cross-Story Context Injection (2026-05-20) ----------------------
  /** 1 = pass-1 row; 2 = pass-2 row. Null on legacy rows. */
  generationPass?: number | null;
  /** Pass-1 spec text snapshot for inline diff against `generatedSpecText`. */
  pass1SpecText?: string | null;
  /** "What changed and why" blurb (pass-2 only). */
  pass2ChangesSummary?: string | null;
  /** Resolver's BudgetMeta envelope for the actually-executed call. */
  budgetMetaJson?: Record<string, unknown> | null;
  /** True when pass-2 output is byte-equivalent to pass-1 (badge driver). */
  noMeaningfulChange?: boolean | null;
  /** Parser-extracted decisions from the spec text. */
  decisionsJson?: string[] | null;
  /** Parser-extracted interface bullets from the spec text. */
  interfacesJson?: string[] | null;
  /** Parser-extracted assumptions from the spec text. */
  assumptionsJson?: string[] | null;
  // ---- In-Product Spec Editor + Confirm-Overwrite (2026-05-20) ---------
  /** True when a user has saved a manual edit through the drawer; cleared on overwrite-regenerate. */
  manuallyEdited?: boolean | null;
  /** Timestamp (ISO-8601) of the latest manual save. */
  lastManuallyEditedAt?: string | null;
  /** Identity (from the `X-User-Id` header) of the user who last saved. */
  lastManuallyEditedBy?: string | null;
  /** Single-slot prior LLM-generated text, captured immediately before the latest manual save. */
  previousSpecText?: string | null;
  // ---- Implementation-Ready Migration Spec Generation (2026-06-14) ------
  /**
   * Structured unit/functional test pack (D6). Each entry is a
   * `{ title, description, type: 'unit' | 'functional' }` object. Read-only on
   * the review surfaces; the Test Pack tile renders from this. Null/empty for
   * non-generated rows.
   */
  structuredTestsJson?: Array<Record<string, unknown>> | null;
  /**
   * Model EndpointEntity UUIDs this story migrates (D9). EMPTY for non-endpoint
   * stories. Forward-only groundwork -- carried but NOT consumed by any v1 tile.
   */
  coveredEndpointIds?: string[] | null;
}

function mapRowDtoToRow(dto: SpecGenerationRowDto): SpecGenerationRow {
  // Wire-case tolerance. TWO producers emit this row shape and they disagree on
  // case: the AMS `/spec-generations` + batch-persist responses are snake_case,
  // but the gateway batch-generation response returns its INTERNAL camelCase
  // `MigrationStorySpecGenerationDto` rows verbatim (the route forwards `result`
  // unchanged -- `toAmsWireShape` runs only on the AMS-persist path, NOT the
  // response). Read snake_case first, then the camelCase alias, so the
  // BatchResultsTable + StoryResultDrawer populate from EITHER producer. Without
  // this, a freshly-run batch shows blank confidence / warnings / missing-inputs
  // (and the "Resolve the missing inputs below" panel lists nothing) until a
  // page reload re-fetches the snake_case rows from AMS. Extends the
  // get(snake, camel) idiom already used for the impl-ready fields below.
  const c = dto as unknown as Record<string, unknown>;
  const s = (snake: string | null | undefined, key: string): string | null =>
    (snake ?? (c[key] as string | null | undefined)) ?? null;
  const a = <T>(snake: T[] | null | undefined, key: string): T[] =>
    (snake ?? (c[key] as T[] | null | undefined)) ?? [];
  return {
    id: s(dto.id, 'id'),
    projectId: s(dto.project_id, 'projectId'),
    workItemId: s(dto.work_item_id, 'workItemId'),
    bookOfWorkId: s(dto.book_of_work_id, 'bookOfWorkId'),
    bookItemId: s(dto.book_item_id, 'bookItemId'),
    status: dto.status,
    confidence:
      (dto.confidence ??
        (c.confidence as SpecGenerationConfidence | null | undefined)) ?? null,
    predictedReadiness:
      (dto.predicted_readiness ??
        (c.predictedReadiness as
          | SpecGenerationPredictedReadiness
          | null
          | undefined)) ?? null,
    generatedSpecText: s(dto.generated_spec_text, 'generatedSpecText'),
    warnings: a(dto.warnings_json, 'warningsJson'),
    missingInputs: a(dto.missing_inputs_json, 'missingInputsJson'),
    focusedContextRefs:
      (dto.focused_context_refs_json ??
        (c.focusedContextRefsJson as
          | Record<string, unknown>
          | null
          | undefined)) ?? null,
    evidenceRefs: a(dto.evidence_refs_json, 'evidenceRefsJson'),
    generatedAt: s(dto.generated_at, 'generatedAt'),
    errorMessage: s(dto.error_message, 'errorMessage'),
    generationAttemptNumber:
      (dto.generation_attempt_number ??
        (c.generationAttemptNumber as number | null | undefined)) ?? 0,
    createdByTask: s(dto.created_by_task, 'createdByTask'),
    createdAt: s(dto.created_at, 'createdAt'),
    updatedAt: s(dto.updated_at, 'updatedAt'),
    // Cross-Story Context Injection (2026-05-20).
    generationPass:
      (dto.generation_pass ??
        (c.generationPass as number | null | undefined)) ?? null,
    pass1SpecText: s(dto.pass1_spec_text, 'pass1SpecText'),
    pass2ChangesSummary: s(dto.pass2_changes_summary, 'pass2ChangesSummary'),
    budgetMetaJson:
      (dto.budget_meta_json ??
        (c.budgetMetaJson as Record<string, unknown> | null | undefined)) ??
      null,
    noMeaningfulChange:
      (dto.no_meaningful_change ??
        (c.noMeaningfulChange as boolean | null | undefined)) ?? null,
    decisionsJson:
      (dto.decisions_json ??
        (c.decisionsJson as string[] | null | undefined)) ?? null,
    interfacesJson:
      (dto.interfaces_json ??
        (c.interfacesJson as string[] | null | undefined)) ?? null,
    assumptionsJson:
      (dto.assumptions_json ??
        (c.assumptionsJson as string[] | null | undefined)) ?? null,
    // In-Product Spec Editor + Confirm-Overwrite (2026-05-20).
    manuallyEdited:
      (dto.manually_edited ??
        (c.manuallyEdited as boolean | null | undefined)) ?? null,
    lastManuallyEditedAt: s(dto.last_manually_edited_at, 'lastManuallyEditedAt'),
    lastManuallyEditedBy: s(dto.last_manually_edited_by, 'lastManuallyEditedBy'),
    previousSpecText: s(dto.previous_spec_text, 'previousSpecText'),
    // Implementation-Ready Migration Spec Generation (2026-06-14). Tolerant of
    // both the snake_case AMS wire and a camelCase gateway surface (belt-and-
    // braces, mirroring the existing get(snake, camel) idiom on the handler).
    structuredTestsJson:
      dto.structured_tests_json ??
      (dto as { structuredTestsJson?: Array<Record<string, unknown>> | null })
        .structuredTestsJson ??
      null,
    coveredEndpointIds:
      dto.covered_endpoint_ids ??
      (dto as { coveredEndpointIds?: string[] | null }).coveredEndpointIds ??
      null,
    // Display-only join fields (2026-07-20): the readable story + parent titles
    // the gateway batch response supplies (camelCase), so the table shows names
    // rather than raw work-item UUIDs. Tolerant of a snake_case producer too.
    storyTitle:
      (c.storyTitle as string | undefined) ??
      (c.story_title as string | undefined) ??
      undefined,
    parentTitle:
      (c.parentTitle as string | undefined) ??
      (c.parent_title as string | undefined) ??
      undefined,
    // Manual-ready marker (Phase 1a, 2026-07-20): explicit story-by-story
    // acceptance of a human-supplied spec. Drives the `spec ✎ manual` chip and
    // the Phase 1b stage gate.
    manualReady:
      ((dto as { manual_ready?: boolean | null }).manual_ready ??
        (c.manualReady as boolean | null | undefined)) ?? false,
    manualReadyBy: s(
      (dto as { manual_ready_by?: string | null }).manual_ready_by,
      'manualReadyBy',
    ),
    // Stale marker (2026-07-26): an amended story's spec must read as
    // needing regeneration, not as satisfied.
    stale:
      ((dto as { stale?: boolean | null }).stale ??
        (c.stale as boolean | null | undefined)) ?? false,
    staleReason: s(
      (dto as { stale_reason?: string | null }).stale_reason,
      'staleReason',
    ),
  };
}

// ============================================================================
// Gateway batch generation request / response
// ============================================================================

/**
 * Input for the gateway batch endpoint. Mirrors the
 * `RunShapeSpecGenerationBatchInput` shape on the gateway handler.
 */
export interface StartBatchGenerationRequest {
  projectId: string;
  bookOfWorkId: string;
  /** Optional override of the default 25-story batch size. */
  batchSize?: number;
  /** R-8: bumps generation_attempt_number and overwrites prior generated rows. */
  regenerateAll?: boolean;
  /** R-6: when true, blocked stories are recorded as `skipped_blocked` rather than attempted. */
  skipBlockedStories?: boolean;
  /** Acceptance signal 17 — pass true to overwrite a manually-edited spec. */
  confirmOverwrite?: boolean;
  /**
   * Optional WorkItem id whitelist. When provided, the batch is restricted
   * to ONLY those WorkItem ids (matched against `book_of_work_json.items[].workItemId`).
   *
   * Consumed by the Migration Delivery Dashboard's needs-attention bulk
   * regenerate buttons (Addition A of spec 2026-05-19
   * Migration-Delivery-Progress-and-Evidence-Tracking) so the
   * "Regenerate all failed specs" + "Regenerate all insufficient-context
   * specs" buttons can scope a regenerate-all batch to the currently
   * filtered needs-attention rows. The gateway handler already supports
   * this field (see `targetWorkItemIds` in
   * `gateway/src/services/migrationShapeSpecGenerationHandler.ts`).
   */
  targetWorkItemIds?: string[];
  /**
   * Cross-Story Context Injection (2026-05-20): per-batch override of the
   * project-level `auto_run_pass_2` flag. Forwards verbatim to the gateway
   * handler. Omit to use the project setting.
   */
  autoRunPass2?: boolean;
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20): when true,
   * the gateway batch handler passes the flag through to AMS so manually-
   * edited rows are eligible for overwrite. The optional allow-list narrows
   * the overwrite to specific WorkItem ids; rows not in the list are
   * skipped (and surfaced on the result's `skippedManuallyEditedWorkItemIds`).
   */
  overwriteManuallyEdited?: boolean;
  manuallyEditedWorkItemIdsToOverwrite?: string[];
}

/**
 * Per-batch result envelope returned by the gateway. The handler in Group 6
 * defines `BatchResult`; this is the wire view.
 */
export interface BatchGenerationResult {
  perStoryResults: SpecGenerationRow[];
  persistedCount: number;
  resultsCouldNotPersist: number;
  unpersistedResults: SpecGenerationRow[];
  nextBatchStart: number;
  summary: {
    generated: number;
    generated_with_warnings: number;
    insufficient_context: number;
    failed: number;
    skipped_blocked: number;
  };
  /** Cross-Story Context Injection: per-pass split when pass 2 ran. */
  passOneResults?: SpecGenerationRow[];
  passTwoResults?: SpecGenerationRow[];
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20): counts of rows
   * the batch skipped because they were manually-edited and the flag was
   * not set (or was set but the row was excluded from the allow-list).
   * Drives the "X stories skipped because they were manually edited"
   * summary in the post-batch result panel.
   */
  skippedManuallyEditedCount?: number;
  skippedManuallyEditedWorkItemIds?: string[];
}

interface BatchGenerationResultDto {
  perStoryResults: SpecGenerationRowDto[];
  persistedCount: number;
  resultsCouldNotPersist: number;
  unpersistedResults: SpecGenerationRowDto[];
  nextBatchStart: number;
  summary: {
    generated: number;
    generated_with_warnings: number;
    insufficient_context: number;
    failed: number;
    skipped_blocked: number;
  };
  passOneResults?: SpecGenerationRowDto[];
  passTwoResults?: SpecGenerationRowDto[];
  skippedManuallyEditedCount?: number;
  skippedManuallyEditedWorkItemIds?: string[];
}

function mapBatchResultDto(dto: BatchGenerationResultDto): BatchGenerationResult {
  return {
    perStoryResults: (dto.perStoryResults ?? []).map(mapRowDtoToRow),
    persistedCount: dto.persistedCount ?? 0,
    resultsCouldNotPersist: dto.resultsCouldNotPersist ?? 0,
    unpersistedResults: (dto.unpersistedResults ?? []).map(mapRowDtoToRow),
    nextBatchStart: dto.nextBatchStart ?? 0,
    summary: dto.summary ?? {
      generated: 0,
      generated_with_warnings: 0,
      insufficient_context: 0,
      failed: 0,
      skipped_blocked: 0,
    },
    passOneResults: dto.passOneResults
      ? dto.passOneResults.map(mapRowDtoToRow)
      : undefined,
    passTwoResults: dto.passTwoResults
      ? dto.passTwoResults.map(mapRowDtoToRow)
      : undefined,
    skippedManuallyEditedCount: dto.skippedManuallyEditedCount,
    skippedManuallyEditedWorkItemIds: dto.skippedManuallyEditedWorkItemIds,
  };
}

// ============================================================================
// WorkstreamLockedError (Cross-Story Context Injection 2026-05-20)
// ============================================================================

/**
 * Structured 409 error emitted by the gateway when a second concurrent batch
 * is requested for the same workstream. The dialog/dashboard surfaces this
 * as a banner ("Batch in progress (pass 1 of 2)" / "(pass 2 of 2)") instead
 * of a generic error toast.
 *
 * The `name` field is set to `WorkstreamLockedError` so callers can use a
 * simple `error.name === 'WorkstreamLockedError'` check or `instanceof`.
 */
export class WorkstreamLockedError extends Error {
  readonly workstreamId: string;
  readonly activePass: number;

  constructor(workstreamId: string, activePass: number, message?: string) {
    super(
      message ??
        `Workstream ${workstreamId} already has an active spec-generation batch (pass ${activePass})`,
    );
    this.name = 'WorkstreamLockedError';
    this.workstreamId = workstreamId;
    this.activePass = activePass;
  }
}

/**
 * Parse a 409 error body for the structured `WorkstreamLockedError` shape and
 * throw the typed error if it matches. Returns a generic Error otherwise so
 * the original control flow (throw new Error(...)) continues to apply.
 */
function maybeThrowWorkstreamLockedError(
  status: number,
  body: unknown,
): WorkstreamLockedError | null {
  if (status !== 409) return null;
  if (typeof body !== 'object' || body === null) return null;
  // Support both flat and nested shapes:
  //   { code, message, workstreamId, activePass }
  //   { error: { code, ... } }
  let candidate: Record<string, unknown> = body as Record<string, unknown>;
  if (
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    !('code' in candidate)
  ) {
    candidate = candidate.error as Record<string, unknown>;
  }
  if (
    candidate.code === 'WORKSTREAM_LOCKED' &&
    typeof candidate.workstreamId === 'string' &&
    typeof candidate.activePass === 'number'
  ) {
    return new WorkstreamLockedError(
      candidate.workstreamId,
      candidate.activePass,
      typeof candidate.message === 'string' ? candidate.message : undefined,
    );
  }
  return null;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch the per-book summary used by the workspace summary header.
 *
 * GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary
 */
export async function fetchSpecGenerationSummary(
  projectId: string,
  bookOfWorkId: string,
): Promise<SpecGenerationSummaryDto> {
  const url =
    `${MODEL_SERVICE_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generation-summary`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch spec-generation summary: ${res.status}`);
  }
  return (await res.json()) as SpecGenerationSummaryDto;
}

/**
 * Fetch the per-book list of generated rows.
 *
 * GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations
 */
export async function fetchSpecGenerationsForBook(
  projectId: string,
  bookOfWorkId: string,
): Promise<SpecGenerationRow[]> {
  const url =
    `${MODEL_SERVICE_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generations`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch spec generations for book ${bookOfWorkId}: ${res.status}`,
    );
  }
  const dtos = (await res.json()) as SpecGenerationRowDto[];
  return (dtos ?? []).map(mapRowDtoToRow);
}

/**
 * Fetch the per-WorkItem list (1:1 today, future-proofed as a list for
 * regeneration history). Used by the WorkItem Implement-tab chip lookup
 * (Task Group 12 / R-9).
 *
 * GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations
 */
export async function fetchSpecGenerationsForWorkItem(
  projectId: string,
  workItemId: string,
): Promise<SpecGenerationRow[]> {
  const url =
    `${MODEL_SERVICE_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/work-items/${encodeURIComponent(workItemId)}/spec-generations`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch spec generations for work item ${workItemId}: ${res.status}`,
    );
  }
  const dtos = (await res.json()) as SpecGenerationRowDto[];
  return (dtos ?? []).map(mapRowDtoToRow);
}

/**
 * Start a single batch of shape-spec generation through the gateway.
 * The gateway returns a synchronous per-batch envelope (R-3).
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/generate-batch
 *
 * Throws a typed `WorkstreamLockedError` on HTTP 409 so the dialog/dashboard
 * can render a "Batch in progress" banner.
 */
export async function startBatchGeneration(
  request: StartBatchGenerationRequest,
): Promise<BatchGenerationResult> {
  const { projectId, bookOfWorkId, ...body } = request;
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generations/generate-batch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore JSON parse failure
    }
    const locked = maybeThrowWorkstreamLockedError(res.status, parsed);
    if (locked) throw locked;
    const errorBody = (parsed ?? {}) as { message?: string; error?: string };
    const serverMessage =
      errorBody.message ||
      (typeof errorBody.error === 'string' ? errorBody.error : '') ||
      '';
    throw new Error(
      serverMessage ||
        `Shape-spec batch generation failed: ${res.status} ${res.statusText}`,
    );
  }
  const dto = (await res.json()) as BatchGenerationResultDto;
  return mapBatchResultDto(dto);
}

/**
 * Regenerate a single story through the gateway. The handler under the hood
 * is the same `runShapeSpecGenerationBatch` with a single-story target;
 * Failed-row retry buttons in the results table call this.
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/regenerate-single
 */
export async function regenerateSingleStory(input: {
  projectId: string;
  bookOfWorkId: string;
  workItemId: string;
  confirmOverwrite?: boolean;
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20): when true,
   * the gateway clears the four manual-edit columns after a successful
   * regenerate. The optional allow-list is forwarded verbatim so server-side
   * filtering can decide on a per-row basis.
   */
  overwriteManuallyEdited?: boolean;
  manuallyEditedWorkItemIdsToOverwrite?: string[];
}): Promise<BatchGenerationResult> {
  const {
    projectId,
    bookOfWorkId,
    workItemId,
    confirmOverwrite,
    overwriteManuallyEdited,
    manuallyEditedWorkItemIdsToOverwrite,
  } = input;
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generations/regenerate-single`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      workItemId,
      confirmOverwrite: !!confirmOverwrite,
      overwriteManuallyEdited:
        overwriteManuallyEdited === true ? true : undefined,
      manuallyEditedWorkItemIdsToOverwrite,
    }),
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore JSON parse failure
    }
    const locked = maybeThrowWorkstreamLockedError(res.status, parsed);
    if (locked) throw locked;
    const errorBody = (parsed ?? {}) as { message?: string; error?: string };
    const serverMessage =
      errorBody.message ||
      (typeof errorBody.error === 'string' ? errorBody.error : '') ||
      '';
    throw new Error(
      serverMessage ||
        `Shape-spec single-story regenerate failed: ${res.status} ${res.statusText}`,
    );
  }
  const dto = (await res.json()) as BatchGenerationResultDto;
  return mapBatchResultDto(dto);
}

// ============================================================================
// Spec Quality Scoring (2026-05-20, Task Group 7/8)
// ============================================================================

/**
 * One dimension entry in the quality breakdown. Mirrors the AMS
 * `SpecQualityScorerOutput.dimensions[]` shape.
 */
export interface QualityDimensionEntry {
  name: string;
  score: number;
  reason: string;
}

/**
 * Response from the single-row recompute endpoint. All four fields are
 * nullable because `insufficient_context`/`failed` rows store nulls (never
 * zero-graded F entries).
 */
export interface RecomputeSpecQualityResponse {
  qualityScore: number | null;
  qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  qualityDimensions: QualityDimensionEntry[] | null;
  previousQualityScore: number | null;
}

interface RecomputeSpecQualityWireDto {
  qualityScore?: number | null;
  qualityGrade?: string | null;
  qualityDimensions?: Array<{ name: string; score: number; reason: string }> | null;
  previousQualityScore?: number | null;
}

/**
 * Per-grade counts returned by the bulk recompute endpoint. `na` is the count
 * of rows that were skipped (insufficient_context/failed); it is NOT folded
 * into the A-F counts because the AMS write path stores those rows as nulls.
 */
export interface BulkRecomputeGradeBreakdown {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
  na: number;
}

/**
 * Response from the project-wide bulk recompute endpoint.
 */
export interface RecomputeAllSpecQualityResponse {
  totalScored: number;
  totalSkipped: number;
  gradeBreakdown: BulkRecomputeGradeBreakdown;
}

interface RecomputeAllSpecQualityWireDto {
  totalScored?: number;
  totalSkipped?: number;
  gradeBreakdown?: Partial<BulkRecomputeGradeBreakdown> | null;
}

/**
 * Recompute the quality score + grade + dimensions for a single spec row.
 *
 * POST /api/v1/projects/{projectId}/spec-generations/{specId}/recompute-quality
 *
 * Gateway pass-through to AMS (no LLM, fast). On `insufficient_context` /
 * `failed` rows the response carries all four fields as null because the
 * scorer is intentionally skipped server-side.
 */
export async function recomputeSpecQuality(
  projectId: string,
  specId: string,
): Promise<RecomputeSpecQualityResponse> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/${encodeURIComponent(specId)}/recompute-quality`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore JSON parse failure
    }
    const errorBody = (parsed ?? {}) as { message?: string; error?: string };
    const serverMessage =
      errorBody.message ||
      (typeof errorBody.error === 'string' ? errorBody.error : '') ||
      '';
    throw new Error(
      serverMessage ||
        `Spec quality recompute failed for spec ${specId}: ${res.status} ${res.statusText}`,
    );
  }
  const wire = (await res.json()) as RecomputeSpecQualityWireDto;
  // Normalise the grade string into the literal union (or null).
  const rawGrade = wire.qualityGrade ?? null;
  const grade =
    rawGrade === 'A' ||
    rawGrade === 'B' ||
    rawGrade === 'C' ||
    rawGrade === 'D' ||
    rawGrade === 'F'
      ? rawGrade
      : null;
  return {
    qualityScore: wire.qualityScore ?? null,
    qualityGrade: grade,
    qualityDimensions: wire.qualityDimensions ?? null,
    previousQualityScore: wire.previousQualityScore ?? null,
  };
}

/**
 * Recompute the quality score + grade + dimensions for every spec row in the
 * project. `insufficient_context`/`failed` rows are skipped (counted into
 * `totalSkipped` and `gradeBreakdown.na`).
 *
 * POST /api/v1/projects/{projectId}/spec-generations/recompute-quality-bulk
 *
 * Synchronous within request scope (no async job in v1 per spec.md). Returns
 * a summary the dashboard renders as a toast and then refreshes the
 * hierarchy so the chips reflect the new grades.
 */
export async function recomputeAllSpecQuality(
  projectId: string,
): Promise<RecomputeAllSpecQualityResponse> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/recompute-quality-bulk`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore JSON parse failure
    }
    const errorBody = (parsed ?? {}) as { message?: string; error?: string };
    const serverMessage =
      errorBody.message ||
      (typeof errorBody.error === 'string' ? errorBody.error : '') ||
      '';
    throw new Error(
      serverMessage ||
        `Bulk spec quality recompute failed: ${res.status} ${res.statusText}`,
    );
  }
  const wire = (await res.json()) as RecomputeAllSpecQualityWireDto;
  const breakdown = wire.gradeBreakdown ?? {};
  return {
    totalScored: wire.totalScored ?? 0,
    totalSkipped: wire.totalSkipped ?? 0,
    gradeBreakdown: {
      A: breakdown.A ?? 0,
      B: breakdown.B ?? 0,
      C: breakdown.C ?? 0,
      D: breakdown.D ?? 0,
      F: breakdown.F ?? 0,
      na: breakdown.na ?? 0,
    },
  };
}

// ============================================================================
// In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Groups 7+9)
// ============================================================================

/**
 * Per-row entry on the bulk overwrite picker. Shape mirrors the AMS
 * pre-flight endpoint's response (snake_case @JsonProperty on AMS, mapped to
 * camelCase here via {@link mapManuallyEditedScopeRowDto}).
 */
export interface ManuallyEditedScopeRow {
  workItemId: string;
  workItemTitle: string | null;
  specGenerationId: string | null;
  lastManuallyEditedAt: string | null;
  lastManuallyEditedBy: string | null;
}

interface ManuallyEditedScopeRowDto {
  // AMS may emit either snake_case or camelCase keys depending on whether the
  // record uses @JsonProperty annotations. The mapper reads both defensively
  // so the frontend is tolerant of either shape.
  work_item_id?: string;
  workItemId?: string;
  work_item_title?: string | null;
  workItemTitle?: string | null;
  spec_generation_id?: string | null;
  specGenerationId?: string | null;
  last_manually_edited_at?: string | null;
  lastManuallyEditedAt?: string | null;
  last_manually_edited_by?: string | null;
  lastManuallyEditedBy?: string | null;
}

function mapManuallyEditedScopeRowDto(
  dto: ManuallyEditedScopeRowDto,
): ManuallyEditedScopeRow {
  return {
    workItemId: String(dto.work_item_id ?? dto.workItemId ?? ''),
    workItemTitle: dto.work_item_title ?? dto.workItemTitle ?? null,
    specGenerationId: dto.spec_generation_id ?? dto.specGenerationId ?? null,
    lastManuallyEditedAt:
      dto.last_manually_edited_at ?? dto.lastManuallyEditedAt ?? null,
    lastManuallyEditedBy:
      dto.last_manually_edited_by ?? dto.lastManuallyEditedBy ?? null,
  };
}

/**
 * Save a user-supplied manual edit of a spec generation row.
 *
 * POST /api/v1/projects/{projectId}/spec-generations/{specId}/manual-edit
 *
 * The gateway forwards the `X-User-Id` header verbatim; `editedBy` is sourced
 * from that header on AMS, NOT from the body. The body carries only the new
 * `specText`. The response is the refreshed per-row DTO (snake_case wire
 * keys, mapped to camelCase here) so the drawer can replace its in-memory
 * row in a single round-trip.
 */
export async function manualEditSpec(
  projectId: string,
  specId: string,
  specText: string,
  editedBy: string,
): Promise<SpecGenerationRow> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/${encodeURIComponent(specId)}/manual-edit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-User-Id': editedBy,
    },
    body: JSON.stringify({ specText }),
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore JSON parse failure
    }
    const errorBody = (parsed ?? {}) as {
      message?: string;
      error?: string | { message?: string };
    };
    const nested =
      typeof errorBody.error === 'object' && errorBody.error
        ? errorBody.error.message
        : typeof errorBody.error === 'string'
          ? errorBody.error
          : '';
    const serverMessage = errorBody.message || nested || '';
    throw new Error(
      serverMessage ||
        `Manual edit failed for spec ${specId}: ${res.status} ${res.statusText}`,
    );
  }
  const dto = (await res.json()) as SpecGenerationRowDto;
  return mapRowDtoToRow(dto);
}

/**
 * Pre-flight: list the manually-edited spec rows in scope for a Generate-all
 * or Retry-batch run. The bulk overwrite picker uses this to populate the
 * per-row checkboxes (default UNCHECKED = skip).
 *
 * GET /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope[?workItemIds=...]
 *
 * When `candidateWorkItemIds` is supplied, AMS filters server-side to the
 * intersection (the retry-batch flow uses this to narrow the candidate set to
 * the rows the missing-input resolver has actually queued for retry).
 */
export async function fetchManuallyEditedInScope(
  projectId: string,
  bookOfWorkId: string,
  candidateWorkItemIds?: string[],
): Promise<ManuallyEditedScopeRow[]> {
  let url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generations/manually-edited-in-scope`;
  if (candidateWorkItemIds && candidateWorkItemIds.length > 0) {
    const qs = candidateWorkItemIds
      .map((id) => `workItemIds=${encodeURIComponent(id)}`)
      .join('&');
    url = `${url}?${qs}`;
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore JSON parse failure
    }
    const errorBody = (parsed ?? {}) as { message?: string; error?: string };
    const serverMessage =
      errorBody.message ||
      (typeof errorBody.error === 'string' ? errorBody.error : '') ||
      '';
    throw new Error(
      serverMessage ||
        `Failed to fetch manually-edited-in-scope rows: ${res.status} ${res.statusText}`,
    );
  }
  const dtos = (await res.json()) as ManuallyEditedScopeRowDto[];
  return (dtos ?? []).map(mapManuallyEditedScopeRowDto);
}

// ============================================================================
// Spec preflight — the ONE readiness function (Phase 0, 2026-07-20)
// ============================================================================

/** How a story would generate — the gateway batch loop's routing, named. */
export type SpecPreflightRoute =
  | 'db_pack'
  | 'db_pack_review'
  | 'manual_gate'
  | 'code_facts'
  | 'scaffold'
  | 'description'
  | 'prerequisite'
  | 'resolver';

/**
 * One story's preflight verdict. `ready` means the generator's OWN input
 * check passed (carriage inputs present, or focused context resolves with no
 * missing inputs) — the plan screen's readiness chip renders THIS, so it can
 * never disagree with what generation would do.
 */
export interface SpecPreflightRow {
  bookItemId: string;
  workItemId: string | null;
  title: string;
  route: SpecPreflightRoute;
  ready: boolean;
  missingInputs: Array<Record<string, unknown>>;
  note: string | null;
}

interface SpecPreflightRowDto {
  book_item_id: string;
  work_item_id: string | null;
  title: string;
  route: SpecPreflightRoute;
  ready: boolean;
  missing_inputs: Array<Record<string, unknown>>;
  note: string | null;
}

/** Book-level preflight warning (2026-08-14) — e.g. SCAFFOLD_STORY_MISSING. */
export interface SpecPreflightWarning {
  code: string;
  message: string;
}

/** Preflight outcome: per-story rows + book-level warnings. */
export interface SpecPreflightResult {
  rows: SpecPreflightRow[];
  warnings: SpecPreflightWarning[];
}

/**
 * Outcome of the saved-book scaffold-story mint (2026-08-14). `minted` /
 * `already_present` are success shapes; `manifest_missing` / `no_host_epic`
 * carry the remedy/reason.
 */
export interface ScaffoldMintOutcome {
  status: 'minted' | 'already_present' | 'manifest_missing' | 'no_host_epic';
  workItemId?: string | null;
  title?: string;
  remedy?: string;
  reason?: string;
}

/**
 * Mint the application-scaffold story into a SAVED book (2026-08-14). Epic
 * re-expansion is draft-only, so the plan-screen warning's "Create scaffold
 * story" button calls this additive path instead. 200 and 409 both carry a
 * structured outcome; anything else throws.
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/scaffold-story
 */
export async function mintScaffoldStory(
  projectId: string,
  bookOfWorkId: string,
): Promise<ScaffoldMintOutcome> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/scaffold-story`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200 && res.status !== 409) {
    throw new Error(`Scaffold-story mint failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ScaffoldMintOutcome;
}

/**
 * Run the spec preflight for a book. Read-only on the backend (no LLM); the
 * gateway executes the generator's first half per story and stops before the
 * LLM call.
 *
 * POST /api/v1/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/preflight
 */
export async function runSpecPreflight(
  projectId: string,
  bookOfWorkId: string,
): Promise<SpecPreflightResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generations/preflight`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Spec preflight failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    rows?: SpecPreflightRowDto[];
    warnings?: SpecPreflightWarning[];
  };
  return {
    rows: (body.rows ?? []).map((d) => ({
      bookItemId: d.book_item_id,
      workItemId: d.work_item_id ?? null,
      title: d.title,
      route: d.route,
      ready: d.ready,
      missingInputs: Array.isArray(d.missing_inputs) ? d.missing_inputs : [],
      note: d.note ?? null,
    })),
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
  };
}

/**
 * Mark (or unmark) a spec row MANUAL-READY — the explicit, story-by-story
 * acceptance of a human-supplied/edited spec (Phase 1a, 2026-07-20). AMS-direct
 * (same surface as the row reads); `X-User-Id` carries the audit identity.
 * There is deliberately NO bulk variant.
 *
 * POST /api/projects/{projectId}/spec-generations/{specId}/manual-ready
 */
export async function setSpecManualReady(
  projectId: string,
  specId: string,
  ready: boolean,
  markedBy: string,
): Promise<SpecGenerationRow> {
  const url =
    `${MODEL_SERVICE_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/${encodeURIComponent(specId)}/manual-ready`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-User-Id': markedBy,
    },
    body: JSON.stringify({ ready }),
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
      message || `Manual-ready update failed: ${res.status} ${res.statusText}`,
    );
  }
  return mapRowDtoToRow((await res.json()) as SpecGenerationRowDto);
}
