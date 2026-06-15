/**
 * Discovery-Review Conversation Coordinator + the terminal Save confirmation gate
 * (Spec 3 — capstone, Task Group 2.5; CONFIRM-SKIP relaxed by the 2026-06-05
 * review-room-agenda-redesign spec, Task Group 3; the per-chunk + per-conflict
 * confirm gate FULLY RETIRED by the 2026-06-06
 * discovery-review-room-agenda-redesign-2 spec, Task Group 4).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Decision 1/3)
 *       + 2026-06-05-review-room-agenda-redesign (Task Group 3: cascade-aware
 *         confirm-skip + the two-figure off-screen overage summary)
 *       + 2026-06-06-discovery-review-room-agenda-redesign-2 (Task Group 4:
 *         immediate-apply for chunk dispositions AND conflicts; the `scope`
 *         family-vs-cascade branch; the next-chunk / terminal-Save auto-advance
 *         carried in the `'applied'` outcome).
 *
 * Mirrors the target-state `architectConversationCoordinator.ts`: it owns
 * appending transcript turns, driving the agenda sequencer, running the LLM loop
 * for narration + intent-PROPOSAL, and invoking the orchestrator (the sole
 * writer).
 *
 * THE ORACLE-SAFETY HEART (the highest-stakes property of the whole spec):
 *   - The LLM loop NEVER writes. Its terminal call (the reserved
 *     `submit_structured_answer`) only PROPOSES a structured mutation intent.
 *   - The coordinator attaches DETERMINISTIC preview counts (from `preview` /
 *     the conflict reads — NEVER an LLM-asserted number) to the transcript.
 *   - IMMEDIATE-APPLY (2026-06-06 Task Group 4): after the confirm-box-removal
 *     redesign, chunk dispositions (`apply-decision`, both `scope` values) and
 *     conflict resolutions (`resolve-conflict` / `resolve-conflicts-by-pattern`)
 *     apply IMMEDIATELY — the click IS the confirmation — and return an `'applied'`
 *     outcome with NO pending-confirmation turn. A disposition carries the NEXT
 *     agenda chunk in the outcome (auto-advance); a conflict carries the SAME chunk
 *     REFRESHED with the conflict cleared (NO advance — Q4). The numbers the
 *     transcript records are STILL deterministic (from `preview` / the conflict
 *     reads), never LLM-asserted, so the oracle-safety property holds even though
 *     the off-screen confirm gate is gone.
 *   - THE ONE SURVIVING GATE: the TERMINAL `save` intent still flows through the
 *     HARD `pending-confirmation` gate (re-validated in `confirmPending`). It is
 *     auto-appended ONLY when an apply leaves the agenda exhausted — there is NO
 *     mid-conversation save affordance. Committing approved candidates back to the
 *     architecture stays a deliberate final Yes/No.
 *
 * The `scope` family-vs-cascade branch (S1): "Approve visible chunk" applies ONLY
 * the `deriveFamilyForSeed` id set (seed ∪ direct `parent_child` children) so the
 * associated logical entities/attributes are NOT cascaded and arrive as their own
 * later chunks; "Approve All" / "Reject All" / "Defer All" apply the resolver's
 * FULL touched set. The selection lives ENTIRELY here — `resolveBulkActionSet`
 * stays pure (no shallow flag) and the orchestrator's flat `candidate_ids[]` write
 * path is unchanged; only WHICH ids are sent differs.
 *
 * ALREADY-DECIDED MEMBERS ARE NEVER RE-ACTIONED (2026-06-06 agenda-redesign-2,
 * Requirement Q1): before the write fires, the disposition's candidate-id set is
 * INTERSECTED with the ACTIONABLE node members (pending `review_status` AND not
 * `committed`) — for BOTH `scope` values and ALL dispositions. The AMS applicator
 * (`DiscoveryCascadeReviewService.bulkReviewCascade`) only no-ops a member whose
 * CURRENT `review_status` already EQUALS the requested one (and a `committed`
 * row); it OVERWRITES a member already in a DIFFERENT terminal disposition (an
 * `approved` member handed `rejected` becomes `rejected`). So without this
 * coordinator-side filter, a "Reject All" / "Defer All" over a PARTIALLY-approved
 * family would FLIP the already-approved members — violating Q1 ("already-decided
 * members render read-only and are NOT re-actioned"). The filter mirrors the
 * sequencer's `isActionable` predicate; Approve no-ops already-approved members
 * anyway, but the filter applies uniformly so the write-set NEVER contains an
 * already-decided node. NON-node ids (the reject-only relationship-ROW candidates
 * the resolver surfaces, which are EDGES not nodes) are NOT filtered — they are
 * not "already-decided members" of the family and must still be marked.
 *
 * Two entry points (the chassis twin pattern), returning ONE shared union:
 *   - `answerTurn`              — the LLM path (runs the loop; proposes an intent).
 *   - `captureDeterministicTurn`— the NO-LLM path (the degrade-in-place path the
 *                                 frontend drives directly with a structured
 *                                 intent or a click).
 *   - `confirmPending`          — the confirm/cancel path for the terminal Save
 *                                 (NL "yes" re-validation OR click-to-confirm). It
 *                                 still also accepts the other intents for
 *                                 transcript-replay back-compat, but the live
 *                                 chunk/conflict flows no longer route through it.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import type { ArchitectLlmClient } from '../architectConversation/architectLlmClient';
import {
  LoopResult,
  runArchitectQuestionLoop,
} from '../architectConversation/llmLoopRunner';
import type { QuestionLibraryEntry } from '../../config/architect-conversation/questionLibrary';
import type { BulkReviewAction } from '../discovery/reviewModelWire';
import type {
  FullReviewModelWire,
  ReviewModelNode,
  ReviewModelFindingNode,
} from './reviewModelFull';
import { buildReviewToolRegistry, preview, getSimilarConflicts } from './reviewTools';
import { getReviewChunk } from './agendaSequencer';
import {
  ReviewDecisionOrchestrator,
  defaultReviewDecisionOrchestrator,
} from './reviewDecisionOrchestrator';
import {
  appendReviewTurn as defaultAppendReviewTurn,
  loadDiscoveryReviewConversation as defaultLoadConversation,
} from './discoveryReviewConversationStore';
import type {
  BulkPatternResolvedTurn,
  ChunkSummaryTurn,
  ConflictResolvedTurn,
  DecisionAppliedTurn,
  ErrorTurn,
  NarrationTurn,
  OpenTurn,
  PendingConfirmationTurn,
  PreviewTurn,
  ProposedReviewIntent,
  SelectedScanSet,
  UserMessageTurn,
} from './reviewTurnShape';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Persona prompt (forwarded VERBATIM — never paraphrased, per the spec).
// ---------------------------------------------------------------------------

const PROMPT_PATH = path.resolve(
  __dirname,
  '../../config/prompts/architect.discovery-review.task.md',
);
let cachedPersonaPrompt: string | null = null;

async function loadPersonaPrompt(): Promise<string> {
  if (cachedPersonaPrompt !== null) return cachedPersonaPrompt;
  cachedPersonaPrompt = await fs.readFile(PROMPT_PATH, 'utf-8');
  return cachedPersonaPrompt;
}

// ---------------------------------------------------------------------------
// A synthetic library entry so the chassis `llmLoopRunner` (which is keyed on a
// QuestionLibraryEntry) drives the review persona. The runner forwards
// `entry.prompt` VERBATIM; we put the persona prompt there. `expectedAnswerShape`
// is `structured` so the runner's structured-answer parser accepts our intent
// object as-is (it is validated deterministically by the coordinator, not by the
// closed-choice parser).
//
// The non-load-bearing QuestionLibraryEntry fields (`group`/`orderInGroup`/
// `defaultsWhenUnchanged`/`cascades`/`allowedExceptionScopes`) are required by
// the type but unused by the review loop; we set inert valid-shaped values. The
// cast through `unknown` only relaxes the `group` enum membership (the review
// flow never reads `group`).
// ---------------------------------------------------------------------------

function buildReviewLoopEntry(personaPrompt: string): QuestionLibraryEntry {
  return {
    code: 'discovery.review',
    group: 'A',
    orderInGroup: 1,
    prompt: personaPrompt,
    expectedAnswerShape: 'structured',
    defaultsWhenUnchanged: '',
    cascades: [],
    allowedExceptionScopes: [],
  } as unknown as QuestionLibraryEntry;
}

// ---------------------------------------------------------------------------
// Injectable deps (test seam) — mirrors CoordinatorDeps.
// ---------------------------------------------------------------------------

export interface ReviewCoordinatorDeps {
  orchestrator: ReviewDecisionOrchestrator;
  appendTurn: typeof defaultAppendReviewTurn;
  loadConversation: typeof defaultLoadConversation;
  /** Mockable loop runner so tests can wholesale-replace the LLM round-trip path. */
  runLoop: typeof runArchitectQuestionLoop;
  newId: () => string;
}

export const defaultReviewCoordinatorDeps: ReviewCoordinatorDeps = {
  orchestrator: defaultReviewDecisionOrchestrator,
  appendTurn: defaultAppendReviewTurn,
  loadConversation: defaultLoadConversation,
  runLoop: runArchitectQuestionLoop,
  newId: () => uuidv4(),
};

// ---------------------------------------------------------------------------
// Common run/session context
// ---------------------------------------------------------------------------

export interface ReviewSessionContext {
  projectId: string;
  architectureId: string;
  /** The PRIMARY run id (keys the thread + the write path). */
  runId: string;
  /** The full review model snapshot the tools read (fetched by the route). */
  model: FullReviewModelWire;
  scanPair: SelectedScanSet;
}

// ---------------------------------------------------------------------------
// START — append the open turn + the first chunk.
// ---------------------------------------------------------------------------

export interface StartReviewArgs extends ReviewSessionContext {
  sessionId: string;
  openedBy: string;
}

export interface StartReviewOutcome {
  openTurn: OpenTurn;
  firstChunk: ChunkSummaryTurn;
}

export async function startReview(
  args: StartReviewArgs,
  deps: ReviewCoordinatorDeps = defaultReviewCoordinatorDeps,
): Promise<StartReviewOutcome> {
  const openTurn: OpenTurn = {
    kind: 'open',
    sessionId: args.sessionId,
    openedBy: args.openedBy,
    scanPair: args.scanPair,
  };
  await deps.appendTurn(args.projectId, args.runId, openTurn);

  const { chunk } = getReviewChunk(args.model, 0);
  await deps.appendTurn(args.projectId, args.runId, chunk);

  return { openTurn, firstChunk: chunk };
}

// ---------------------------------------------------------------------------
// Shared outcome union (mirrors the chassis `captured | error | skipped`).
// ---------------------------------------------------------------------------

export type ReviewTurnOutcome =
  | {
      /**
       * The TERMINAL Save (a `save` intent) opened the one surviving
       * `pending-confirmation` gate and is awaiting an explicit Yes/No. After the
       * 2026-06-06 redesign this is the ONLY intent that reaches a pending gate
       * (auto-appended on agenda exhaustion); chunk dispositions + conflicts apply
       * immediately and return `'applied'`.
       */
      kind: 'pending-confirmation';
      userMessageTurn: UserMessageTurn | null;
      previewTurn: PreviewTurn | null;
      pendingTurn: PendingConfirmationTurn;
    }
  | {
      /**
       * THE IMMEDIATE-APPLY outcome (2026-06-06 Task Group 4, extending the
       * 2026-06-05 Task Group 3 confirm-skip). A chunk disposition (`apply-decision`,
       * both `scope` values) or a conflict resolution (`resolve-conflict` /
       * `resolve-conflicts-by-pattern`) was applied IMMEDIATELY — the click WAS the
       * confirmation — so NO pending-confirmation turn was appended.
       *
       * `appliedTurn` is the orchestrator's write-evidence turn (a
       * `decision-applied` for a disposition; a `conflict-resolved` /
       * `bulk-pattern-resolved` for a conflict). `previewTurn` carries the
       * deterministic apply counts for the transcript (null for conflicts).
       *
       * AUTO-ADVANCE (S2 of the redesign):
       *   - `advanced === true`  (a DISPOSITION): `nextChunk` is the NEXT agenda
       *     chunk to render (the just-decided family is deduped out of the
       *     refreshed agenda), or null when the agenda is now exhausted. When
       *     exhausted, `terminalSaveTurn` carries the auto-appended terminal Save
       *     Yes/No.
       *   - `advanced === false` (a CONFLICT): `nextChunk` is the SAME chunk
       *     REFRESHED with the conflict cleared — the frontend replaces the current
       *     chunk IN PLACE and does NOT advance (Q4). `terminalSaveTurn` is null.
       *
       * The frontend reads this as "applied", reflects the result WITHOUT a confirm
       * surface, then either appends `nextChunk` + scrolls (disposition) or replaces
       * the current chunk in place (conflict).
       */
      kind: 'applied';
      userMessageTurn: UserMessageTurn | null;
      previewTurn: PreviewTurn | null;
      appliedTurn: DecisionAppliedTurn | ConflictResolvedTurn | BulkPatternResolvedTurn;
      /**
       * The chunk to render next. For a disposition (`advanced === true`) this is
       * the NEXT agenda chunk (null when exhausted); for a conflict
       * (`advanced === false`) this is the SAME chunk refreshed (conflict cleared).
       */
      nextChunk: ChunkSummaryTurn | null;
      /** TRUE for a disposition (append + scroll); FALSE for a conflict (replace in place). */
      advanced: boolean;
      /**
       * The auto-appended terminal Save Yes/No, present ONLY when a disposition
       * left the agenda exhausted (`nextChunk === null`); null otherwise. This is
       * the ONLY surviving `PendingConfirmationTurn` use.
       */
      terminalSaveTurn: PendingConfirmationTurn | null;
    }
  | {
      /** The LLM narrated without proposing a mutation (e.g. answered a question, clarified, advanced the chunk). */
      kind: 'narrated';
      userMessageTurn: UserMessageTurn | null;
      narrationTurn: NarrationTurn;
      chunkTurn: ChunkSummaryTurn | null;
    }
  | {
      kind: 'error';
      userMessageTurn: UserMessageTurn | null;
      errorTurn: ErrorTurn;
    };

// ---------------------------------------------------------------------------
// ANSWER (the LLM path) — narrate + propose; NEVER write.
// ---------------------------------------------------------------------------

export interface AnswerTurnArgs extends ReviewSessionContext {
  /** The reviewer's free-text message. */
  userMessage: string;
  llmClient: ArchitectLlmClient;
  /** Optional limit overrides forwarded into the loop runner. */
  roundLimit?: number;
  perCallTimeoutMs?: number;
  wallClockMs?: number;
}

export async function answerTurn(
  args: AnswerTurnArgs,
  deps: ReviewCoordinatorDeps = defaultReviewCoordinatorDeps,
): Promise<ReviewTurnOutcome> {
  // Record the reviewer's message FIRST.
  const userMessageTurn: UserMessageTurn = { kind: 'user-message', text: args.userMessage };
  await deps.appendTurn(args.projectId, args.runId, userMessageTurn);

  // Run the LLM loop with the read-only tools + the persona prompt. The loop
  // NEVER writes — its terminal `submit_structured_answer` only PROPOSES.
  const personaPrompt = await loadPersonaPrompt();
  const entry = buildReviewLoopEntry(personaPrompt);
  const tools = buildReviewToolRegistry({ model: args.model, scanPair: args.scanPair });

  let loopResult: LoopResult;
  try {
    loopResult = await deps.runLoop({
      entry,
      userResponse: args.userMessage,
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: args.llmClient,
      tools,
      roundLimit: args.roundLimit,
      perCallTimeoutMs: args.perCallTimeoutMs,
      wallClockMs: args.wallClockMs,
    });
  } catch (err) {
    // Defensive: the loop returns structured errors rather than throwing, but
    // guard anyway so the room degrades in place (never bounces to the grid).
    const message = err instanceof Error ? err.message : String(err);
    const errorTurn: ErrorTurn = {
      kind: 'error',
      errorKind: 'llm-call-failed',
      errorMessage: message,
      recoverableHint:
        'The Architect is unavailable. You can keep reviewing with the deterministic agenda — your decisions apply immediately and only the final Save asks to confirm.',
    };
    await deps.appendTurn(args.projectId, args.runId, errorTurn);
    return { kind: 'error', userMessageTurn, errorTurn };
  }

  // LLM failure → degrade-in-place error turn (the room keeps the chunk + the
  // deterministic agenda; the user is NOT bounced out).
  if (loopResult.outcome === 'error') {
    const errorTurn: ErrorTurn = {
      kind: 'error',
      errorKind: loopResult.errorKind,
      errorMessage: loopResult.errorMessage,
      recoverableHint:
        loopResult.recoverableHint ??
        'The Architect could not respond. Continue with the deterministic agenda; only the final Save asks to confirm.',
    };
    await deps.appendTurn(args.projectId, args.runId, errorTurn);
    return { kind: 'error', userMessageTurn, errorTurn };
  }

  // The LLM submitted a terminal answer. Did it PROPOSE a structured mutation
  // intent? If so, apply it immediately (chunk dispositions + conflicts) or open
  // the terminal Save gate (save). If not, it was narration / a clarify question —
  // surface that as a plain narration turn (NEVER raw JSON; see narrationFrom).
  const intent = parseProposedIntent(loopResult.answerValue);
  if (intent) {
    return openConfirmationGate(args, intent, userMessageTurn, deps);
  }

  // Narration-only: the LLM answered, asked a `clarify` question, or otherwise
  // narrated without proposing a write. `narrationFrom` extracts the prose
  // (including the `clarify` message) and can NEVER emit raw JSON.
  const narrationText = narrationFrom(loopResult.answerValue);
  const narrationTurn: NarrationTurn = { kind: 'narration', text: narrationText };
  await deps.appendTurn(args.projectId, args.runId, narrationTurn);
  return { kind: 'narrated', userMessageTurn, narrationTurn, chunkTurn: null };
}

// ---------------------------------------------------------------------------
// CAPTURE DETERMINISTIC (the NO-LLM path) — the degrade-in-place entry point.
//
// The frontend sends a structured intent (a click on the deterministic agenda)
// or advances the chunk. NO LLM round-trip. A chunk disposition or a conflict
// applies IMMEDIATELY (the click IS the confirmation) and returns `'applied'`
// with the next-chunk / refreshed-chunk auto-advance; a `save` intent opens the
// terminal Save gate. The family bulk is a `propose-intent` whose `apply-decision`
// seeds the family parent (the cascade pulls the `parent_child` children for
// `scope:'cascade'`; `scope:'family'` keeps only the direct children).
// ---------------------------------------------------------------------------

export interface CaptureDeterministicTurnArgs extends ReviewSessionContext {
  /** What the user did deterministically. */
  action:
    | { kind: 'propose-intent'; intent: ProposedReviewIntent; userText?: string }
    | { kind: 'advance-chunk'; agendaCursor: number };
}

export async function captureDeterministicTurn(
  args: CaptureDeterministicTurnArgs,
  deps: ReviewCoordinatorDeps = defaultReviewCoordinatorDeps,
): Promise<ReviewTurnOutcome> {
  if (args.action.kind === 'advance-chunk') {
    const { chunk } = getReviewChunk(args.model, args.action.agendaCursor);
    await deps.appendTurn(args.projectId, args.runId, chunk);
    const narrationTurn: NarrationTurn = {
      kind: 'narration',
      text: `Showing ${chunk.items.length} item(s) in the "${chunk.section}" section (${chunk.scanScope}).`,
    };
    await deps.appendTurn(args.projectId, args.runId, narrationTurn);
    return { kind: 'narrated', userMessageTurn: null, narrationTurn, chunkTurn: chunk };
  }

  // propose-intent: record the user's click as a user-message, then apply
  // immediately (chunk/conflict) or open the terminal Save gate (save).
  let userMessageTurn: UserMessageTurn | null = null;
  if (args.action.userText) {
    userMessageTurn = { kind: 'user-message', text: args.action.userText };
    await deps.appendTurn(args.projectId, args.runId, userMessageTurn);
  }
  return openConfirmationGate(args, args.action.intent, userMessageTurn, deps);
}

// ---------------------------------------------------------------------------
// THE APPLY DISPATCH — immediate-apply for chunk dispositions + conflicts; the
// HARD gate survives ONLY for the terminal Save (2026-06-06 Task Group 4).
//
// The function name is kept (`openConfirmationGate`) for caller stability, but it
// now APPLIES the chunk disposition / conflict intent directly (the click IS the
// confirmation) and only OPENS a `pending-confirmation` gate for the terminal
// `save`. The oracle-safety property is preserved: the apply counts the transcript
// records are deterministic (from `preview` / the conflict reads), NOT taken from
// the LLM; only WHICH ids are written ever depended on a proposal, and that
// derivation is pure code (`deriveFamilyForSeed` / `resolveBulkActionSet`).
// ---------------------------------------------------------------------------

async function openConfirmationGate(
  ctx: ReviewSessionContext,
  intent: ProposedReviewIntent,
  userMessageTurn: UserMessageTurn | null,
  deps: ReviewCoordinatorDeps,
): Promise<ReviewTurnOutcome> {
  // --- apply-decision: APPLY IMMEDIATELY (no gate); auto-advance to the next chunk. ---
  if (intent.kind === 'apply-decision') {
    // The deterministic preview (resolveBulkActionSet) — the authoritative counts
    // surfaced on the transcript regardless of which id set is actually written.
    const resolved = preview(intent.seedCandidateIds, intent.action, ctx.model);
    const previewTurn: PreviewTurn = {
      kind: 'preview',
      action: intent.action,
      totalCandidates: resolved.counts.total_candidates,
      seedCandidates: resolved.counts.seed_candidates,
      cascadedCandidates: resolved.counts.cascaded_candidates,
      totalFindings: resolved.counts.total_findings,
      runTotalCandidates: resolved.counts.run_total_candidates,
      runTotalFindings: resolved.counts.run_total_findings,
    };
    await deps.appendTurn(ctx.projectId, ctx.runId, previewTurn);

    // THE SCOPE BRANCH (S1). Choose WHICH ids the unchanged AMS bulk-review
    // applicator receives:
    //   - `scope:'family'`  → the EXACT `deriveFamilyForSeed` id set (seed ∪ its
    //     DIRECT `parent_child` children) ONLY — "Approve visible chunk". The
    //     associated logical entities/attributes are NOT cascaded; they remain
    //     pending and arrive as their own later chunks.
    //   - `scope:'cascade'` (default / absent) → the resolver's FULL touched set —
    //     "Approve All" / "Reject All" / "Defer All".
    // The shallow id-set selection lives ENTIRELY here: `resolveBulkActionSet`
    // stays pure (no shallow flag) and the orchestrator's flat `candidate_ids[]`
    // write path is unchanged — only WHICH ids are sent differs.
    const scope = intent.scope ?? 'cascade';
    let writeCandidateIds: string[];
    let writeFindingIds: string[];
    if (scope === 'family') {
      // Family-only: the seed ∪ its direct parent_child children. Findings are the
      // explicitly-proposed ones only (no resolver finding expansion — the cascade
      // is not applied).
      writeCandidateIds = [...deriveFamilyForSeed(intent.seedCandidateIds, ctx.model)];
      writeFindingIds = dedupe(intent.findingIds);
    } else {
      // Full cascade: the resolver's whole touched set (candidates + linked
      // findings), so the eventual apply matches exactly what was previewed.
      writeCandidateIds = resolved.candidates.map((c) => c.candidate_id);
      writeFindingIds = dedupe([
        ...intent.findingIds,
        ...resolved.findings.map((f) => f.finding_id),
      ]);
    }

    // Q1: NEVER re-action an already-decided member. Drop any NODE id in the
    // write-set whose `review_status` is already terminal OR that is `committed`
    // (the `isActionable` predicate mirrored from `agendaSequencer.ts`). This
    // applies to BOTH `scope` values and ALL dispositions: Approve already no-ops
    // approved members at the applicator, but Reject/Defer would OVERWRITE an
    // already-approved member (the AMS applicator only skips a SAME-status row), so
    // the filter is what keeps "already-decided members are NOT re-actioned" true
    // end-to-end. NON-node ids (reject-only relationship-ROW candidates, which are
    // EDGES not nodes) are preserved — they are not already-decided family members
    // and must still be marked.
    writeCandidateIds = actionableCandidateIds(writeCandidateIds, ctx.model);

    // Spec 2026-06-08 (Bug 1): a cascade across a multi-run scan set touches
    // candidates/findings from several runs — map each to its OWN run so the
    // orchestrator applies per run (AMS bulk-review-cascade silently SKIPS items
    // not in the URL's run, leaving the oracle under-applied).
    const runIdByCandidateId: Record<string, string> = {};
    for (const node of ctx.model.nodes ?? []) runIdByCandidateId[node.id] = node.run_id;
    const runIdByFindingId: Record<string, string> = {};
    for (const finding of ctx.model.findings ?? []) runIdByFindingId[finding.id] = finding.run_id;

    // Apply NOW via the orchestrator (the sole writer) — the click IS the
    // confirmation. NO pending-confirmation turn.
    const applyOutcome = await deps.orchestrator.applyDecision({
      projectId: ctx.projectId,
      architectureId: ctx.architectureId,
      runId: ctx.runId,
      candidateIds: writeCandidateIds,
      findingIds: writeFindingIds,
      action: intent.action,
      reviewerNotes: intent.reviewerNotes,
      runIdByCandidateId,
      runIdByFindingId,
    });
    if (applyOutcome.kind !== 'applied') {
      // The immediate apply failed — surface the orchestrator's error turn (it was
      // already appended by the orchestrator). NO partial write.
      return { kind: 'error', userMessageTurn, errorTurn: applyOutcome.turn };
    }

    // AUTO-ADVANCE: re-derive the agenda over a model with the just-WRITTEN
    // candidates marked decided. The Task-Group-3 dedup drops the now-decided
    // family, so chunk-0 of the simulated agenda is the NEXT family to review (for
    // `scope:'family'` the associated logical entities/attributes — still pending —
    // are exactly that next chunk). When nothing remains, append the terminal Save.
    const { nextChunk, terminalSaveTurn } = await advanceAfterDisposition(
      ctx,
      writeCandidateIds,
      writeFindingIds,
      intent.action,
      deps,
    );

    return {
      kind: 'applied',
      userMessageTurn,
      previewTurn,
      appliedTurn: applyOutcome.turn,
      nextChunk,
      advanced: true,
      terminalSaveTurn,
    };
  }

  // --- apply-decision-by-type: APPLY IMMEDIATELY across the whole type+scan. ---
  if (intent.kind === 'apply-decision-by-type') {
    // Enumerate EVERY still-actionable candidate of this (candidate_type, scan)
    // across the whole model — the exact "Approve/Reject/Defer all N of this type"
    // target. NO cascade and NO family expansion: orphan-by-type candidates have no
    // parent_child children. `actionableCandidateIds` drops any already-decided /
    // committed member (the same Q1 safeguard the per-row apply uses).
    const idsOfType = (ctx.model.nodes ?? [])
      .filter(
        (n) =>
          n.candidate_type === intent.candidateType && n.scan_kind === intent.scanScope,
      )
      .map((n) => n.id);
    const writeCandidateIds = actionableCandidateIds(idsOfType, ctx.model);

    const previewTurn: PreviewTurn = {
      kind: 'preview',
      action: intent.action,
      totalCandidates: writeCandidateIds.length,
      seedCandidates: writeCandidateIds.length,
      cascadedCandidates: 0,
      totalFindings: 0,
      runTotalCandidates: ctx.model.aggregations?.total_candidates ?? null,
      runTotalFindings: ctx.model.aggregations?.total_findings ?? null,
    };
    await deps.appendTurn(ctx.projectId, ctx.runId, previewTurn);

    // Nothing left to action (a stale double-click after another writer cleared the
    // type) — narrate WITHOUT a write rather than firing an empty apply.
    if (writeCandidateIds.length === 0) {
      const narrationTurn: NarrationTurn = {
        kind: 'narration',
        text: `There are no remaining ${intent.candidateType} candidates to ${ACTION_VERB[intent.action]}.`,
      };
      await deps.appendTurn(ctx.projectId, ctx.runId, narrationTurn);
      return { kind: 'narrated', userMessageTurn, narrationTurn, chunkTurn: null };
    }

    // Route each candidate to its OWN run (Spec 2026-06-08 Bug 1) so a multi-run
    // type set is applied per run.
    const runIdByCandidateId: Record<string, string> = {};
    for (const node of ctx.model.nodes ?? []) runIdByCandidateId[node.id] = node.run_id;

    const applyOutcome = await deps.orchestrator.applyDecision({
      projectId: ctx.projectId,
      architectureId: ctx.architectureId,
      runId: ctx.runId,
      candidateIds: writeCandidateIds,
      findingIds: [],
      action: intent.action,
      reviewerNotes: intent.reviewerNotes,
      runIdByCandidateId,
      runIdByFindingId: {},
    });
    if (applyOutcome.kind !== 'applied') {
      return { kind: 'error', userMessageTurn, errorTurn: applyOutcome.turn };
    }

    const { nextChunk, terminalSaveTurn } = await advanceAfterDisposition(
      ctx,
      writeCandidateIds,
      [],
      intent.action,
      deps,
    );

    return {
      kind: 'applied',
      userMessageTurn,
      previewTurn,
      appliedTurn: applyOutcome.turn,
      nextChunk,
      advanced: true,
      terminalSaveTurn,
    };
  }

  // --- apply-decision-findings: APPLY IMMEDIATELY across the whole scan's findings. ---
  if (intent.kind === 'apply-decision-findings') {
    // Enumerate EVERY still-actionable finding of this scan — the exact "Approve /
    // Reject / Defer all N findings" target. Already-decided findings are excluded.
    const writeFindingIds = (ctx.model.findings ?? [])
      .filter((f) => f.scan_kind === intent.scanScope && isFindingActionable(f))
      .map((f) => f.id);

    const previewTurn: PreviewTurn = {
      kind: 'preview',
      action: intent.action,
      totalCandidates: 0,
      seedCandidates: 0,
      cascadedCandidates: 0,
      totalFindings: writeFindingIds.length,
      runTotalCandidates: ctx.model.aggregations?.total_candidates ?? null,
      runTotalFindings: ctx.model.aggregations?.total_findings ?? null,
    };
    await deps.appendTurn(ctx.projectId, ctx.runId, previewTurn);

    if (writeFindingIds.length === 0) {
      const narrationTurn: NarrationTurn = {
        kind: 'narration',
        text: `There are no remaining findings to ${ACTION_VERB[intent.action]}.`,
      };
      await deps.appendTurn(ctx.projectId, ctx.runId, narrationTurn);
      return { kind: 'narrated', userMessageTurn, narrationTurn, chunkTurn: null };
    }

    // Route each finding to its OWN run (the findings apply path is per-run).
    const runIdByFindingId: Record<string, string> = {};
    for (const finding of ctx.model.findings ?? []) runIdByFindingId[finding.id] = finding.run_id;

    const applyOutcome = await deps.orchestrator.applyDecision({
      projectId: ctx.projectId,
      architectureId: ctx.architectureId,
      runId: ctx.runId,
      candidateIds: [],
      findingIds: writeFindingIds,
      action: intent.action,
      reviewerNotes: intent.reviewerNotes,
      runIdByCandidateId: {},
      runIdByFindingId,
    });
    if (applyOutcome.kind !== 'applied') {
      return { kind: 'error', userMessageTurn, errorTurn: applyOutcome.turn };
    }

    const { nextChunk, terminalSaveTurn } = await advanceAfterDisposition(
      ctx,
      [],
      writeFindingIds,
      intent.action,
      deps,
    );

    return {
      kind: 'applied',
      userMessageTurn,
      previewTurn,
      appliedTurn: applyOutcome.turn,
      nextChunk,
      advanced: true,
      terminalSaveTurn,
    };
  }

  // --- resolve-conflicts-by-pattern: APPLY IMMEDIATELY (no gate); refresh in place. ---
  if (intent.kind === 'resolve-conflicts-by-pattern') {
    const sim = getSimilarConflicts(intent.candidateId, intent.attr, ctx.model);
    // Decision 5: offered ONLY for classes of ≥2; below 2 the coordinator refuses
    // the bulk intent and routes the caller to resolve singly.
    if (sim.member_count < 2) {
      const errorTurn: ErrorTurn = {
        kind: 'error',
        errorKind: 'submit-answer-malformed',
        errorMessage:
          `The "${intent.attr}" similarity class has only ${sim.member_count} member(s); bulk-resolve-by-pattern needs at least 2. Resolve this conflict singly instead.`,
        recoverableHint: 'Propose a single resolve-conflict for this candidate.',
      };
      await deps.appendTurn(ctx.projectId, ctx.runId, errorTurn);
      return { kind: 'error', userMessageTurn, errorTurn };
    }

    // Re-derive each member's OWN value from the chosen source (never a shared
    // literal). Deterministic — read each member's live `_conflicts[attr]`.
    const chosenValueByCandidateId = deriveByMemberValues(
      sim.member_candidate_ids,
      intent.attr,
      intent.chosenSource,
      ctx.model,
    );
    // Spec 2026-06-08 (Bug 1): a similarity class (esp. a cross-source duplicate)
    // spans the scan set's runs. Map each member to its OWN run so the orchestrator
    // writes each resolution to the right run — AMS rejects a cross-run write with
    // "Candidate X does not belong to run Y" (HTTP 400).
    const runIdByCandidateId: Record<string, string> = {};
    for (const node of ctx.model.nodes ?? []) runIdByCandidateId[node.id] = node.run_id;
    const outcome = await deps.orchestrator.resolveConflictsByPattern({
      projectId: ctx.projectId,
      architectureId: ctx.architectureId,
      runId: ctx.runId,
      attr: intent.attr,
      chosenSource: intent.chosenSource,
      classCandidateIds: sim.member_candidate_ids,
      chosenValueByCandidateId,
      runIdByCandidateId,
    });
    if (outcome.kind !== 'applied') {
      return { kind: 'error', userMessageTurn, errorTurn: outcome.turn };
    }

    // Refresh the SAME chunk with the resolved conflicts cleared — do NOT advance
    // (Q4). The chunk is recomputed over a model with the anchor's conflict cleared
    // (the anchor is in the visible chunk; its class siblings may be elsewhere but
    // the in-place refresh only needs the visible chunk to lose its conflict).
    const refreshed = refreshChunkForConflict(ctx.model, intent.candidateId);
    return {
      kind: 'applied',
      userMessageTurn,
      previewTurn: null,
      appliedTurn: outcome.turn,
      nextChunk: refreshed,
      advanced: false,
      terminalSaveTurn: null,
    };
  }

  // --- resolve-conflict (single): APPLY IMMEDIATELY (no gate); refresh in place. ---
  if (intent.kind === 'resolve-conflict') {
    // Spec 2026-06-08 (Bug 1): write to the candidate's OWN run (the conflicted
    // candidate may belong to a non-primary run of the scan set) — AMS rejects a
    // cross-run resolve-conflict with "does not belong to run" (HTTP 400).
    const runIdByCandidateId: Record<string, string> = {};
    for (const node of ctx.model.nodes ?? []) runIdByCandidateId[node.id] = node.run_id;
    const outcome = await deps.orchestrator.resolveConflict({
      projectId: ctx.projectId,
      architectureId: ctx.architectureId,
      runId: ctx.runId,
      candidateId: intent.candidateId,
      attr: intent.attr,
      chosenValue: intent.chosenValue,
      chosenSource: intent.chosenSource,
      runIdByCandidateId,
    });
    if (outcome.kind !== 'applied') {
      return { kind: 'error', userMessageTurn, errorTurn: outcome.turn };
    }

    const refreshed = refreshChunkForConflict(ctx.model, intent.candidateId);
    return {
      kind: 'applied',
      userMessageTurn,
      previewTurn: null,
      appliedTurn: outcome.turn,
      nextChunk: refreshed,
      advanced: false,
      terminalSaveTurn: null,
    };
  }

  // --- save: THE ONE SURVIVING HARD GATE (terminal Save Yes/No). ---
  // Reached when the LLM (or a direct intent) proposes a save outside the
  // auto-append-on-exhaustion path; it still flows through `confirmPending`
  // re-validation before any write fires.
  const pendingTurn = buildTerminalSaveTurn(deps.newId());
  await deps.appendTurn(ctx.projectId, ctx.runId, pendingTurn);
  return { kind: 'pending-confirmation', userMessageTurn, previewTurn: null, pendingTurn };
}

// ---------------------------------------------------------------------------
// CONFIRM — the terminal Save confirm/cancel path (re-validates a Yes/No). Chunk
// dispositions + conflicts no longer reach here (they apply immediately in
// `openConfirmationGate`); the other intent cases are retained for
// transcript-replay back-compat and never fire in the live redesign flow.
// ---------------------------------------------------------------------------

export interface ConfirmPendingArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  /** The pending intent id the user is confirming (correlates to the pending turn). */
  pendingId: string;
  /** The still-pending intent (the route loads it from the last pending turn). */
  intent: ProposedReviewIntent;
  /**
   * How the confirm arrived:
   *   - `click`: the deterministic click-to-confirm button (always a confirm).
   *   - `natural-language`: a free-text reply re-validated as an affirmative
   *     against the still-pending intent.
   */
  confirmation:
    | { kind: 'click' }
    | { kind: 'natural-language'; text: string };
  /** The review model snapshot (for re-deriving per-member values on pattern resolve). */
  model: FullReviewModelWire;
}

export type ConfirmPendingOutcome =
  | { kind: 'applied'; appliedTurn: unknown }
  | { kind: 'cancelled'; narrationTurn: NarrationTurn }
  | { kind: 'error'; errorTurn: ErrorTurn };

/**
 * Spec 2026-06-08 (Bug 2): the FULL run set of the reviewed scan set, sourced from
 * the aggregated review model. The Review Room reads candidates across every run,
 * so a terminal Save must save every run — not just the primary — or secondary
 * runs' approved candidates are silently dropped. Unions the model's
 * `scan_selection` (authoritative) with the runs that actually own candidates /
 * findings (defensive), and falls back to the primary run when the model is empty.
 */
function collectScanSetRunIds(model: FullReviewModelWire, primaryRunId: string): string[] {
  const ids = new Set<string>();
  for (const s of model.scan_selection ?? []) if (s.run_id) ids.add(s.run_id);
  for (const n of model.nodes ?? []) if (n.run_id) ids.add(n.run_id);
  for (const f of model.findings ?? []) if (f.run_id) ids.add(f.run_id);
  if (ids.size === 0) ids.add(primaryRunId);
  return Array.from(ids);
}

export async function confirmPending(
  args: ConfirmPendingArgs,
  deps: ReviewCoordinatorDeps = defaultReviewCoordinatorDeps,
): Promise<ConfirmPendingOutcome> {
  // Re-validate the confirmation. A click is always a confirm; a natural-
  // language reply must parse as an affirmative against the STILL-PENDING
  // intent. Anything else cancels with NO write.
  const affirmative =
    args.confirmation.kind === 'click'
      ? true
      : isAffirmative(args.confirmation.text);

  if (!affirmative) {
    // "no" / changed-intent → cancel; NO write fires.
    const narrationTurn: NarrationTurn = {
      kind: 'narration',
      text: 'Cancelled — nothing was changed. Tell me what you would like to do instead.',
    };
    await deps.appendTurn(args.projectId, args.runId, narrationTurn);
    return { kind: 'cancelled', narrationTurn };
  }

  // Affirmative → the orchestrator (the SOLE writer) performs the write.
  const scope = {
    projectId: args.projectId,
    architectureId: args.architectureId,
    runId: args.runId,
  };

  switch (args.intent.kind) {
    case 'apply-decision': {
      const fullCandidateIds =
        (args.intent as { _fullCandidateIds?: string[] })._fullCandidateIds ??
        args.intent.seedCandidateIds;
      // Spec 2026-06-08 (Bug 1): route each candidate/finding to its OWN run so a
      // cross-run set is applied per run (matches the live immediate-apply path).
      const applyRunByCandidateId: Record<string, string> = {};
      for (const node of args.model.nodes ?? []) applyRunByCandidateId[node.id] = node.run_id;
      const applyRunByFindingId: Record<string, string> = {};
      for (const finding of args.model.findings ?? []) applyRunByFindingId[finding.id] = finding.run_id;
      const outcome = await deps.orchestrator.applyDecision({
        ...scope,
        candidateIds: fullCandidateIds,
        findingIds: args.intent.findingIds,
        action: args.intent.action,
        reviewerNotes: args.intent.reviewerNotes,
        runIdByCandidateId: applyRunByCandidateId,
        runIdByFindingId: applyRunByFindingId,
      });
      return outcome.kind === 'applied'
        ? { kind: 'applied', appliedTurn: outcome.turn }
        : { kind: 'error', errorTurn: outcome.turn };
    }
    case 'resolve-conflict': {
      const runIdByCandidateId: Record<string, string> = {};
      for (const node of args.model.nodes ?? []) runIdByCandidateId[node.id] = node.run_id;
      const outcome = await deps.orchestrator.resolveConflict({
        ...scope,
        candidateId: args.intent.candidateId,
        attr: args.intent.attr,
        chosenValue: args.intent.chosenValue,
        chosenSource: args.intent.chosenSource,
        runIdByCandidateId,
      });
      return outcome.kind === 'applied'
        ? { kind: 'applied', appliedTurn: outcome.turn }
        : { kind: 'error', errorTurn: outcome.turn };
    }
    case 'resolve-conflicts-by-pattern': {
      // Re-derive each member's OWN value from the chosen source (never a shared
      // literal). Deterministic — read each member's live `_conflicts[attr]`.
      const chosenValueByCandidateId = deriveByMemberValues(
        args.intent.classCandidateIds,
        args.intent.attr,
        args.intent.chosenSource,
        args.model,
      );
      const runIdByCandidateId: Record<string, string> = {};
      for (const node of args.model.nodes ?? []) runIdByCandidateId[node.id] = node.run_id;
      const outcome = await deps.orchestrator.resolveConflictsByPattern({
        ...scope,
        attr: args.intent.attr,
        chosenSource: args.intent.chosenSource,
        classCandidateIds: args.intent.classCandidateIds,
        chosenValueByCandidateId,
        runIdByCandidateId,
      });
      return outcome.kind === 'applied'
        ? { kind: 'applied', appliedTurn: outcome.turn }
        : { kind: 'error', errorTurn: outcome.turn };
    }
    case 'save': {
      // Spec 2026-06-08 (Bug 2): save EVERY run in the reviewed scan set, not just
      // the primary — the review model aggregates candidates across all runs, so a
      // primary-only save would silently drop secondary runs' approved candidates.
      const runIds = collectScanSetRunIds(args.model, args.runId);
      const outcome = await deps.orchestrator.save({ ...scope, runIds });
      return outcome.kind === 'applied'
        ? { kind: 'applied', appliedTurn: outcome.turn }
        : { kind: 'error', errorTurn: outcome.turn };
    }
    default: {
      const errorTurn: ErrorTurn = {
        kind: 'error',
        errorKind: 'no-pending-intent',
        errorMessage: 'Unknown pending intent kind.',
      };
      await deps.appendTurn(args.projectId, args.runId, errorTurn);
      return { kind: 'error', errorTurn };
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-advance helpers (2026-06-06 Task Group 4 — PURE except the appendTurn the
// terminal Save reuses). Re-derive the agenda over a model whose just-decided
// candidates are marked decided so the Task-Group-3 dedup drops them, yielding the
// next chunk (or exhaustion ⇒ the terminal Save).
// ---------------------------------------------------------------------------

/**
 * The terminal `review_status` an apply moves its candidates into. Verbatim AMS
 * value (`approved` / `rejected` / `deferred`).
 */
function decidedStatusFor(action: BulkReviewAction): string {
  return action;
}

/**
 * Return a SHALLOW-cloned model whose nodes in `decidedIds` carry the supplied
 * terminal `review_status` (so they read as non-actionable to the sequencer's
 * dedup). PURE — the original model is never mutated; only the touched nodes are
 * replaced with a status-overridden copy. Non-node ids (relationship-row
 * candidates) are simply absent from `nodes`, so they no-op here.
 */
function withDecidedStatus(
  model: FullReviewModelWire,
  decidedIds: ReadonlySet<string>,
  status: string,
): FullReviewModelWire {
  const nodes: ReviewModelNode[] = (model.nodes ?? []).map((n) =>
    decidedIds.has(n.id) ? { ...n, review_status: status } : n,
  );
  return { ...model, nodes };
}

/**
 * Return a SHALLOW-cloned model whose `candidateId` node has its live conflict
 * CLEARED (`has_live_conflict: false`, no live attrs / raw conflict maps), so a
 * refreshed chunk no longer renders the resolved conflict's pick-a-source control.
 * PURE — the original model is never mutated. A missing node no-ops.
 */
function withConflictCleared(
  model: FullReviewModelWire,
  candidateId: string,
): FullReviewModelWire {
  const nodes: ReviewModelNode[] = (model.nodes ?? []).map((n) =>
    n.id === candidateId
      ? {
          ...n,
          conflict_state: {
            has_live_conflict: false,
            live_conflict_attrs: [],
            conflicts: null,
            conflict_resolutions: n.conflict_state?.conflict_resolutions ?? null,
          },
        }
      : n,
  );
  return { ...model, nodes };
}

/**
 * Return a SHALLOW-cloned model whose findings in `decidedIds` carry the supplied
 * terminal `review_status` (so they read as non-actionable to the sequencer's
 * findings dedup). PURE — the original model is never mutated. Mirrors
 * {@link withDecidedStatus} for findings so a findings-bulk apply auto-advances
 * (the just-decided findings drop from the refreshed agenda).
 */
function withDecidedFindings(
  model: FullReviewModelWire,
  decidedIds: ReadonlySet<string>,
  status: string,
): FullReviewModelWire {
  if (decidedIds.size === 0) return model;
  const findings = (model.findings ?? []).map((f) =>
    decidedIds.has(f.id) ? { ...f, review_status: status } : f,
  );
  return { ...model, findings };
}

/**
 * Compute the NEXT chunk after a disposition apply + (when the agenda is
 * exhausted) the auto-appended terminal Save turn. The just-WRITTEN candidates AND
 * findings are marked decided on a cloned model so the dedup drops their (now
 * fully-decided) family / finding; chunk-0 of the refreshed agenda is the next chunk.
 *
 * Exhaustion = the refreshed agenda has no items (`nextChunk` is an empty terminal
 * chunk with `nextCursor === null` and zero items) ⇒ `nextChunk` is returned as
 * null and a single terminal Save `PendingConfirmationTurn` is appended (the ONLY
 * surviving pending-confirmation use; NO mid-conversation save affordance).
 */
async function advanceAfterDisposition(
  ctx: ReviewSessionContext,
  writtenCandidateIds: readonly string[],
  writtenFindingIds: readonly string[],
  action: BulkReviewAction,
  deps: ReviewCoordinatorDeps,
): Promise<{ nextChunk: ChunkSummaryTurn | null; terminalSaveTurn: PendingConfirmationTurn | null }> {
  const decidedStatus = decidedStatusFor(action);
  let simulated = withDecidedStatus(ctx.model, new Set(writtenCandidateIds), decidedStatus);
  simulated = withDecidedFindings(simulated, new Set(writtenFindingIds), decidedStatus);
  const { chunk } = getReviewChunk(simulated, 0);

  // An empty terminal chunk (no items) signals the agenda is exhausted.
  if (chunk.items.length === 0) {
    const terminalSaveTurn = buildTerminalSaveTurn(deps.newId());
    await deps.appendTurn(ctx.projectId, ctx.runId, terminalSaveTurn);
    return { nextChunk: null, terminalSaveTurn };
  }

  // The next family/chunk to review. Append it to the transcript so a thread
  // reload shows it, and return it so the frontend renders + scrolls to it.
  await deps.appendTurn(ctx.projectId, ctx.runId, chunk);
  return { nextChunk: chunk, terminalSaveTurn: null };
}

/**
 * The SAME chunk REFRESHED with the resolved conflict cleared (Q4 — conflicts do
 * NOT advance). Recompute the agenda over a model whose `candidateId` conflict is
 * cleared, then return the chunk that still contains `candidateId` (its family /
 * group). Clearing the conflict may re-band the family (live-conflicts →
 * high-blast / remaining), so the chunk is FOUND in the refreshed agenda rather
 * than reused by the old cursor. Falls back to the first chunk if the candidate is
 * no longer present (defensive — should not happen for a conflict on a shown item).
 */
function refreshChunkForConflict(
  model: FullReviewModelWire,
  candidateId: string,
): ChunkSummaryTurn {
  const refreshed = withConflictCleared(model, candidateId);
  return findChunkContaining(refreshed, candidateId);
}

/**
 * Walk the agenda chunk-by-chunk and return the first chunk whose items include
 * `candidateId`; falls back to the first chunk when not found. PURE — a sequence
 * of pure `getReviewChunk` reads bounded by the agenda length. The bound (a large
 * guard) makes a pathological model terminate.
 */
function findChunkContaining(
  model: FullReviewModelWire,
  candidateId: string,
): ChunkSummaryTurn {
  let cursor: number | null = 0;
  let first: ChunkSummaryTurn | null = null;
  for (let guard = 0; guard < 100000 && cursor !== null; guard += 1) {
    const { chunk } = getReviewChunk(model, cursor);
    if (first === null) first = chunk;
    if (chunk.items.some((it) => it.id === candidateId)) return chunk;
    cursor = chunk.nextCursor;
  }
  // Defensive fallback: the candidate vanished from the agenda (e.g. its family
  // became fully decided) — return the first chunk so the room still re-renders.
  return first ?? getReviewChunk(model, 0).chunk;
}

/**
 * Build the single terminal "Save all approved candidates back to the
 * architecture?" `PendingConfirmationTurn` (Q3). This is the ONLY surviving
 * `PendingConfirmationTurn` use after the 2026-06-06 redesign — auto-appended when
 * a disposition exhausts the agenda; "Yes" mirrors the candidates-table "Save All
 * Approved" effect, "No" does nothing further. The historic `previewCounts` /
 * `patternFacts` / `overage` fields are null (a save carries no per-apply counts).
 */
function buildTerminalSaveTurn(pendingId: string): PendingConfirmationTurn {
  return {
    kind: 'pending-confirmation',
    pendingId,
    intent: { kind: 'save' },
    previewCounts: null,
    patternFacts: null,
    overage: null,
    summary: 'Save all approved candidates back to the architecture. Confirm to save.',
  };
}

// ---------------------------------------------------------------------------
// Family re-derivation (2026-06-05 Task Group 3 — PURE; reused by the 2026-06-06
// `scope:'family'` shallow apply).
// ---------------------------------------------------------------------------

/**
 * Re-derive the family for an apply seed SERVER-SIDE: the union, over each seed
 * id, of {the seed} ∪ {its DIRECT `parent_child` children} from `model.edges`
 * (`edge_kind === 'parent_child'`, `from_id` = parent, `to_id` = child). This is
 * the EXACT set the family chunk renders (one-chunk-per-family ⇒ rendered chunk ==
 * this family). A single non-cascading row's seed has no `parent_child` children ⇒
 * the family is just {seed}. PURE — a read of the model.
 *
 * 2026-06-06 agenda-redesign-2 (S1): this is ALSO the id set the
 * `scope:'family'` "Approve visible chunk" apply writes — seed ∪ direct children
 * ONLY, so the associated logical entities/attributes are NOT cascaded and arrive
 * as their own later chunks.
 */
export function deriveFamilyForSeed(
  seedCandidateIds: readonly string[],
  model: FullReviewModelWire,
): Set<string> {
  const family = new Set<string>(seedCandidateIds);
  const edges = model.edges ?? [];
  for (const edge of edges) {
    if (edge.edge_kind !== 'parent_child') continue;
    // The seed is the PARENT (`from_id`) → its child (`to_id`) is in the family.
    if (family.has(edge.from_id)) family.add(edge.to_id);
  }
  return family;
}

// ---------------------------------------------------------------------------
// Already-decided filtering (2026-06-06 agenda-redesign-2 — Requirement Q1).
// ---------------------------------------------------------------------------

/**
 * The terminal `review_status` values a candidate can be DECIDED into (verbatim
 * AMS vocabulary). A node in one of these is no longer actionable; anything else
 * (notably `pending_review`) is still actionable. This MIRRORS the sequencer's
 * `DECIDED_REVIEW_STATUSES` / `isActionable` (`agendaSequencer.ts`) so the agenda
 * dedup and the write-set filter agree on what "decided" means.
 */
const DECIDED_REVIEW_STATUSES: ReadonlySet<string> = new Set<string>([
  'approved',
  'rejected',
  'deferred',
]);

/**
 * Whether a model NODE is still actionable — pending `review_status` AND not
 * `committed`. Mirror of `agendaSequencer.isActionable`. PURE.
 */
function isNodeActionable(node: ReviewModelNode): boolean {
  return !node.committed && !DECIDED_REVIEW_STATUSES.has(node.review_status);
}

/**
 * Whether a FINDING is still actionable — its `review_status` is not one of the
 * terminal dispositions (findings have no `committed` lifecycle). Mirrors the
 * sequencer's findings dedup so the findings-bulk enumeration and the agenda agree.
 */
function isFindingActionable(finding: ReviewModelFindingNode): boolean {
  return !DECIDED_REVIEW_STATUSES.has(finding.review_status);
}

/**
 * Filter a disposition write-set so an ALREADY-DECIDED member is NEVER re-actioned
 * (Requirement Q1). For each candidate id:
 *   - if it is a model NODE that is NOT actionable (already approved/rejected/
 *     deferred, OR committed) → DROP it (the decided member stays as it is).
 *   - if it is a model NODE that IS actionable → KEEP it.
 *   - if it is NOT a model node (a reject-only relationship-ROW / edge candidate
 *     the resolver surfaces) → KEEP it: it is not an already-decided FAMILY member
 *     and still needs marking.
 *
 * This is the end-to-end safeguard for "already-decided members render read-only
 * and are NOT re-actioned": the AMS applicator only no-ops a member whose CURRENT
 * status already EQUALS the requested status (and `committed` rows), so a
 * Reject/Defer over a partially-approved family would otherwise OVERWRITE the
 * already-approved members. PURE — a read of `model.nodes`; preserves input order
 * and is a no-op when every id is actionable (the common all-pending case).
 */
function actionableCandidateIds(
  candidateIds: readonly string[],
  model: FullReviewModelWire,
): string[] {
  const nodeById = new Map<string, ReviewModelNode>(
    (model.nodes ?? []).map((n) => [n.id, n]),
  );
  return candidateIds.filter((id) => {
    const node = nodeById.get(id);
    if (!node) return true; // non-node (relationship-row) id — never a decided member
    return isNodeActionable(node);
  });
}

/**
 * Partition a touched candidate-id set's OFF-SCREEN overage (touched − family)
 * into the two figures the legacy off-screen gate showed (2026-06-05 Task Group 3):
 *
 *   - `relationshipsDroppedCount` = touched ids that are NOT model NODES (Spec A's
 *     relationship-row candidates — represented as EDGES, never nodes).
 *   - `beyondFamilyCount` = touched ids that ARE model nodes but sit OUTSIDE the
 *     derived family.
 *
 * Ids inside the family contribute to NEITHER figure. PURE.
 *
 * 2026-06-06 agenda-redesign-2 (Task Group 4): the off-screen confirm gate is
 * retired, so this is no longer used to decide whether to gate an apply. It is
 * retained as an EXPORTED PURE helper (its unit contract is still covered by
 * `reviewConfirmSkip.test.ts`) for any caller that needs to describe an apply's
 * reach.
 */
export function partitionOverage(
  touchedCandidateIds: readonly string[],
  derivedFamily: ReadonlySet<string>,
  model: FullReviewModelWire,
): { beyondFamilyCount: number; relationshipsDroppedCount: number } {
  const nodeIds = new Set<string>((model.nodes ?? []).map((n) => n.id));
  let beyondFamilyCount = 0;
  let relationshipsDroppedCount = 0;
  for (const id of touchedCandidateIds) {
    if (derivedFamily.has(id)) continue; // on screen (in the rendered family)
    if (nodeIds.has(id)) {
      beyondFamilyCount += 1; // an entity/candidate node off-screen
    } else {
      relationshipsDroppedCount += 1; // a relationship-ROW (edge) candidate
    }
  }
  return { beyondFamilyCount, relationshipsDroppedCount };
}

// ---------------------------------------------------------------------------
// Intent parsing + validation (the LLM's proposal → a typed intent)
// ---------------------------------------------------------------------------

/**
 * Parse the LLM's terminal `submit_structured_answer` value into a typed,
 * validated `ProposedReviewIntent`. Returns null when the value is not a
 * recognised mutation intent (narration). This is the structural gate: an
 * unrecognised or malformed value can NEVER become a write.
 *
 * NOTE: `clarify` is DELIBERATELY not a mutation intent — it returns null here
 * and routes to narration (see `narrationFrom`), so the LLM has a legitimate
 * "ask / explain" terminal answer that does NOT propose any change.
 */
export function parseProposedIntent(value: unknown): ProposedReviewIntent | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const type = obj.type;

  if (type === 'apply-decision') {
    const action = normaliseAction(obj.action);
    if (!action) return null;
    const seedCandidateIds = asStringArray(obj.seedCandidateIds);
    const findingIds = asStringArray(obj.findingIds);
    if (seedCandidateIds.length === 0 && findingIds.length === 0) return null;
    return {
      kind: 'apply-decision',
      seedCandidateIds,
      findingIds,
      action,
      reviewerNotes: typeof obj.reviewerNotes === 'string' ? obj.reviewerNotes : undefined,
      scope: normaliseScope(obj.scope),
    };
  }

  if (type === 'apply-decision-by-type') {
    const action = normaliseAction(obj.action);
    if (!action) return null;
    const candidateType = asString(obj.candidateType);
    const scanScope = obj.scanScope === 'database' ? 'database' : 'code';
    if (!candidateType) return null;
    return {
      kind: 'apply-decision-by-type',
      candidateType,
      scanScope,
      action,
      reviewerNotes: typeof obj.reviewerNotes === 'string' ? obj.reviewerNotes : undefined,
    };
  }

  if (type === 'apply-decision-findings') {
    const action = normaliseAction(obj.action);
    if (!action) return null;
    const scanScope = obj.scanScope === 'database' ? 'database' : 'code';
    return {
      kind: 'apply-decision-findings',
      scanScope,
      action,
      reviewerNotes: typeof obj.reviewerNotes === 'string' ? obj.reviewerNotes : undefined,
    };
  }

  if (type === 'resolve-conflict') {
    const candidateId = asString(obj.candidateId);
    const attr = asString(obj.attr);
    const chosenSource = asString(obj.chosenSource);
    if (!candidateId || !attr || !chosenSource) return null;
    return {
      kind: 'resolve-conflict',
      candidateId,
      attr,
      chosenValue: obj.chosenValue,
      chosenSource,
    };
  }

  if (type === 'resolve-conflicts-by-pattern') {
    const candidateId = asString(obj.candidateId);
    const attr = asString(obj.attr);
    const chosenSource = asString(obj.chosenSource);
    if (!candidateId || !attr || !chosenSource) return null;
    return {
      kind: 'resolve-conflicts-by-pattern',
      candidateId,
      attr,
      chosenSource,
      classCandidateIds: [], // filled deterministically by the gate via getSimilarConflicts
    };
  }

  if (type === 'save') {
    return { kind: 'save' };
  }

  return null;
}

/**
 * For each class member, find its OWN competing value for `attr` from
 * `chosenSource` in its live `_conflicts[attr]`. NEVER a shared literal — each
 * member keeps the value its own source contributed. Members with no value from
 * that source are omitted (the orchestrator skips them defensively).
 */
function deriveByMemberValues(
  classCandidateIds: string[],
  attr: string,
  chosenSource: string,
  model: FullReviewModelWire,
): Record<string, unknown> {
  const byId: Record<string, unknown> = {};
  const nodeById = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  for (const candidateId of classCandidateIds) {
    const node = nodeById.get(candidateId);
    const entries = node?.conflict_state?.conflicts?.[attr];
    if (!entries) continue;
    const match = entries.find((e) => e.source === chosenSource);
    if (match) byId[candidateId] = match.value;
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const AFFIRMATIVE = new Set([
  'yes',
  'y',
  'yes please',
  'confirm',
  'confirmed',
  'do it',
  'apply',
  'go ahead',
  'ok',
  'okay',
  'yep',
  'yeah',
  'sure',
  'proceed',
]);

/** Re-validate a natural-language reply as an affirmative confirm. Strict. */
export function isAffirmative(text: string): boolean {
  const normalised = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (AFFIRMATIVE.has(normalised)) return true;
  // Tolerate a leading affirmative word ("yes, apply them all").
  const firstWord = normalised.split(/[\s,]+/)[0];
  return AFFIRMATIVE.has(firstWord);
}

function normaliseAction(raw: unknown): BulkReviewAction | null {
  if (raw === 'approved' || raw === 'rejected' || raw === 'deferred') return raw;
  return null;
}

/** The base verb for each disposition (for deterministic narration prose). */
const ACTION_VERB: Record<BulkReviewAction, string> = {
  approved: 'approve',
  rejected: 'reject',
  deferred: 'defer',
};

/**
 * Normalise the optional `apply-decision` `scope` discriminator (S1). Only the
 * literal `'family'` selects the shallow `deriveFamilyForSeed` reach; anything
 * else (including absent / unknown) maps to undefined, which the apply path treats
 * as `'cascade'` (today's full-cascade behaviour) — so every existing caller is
 * unchanged.
 */
function normaliseScope(raw: unknown): 'family' | 'cascade' | undefined {
  if (raw === 'family') return 'family';
  if (raw === 'cascade') return 'cascade';
  return undefined;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/**
 * The fixed, friendly prose fallback surfaced when the LLM's terminal value is
 * NOT a recognised narration shape (e.g. a hallucinated intent `type`, or an
 * empty-ids apply-decision that parsed to null). It points the reviewer at the
 * always-actionable agenda options so they are never stuck. NEVER raw JSON.
 */
const NARRATION_FALLBACK =
  'I\'m not sure which items you mean. You can act on any item in the list below — ' +
  'Approve, Reject, Defer, or resolve a conflict by picking a source — or tell me ' +
  'something like "approve all the endpoints in this chunk" or "reject the orphaned interface".';

/**
 * Convert the LLM's terminal answer value into the Architect's visible narration
 * text. This function can NEVER emit raw JSON — that was the leak (the LLM was
 * pushed into emitting junk objects, which `JSON.stringify` then dumped verbatim
 * into the transcript). The contract now:
 *   - a string                                              → the string.
 *   - a `clarify` object with a string `message`            → the message.
 *   - any object with a string `narration`/`message`/`text` → that string.
 *   - ANYTHING ELSE                                          → the fixed prose
 *     fallback (logged for diagnosis, NOT serialized to JSON).
 */
export function narrationFrom(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // The new `clarify` terminal answer (ask / explain — no write, no change).
    if (obj.type === 'clarify' && typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message;
    }
    if (typeof obj.narration === 'string' && obj.narration.length > 0) return obj.narration;
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
    if (typeof obj.text === 'string' && obj.text.length > 0) return obj.text;
  }
  // Unknown / junk terminal value (e.g. a hallucinated intent type, or an
  // empty-ids apply-decision). Log for diagnosis, then return friendly prose —
  // NEVER JSON.stringify (that was the raw-JSON leak this fixes).
  logger.debug('discovery-review: non-narration terminal value coerced to fallback', { value });
  return NARRATION_FALLBACK;
}
