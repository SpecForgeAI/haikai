/**
 * Migration Book of Work API Client
 *
 * Spec 2026-05-17 PM Migration Delivery Plan / Book of Work Draft -- Task
 * Groups 11 + 12 (frontend review workspace + save-to-backlog UI + draft list).
 *
 * Frontend client for the AMS migration-books-of-work REST surface exposed
 * by the architecture-model-service (and proxied via the gateway for the
 * non-list endpoints):
 *
 *   GET    /api/projects/{projectId}/migration-books-of-work[?includeArchived=true]
 *   GET    /api/projects/{projectId}/migration-books-of-work/{bookId}
 *   PUT    /api/projects/{projectId}/migration-books-of-work/{bookId}
 *   POST   /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog
 *
 * AMS controllers + service trio (G7/G8) are the system of record. Per
 * shaping-notes Q-3 the persistence path is gateway -> AMS direct REST.
 * Per Q-14 the `book_of_work_json` blob carries the full hierarchy + per-
 * item metadata; the four sibling JSONB blobs round-trip as `Record<string,
 * unknown>` here.
 *
 * Per Q-16 `saveState` lives in **frontend state only** during a review
 * session and is persisted to `book_of_work_json` either:
 *   (a) on an explicit PUT (Save Draft button), or
 *   (b) as a side-effect of save-to-backlog (which writes back the post-save
 *       states).
 */

import type { MigrationBookOfWorkExpansionState } from './migrationDeliveryPlanApi';

export type { MigrationBookOfWorkExpansionState } from './migrationDeliveryPlanApi';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Domain enums (mirror Q-7 workstream vocab + readiness + confidence)
// ============================================================================

export type MigrationBookOfWorkItemType =
  | 'initiative'
  | 'epic'
  | 'feature'
  | 'story'
  /**
   * Known-gap debt item (Spec 2026-08-04-2 — Structural findings
   * dispositions): a structural finding dispositioned `known_gap`
   * materialises as one of these under the schema epic's "Known gaps
   * (accepted debt)" feature. Renders like a story with a "Known gap" chip;
   * always carries `execution:manual` + `known_gap` tags (human work — never
   * spec'ed, never dispatched). Auto-clears when a regenerated pack stops
   * emitting the finding.
   */
  | 'known_gap';

export type MigrationBookOfWorkConfidence = 'high' | 'medium' | 'low';

export type MigrationBookOfWorkReadiness =
  | 'ready_for_spec'
  | 'needs_focused_context'
  | 'needs_user_decision'
  | 'blocked';

/**
 * 14-value workstream vocabulary per Q-7 (13 from raw-idea + `unknown`
 * sentinel). The review-workspace filter (G11) surfaces `unknown` so the
 * reviewer can find and reclassify those items.
 */
export type MigrationBookOfWorkWorkstream =
  | 'target_service_api_implementation'
  | 'target_frontend_implementation'
  | 'target_database_schema_implementation'
  | 'target_infrastructure_environment_implementation'
  | 'data_migration'
  | 'api_soap_integration_compatibility'
  | 'internal_processing_implementation'
  | 'migration_test_pack'
  | 'reconciliation_reporting'
  | 'cutover_rollback_decommission'
  | 'architecture_refinement'
  | 'discovery_gap_resolution'
  | 'test_strategy'
  | 'other'
  | 'unknown';

export const ALL_WORKSTREAMS: MigrationBookOfWorkWorkstream[] = [
  'target_service_api_implementation',
  'target_frontend_implementation',
  'target_database_schema_implementation',
  'target_infrastructure_environment_implementation',
  'data_migration',
  'api_soap_integration_compatibility',
  'internal_processing_implementation',
  'migration_test_pack',
  'reconciliation_reporting',
  'cutover_rollback_decommission',
  'architecture_refinement',
  'discovery_gap_resolution',
  'test_strategy',
  'other',
  'unknown',
];

export type MigrationBookOfWorkSaveState =
  | 'draft'
  | 'selected'
  | 'excluded'
  | 'saved'
  | 'failed';

export type MigrationBookOfWorkStatus =
  | 'draft'
  | 'reviewed'
  | 'partially_saved'
  | 'saved'
  | 'archived'
  | 'failed';

// ============================================================================
// Item shape (mirrors the gateway's MigrationBookOfWorkItem schema)
// ============================================================================

export interface MigrationBookOfWorkItem {
  id: string;
  type: MigrationBookOfWorkItemType;
  parentId: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  workstream: MigrationBookOfWorkWorkstream;
  sequenceOrder: number;
  tags: string[];
  confidence: MigrationBookOfWorkConfidence;
  readiness: MigrationBookOfWorkReadiness;
  readinessReasons: string[];
  missingInputs: string[];
  recommendedNextAction: string;
  traceabilitySummary: string;
  evidenceReferences: string[];
  architectureReferences: string[];
  apiBaselineReferences: string[];
  discoveryFindingReferences: string[];
  mappingReferences: string[];
  sourceContextRefs: string[];
  /** Frontend-state-only during review per Q-16 -- only persisted on Save Draft PUT or save-to-backlog write-back. */
  saveState?: MigrationBookOfWorkSaveState;
  /** Populated after save-to-backlog success. */
  workItemId?: string | null;
  /** Populated on save failure. */
  errorMessage?: string | null;
  /**
   * Per-epic phase-2 expansion state (Spec 2026-06-11 Two-Phase
   * generation). Present on EPIC items of skeleton-generated drafts only;
   * rides inside `book_of_work_json` and is merged server-side by the AMS
   * items/append endpoint. Legacy full-plan drafts carry no expansion
   * state, so all expand affordances stay hidden for them.
   */
  expansionState?: MigrationBookOfWorkExpansionState;
}

// ============================================================================
// Top-level draft shape
// ============================================================================

/**
 * One accepted critical/high finding in the create-time coverage snapshot
 * (Spec 2026-06-11 Deterministic Findings-Coverage Verification). Mirrors
 * the gateway's `AcceptedFindingSnapshotEntry` wire shape verbatim.
 */
export interface MigrationFindingsCoverageSnapshotFinding {
  id: string;
  title: string;
  severity: string;
  runId: string;
}

/**
 * The deterministic accepted-findings snapshot persisted into
 * `generation_summary_json` at plan CREATE time (id-sorted,
 * timestamp-free). Absent on legacy drafts and on drafts whose snapshot
 * fetch fail-softed — `computeFindingsCoverage` returns `null` for those
 * and every consumer hides its coverage section entirely (D8).
 */
export interface MigrationFindingsCoverageSnapshot {
  findings: MigrationFindingsCoverageSnapshotFinding[];
}

export interface MigrationBookOfWorkGenerationSummary {
  initiativeCount?: number;
  epicCount?: number;
  featureCount?: number;
  storyCount?: number;
  // NOTE: the legacy LLM-asserted `findingsAddressed` / `findingsNotAddressed`
  // typed accessors are deliberately REMOVED (Spec 2026-06-11): coverage is
  // computed ON READ from `findingsCoverage` via
  // `utils/findingsCoverage.computeFindingsCoverage` — never read the legacy
  // keys back.
  findingsCoverage?: MigrationFindingsCoverageSnapshot;
  mappingsUsed?: number;
  unresolvedGaps?: number;
  [k: string]: unknown;
}

export interface MigrationBookOfWorkQualityAssessment {
  overallScore?: number;
  rationale?: string;
  [k: string]: unknown;
}

export interface MigrationBookOfWorkBlob {
  items: MigrationBookOfWorkItem[];
  [k: string]: unknown;
}

/**
 * Draft DTO as returned by AMS. JSONB blobs are decoded into typed shapes
 * where useful and left as `Record<string, unknown>` where the inner
 * structure is open-ended (per Q-14, partial drafts are representable so
 * all four blobs are nullable).
 */
export interface MigrationBookOfWorkDraft {
  id: string;
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
  status: MigrationBookOfWorkStatus;
  title: string | null;
  summary: string | null;
  generationInputs: Record<string, unknown> | null;
  generationSummary: MigrationBookOfWorkGenerationSummary | null;
  qualityAssessment: MigrationBookOfWorkQualityAssessment | null;
  bookOfWork: MigrationBookOfWorkBlob | null;
  createdAt: string;
  updatedAt: string;
  createdByTask: string;
  savedToBacklogAt: string | null;
  errorMessage: string | null;
}

// ============================================================================
// Save-to-backlog request + response
// ============================================================================

export type SaveToBacklogMode =
  | 'all'
  | 'selected'
  | 'high_confidence_only'
  | 'ready_for_spec_only';

export interface SaveToBacklogRequest {
  selectedItemIds?: string[];
  excludedItemIds?: string[];
  saveMode: SaveToBacklogMode;
  statusForCreatedItems?: string;
  includeTraceabilityInDescription?: boolean;
  includeReadinessInDescription?: boolean;
  tagPrefix?: string;
}

export interface SaveToBacklogResponse {
  draftId: string;
  status: MigrationBookOfWorkStatus;
  savedCount: number;
  failedCount: number;
  skippedCount: number;
  /** Updated `book_of_work_json` blob, with per-item `saveState` + `workItemId` populated. */
  bookOfWork: MigrationBookOfWorkBlob;
}

// ============================================================================
// Typed error
// ============================================================================

export interface MigrationBookOfWorkApiErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

export class MigrationBookOfWorkApiError extends Error {
  readonly status: number;
  readonly body: MigrationBookOfWorkApiErrorBody;
  constructor(
    status: number,
    body: MigrationBookOfWorkApiErrorBody,
    message?: string,
  ) {
    super(
      message ??
        body.message ??
        `Migration book of work API error (status ${status})`,
    );
    this.name = 'MigrationBookOfWorkApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(
  res: Response,
): Promise<MigrationBookOfWorkApiErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as MigrationBookOfWorkApiErrorBody;
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
// DTO mapping (snake_case wire -> camelCase frontend)
// ============================================================================

interface MigrationBookOfWorkDraftDto {
  id: string;
  project_id: string;
  current_architecture_id: string;
  target_architecture_id: string;
  status: MigrationBookOfWorkStatus;
  title: string | null;
  summary: string | null;
  generation_inputs_json: Record<string, unknown> | null;
  generation_summary_json: MigrationBookOfWorkGenerationSummary | null;
  quality_assessment_json: MigrationBookOfWorkQualityAssessment | null;
  book_of_work_json: MigrationBookOfWorkBlob | null;
  created_at: string;
  updated_at: string;
  created_by_task: string;
  saved_to_backlog_at: string | null;
  error_message: string | null;
}

/**
 * Wire shape of the AMS save-to-backlog response. AMS speaks snake_case (see
 * CLAUDE.md "AMS wire format"); the `SaveGeneratedMigrationBookOfWorkResponse`
 * record binds explicit snake_case @JsonProperty names and nests the counts
 * under a single `counts` map. The camelCase `SaveToBacklogResponse` is the
 * frontend-facing shape -- the two MUST be bridged by `mapSaveResponseDto`, or
 * `bookOfWork` reads back `undefined` and the post-save view wipes the draft's
 * items ("No items in this book of work").
 */
interface SaveToBacklogResponseDto {
  draft_id: string;
  draft_status: MigrationBookOfWorkStatus;
  counts: {
    saved?: number;
    failed?: number;
    skipped_already_saved?: number;
    skipped_not_admitted?: number;
    admitted?: number;
    [k: string]: unknown;
  } | null;
  book_of_work_json: MigrationBookOfWorkBlob | null;
  failed_items: Array<Record<string, unknown>> | null;
}

function mapSaveResponseDto(
  dto: SaveToBacklogResponseDto,
): SaveToBacklogResponse {
  const counts = dto.counts ?? {};
  return {
    draftId: dto.draft_id,
    status: dto.draft_status,
    savedCount: counts.saved ?? 0,
    failedCount: counts.failed ?? 0,
    skippedCount: counts.skipped_already_saved ?? 0,
    bookOfWork: dto.book_of_work_json ?? { items: [] },
  };
}

function mapDraftDto(dto: MigrationBookOfWorkDraftDto): MigrationBookOfWorkDraft {
  return {
    id: dto.id,
    projectId: dto.project_id,
    currentArchitectureId: dto.current_architecture_id,
    targetArchitectureId: dto.target_architecture_id,
    status: dto.status,
    title: dto.title,
    summary: dto.summary,
    generationInputs: dto.generation_inputs_json,
    generationSummary: dto.generation_summary_json,
    qualityAssessment: dto.quality_assessment_json,
    bookOfWork: dto.book_of_work_json,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    createdByTask: dto.created_by_task,
    savedToBacklogAt: dto.saved_to_backlog_at,
    errorMessage: dto.error_message,
  };
}

// ============================================================================
// API functions
// ============================================================================

/**
 * List migration delivery plan drafts for a project. Defaults to active
 * drafts only; pass `includeArchived=true` to reveal archived rows
 * produced by the Q-6 regenerate-on-same-tuple flow.
 */
export async function listMigrationBookOfWorks(
  projectId: string,
  options: { includeArchived?: boolean } = {},
): Promise<MigrationBookOfWorkDraft[]> {
  const encodedProjectId = encodeURIComponent(projectId);
  const qs = options.includeArchived ? '?includeArchived=true' : '';
  const url = `${API_BASE}/api/projects/${encodedProjectId}/migration-books-of-work${qs}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new MigrationBookOfWorkApiError(res.status, await parseErrorBody(res));
  }
  const dtos = (await res.json()) as MigrationBookOfWorkDraftDto[];
  return dtos.map(mapDraftDto);
}

/**
 * Fetch a single migration delivery plan draft by id. Returns the full
 * entity including all four JSONB blobs (Q-14).
 */
export async function getMigrationBookOfWork(
  projectId: string,
  bookId: string,
): Promise<MigrationBookOfWorkDraft> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(
    projectId,
  )}/migration-books-of-work/${encodeURIComponent(bookId)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new MigrationBookOfWorkApiError(res.status, await parseErrorBody(res));
  }
  const dto = (await res.json()) as MigrationBookOfWorkDraftDto;
  return mapDraftDto(dto);
}

/**
 * Persist editable fields (title / summary / status / `book_of_work_json`)
 * on a migration delivery plan draft. Used by the explicit "Save Draft"
 * button to flush frontend-only `saveState` deltas back into the persisted
 * `book_of_work_json` blob per Q-16. Other JSONB columns are immutable
 * post-create.
 */
export async function updateMigrationBookOfWork(
  projectId: string,
  bookId: string,
  patch: {
    title?: string | null;
    summary?: string | null;
    status?: MigrationBookOfWorkStatus;
    bookOfWork?: MigrationBookOfWorkBlob;
  },
): Promise<MigrationBookOfWorkDraft> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(
    projectId,
  )}/migration-books-of-work/${encodeURIComponent(bookId)}`;
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.bookOfWork !== undefined) body.book_of_work_json = patch.bookOfWork;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new MigrationBookOfWorkApiError(res.status, await parseErrorBody(res));
  }
  const dto = (await res.json()) as MigrationBookOfWorkDraftDto;
  return mapDraftDto(dto);
}

/**
 * Save selected items from the draft into the existing WorkItem hierarchy
 * via the AMS save-to-backlog endpoint. Per-item commits, idempotent
 * retry, and the parent-inclusion rule are all enforced server-side
 * (Q-5 / Q-8 / Q-10). The response includes the updated `book_of_work_json`
 * blob with `saveState` + `workItemId` per item so the post-save view can
 * render success / failure markers.
 */
export async function saveMigrationBookOfWorkToBacklog(
  projectId: string,
  bookId: string,
  request: SaveToBacklogRequest,
): Promise<SaveToBacklogResponse> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(
    projectId,
  )}/migration-books-of-work/${encodeURIComponent(bookId)}/save-to-backlog`;
  // AMS speaks snake_case at the wire (see CLAUDE.md "AMS wire format"); the
  // SaveGeneratedMigrationBookOfWorkRequest record binds explicit snake_case
  // @JsonProperty names. The camelCase `request` is the frontend-facing shape;
  // it MUST be serialised to snake_case here or every key binds to null and the
  // service rejects the missing `save_mode` with 400 Bad Request.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selected_item_ids: request.selectedItemIds,
      excluded_item_ids: request.excludedItemIds,
      save_mode: request.saveMode,
      status_for_created_items: request.statusForCreatedItems,
      include_traceability_in_description: request.includeTraceabilityInDescription,
      include_readiness_in_description: request.includeReadinessInDescription,
      tag_prefix: request.tagPrefix,
    }),
  });
  if (!res.ok) {
    throw new MigrationBookOfWorkApiError(res.status, await parseErrorBody(res));
  }
  return mapSaveResponseDto((await res.json()) as SaveToBacklogResponseDto);
}

/**
 * DELETE a story from the plan (Phase 1a, 2026-07-20) — the "plan created
 * something unwanted" escape hatch. Story-type only; one story per call
 * (never bulk). AMS removes the item, tombstones its id in
 * `suppressed_item_ids` (so re-expansion cannot resurrect it), and
 * best-effort archives a linked WorkItem.
 *
 * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/delete
 */
export async function deleteBookOfWorkStory(
  projectId: string,
  bookId: string,
  bookItemId: string,
): Promise<void> {
  const url =
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/items/${encodeURIComponent(bookItemId)}/delete`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
      message || `Story deletion failed: ${res.status} ${res.statusText}`,
    );
  }
}
