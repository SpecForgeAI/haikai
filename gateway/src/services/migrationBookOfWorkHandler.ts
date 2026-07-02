/**
 * Gateway orchestration handler for the Product Manager Migration Delivery Plan flow.
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 6: Gateway Orchestration Handler.
 *
 * Sole-orchestrator flow (Q-1):
 *   1. Resolve Migration Discovery Context via the existing
 *      `migrationDiscoveryContextClient.fetchMigrationDiscoveryContext`
 *      (Q-12 — reused verbatim, no modifications).
 *   2. Apply the token-budget cap (~120k tokens soft cap) and the truncation
 *      cascade in order (Q-4):
 *        a) drop oldest discovery evidence bodies first (IDs retained);
 *        b) compress API Behaviour Baseline detail to summaries;
 *        c) compress mapping rationale text.
 *      Always retained, never truncated: Product Definition, Current
 *      Architecture entity list, Target Architecture entity list, all
 *      current-to-target mappings, all Discovery Finding IDs. If still over
 *      budget after the full cascade, this handler FAILS LOUDLY rather than
 *      silently truncating an always-retained item.
 *   3. Make a single synchronous LLM call (Q-15 — no token streaming).
 *   4. Validate the structured response against the
 *      `GeneratedMigrationBookOfWork` schema (Group 5). Validation failure
 *      throws a structured error BEFORE any AMS write so malformed payloads
 *      never reach persistence.
 *   5. POST the validated payload to AMS at
 *      `POST /api/projects/{projectId}/migration-books-of-work` (Q-3 — gateway
 *      → AMS direct REST; MCP-server is NOT in the loop). Return the
 *      `{ draftId, summary }` envelope to the frontend.
 *
 * Stage markers (Q-15): the handler emits structured log lines so the
 * frontend's scripted client-side stage indicator can correlate to gateway
 * progress milestones:
 *
 *   [diag-gateway] pm_migration_delivery_plan stage=loading_context  projectId=<id>
 *   [diag-gateway] pm_migration_delivery_plan stage=calling_generator projectId=<id> token_count=<N> truncated=<bool>
 *   [diag-gateway] pm_migration_delivery_plan stage=validating_schema projectId=<id>
 *   [diag-gateway] pm_migration_delivery_plan stage=saving_draft     projectId=<id>
 *   [diag-gateway] pm_migration_delivery_plan stage=complete         projectId=<id> draftId=<id>
 *
 * Dependency injection (for tests): the handler accepts overrides for the
 * context resolver, the LLM caller, and the AMS POST so unit tests can mock
 * each stage in isolation. Production callers use the default implementations
 * (no overrides).
 */

import { getConfig } from '../config';
import {
  fetchMigrationDiscoveryContext as defaultFetchMigrationDiscoveryContext,
  MigrationDiscoveryContext,
  MigrationDiscoveryContextRequest,
} from './migrationDiscoveryContextClient';
import {
  GeneratedMigrationBookOfWork,
  MigrationBookOfWorkItem,
  seedEpicExpansionStates,
  validateMigrationBookOfWork,
  validateMigrationBookOfWorkFromContent,
} from './generatedMigrationBookOfWorkSchema';
import { logger } from './logger';
import { LlmConcurrencyPool, getMigrationPlanLlmPool } from './llmConcurrencyPool';
import { EnsurePackFn, EnsurePackOutcome, ensureFreshDbMigrationPack } from './dbMigrationPackEnsure';
import {
  FetchPackViewFn,
  PackView,
  buildDbStreamSkeleton,
  defaultFetchPackView,
} from './migrationDbPackPlanner';

/**
 * The delivery streams whose generation consumes the DB migration pack
 * (Spec 2026-07-02-a): their selection triggers the pack ensure-fresh step
 * before plan generation.
 */
export const DB_PACK_DELIVERY_STREAMS: readonly string[] = [
  'target_database_schema_implementation',
  'data_migration',
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Wizard answers collected from the 7-stage frontend generation wizard.
 * Every field is optional so sparse-context paths can still trigger generation
 * (the LLM converts gaps to prerequisite / refinement stories per the prompt).
 */
export interface MigrationDeliveryPlanWizardAnswers {
  migrationIntent?: string[];
  deliveryStreams?: string[];
  migrationStyle?: string;
  dataAndCutoverAssumptions?: Record<string, unknown>;
  migrationTestPackExpectations?: string[];
}

export interface GenerateMigrationBookOfWorkInput {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
  wizardAnswers?: MigrationDeliveryPlanWizardAnswers;
  /** Optional discovery run ids passed through to the resolver. */
  discoveryRunIds?: string[];
  /** Optional API Behaviour Baseline ids passed through to the resolver. */
  apiBehaviourBaselineIds?: string[];
}

export interface GenerateMigrationBookOfWorkResult {
  draftId: string;
  summary: string;
  /**
   * Optional human-readable warnings produced during generation — surfaced to
   * the frontend so it can show a toast (e.g. truncation occurred).
   */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Soft cap + cascade configuration (Q-4)
// ---------------------------------------------------------------------------

export const MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP = 120_000;

/**
 * Approximates the token count of an arbitrary value by JSON-stringifying it
 * and dividing by 4 (a common rule-of-thumb for English-ish JSON payloads;
 * good enough for budget gating — fine-grained tokenization happens at the
 * LLM provider).
 */
export function approxTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  let str: string;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return 0;
  }
  return Math.ceil(str.length / 4);
}

/**
 * Result of running the token-budget truncation cascade.
 *
 * The cascade always preserves the always-retained set:
 *   - Product Definition
 *   - Current Architecture entity list
 *   - Target Architecture entity list
 *   - All current-to-target mappings
 *   - All Discovery Finding IDs
 *
 * If the cascade cannot bring the payload under the soft cap without
 * sacrificing an always-retained item, `applyTokenBudgetCascade` throws a
 * `TokenBudgetOverflowError` rather than silently dropping critical inputs.
 */
export interface CascadeOutcome {
  /** The (possibly truncated) context payload. */
  context: MigrationDiscoveryContext;
  /** True iff any truncation step actually fired. */
  truncated: boolean;
  /** Human-readable warnings to surface to the frontend. */
  warnings: string[];
  /** Final approximate token count post-cascade. */
  finalTokenCount: number;
}

export class TokenBudgetOverflowError extends Error {
  public readonly overflowingItems: string[];
  public readonly finalTokenCount: number;
  constructor(overflowingItems: string[], finalTokenCount: number) {
    super(
      `Migration delivery plan context exceeds ${MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP}-token soft cap even after the full truncation cascade. ` +
        `Always-retained inputs that cannot be safely dropped: ${overflowingItems.join(', ')}. ` +
        `Final approximate token count: ${finalTokenCount}.`
    );
    this.name = 'TokenBudgetOverflowError';
    this.overflowingItems = overflowingItems;
    this.finalTokenCount = finalTokenCount;
  }
}

export class MigrationBookOfWorkSchemaError extends Error {
  public readonly errors: string[];
  constructor(errors: string[]) {
    super(
      `GeneratedMigrationBookOfWork structured response failed validation: ${errors.join('; ')}`
    );
    this.name = 'MigrationBookOfWorkSchemaError';
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Token-budget cascade (Q-4)
// ---------------------------------------------------------------------------

/**
 * Apply the truncation cascade in order:
 *   1. Drop oldest discovery evidence bodies first (IDs retained).
 *   2. Compress API Behaviour Baseline details to summaries.
 *   3. Compress mapping rationale text.
 *
 * After each step we re-check the soft cap; if we're under it, we stop. If we
 * exhaust the cascade and remain over budget, we throw
 * `TokenBudgetOverflowError` rather than touch always-retained fields.
 *
 * The MigrationDiscoveryContextDto carries only highlights and counts, not
 * full bodies — so "drop oldest evidence body" is implemented as "drop the
 * tail of `evidenceHighlights`" (the IDs in the high-priority findings remain
 * intact), and the baseline / mapping compression collapses the per-baseline /
 * per-mapping detail to summary counts. This matches the spec's intent: never
 * lose IDs, only lose body / rationale text.
 */
export function applyTokenBudgetCascade(
  ctx: MigrationDiscoveryContext
): CascadeOutcome {
  const warnings: string[] = [];
  let working: MigrationDiscoveryContext = { ...ctx };
  let truncated = false;

  let tokenCount = approxTokens(working);
  if (tokenCount <= MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP) {
    return { context: working, truncated: false, warnings, finalTokenCount: tokenCount };
  }

  // Step 1 — drop oldest discovery evidence body fields. The DTO returned by
  // AMS already carries only the highlight envelope (id + type + source +
  // filePath + linked finding ids), not full file bodies. "Drop the body" is
  // implemented here as "drop the tail of evidenceHighlights, retaining
  // linkedFindingIds via the high-priority findings list".
  if (Array.isArray(working.evidenceHighlights) && working.evidenceHighlights.length > 0) {
    // Drop oldest half repeatedly until under cap or list is empty.
    const startCount = working.evidenceHighlights.length;
    while (
      working.evidenceHighlights &&
      working.evidenceHighlights.length > 0 &&
      approxTokens(working) > MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP
    ) {
      // Drop oldest entry (front of array). Note: AMS does not document an
      // ordering guarantee on this field; absent a per-evidence timestamp
      // we treat the first element as "oldest" — same convention as
      // chronological log lines.
      working = {
        ...working,
        evidenceHighlights: working.evidenceHighlights.slice(1),
      };
    }
    const dropped = startCount - (working.evidenceHighlights?.length ?? 0);
    if (dropped > 0) {
      truncated = true;
      warnings.push(
        `Token-budget cascade step 1: dropped ${dropped} oldest evidence highlight ` +
          `entries; IDs remain referenced via highPriorityFindings.`
      );
    }
  }

  tokenCount = approxTokens(working);
  if (tokenCount <= MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP) {
    return { context: working, truncated, warnings, finalTokenCount: tokenCount };
  }

  // Step 2 — compress API Behaviour Baseline detail to summary counts.
  // We retain only the baselineId (so the LLM can still cite the baseline) and
  // the status (so the LLM knows whether the baseline is usable). Names,
  // session ids, per-baseline operation/capture counts, and timestamps are all
  // dropped — the per-baseline detail is reconstructable from the underlying
  // AMS store via the baselineId if the LLM later needs it.
  if (
    working.apiBehaviourBaselineSummary?.baselines &&
    working.apiBehaviourBaselineSummary.baselines.length > 0
  ) {
    const compressedBaselines = working.apiBehaviourBaselineSummary.baselines.map(
      (b) =>
        ({
          baselineId: b.baselineId,
          architectureId: b.architectureId,
          name: '',
          status: b.status,
          // sessionId / operationCount / acceptedCaptureCount / createdAt
          // intentionally dropped to compress the per-baseline detail to the
          // minimum the LLM needs to cite the baseline by id.
          createdAt: '',
        }) as NonNullable<
          NonNullable<
            MigrationDiscoveryContext['apiBehaviourBaselineSummary']
          >['baselines']
        >[number]
    );
    working = {
      ...working,
      apiBehaviourBaselineSummary: {
        ...working.apiBehaviourBaselineSummary,
        baselines: compressedBaselines,
      },
    };
    truncated = true;
    warnings.push(
      `Token-budget cascade step 2: compressed API Behaviour Baseline details to id+status summaries (IDs retained).`
    );
  }

  tokenCount = approxTokens(working);
  if (tokenCount <= MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP) {
    return { context: working, truncated, warnings, finalTokenCount: tokenCount };
  }

  // Step 3 — compress mapping rationale text. The DTO field carries counts +
  // breakdowns (no per-mapping rationale strings); the rationale text lives
  // inside the high-priority finding `summary` fields. We compress by clearing
  // the `summary` strings on high-priority findings (the finding IDs, types,
  // categories, severities, and statuses are retained — only the prose
  // rationale is removed).
  if (Array.isArray(working.highPriorityFindings) && working.highPriorityFindings.length > 0) {
    const stripped = working.highPriorityFindings.map((f) => ({
      ...f,
      summary: null,
    }));
    working = { ...working, highPriorityFindings: stripped };
    truncated = true;
    warnings.push(
      `Token-budget cascade step 3: cleared mapping/finding rationale prose; finding IDs and metadata retained.`
    );
  }

  tokenCount = approxTokens(working);
  if (tokenCount <= MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP) {
    return { context: working, truncated, warnings, finalTokenCount: tokenCount };
  }

  // Cascade exhausted; remaining bloat must be in one of the always-retained
  // sets — fail loudly per Q-4.
  const overflowing: string[] = [];
  if (approxTokens(working.currentArchitectureSummary) > 5000)
    overflowing.push('currentArchitectureSummary');
  if (approxTokens(working.targetArchitectureSummary) > 5000)
    overflowing.push('targetArchitectureSummary');
  if (approxTokens(working.architectureMappingsSummary) > 5000)
    overflowing.push('architectureMappingsSummary');
  if (approxTokens(working.highPriorityFindings) > 5000)
    overflowing.push('highPriorityFindings (IDs)');
  if (overflowing.length === 0) overflowing.push('unknown_always_retained_section');
  throw new TokenBudgetOverflowError(overflowing, tokenCount);
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Builds the user-side prompt content sent alongside the system prompt (the
 * markdown task prompt at `prompts/product-manager.migration-delivery-plan.task.md`).
 *
 * Exported so tests can inspect the assembled payload.
 */
export function buildUserPrompt(
  ctx: MigrationDiscoveryContext,
  wizardAnswers?: MigrationDeliveryPlanWizardAnswers,
  /**
   * When set, scope THIS call to one delivery stream (the per-stream split —
   * 2026-06-11). The Azure relay enforces a hard ~300s request cap, and the
   * whole-plan single shot exceeded it; one call per stream stays well under.
   * The scoped call must produce a COMPLETE, self-contained
   * initiative→epic→feature→story hierarchy for the stream alone; the gateway
   * assembles the per-stream books deterministically afterwards.
   */
  streamScope?: string,
  /**
   * Phase-1 SKELETON mode (Spec 2026-06-11 Two-Phase generation, Task
   * Group 3): scope THIS call to the initiative -> epic -> feature skeleton
   * only — no stories, no acceptance criteria. The per-stream split path
   * always sets this; the legacy no-streams combined path NEVER does (it
   * keeps the full single-call plan — back-compat).
   */
  skeletonMode?: boolean
): string {
  const lines: string[] = [];
  lines.push('MIGRATION DISCOVERY CONTEXT');
  lines.push('===========================');
  lines.push(JSON.stringify(ctx, null, 2));
  lines.push('');
  if (wizardAnswers) {
    lines.push('WIZARD ANSWERS');
    lines.push('==============');
    lines.push(JSON.stringify(wizardAnswers, null, 2));
    lines.push('');
  }
  if (streamScope) {
    lines.push('DELIVERY STREAM SCOPE — THIS CALL COVERS EXACTLY ONE STREAM');
    lines.push('===========================================================');
    lines.push(`Scope: ${streamScope}`);
    lines.push('');
    lines.push(
      `This request is ONE of several parallel generation calls — each covers exactly one of the wizard's selected delivery streams, and the results are merged afterwards. Generate ONLY the portion of the book of work for the "${streamScope}" delivery stream:`
    );
    lines.push(
      `- Include ONLY work that belongs to "${streamScope}". The other selected streams are being generated by their own calls — do NOT duplicate their work or emit placeholder items for them.`
    );
    lines.push(
      '- Produce a COMPLETE, SELF-CONTAINED hierarchy for this stream: at least one root initiative (parentId=null) with its epics, features, and stories. Every parentId must resolve WITHIN this response.'
    );
    lines.push(
      '- Item ids only need to be unique within THIS response; the merge step namespaces them per stream.'
    );
    lines.push(
      '- `sequenceOrder` expresses ordering WITHIN this stream only; cross-stream ordering is handled by the merge step.'
    );
    lines.push(
      '- Cross-stream prerequisites (e.g. schema work this stream depends on) belong to their own stream — reference them in `readinessReasons` / `missingInputs` prose instead of emitting items for them.'
    );
    lines.push('');
  }
  if (skeletonMode) {
    lines.push('PHASE 1 — SKELETON MODE (TWO-PHASE GENERATION)');
    lines.push('==============================================');
    lines.push(
      'This is the PHASE-1 SKELETON call of a two-phase generation. Detailed stories are produced later by a separate per-epic expansion phase. For THIS call:'
    );
    lines.push(
      '- Emit ONLY `initiative`, `epic`, and `feature` items. Do NOT emit any `story` items.'
    );
    lines.push(
      '- Keep every item lightweight: a title plus a ONE-LINE description. Do NOT write detailed scope prose.'
    );
    lines.push(
      '- `acceptanceCriteria` MUST be an empty array `[]` on EVERY item — acceptance criteria are produced during phase-2 expansion, never in the skeleton.'
    );
    lines.push(
      '- Every other hard constraint still applies at skeleton granularity: the 14-value workstream vocabulary, `[decision:<code>]` tags in rationale where applicable, valid hierarchy (initiative -> epic -> feature), and `sequenceOrder` delivery ordering.'
    );
    lines.push('');
  }
  lines.push(
    'Generate the GeneratedMigrationBookOfWork structured response now. Respect every hard constraint enumerated in the system prompt.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-stream split + deterministic assembly (2026-06-11)
//
// The whole-plan single LLM call exceeded the Azure relay's hard ~300s request
// cap (HTTP 504 "Endpoint request timed out" at ~5 minutes). The generation is
// now SPLIT into one parallel LLM call per selected delivery stream — each call
// produces a complete, self-contained book for its stream alone and finishes
// well under the cap — and the per-stream books are ASSEMBLED deterministically
// here (no extra LLM call). Atomicity is preserved: AMS is only written after
// EVERY stream validated.
// ---------------------------------------------------------------------------

/**
 * Cross-stream delivery ordering for the assembled `sequenceOrder` (mirrors
 * the system prompt's hard constraint #5: schema work precedes the API work
 * that consumes it; cutover and decommission come last). Streams the wizard
 * may select that are not listed rank at {@link DEFAULT_STREAM_RANK} (after
 * the implementation streams, before the test/cutover tail), keeping their
 * wizard selection order via stable sort.
 */
const STREAM_SEQUENCE_RANK: Record<string, number> = {
  target_infrastructure_environment_implementation: 1,
  target_database_schema_implementation: 2,
  target_service_api_implementation: 3,
  target_frontend_implementation: 4,
  api_soap_integration_compatibility: 5,
  data_migration: 6,
  migration_test_pack: 8,
  reconciliation_reporting: 9,
  cutover_rollback_decommission: 10,
};

const DEFAULT_STREAM_RANK = 7;

/** One per-stream generation result awaiting assembly. */
export interface PerStreamBook {
  stream: string;
  book: GeneratedMigrationBookOfWork;
}

// ---------------------------------------------------------------------------
// Accepted-findings coverage snapshot (Spec 2026-06-11 Deterministic
// Findings-Coverage Verification + Gap Wayfinding, Task Group 1)
//
// At plan CREATE time the gateway snapshots the ACCEPTED (review_status =
// 'approved') critical/high discovery findings for the selected discovery
// runs into `generationSummary.findingsCoverage`. The snapshot is composed
// BEFORE the Stage-5 createDraft call (generation_summary_json is immutable
// post-create) and the frontend grades it ON READ against
// `book_of_work_json.items[].discoveryFindingReferences` -- pure code, no
// LLM involvement, and NEVER sourced from the context's capped
// `highPriorityFindings` list (all-statuses, capped at 100).
// ---------------------------------------------------------------------------

/** One accepted critical/high finding in the create-time snapshot. */
export interface AcceptedFindingSnapshotEntry {
  id: string;
  title: string;
  severity: string;
  runId: string;
  /**
   * D4 re-key (Carry-over Completeness Gate, 2026-06-14): the
   * `detail_json.behaviourBearing` hint — the SOLE gating predicate for the
   * carry_over completeness gate. OPTIONAL + omitted-when-undefined so the
   * legacy severity-keyed create-time snapshot round-trips byte-for-byte; the
   * ACTIVE enforcing computation lives in `migrationCarryOverCoverage.ts` and
   * keys on this field, not on `severity`.
   */
  behaviourBearing?: boolean;
}

/**
 * The deterministic, timestamp-free snapshot persisted at create:
 * `generationSummary.findingsCoverage = { findings: [...] }`, sorted by `id`.
 */
export interface FindingsCoverageSnapshot {
  findings: AcceptedFindingSnapshotEntry[];
}

/**
 * Normalize + de-dupe (by finding id) + id-sort the fetched accepted
 * findings into the persisted snapshot shape. PURE -- exported for tests.
 */
export function buildFindingsCoverageSnapshot(
  accepted: AcceptedFindingSnapshotEntry[]
): FindingsCoverageSnapshot {
  const byId = new Map<string, AcceptedFindingSnapshotEntry>();
  for (const finding of accepted ?? []) {
    if (!finding || typeof finding.id !== 'string' || finding.id.length === 0) continue;
    if (byId.has(finding.id)) continue;
    const entry: AcceptedFindingSnapshotEntry = {
      id: finding.id,
      title: typeof finding.title === 'string' ? finding.title : '',
      severity: typeof finding.severity === 'string' ? finding.severity : '',
      runId: typeof finding.runId === 'string' ? finding.runId : '',
    };
    // D4 re-key: carry the behaviourBearing hint through WHEN present (omitted
    // otherwise so the legacy create-time snapshot stays byte-identical).
    if (typeof finding.behaviourBearing === 'boolean') {
      entry.behaviourBearing = finding.behaviourBearing;
    }
    byId.set(finding.id, entry);
  }
  return {
    findings: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Assemble the per-stream books into ONE {@link GeneratedMigrationBookOfWork}.
 * PURE — exported for direct unit-testing.
 *
 *   - Item ids (and parentIds) are NAMESPACED `<stream>:<id>` so same-named ids
 *     from different streams never collide and every per-stream hierarchy
 *     stays intact.
 *   - `sequenceOrder` is renumbered globally: streams in delivery-dependency
 *     order ({@link STREAM_SEQUENCE_RANK}), items in their stream's own order
 *     within.
 *   - `title` / `summary` / `generationSummary` are composed DETERMINISTICALLY
 *     (counts are recomputed from the assembled items — never trusted from the
 *     LLM); `qualityAssessment.overall` takes the WORST per-stream score, with
 *     the per-stream assessments retained under `perStream`.
 */
export function assembleBookOfWork(
  perStream: PerStreamBook[],
  /**
   * Optional create-time accepted-findings snapshot (Spec 2026-06-11). When
   * supplied it is merged into the deterministically composed
   * `generationSummary` alongside the recomputed counts; when absent (no
   * discovery runs selected, or the fetch fail-softed) the key is OMITTED
   * entirely so legacy-draft consumers hide coverage.
   */
  findingsCoverage?: FindingsCoverageSnapshot
): GeneratedMigrationBookOfWork {
  // Stable-sort streams into delivery-dependency order.
  const ordered = [...perStream].sort(
    (a, b) =>
      (STREAM_SEQUENCE_RANK[a.stream] ?? DEFAULT_STREAM_RANK) -
      (STREAM_SEQUENCE_RANK[b.stream] ?? DEFAULT_STREAM_RANK)
  );

  const items: MigrationBookOfWorkItem[] = [];
  let nextSequence = 1;
  for (const { stream, book } of ordered) {
    const streamItems = [...(book.items ?? [])].sort(
      (a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
    );
    for (const item of streamItems) {
      items.push({
        ...item,
        id: `${stream}:${item.id}`,
        parentId: item.parentId === null || item.parentId === undefined
          ? null
          : `${stream}:${item.parentId}`,
        sequenceOrder: nextSequence,
        // Tag the originating stream so reviewers can trace assembly provenance.
        tags: Array.from(new Set([...(item.tags ?? []), `stream:${stream}`])),
      });
      nextSequence += 1;
    }
  }

  // Deterministic counts — recomputed, never trusted from the LLM.
  const countsByType: Record<string, number> = {};
  for (const item of items) {
    countsByType[item.type] = (countsByType[item.type] ?? 0) + 1;
  }

  // Worst-of per-stream overall quality score (high < medium < low severity
  // walk: any 'low' makes the whole assembled book 'low', etc.).
  const SCORE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
  let worstScore = 'high';
  const perStreamAssessments: Record<string, unknown> = {};
  for (const { stream, book } of ordered) {
    perStreamAssessments[stream] = book.qualityAssessment ?? {};
    const overall = (book.qualityAssessment as { overall?: { score?: unknown } } | undefined)
      ?.overall;
    const score = typeof overall?.score === 'string' ? overall.score.toLowerCase() : '';
    if ((SCORE_RANK[score] ?? -1) > (SCORE_RANK[worstScore] ?? 0)) {
      worstScore = score;
    }
  }

  const summary = ordered
    .map(({ stream, book }) => `${stream}: ${book.summary ?? ''}`.trim())
    .join('\n');

  // Merged generation inputs: union of the per-stream blobs (first stream
  // wins on key conflicts) + the assembly provenance markers.
  const generationInputs: Record<string, unknown> = {};
  for (const { book } of ordered) {
    for (const [key, value] of Object.entries(book.generationInputs ?? {})) {
      if (!(key in generationInputs)) generationInputs[key] = value;
    }
  }
  generationInputs.generationMode = 'per-stream-split';
  generationInputs.deliveryStreams = ordered.map(({ stream }) => stream);

  return {
    title: `Migration Delivery Plan (${ordered.length} delivery stream${
      ordered.length === 1 ? '' : 's'
    })`,
    summary,
    generationInputs,
    generationSummary: {
      totalItems: items.length,
      countsByType,
      perStream: Object.fromEntries(
        ordered.map(({ stream, book }) => [stream, { totalItems: (book.items ?? []).length }])
      ),
      // Deterministic accepted-findings snapshot -- merged here so it joins
      // the recomputed counts ("never trusted from the LLM") and lands in the
      // generationSummary BEFORE the Stage-5 create. Omitted when undefined.
      ...(findingsCoverage !== undefined ? { findingsCoverage } : {}),
    },
    qualityAssessment: {
      overall: {
        score: worstScore,
        rationale:
          'Assembled from per-delivery-stream generations; overall score is the worst per-stream score.',
      },
      perStream: perStreamAssessments,
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Dependency-injection seams for unit tests
// ---------------------------------------------------------------------------

export type ContextResolverFn = (
  projectId: string,
  request: MigrationDiscoveryContextRequest
) => Promise<MigrationDiscoveryContext>;

export type LlmCallerFn = (input: {
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
}) => Promise<{ content: string }>;

/**
 * The AMS create-draft request body. AMS speaks snake_case at the wire (its
 * global Jackson is SNAKE_CASE with fail-on-unknown-properties:false), and
 * `book_of_work_json` binds to a `Map<String,Object>` shaped `{ items: [...] }`
 * -- NOT a bare array. Sending camelCase keys / a bare array here makes AMS
 * silently persist nulls for every unmatched field (the migration-book-of-work
 * "empty book of work + blank architecture" bug, fixed 2026-06-23). Keys MUST
 * match `GeneratedMigrationBookOfWorkDto`'s `@JsonProperty` names exactly.
 */
export interface AmsCreateRequestBody {
  title: string;
  summary: string;
  current_architecture_id: string;
  target_architecture_id: string;
  generation_inputs_json: Record<string, unknown>;
  generation_summary_json: Record<string, unknown>;
  quality_assessment_json: Record<string, unknown>;
  book_of_work_json: { items: GeneratedMigrationBookOfWork['items'] };
}

export type AmsCreateFn = (
  projectId: string,
  body: AmsCreateRequestBody
) => Promise<{ draftId: string; summary: string }>;

/**
 * Fetches the ACCEPTED (status=approved) critical/high discovery findings
 * for the selected discovery runs via the dedicated paged AMS read. The
 * endpoint's `severity` filter is SINGLE-VALUE, so the default
 * implementation performs TWO passes per run (`critical`, `high`) and
 * unions by finding id.
 */
export type AcceptedFindingsFetcherFn = (
  projectId: string,
  currentArchitectureId: string,
  runIds: string[]
) => Promise<AcceptedFindingSnapshotEntry[]>;

export interface MigrationBookOfWorkHandlerDeps {
  fetchContext?: ContextResolverFn;
  callLlm?: LlmCallerFn;
  createDraft?: AmsCreateFn;
  /**
   * Accepted-findings fetcher for the create-time coverage snapshot
   * (Spec 2026-06-11). Defaults to the paged AMS walk per selected
   * discovery run; injected in tests so no live AMS is required.
   */
  fetchAcceptedFindings?: AcceptedFindingsFetcherFn;
  /** Number of LLM invocations recorded — exposed for the single-call test. */
  llmInvocationCounter?: { count: number };
  /** Optional override for the system prompt (defaults to reading the markdown file). */
  systemPromptOverride?: string;
  /**
   * Optional override for the bounded-concurrency LLM pool (defaults to the
   * ONE shared migration-plan pool sized from MIGRATION_PLAN_LLM_CONCURRENCY).
   * Spec 2026-06-11 (Two-Phase, Task Group 1): every per-stream call runs
   * through this pool so total in-flight LLM requests never exceed the
   * configured limit. Phase-2 expansion calls share the SAME instance.
   */
  llmPool?: LlmConcurrencyPool;
  /**
   * DB-migration-pack ensure-fresh step (Spec 2026-07-02-a). Runs BEFORE the
   * context fetch when a DB delivery stream is selected, so the readiness
   * assessment and the plan's DB streams see a pack bound to THIS plan's
   * target. Fail-soft by contract (never throws). Injected in tests.
   */
  ensurePack?: EnsurePackFn;
  /**
   * Pack-view reader for the deterministic DB skeletons (Spec 2026-07-02-b).
   * Injected in tests; a read failure degrades the DB streams to the
   * prerequisite skeleton (never freeform LLM).
   */
  fetchPackView?: FetchPackViewFn;
}

// ---------------------------------------------------------------------------
// Defaults — production wiring
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';

function readDefaultSystemPrompt(): string {
  const promptPath = path.resolve(
    __dirname,
    '..',
    'config',
    'prompts',
    'product-manager.migration-delivery-plan.task.md'
  );
  return fs.readFileSync(promptPath, 'utf-8');
}

const defaultCallLlm: LlmCallerFn = async ({ systemPrompt, userPrompt, projectId }) => {
  // Lazy-import to avoid a module-load-time dependency on the OpenAI client
  // (and to keep tests cleanly mockable).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `pm-migration-delivery-plan-${Date.now()}`,
    `pm-migration-delivery-plan-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultCreateDraft: AmsCreateFn = async (projectId, body) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS POST /migration-books-of-work returned ${response.status}: ${text || '<empty body>'}`
    );
  }
  const dto = (await response.json()) as { draftId?: string; id?: string; summary?: string };
  return {
    draftId: dto.draftId ?? dto.id ?? '',
    summary: dto.summary ?? body.summary,
  };
};

/**
 * Default accepted-findings fetcher: a paged AMS walk per selected discovery
 * run with EXPLICIT `status=approved` + single-value `severity` filters --
 * two passes per run (`critical`, then `high`), unioned by finding id.
 * Follows the page-until-short-page walk + error wrapping from
 * `dbMigrationPack/inputs.ts`. This dedicated read is the ONLY coverage
 * source; the context's `highPriorityFindings` (all-statuses, capped) is
 * never consulted.
 */
const ACCEPTED_FINDINGS_SEVERITIES = ['critical', 'high'] as const;
const ACCEPTED_FINDINGS_PAGE_SIZE = 200;

export const defaultFetchAcceptedFindings: AcceptedFindingsFetcherFn = async (
  projectId,
  currentArchitectureId,
  runIds
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const runsBase =
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(currentArchitectureId)}/discovery/runs`;

  const getJson = async <T>(url: string, label: string): Promise<T> => {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`AMS ${label} fetch failed: HTTP ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  };

  const byId = new Map<string, AcceptedFindingSnapshotEntry>();
  for (const runId of runIds) {
    for (const severity of ACCEPTED_FINDINGS_SEVERITIES) {
      let page = 0;
      // Paged walk -- keep going until a short page.
      for (;;) {
        const url =
          `${runsBase}/${encodeURIComponent(runId)}/findings` +
          `?status=approved&severity=${severity}` +
          `&page=${page}&size=${ACCEPTED_FINDINGS_PAGE_SIZE}`;
        const result = await getJson<{
          items?: Array<{ id?: string; title?: string; severity?: string }>;
        }>(url, 'accepted discovery findings');
        const items = result.items ?? [];
        for (const item of items) {
          if (!item || typeof item.id !== 'string' || item.id.length === 0) continue;
          if (byId.has(item.id)) continue;
          byId.set(item.id, {
            id: item.id,
            title: typeof item.title === 'string' ? item.title : '',
            severity: typeof item.severity === 'string' ? item.severity : severity,
            runId,
          });
        }
        if (items.length < ACCEPTED_FINDINGS_PAGE_SIZE) break;
        page += 1;
      }
    }
  }
  return [...byId.values()];
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full PM Migration Delivery Plan generation flow end-to-end.
 *
 * See the module header for the per-stage contract. Throws:
 *   - `TokenBudgetOverflowError` — context exceeds soft cap even after cascade.
 *   - `MigrationBookOfWorkSchemaError` — LLM response fails schema validation.
 *   - Generic `Error` — context resolver or AMS POST failure.
 */
export async function generateMigrationBookOfWork(
  input: GenerateMigrationBookOfWorkInput,
  deps: MigrationBookOfWorkHandlerDeps = {}
): Promise<GenerateMigrationBookOfWorkResult> {
  const {
    projectId,
    currentArchitectureId,
    targetArchitectureId,
    wizardAnswers,
    discoveryRunIds,
    apiBehaviourBaselineIds,
  } = input;

  const fetchContext = deps.fetchContext ?? defaultFetchMigrationDiscoveryContext;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const createDraft = deps.createDraft ?? defaultCreateDraft;
  const fetchAcceptedFindings =
    deps.fetchAcceptedFindings ?? defaultFetchAcceptedFindings;
  const ensurePack = deps.ensurePack ?? ensureFreshDbMigrationPack;
  const systemPrompt = deps.systemPromptOverride ?? readDefaultSystemPrompt();

  // ----- Stage 0: DB migration pack ensure-fresh (Spec 2026-07-02-a) -----
  //
  // When a DB delivery stream is selected, generate/refresh the deterministic
  // pack BEFORE the context fetch so the readiness assessment reads the pack
  // state this plan will actually be generated from. Fail-soft: 'skipped'
  // (engine gate — e.g. no db.engine decision yet) and 'failed' surface as
  // plan warnings; generation always proceeds.
  const dbStreamSelected = (wizardAnswers?.deliveryStreams ?? []).some((s) =>
    DB_PACK_DELIVERY_STREAMS.includes(s)
  );
  let packOutcome: EnsurePackOutcome | null = null;
  if (dbStreamSelected) {
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=ensuring_db_pack projectId=${projectId}`
    );
    packOutcome = await ensurePack({
      projectId,
      currentArchitectureId,
      targetArchitectureId,
    });
  }

  // ----- Stage 1: load context (Q-12) -----
  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=loading_context projectId=${projectId}`
  );
  const ctxRequest: MigrationDiscoveryContextRequest = {
    currentArchitectureId,
    targetArchitectureId,
    discoveryRunIds,
    apiBehaviourBaselineIds,
  };
  const rawContext = await fetchContext(projectId, ctxRequest);

  // ----- Stage 2: token-budget cascade (Q-4) -----
  const cascade = applyTokenBudgetCascade(rawContext);
  const warnings: string[] = [...cascade.warnings];

  if (packOutcome?.status === 'skipped') {
    warnings.push(
      `DB migration pack not generated (${packOutcome.reason ?? 'engine gate'}); ` +
        `the DB delivery streams will carry prerequisite stories instead of pack-driven work.`
    );
  } else if (packOutcome?.status === 'failed') {
    warnings.push(
      `DB migration pack generation failed (${packOutcome.reason ?? 'unknown error'}); ` +
        `the DB delivery streams will carry prerequisite stories instead of pack-driven work.`
    );
  }

  // ----- Pack view for the deterministic DB skeletons (Spec 2026-07-02-b) -----
  //
  // Fetched ONCE and shared by both DB streams. A read failure (or a
  // skipped/failed ensure) degrades to the PREREQUISITE skeleton — the DB
  // streams are NEVER LLM-generated and never silently freeform.
  const fetchPackView = deps.fetchPackView ?? defaultFetchPackView;
  let dbPackView: PackView | null = null;
  if (dbStreamSelected && packOutcome?.packId) {
    try {
      dbPackView = await fetchPackView(projectId, currentArchitectureId);
      if (dbPackView === null) {
        // Inconsistent state: ensure reported a pack but the read-back found
        // none. Degrade honestly rather than guessing.
        warnings.push(
          `DB migration pack reported '${packOutcome.status}' but could not be read back; ` +
            `the DB delivery streams will carry prerequisite stories instead of pack-driven work.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Pack view read failed; DB streams degrade to prerequisite skeleton', {
        projectId,
        error: message,
      });
      warnings.push(
        `DB migration pack read failed (${message}); the DB delivery streams will carry ` +
          `prerequisite stories instead of pack-driven work.`
      );
      dbPackView = null;
    }
  }
  let dbClusterCap = 25;
  try {
    dbClusterCap = getConfig().migrationPlanDbClusterMaxTables;
  } catch {
    // config unavailable in some unit-test contexts — keep the default
  }

  // ----- Accepted-findings coverage snapshot (Spec 2026-06-11) -----
  //
  // Fetched via the DEDICATED paged AMS read (status=approved, two
  // single-value severity passes per selected run) -- never the capped
  // context `highPriorityFindings`. Fail-soft: a fetch error logs a
  // warning, appends a generation warning, and OMITS the snapshot entirely
  // (a partial / empty-but-present snapshot would read as "0 accepted
  // findings, full coverage"); generation always proceeds. No discovery
  // runs selected -> snapshot omitted (the draft renders like a legacy
  // draft); runs selected with zero approved critical/high findings ->
  // an honest empty `findings` array.
  const selectedRunIds = Array.from(
    new Set(
      (discoveryRunIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    )
  );
  let findingsCoverageSnapshot: FindingsCoverageSnapshot | undefined;
  if (selectedRunIds.length > 0) {
    try {
      const accepted = await fetchAcceptedFindings(
        projectId,
        currentArchitectureId,
        selectedRunIds
      );
      findingsCoverageSnapshot = buildFindingsCoverageSnapshot(accepted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        'Accepted-findings coverage snapshot fetch failed; generating without coverage',
        { projectId, error: message }
      );
      warnings.push(
        'Findings-coverage snapshot unavailable (accepted-findings fetch failed); ' +
          'coverage will not be computed for this draft.'
      );
      findingsCoverageSnapshot = undefined;
    }
  }

  // ----- Stage 3 + 4: LLM call(s) + schema validation -----
  //
  // Per-stream split (2026-06-11): with >= 1 selected delivery stream, run ONE
  // parallel LLM call per stream (each stays well under the Azure relay's hard
  // ~300s request cap that 504'd the whole-plan single shot) and assemble the
  // validated per-stream books deterministically. With NO streams selected the
  // legacy single combined call is preserved (back-compat, incl. the
  // single-call invariant tests).
  const parseAndValidate = (content: string, label: string): GeneratedMigrationBookOfWork => {
    // Allow callers / tests to pass either a raw LLM string or an already-parsed
    // payload. Try parsed-object validation first, falling back to the string
    // extractor.
    try {
      const parsed = JSON.parse(content);
      const result = validateMigrationBookOfWork(parsed);
      if (!result.ok) {
        logger.warn('Migration book-of-work schema validation failed (parsed path)', {
          projectId,
          label,
          errors: result.errors,
        });
        throw new MigrationBookOfWorkSchemaError(result.errors);
      }
      return result.value;
    } catch (e) {
      if (e instanceof MigrationBookOfWorkSchemaError) {
        throw e;
      }
      const result = validateMigrationBookOfWorkFromContent(content);
      if (!result.ok) {
        logger.warn('Migration book-of-work schema validation failed (extracted path)', {
          projectId,
          label,
          errors: result.errors,
        });
        throw new MigrationBookOfWorkSchemaError(result.errors);
      }
      return result.value;
    }
  };

  const selectedStreams = Array.from(
    new Set(
      (wizardAnswers?.deliveryStreams ?? []).filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      )
    )
  );

  let validated: GeneratedMigrationBookOfWork;
  if (selectedStreams.length === 0) {
    // Legacy combined single call (no streams selected).
    const userPrompt = buildUserPrompt(cascade.context, wizardAnswers);
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=calling_generator ` +
        `projectId=${projectId} token_count=${cascade.finalTokenCount} truncated=${cascade.truncated}`
    );
    if (deps.llmInvocationCounter) {
      deps.llmInvocationCounter.count += 1;
    }
    const { content } = await callLlm({ systemPrompt, userPrompt, projectId });
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=validating_schema projectId=${projectId}`
    );
    validated = parseAndValidate(content, 'combined');

    // Deterministic findings coverage (Spec 2026-06-11): new drafts NEVER
    // persist LLM-asserted coverage in ANY mode. The legacy combined call's
    // generationSummary comes straight from the LLM, so any emitted
    // `findingsAddressed` / `findingsNotAddressed` keys are DELETED here,
    // and the deterministic snapshot (when present) is merged -- all before
    // the Stage-5 create (generation_summary_json is immutable post-create).
    const legacyGenerationSummary: Record<string, unknown> = {
      ...(validated.generationSummary ?? {}),
    };
    delete legacyGenerationSummary.findingsAddressed;
    delete legacyGenerationSummary.findingsNotAddressed;
    if (findingsCoverageSnapshot !== undefined) {
      legacyGenerationSummary.findingsCoverage = findingsCoverageSnapshot;
    }
    validated = { ...validated, generationSummary: legacyGenerationSummary };
  } else {
    // One call per stream, submitted through the SHARED bounded-concurrency
    // pool (Spec 2026-06-11, Task Group 1 — never a bare Promise.all over the
    // LLM calls): at most MIGRATION_PLAN_LLM_CONCURRENCY requests are
    // in-flight at once (default 4; env-tunable down to 1 for fully serial).
    // Each stream is retried ONCE on any failure (LLM transport or schema)
    // before the whole generation fails loudly naming the stream. ATOMIC: a
    // failing stream fails the generation — AMS is never written from a
    // partial set. Results are still awaited together and assembly order is
    // unchanged (assembleBookOfWork sorts deterministically).
    const llmPool = deps.llmPool ?? getMigrationPlanLlmPool();
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=calling_generator ` +
        `projectId=${projectId} token_count=${cascade.finalTokenCount} truncated=${cascade.truncated} ` +
        `streams=${selectedStreams.length}`
    );
    const generateStream = async (stream: string): Promise<PerStreamBook> => {
      // Deterministic DB path (Spec 2026-07-02-b, Persistence-Tier Oracle
      // Program): the two DB streams are generated FROM the pack in code —
      // no LLM call, no token spend, and no freeform fallback (pack
      // unavailable → prerequisite skeleton).
      if (DB_PACK_DELIVERY_STREAMS.includes(stream)) {
        console.log(
          `[diag-gateway] pm_migration_delivery_plan stage=deterministic_db_skeleton ` +
            `projectId=${projectId} stream=${stream} pack=${dbPackView?.packId ?? 'none'}`
        );
        const book = buildDbStreamSkeleton({
          stream: stream as 'target_database_schema_implementation' | 'data_migration',
          packView: dbPackView,
          ensureOutcome: packOutcome,
          clusterCap: dbClusterCap,
        });
        return { stream, book };
      }

      // Phase-1 SKELETON scope (Spec 2026-06-11 Two-Phase generation): the
      // per-stream call requests ONLY the initiative -> epic -> feature
      // skeleton — titles + one-line descriptions, no stories, no acceptance
      // criteria. Detailed stories arrive via the user-triggered per-epic
      // phase-2 expansion (migrationBookOfWorkExpansionHandler.ts). Note:
      // small streams (e.g. cutover_rollback_decommission,
      // reconciliation_reporting) get NO special phase-1 handling — they
      // produce small skeletons like every other stream and expand via the
      // single-call non-inventory path in phase 2.
      const streamPrompt = buildUserPrompt(cascade.context, wizardAnswers, stream, true);
      const attempt = async (): Promise<GeneratedMigrationBookOfWork> => {
        // The pool bounds the LLM request itself; the counter increment and
        // stage log fire when the call actually STARTS (i.e. when a pool slot
        // is acquired), and parsing/validation happens outside the slot so
        // CPU-bound work never holds up another stream's LLM request.
        const { content } = await llmPool.run(async () => {
          if (deps.llmInvocationCounter) {
            deps.llmInvocationCounter.count += 1;
          }
          console.log(
            `[diag-gateway] pm_migration_delivery_plan stage=calling_generator ` +
              `projectId=${projectId} stream=${stream}`
          );
          return callLlm({
            systemPrompt,
            userPrompt: streamPrompt,
            projectId,
          });
        });
        return parseAndValidate(content, `stream:${stream}`);
      };
      try {
        return { stream, book: await attempt() };
      } catch (firstError) {
        const message =
          firstError instanceof Error ? firstError.message : String(firstError);
        logger.warn('Migration book-of-work per-stream generation failed; retrying once', {
          projectId,
          stream,
          error: message,
        });
        try {
          return { stream, book: await attempt() };
        } catch (secondError) {
          const second =
            secondError instanceof Error ? secondError.message : String(secondError);
          // Preserve schema errors (route maps them to 502); wrap transport
          // errors with the failing stream so the user sees WHICH stream broke.
          if (secondError instanceof MigrationBookOfWorkSchemaError) {
            throw secondError;
          }
          throw new Error(
            `Delivery stream "${stream}" generation failed after retry: ${second}`
          );
        }
      }
    };

    // Awaiting all pool submissions together — the concurrency bound lives in
    // the shared pool above, NOT in this Promise.all.
    const perStream = await Promise.all(selectedStreams.map(generateStream));

    // Deterministic assembly + a FULL re-validation of the assembled book (the
    // namespaced ids keep every per-stream hierarchy intact; this guards the
    // merge itself, e.g. id collisions or broken parent links).
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=assembling projectId=${projectId} ` +
        `streams=${perStream.length}`
    );
    const assembled = assembleBookOfWork(perStream, findingsCoverageSnapshot);
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=validating_schema projectId=${projectId} ` +
        `items=${assembled.items.length}`
    );
    const assembledResult = validateMigrationBookOfWork(assembled);
    if (!assembledResult.ok) {
      logger.warn('Migration book-of-work ASSEMBLED validation failed', {
        projectId,
        errors: assembledResult.errors,
      });
      throw new MigrationBookOfWorkSchemaError(assembledResult.errors);
    }
    validated = assembledResult.value;

    // Phase-1 skeleton: seed EVERY epic's expansion state to `not_expanded`
    // inside the book-of-work JSON before the atomic AMS create write (the
    // append endpoint is phase-2 only). The shape is the ONE shared shape
    // defined in generatedMigrationBookOfWorkSchema.ts and read/written by
    // the AMS items/append merge endpoint. Note: validateMigrationBookOfWork
    // / validateBookOfWorkHierarchy accept a story-less skeleton — no
    // hierarchy rule requires story leaves (stories merely must parent to
    // features WHEN present), so no validator relaxation was needed.
    validated = { ...validated, items: seedEpicExpansionStates(validated.items) };
  }

  // Record the pack-ensure outcome in the draft's generation inputs so the
  // review workspace (and Spec B's expansion) can trace which pack state the
  // plan was generated against. Omitted entirely when no DB stream selected.
  if (packOutcome !== null) {
    validated = {
      ...validated,
      generationInputs: {
        ...(validated.generationInputs ?? {}),
        dbMigrationPack: {
          status: packOutcome.status,
          packId: packOutcome.packId,
          inputSnapshotHash: packOutcome.inputSnapshotHash,
          reason: packOutcome.reason,
        },
      },
    };
  }

  // ----- Stage 5: POST to AMS (Q-3) -----
  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=saving_draft projectId=${projectId}`
  );

  const body: AmsCreateRequestBody = {
    title: validated.title,
    summary: validated.summary,
    current_architecture_id: currentArchitectureId,
    target_architecture_id: targetArchitectureId,
    generation_inputs_json: validated.generationInputs,
    generation_summary_json: validated.generationSummary,
    quality_assessment_json: validated.qualityAssessment,
    // AMS `book_of_work_json` is an object `{ items: [...] }`, not a bare array.
    book_of_work_json: { items: validated.items },
  };
  const { draftId, summary } = await createDraft(projectId, body);

  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=complete projectId=${projectId} draftId=${draftId}`
  );

  return {
    draftId,
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
