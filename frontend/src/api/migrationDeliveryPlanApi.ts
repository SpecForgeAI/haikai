/**
 * Migration Delivery Plan API Client
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Groups 9 (wizard) + 10 (progress + summary surface).
 *
 * Frontend client for two gateway endpoints used by the PM Migration Delivery
 * Plan wizard:
 *
 *   - POST /api/v1/projects/:projectId/migration-books-of-work/generate
 *       Invokes the single synchronous gateway-orchestrated generation pipeline
 *       defined in `gateway/src/services/migrationBookOfWorkHandler.ts`. The
 *       handler internally resolves Migration Discovery Context, applies the
 *       token-budget cascade, makes one LLM call, validates the structured
 *       response, POSTs to AMS, and returns `{ draftId, summary }`. The
 *       frontend's scripted progress overlay (Q-15) infers stage transitions
 *       from the request lifecycle (start, in-flight, completed) and from
 *       optional client-side time buckets.
 *
 *   - GET /api/v1/projects/:projectId/migration-books-of-work/:bookId
 *       Reads a created draft once generation succeeds so the draft-summary
 *       surface can render counts, breakdowns, gaps, and coverage. This is
 *       a thin proxy onto AMS `GET /api/projects/{projectId}/migration-books-
 *       of-work/{bookId}` (see Group 7).
 *
 * Notes for tests:
 *   - All call sites in `MigrationDeliveryPlanWizard` and
 *     `MigrationDeliveryPlanProgressSummary` import the named functions from
 *     this module so Vitest can `vi.mock('../../api/migrationDeliveryPlanApi')`
 *     and stub them per-test.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wizard answers (mirrors gateway `MigrationDeliveryPlanWizardAnswers`)
// ============================================================================

/**
 * Stage 5 — data and cutover assumptions. Each axis is a single-select value
 * surfaced as a radio group in the wizard. Values match the spec.md axis
 * vocabulary verbatim so the LLM prompt can interpret them without any
 * frontend-to-prompt translation layer.
 */
export interface MigrationDataAndCutoverAssumptions {
  dataApproach?:
    | 'one_time_bulk'
    | 'incremental'
    | 'dual_write'
    | 'change_data_capture'
    | 'rebuild_from_events'
    | 'unsure';
  cutoverApproach?:
    | 'phased'
    | 'big_bang'
    | 'blue_green'
    | 'canary'
    | 'manual_window'
    | 'unsure';
  rollbackRequired?: 'yes' | 'no' | 'unsure';
}

/**
 * Full wizard answer envelope sent to the gateway in the `generate` request
 * body. Every field is optional so sparse-context paths can still trigger
 * generation (the LLM converts gaps to prerequisite / refinement stories per
 * the system prompt's hard constraints).
 */
export interface MigrationDeliveryPlanWizardAnswers {
  /** Stage 2 — multi-select intent chips. */
  migrationIntent?: string[];
  /** Stage 3 — multi-select delivery streams. */
  deliveryStreams?: string[];
  /** Stage 4 — single-select migration style. */
  migrationStyle?: string;
  /** Stage 5 — concise data / cutover assumption answers. */
  dataAndCutoverAssumptions?: MigrationDataAndCutoverAssumptions;
  /** Stage 6 — multi-select Migration Test Pack expectations. */
  migrationTestPackExpectations?: string[];
}

// ============================================================================
// Generate request / response shapes
// ============================================================================

export interface GenerateMigrationDeliveryPlanRequest {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
  wizardAnswers?: MigrationDeliveryPlanWizardAnswers;
  discoveryRunIds?: string[];
  apiBehaviourBaselineIds?: string[];
}

/**
 * Response envelope from the gateway generate endpoint. The handler returns
 * `{ draftId, summary }` plus optional human-readable warnings produced
 * during truncation cascade or schema validation.
 */
export interface GenerateMigrationDeliveryPlanResponse {
  draftId: string;
  summary: string;
  warnings?: string[];
}

// ============================================================================
// Draft detail shape (mirrors AMS `GeneratedMigrationBookOfWorkDto`)
// ============================================================================

/**
 * A single item inside `book_of_work_json`. Mirrors the gateway
 * `GeneratedMigrationBookOfWork.items[]` shape so the summary surface and
 * Group 11's hierarchy tree can both read straight from this DTO.
 */
export interface MigrationBookOfWorkItem {
  id: string;
  type: 'initiative' | 'epic' | 'feature' | 'story';
  parentId: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  workstream: string;
  sequenceOrder: number;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
  readiness:
    | 'ready_for_spec'
    | 'needs_focused_context'
    | 'needs_user_decision'
    | 'blocked';
  readinessReasons: string[];
  missingInputs: string[];
  recommendedNextAction: string;
  traceabilitySummary: string;
  evidenceReferences?: string[];
  architectureReferences?: string[];
  apiBaselineReferences?: string[];
  discoveryFindingReferences?: string[];
  mappingReferences?: string[];
  sourceContextRefs?: string[];
  saveState?: 'draft' | 'selected' | 'excluded' | 'saved' | 'failed';
  workItemId?: string | null;
  errorMessage?: string | null;
  /**
   * Per-epic phase-2 expansion state (Spec 2026-06-11 Two-Phase
   * generation). Present on EPIC items of skeleton-generated drafts only;
   * legacy full-plan drafts carry no expansion state.
   */
  expansionState?: MigrationBookOfWorkExpansionState;
}

/**
 * Generation summary blob persisted on the draft. The shape is intentionally
 * loose — different LLM outputs may include different fields — but the most
 * commonly produced ones are typed here so the summary surface has stable
 * accessors.
 */
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
  totalItemCount?: number;
  confidenceBreakdown?: {
    high?: number;
    medium?: number;
    low?: number;
  };
  readinessBreakdown?: {
    ready_for_spec?: number;
    needs_focused_context?: number;
    needs_user_decision?: number;
    blocked?: number;
  };
  // NOTE: the legacy LLM-asserted `findingsAddressed` / `findingsNotAddressed`
  // typed accessors are deliberately REMOVED (Spec 2026-06-11): coverage is
  // computed ON READ from `findingsCoverage` via
  // `utils/findingsCoverage.computeFindingsCoverage` — never read the legacy
  // keys back.
  findingsCoverage?: MigrationFindingsCoverageSnapshot;
  contractsCovered?: number;
  baselinesCovered?: number;
  dataEntitiesCovered?: number;
  infrastructureCovered?: number;
  mappingsUsed?: number;
  unresolvedGaps?: string[];
  blockingIssues?: string[];
  majorGaps?: string[];
  [key: string]: unknown;
}

/**
 * Quality assessment blob — per-level rubric scores + rationale. Loose shape
 * (LLM rubric varies); summary surface renders whatever scores are present.
 */
export interface MigrationBookOfWorkQualityAssessment {
  overall?: { score?: number | string; rationale?: string };
  initiativeLevel?: { score?: number | string; rationale?: string };
  epicLevel?: { score?: number | string; rationale?: string };
  featureLevel?: { score?: number | string; rationale?: string };
  storyLevel?: { score?: number | string; rationale?: string };
  [key: string]: unknown;
}

/**
 * Draft detail shape returned by GET `/migration-books-of-work/:bookId`.
 *
 * The wire format uses snake_case (AMS DTO emits JSON with @JsonProperty); we
 * present a camelCase view to the components after mapping below.
 */
export interface MigrationBookOfWorkDraft {
  id: string;
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
  status: string;
  title: string;
  summary: string;
  generationInputs: Record<string, unknown> | null;
  generationSummary: MigrationBookOfWorkGenerationSummary | null;
  qualityAssessment: MigrationBookOfWorkQualityAssessment | null;
  bookOfWork: { items: MigrationBookOfWorkItem[] } | null;
  createdByTask: string | null;
  savedToBacklogAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Wire DTO (snake_case, raw AMS shape)
// ============================================================================

interface MigrationBookOfWorkDraftDto {
  id: string;
  project_id: string;
  current_architecture_id: string;
  target_architecture_id: string;
  status: string;
  title: string;
  summary: string;
  generation_inputs_json: Record<string, unknown> | null;
  generation_summary_json: MigrationBookOfWorkGenerationSummary | null;
  quality_assessment_json: MigrationBookOfWorkQualityAssessment | null;
  book_of_work_json:
    | { items?: MigrationBookOfWorkItem[]; [k: string]: unknown }
    | null;
  created_by_task: string | null;
  saved_to_backlog_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapDraftDtoToDraft(
  dto: MigrationBookOfWorkDraftDto
): MigrationBookOfWorkDraft {
  const bookBlob = dto.book_of_work_json;
  const items: MigrationBookOfWorkItem[] = Array.isArray(bookBlob?.items)
    ? (bookBlob!.items as MigrationBookOfWorkItem[])
    : [];
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
    bookOfWork: bookBlob ? { items } : null,
    createdByTask: dto.created_by_task,
    savedToBacklogAt: dto.saved_to_backlog_at,
    errorMessage: dto.error_message,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Triggers the gateway-orchestrated generation pipeline for a PM Migration
 * Delivery Plan. This is a single synchronous request: the gateway resolves
 * context, calls the LLM, validates the response, persists via AMS, and
 * returns `{ draftId, summary, warnings? }`. The frontend's progress overlay
 * is purely client-side scripting (Q-15); we never poll an intermediate
 * status endpoint.
 */
/**
 * Extract a HUMAN-READABLE message from a gateway error body. The gateway's
 * routes answer with several shapes — most importantly the NESTED envelope
 * `{ error: { code, message, details? } }` (the migration-books-of-work
 * routes), but also `{ error: "string" }` and `{ message: "string" }`.
 *
 * The previous `errorBody.message || errorBody.error` read picked up the
 * NESTED `error` OBJECT and fed it to `new Error(...)`, which stringified it
 * into the literal "[object Object]" the wizard then rendered. Always returns
 * a string ('' when no readable message is found, so callers fall through to
 * their generic message).
 */
function extractGatewayErrorMessage(errorBody: unknown): string {
  if (!errorBody || typeof errorBody !== 'object') return '';
  const top = errorBody as { message?: unknown; error?: unknown };
  if (typeof top.message === 'string' && top.message) return top.message;
  if (typeof top.error === 'string' && top.error) return top.error;
  if (top.error && typeof top.error === 'object') {
    const nested = top.error as { message?: unknown; details?: unknown };
    const message = typeof nested.message === 'string' ? nested.message : '';
    const details = typeof nested.details === 'string' ? nested.details : '';
    // `details` carries the upstream cause (e.g. the Azure OpenAI 504 text) —
    // surface it alongside the route's headline so the user sees WHY.
    if (message && details) return `${message}: ${details}`;
    return message || details;
  }
  return '';
}

/**
 * One blocking finding echoed by the generate route's 409 envelope
 * (Spec 2026-08-04-2 — Structural findings dispositions).
 */
export interface StructuralFindingsOpenFinding {
  key: string;
  message: string;
  disposition: string | null;
}

/**
 * Typed error for the generate route's HTTP 409
 * `{ error: { code: 409, reason: 'structural_findings_open', message,
 * findings } }` envelope: undispositioned (or fix-upstream-pending)
 * structural findings on the DB migration pack block plan generation. The
 * composed `message` already carries the gateway headline, the finding list,
 * and the wayfinding hint, so callers that only render `err.message` (the
 * wizard's submit-error banner) surface the full story with no extra code;
 * richer callers can read `findings` for structured rendering.
 */
export class StructuralFindingsOpenError extends Error {
  readonly findings: StructuralFindingsOpenFinding[];

  constructor(gatewayMessage: string, findings: StructuralFindingsOpenFinding[]) {
    const list = findings
      .map((f) =>
        f.disposition === 'fix_upstream'
          ? `${f.message} (fix upstream pending)`
          : f.message
      )
      .join('; ');
    super(
      `${gatewayMessage || 'Open structural findings block plan generation.'}` +
        `${list ? ` Open findings: ${list}.` : ''}` +
        ' Go to the Schema migration tab → Structural findings and disposition each' +
        ' (accept with a reason / fix upstream + regenerate / known gap), then retry.'
    );
    this.name = 'StructuralFindingsOpenError';
    this.findings = findings;
  }
}

/** Parse the 409 structural-findings envelope; null when it is anything else. */
function parseStructuralFindingsOpenError(
  errorBody: unknown
): StructuralFindingsOpenError | null {
  if (!errorBody || typeof errorBody !== 'object') return null;
  const nested = (errorBody as { error?: unknown }).error;
  if (!nested || typeof nested !== 'object') return null;
  const envelope = nested as {
    reason?: unknown;
    message?: unknown;
    findings?: unknown;
  };
  if (envelope.reason !== 'structural_findings_open') return null;
  const findings: StructuralFindingsOpenFinding[] = Array.isArray(envelope.findings)
    ? envelope.findings.map((f) => {
        const row = (f ?? {}) as {
          key?: unknown;
          message?: unknown;
          disposition?: unknown;
        };
        return {
          key: typeof row.key === 'string' ? row.key : '',
          message: typeof row.message === 'string' ? row.message : String(row.key ?? ''),
          disposition: typeof row.disposition === 'string' ? row.disposition : null,
        };
      })
    : [];
  return new StructuralFindingsOpenError(
    typeof envelope.message === 'string' ? envelope.message : '',
    findings
  );
}

export async function generateMigrationDeliveryPlan(
  request: GenerateMigrationDeliveryPlanRequest
): Promise<GenerateMigrationDeliveryPlanResponse> {
  const { projectId, ...body } = request;
  const url = `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId
  )}/migration-books-of-work/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody: unknown = await res.json();
      // 409 structural_findings_open (Spec 2026-08-04-2): open structural
      // findings on the DB migration pack block plan generation — throw the
      // typed error whose message carries the finding list + wayfinding hint.
      if (res.status === 409) {
        const findingsError = parseStructuralFindingsOpenError(errorBody);
        if (findingsError) throw findingsError;
      }
      serverMessage = extractGatewayErrorMessage(errorBody);
    } catch (err) {
      if (err instanceof StructuralFindingsOpenError) throw err;
      // Ignore JSON parse failure -- fall through to generic message.
    }
    throw new Error(
      serverMessage ||
        `Migration delivery plan generation failed: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as GenerateMigrationDeliveryPlanResponse;
}

/**
 * Reads a created draft so the summary surface can render counts, confidence
 * + readiness breakdowns, coverage stats, and major gaps.
 */
export async function fetchMigrationDeliveryPlanDraft(
  projectId: string,
  bookId: string
): Promise<MigrationBookOfWorkDraft> {
  const url = `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId
  )}/migration-books-of-work/${encodeURIComponent(bookId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      serverMessage = extractGatewayErrorMessage(await res.json());
    } catch {
      // Ignore JSON parse failure.
    }
    throw new Error(
      serverMessage ||
        `Failed to load migration delivery plan draft ${bookId}: ${res.status}`
    );
  }
  const dto = (await res.json()) as MigrationBookOfWorkDraftDto;
  return mapDraftDtoToDraft(dto);
}

// ============================================================================
// Phase-2 expansion (Spec 2026-06-11 Two-Phase generation, Task Group 5.2)
// ============================================================================

/**
 * Per-epic expansion state, persisted INSIDE `book_of_work_json` as an
 * `expansionState` field on epic items (the single shared shape defined by
 * `gateway/src/services/generatedMigrationBookOfWorkSchema.ts` and merged
 * server-side by the AMS items/append endpoint). The draft document is the
 * single source of truth for resume/retry across page reloads.
 *
 *   not_expanded -> expanding -> expanded | failed
 *
 * `failed` is retryable; `expanded` is terminal (no re-expansion); a
 * persisted `expanding` with no live request (gateway restarted
 * mid-expansion) is stale and presents as retryable in the UI.
 */
export const MIGRATION_BOOK_OF_WORK_EXPANSION_STATES = [
  'not_expanded',
  'expanding',
  'expanded',
  'failed',
] as const;

export type MigrationBookOfWorkExpansionState =
  (typeof MIGRATION_BOOK_OF_WORK_EXPANSION_STATES)[number];

/**
 * Response payload of POST `.../epics/:epicId/expand`. The gateway answers
 * 200 for BOTH outcomes -- a pipeline failure is a persisted, retryable
 * per-epic state (`failed`), not an HTTP transport failure -- so the
 * frontend can update per-epic badges without an immediate re-poll.
 */
export interface ExpandMigrationBookOfWorkEpicOutcome {
  epicId: string;
  expansionState: Extract<
    MigrationBookOfWorkExpansionState,
    'expanded' | 'failed'
  >;
  storiesAppended: number;
  error?: string;
}

/**
 * Response payload of POST `.../expand-all`. `skipped` lists the epics the
 * gateway did NOT expand (e.g. already `expanded`) with the reason.
 */
export interface ExpandAllMigrationBookOfWorkEpicsOutcome {
  results: ExpandMigrationBookOfWorkEpicOutcome[];
  skipped: Array<{
    epicId: string;
    expansionState?: string;
    reason: string;
  }>;
}

/**
 * Expand ONE epic into detailed stories (phase 2). Works on
 * `not_expanded` / `failed` / stale-`expanding` epics AND on an already-
 * `expanded` epic (a RE-expand — the pipeline re-runs against the current pack
 * and REPLACES the epic's stories, 2026-07-19). The gateway maps unknown epics
 * to 404 and a live in-flight expansion to 409.
 */
export async function expandMigrationBookOfWorkEpic(
  projectId: string,
  bookId: string,
  epicId: string
): Promise<ExpandMigrationBookOfWorkEpicOutcome> {
  const url = `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId
  )}/migration-books-of-work/${encodeURIComponent(
    bookId
  )}/epics/${encodeURIComponent(epicId)}/expand`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      serverMessage = extractGatewayErrorMessage(await res.json());
    } catch {
      // Ignore JSON parse failure -- fall through to generic message.
    }
    throw new Error(
      serverMessage ||
        `Epic expansion failed: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as ExpandMigrationBookOfWorkEpicOutcome;
}

/**
 * Expand epics for a book, fanned out over the gateway's ONE shared
 * bounded-concurrency LLM pool.
 *
 * - `includeExpanded = false` (default) — "Expand remaining": only
 *   `not_expanded` / `failed` / stale-`expanding` epics; already-`expanded`
 *   epics are skipped.
 * - `includeExpanded = true` — "Expand all": ALSO re-expands already-`expanded`
 *   epics (replacing their stories against the current pack).
 *
 * Live in-flight epics are always skipped.
 */
export async function expandAllMigrationBookOfWorkEpics(
  projectId: string,
  bookId: string,
  includeExpanded = false
): Promise<ExpandAllMigrationBookOfWorkEpicsOutcome> {
  const url = `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId
  )}/migration-books-of-work/${encodeURIComponent(bookId)}/expand-all`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ include_expanded: includeExpanded }),
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      serverMessage = extractGatewayErrorMessage(await res.json());
    } catch {
      // Ignore JSON parse failure -- fall through to generic message.
    }
    throw new Error(
      serverMessage ||
        `Expand-all failed: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as ExpandAllMigrationBookOfWorkEpicsOutcome;
}
