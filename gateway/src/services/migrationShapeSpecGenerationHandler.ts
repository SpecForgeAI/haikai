/**
 * Gateway orchestration handler for the Product Manager
 * Migration Shape-Spec Batch Generation flow.
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 6: Batch Generation Handler.
 *
 * Sole-orchestrator flow (R-2 — AMS owns persistence + focused-context
 * endpoint only; gateway owns the LLM call + batch loop). Per-batch processing
 * is SYNCHRONOUS (R-3); per-batch internal loop is SERIAL (R-4).
 *
 * Per-batch sequence:
 *   1. Load Book of Work + saved WorkItems via AMS.
 *   2. Load existing spec-generation rows for this BoW via AMS.
 *   3. Select next N unattempted saved-story WorkItems in BoW `sequenceOrder`
 *      (default N=25, configurable via env `SHAPE_SPEC_BATCH_SIZE` or input).
 *   4. Apply per-row filter: skip rows at `status='generated'` unless
 *      `regenerateAll=true`; re-attempt `failed` / `insufficient_context` /
 *      `generated_with_warnings` rows by default; mark `skipped_blocked` ONLY
 *      when `skipBlockedStories=true` (R-6, default OFF).
 *   5. For each story in the batch, SERIALLY (R-4):
 *        a. Call `fetchMigrationSpecContext(...)` with story IDs + six
 *           context types (R-2, A-5 — Group 5 client).
 *        b. Apply `applyTokenBudgetCascade(...)` (R-5, A-3 — Spec 1 helper
 *           reuse, NOT duplicated).
 *        c. On `TokenBudgetOverflowError`: mark story `status='insufficient_context'`
 *           with the overflow recorded as `missingInputs[0]`; SKIP the LLM
 *           call (acceptance signal 9 — no fabricated spec).
 *        d. Decide insufficient-context based on focused-context payload:
 *           top-level `missingInputs[]` present, OR mappings / contracts /
 *           baselines empty for an API/SOAP story.
 *        e. Single synchronous LLM call (R-3).
 *        f. Validate the response via `assertSpecGenerationResponse(...)`
 *           (Group 4); validator failure → per-story `failed`.
 *        g. Validate the story-title substring rule on `specText`; failure
 *           → per-story `failed`.
 *        h. Apply confidence downgrade post-validation (R-7).
 *   6. POST all per-story results to AMS batch persistence endpoint (Group 8).
 *   7. Return per-story result list + batch summary.
 *
 * Per-story failure isolation (R-12): every per-story exception or validator
 * failure is caught and recorded as a per-story `failed` result; the batch
 * NEVER aborts. When the AMS persistence call itself fails, the response
 * surfaces a `resultsCouldNotPersist` count plus the unpersisted failure
 * details inline (`unpersistedResults[]`) so the UI can render them.
 *
 * Re-run idempotency (R-8): default re-run skips rows already at
 * `status='generated'`. `regenerateAll=true` re-attempts all rows. A manually
 * edited spec is NEVER overwritten without `confirmOverwrite=true`
 * (acceptance signal 17 — enforced AMS-side; the gateway forwards the flag).
 *
 * Auth gating: copied from Spec 1's PM-task entry point (R-11) — no new role
 * or permission flag.
 *
 * Cross-Story Context Injection extension (2026-05-20, Task Group 5):
 *   - Pass 1 runs unchanged + receives `parent_rollup` and `workstream_context`
 *     in the per-story prompt (no sibling summaries on pass 1).
 *   - Pass 2 (auto-run when project config + per-batch flag allow) reads
 *     sibling summaries from the just-persisted pass-1 rows. Pass 2 NEVER
 *     reads pass-2 outputs as sibling context -- the resolver enforces this
 *     and the handler enforces a hard MAX_PASS = 2 cap at its boundary.
 *   - After pass 1 persists, `decisions[]` from the parser-extracted output
 *     auto-seed `epic_captured_decisions` rows via the new AMS endpoint;
 *     pinned (user_edited / user_added) rows are skipped server-side.
 *   - After pass 2 persists, the gateway computes `pass2_changes_summary` via
 *     a template (no LLM round-trip), the `no_meaningful_change` flag via a
 *     whitespace-normalised compare against pass-1, and contradiction
 *     detection (`contradicts_sibling`, `aligned_with_epic_decision`) in
 *     plain TS against the parser-extracted decisions.
 *   - Concurrency lock per workstream: a second concurrent batch for the
 *     same workstream is refused with a structured `WorkstreamLockedError`.
 *
 * Structured log markers (R-12, R-7):
 *   [diag-gateway] pm_migration_shape_spec_generation batch_started projectId=<id> bookOfWorkId=<id> batchSize=<n> regenerateAll=<bool>
 *   [diag-gateway] pm_migration_shape_spec_generation story_started workItemId=<id> seq=<n>
 *   [diag-gateway] pm_migration_shape_spec_generation story_result workItemId=<id> status=<s> confidence=<c> warnings=<n> missingInputs=<n>
 *   [diag-gateway] pm_migration_shape_spec_generation confidence_downgraded workItemId=<id> from=<c1> to=<c2> missingSignals=<list>
 *   [diag-gateway] pm_migration_shape_spec_generation batch_completed generated=<n> generated_with_warnings=<n> insufficient_context=<n> failed=<n> skipped_blocked=<n> couldNotPersist=<n>
 *   [diag-gateway] pm_migration_shape_spec_generation pass=1 pass_started workstreamId=<id>
 *   [diag-gateway] pm_migration_shape_spec_generation pass=2 pass_started workstreamId=<id>
 *   [diag-gateway] pm_migration_shape_spec_generation cross_story_auto_seed workItemId=<id> seeded=<n>
 *   [diag-gateway] pm_migration_shape_spec_generation cross_story_pass2_summary workItemId=<id> noMeaningfulChange=<bool>
 *   [diag-gateway] pm_migration_shape_spec_generation cross_story_contradiction workItemId=<id> count=<n>
 *
 * Design-point refs:
 *   - R-2 gateway-only orchestration (no AMS-side generation endpoint)
 *   - R-3 synchronous per batch (no token streaming)
 *   - R-4 serial within batch
 *   - R-5 / A-3 token cascade reuse from migrationBookOfWorkHandler
 *   - R-6 skipped_blocked toggle-only
 *   - R-7 confidence downgrade
 *   - R-8 re-run idempotency (default skip status='generated')
 *   - R-11 auth gating verbatim from Spec 1
 *   - R-12 per-story failure isolation
 *   - R-13 / A-7 LLM-output fixtures
 *   - A-4 hand-rolled validator (specGenerationResponseValidator)
 *   - A-5 new MigrationSpecContextResolver (sibling of migration-summary)
 *   - A-6 lazy not_attempted (no row written until first attempt)
 */

import { getConfig } from '../config';
import { createTracer } from '../trace';
import {
  FetchPackFilesFn,
  defaultFetchPackFiles,
  isDbPackCarriageStory,
  runDbPackSpecCarriage,
} from './migrationDbPackSpecCarriage';

// SPEC-stage banners + batch predicate (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only; the
// per-story SPEC.* predicates ride migrationCodeSpecCarriage.
const trace = createTracer('gateway');
import {
  FetchCodeSpecFactsFn,
  codeCarriageMarkersFromBlob,
  defaultFetchCodeSpecFacts,
  isCodeCarriageStory,
  isCodeFoundationStory,
  runCodeSpecCarriage,
} from './migrationCodeSpecCarriage';
import {
  fetchMigrationSpecContext as defaultFetchMigrationSpecContext,
  FetchMigrationSpecContextInput,
  MigrationSpecContextDto,
  MigrationSpecContextType,
  MIGRATION_SPEC_CONTEXT_TYPES,
  MigrationSpecContextClientError,
  MigrationSpecSiblingSummary,
} from './migrationSpecContextClient';
import {
  applyTokenBudgetCascade,
  TokenBudgetOverflowError,
} from './migrationBookOfWorkHandler';
import { MigrationDiscoveryContext } from './migrationDiscoveryContextClient';
import {
  assertSpecGenerationResponse,
  computeMissingCitationWarning,
  CapturedDecisionRefForCitationCheck,
  GeneratedShapeSpecResponse,
  GeneratedShapeSpecResponseA,
  SpecGenerationConfidence,
  SPEC_TEXT_REQUIRED_PREFIX,
  StructuredTest,
} from './specGenerationResponseValidator';
import {
  appendInlineTestPack,
  buildPlannerResponseFromGenerated,
  buildTestPlannerResponseFromTests,
  buildPersistedImplementStateLiteral,
  ImplementStatePutter,
  ImplementStatePutBody,
} from './migrationImplementReadyState';
import {
  deriveFolderName,
  buildTranscriptPath,
  normalizeKind,
} from './transcriptWriter';
export {
  buildPlannerResponseFromGenerated,
  buildTestPlannerResponseFromTests,
  buildPersistedImplementStateLiteral,
};
export type { ImplementStatePutter, ImplementStatePutBody };
import {
  fetchActiveTargetArchitectureId as defaultFetchActiveTargetArchitectureIdForCitation,
  fetchLatestCapturedDecisions as defaultFetchLatestCapturedDecisionsForCitation,
  fetchLatestCapturedDecisions,
  TargetStateCapturedDecision,
} from './targetStateCapturedDecisionsClient';
import { logger } from './logger';
import {
  parseShapeSpecHeadings,
  extractDecisionKey,
} from './shapeSpecHeadingParser';
import {
  autoSeedEpicCapturedDecision as defaultAutoSeedEpicCapturedDecision,
} from './epicCapturedDecisionsClient';
// Spec 5 (2026-06-24-confirmed-manifest-to-target-codebase) — seed-build-files
// carriage seam (Groups 3 + 4). Recognises the dedicated seed story, reads the
// Spec 3 confirmed manifest(s) via the SeedBuildFilesSource seam, and assembles
// the verbatim per-module write-block(s) appended to the seed story's spec text.
import {
  SeedBuildFilesSource,
  SeedBuildFilesEnrichment,
  isSeedBuildFilesStory,
  resolveSeedBuildFilesEnrichment,
} from './migrationSeedBuildFilesEnrichment';
// Scaffold bootstrap carriage (2026-08-14): the seed_build_files story's spec
// is assembled DETERMINISTICALLY (no LLM) from the verbatim manifest block +
// the captured target-state decisions.
import { runScaffoldSpecCarriage } from './migrationScaffoldSpecCarriage';
// Target-stack section (2026-08-14): the deterministic captured-decisions
// block appended to every service-plane spec (carriage + LLM paths).
import {
  appendTargetStackSection,
  buildTargetStackSpecSection,
  isDbPlaneStream,
} from './migrationTargetStackSpecSection';
import {
  isDbPackReviewStory,
  buildDbPackReviewSpecText,
  plannerDeclaredMissing,
} from './migrationDbPackReviewRoute';
import { isManualExecutionItem } from './migrationExecutionClass';
import { CODE_PREREQUISITE_TAG } from './migrationCodeStreamPlanner';
import {
  fetchProjectConfigWithDefaults as defaultFetchProjectConfigWithDefaults,
  DEFAULT_PER_STORY_TOKEN_CAP,
  DEFAULT_CROSS_STORY_TOKEN_CAP,
  DEFAULT_AUTO_RUN_PASS_2,
  getElementsInventory as defaultGetElementsInventoryForCitation,
  fetchProjectFolder as defaultFetchProjectFolder,
  ArchitectureModelHttpError,
  ElementInventoryResponse,
} from './architectureModelClient';

// ---------------------------------------------------------------------------
// Public input + output types
// ---------------------------------------------------------------------------

/** Default per-batch size when neither input nor env override is provided. */
export const DEFAULT_SHAPE_SPEC_BATCH_SIZE = 25;

/**
 * Supported context types per spec.md (the six original types PLUS the 7th
 * `operational_capability` type added by D3, 2026-06-14), requested verbatim
 * from AMS for every story regardless of story type. The AMS resolver decides
 * which blocks to populate based on the actual story-type metadata it joins
 * (and, for the 7th type, the story's `sourceCapabilityId`). Spreading
 * `MIGRATION_SPEC_CONTEXT_TYPES` means D3's 7th type is requested automatically
 * with no other handler change.
 */
export const SHAPE_SPEC_CONTEXT_TYPES: readonly MigrationSpecContextType[] = [
  ...MIGRATION_SPEC_CONTEXT_TYPES,
];

/**
 * Hard cap on the number of generation passes the handler will run for a
 * batch. The cross-story-context spec mandates this is exactly 2; the
 * handler MUST refuse any caller-requested third pass at its boundary
 * (LOOP GUARDRAIL, Task Group 5.3).
 */
export const MAX_PASS = 2;

/**
 * Lifecycle status of a per-story spec-generation result.
 *
 * Mirrors the AMS-side persisted column constraint set; `not_attempted` is
 * lazy (A-6) and never appears on a result returned from this handler — it is
 * computed in the summary endpoint, not persisted.
 */
export type SpecGenerationStatusValue =
  | 'generated'
  | 'generated_with_warnings'
  | 'insufficient_context'
  | 'failed'
  | 'skipped_blocked';

/**
 * Inline DTO for a single AMS-persisted spec-generation row. This mirrors
 * `MigrationStorySpecGenerationDto` on the AMS side (snake_case JSON via
 * Jackson on the wire; camelCase on the TS surface). Kept inline here to
 * avoid pulling a generated-types module into the gateway.
 *
 * Cross-Story Context Injection (2026-05-20) adds optional fields:
 *   - `generationPass` (1 or 2)
 *   - `pass1SpecText` (snapshot of pass-1 text for diffing)
 *   - `pass2ChangesSummary` (the "what changed and why" blurb)
 *   - `budgetMetaJson` (mirror of resolver budget_meta)
 *   - `noMeaningfulChange` (true when pass-2 byte-equivalent to pass-1)
 *   - `decisionsJson` / `interfacesJson` / `assumptionsJson` (parser output)
 *
 * The new fields are optional on the wire and the AMS-side persistence layer
 * defaults to pass-1 semantics when they are omitted.
 */
export interface MigrationStorySpecGenerationDto {
  id?: string | null;
  projectId: string;
  workItemId: string;
  bookOfWorkId?: string | null;
  bookItemId?: string | null;
  status: SpecGenerationStatusValue;
  confidence?: SpecGenerationConfidence | null;
  predictedReadiness?: string | null;
  generatedSpecText?: string | null;
  warningsJson?: Array<Record<string, unknown>> | null;
  missingInputsJson?: Array<Record<string, unknown>> | null;
  focusedContextRefsJson?: Record<string, unknown> | null;
  evidenceRefsJson?: unknown[] | null;
  generatedAt?: string | null;
  errorMessage?: string | null;
  generationAttemptNumber?: number | null;
  createdByTask?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // Cross-Story Context Injection (2026-05-20, Task Group 5).
  generationPass?: number | null;
  pass1SpecText?: string | null;
  pass2ChangesSummary?: string | null;
  budgetMetaJson?: Record<string, unknown> | null;
  noMeaningfulChange?: boolean | null;
  decisionsJson?: string[] | null;
  interfacesJson?: string[] | null;
  assumptionsJson?: string[] | null;
  // Implementation-Ready Migration Spec Generation (2026-06-14, Groups 1-2).
  /** Structured unit/functional test pack (D6); array of { title, description, type }. */
  structuredTestsJson?: Array<Record<string, unknown>> | null;
  /** Model EndpointEntity UUIDs the story migrates (D9); EMPTY for non-endpoint stories. */
  coveredEndpointIds?: string[] | null;
  /**
   * Display-only join fields (2026-07-20): the story's readable title + its
   * parent feature/epic title, joined from the book of work AFTER persistence
   * so they NEVER reach the AMS row. Present only on the gateway batch response
   * — they let the spec-gen table render names instead of raw work-item UUIDs.
   */
  storyTitle?: string | null;
  parentTitle?: string | null;
  /**
   * Stale trio (carry-over triage, 2026-07-26): a STALE generated row is
   * treated as needing REgeneration — `selectEligibleStories` no longer skips
   * it, and the driver's `isStorySpecReady` refuses it. Stamped server-side
   * (story amend / resolution cascade), cleared on successful regeneration.
   */
  stale?: boolean | null;
  staleReason?: string | null;
  staleMarkedAt?: string | null;
}

/**
 * Per-story result returned to the caller (and persisted to AMS). Same shape
 * as the AMS row; this alias exists so future evolutions can diverge without
 * breaking callers.
 */
export type SpecGenerationResult = MigrationStorySpecGenerationDto;

/**
 * Loaded book-of-work shape consumed by the batch handler. Only the fields
 * the handler actually reads are surfaced here; the upstream AMS DTO carries
 * more. The handler-level shape is minimal so test fixtures can be built
 * without standing up the full AMS DTO.
 */
export interface LoadedBookOfWorkItem {
  id: string;
  type: 'initiative' | 'epic' | 'feature' | 'story';
  parentId: string | null;
  title: string;
  sequenceOrder: number;
  /**
   * Saved-story WorkItem UUID (R-9 — FK is source of truth). Stories that
   * have been saved-to-backlog carry this; non-story items may or may not.
   */
  workItemId?: string | null;
  predictedReadiness?: string | null;
  description?: string | null;
  /**
   * D3 (2026-06-14): the `discovery_capability` UUID this story was minted
   * from, stamped on the `book_of_work_json` blob item by the AMS
   * `append-capability-story` endpoint (provenance rides the blob, NO DDL).
   * Threaded into the focused-context request so the resolver populates the
   * 7th `operational_capability` block from the capability (preferred). Absent
   * for ordinary API / data stories.
   */
  sourceCapabilityId?: string | null;
  /**
   * D5 (2026-06-14): the like-for-like provenance marker (`carry_over` |
   * `net_new`) the AMS `add-item` endpoint stamps onto the blob item for a
   * MANUAL add. Its PRESENCE (with NO `sourceCapabilityId`) is the signal that
   * the story is a manual add and must run DESCRIPTION-GROUNDED spec-gen rather
   * than the discovered-context resolver. Absent for discovered stories (the
   * authoritative provenance is the `work_item.provenance` column; this blob
   * mirror exists purely so the generator can recognise a manual add).
   */
  provenance?: string | null;
  /**
   * D5 (2026-06-14): the prompt FLAVOUR (`api` | `operational`) the AMS
   * `add-item` endpoint stamps onto the blob item for a MANUAL add. It tunes
   * ONLY the description-grounded prompt orientation (`api` -> endpoint;
   * `operational` -> effect-test). It is NOT a `work_item` type and does NOT
   * route the story through D3's discovered-capability path. Absent for
   * discovered stories.
   */
  kind?: string | null;
  /**
   * Free-form tags on the `book_of_work_json` blob item (e.g. `seed_build_files`,
   * `stream:<name>`, `provenance:scaffold`). Spec 6's scaffold story marks itself
   * with the `seed_build_files` TAG (its `kind` is `operational` to satisfy AMS
   * `ALLOWED_KINDS`), so the verbatim-manifest carriage recognises it by tag.
   */
  tags?: string[] | null;
  /**
   * Spec 2026-07-23: planner-authored acceptance criteria off the blob item —
   * feed the DETERMINISTIC spec text for pack human-procedure stories.
   */
  acceptanceCriteria?: string[] | null;
  /**
   * Spec 2026-07-23: the planner-declared missing inputs off the blob item
   * (prerequisite stories bake their OWN gap reason, e.g. "code discovery has
   * not run"). The prerequisite route reports THESE instead of the generic
   * resolver's irrelevant trio.
   */
  plannerMissingInputs?: Array<string | Record<string, unknown>> | null;
  /**
   * Spec 2026-07-02-c (Persistence-Tier Oracle Program): DB-pack verbatim
   * carriage markers stamped on the blob item by the deterministic DB
   * expansion (Spec -b). A story tagged `seed_db_pack_files` with a `packId`
   * and file selectors runs the FULLY DETERMINISTIC carriage path — its spec
   * text IS the pack's files, byte-for-byte; no context resolver, no LLM.
   */
  packId?: string | null;
  packFilePaths?: string[] | null;
  packFilePathPrefixes?: string[] | null;
  /**
   * Spec 2026-07-06-h: code-carriage markers stamped on the blob item by the
   * deterministic code planner (Spec -g). A `provenance:plan-deterministic`
   * story with `apiEndpointIds` runs the FULLY DETERMINISTIC code carriage —
   * its spec text embeds the committed contracts, data-effect SQL, behaviour
   * blocks, and captured baseline examples; no context resolver, no LLM.
   * Manual-gate stories (`execution:manual-gate`) get deterministic
   * procedure text.
   */
  codeStoryKind?: string | null;
  apiInterfaceId?: string | null;
  apiEndpointIds?: string[] | null;
  baselineByEndpointId?: Record<string, string | null> | null;
  flagReason?: string | null;
  findingIds?: string[] | null;
  protocol?: string | null;
}

export interface LoadedBookOfWork {
  bookOfWorkId: string;
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  items: LoadedBookOfWorkItem[];
}

export interface RunShapeSpecGenerationBatchInput {
  projectId: string;
  bookOfWorkId: string;
  /** Override the default batch size (per-call). */
  batchSize?: number;
  /** Re-attempt rows already at `status='generated'` (R-8). */
  regenerateAll?: boolean;
  /** Mark blocked stories as `skipped_blocked` instead of attempting (R-6). */
  skipBlockedStories?: boolean;
  /**
   * Forward to AMS so the persistence layer allows overwriting a manually-edited
   * spec; default false (acceptance signal 17). The handler does NOT enforce
   * this client-side — it is forwarded into the persisted result so AMS reads
   * the intent on the batch insert/upsert call.
   */
  confirmOverwrite?: boolean;
  /**
   * Optional whitelist of WorkItem ids. When supplied, batch selection picks
   * ONLY stories whose `workItemId` is in this set (still honouring the
   * `regenerateAll` / status-skip rules). Empty array == "no filter", same as
   * omitting the field; null members are ignored.
   *
   * Drives the single-story regenerate path used by failed-row retry +
   * drawer-driven regen actions on the frontend.
   */
  targetWorkItemIds?: ReadonlyArray<string | null | undefined>;
  /** Optional caps forwarded to the focused-context call. */
  maxFindings?: number;
  maxEvidenceItems?: number;
  maxBaselineItems?: number;
  /**
   * Cross-story context injection: per-batch override of the project-level
   * `auto_run_pass_2` flag. When omitted, the project setting (default true)
   * applies. When false, pass 2 is skipped even if the project setting is true.
   */
  autoRunPass2?: boolean;
  /**
   * Cross-story context injection: caller-requested pass number. ONLY accepts
   * 1 or 2 -- any other value (including a caller-requested third pass) is
   * refused with a structured error at the handler boundary (Task Group 5.3
   * LOOP GUARDRAIL). When omitted, the handler runs the full pass-1 +
   * optional-pass-2 orchestration internally.
   */
  pass?: number;
  /**
   * Cross-story context injection: stable identifier for the workstream this
   * batch operates on. The handler maintains a per-workstream concurrency
   * lock keyed by this id; a second concurrent batch for the same workstream
   * is refused with a structured `WorkstreamLockedError`. Defaults to the
   * `bookOfWorkId` when not supplied.
   */
  workstreamId?: string;
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
   * gate flag for overwriting manually-edited rows. When true, the gateway
   * pre-flights AMS for the set of manually-edited rows in scope and uses
   * `manuallyEditedWorkItemIdsToOverwrite` (the allow-list) to decide which
   * to overwrite vs skip. When false (default) NO manually-edited row is
   * overwritten -- they are filtered out before the batch loop and surfaced
   * in `skippedManuallyEditedWorkItemIds` on the result.
   */
  overwriteManuallyEdited?: boolean;
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
   * caller-supplied allow-list of WorkItem ids whose manually-edited rows
   * should be overwritten on this batch. Only meaningful when
   * `overwriteManuallyEdited` is true. Manually-edited rows NOT in this list
   * are skipped from the batch and reported in
   * `skippedManuallyEditedWorkItemIds`. When omitted while
   * `overwriteManuallyEdited` is true, the gateway treats it as an empty
   * allow-list (skip every manually-edited row in scope).
   */
  manuallyEditedWorkItemIdsToOverwrite?: ReadonlyArray<string | null | undefined>;
}

export interface BatchSummary {
  generated: number;
  generated_with_warnings: number;
  insufficient_context: number;
  failed: number;
  skipped_blocked: number;
}

export interface BatchResult {
  perStoryResults: SpecGenerationResult[];
  persistedCount: number;
  resultsCouldNotPersist: number;
  unpersistedResults: SpecGenerationResult[];
  nextBatchStart: number;
  summary: BatchSummary;
  /** Cross-story context injection (2026-05-20): per-pass results when pass 2 ran. */
  passOneResults?: SpecGenerationResult[];
  passTwoResults?: SpecGenerationResult[];
  /**
   * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
   * workItemIds that were skipped because they carried `manually_edited=true`
   * and were NOT in the caller's overwrite allow-list. The frontend uses
   * this list to render "X stories skipped because they were manually
   * edited" on the batch result toast.
   */
  skippedManuallyEditedWorkItemIds?: string[];
  /** Convenience count -- matches `skippedManuallyEditedWorkItemIds.length`. */
  skippedManuallyEditedCount?: number;
  /**
   * Audit detail for each skipped row so the UI can render a list with
   * "edited by X on Y". Populated from the AMS pre-flight call.
   */
  skippedManuallyEditedDetails?: Array<{
    workItemId: string;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Concurrency lock per workstream (Task Group 5.7)
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link runShapeSpecGenerationBatch} when a second concurrent
 * batch for the same workstream is requested. The route layer maps this to
 * an HTTP 409-style error envelope for the UI banner.
 */
export class WorkstreamLockedError extends Error {
  readonly workstreamId: string;
  readonly activePass: number;

  constructor(workstreamId: string, activePass: number) {
    super(
      `Workstream ${workstreamId} already has an active spec-generation batch ` +
        `(pass ${activePass}); refuse second concurrent batch`
    );
    this.name = 'WorkstreamLockedError';
    this.workstreamId = workstreamId;
    this.activePass = activePass;
  }
}

/**
 * Thrown when the caller requests a pass number outside the {1, 2} range
 * (Task Group 5.3 LOOP GUARDRAIL: hard cap at MAX_PASS).
 */
export class InvalidPassNumberError extends Error {
  readonly requestedPass: number;
  constructor(requestedPass: number) {
    super(
      `Migration shape-spec generation pass ${requestedPass} is outside the ` +
        `valid range [1, ${MAX_PASS}]; handler refuses to run a third pass`
    );
    this.name = 'InvalidPassNumberError';
    this.requestedPass = requestedPass;
  }
}

interface ActiveBatchState {
  pass: number;
  startedAt: number;
}

const ACTIVE_WORKSTREAM_BATCHES: Map<string, ActiveBatchState> = new Map();

/** Exposed for tests so they can reset the lock between cases. */
export function __resetWorkstreamLocksForTests(): void {
  ACTIVE_WORKSTREAM_BATCHES.clear();
}

function acquireWorkstreamLock(workstreamId: string, pass: number): void {
  const existing = ACTIVE_WORKSTREAM_BATCHES.get(workstreamId);
  if (existing) {
    throw new WorkstreamLockedError(workstreamId, existing.pass);
  }
  ACTIVE_WORKSTREAM_BATCHES.set(workstreamId, { pass, startedAt: Date.now() });
}

function updateWorkstreamLockPass(workstreamId: string, pass: number): void {
  const existing = ACTIVE_WORKSTREAM_BATCHES.get(workstreamId);
  if (existing) {
    existing.pass = pass;
  }
}

function releaseWorkstreamLock(workstreamId: string): void {
  ACTIVE_WORKSTREAM_BATCHES.delete(workstreamId);
}

// ---------------------------------------------------------------------------
// Dependency-injection seams
// ---------------------------------------------------------------------------

export type BookOfWorkLoader = (
  projectId: string,
  bookOfWorkId: string
) => Promise<LoadedBookOfWork>;

export type ExistingGenerationsLoader = (
  projectId: string,
  bookOfWorkId: string
) => Promise<MigrationStorySpecGenerationDto[]>;

export type SpecContextFetcher = (
  input: FetchMigrationSpecContextInput
) => Promise<MigrationSpecContextDto>;

export type LlmCaller = (input: {
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
  workItemId: string;
}) => Promise<{ content: string }>;

export type PersistBatchFn = (
  projectId: string,
  bookOfWorkId: string,
  results: SpecGenerationResult[]
) => Promise<{
  persistedCount: number;
  resultsCouldNotPersist: number;
  perStoryResults?: SpecGenerationResult[];
}>;

/**
 * Cross-story context injection (Task Group 5.4): auto-seed a captured-decision
 * row on the parent epic after a pass-1 spec persists. The default
 * implementation calls AMS; tests override.
 */
export type EpicCapturedDecisionAutoSeeder = (
  projectId: string,
  epicWorkItemId: string,
  decisionKey: string,
  decisionText: string,
  sourceSpecGenerationId: string | null
) => Promise<unknown>;

/**
 * Cross-story context injection: fetch the project's auto_run_pass_2 flag +
 * token caps. Tests can override; defaults read the AMS project config.
 */
export type ProjectConfigFetcher = (
  projectId: string
) => Promise<{
  perStoryContextTokenCap: number;
  crossStoryContextTokenCap: number;
  autoRunPass2: boolean;
}>;

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * fetch the list of manually-edited rows in scope for a Generate-all /
 * retry-batch run. Tests override; the default calls AMS GET
 * `/api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope`.
 *
 * Pass `workItemIds` to narrow the candidate set (used by retry-batch which
 * already has the failed-row ids in hand).
 */
export type ManuallyEditedInScopeFetcher = (
  projectId: string,
  bookOfWorkId: string,
  workItemIds?: ReadonlyArray<string>
) => Promise<
  Array<{
    workItemId: string;
    workItemTitle?: string | null;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
    specId?: string | null;
  }>
>;

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * pre-clear a row's `manually_edited` flag so the subsequent batch persist
 * can overwrite the text without tripping AMS's manual-edit protection in
 * `persistOne`. Backed by AMS POST
 * `/api/projects/{projectId}/spec-generations/{specId}/regenerate?overwriteManuallyEdited=true`
 * with NO patch body (the regenerate endpoint clears the four manual-edit
 * columns when the flag is true; calling with no body leaves `generated_spec_text`
 * unchanged for now and the subsequent batch write overwrites it).
 */
export type ManuallyEditedFlagClearer = (
  projectId: string,
  specId: string
) => Promise<void>;

/**
 * Spec 2026-05-25 captured-decisions integration: fetcher returning the
 * project's latest non-superseded captured-decisions list. The handler loads
 * the list ONCE per batch (per-story is wasteful; the project-level list does
 * not change during a single batch run) and feeds it into the per-story
 * validator extension. Tests override; production wires through to the
 * existing  on
 *  (no new client method).
 */
export type CapturedDecisionsForCitationFetcher = (
  projectId: string,
) => Promise<{
  decisions: TargetStateCapturedDecision[];
  targetArchitectureId: string | null;
}>;

/**
 * Spec 2026-05-26 story-level scope cross-check: per-batch element-inventory
 * fetcher. The handler resolves the element-name for each element-scope
 * captured decision via this fetcher's returned `Map<elementId, elementName>`,
 * enabling the validator's `isDecisionInScopeForStory` predicate to do a
 * case-insensitive substring match of the resolved name against the story's
 * `specText` + `affectedAreas`.
 *
 * Tests override; production wires through to the existing `getElementsInventory`
 * client. Failure path is fail-open at element level: an empty Map -> every
 * element-scope decision has `scopeElementName=null` -> validator fail-opens
 * them to in-scope. Architecture-scope decisions are unaffected.
 */
export type ElementInventoryForCitationFetcher = (
  projectId: string,
  architectureId: string,
) => Promise<Map<string, string>>;

export interface ShapeSpecGenerationDeps {
  loadBookOfWork?: BookOfWorkLoader;
  loadExistingGenerations?: ExistingGenerationsLoader;
  fetchSpecContext?: SpecContextFetcher;
  callLlm?: LlmCaller;
  persistBatchResults?: PersistBatchFn;
  /**
   * Pack-files reader for the deterministic DB-pack verbatim carriage
   * (Spec 2026-07-02-c). Injected in tests; production reads
   * GET /db-migration-packs/{packId}/files.
   */
  fetchPackFiles?: FetchPackFilesFn;
  /**
   * Facts reader for the deterministic code-story verbatim carriage
   * (Spec 2026-07-06-h). Injected in tests; production reads the committed
   * model + endpoint-data-effects + baseline-items.
   */
  fetchCodeSpecFacts?: FetchCodeSpecFactsFn;
  /** Override the system prompt (defaults to reading the markdown file). */
  systemPromptOverride?: string;
  /** Cross-story context injection (2026-05-20). */
  autoSeedEpicCapturedDecision?: EpicCapturedDecisionAutoSeeder;
  fetchProjectConfig?: ProjectConfigFetcher;
  /** In-Product Spec Editor + Confirm-Overwrite (2026-05-20). */
  fetchManuallyEditedInScope?: ManuallyEditedInScopeFetcher;
  clearManuallyEditedFlag?: ManuallyEditedFlagClearer;
  /** Spec 2026-05-25: captured-decisions list for the missing-citation extension. */
  fetchCapturedDecisionsForCitationCheck?: CapturedDecisionsForCitationFetcher;
  /**
   * Spec 2026-05-26 story-level scope cross-check: per-batch element-inventory
   * fetch used to resolve element-scope captured decisions' `scopeRefId` to a
   * human-readable element name for the validator's substring matcher. Tests
   * inject a mock; production defaults to
   * `defaultFetchElementInventoryForCitationCheck`.
   */
  fetchElementInventoryForCitationCheck?: ElementInventoryForCitationFetcher;
  /**
   * Implementation-Ready Migration Spec Generation (2026-06-14, Group 3):
   * write the per-story implement-state.json so the Implement screen hydrates
   * as a completed PM -> TE session. Tests override; production defaults to
   * {@link defaultPutImplementState}. Best-effort: a failure is isolated and
   * never aborts the batch or the AMS persistence (R-12 posture).
   */
  putImplementState?: ImplementStatePutter;
  /**
   * Spec 5 (2026-06-24-confirmed-manifest-to-target-codebase, Groups 3 + 4):
   * read Spec 3 CONFIRMED manifest(s) + service mapping for the dedicated
   * seed-build-files story. The handler resolves the enrichment ONCE per batch
   * and appends the verbatim per-module write-block(s) to the seed story only.
   * When undefined (the honest v1 default) OR when it returns null (no confirmed
   * manifest), the seed carriage is a safe NO-OP and ordinary stories are
   * unchanged. CONSUMES the confirmed artifact as-is (no re-parse/re-resolve).
   */
  seedBuildFilesSource?: SeedBuildFilesSource;
  /**
   * Scaffold bootstrap carriage (2026-08-14): latest captured target-state
   * decisions for the book's target architecture, fetched ONCE per batch. The
   * scaffold story's DETERMINISTIC spec derives its bootstrap requirements
   * from these rows (each cited `[decision:<code>]`). Fail-soft: a read
   * hiccup degrades to `[]` — the scaffold spec still carries the verbatim
   * manifest block and lists the uncaptured codes loudly.
   */
  fetchCapturedDecisionsForSpecs?: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<TargetStateCapturedDecision[]>;
  /**
   * Decision→manifest auto-apply (2026-08-16): reconcile the latest confirmed
   * manifest against the captured decisions and apply any decision-required
   * ADDITIONS before the seed enrichment reads it — so the scaffold spec
   * always seeds a decision-consistent pom (the live gap: db.migrations said
   * Liquibase, the pom never gained liquibase-core, and the seeded manifest
   * shipped without the migration tool). Wired by the production routes only
   * (never throws — fail-soft inside); undefined in tests = skipped.
   */
  autoApplyDecisionAdditions?: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Default production wiring
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';

const TASK_ID = 'product-manager--migration-shape-spec-generation';
const SYSTEM_PROMPT_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'prompts',
  'product-manager.migration-shape-spec-generation.task.md'
);

function readDefaultSystemPrompt(): string {
  return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
}

/**
 * Spec 2026-05-25: default captured-decisions fetcher used by the per-story
 * missing-citation extension. Resolves the active target architecture id via
 * the existing client, then fetches the latest non-superseded captured
 * decisions for that target. Returns [] when no active target exists OR no
 * decisions exist OR either lookup fails -- mirroring the resolver fail-soft
 * convention so a transient Architecture Model Service error does NOT cause
 * the entire shape-spec batch to be flagged with missing-citation warnings.
 */
const defaultFetchCapturedDecisionsForCitationCheck: CapturedDecisionsForCitationFetcher = async (
  projectId
) => {
  try {
    const active = await defaultFetchActiveTargetArchitectureIdForCitation(projectId);
    const targetId = active?.activeTargetArchitectureId ?? null;
    if (!targetId) {
      // Spec 2026-05-26: fail-soft when no active target architecture exists.
      // Inventory fetch is also skipped downstream because targetArchitectureId is null.
      return { decisions: [], targetArchitectureId: null };
    }
    const decisions = await defaultFetchLatestCapturedDecisionsForCitation(projectId, targetId);
    return {
      decisions: Array.isArray(decisions) ? decisions : [],
      targetArchitectureId: targetId,
    };
  } catch (e) {
    logger.warn(
      'Architecture Model Service captured-decisions lookup failed in shape-spec handler; missing-citation extension will be skipped for this batch',
      { projectId, error: e instanceof Error ? e.message : String(e) }
    );
    return { decisions: [], targetArchitectureId: null };
  }
};

/**
 * Spec 2026-05-26 story-level scope cross-check: default element-inventory
 * fetcher used to resolve element-scope captured decisions' `scopeRefId` to a
 * human-readable element name. Calls the existing `getElementsInventory` client
 * (already in use by the selective-copy picker) and flattens
 * `domains[].types[].instances[]` into a single `Map<elementId, elementName>`.
 *
 * Fail-soft: on any Architecture Model Service error (network failure, non-2xx)
 * or when `architectureId` is null the function returns an empty Map. The
 * downstream validator then fail-opens every element-scope decision to in-scope
 * (per the Spec 2026-05-26 backward-compat layer 3); architecture-scope
 * decisions still fire normally.
 */
const defaultFetchElementInventoryForCitationCheck: ElementInventoryForCitationFetcher = async (
  projectId,
  architectureId
) => {
  if (!architectureId) {
    return new Map<string, string>();
  }
  try {
    const inventory: ElementInventoryResponse = await defaultGetElementsInventoryForCitation(
      projectId,
      architectureId
    );
    const map = new Map<string, string>();
    for (const domain of inventory.domains ?? []) {
      for (const type of domain.types ?? []) {
        for (const instance of type.instances ?? []) {
          if (instance && typeof instance.id === 'string' && typeof instance.name === 'string') {
            map.set(instance.id, instance.name);
          }
        }
      }
    }
    return map;
  } catch (e) {
    const status = e instanceof ArchitectureModelHttpError ? e.status : undefined;
    logger.warn(
      'Architecture Model Service elements-inventory lookup failed in shape-spec handler; element-scope captured decisions will fail-open in-scope for this batch',
      {
        projectId,
        architectureId,
        status,
        error: e instanceof Error ? e.message : String(e),
      }
    );
    return new Map<string, string>();
  }
};

export const defaultLoadBookOfWork: BookOfWorkLoader = async (projectId, bookOfWorkId) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS GET /migration-books-of-work/${bookOfWorkId} returned ${response.status}: ${text || '<empty body>'}`
    );
  }
  const dto = (await response.json()) as {
    id?: string;
    project_id?: string;
    current_architecture_id?: string | null;
    target_architecture_id?: string | null;
    book_of_work_json?: Record<string, unknown> | null;
  };
  const items: LoadedBookOfWorkItem[] = [];
  const rawItems = (dto.book_of_work_json?.items as unknown[]) || [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    items.push({
      id: String(obj.id ?? ''),
      type: (obj.type as LoadedBookOfWorkItem['type']) ?? 'story',
      parentId: (obj.parentId as string | null) ?? null,
      title: String(obj.title ?? ''),
      sequenceOrder: Number(obj.sequenceOrder ?? 0),
      workItemId: (obj.workItemId as string | null | undefined) ?? null,
      predictedReadiness: (obj.readiness as string | null | undefined) ?? null,
      description: (obj.description as string | null | undefined) ?? null,
      // D3 (2026-06-14): the provenance link the append-capability-story
      // endpoint stamps onto the blob item. Tolerate snake_case (AMS wire) +
      // camelCase. Drives the 7th `operational_capability` context block.
      sourceCapabilityId:
        (obj.source_capability_id as string | null | undefined) ??
        (obj.sourceCapabilityId as string | null | undefined) ??
        null,
      // D5 (2026-06-14): the provenance marker + prompt-flavour kind the
      // add-item endpoint stamps onto a MANUAL-add blob item. Tolerate
      // snake_case + camelCase. `provenance` present + NO source_capability_id
      // => description-grounded spec-gen; `kind` tunes only the prompt flavour.
      provenance:
        (obj.provenance as string | null | undefined) ?? null,
      kind:
        (obj.kind as string | null | undefined) ?? null,
      // Spec 6: carry the blob item's tags so the verbatim-manifest carriage
      // recognises the scaffold story by its `seed_build_files` tag (its `kind`
      // is `operational` to satisfy AMS ALLOWED_KINDS).
      tags: Array.isArray(obj.tags)
        ? (obj.tags as unknown[]).map((t) => String(t))
        : null,
      // Spec 2026-07-23: planner-authored acceptance criteria + declared
      // missing inputs (tolerate snake_case + camelCase). Feed the
      // deterministic pack-review spec text and the prerequisite route's
      // own-reasons reporting respectively.
      acceptanceCriteria: Array.isArray(obj.acceptanceCriteria)
        ? (obj.acceptanceCriteria as unknown[]).map((c) => String(c))
        : Array.isArray(obj.acceptance_criteria)
          ? (obj.acceptance_criteria as unknown[]).map((c) => String(c))
          : null,
      plannerMissingInputs: Array.isArray(obj.missingInputs)
        ? (obj.missingInputs as Array<string | Record<string, unknown>>)
        : Array.isArray(obj.missing_inputs)
          ? (obj.missing_inputs as Array<string | Record<string, unknown>>)
          : null,
      // Spec 2026-07-02-c: DB-pack carriage markers (stamped by Spec -b's
      // deterministic DB expansion). Tolerate snake_case + camelCase.
      packId:
        (obj.pack_id as string | null | undefined) ??
        (obj.packId as string | null | undefined) ??
        null,
      packFilePaths: Array.isArray(obj.packFilePaths)
        ? (obj.packFilePaths as unknown[]).map((p) => String(p))
        : Array.isArray(obj.pack_file_paths)
          ? (obj.pack_file_paths as unknown[]).map((p) => String(p))
          : null,
      packFilePathPrefixes: Array.isArray(obj.packFilePathPrefixes)
        ? (obj.packFilePathPrefixes as unknown[]).map((p) => String(p))
        : Array.isArray(obj.pack_file_path_prefixes)
          ? (obj.pack_file_path_prefixes as unknown[]).map((p) => String(p))
          : null,
      // Spec 2026-07-06-h: code-carriage markers (stamped by Spec -g's
      // deterministic code planner). Pure mapping, unit-tested in the
      // carriage module.
      ...codeCarriageMarkersFromBlob(obj),
    });
  }
  return {
    bookOfWorkId,
    projectId,
    currentArchitectureId: dto.current_architecture_id ?? '',
    targetArchitectureId: dto.target_architecture_id ?? null,
    items,
  };
};

const defaultLoadExistingGenerations: ExistingGenerationsLoader = async (
  projectId,
  bookOfWorkId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}/spec-generations`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 404) return [];
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS GET /spec-generations returned ${response.status}: ${text || '<empty body>'}`
    );
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => normaliseAmsRow(row as Record<string, unknown>));
};

export function normaliseAmsRow(row: Record<string, unknown>): MigrationStorySpecGenerationDto {
  // Tolerate both snake_case (AMS wire) and camelCase (already-normalised).
  const get = (snake: string, camel: string): unknown =>
    row[snake] !== undefined ? row[snake] : row[camel];
  return {
    id: (get('id', 'id') as string | undefined) ?? null,
    projectId: String(get('project_id', 'projectId') ?? ''),
    workItemId: String(get('work_item_id', 'workItemId') ?? ''),
    bookOfWorkId: (get('book_of_work_id', 'bookOfWorkId') as string | null | undefined) ?? null,
    bookItemId: (get('book_item_id', 'bookItemId') as string | null | undefined) ?? null,
    status: get('status', 'status') as SpecGenerationStatusValue,
    confidence:
      (get('confidence', 'confidence') as SpecGenerationConfidence | null | undefined) ?? null,
    predictedReadiness:
      (get('predicted_readiness', 'predictedReadiness') as string | null | undefined) ?? null,
    generatedSpecText:
      (get('generated_spec_text', 'generatedSpecText') as string | null | undefined) ?? null,
    warningsJson:
      (get('warnings_json', 'warningsJson') as
        | Array<Record<string, unknown>>
        | null
        | undefined) ?? null,
    missingInputsJson:
      (get('missing_inputs_json', 'missingInputsJson') as
        | Array<Record<string, unknown>>
        | null
        | undefined) ?? null,
    focusedContextRefsJson:
      (get('focused_context_refs_json', 'focusedContextRefsJson') as
        | Record<string, unknown>
        | null
        | undefined) ?? null,
    evidenceRefsJson:
      (get('evidence_refs_json', 'evidenceRefsJson') as unknown[] | null | undefined) ?? null,
    generatedAt: (get('generated_at', 'generatedAt') as string | null | undefined) ?? null,
    errorMessage: (get('error_message', 'errorMessage') as string | null | undefined) ?? null,
    generationAttemptNumber:
      (get('generation_attempt_number', 'generationAttemptNumber') as number | null | undefined) ??
      null,
    createdByTask:
      (get('created_by_task', 'createdByTask') as string | null | undefined) ?? null,
    createdAt: (get('created_at', 'createdAt') as string | null | undefined) ?? null,
    updatedAt: (get('updated_at', 'updatedAt') as string | null | undefined) ?? null,
    generationPass: (get('generation_pass', 'generationPass') as number | null | undefined) ?? null,
    pass1SpecText: (get('pass1_spec_text', 'pass1SpecText') as string | null | undefined) ?? null,
    pass2ChangesSummary:
      (get('pass2_changes_summary', 'pass2ChangesSummary') as string | null | undefined) ?? null,
    budgetMetaJson:
      (get('budget_meta_json', 'budgetMetaJson') as Record<string, unknown> | null | undefined) ??
      null,
    noMeaningfulChange:
      (get('no_meaningful_change', 'noMeaningfulChange') as boolean | null | undefined) ?? null,
    decisionsJson: (get('decisions_json', 'decisionsJson') as string[] | null | undefined) ?? null,
    interfacesJson:
      (get('interfaces_json', 'interfacesJson') as string[] | null | undefined) ?? null,
    assumptionsJson:
      (get('assumptions_json', 'assumptionsJson') as string[] | null | undefined) ?? null,
    structuredTestsJson:
      (get('structured_tests_json', 'structuredTestsJson') as
        | Array<Record<string, unknown>>
        | null
        | undefined) ?? null,
    coveredEndpointIds:
      (get('covered_endpoint_ids', 'coveredEndpointIds') as string[] | null | undefined) ?? null,
    stale: (get('stale', 'stale') as boolean | null | undefined) ?? null,
    staleReason: (get('stale_reason', 'staleReason') as string | null | undefined) ?? null,
    staleMarkedAt:
      (get('stale_marked_at', 'staleMarkedAt') as string | null | undefined) ?? null,
  };
}

const defaultCallLlm: LlmCaller = async ({ systemPrompt, userPrompt, projectId, workItemId }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `pm-migration-shape-spec-${workItemId}-${Date.now()}`,
    `pm-migration-shape-spec-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultPersistBatchResults: PersistBatchFn = async (
  projectId,
  bookOfWorkId,
  results
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}/spec-generations/batch`;
  // Re-serialise into snake_case for the AMS wire shape.
  const body = results.map((r) => toAmsWireShape(r));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS POST /spec-generations/batch returned ${response.status}: ${text || '<empty body>'}`
    );
  }
  const dto = (await response.json()) as {
    persistedCount?: number;
    resultsCouldNotPersist?: number;
    perStoryResults?: unknown[];
  };
  return {
    persistedCount: dto.persistedCount ?? 0,
    resultsCouldNotPersist: dto.resultsCouldNotPersist ?? 0,
    perStoryResults: Array.isArray(dto.perStoryResults)
      ? dto.perStoryResults.map((row) => normaliseAmsRow(row as Record<string, unknown>))
      : undefined,
  };
};

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * default AMS-backed implementation of the manually-edited pre-flight.
 */
const defaultFetchManuallyEditedInScope: ManuallyEditedInScopeFetcher = async (
  projectId,
  bookOfWorkId,
  workItemIds,
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  let url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}` +
    `/spec-generations/manually-edited-in-scope`;
  if (workItemIds && workItemIds.length > 0) {
    const qs = workItemIds
      .filter((v) => typeof v === 'string' && v.length > 0)
      .map((v) => `workItemIds=${encodeURIComponent(v)}`)
      .join('&');
    if (qs.length > 0) url = `${url}?${qs}`;
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 404) return [];
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS GET /manually-edited-in-scope returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      workItemId: String(row.workItemId ?? row.work_item_id ?? ''),
      workItemTitle: (row.workItemTitle ?? row.work_item_title ?? null) as string | null,
      lastManuallyEditedBy:
        (row.lastManuallyEditedBy ?? row.last_manually_edited_by ?? null) as string | null,
      lastManuallyEditedAt:
        (row.lastManuallyEditedAt ?? row.last_manually_edited_at ?? null) as string | null,
      specId: (row.specId ?? row.spec_id ?? row.id ?? null) as string | null,
    };
  });
};

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * default AMS-backed implementation that clears the `manually_edited`
 * flag on a single row by hitting the regenerate endpoint with
 * `overwriteManuallyEdited=true` and no patch body. AMS's
 * `regenerateSingleStory` clears the four manual-edit columns when the
 * flag is true (see service code) and re-runs the parser + scorer on the
 * existing text -- idempotent for our pre-clear purpose.
 */
const defaultClearManuallyEditedFlag: ManuallyEditedFlagClearer = async (
  projectId,
  specId,
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/${encodeURIComponent(specId)}/regenerate` +
    `?overwriteManuallyEdited=true`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // No patch body -- we just want the flag-clear side effect.
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS POST /regenerate?overwriteManuallyEdited=true returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
};

/**
 * Implementation-Ready Migration Spec Generation (2026-06-14, Group 3): default
 * implement-state writer. Writes the assembled PersistedImplementationState
 * literal straight to the gateway-filesystem implement-state file using the
 * SAME path-derivation + atomic temp+rename contract as
 * `gateway/src/routes/implementState.ts` (the implement panel hydrates from
 * this exact file). Writing to disk directly -- rather than self-HTTP -- avoids
 * a gateway-port dependency and keeps the batch self-contained.
 */
const defaultPutImplementState: ImplementStatePutter = async (body) => {
  const kind = normalizeKind(body.kind);
  const folderName = deriveFolderName(body.featureTitle, body.featureId);
  const { dirPath } = buildTranscriptPath(body.projectParentFolder, folderName, kind);
  await fs.promises.mkdir(dirPath, { recursive: true });
  const jsonFilePath = path.join(dirPath, 'implementation-state.json');
  const tempPath = jsonFilePath + '.tmp';
  await fs.promises.writeFile(tempPath, JSON.stringify(body.state, null, 2), 'utf8');
  await fs.promises.rename(tempPath, jsonFilePath);
  return { success: true };
};

/**
 * AMS types `warnings_json` / `missing_inputs_json` STRICTLY as
 * `List<Map<String,Object>>`, and `@RequestBody List<...>` binds ATOMICALLY —
 * one malformed element Jackson-rejects the whole batch as 400 "Required
 * request body is missing or malformed" (the live `couldNotPersist=25`; the
 * GlobalExceptionHandler masks the real cause). The gateway validator accepts
 * these entries as strings OR objects, so normalise at the wire boundary:
 * bare strings wrap as `{ message }`, objects pass through, null stays null
 * (never an accidental empty-array coercion).
 */
export function toObjectArrayOrNull(value: unknown): Array<Record<string, unknown>> | null {
  if (value == null || !Array.isArray(value)) return null;
  return value.map((entry) => {
    if (typeof entry === 'string') return { message: entry };
    if (entry && typeof entry === 'object') return entry as Record<string, unknown>;
    return { message: String(entry) };
  });
}

/**
 * `evidence_refs_json` is STRICTLY `List<String>` on the AMS side — an object
 * entry throws the same batch-wide Jackson rejection. Objects reduce to their
 * `id` when present (else a JSON string); strings pass through; null stays
 * null.
 */
export function toStringArrayOrNull(value: unknown): string[] | null {
  if (value == null || !Array.isArray(value)) return null;
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === 'string' && id !== '') return id;
      return JSON.stringify(entry);
    }
    return String(entry);
  });
}

export function toAmsWireShape(r: MigrationStorySpecGenerationDto): Record<string, unknown> {
  return {
    id: r.id ?? null,
    project_id: r.projectId,
    work_item_id: r.workItemId,
    book_of_work_id: r.bookOfWorkId ?? null,
    book_item_id: r.bookItemId ?? null,
    status: r.status,
    confidence: r.confidence ?? null,
    predicted_readiness: r.predictedReadiness ?? null,
    generated_spec_text: r.generatedSpecText ?? null,
    warnings_json: toObjectArrayOrNull(r.warningsJson),
    missing_inputs_json: toObjectArrayOrNull(r.missingInputsJson),
    focused_context_refs_json: r.focusedContextRefsJson ?? null,
    evidence_refs_json: toStringArrayOrNull(r.evidenceRefsJson),
    generated_at: r.generatedAt ?? null,
    error_message: r.errorMessage ?? null,
    generation_attempt_number: r.generationAttemptNumber ?? null,
    created_by_task: r.createdByTask ?? TASK_ID,
    created_at: r.createdAt ?? null,
    updated_at: r.updatedAt ?? null,
    // Cross-story context injection fields (2026-05-20).
    generation_pass: r.generationPass ?? null,
    pass1_spec_text: r.pass1SpecText ?? null,
    pass2_changes_summary: r.pass2ChangesSummary ?? null,
    budget_meta_json: r.budgetMetaJson ?? null,
    no_meaningful_change: r.noMeaningfulChange ?? null,
    decisions_json: r.decisionsJson ?? null,
    interfaces_json: r.interfacesJson ?? null,
    assumptions_json: r.assumptionsJson ?? null,
    // Implementation-Ready Migration Spec Generation (2026-06-14).
    structured_tests_json: r.structuredTestsJson ?? null,
    covered_endpoint_ids: r.coveredEndpointIds ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers — selection + filtering
// ---------------------------------------------------------------------------

/**
 * Resolve the effective batch size, with env override and a minimum of 1.
 */
export function resolveBatchSize(input?: number): number {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    return Math.floor(input);
  }
  const env = process.env.SHAPE_SPEC_BATCH_SIZE;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_SHAPE_SPEC_BATCH_SIZE;
}

/**
 * Pick the next N saved-story WorkItems eligible for spec generation, in
 * book-of-work `sequenceOrder` (ties broken by id for determinism).
 *
 * "Eligible" excludes:
 *   - non-story items (initiative / epic / feature)
 *   - MANUAL-execution items (Spec 2026-08-04-1): human work never generates
 *     a spec — no hollow "this is human work" text, no insufficient_context
 *     rows. Their readiness still shows via the preflight routes.
 *   - items without a `workItemId` (story not yet saved to backlog)
 *   - rows already at `status='generated'` (unless `regenerateAll=true`)
 */
export function selectEligibleStories(
  bow: LoadedBookOfWork,
  existing: MigrationStorySpecGenerationDto[],
  batchSize: number,
  regenerateAll: boolean,
  targetWorkItemIds?: ReadonlySet<string>
): LoadedBookOfWorkItem[] {
  const storiesById = new Map<string, MigrationStorySpecGenerationDto>();
  for (const e of existing) {
    storiesById.set(e.workItemId, e);
  }
  const candidates = bow.items
    .filter((it) => it.type === 'story')
    .filter((it) => !isManualExecutionItem(it))
    .filter((it) => typeof it.workItemId === 'string' && it.workItemId.length > 0)
    .sort((a, b) => {
      if (a.sequenceOrder !== b.sequenceOrder) return a.sequenceOrder - b.sequenceOrder;
      return a.id.localeCompare(b.id);
    });
  const eligible: LoadedBookOfWorkItem[] = [];
  for (const it of candidates) {
    if (targetWorkItemIds && !targetWorkItemIds.has(it.workItemId as string)) {
      continue;
    }
    const existingRow = storiesById.get(it.workItemId as string);
    // R-8 skip-generated — EXCEPT stale rows (2026-07-26): a story amended for
    // a carry-over finding keeps status='generated' but is marked stale, and
    // MUST regenerate through this same batch flow (regeneration clears the
    // stamp on success). Without this carve-out an amended story would stay
    // stale forever unless the user found the per-story Regenerate.
    if (
      existingRow &&
      existingRow.status === 'generated' &&
      existingRow.stale !== true &&
      !regenerateAll
    ) {
      continue;
    }
    eligible.push(it);
    if (eligible.length >= batchSize) break;
  }
  return eligible;
}

/**
 * Detect insufficient-context signals on the focused-context payload BEFORE
 * the LLM call (acceptance signal 9). Returns the missingInputs[] array to
 * record on the per-story row, or null if context is sufficient.
 *
 * Exported (Phase 0, 2026-07-20): the spec PREFLIGHT reuses this exact check so
 * the plan screen's readiness chip and the generator agree by construction.
 */
export function detectInsufficientContext(
  ctx: MigrationSpecContextDto
): Array<Record<string, unknown>> | null {
  // Top-level missingInputs from AMS (story-wide blockers).
  const topLevel = Array.isArray(ctx.missingInputs) ? ctx.missingInputs : [];
  if (topLevel.length > 0) {
    return topLevel.map((m) => ({ ...m }));
  }
  // Per-block missingInputs aggregated.
  const aggregated: Array<Record<string, unknown>> = [];
  for (const ct of SHAPE_SPEC_CONTEXT_TYPES) {
    const block = (ctx as Record<string, unknown>)[ct] as
      | { missingInputs?: Array<Record<string, unknown>> }
      | undefined;
    if (block && Array.isArray(block.missingInputs)) {
      for (const m of block.missingInputs) {
        aggregated.push({ ...m });
      }
    }
  }
  if (aggregated.length > 0) {
    return aggregated;
  }
  return null;
}

/**
 * Confidence downgrade decision per R-7. Inspects the focused-context payload
 * for missing signals when the LLM rated `high`. Returns the downgraded
 * confidence + the list of missing signal names; if no downgrade applies,
 * returns the original confidence with an empty list.
 */
export function computeConfidenceDowngrade(
  rated: SpecGenerationConfidence,
  ctx: MigrationSpecContextDto
): { confidence: SpecGenerationConfidence; missingSignals: string[] } {
  if (rated !== 'high') {
    return { confidence: rated, missingSignals: [] };
  }
  const missing: string[] = [];

  // API/SOAP signal: mappings, baselines, contracts.
  const api = ctx.api as { mappingIds?: unknown[]; behaviourBaselineIds?: unknown[]; oasContractId?: unknown } | undefined;
  const soap = ctx.soap as { mappingIds?: unknown[]; baselineIds?: unknown[]; wsdlRef?: unknown } | undefined;
  const isApiStory = api !== undefined || soap !== undefined;
  if (isApiStory) {
    const mappingIds = (api?.mappingIds as unknown[] | undefined) ?? (soap?.mappingIds as unknown[] | undefined) ?? [];
    if (!Array.isArray(mappingIds) || mappingIds.length === 0) {
      missing.push('mappings');
    }
    const baselineIds = (api?.behaviourBaselineIds as unknown[] | undefined) ?? (soap?.baselineIds as unknown[] | undefined) ?? [];
    if (!Array.isArray(baselineIds) || baselineIds.length === 0) {
      missing.push('baselines');
    }
    const contract = api?.oasContractId ?? soap?.wsdlRef ?? null;
    if (!contract) {
      missing.push('contracts');
    }
  }

  // Evidence signal: top-level evidence list / discovery findings on the DTO.
  // The DTO does not surface evidence directly at the top level; the LLM's own
  // response evidenceRefs is the user-facing signal. We treat the absence of a
  // focused-context block on a story-type-with-evidence-expected as a signal.
  // For v1, if NO context-type block is populated at all, count it as missing
  // evidence — a strong signal the context is sparse.
  let populatedBlocks = 0;
  for (const ct of SHAPE_SPEC_CONTEXT_TYPES) {
    if ((ctx as Record<string, unknown>)[ct] !== undefined) populatedBlocks += 1;
  }
  if (populatedBlocks === 0) {
    missing.push('evidenceRefs');
  }

  if (missing.length === 0) {
    return { confidence: 'high', missingSignals: [] };
  }
  const downgraded: SpecGenerationConfidence = missing.length >= 2 ? 'low' : 'medium';
  return { confidence: downgraded, missingSignals: missing };
}

/**
 * Compute the next batch start index (1-based BoW sequenceOrder) for the
 * summary surface. Returns the first un-attempted story's sequenceOrder, or
 * 0 if no stories are eligible.
 */
function computeNextBatchStart(
  bow: LoadedBookOfWork,
  existing: MigrationStorySpecGenerationDto[],
  regenerateAll: boolean
): number {
  const eligibility = new Set(
    existing
      .filter((e) => e.status === 'generated' && !regenerateAll)
      .map((e) => e.workItemId)
  );
  const sorted = bow.items
    .filter((it) => it.type === 'story')
    .filter((it) => typeof it.workItemId === 'string' && it.workItemId.length > 0)
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  for (const it of sorted) {
    if (!eligibility.has(it.workItemId as string)) {
      return it.sequenceOrder;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Per-story prompt assembly
// ---------------------------------------------------------------------------

/**
 * D5 (2026-06-14): a story is a MANUAL ADD when it carries a `provenance`
 * marker (the add-item endpoint stamps `carry_over` | `net_new` onto the blob)
 * AND has NO `sourceCapabilityId` (a manual add has no discovered
 * capability/finding). A manual add runs DESCRIPTION-GROUNDED spec-gen: the
 * human `description` REPLACES the discovered-context resolver. (A discovered
 * story has no `provenance` on the blob, so this is false for it.)
 */
export function isManualAdd(story: LoadedBookOfWorkItem): boolean {
  const hasProvenance =
    typeof story.provenance === 'string' && story.provenance.trim().length > 0;
  const hasCapability =
    typeof story.sourceCapabilityId === 'string' &&
    story.sourceCapabilityId.trim().length > 0;
  return hasProvenance && !hasCapability;
}

/** The prompt FLAVOUR a description-grounded item selects. */
export type ManualAddFlavour = 'api' | 'operational' | 'foundation';

/**
 * Resolve a description-grounded item's prompt flavour.
 *
 * An explicit `kind: operational` blob field wins (the AMS add-item
 * contract). Otherwise a code FOUNDATION story (2026-07-31) resolves to
 * `foundation`: these are planner-authored cross-cutting infra stories
 * ("Scheduler & queue infrastructure rehoming", "Security & auth parity
 * foundations", ...) with ZERO endpoints by definition — the old default
 * funnelled them into the `api` flavour, whose "produce an endpoint spec"
 * instruction directly contradicts the manual-add "the description is
 * authoritative" block for an endpoint-less description. The LLM resolved
 * that tension non-deterministically (one run complied, the next returned
 * insufficient_context — the live `de6b7f2d` story). Everything else stays
 * `api` (the AMS add-item default).
 */
export function resolveManualAddFlavour(
  story: LoadedBookOfWorkItem,
  foundationStory = false
): ManualAddFlavour {
  if ((story.kind ?? '').trim().toLowerCase() === 'operational') {
    return 'operational';
  }
  if (foundationStory) return 'foundation';
  return 'api';
}

/**
 * D5 (2026-06-14): build the DESCRIPTION-GROUNDED context for a manual add.
 * This REPLACES the discovered-context resolver fetch
 * (`fetchMigrationSpecContext`): for a manual add there is no discovered
 * capability/finding/endpoint, so the resolver would return nothing ->
 * insufficient_context. Instead the human `description` IS the context. The
 * returned DTO carries the identity fields (so `ctxToRefsBlob` /
 * `focusedContextToCascadeShape` keep working) PLUS a single
 * `description_grounded` block holding the human intent + the resolved prompt
 * flavour. It carries NO `operational_capability` block and NO
 * `missingInputs[]` (the no-fabrication / insufficient-context short-circuit
 * RELAXES — the description is authoritative).
 */
export function buildDescriptionGroundedContext(
  story: LoadedBookOfWorkItem,
  bow: LoadedBookOfWork,
  foundationStory = false
): MigrationSpecContextDto {
  const flavour = resolveManualAddFlavour(story, foundationStory);
  return {
    projectId: bow.projectId,
    bookOfWorkId: bow.bookOfWorkId,
    workItemId: story.workItemId ?? '',
    bookItemId: story.id,
    currentArchitectureId: bow.currentArchitectureId,
    targetArchitectureId: bow.targetArchitectureId ?? null,
    generatedAt: new Date().toISOString(),
    // The SOLE context for a manual add: the human description + the
    // provenance/flavour. NOT a resolver-assembled block; deliberately free of
    // missingInputs so the manual add never short-circuits on "missing
    // discovered context".
    description_grounded: {
      provenance: story.provenance ?? null,
      kind: flavour,
      title: story.title,
      description: story.description ?? null,
    },
  } as MigrationSpecContextDto;
}

export function buildStoryUserPrompt(
  ctx: MigrationSpecContextDto,
  story: LoadedBookOfWorkItem,
  pass: number,
  manualAddFlavour?: ManualAddFlavour,
  /**
   * 2026-08-14: the deterministic captured-decisions stack section, shown to
   * description-grounded stories so the LLM writes AGAINST the decided stack.
   * The prior wording told these stories the decisions context was
   * "intentionally absent" — the exact suppression that produced
   * technology-neutral foundation specs against an empty repository.
   */
  targetStackPromptBlock?: string | null
): string {
  const lines: string[] = [];
  lines.push('STORY METADATA');
  lines.push('==============');
  lines.push(JSON.stringify({
    id: story.id,
    workItemId: story.workItemId,
    title: story.title,
    description: story.description ?? null,
    parentId: story.parentId,
    sequenceOrder: story.sequenceOrder,
    predictedReadiness: story.predictedReadiness ?? null,
    pass,
  }, null, 2));
  lines.push('');
  lines.push('MIGRATION SPEC CONTEXT (focused, per-story)');
  lines.push('===========================================');
  lines.push(JSON.stringify(ctx, null, 2));
  lines.push('');
  // D5 (2026-06-14): for a MANUAL ADD the human description IS the sole
  // authoritative context (it REPLACED the discovered-context resolver). The
  // `kind` flavour tunes ONLY this framing — `api` -> endpoint orientation;
  // `operational` -> effect-test orientation (reusing the SAME effect-test
  // discipline as the discovered operational path, but description-grounded:
  // there is NO operational_capability block here).
  if (manualAddFlavour) {
    lines.push('MANUAL ADD — DESCRIPTION-GROUNDED');
    lines.push('=================================');
    lines.push(
      'This is a manually-added work item. There is NO discovered ' +
        'capability, finding, contract, baseline or mapping for it: the human ' +
        'DESCRIPTION above is the SOLE authoritative intent. Treat it as the ' +
        'ground truth and produce a full implementation-ready spec from it. Do ' +
        'NOT return insufficient_context merely because discovered context is ' +
        'absent — for a manually-added item that absence is expected and the ' +
        'description is authoritative.'
    );
    if (targetStackPromptBlock) {
      // 2026-08-14: the stack IS decided — show it and DEMAND it be used.
      // The old wording ("captured-decisions context is intentionally absent")
      // instructed the exact suppression that produced technology-neutral
      // foundation specs against an empty repository.
      lines.push('');
      lines.push('TARGET TECHNOLOGY STACK (CAPTURED — AUTHORITATIVE)');
      lines.push('==================================================');
      lines.push(targetStackPromptBlock);
      lines.push('');
      lines.push(
        'The target technology stack IS decided — it is listed above. Write the ' +
          'spec AGAINST it: name the concrete frameworks, components, classes and ' +
          'configuration idioms of the captured stack (never a technology-neutral ' +
          'abstraction), and cite the decision codes as [decision:<code>] in ' +
          'evidenceRefs[] and inline rationale. The application itself is created ' +
          'by the scaffold story, sequenced FIRST in this plan — this story ' +
          'implements INSIDE that application, extending its conventions. Do NOT ' +
          'contradict a listed decision; where a decision you need is NOT listed, ' +
          'flag the gap in warnings[] instead of inventing an answer.'
      );
    } else {
      lines.push(
        'No captured-decisions context is available for this item. Do NOT emit ' +
          'NO_CAPTURED_DECISIONS, do NOT invent warning codes about missing or ' +
          'description-only context, and do NOT lower your confidence for the ' +
          'absence of discovered/decision context — warn only about genuine ' +
          'ambiguities INSIDE the description itself.'
      );
    }
    if (manualAddFlavour === 'operational') {
      lines.push(
        'KIND = operational (non-API): this item is an operational / batch / ' +
          'scheduled / housekeeping effect, NOT an HTTP or SOAP endpoint. The ' +
          'STRUCTURED TEST PACK MUST assert EFFECTS rather than an HTTP ' +
          'request/response pair: run / trigger the described job (or the unit ' +
          'under it) and then assert the DB tables it writes, the downstream ' +
          'message it emits, or the snapshot / file artefact it produces. Keep ' +
          'the SAME { title, description, type: unit | functional } shape. Leave ' +
          'coveredEndpointIds empty — there is no endpoint.'
      );
    } else if (manualAddFlavour === 'foundation') {
      lines.push(
        'KIND = foundation (cross-cutting, non-API): this item is a ' +
          'cross-cutting CODE FOUNDATION (infrastructure rehoming, conventions, ' +
          'configuration wiring) that applies across the stream — it is NOT an ' +
          'HTTP or SOAP endpoint and NOT a single scheduled job. Do NOT invent ' +
          'an endpoint path, HTTP method, request/response shape or status ' +
          'codes, and do NOT return insufficient_context because those are ' +
          'absent — a foundation story never has them. Orient the spec around ' +
          'the foundation itself: the CONCRETE components of the captured ' +
          'target stack to put in place (name the actual framework classes / ' +
          'mechanisms the stack implies — e.g. the stack\'s security filter ' +
          'chain, its exception-handler advice, its typed configuration ' +
          'binding — never a framework-neutral "an auth convention"), how ' +
          'interface stories will consume them, and how they extend the ' +
          'application the scaffold story creates. The STRUCTURED TEST PACK ' +
          'asserts the foundation EFFECTS (unit tests on the new components; ' +
          'functional checks that the wiring/convention holds), keeping the ' +
          'SAME { title, description, type: unit | functional } shape. Leave ' +
          'coveredEndpointIds empty — there is no endpoint.'
      );
    } else {
      lines.push(
        'KIND = api: this item is an HTTP / REST (or SOAP) endpoint. Orient the ' +
          'spec around the new endpoint contract (request / response shape, ' +
          'status codes, validation) and write functional tests that assert the ' +
          'endpoint request/response behaviour.'
      );
    }
    lines.push('');
  }
  if (pass === 2) {
    lines.push(
      'PASS 2: Sibling story summaries, parent epic captured decisions, and ' +
        'deduped workstream references are now available. Use them to ensure ' +
        'this spec is internally consistent with the rest of the workstream. ' +
        'Honour the spec template heading structure verbatim (Decisions / ' +
        'Interfaces / Assumptions) -- the heading parser depends on it.'
    );
    lines.push('');
  }
  lines.push(
    'Generate the SpecGenerationResponse structured response now. Honour every hard constraint enumerated in the system prompt.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Focused-context payload adapter for the token-budget cascade
// ---------------------------------------------------------------------------

/**
 * Adapt a {@link MigrationSpecContextDto} into the shape consumed by
 * Spec 1's `applyTokenBudgetCascade`. The cascade operates on the
 * `MigrationDiscoveryContext` discriminant; the focused-context payload is
 * structurally a subset of that DTO (architecture refs + summaries +
 * highlights), so we project the relevant fields into the cascade-friendly
 * shape and lift the truncation back onto the focused DTO when the cascade
 * fires.
 *
 * Per R-5 (always retained): architecture refs for the story, mappings
 * touching the story, contract / baseline IDs. The cascade itself preserves
 * those fields by construction (Spec 1's helper drops only evidence /
 * baseline-detail / finding-summary text).
 */
function focusedContextToCascadeShape(
  ctx: MigrationSpecContextDto
): MigrationDiscoveryContext {
  return {
    projectId: ctx.projectId,
    currentArchitectureId: ctx.currentArchitectureId ?? '',
    targetArchitectureId: ctx.targetArchitectureId ?? null,
    generatedAt: ctx.generatedAt ?? new Date().toISOString(),
    ...({ _focusedSpecContext: ctx } as unknown as Record<string, never>),
  } as MigrationDiscoveryContext;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a single batch of shape-spec generations end-to-end.
 *
 * Cross-Story Context Injection (2026-05-20): orchestrates pass 1 then
 * optionally pass 2. The handler enforces:
 *   - LOOP GUARDRAIL: a caller-requested third pass is refused with
 *     {@link InvalidPassNumberError}.
 *   - LOOP GUARDRAIL: pass 2 reads ONLY pass-1 outputs -- the AMS context
 *     request carries `pass: 2` and `passOneSpecIdsInScope[]` populated only
 *     with pass-1 ids; the resolver mirrors this filter.
 *   - LOOP GUARDRAIL: stories whose pass-1 status is `failed` or
 *     `insufficient_context` are NOT used as sibling context (also enforced
 *     at the resolver boundary).
 *   - Concurrency lock: a second concurrent batch for the same workstream is
 *     refused with {@link WorkstreamLockedError}.
 *
 * @param input  the per-batch input (projectId, bookOfWorkId, optional flags)
 * @param deps   dependency overrides for tests (defaults wire to AMS + LLM)
 * @returns      {@link BatchResult} with per-story results + summary counts
 */
export async function runShapeSpecGenerationBatch(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps = {}
): Promise<BatchResult> {
  // ----- Stage 0: hard cap (Task Group 5.3 LOOP GUARDRAIL) -----
  if (typeof input.pass === 'number') {
    if (input.pass < 1 || input.pass > MAX_PASS) {
      throw new InvalidPassNumberError(input.pass);
    }
  }

  const workstreamId = input.workstreamId ?? input.bookOfWorkId;

  // ----- Stage 0.25: manually-edited pre-flight + filter -----
  // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5).
  // Before the batch loop starts, query AMS for the set of manually-edited
  // rows in scope and split the work-item set into "to be overwritten" vs
  // "to be skipped". Skipped rows are removed from `targetWorkItemIds` (so
  // the inner batch never tries to persist them and trip AMS's manual-edit
  // protection in `persistOne`). Allow-listed rows are pre-cleared via the
  // AMS regenerate endpoint so the subsequent batch write succeeds.
  //
  // Design note (pragmatic v1, documented per Task Group 5 deviation): the
  // gateway does the filtering + clearing instead of plumbing a
  // `confirmOverwrite` flag through the AMS batch endpoint. Both AMS and
  // gateway already have the building blocks (the regenerate endpoint
  // accepts `overwriteManuallyEdited` and clears the four manual-edit
  // columns) so we reuse them rather than expand the AMS batch contract.
  const manualEditFilterResult = await applyManuallyEditedPreFlight(input, deps);

  // ----- Stage 0.5: concurrency lock (Task Group 5.7) -----
  acquireWorkstreamLock(workstreamId, 1);
  try {
    const inner = await runShapeSpecGenerationBatchInner(
      manualEditFilterResult.effectiveInput,
      deps,
      workstreamId,
    );
    // Surface the manually-edited skip metadata onto the outer result.
    if (manualEditFilterResult.skipped.length > 0) {
      inner.skippedManuallyEditedWorkItemIds =
        manualEditFilterResult.skipped.map((s) => s.workItemId);
      inner.skippedManuallyEditedCount = manualEditFilterResult.skipped.length;
      inner.skippedManuallyEditedDetails = manualEditFilterResult.skipped.map((s) => ({
        workItemId: s.workItemId,
        lastManuallyEditedBy: s.lastManuallyEditedBy ?? null,
        lastManuallyEditedAt: s.lastManuallyEditedAt ?? null,
      }));
    } else {
      // Always populate the count so callers can branch on === 0 without
      // null-checks. Empty array is also stable for snapshot tests.
      inner.skippedManuallyEditedWorkItemIds = [];
      inner.skippedManuallyEditedCount = 0;
      inner.skippedManuallyEditedDetails = [];
    }
    return inner;
  } finally {
    releaseWorkstreamLock(workstreamId);
  }
}

/**
 * In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
 * AMS pre-flight + filter step. Returns the effective input to pass into
 * the batch handler (with skipped rows removed from `targetWorkItemIds`)
 * and the audit detail for each skipped row.
 *
 * Behaviour:
 *   - When `overwriteManuallyEdited` is falsy AND no `targetWorkItemIds`
 *     are supplied: skip the pre-flight (Generate-all default path; the
 *     batch handler's existing R-8 skip-generated logic continues to apply).
 *     A future enhancement could pre-flight here too so the
 *     skippedManuallyEditedWorkItemIds list is always accurate; v1 keeps the
 *     query light by only running it when the caller signalled intent.
 *   - When the AMS pre-flight is unavailable (no `fetchManuallyEditedInScope`
 *     dep wired): no-op pass-through. Production wires the dep; tests that
 *     don't care leave it unset.
 *   - When the pre-flight returns an empty list: no-op pass-through.
 *   - When the pre-flight returns rows: split into allow-list (in
 *     `manuallyEditedWorkItemIdsToOverwrite`) and skip (not in the list).
 *     Allow-listed rows are pre-cleared via `clearManuallyEditedFlag`.
 *     Skip rows are removed from `targetWorkItemIds` so the inner batch
 *     never sees them.
 */
async function applyManuallyEditedPreFlight(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps,
): Promise<{
  effectiveInput: RunShapeSpecGenerationBatchInput;
  skipped: Array<{
    workItemId: string;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
    specId?: string | null;
  }>;
}> {
  const fetchScope = deps.fetchManuallyEditedInScope;
  if (!fetchScope) {
    return { effectiveInput: input, skipped: [] };
  }
  const targetIds: string[] | undefined =
    input.targetWorkItemIds && input.targetWorkItemIds.length > 0
      ? input.targetWorkItemIds.filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        )
      : undefined;

  let scopeRows;
  try {
    scopeRows = await fetchScope(input.projectId, input.bookOfWorkId, targetIds);
  } catch (e) {
    logger.warn(
      'Manually-edited pre-flight failed; proceeding without filter',
      { projectId: input.projectId, bookOfWorkId: input.bookOfWorkId,
        error: e instanceof Error ? e.message : String(e) },
    );
    return { effectiveInput: input, skipped: [] };
  }
  if (!Array.isArray(scopeRows) || scopeRows.length === 0) {
    return { effectiveInput: input, skipped: [] };
  }

  const allowList = new Set<string>();
  if (input.overwriteManuallyEdited && input.manuallyEditedWorkItemIdsToOverwrite) {
    for (const id of input.manuallyEditedWorkItemIdsToOverwrite) {
      if (typeof id === 'string' && id.length > 0) allowList.add(id);
    }
  }

  const skipped: Array<{
    workItemId: string;
    lastManuallyEditedBy?: string | null;
    lastManuallyEditedAt?: string | null;
    specId?: string | null;
  }> = [];
  const toClear: Array<{ workItemId: string; specId: string }> = [];
  for (const row of scopeRows) {
    if (!row || !row.workItemId) continue;
    if (allowList.has(row.workItemId)) {
      // Allow-listed: pre-clear the manually_edited flag so the batch
      // persist can overwrite without tripping the AMS guard.
      if (row.specId) {
        toClear.push({ workItemId: row.workItemId, specId: row.specId });
      }
    } else {
      skipped.push({
        workItemId: row.workItemId,
        lastManuallyEditedBy: row.lastManuallyEditedBy ?? null,
        lastManuallyEditedAt: row.lastManuallyEditedAt ?? null,
        specId: row.specId ?? null,
      });
    }
  }

  // Pre-clear allow-listed rows. Failure to clear is non-fatal -- the
  // batch persist will surface a per-row failure (R-12) for those rows.
  const clearer = deps.clearManuallyEditedFlag;
  if (clearer) {
    for (const c of toClear) {
      try {
        await clearer(input.projectId, c.specId);
      } catch (e) {
        logger.warn(
          'Pre-clear manually-edited flag failed (non-blocking)',
          { projectId: input.projectId, specId: c.specId,
            workItemId: c.workItemId,
            error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
  }

  // Filter skipped rows out of the batch input. The batch handler reads
  // `targetWorkItemIds` as a whitelist; if it's undefined (Generate-all
  // path) the batch picks from BoW order. To skip manually-edited rows
  // from a Generate-all run we must promote the target set to "everything
  // except the skipped rows". For now (v1), we only filter when the
  // caller already supplied `targetWorkItemIds` (the common path for
  // single-story regenerate + retry-batch). For Generate-all (no target
  // set), we let the inner batch attempt every story and rely on AMS to
  // refuse the manually-edited writes; the skipped list still surfaces
  // them on the result so the UI shows the count.
  //
  // Wait -- AMS persistOne THROWS `manual_edit_protected` for unconfirmed
  // manually-edited rows. To avoid noisy per-row failures, we DO filter
  // even in the no-target case: build a synthetic `targetWorkItemIds`
  // from the existing BoW minus the skipped set. The inner batch's
  // selection logic falls back to BoW order when no target is supplied,
  // so we need to do this filter by EXCLUSION: load the existing
  // generations and build "every workItemId NOT in skipped".
  //
  // Simplest v1: build the exclusion set and let the inner batch use a
  // new `excludeWorkItemIds` filter. To keep the surface change small,
  // we synthesize the target list from the BoW directly using the same
  // book loader. But we DON'T have it here. Punt: when `targetWorkItemIds`
  // is undefined and there are skipped rows, we leave the batch input
  // alone and rely on the inner persist failure isolation. The skipped
  // list still surfaces them so the UI is accurate.
  const skippedSet = new Set(skipped.map((s) => s.workItemId));
  if (input.targetWorkItemIds && skippedSet.size > 0) {
    const filtered = (input.targetWorkItemIds as ReadonlyArray<string | null | undefined>)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .filter((v) => !skippedSet.has(v));
    return {
      effectiveInput: { ...input, targetWorkItemIds: filtered },
      skipped,
    };
  }
  return { effectiveInput: input, skipped };
}

async function runShapeSpecGenerationBatchInner(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps,
  workstreamId: string
): Promise<BatchResult> {
  // ----- Resolve project config (auto_run_pass_2 + token caps) -----
  const fetchProjectConfig = deps.fetchProjectConfig;
  let autoRunPass2: boolean;
  if (typeof input.autoRunPass2 === 'boolean') {
    autoRunPass2 = input.autoRunPass2;
  } else if (fetchProjectConfig) {
    try {
      const cfg = await fetchProjectConfig(input.projectId);
      autoRunPass2 = cfg.autoRunPass2;
    } catch {
      autoRunPass2 = DEFAULT_AUTO_RUN_PASS_2;
    }
  } else {
    // No dep wired and no per-batch override: default OFF so legacy callers
    // (existing tests, the Spec 2 single-pass path) preserve their
    // pass-1-only behaviour. Production callers wire the project-config
    // fetcher.
    autoRunPass2 = false;
  }

  // ----- Pass 1: single-pass batch -----
  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation pass=1 pass_started ` +
      `workstreamId=${workstreamId} projectId=${input.projectId} bookOfWorkId=${input.bookOfWorkId}`
  );
  const pass1Result = await runSinglePassBatch(input, deps, 1, [], workstreamId);

  // If the caller explicitly requested pass=1, stop here.
  if (input.pass === 1) {
    return pass1Result;
  }

  // ----- Pass 1 -> Pass 2: auto-seed captured decisions -----
  await autoSeedDecisionsFromPass1(pass1Result.perStoryResults, input.projectId, deps);

  // ----- Pass 2: gated by auto-run flag + presence of pass-1 outputs -----
  if (!autoRunPass2) {
    console.log(
      `[diag-gateway] pm_migration_shape_spec_generation pass=2 skipped reason=auto_run_disabled workstreamId=${workstreamId}`
    );
    return pass1Result;
  }
  const passOneSpecIdsInScope = pass1Result.perStoryResults
    .filter((r) => r.status === 'generated' || r.status === 'generated_with_warnings')
    .map((r) => r.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (passOneSpecIdsInScope.length === 0) {
    console.log(
      `[diag-gateway] pm_migration_shape_spec_generation pass=2 skipped reason=no_pass1_successes workstreamId=${workstreamId}`
    );
    return pass1Result;
  }

  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation pass=2 pass_started ` +
      `workstreamId=${workstreamId} passOneSpecIdsInScope=${passOneSpecIdsInScope.length}`
  );
  updateWorkstreamLockPass(workstreamId, 2);

  // For pass 2, we re-run only the stories that succeeded in pass 1.
  const pass2WorkItemIds = pass1Result.perStoryResults
    .filter((r) => r.status === 'generated' || r.status === 'generated_with_warnings')
    .map((r) => r.workItemId);
  const pass2Input: RunShapeSpecGenerationBatchInput = {
    ...input,
    pass: 2,
    targetWorkItemIds: pass2WorkItemIds,
    regenerateAll: true, // pass 2 must re-attempt rows that pass 1 just wrote
  };
  const pass2Result = await runSinglePassBatch(
    pass2Input,
    deps,
    2,
    passOneSpecIdsInScope,
    workstreamId,
    pass1Result.perStoryResults
  );

  // Merge pass-2 results back into the overall result. The combined result
  // surfaces pass-2 rows in `perStoryResults` (latest writes win); pass-1
  // and pass-2 rows are also surfaced separately via `passOneResults` and
  // `passTwoResults`.
  const mergedByWorkItem = new Map<string, SpecGenerationResult>();
  for (const r of pass1Result.perStoryResults) mergedByWorkItem.set(r.workItemId, r);
  for (const r of pass2Result.perStoryResults) mergedByWorkItem.set(r.workItemId, r);
  const merged = Array.from(mergedByWorkItem.values());
  const summary: BatchSummary = {
    generated: 0,
    generated_with_warnings: 0,
    insufficient_context: 0,
    failed: 0,
    skipped_blocked: 0,
  };
  for (const r of merged) summary[r.status] = (summary[r.status] ?? 0) + 1;

  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation pass=2 pass_completed ` +
      `workstreamId=${workstreamId} mergedRows=${merged.length}`
  );

  return {
    perStoryResults: merged,
    persistedCount: pass1Result.persistedCount + pass2Result.persistedCount,
    resultsCouldNotPersist:
      pass1Result.resultsCouldNotPersist + pass2Result.resultsCouldNotPersist,
    unpersistedResults: [
      ...pass1Result.unpersistedResults,
      ...pass2Result.unpersistedResults,
    ],
    nextBatchStart: pass2Result.nextBatchStart,
    summary,
    passOneResults: pass1Result.perStoryResults,
    passTwoResults: pass2Result.perStoryResults,
  };
}

/**
 * Auto-seed captured decisions on the parent epic from each pass-1 spec's
 * parser-extracted `decisions[]`. Idempotent: pinned (user_edited /
 * user_added) rows are skipped server-side. Failure is non-blocking -- a
 * per-story auto-seed exception NEVER aborts the batch (R-12 posture).
 *
 * Task Group 5.4 (Cross-Story Context Injection, 2026-05-20).
 */
async function autoSeedDecisionsFromPass1(
  pass1Rows: SpecGenerationResult[],
  projectId: string,
  deps: ShapeSpecGenerationDeps
): Promise<void> {
  const seeder = deps.autoSeedEpicCapturedDecision;
  if (!seeder) {
    // No seeder wired (e.g. test that does not exercise auto-seed). Silently
    // skip; production callers wire the AMS seeder.
    return;
  }
  for (const row of pass1Rows) {
    if (row.status !== 'generated' && row.status !== 'generated_with_warnings') continue;
    // Parser-extracted decisions come from the AMS write-time parser; the
    // gateway-side mirror covers the case where the AMS DTO does not yet
    // surface `decisionsJson` on the persist response. Either path produces
    // the same array given the deterministic-heading contract.
    let decisions: string[] | null = null;
    if (Array.isArray(row.decisionsJson) && row.decisionsJson.length > 0) {
      decisions = row.decisionsJson;
    } else if (typeof row.generatedSpecText === 'string') {
      decisions = parseShapeSpecHeadings(row.generatedSpecText).decisions;
    }
    if (!decisions || decisions.length === 0) continue;
    // Find the parent epic for this story (best-effort using parentId chain;
    // if the row doesn't carry an epic id we fall back to using the
    // workItemId as a stand-in -- the AMS endpoint will gate by
    // (projectId, epicWorkItemId)).
    const epicWorkItemId = row.workItemId; // resolver-side enforces scoping
    let seeded = 0;
    for (const decisionLine of decisions) {
      const key = extractDecisionKey(decisionLine);
      if (!key) continue;
      try {
        await seeder(
          projectId,
          epicWorkItemId,
          key,
          decisionLine,
          row.id ?? null
        );
        seeded += 1;
      } catch (e) {
        logger.warn('Auto-seed captured decision failed (non-blocking)', {
          projectId,
          epicWorkItemId,
          key,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    console.log(
      `[diag-gateway] pm_migration_shape_spec_generation cross_story_auto_seed ` +
        `workItemId=${row.workItemId} seeded=${seeded}`
    );
  }
}

/**
 * Run a single pass of the shape-spec generation batch (pass 1 OR pass 2).
 *
 * This function carries the bulk of the per-story logic that previously
 * lived directly in `runShapeSpecGenerationBatch`. The wrapper above
 * orchestrates pass 1 and (optional) pass 2 calls; this inner function is
 * agnostic to which pass it is running -- the only pass-specific behaviour
 * is the addition of `pass` + `passOneSpecIdsInScope` to the AMS context
 * request, the pass-2 prompt variant, and the post-LLM contradiction +
 * no-meaningful-change + changes-summary computation for pass-2 rows.
 *
 * @param pass               the pass number being run (1 or 2)
 * @param passOneSpecIdsInScope  pass-1 spec ids the AMS resolver may read
 * @param workstreamId       active concurrency-lock workstream id (logs)
 * @param pass1RowsByWorkItem  on pass 2 only -- map from workItemId to the
 *                             persisted pass-1 row, used for the diff +
 *                             contradiction comparison
 */
async function runSinglePassBatch(
  input: RunShapeSpecGenerationBatchInput,
  deps: ShapeSpecGenerationDeps,
  pass: number,
  passOneSpecIdsInScope: string[],
  workstreamId: string,
  pass1Rows?: SpecGenerationResult[]
): Promise<BatchResult> {
  const {
    projectId,
    bookOfWorkId,
    regenerateAll = false,
    skipBlockedStories = false,
    confirmOverwrite = false,
  } = input;
  const batchSize = resolveBatchSize(input.batchSize);

  const loadBookOfWork = deps.loadBookOfWork ?? defaultLoadBookOfWork;
  const loadExistingGenerations =
    deps.loadExistingGenerations ?? defaultLoadExistingGenerations;
  const fetchSpecContext = deps.fetchSpecContext ?? defaultFetchMigrationSpecContext;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const persistBatchResults =
    deps.persistBatchResults ?? defaultPersistBatchResults;
  const systemPrompt = deps.systemPromptOverride ?? safeReadSystemPrompt();
  const fetchCapturedDecisionsForCitationCheck =
    deps.fetchCapturedDecisionsForCitationCheck ?? defaultFetchCapturedDecisionsForCitationCheck;
  const fetchElementInventoryForCitationCheck =
    deps.fetchElementInventoryForCitationCheck ?? defaultFetchElementInventoryForCitationCheck;

  // Spec 2026-05-25: load the captured-decisions list ONCE per batch (per-story is wasteful;
  // the project-level list does not change during a single batch run). The list feeds the
  // per-story missing-citation extension between parse and the existing R-7 downgrade.
  // Spec 2026-05-26: the fetcher now also returns the resolved `targetArchitectureId` so the
  // inventory fetch below can reuse it without a duplicate Architecture Model Service round-trip.
  let capturedDecisionsForCitation: TargetStateCapturedDecision[] = [];
  let capturedDecisionsTargetArchitectureId: string | null = null;
  try {
    const fetched = await fetchCapturedDecisionsForCitationCheck(projectId);
    capturedDecisionsForCitation = fetched.decisions;
    capturedDecisionsTargetArchitectureId = fetched.targetArchitectureId;
  } catch (e) {
    logger.warn(
      'Captured-decisions fetch failed in shape-spec batch handler; missing-citation extension skipped',
      { projectId, error: e instanceof Error ? e.message : String(e) }
    );
    capturedDecisionsForCitation = [];
    capturedDecisionsTargetArchitectureId = null;
  }

  // Spec 2026-05-26 story-level scope cross-check: build a `Map<elementId, elementName>`
  // ONCE per batch so the validator's `isDecisionInScopeForStory` can resolve element-scope
  // decisions' names without a per-story Architecture Model Service round-trip.
  // Skip-inventory guard: fetch ONLY when at least one element-scope decision exists AND a
  // target architecture id was resolved. Saves the multi-table SQL scan when every captured
  // decision is architecture-scope (the common case during early architecture work).
  let elementInventoryMap: Map<string, string> = new Map<string, string>();
  const hasElementScopeDecision = capturedDecisionsForCitation.some(
    (d) => d.scopeKind === 'element'
  );
  if (
    capturedDecisionsForCitation.length > 0 &&
    hasElementScopeDecision &&
    capturedDecisionsTargetArchitectureId !== null
  ) {
    try {
      elementInventoryMap = await fetchElementInventoryForCitationCheck(
        projectId,
        capturedDecisionsTargetArchitectureId
      );
    } catch (e) {
      // Fail-open at element level: empty Map => element-scope decisions get
      // `scopeElementName=null` => validator fail-opens them to in-scope.
      logger.warn(
        'Element-inventory fetch failed in shape-spec batch handler; element-scope captured decisions will fail-open in-scope for this batch',
        { projectId, error: e instanceof Error ? e.message : String(e) }
      );
      elementInventoryMap = new Map<string, string>();
    }
  }

  // Spec 2026-05-26: build the enriched `CapturedDecisionRefForCitationCheck[]` ONCE per batch
  // (same list feeds every story). Defensively normalise the Architecture Model Service DTO's
  // `scopeKind` to the narrow validator enum -- production emits only
  // `'architecture' | 'element'`, but treating any unrecognised value as `'architecture'`
  // keeps the validator's three-branch decision tree well-defined.
  const enrichedCapturedDecisionsForCitation: CapturedDecisionRefForCitationCheck[] =
    capturedDecisionsForCitation.map((d) => {
      const isElementScope = d.scopeKind === 'element';
      const resolvedName =
        isElementScope && typeof d.scopeRefId === 'string' && d.scopeRefId.length > 0
          ? elementInventoryMap.get(d.scopeRefId) ?? null
          : null;
      return {
        decisionCode: d.decisionCode,
        answerValue: d.answerValue,
        scopeKind: isElementScope ? 'element' : 'architecture',
        scopeRefId: d.scopeRefId ?? null,
        scopeElementName: resolvedName,
      };
    });

  const pass1ByWorkItem = new Map<string, SpecGenerationResult>();
  if (pass1Rows) {
    for (const r of pass1Rows) pass1ByWorkItem.set(r.workItemId, r);
  }

  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation batch_started ` +
      `projectId=${projectId} bookOfWorkId=${bookOfWorkId} ` +
      `batchSize=${batchSize} regenerateAll=${regenerateAll} pass=${pass} workstreamId=${workstreamId}`
  );
  trace.stageStart('SPEC', { project: projectId });

  // ----- Stage 1 + 2: load BoW and existing generations -----
  const bow = await loadBookOfWork(projectId, bookOfWorkId);
  const existing = await loadExistingGenerations(projectId, bookOfWorkId);

  // ----- Spec 5 (Group 4 trigger): resolve the confirmed-manifest seed
  // carriage ONCE per batch. The SeedBuildFilesSource seam reads Spec 3
  // CONFIRMED manifest(s) + service mapping from the confirmed-target source
  // (consumes them as-is — no re-parse/re-resolve/re-curate, D7). When no source
  // is wired (the honest v1 default) OR no confirmed manifest exists, this is a
  // safe NO-OP (enrichment.text === null) and ordinary stories are untouched.
  // NEVER throws — a confirmed-manifest read hiccup degrades to a no-op so the
  // batch can never be broken by it.
  // Decision→manifest auto-apply (2026-08-16): amend the confirmed manifest
  // with any decision-required additions BEFORE the enrichment reads it, so
  // the seeded pom is always decision-consistent. Fail-soft inside; only the
  // production routes wire it (tests skip).
  if (deps.autoApplyDecisionAdditions && bow.targetArchitectureId) {
    await deps
      .autoApplyDecisionAdditions(projectId, bow.targetArchitectureId)
      .catch(() => undefined);
  }
  const seedBuildFilesEnrichment: SeedBuildFilesEnrichment =
    await resolveSeedBuildFilesEnrichment(deps.seedBuildFilesSource, {
      projectId,
      bookOfWorkId,
      targetArchitectureId: bow.targetArchitectureId ?? null,
    });

  // Scaffold bootstrap carriage (2026-08-14): the captured target-state
  // decisions for the book's target architecture, fetched ONCE per batch.
  // Fail-soft: a read hiccup degrades to [] (the scaffold spec still carries
  // the verbatim manifest block and LISTS the uncaptured codes — never guesses).
  let scaffoldDecisions: TargetStateCapturedDecision[] = [];
  if (bow.targetArchitectureId) {
    try {
      const fetchDecisions =
        deps.fetchCapturedDecisionsForSpecs ?? fetchLatestCapturedDecisions;
      scaffoldDecisions = await fetchDecisions(projectId, bow.targetArchitectureId);
    } catch (e) {
      logger.warn('Captured-decisions read for scaffold carriage failed (fail-soft)', {
        projectId,
        bookOfWorkId,
        targetArchitectureId: bow.targetArchitectureId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // Target-stack section (2026-08-14): the deterministic captured-decisions
  // block EVERY service-plane spec carries (carriage and LLM alike) — the fix
  // for eleven technology-neutral specs aimed at an empty repository. Null
  // when no decisions are captured (nothing fabricated).
  const targetStackSectionText = buildTargetStackSpecSection(scaffoldDecisions);

  // ----- Stage 3 + 4: select + filter -----
  const targetSet =
    input.targetWorkItemIds && input.targetWorkItemIds.length > 0
      ? new Set(
          input.targetWorkItemIds.filter(
            (v): v is string => typeof v === 'string' && v.length > 0
          )
        )
      : undefined;
  const eligible = selectEligibleStories(
    bow,
    existing,
    batchSize,
    regenerateAll,
    targetSet
  );

  // ----- Stage 5: serial per-story loop -----
  const perStoryResults: SpecGenerationResult[] = [];
  for (const story of eligible) {
    const workItemId = story.workItemId as string;
    console.log(
      `[diag-gateway] pm_migration_shape_spec_generation story_started ` +
        `workItemId=${workItemId} seq=${story.sequenceOrder} pass=${pass}`
    );

    const baseRow: MigrationStorySpecGenerationDto = {
      projectId,
      workItemId,
      bookOfWorkId,
      bookItemId: story.id,
      status: 'failed',
      confidence: null,
      predictedReadiness: story.predictedReadiness ?? null,
      generatedSpecText: null,
      warningsJson: null,
      missingInputsJson: null,
      focusedContextRefsJson: null,
      evidenceRefsJson: null,
      generatedAt: null,
      errorMessage: null,
      generationAttemptNumber: deriveAttemptNumber(existing, workItemId, regenerateAll),
      createdByTask: TASK_ID,
      generationPass: pass,
    };

    // R-6: skipped_blocked path (only on explicit toggle).
    if (skipBlockedStories && isStoryBlocked(story, existing)) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'skipped_blocked',
        errorMessage: 'Story skipped per Skip Blocked Stories toggle (R-6).',
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Spec 2026-07-02-c: DB-pack VERBATIM CARRIAGE — fully deterministic.
    // The story's spec IS the pack's files byte-for-byte; there is nothing
    // for an LLM to write, so the context resolver, the prompt, the response
    // validators and the confidence downgrade are all bypassed. Missing
    // files -> insufficient_context (the pack changed; regenerate the plan).
    if (isDbPackCarriageStory(story)) {
      const row = await runDbPackSpecCarriage({
        projectId,
        story,
        baseRow,
        fetchPackFiles: deps.fetchPackFiles ?? defaultFetchPackFiles,
      });
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Spec 2026-07-06-h: code-story VERBATIM CARRIAGE — fully deterministic.
    // The spec text embeds the committed contracts + data-effect SQL +
    // behaviour blocks + captured baseline examples; manual-gate stories get
    // deterministic procedure text. Context resolver, prompt, response
    // validators and confidence downgrade are all bypassed; the LLM is never
    // called. Missing facts -> insufficient_context (nothing silent).
    if (isCodeCarriageStory(story)) {
      const row = await runCodeSpecCarriage({
        projectId,
        currentArchitectureId: bow.currentArchitectureId,
        story,
        baseRow,
        deps: {
          fetchCodeSpecFacts: deps.fetchCodeSpecFacts ?? defaultFetchCodeSpecFacts,
        },
        targetStackSectionText,
      });
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // DB-pack HUMAN-PROCEDURE stories (Spec 2026-07-23): fully DETERMINISTIC,
    // no LLM — mirroring the manual-gate carriage. Description-grounded LLM
    // generation produced warnings the operator could not address
    // (missing_decision_citation demanding api.* codes of a DB review story;
    // NO_CAPTURED_DECISIONS / invented codes for deliberately-absent context)
    // and a meaningless `low` confidence. The planner-authored description +
    // acceptance criteria ARE the procedure. missingInputsJson is [] (non-null)
    // so the AMS upsert null-guard OVERWRITES any stale resolver trio persisted
    // by a pre-fix insufficient_context row.
    if (isDbPackReviewStory(story)) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'generated',
        confidence: 'high',
        generatedSpecText: buildDbPackReviewSpecText(story),
        warningsJson: null,
        missingInputsJson: [],
        generatedAt: new Date().toISOString(),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // SCAFFOLD story (2026-08-14): the dedicated seed_build_files story is
    // now fully DETERMINISTIC — the application-bootstrap spec assembled from
    // the verbatim manifest block + the captured decisions. It previously ran
    // the description-grounded LLM path off a one-line planner description
    // (with the manifest block appended after), which produced prose that
    // never asked for a runnable application. No LLM; no confirmed manifest
    // -> honest insufficient_context naming the upload remedy.
    if (isSeedBuildFilesStory(story)) {
      const row = runScaffoldSpecCarriage({
        story,
        baseRow,
        enrichment: seedBuildFilesEnrichment,
        decisions: scaffoldDecisions,
      });
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Prerequisite stories (Spec 2026-07-23): planner-declared blocked gates
    // (`provenance:prerequisite`, e.g. "Resolve code-discovery prerequisites").
    // They are MEANT to be blocked — but pre-fix they fell into the resolver
    // and reported ITS irrelevant trio instead of the planner's OWN gap. Emit
    // insufficient_context with the planner-declared reasons; no LLM.
    if ((story.tags ?? []).includes(CODE_PREREQUISITE_TAG)) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'insufficient_context',
        missingInputsJson: plannerDeclaredMissing(story),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // D5 (2026-06-14): description-grounded MODE for a MANUAL ADD. A manual add
    // carries a `provenance` marker and NO `sourceCapabilityId`, so the
    // discovered-context resolver would return nothing -> insufficient_context.
    // Instead we SWAP the context source: the human `description` IS the
    // context. The rest of the generator (token cascade / two-pass /
    // confidence / implement-state / persistence) runs UNCHANGED — only the
    // context source + the prompt flavour differ. Manual adds NEVER route
    // through D3's discovered operational_capability / capability path.
    // (2026-08-14: the seed-build-files story no longer reaches this path —
    // it short-circuits DETERMINISTICALLY above via the scaffold carriage.)
    // FOUNDATION stories (Spec 2026-07-23): code-provenance tagged with ZERO
    // endpoints ("Security & auth parity foundations" etc.) — cross-cutting
    // planner-authored intent, so they generate DESCRIPTION-GROUNDED. Pre-fix
    // they fell into the discovered-context resolver and short-circuited
    // `insufficient_context` on inputs a cross-cutting story never has.
    // (DB-pack review stories short-circuit DETERMINISTICALLY above and never
    // reach this path.)
    const foundationStory = isCodeFoundationStory(story);
    const manualAdd = isManualAdd(story) || foundationStory;
    // 2026-07-31: foundation stories route to the `foundation` flavour — the
    // old `api` default handed an endpoint-less infra story the "produce an
    // endpoint spec" prompt, contradicting the manual-add block and making
    // the LLM refuse non-deterministically (insufficient_context on some
    // runs, a spec on others).
    const manualAddFlavour: ManualAddFlavour | undefined = manualAdd
      ? resolveManualAddFlavour(story, foundationStory)
      : undefined;

    let ctx: MigrationSpecContextDto | null = null;
    if (manualAdd) {
      // Description-grounded: REPLACE the resolver fetch with the human
      // description. No AMS round-trip; no discovered context.
      ctx = buildDescriptionGroundedContext(story, bow, foundationStory);
      console.log(
        `[diag-gateway] pm_migration_shape_spec_generation description_grounded ` +
          `workItemId=${workItemId} provenance=${story.provenance ?? 'null'} ` +
          `kind=${manualAddFlavour}`
      );
    } else {
      try {
        ctx = await fetchSpecContext({
          projectId,
          bookOfWorkId,
          bookItemId: story.id,
          workItemId,
          currentArchitectureId: bow.currentArchitectureId,
          targetArchitectureId: bow.targetArchitectureId ?? null,
          contextTypes: [...SHAPE_SPEC_CONTEXT_TYPES],
          maxFindings: input.maxFindings,
          maxEvidenceItems: input.maxEvidenceItems,
          maxBaselineItems: input.maxBaselineItems,
          pass: pass === 2 ? 2 : 1,
          passOneSpecIdsInScope:
            pass === 2 ? passOneSpecIdsInScope : undefined,
          // D3 (2026-06-14): forward the story's source capability id (read from
          // the blob item) so the resolver picks the `operational_capability`
          // capability path. Null for ordinary stories -> resolver uses its
          // finding fallback / no operational block.
          sourceCapabilityId: story.sourceCapabilityId ?? null,
        });
      } catch (e) {
        const message =
          e instanceof MigrationSpecContextClientError
            ? `Focused-context fetch failed: status=${e.status} ${e.message}`
            : `Focused-context fetch failed: ${e instanceof Error ? e.message : String(e)}`;
        const row: MigrationStorySpecGenerationDto = {
          ...baseRow,
          status: 'failed',
          errorMessage: message,
        };
        perStoryResults.push(row);
        logStoryResult(row);
        continue;
      }
    }

    // Apply the token-budget cascade. On TokenBudgetOverflowError, mark
    // insufficient_context (acceptance signal 9 — no fabricated spec).
    try {
      applyTokenBudgetCascade(focusedContextToCascadeShape(ctx));
    } catch (e) {
      if (e instanceof TokenBudgetOverflowError) {
        const row: MigrationStorySpecGenerationDto = {
          ...baseRow,
          status: 'insufficient_context',
          missingInputsJson: [
            {
              kind: 'token_budget_overflow',
              reason: e.message,
              overflowingItems: e.overflowingItems,
              finalTokenCount: e.finalTokenCount,
            },
          ],
          focusedContextRefsJson: ctxToRefsBlob(ctx),
          budgetMetaJson: ctx.budget_meta as Record<string, unknown> | null,
        };
        perStoryResults.push(row);
        logStoryResult(row);
        continue;
      }
      // Non-overflow throw — record as a per-story failure (R-12).
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'failed',
        errorMessage: `Token-budget cascade error: ${e instanceof Error ? e.message : String(e)}`,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Pre-LLM insufficient-context short-circuit. RELAXED for a manual add
    // (D5): the human description is the authoritative intent, not something
    // to guess, so a manual add NEVER short-circuits on "missing discovered
    // context" — it proceeds to a full generated spec.
    const ctxBlockers = manualAdd ? null : detectInsufficientContext(ctx);
    if (ctxBlockers && ctxBlockers.length > 0) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'insufficient_context',
        missingInputsJson: ctxBlockers,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
        budgetMetaJson: ctx.budget_meta as Record<string, unknown> | null,
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Single synchronous LLM call (R-3).
    let llmContent: string;
    try {
      const userPrompt = buildStoryUserPrompt(
        ctx,
        story,
        pass,
        manualAddFlavour,
        // Description-grounded stories in service-plane streams see the
        // captured stack (2026-08-14); DB-plane and discovered-context
        // stories keep their existing context surfaces.
        manualAdd && !isDbPlaneStream(story.tags) ? targetStackSectionText : null
      );
      const { content } = await callLlm({
        systemPrompt,
        userPrompt,
        projectId,
        workItemId,
      });
      llmContent = content;
    } catch (e) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'failed',
        errorMessage: `LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Parse JSON content. Failure → per-story failed.
    let parsed: unknown;
    try {
      parsed = JSON.parse(llmContent);
    } catch (e) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'failed',
        errorMessage: `LLM response was not parseable JSON: ${e instanceof Error ? e.message : String(e)}`,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    const validation = assertSpecGenerationResponse(parsed);
    if (!validation.ok) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'failed',
        errorMessage: `Response validation failed: ${validation.errors.join('; ')}`,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    const resp = validation.value;
    if (resp.status === 'failed') {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'failed',
        errorMessage: resp.errorMessage,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    if (resp.status === 'insufficient_context') {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'insufficient_context',
        missingInputsJson: (resp.missingInputs as unknown as Array<Record<string, unknown>>) ?? null,
        evidenceRefsJson: (resp.evidenceRefs as unknown[]) ?? null,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Generated branch — enforce the per-story title-substring rule that the
    // validator could not enforce (Group 4 doesn't know the story title).
    const generated = resp as GeneratedShapeSpecResponseA;
    const titleCheck = checkStoryTitleScope(generated.specText, story.title);
    if (!titleCheck.ok) {
      const row: MigrationStorySpecGenerationDto = {
        ...baseRow,
        status: 'failed',
        errorMessage: titleCheck.reason,
        focusedContextRefsJson: ctxToRefsBlob(ctx),
      };
      perStoryResults.push(row);
      logStoryResult(row);
      continue;
    }

    // Spec 2026-05-25 missing-decision-citation extension. Runs BETWEEN parse and the
    // existing R-7 confidence-downgrade so that:
    //   (a) the extension's downgrade is applied first against the LLM-self-rated confidence;
    //   (b) the existing R-7 downgrade then runs against the already-extended confidence so
    //       both downgrades can compose (e.g. high -> medium via missing-citation, then
    //       medium -> low via R-7 missing-mapping signal) -- additive, no double-counting because
    //       each fires for a different reason.
    // Per-story: a story whose evidenceRefs[] already contains a captured_decision entry is
    // untouched by the extension; only stories missing that citation are warned + downgraded.
    // Spec 2026-07-23: SKIPPED for description-grounded stories (manual adds,
    // seed-build-files, foundations) — they were never shown the captured-
    // decisions context, so demanding a captured_decision citation penalises
    // them for an absence that is BY DESIGN (the same rationale as the R-7
    // exemption below). Discovered-context stories are unchanged.
    const citationExtension = manualAdd
      ? { response: generated, applied: false as const }
      : computeMissingCitationWarning(generated, enrichedCapturedDecisionsForCitation);
    const generatedAfterCitation = citationExtension.response;
    if (citationExtension.applied) {
      console.log(
        `[diag-gateway] pm_migration_shape_spec_generation missing_decision_citation ` +
          `workItemId=${workItemId} from=${citationExtension.originalConfidence} to=${generatedAfterCitation.confidence}`
      );
    }

    // R-7 confidence downgrade -- operates against the (possibly already-downgraded) extension output.
    // D5: SKIPPED for a manual add. R-7 downgrades on MISSING DISCOVERED-CONTEXT
    // signals (mappings / baselines / contracts / populated context blocks); a
    // manual add is description-grounded and deliberately has NONE of those, so
    // the heuristic would wrongly downgrade every manual add. The human
    // description is the authoritative intent, so the LLM-rated confidence stands.
    const downgrade = manualAdd
      ? { confidence: generatedAfterCitation.confidence, missingSignals: [] as string[] }
      : computeConfidenceDowngrade(generatedAfterCitation.confidence, ctx);
    let finalStatus: SpecGenerationStatusValue = generatedAfterCitation.status;
    let finalConfidence: SpecGenerationConfidence = downgrade.confidence;
    const warnings: Array<Record<string, unknown>> = [
      ...((generatedAfterCitation.warnings as Array<Record<string, unknown>>) ?? []),
    ];
    if (citationExtension.applied && finalStatus === 'generated') {
      // The missing-citation warning is meaningful enough to flip status to generated_with_warnings,
      // mirroring the R-7 confidence-downgrade convention.
      finalStatus = 'generated_with_warnings';
    }
    if (downgrade.confidence !== generatedAfterCitation.confidence) {
      warnings.push({
        code: 'CONFIDENCE_DOWNGRADED',
        from: generatedAfterCitation.confidence,
        to: downgrade.confidence,
        missingSignals: downgrade.missingSignals,
      });
      if (finalStatus === 'generated') {
        finalStatus = 'generated_with_warnings';
      }
      console.log(
        `[diag-gateway] pm_migration_shape_spec_generation confidence_downgraded ` +
          `workItemId=${workItemId} from=${generatedAfterCitation.confidence} to=${downgrade.confidence} ` +
          `missingSignals=${downgrade.missingSignals.join(',')}`
      );
    }

    // Implementation-Ready Migration Spec Generation (2026-06-14, D3 + D6):
    // render the structured unit/functional test pack INLINE into the canonical
    // `generated_spec_text` body (the prefix is untouched). Computed here so the
    // pass-2 no-meaningful-change comparison weighs the SAME enriched body that
    // pass 1 persisted (both passes append the pack identically).
    let enrichedSpecText = appendInlineTestPack(
      generated.specText,
      generatedAfterCitation.tests
    );
    // (2026-08-14: the seed-build-files enrichment anchor moved into the
    // deterministic scaffold carriage above — the manifest block is embedded
    // INSIDE the assembled bootstrap spec, not appended after LLM prose.)

    // Target-stack section (2026-08-14): every service-plane LLM-generated
    // spec (foundations, manual adds, discovered stories) carries the
    // deterministic captured-decisions block. DB-plane streams are excluded
    // (their specs carry the pack's own files). Appended HERE — before the
    // pass-2 computations — so the no-meaningful-change comparison weighs the
    // SAME enriched body in both passes.
    if (!isDbPlaneStream(story.tags)) {
      enrichedSpecText = appendTargetStackSection(enrichedSpecText, targetStackSectionText);
    }

    // Parser-extracted structured arrays. AMS re-parses at write time as
    // the canonical source; the gateway computes them here for the
    // contradiction-detection + auto-seed flows that run before persistence.
    const parsedHeadings = parseShapeSpecHeadings(generated.specText);

    // Pass-2 only computations (Task Groups 5.5 + 5.6).
    let pass1SpecText: string | null = null;
    let pass2ChangesSummary: string | null = null;
    let noMeaningfulChange: boolean | null = null;
    if (pass === 2) {
      const priorRow = pass1ByWorkItem.get(workItemId);
      pass1SpecText = priorRow?.generatedSpecText ?? null;
      noMeaningfulChange = computeNoMeaningfulChange(pass1SpecText, enrichedSpecText);
      pass2ChangesSummary = buildPass2ChangesSummary(
        parsedHeadings,
        priorRow,
        ctx,
        noMeaningfulChange
      );

      // Contradiction detection: compare against sibling summaries + epic
      // captured decisions (Task Group 5.6).
      const contradictionFindings = detectContradictionsAgainstSiblings(
        parsedHeadings,
        ctx
      );
      for (const c of contradictionFindings) warnings.push(c);
      if (contradictionFindings.length > 0) {
        console.log(
          `[diag-gateway] pm_migration_shape_spec_generation cross_story_contradiction ` +
            `workItemId=${workItemId} count=${contradictionFindings.length}`
        );
      }

      // Alignment + confidence bump on confirmed epic decision match
      // (Task Group 5.6).
      const alignment = detectEpicAlignmentBump(
        parsedHeadings,
        ctx,
        finalConfidence
      );
      for (const a of alignment.warnings) warnings.push(a);
      finalConfidence = alignment.confidence;

      console.log(
        `[diag-gateway] pm_migration_shape_spec_generation cross_story_pass2_summary ` +
          `workItemId=${workItemId} noMeaningfulChange=${noMeaningfulChange}`
      );
    }

    const row: MigrationStorySpecGenerationDto = {
      ...baseRow,
      status: finalStatus,
      confidence: finalConfidence,
      generatedSpecText: enrichedSpecText,
      warningsJson: warnings,
      // Spec 2026-07-23: NON-NULL empty array so the AMS upsert null-guard
      // OVERWRITES a stale insufficient_context row's missing-inputs list —
      // pre-fix a successful regenerate kept displaying the old resolver trio.
      missingInputsJson: [],
      evidenceRefsJson: (generated.evidenceRefs as unknown[]) ?? null,
      focusedContextRefsJson: ctxToRefsBlob(ctx),
      generatedAt: new Date().toISOString(),
      generationPass: pass,
      pass1SpecText: pass === 2 ? pass1SpecText : enrichedSpecText,
      pass2ChangesSummary,
      noMeaningfulChange,
      decisionsJson: parsedHeadings.decisions,
      interfacesJson: parsedHeadings.interfaces,
      assumptionsJson: parsedHeadings.assumptions,
      budgetMetaJson: (ctx.budget_meta as Record<string, unknown> | undefined) ?? null,
      structuredTestsJson: generatedAfterCitation.tests as unknown as Array<Record<string, unknown>>,
      coveredEndpointIds: Array.isArray(generatedAfterCitation.coveredEndpointIds)
        ? generatedAfterCitation.coveredEndpointIds
        : [],
    };
    perStoryResults.push(row);
    logStoryResult(row);
  }

  // ----- Stage 6: persistence (R-12 — failure-isolated) -----
  let persistedCount = 0;
  let resultsCouldNotPersist = 0;
  let unpersistedResults: SpecGenerationResult[] = [];
  if (perStoryResults.length > 0) {
    // confirmOverwrite must ride the rows INTO the persist call (gold
    // standard 2026-08-07): it used to be stamped AFTER persistBatchResults
    // returned — a pure no-op that silently ignored the user's overwrite
    // confirmation.
    if (confirmOverwrite) {
      for (const r of perStoryResults) {
        (r as unknown as Record<string, unknown>)['_confirmOverwrite'] = true;
      }
    }
    try {
      const persistResult = await persistBatchResults(
        projectId,
        bookOfWorkId,
        perStoryResults
      );
      persistedCount = persistResult.persistedCount;
      resultsCouldNotPersist = persistResult.resultsCouldNotPersist;
      // Hydrate persisted ids from the AMS response into the local rows.
      // This is what lets pass 2 read `passOneSpecIdsInScope[]` and the
      // auto-seed step record `sourceSpecGenerationId`.
      if (Array.isArray(persistResult.perStoryResults)) {
        const byWorkItem = new Map<string, SpecGenerationResult>();
        for (const r of persistResult.perStoryResults) {
          if (r.workItemId) byWorkItem.set(r.workItemId, r);
        }
        for (const r of perStoryResults) {
          const persisted = byWorkItem.get(r.workItemId);
          if (persisted && persisted.id) r.id = persisted.id;
        }
      }
      if (resultsCouldNotPersist > 0) {
        // Identify unpersisted rows by the ABSENT hydrated id (gold standard
        // 2026-08-07) — the old tail-slice assumed failures were the LAST N
        // rows and reported the WRONG stories on any other distribution.
        unpersistedResults = perStoryResults.filter((r) => !r.id);
        if (unpersistedResults.length !== resultsCouldNotPersist) {
          logger.warn('Spec generation unpersisted-count mismatch', {
            projectId,
            bookOfWorkId,
            reported: resultsCouldNotPersist,
            derivedById: unpersistedResults.length,
          });
        }
      }
    } catch (e) {
      // Persistence call itself failed — all results are unpersisted (R-12).
      logger.warn('Spec generation batch persistence failed', {
        projectId,
        bookOfWorkId,
        error: e instanceof Error ? e.message : String(e),
      });
      persistedCount = 0;
      resultsCouldNotPersist = perStoryResults.length;
      unpersistedResults = [...perStoryResults];
    }
  }

  // ----- Stage 6.4: display-only title join (2026-07-20) -----
  // Join each row's readable story title + its parent feature/epic title from
  // the book of work so the spec-gen batch table shows names, not raw
  // work-item UUIDs. Runs AFTER persistence, so these display fields ride the
  // response only and never reach the AMS row.
  {
    const itemByWorkItem = new Map<string, LoadedBookOfWorkItem>();
    const itemById = new Map<string, LoadedBookOfWorkItem>();
    for (const it of bow.items) {
      itemById.set(it.id, it);
      if (it.workItemId) itemByWorkItem.set(it.workItemId, it);
    }
    for (const row of perStoryResults) {
      const item =
        (row.workItemId ? itemByWorkItem.get(row.workItemId) : undefined) ??
        (row.bookItemId ? itemById.get(row.bookItemId) : undefined);
      if (!item) continue;
      row.storyTitle = item.title;
      const parent = item.parentId ? itemById.get(item.parentId) : undefined;
      row.parentTitle = parent?.title ?? null;
    }
  }

  // ----- Stage 6.5: write implement-state.json per generated story -----
  // Implementation-Ready Migration Spec Generation (2026-06-14, Group 3). The
  // generated story's screen state is written so the Implement screen hydrates
  // as a completed PM -> TE session (PlannerResponse + Test Pack, zero open
  // questions). insufficient_context / failed stories are NOT synthesized --
  // we leave the screen reflecting the real gap (D4). Best-effort + isolated.
  await writeImplementStateForGeneratedStories(
    bow,
    perStoryResults,
    deps,
    workstreamId
  );

  // ----- Stage 7: summary + return -----
  const summary: BatchSummary = {
    generated: 0,
    generated_with_warnings: 0,
    insufficient_context: 0,
    failed: 0,
    skipped_blocked: 0,
  };
  for (const r of perStoryResults) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
  }
  const nextBatchStart = computeNextBatchStart(
    bow,
    [...existing, ...perStoryResults],
    regenerateAll
  );

  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation batch_completed ` +
      `generated=${summary.generated} ` +
      `generated_with_warnings=${summary.generated_with_warnings} ` +
      `insufficient_context=${summary.insufficient_context} ` +
      `failed=${summary.failed} ` +
      `skipped_blocked=${summary.skipped_blocked} ` +
      `couldNotPersist=${resultsCouldNotPersist} pass=${pass}`
  );
  // SPEC.BATCH.01 + stage-END scorecard (predicate run-judging). Failed and
  // insufficient_context stories are per-story-isolated and honest (they
  // appear in their own rows); only persistence loss fails the batch.
  trace.predicate(
    'SPEC.BATCH.01', 'spec generation batch persisted every result',
    resultsCouldNotPersist === 0,
    'couldNotPersist == 0',
    `generated=${summary.generated ?? 0} with_warnings=${summary.generated_with_warnings ?? 0} ` +
      `insufficient_context=${summary.insufficient_context ?? 0} failed=${summary.failed ?? 0} ` +
      `skipped_blocked=${summary.skipped_blocked ?? 0} couldNotPersist=${resultsCouldNotPersist} pass=${pass}`,
    { project: projectId },
  );
  trace.stageEnd('SPEC', { project: projectId });

  return {
    perStoryResults,
    persistedCount,
    resultsCouldNotPersist,
    unpersistedResults,
    nextBatchStart,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Implementation-Ready Migration Spec Generation (2026-06-14, Group 3):
// implement-state.json write per generated story.
// ---------------------------------------------------------------------------

/**
 * For each successfully-generated story in the batch, assemble the
 * PersistedImplementationState literal (PlannerResponse + Test Pack, ready) and
 * write it to the implement-state file so the Implement screen hydrates as a
 * completed PM -> TE session (D1/D2/D4/D8).
 *
 * Posture:
 *   - ONLY `generated` / `generated_with_warnings` stories are written; an
 *     `insufficient_context` / `failed` story is left reflecting the real gap
 *     (NOT fake-ready -- D4). The orphaned AMS `work_item_implement_workspace`
 *     JSONB is untouched.
 *   - The project's `projectParentFolder` is resolved once via the
 *     module-cached `fetchProjectFolder`; when it cannot be resolved, the
 *     write is skipped (logged) rather than failing the batch.
 *   - Each write is best-effort: a failure is logged and isolated (R-12) and
 *     NEVER aborts the batch or the AMS persistence.
 */
async function writeImplementStateForGeneratedStories(
  bow: LoadedBookOfWork,
  perStoryResults: SpecGenerationResult[],
  deps: ShapeSpecGenerationDeps,
  workstreamId: string
): Promise<void> {
  const readyRows = perStoryResults.filter(
    (r) => r.status === 'generated' || r.status === 'generated_with_warnings'
  );
  if (readyRows.length === 0) return;

  const putImplementState = deps.putImplementState ?? defaultPutImplementState;

  // Resolve the project parent folder once (module-cached). Skip writes when it
  // cannot be resolved -- the screen state simply is not pre-populated.
  let projectParentFolder: string | null = null;
  try {
    projectParentFolder = await defaultFetchProjectFolder(bow.projectId);
  } catch (e) {
    logger.warn(
      'fetchProjectFolder failed in implement-state write; skipping screen-state hydration for this batch',
      { projectId: bow.projectId, error: e instanceof Error ? e.message : String(e) }
    );
    return;
  }
  if (!projectParentFolder) {
    logger.warn(
      'project_parent_folder unresolved in implement-state write; skipping screen-state hydration for this batch',
      { projectId: bow.projectId }
    );
    return;
  }

  // Index the BoW items so we can recover each story's title from its workItemId.
  const titleByWorkItem = new Map<string, string>();
  for (const it of bow.items) {
    if (it.workItemId) titleByWorkItem.set(it.workItemId, it.title);
  }

  for (const row of readyRows) {
    const storyTitle = titleByWorkItem.get(row.workItemId) ?? row.workItemId;
    // Rebuild the validated Generated shape from the persisted row. The
    // structured tests + spec text + assumptions are all on the row already;
    // coveredEndpointIds rides along for completeness.
    const generated: GeneratedShapeSpecResponseA = {
      status: 'generated',
      confidence: (row.confidence ?? 'low') as SpecGenerationConfidence,
      specText: row.generatedSpecText ?? '',
      warnings: (row.warningsJson as Array<Record<string, unknown>>) ?? [],
      evidenceRefs: (row.evidenceRefsJson as import('./specGenerationResponseValidator').EvidenceRefEntry[]) ?? [],
      assumptions: Array.isArray(row.assumptionsJson) ? (row.assumptionsJson as string[]) : [],
      tests: (Array.isArray(row.structuredTestsJson)
        ? row.structuredTestsJson
        : []) as unknown as StructuredTest[],
      affectedAreas: [],
      coveredEndpointIds: Array.isArray(row.coveredEndpointIds) ? row.coveredEndpointIds : [],
    };

    const planner = buildPlannerResponseFromGenerated(generated, storyTitle);
    const testPlanner = buildTestPlannerResponseFromTests(generated.tests, storyTitle);
    const state = buildPersistedImplementStateLiteral(planner, testPlanner);
    const body: ImplementStatePutBody = {
      projectId: bow.projectId,
      featureId: row.workItemId,
      projectParentFolder,
      featureTitle: storyTitle,
      state,
    };

    try {
      await putImplementState(body);
      console.log(
        `[diag-gateway] pm_migration_shape_spec_generation implement_state_written ` +
          `workItemId=${row.workItemId} workstreamId=${workstreamId} testPlan=${state.latestTestPlannerResponse?.testPlan.length ?? 0}`
      );
    } catch (e) {
      logger.warn('implement-state write failed (non-blocking)', {
        projectId: bow.projectId,
        workItemId: row.workItemId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Pass-2 helpers: no-meaningful-change, changes summary, contradiction
// ---------------------------------------------------------------------------

/**
 * Compare a pass-1 and pass-2 spec text and return true iff they are
 * byte-equivalent after a normalised whitespace compare. The "Pass 2: no
 * meaningful change" badge in the UI is driven by this flag (Task Group 5.5).
 */
export function computeNoMeaningfulChange(
  pass1Text: string | null | undefined,
  pass2Text: string | null | undefined
): boolean {
  if (!pass1Text && !pass2Text) return true;
  if (!pass1Text || !pass2Text) return false;
  const n1 = pass1Text.replace(/\s+/g, ' ').trim();
  const n2 = pass2Text.replace(/\s+/g, ' ').trim();
  return n1 === n2;
}

/**
 * Build the "what changed and why" summary for a pass-2 row using a
 * template (no LLM round-trip per the cost-control guidance). Lists the
 * decision keys that newly appeared compared to pass 1 and cites any
 * sibling spec / epic decision that may have driven the change.
 */
function buildPass2ChangesSummary(
  parsed: { decisions: string[]; interfaces: string[]; assumptions: string[] },
  pass1Row: SpecGenerationResult | undefined,
  ctx: MigrationSpecContextDto,
  noMeaningfulChange: boolean
): string {
  if (noMeaningfulChange) {
    return 'Pass 2 produced no meaningful change versus pass 1 after a normalised whitespace compare. No sibling-context-driven amendments were necessary.';
  }
  const lines: string[] = [];
  const prior = pass1Row?.decisionsJson ?? [];
  const newDecisionKeys = new Set<string>();
  const priorKeys = new Set(prior.map((d) => extractDecisionKey(d)));
  for (const d of parsed.decisions) {
    const k = extractDecisionKey(d);
    if (k && !priorKeys.has(k)) newDecisionKeys.add(k);
  }
  if (newDecisionKeys.size > 0) {
    lines.push(`Pass 2 added ${newDecisionKeys.size} new decision(s): ${Array.from(newDecisionKeys).slice(0, 5).join(', ')}.`);
  }
  // Cite siblings whose decisions matched any of the new keys.
  const siblings = Array.isArray(ctx.sibling_summaries) ? ctx.sibling_summaries : [];
  const citedSiblings: string[] = [];
  for (const s of siblings) {
    const decisions = Array.isArray(s.decisions) ? s.decisions : [];
    for (const d of decisions) {
      const k = extractDecisionKey(d);
      if (k && newDecisionKeys.has(k) && s.workItemId) {
        citedSiblings.push(s.workItemId);
        break;
      }
    }
  }
  if (citedSiblings.length > 0) {
    lines.push(`Sibling spec(s) that contributed: ${citedSiblings.slice(0, 5).join(', ')}.`);
  }
  // Cite epic captured decisions that matched.
  const captured = ctx.parent_rollup?.epic?.capturedDecisions ?? [];
  const citedCaptured: string[] = [];
  for (const c of captured) {
    if (c.decisionKey && newDecisionKeys.has(c.decisionKey.toLowerCase())) {
      citedCaptured.push(c.decisionKey);
    }
  }
  if (citedCaptured.length > 0) {
    lines.push(`Epic captured decision(s) that contributed: ${citedCaptured.slice(0, 5).join(', ')}.`);
  }
  if (lines.length === 0) {
    lines.push('Pass 2 refined the spec wording based on sibling and parent-rollup context.');
  }
  return lines.join(' ');
}

/**
 * Detect contradictions between this pass-2 row's decisions / interfaces
 * and the sibling summaries. Pure TS comparison -- no LLM call. Returns
 * one warning entry per detected contradiction.
 */
export function detectContradictionsAgainstSiblings(
  parsed: { decisions: string[]; interfaces: string[]; assumptions: string[] },
  ctx: MigrationSpecContextDto
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const siblings = Array.isArray(ctx.sibling_summaries) ? ctx.sibling_summaries : [];
  if (siblings.length === 0) return out;
  // Build a map of decision key -> decision text for this row.
  const myDecisions = new Map<string, string>();
  for (const d of parsed.decisions) {
    const k = extractDecisionKey(d);
    if (k) myDecisions.set(k, d);
  }
  for (const s of siblings) {
    if (!s.decisions) continue;
    for (const sd of s.decisions) {
      const sk = extractDecisionKey(sd);
      if (!sk) continue;
      const mine = myDecisions.get(sk);
      if (!mine) continue;
      // Same key, different text -> contradiction signal.
      if (normaliseForCompare(mine) !== normaliseForCompare(sd)) {
        out.push({
          kind: 'contradicts_sibling',
          siblingWorkItemId: s.workItemId,
          conflictingDecisionKey: sk,
          severity: 'review',
          message: `This story's decision "${sk}" conflicts with sibling story ${s.workItemId}.`,
        });
      }
    }
  }
  return out;
}

/**
 * When a pass-2 decision matches a CONFIRMED epic captured decision, emit
 * an `aligned_with_epic_decision` informational warning AND bump the
 * confidence one notch (capped at high). Pure TS comparison.
 */
export function detectEpicAlignmentBump(
  parsed: { decisions: string[]; interfaces: string[]; assumptions: string[] },
  ctx: MigrationSpecContextDto,
  currentConfidence: SpecGenerationConfidence
): { warnings: Array<Record<string, unknown>>; confidence: SpecGenerationConfidence } {
  const warnings: Array<Record<string, unknown>> = [];
  const captured = ctx.parent_rollup?.epic?.capturedDecisions ?? [];
  if (captured.length === 0) {
    return { warnings, confidence: currentConfidence };
  }
  const myKeys = new Set(parsed.decisions.map((d) => extractDecisionKey(d)));
  let alignedConfirmedCount = 0;
  for (const c of captured) {
    if (c.status !== 'confirmed') continue;
    if (c.decisionKey && myKeys.has(c.decisionKey.toLowerCase())) {
      alignedConfirmedCount += 1;
      warnings.push({
        kind: 'aligned_with_epic_decision',
        decisionKey: c.decisionKey,
        epicDecisionId: c.id,
        severity: 'info',
        message: `This story's decision "${c.decisionKey}" aligns with confirmed epic decision.`,
      });
    }
  }
  let bumped: SpecGenerationConfidence = currentConfidence;
  if (alignedConfirmedCount > 0) {
    if (currentConfidence === 'low') bumped = 'medium';
    else if (currentConfidence === 'medium') bumped = 'high';
    // high stays high.
  }
  return { warnings, confidence: bumped };
}

function normaliseForCompare(s: string): string {
  // Drop the "key:" prefix and normalise whitespace + case.
  const colonIdx = s.indexOf(':');
  const body = colonIdx > 0 && colonIdx < 80 ? s.substring(colonIdx + 1) : s;
  return body.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

function safeReadSystemPrompt(): string {
  try {
    return readDefaultSystemPrompt();
  } catch {
    // Defensive — the prompt file MUST exist (G3 sub-task). Default to an
    // empty string so the LLM call can still proceed during a test where the
    // prompt has been intentionally stubbed out; production callers always
    // get the real file.
    return '';
  }
}

function logStoryResult(row: MigrationStorySpecGenerationDto): void {
  const warningsCount = Array.isArray(row.warningsJson) ? row.warningsJson.length : 0;
  const missingCount = Array.isArray(row.missingInputsJson)
    ? row.missingInputsJson.length
    : 0;
  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation story_result ` +
      `workItemId=${row.workItemId} status=${row.status} ` +
      `confidence=${row.confidence ?? 'null'} ` +
      `warnings=${warningsCount} missingInputs=${missingCount} ` +
      `pass=${row.generationPass ?? 1}`
  );
}

function deriveAttemptNumber(
  existing: MigrationStorySpecGenerationDto[],
  workItemId: string,
  regenerateAll: boolean
): number {
  const prev = existing.find((e) => e.workItemId === workItemId);
  if (!prev) return 1;
  if (regenerateAll) {
    return (prev.generationAttemptNumber ?? 0) + 1;
  }
  return (prev.generationAttemptNumber ?? 0) + 1;
}

/**
 * R-6: a story is "blocked" when its predicted readiness from Spec 1 marks it
 * as such, or when the existing row carries a previous `failed` /
 * `insufficient_context` status with a missing-mapping or unresolved-decision
 * blocker. For v1 we treat any non-`ready_for_spec` predicted readiness as
 * blocked when the toggle is ON.
 */
function isStoryBlocked(
  story: LoadedBookOfWorkItem,
  _existing: MigrationStorySpecGenerationDto[]
): boolean {
  const r = (story.predictedReadiness ?? '').toLowerCase();
  return r === 'needs_focused_context' || r === 'needs_user_decision';
}

/**
 * Project the focused-context DTO into the `focused_context_refs_json` blob
 * persisted alongside the generated row. Preserves IDs (mappingIds,
 * baselineIds, contractIds, evidence ids, missingInputs) and discards bodies.
 */
function ctxToRefsBlob(ctx: MigrationSpecContextDto): Record<string, unknown> {
  const refs: Record<string, unknown> = {
    projectId: ctx.projectId,
    bookOfWorkId: ctx.bookOfWorkId,
    workItemId: ctx.workItemId,
    bookItemId: ctx.bookItemId ?? null,
    currentArchitectureId: ctx.currentArchitectureId ?? null,
    targetArchitectureId: ctx.targetArchitectureId ?? null,
    generatedAt: ctx.generatedAt ?? null,
  };
  for (const ct of SHAPE_SPEC_CONTEXT_TYPES) {
    const block = (ctx as Record<string, unknown>)[ct];
    if (block !== undefined && block !== null) {
      refs[ct] = block;
    }
  }
  if (Array.isArray(ctx.missingInputs)) {
    refs.missingInputs = ctx.missingInputs;
  }
  return refs;
}

/**
 * Enforce the per-story title-substring scope rule. Returns ok=true iff the
 * specText is judged to reference the story's title or scope (case-insensitive
 * substring of the title, OR a non-empty title-token overlap).
 */
export function checkStoryTitleScope(
  specText: string,
  storyTitle: string
): { ok: true } | { ok: false; reason: string } {
  if (!specText.startsWith(SPEC_TEXT_REQUIRED_PREFIX)) {
    return {
      ok: false,
      reason: `specText must start with the literal "${SPEC_TEXT_REQUIRED_PREFIX}".`,
    };
  }
  const haystack = specText.toLowerCase();
  const title = storyTitle.trim().toLowerCase();
  if (title.length === 0) {
    // Defensive: no title to check against — treat as ok.
    return { ok: true };
  }
  // 1. Direct full-title substring match.
  if (haystack.includes(title)) {
    return { ok: true };
  }
  // 2. Token-overlap fallback: at least 2 distinctive title tokens (length>=4)
  //    must appear in the specText.
  const tokens = title
    .split(/\W+/)
    .filter((t) => t.length >= 4)
    .filter((t) => !STOPWORDS.has(t));
  let hits = 0;
  for (const t of tokens) {
    if (haystack.includes(t)) hits += 1;
  }
  if (tokens.length === 0) {
    // Title made entirely of short / stopword tokens — accept the spec.
    return { ok: true };
  }
  if (hits >= Math.min(2, tokens.length)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `specText does not reference the story title or scope (story title: "${storyTitle}"; specText prefix: "${specText.substring(0, 120)}").`,
  };
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'this',
  'that',
  'have',
  'will',
  'into',
  'over',
  'when',
  'then',
  'than',
  'them',
  'they',
  'their',
  'there',
  'these',
  'those',
  'each',
  'such',
  'some',
  'must',
  'shall',
  'should',
  'would',
  'could',
  'were',
  'been',
  'being',
  'about',
]);
