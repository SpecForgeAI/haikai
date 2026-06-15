/**
 * Architect Conversation Coordinator — Target State Architect-Persona Conversation
 * (Spec 3, Commit 3 + Commit 4)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Wires the Commit-2 LLM loop runner to the Commit-3 decision capture
 * orchestrator and the Commit-4 mapping-mutation orchestrator. One call per
 * answered question handles the full sequence:
 *
 *   1. Append `question` turn (with `discoveryContextLead` prepended).
 *   2. Append `answer` turn capturing the user's free-text verbatim.
 *   3. Run `runArchitectQuestionLoop` to parse the answer (or detect the
 *      default-when-unchanged short-circuit).
 *   4. On `error` outcome — append an `error` turn and return.
 *   5. On `answer` outcome — call `orchestrator.capturePrimaryAnswer` which
 *      writes the primary row, appends `decision-captured`, and (if cascades
 *      apply) appends a `cascade-summary` turn. The cascade-summary is the
 *      UX gate — the caller drives accept-batch / override via the
 *      orchestrator's dedicated methods after the user responds.
 *   6. On capture success — invoke the mapping-mutation orchestrator
 *      (Commit 4) for the just-written decision id; on success appends a
 *      `mapping-mutation-summary` turn, on failure appends an `error` turn
 *      with `errorKind = 'mapping-mutation-failed'` WITHOUT rolling back
 *      the captured decision (decisions and mutations are separate
 *      transactions; user can retry).
 *
 * Backwards-compatibility note (Commit 3 tests): the
 * `mappingMutationOrchestrator` field on `CoordinatorDeps` is OPTIONAL on the
 * test-time construction path; when a caller passes an explicit
 * `CoordinatorDeps` object that omits the field, step 6 is skipped. The
 * production-default `defaultCoordinatorDeps` constant DOES set it, so real
 * conversation flows always invoke the mutation step. Tests written in
 * Commit 3 (which pre-date Commit 4) thus do not need to be re-touched.
 *
 * Intra-group ordering enforcement (A.1 → A.2 → A.3 per Q5) is the caller's
 * responsibility; this coordinator answers ONE question at a time. The caller
 * threads its own ordering state.
 *
 * For the other capture paths (`acceptCascadeBatch`, `overrideCascade`,
 * `revisePriorAnswer`, `pinException`), callers should invoke
 * `mappingMutationOrchestrator.applyForCapturedDecision` per produced decision
 * id directly -- this coordinator's `answerQuestion` only handles the
 * primary-answer path.
 *
 * Open-turn orchestration (Spec 2026-06-05-architect-tier-gating, Half B):
 * `buildTierConfirmationTurn` / `appendTierConfirmationTurn` own the
 * tier-confirmation opening turn — emitted at OPEN, immediately after the
 * `open` turn and BEFORE the first question (parallel to the Discovery Review
 * Room `open`-turn step). The route calls these once per open.
 *
 * Open-phase sub-phase handlers (Spec 2026-06-06-architect-conversation-open-
 * ended-phase, Task Group 3): SIBLINGS to `answerQuestion` /
 * `captureDeterministicAnswer` that drive the open phase AFTER the preset walk
 * exhausts — sub-phase (a) (open prompt + suggested areas → user-raised topic →
 * option proposal → user pick) and sub-phase (b) (free-form chat → end-of-(b)
 * per-topic note summarisation). They reuse the sibling open-phase loop
 * (`openPhaseLoopRunner.ts`) and the SAME failure-to-`error`-turn mapping. The
 * LLM NEVER infers "done" — transitions are explicit ENTRY POINTS only (S5):
 * each handler is invoked by the route in response to an explicit user control,
 * never by the LLM signalling completion from free text. The decision/note
 * WRITES themselves are Task Group 4 (the dedicated open-phase capture path).
 */

import type {
  QuestionLibraryEntry,
  RelevanceContext,
} from '../../config/architect-conversation/questionLibrary';
import type { ArchitectLlmClient } from './architectLlmClient';
import type { ArchitectChatMessage } from './architectLlmClient';
import {
  ArchitectToolRegistryEntry,
  LoopAnswerOk,
  LoopErrorResult,
  LoopResult,
  runArchitectQuestionLoop,
} from './llmLoopRunner';
import {
  captureUserDecision as runCaptureUserDecision,
  freeFormReply as runFreeFormReply,
  proposeOptionsForTopic as runProposeOptionsForTopic,
  recordDiscussionNotes as runRecordDiscussionNotes,
  suggestCandidateAreas as runSuggestCandidateAreas,
  type CaptureUserDecisionPayload,
  type DiscussionNote,
  type OpenPhaseLoopErrorResult,
  type OpenPhaseLoopResult,
  type ProposeOptionsForTopicPayload,
} from './openPhaseLoopRunner';
import { adhocDecisionCode } from './openPhaseCodes';
import {
  CapturePrimaryAnswerOutcome,
  DecisionCaptureOrchestrator,
  defaultDecisionCaptureOrchestrator,
} from './decisionCaptureOrchestrator';
import {
  MappingMutationOrchestrator,
  defaultMappingMutationOrchestrator,
  ApplyMutationOutcome,
} from './mappingMutationOrchestrator';
import { appendTurn as defaultAppendTurn } from '../targetStateConversationStore';
import type {
  AnswerTurn,
  CascadeSummaryTurn,
  ConversationErrorKind,
  DecisionCapturedTurn,
  ErrorTurn,
  FreeFormDiscussionTurn,
  MappingMutationSummaryTurn,
  OpenPhasePromptTurn,
  OptionProposalTurn,
  QuestionTurn,
  SystemSkipTurn,
  TierConfirmationTurn,
  TierFlags,
  UserPickTurn,
  UserRaisedTopicTurn,
} from './turnShape';

// ---------------------------------------------------------------------------
// Injected dependencies (test seam)
// ---------------------------------------------------------------------------

export interface CoordinatorDeps {
  orchestrator: DecisionCaptureOrchestrator;
  /**
   * Mapping-mutation orchestrator invoked after a captured-decision row is
   * written so the deterministic side-effects on the architecture-element
   * mappings happen inside a single AMS transaction (per Q13).
   *
   * **Optional**: omit (or set to `undefined`) on the test-time construction
   * path to skip the mutation step entirely. The production-default
   * {@link defaultCoordinatorDeps} sets this to the real orchestrator so
   * production conversation flows always invoke it. Commit 3 tests
   * (pre-Commit 4) take advantage of this skip path to avoid HTTP fetches.
   */
  mappingMutationOrchestrator?: MappingMutationOrchestrator;
  appendTurn: typeof defaultAppendTurn;
  /** Mockable loop runner so tests can wholesale-replace the LLM round-trip path. */
  runLoop?: typeof runArchitectQuestionLoop;
}

export const defaultCoordinatorDeps: CoordinatorDeps = {
  orchestrator: defaultDecisionCaptureOrchestrator,
  mappingMutationOrchestrator: defaultMappingMutationOrchestrator,
  appendTurn: defaultAppendTurn,
  runLoop: runArchitectQuestionLoop,
};

// ---------------------------------------------------------------------------
// Tier-confirmation opening turn (Spec 2026-06-05-architect-tier-gating, Half B)
//
// Emitted at OPEN, immediately after the `open` turn and BEFORE the first
// question is fetched, parallel to the Discovery Review Room `open`-turn step.
// At open the confirmed set equals the derived (supplied) set — the user may
// later adjust it via the confirmation UI (Task Group 4). IN-SESSION ONLY:
// no durable captured-decision row.
// ---------------------------------------------------------------------------

/**
 * Build the `tier-confirmation` turn from a {@link RelevanceContext} tier set.
 * The derived + confirmed sets are seeded identical (the user's adjustment, if
 * any, happens client-side after open). Pure — no I/O.
 */
export function buildTierConfirmationTurn(
  tiers: RelevanceContext,
): TierConfirmationTurn {
  const flags: TierFlags = {
    hasUiTier: tiers.hasUiTier,
    hasServiceTier: tiers.hasServiceTier,
    hasPersistenceTier: tiers.hasPersistenceTier,
  };
  return {
    kind: 'tier-confirmation',
    derivedTiers: { ...flags },
    confirmedTiers: { ...flags },
  };
}

/**
 * Append the tier-confirmation turn at conversation open. Returns the turn that
 * was written so the route can echo it in the open response.
 */
export async function appendTierConfirmationTurn(
  projectId: string,
  targetArchitectureId: string,
  tiers: RelevanceContext,
  appendTurn: typeof defaultAppendTurn = defaultAppendTurn,
): Promise<TierConfirmationTurn> {
  const turn = buildTierConfirmationTurn(tiers);
  await appendTurn(projectId, targetArchitectureId, turn);
  return turn;
}

// ---------------------------------------------------------------------------
// Inputs / Outputs
// ---------------------------------------------------------------------------

export interface AnswerQuestionArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  entry: QuestionLibraryEntry;
  userResponse: string;
  capturedDecisionsContext: string;
  inlineCascadeSeedMap: string;
  llmClient: ArchitectLlmClient;
  /** Optional context for relevance auto-skip evaluation. */
  relevanceContext?: RelevanceContext;
  /** 1-based round index the question was surfaced on (recorded on turns 1+2). */
  roundIndex?: number;
  /** Optional tool registry forwarded into the loop runner. */
  tools?: ArchitectToolRegistryEntry[];
  /** Optional limit overrides forwarded into the loop runner. */
  roundLimit?: number;
  perCallTimeoutMs?: number;
  wallClockMs?: number;
}

export type AnswerQuestionOutcome =
  | {
      kind: 'skipped';
      systemSkipTurn: SystemSkipTurn;
    }
  | {
      kind: 'captured';
      questionTurn: QuestionTurn;
      answerTurn: AnswerTurn;
      decisionCapturedTurn: DecisionCapturedTurn;
      cascadeSummaryTurn: CascadeSummaryTurn | null;
      capture: CapturePrimaryAnswerOutcome;
      defaultUnchangedPath: boolean;
      /**
       * Populated when (a) the primary answer was captured successfully AND
       * (b) a `mappingMutationOrchestrator` was wired in the coordinator deps
       * (the production default does; pre-Commit-4 test seams omit it).
       * `kind = 'applied'` carries the `mapping-mutation-summary` turn; `kind
       * = 'error'` carries the `error` turn (the captured decision is NOT
       * rolled back -- decisions and mutations are separate transactions per
       * Q13). `null` when the mutation orchestrator was not wired.
       */
      mappingMutation: ApplyMutationOutcome | null;
      /** Convenience handle for callers that just want the summary turn (or null on error / skip). */
      mappingMutationSummaryTurn: MappingMutationSummaryTurn | null;
    }
  | {
      kind: 'error';
      questionTurn: QuestionTurn;
      answerTurn: AnswerTurn;
      errorTurn: ErrorTurn;
      loopResult: LoopErrorResult;
    };

// ---------------------------------------------------------------------------
// The single per-question entry point
// ---------------------------------------------------------------------------

export async function answerQuestion(
  args: AnswerQuestionArgs,
  deps: CoordinatorDeps = defaultCoordinatorDeps,
): Promise<AnswerQuestionOutcome> {
  const roundIndex = args.roundIndex ?? 1;

  // -------------------------------------------------------------------------
  // RELEVANCE AUTO-SKIP — silent skip BEFORE the question turn.
  // -------------------------------------------------------------------------
  if (args.entry.relevanceCondition && args.relevanceContext) {
    const skipOutcome = await deps.orchestrator.maybeAutoSkip({
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      sessionId: args.sessionId,
      conversationThreadId: args.conversationThreadId,
      entry: args.entry,
      relevanceContext: args.relevanceContext,
    });
    if (skipOutcome.skipped) {
      return { kind: 'skipped', systemSkipTurn: skipOutcome.systemSkipTurn };
    }
  }

  // -------------------------------------------------------------------------
  // Surface the question + the user's answer-text as transcript turns FIRST.
  // -------------------------------------------------------------------------
  const promptText = args.entry.discoveryContextLead
    ? `${args.entry.discoveryContextLead}\n\n${args.entry.prompt}`
    : args.entry.prompt;

  const questionTurn: QuestionTurn = {
    kind: 'question',
    decisionCode: args.entry.code,
    promptText,
    roundIndex,
    staticContextLeadIn: args.entry.staticContextLeadIn,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, questionTurn);

  const answerTurn: AnswerTurn = {
    kind: 'answer',
    decisionCode: args.entry.code,
    answerText: args.userResponse,
    roundIndex,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, answerTurn);

  // -------------------------------------------------------------------------
  // Run the LLM loop (or short-circuit on default-when-unchanged).
  // -------------------------------------------------------------------------
  const runLoop = deps.runLoop ?? runArchitectQuestionLoop;
  const loopResult: LoopResult = await runLoop({
    entry: args.entry,
    userResponse: args.userResponse,
    capturedDecisionsContext: args.capturedDecisionsContext,
    inlineCascadeSeedMap: args.inlineCascadeSeedMap,
    llmClient: args.llmClient,
    tools: args.tools,
    roundLimit: args.roundLimit,
    perCallTimeoutMs: args.perCallTimeoutMs,
    wallClockMs: args.wallClockMs,
  });

  if (loopResult.outcome === 'error') {
    // Translate the loop-runner error kind into the transcript error turn.
    const errorTurn: ErrorTurn = {
      kind: 'error',
      errorKind: loopResult.errorKind,
      errorMessage: loopResult.errorMessage,
      recoverableHint: loopResult.recoverableHint,
    };
    await deps.appendTurn(args.projectId, args.targetArchitectureId, errorTurn);
    return { kind: 'error', questionTurn, answerTurn, errorTurn, loopResult };
  }

  // -------------------------------------------------------------------------
  // Write the captured decision via the orchestrator.
  // -------------------------------------------------------------------------
  const ok: LoopAnswerOk = loopResult;
  let capture: CapturePrimaryAnswerOutcome;
  try {
    capture = await deps.orchestrator.capturePrimaryAnswer({
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      sessionId: args.sessionId,
      entry: args.entry,
      answerValue: ok.answerValue,
      conversationThreadId: args.conversationThreadId,
      defaultUnchangedPath: ok.defaultUnchangedPath,
    });
  } catch (err) {
    const errorTurn = await deps.orchestrator.appendErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      err,
    );
    // Re-shape the loop result as a synthetic error result so the outcome
    // discriminator stays consistent.
    const loopErr: LoopErrorResult = {
      outcome: 'error',
      errorKind: 'llm-call-failed', // unused for this path; kept for type completeness
      errorMessage: errorTurn.errorMessage,
      roundsUsed: ok.roundsUsed,
      durationMs: ok.durationMs,
    };
    return { kind: 'error', questionTurn, answerTurn, errorTurn, loopResult: loopErr };
  }

  // -------------------------------------------------------------------------
  // Apply mapping mutations for the just-captured decision (Commit 4).
  //
  // SKIPPED when the caller's CoordinatorDeps does not wire a
  // mappingMutationOrchestrator (the pre-Commit-4 test seam). The production
  // default DOES wire one.
  //
  // Failures here append an `error` turn but DO NOT roll back the captured
  // decision (separate transactions per Q13). The outcome is bubbled up so
  // the caller can react (e.g. tell the user the row was saved but the
  // mutations failed and they may retry).
  // -------------------------------------------------------------------------
  let mappingMutation: ApplyMutationOutcome | null = null;
  if (deps.mappingMutationOrchestrator) {
    mappingMutation = await deps.mappingMutationOrchestrator.applyForCapturedDecision({
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      decisionId: capture.decision.decisionId,
      decisionCode: capture.decision.decisionCode,
    });
  }
  const mappingMutationSummaryTurn =
    mappingMutation && mappingMutation.kind === 'applied'
      ? mappingMutation.summaryTurn
      : null;

  return {
    kind: 'captured',
    questionTurn,
    answerTurn,
    decisionCapturedTurn: capture.decisionCapturedTurn,
    cascadeSummaryTurn: capture.cascadeSummaryTurn,
    capture,
    defaultUnchangedPath: ok.defaultUnchangedPath,
    mappingMutation,
    mappingMutationSummaryTurn,
  };
}

// ---------------------------------------------------------------------------
// Deterministic capture entry point (NO LLM)
//
// Backs the click-to-answer question UI (2026-06-01): the user picks an option,
// types a custom value, or opts out, and the frontend sends the exact value to
// capture. We skip the LLM loop entirely (instant + robust — no dependency on a
// configured LLM relay), append the question + answer turns, write the
// captured-decision row via the orchestrator (which still computes any cascades
// deterministically from the library entry), and apply mapping mutations. The
// returned shape is the SAME `captured` / `error` union as `answerQuestion`, so
// the route + frontend reuse one wire contract.
// ---------------------------------------------------------------------------

export interface CaptureDeterministicAnswerArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  entry: QuestionLibraryEntry;
  /** The exact value to capture: a chosen option, a custom string, or an opt-out marker. */
  value: unknown;
  /** Text shown on the `answer` transcript turn (defaults to String(value)). */
  answerText?: string;
  /** 1-based round index recorded on the question + answer turns. */
  roundIndex?: number;
}

export async function captureDeterministicAnswer(
  args: CaptureDeterministicAnswerArgs,
  deps: CoordinatorDeps = defaultCoordinatorDeps,
): Promise<AnswerQuestionOutcome> {
  const roundIndex = args.roundIndex ?? 1;

  const promptText = args.entry.discoveryContextLead
    ? `${args.entry.discoveryContextLead}\n\n${args.entry.prompt}`
    : args.entry.prompt;

  const questionTurn: QuestionTurn = {
    kind: 'question',
    decisionCode: args.entry.code,
    promptText,
    roundIndex,
    staticContextLeadIn: args.entry.staticContextLeadIn,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, questionTurn);

  const answerTurn: AnswerTurn = {
    kind: 'answer',
    decisionCode: args.entry.code,
    answerText: args.answerText ?? String(args.value),
    roundIndex,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, answerTurn);

  let capture: CapturePrimaryAnswerOutcome;
  try {
    capture = await deps.orchestrator.capturePrimaryAnswer({
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      sessionId: args.sessionId,
      entry: args.entry,
      answerValue: args.value,
      conversationThreadId: args.conversationThreadId,
      defaultUnchangedPath: false,
    });
  } catch (err) {
    const errorTurn = await deps.orchestrator.appendErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      err,
    );
    const loopErr: LoopErrorResult = {
      outcome: 'error',
      errorKind: 'llm-call-failed', // unused for this path; kept for type completeness
      errorMessage: errorTurn.errorMessage,
      roundsUsed: 0,
      durationMs: 0,
    };
    return { kind: 'error', questionTurn, answerTurn, errorTurn, loopResult: loopErr };
  }

  let mappingMutation: ApplyMutationOutcome | null = null;
  if (deps.mappingMutationOrchestrator) {
    mappingMutation = await deps.mappingMutationOrchestrator.applyForCapturedDecision({
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      decisionId: capture.decision.decisionId,
      decisionCode: capture.decision.decisionCode,
    });
  }
  const mappingMutationSummaryTurn =
    mappingMutation && mappingMutation.kind === 'applied'
      ? mappingMutation.summaryTurn
      : null;

  return {
    kind: 'captured',
    questionTurn,
    answerTurn,
    decisionCapturedTurn: capture.decisionCapturedTurn,
    cascadeSummaryTurn: capture.cascadeSummaryTurn,
    capture,
    defaultUnchangedPath: false,
    mappingMutation,
    mappingMutationSummaryTurn,
  };
}

// ===========================================================================
// OPEN-PHASE SUB-PHASE HANDLERS
// (Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 3.4)
//
// SIBLINGS to `answerQuestion` / `captureDeterministicAnswer`. They drive the
// open phase AFTER the preset walk exhausts (the route only calls them once the
// `next-question` `phase` is `open-available`). Each handler is an EXPLICIT
// entry point invoked in response to an explicit user control — the LLM NEVER
// infers "done" (S5). They reuse the sibling open-phase loop and the SAME
// failure-to-`error`-turn mapping (the open-phase loop's error kinds map onto
// the closed-union `ConversationErrorKind` via `mapOpenPhaseErrorKind`).
//
// The decision/note WRITES are Task Group 4 (the dedicated open-phase capture
// path). These handlers PRODUCE the turns + the structured intents; the route
// performs the write via `postCapturedDecision` and appends the resulting
// turns. A minimal `appendTurn` dep (subset of CoordinatorDeps) is taken so the
// open-phase handlers do not require the decision/mutation orchestrators.
// ===========================================================================

/** The minimal dependency surface the open-phase handlers need. */
export interface OpenPhaseHandlerDeps {
  appendTurn: typeof defaultAppendTurn;
}

const defaultOpenPhaseHandlerDeps: OpenPhaseHandlerDeps = {
  appendTurn: defaultAppendTurn,
};

/**
 * Map the open-phase loop's error kind onto the closed-union
 * `ConversationErrorKind` so the open-phase handlers reuse the SAME error-turn
 * shape as the preset loop (S3). `tool-output-malformed` reuses the existing
 * `submit-answer-malformed` kind (the closest "the LLM produced a malformed
 * structured output" semantics already in the union — no union widening).
 */
export function mapOpenPhaseErrorKind(
  kind: OpenPhaseLoopErrorResult['errorKind'],
): ConversationErrorKind {
  switch (kind) {
    case 'llm-call-timeout':
      return 'llm-call-timeout';
    case 'wall-clock-exceeded':
      return 'wall-clock-exceeded';
    case 'aborted':
      return 'aborted';
    case 'llm-call-failed':
      return 'llm-call-failed';
    case 'tool-output-malformed':
      return 'submit-answer-malformed';
    default:
      return 'llm-call-failed';
  }
}

/**
 * Build (and append) an `error` turn from an open-phase loop error result,
 * reusing the SAME error-turn translation as the preset loop. Returns the turn.
 */
async function appendOpenPhaseErrorTurn(
  projectId: string,
  targetArchitectureId: string,
  errorResult: OpenPhaseLoopErrorResult,
  appendTurn: typeof defaultAppendTurn,
): Promise<ErrorTurn> {
  const errorTurn: ErrorTurn = {
    kind: 'error',
    errorKind: mapOpenPhaseErrorKind(errorResult.errorKind),
    errorMessage: errorResult.errorMessage,
    recoverableHint: errorResult.recoverableHint,
  };
  await appendTurn(projectId, targetArchitectureId, errorTurn);
  return errorTurn;
}

/** Shared open-phase loop inputs threaded into every handler. */
export interface OpenPhaseLoopInputs {
  llmClient: ArchitectLlmClient;
  /** Pre-assembled grounding (Task Group 2's `buildOpenPhaseGrounding`). */
  grounding: string;
  /** Optional external abort signal. */
  abortSignal?: AbortSignal;
  /** Optional limit overrides forwarded into the open-phase loop. */
  roundLimit?: number;
  perCallTimeoutMs?: number;
  wallClockMs?: number;
  model?: string;
}

// ---------------------------------------------------------------------------
// Sub-phase (a) — START: open prompt + proactively-suggested candidate areas (P3)
// ---------------------------------------------------------------------------

export interface BeginOpenPhaseArgs extends OpenPhaseLoopInputs {
  projectId: string;
  targetArchitectureId: string;
}

export type BeginOpenPhaseOutcome =
  | { kind: 'prompt'; openPhasePromptTurn: OpenPhasePromptTurn }
  | { kind: 'error'; errorTurn: ErrorTurn };

/**
 * Sub-phase (a) ENTRY (P3). Runs the open-phase loop's `suggest-candidate-areas`
 * tool and appends the `open-phase-prompt` turn (the architect's opener + the
 * grounded candidate areas). On loop failure appends an `error` turn (reusing
 * the SAME error-turn mapping). Explicit entry point — invoked by the route the
 * moment the open phase begins, never inferred.
 */
export async function beginOpenPhase(
  args: BeginOpenPhaseArgs,
  deps: OpenPhaseHandlerDeps = defaultOpenPhaseHandlerDeps,
): Promise<BeginOpenPhaseOutcome> {
  const result = await runSuggestCandidateAreas({
    llmClient: args.llmClient,
    grounding: args.grounding,
    abortSignal: args.abortSignal,
    roundLimit: args.roundLimit,
    perCallTimeoutMs: args.perCallTimeoutMs,
    wallClockMs: args.wallClockMs,
    model: args.model,
  });

  if (result.outcome === 'error') {
    const errorTurn = await appendOpenPhaseErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      result,
      deps.appendTurn,
    );
    return { kind: 'error', errorTurn };
  }

  const openPhasePromptTurn: OpenPhasePromptTurn = {
    kind: 'open-phase-prompt',
    promptText: result.payload.promptText,
    suggestedAreas: result.payload.areas,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, openPhasePromptTurn);
  return { kind: 'prompt', openPhasePromptTurn };
}

// ---------------------------------------------------------------------------
// Sub-phase (a) — user raises a topic → LLM proposes options
// ---------------------------------------------------------------------------

export interface RaiseTopicArgs extends OpenPhaseLoopInputs {
  projectId: string;
  targetArchitectureId: string;
  /** User-facing topic label (the basis for the later `adhoc.<slug>` code). */
  topicLabel: string;
  /** The user's verbatim phrasing, when distinct from the label. */
  topicText?: string;
}

export type RaiseTopicOutcome =
  | {
      kind: 'proposed';
      userRaisedTopicTurn: UserRaisedTopicTurn;
      optionProposalTurn: OptionProposalTurn;
      /** The raw payload (handy for callers/tests). */
      proposal: ProposeOptionsForTopicPayload;
    }
  | {
      kind: 'error';
      userRaisedTopicTurn: UserRaisedTopicTurn;
      errorTurn: ErrorTurn;
    };

/**
 * Sub-phase (a): the user raised a topic. Appends the `user-raised-topic` turn
 * (verbatim), runs the open-phase loop's `propose-options-for-topic` tool
 * (single/multi PER TOPIC + a "something else…" escape; NO "Not applicable" —
 * P4/S4), and appends the `option-proposal` turn. On loop failure appends an
 * `error` turn AFTER the topic turn (so the transcript records what was asked).
 */
export async function raiseTopic(
  args: RaiseTopicArgs,
  deps: OpenPhaseHandlerDeps = defaultOpenPhaseHandlerDeps,
): Promise<RaiseTopicOutcome> {
  const userRaisedTopicTurn: UserRaisedTopicTurn = {
    kind: 'user-raised-topic',
    topicLabel: args.topicLabel,
    topicText: args.topicText,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, userRaisedTopicTurn);

  const result = await runProposeOptionsForTopic({
    llmClient: args.llmClient,
    grounding: args.grounding,
    topicLabel: args.topicLabel,
    topicText: args.topicText,
    abortSignal: args.abortSignal,
    roundLimit: args.roundLimit,
    perCallTimeoutMs: args.perCallTimeoutMs,
    wallClockMs: args.wallClockMs,
    model: args.model,
  });

  if (result.outcome === 'error') {
    const errorTurn = await appendOpenPhaseErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      result,
      deps.appendTurn,
    );
    return { kind: 'error', userRaisedTopicTurn, errorTurn };
  }

  const optionProposalTurn: OptionProposalTurn = {
    kind: 'option-proposal',
    topicLabel: result.payload.topicLabel,
    selectionMode: result.payload.selectionMode,
    options: result.payload.options,
    // S4: ALWAYS offer the free-text escape for user-raised topics.
    allowFreeTextEscape: true,
    freeTextEscapeLabel: result.payload.freeTextEscapeLabel ?? 'Something else…',
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, optionProposalTurn);
  return { kind: 'proposed', userRaisedTopicTurn, optionProposalTurn, proposal: result.payload };
}

// ---------------------------------------------------------------------------
// Sub-phase (a) — the user's pick → structured first-class decision intent
//
// This handler PRODUCES the `user-pick` turn + the structured decision intent
// (code/value/summary). It does NOT write the captured-decision row — that is
// the dedicated open-phase capture path (Task Group 4). The route calls this to
// shape the pick, then writes via `postCapturedDecision`. The `user-pick` turn
// IS appended here (verbatim) so the transcript records the pick even if the
// downstream write is retried.
// ---------------------------------------------------------------------------

export interface PreparePickArgs extends OpenPhaseLoopInputs {
  projectId: string;
  targetArchitectureId: string;
  topicLabel: string;
  /** The selected option value(s); empty when the free-text escape was taken. */
  selectedValues?: string[];
  /** The verbatim "something else…" value, when the escape was taken. */
  freeTextValue?: string;
}

/**
 * The structured first-class decision intent derived from a user pick. The
 * route writes this via `postCapturedDecision` (Task Group 4) — `decisionCode`
 * is the `adhoc.<slug>` code (slug from the topic label, so a repeated pick on
 * one topic supersedes; distinct topics get distinct codes), scope is
 * architecture-wide (S1).
 */
export interface UserDecisionIntent {
  decisionCode: string;
  /** The canonical answer value persisted on the decision row. */
  answerValue: string;
  /** Optional one-line human-readable summary. */
  answerSummary?: string;
  topicLabel: string;
}

export type PreparePickOutcome =
  | {
      kind: 'prepared';
      userPickTurn: UserPickTurn;
      decisionIntent: UserDecisionIntent;
      /** The raw loop payload (handy for callers/tests). */
      capturePayload: CaptureUserDecisionPayload;
    }
  | {
      kind: 'error';
      errorTurn: ErrorTurn;
    };

/**
 * Sub-phase (a): shape the user's pick into a first-class decision intent. Runs
 * the open-phase loop's `capture-user-decision` tool to normalise the pick into
 * a canonical answer value + summary, derives the `adhoc.<slug>` code from the
 * topic label, appends the `user-pick` turn, and returns the intent for the
 * route to WRITE (Task Group 4). On loop failure appends an `error` turn.
 */
export async function preparePick(
  args: PreparePickArgs,
  deps: OpenPhaseHandlerDeps = defaultOpenPhaseHandlerDeps,
): Promise<PreparePickOutcome> {
  const result = await runCaptureUserDecision({
    llmClient: args.llmClient,
    grounding: args.grounding,
    topicLabel: args.topicLabel,
    selectedValues: args.selectedValues,
    freeTextValue: args.freeTextValue,
    abortSignal: args.abortSignal,
    roundLimit: args.roundLimit,
    perCallTimeoutMs: args.perCallTimeoutMs,
    wallClockMs: args.wallClockMs,
    model: args.model,
  });

  if (result.outcome === 'error') {
    const errorTurn = await appendOpenPhaseErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      result,
      deps.appendTurn,
    );
    return { kind: 'error', errorTurn };
  }

  const payload = result.payload;
  const decisionCode = adhocDecisionCode(payload.topicLabel);
  // Canonical answer value: the free-text escape verbatim, else the joined
  // selected values (multi) / the single value (single).
  const answerValue =
    payload.freeTextValue && payload.freeTextValue.trim().length > 0
      ? payload.freeTextValue
      : payload.selectedValues.join(', ');

  const userPickTurn: UserPickTurn = {
    kind: 'user-pick',
    topicLabel: payload.topicLabel,
    decisionCode,
    selectedValues: payload.selectedValues,
    freeTextValue: payload.freeTextValue,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, userPickTurn);

  const decisionIntent: UserDecisionIntent = {
    decisionCode,
    answerValue,
    answerSummary: payload.answerSummary,
    topicLabel: payload.topicLabel,
  };
  return { kind: 'prepared', userPickTurn, decisionIntent, capturePayload: payload };
}

// ---------------------------------------------------------------------------
// Sub-phase (b) — a single free-form discussion turn (user + assistant)
// ---------------------------------------------------------------------------

export interface DiscussArgs extends OpenPhaseLoopInputs {
  projectId: string;
  targetArchitectureId: string;
  /** The user's message verbatim. */
  userMessage: string;
  /**
   * Prior free-form turns to give the assistant conversational memory. The
   * route reconstructs this from the durable transcript's `free-form-discussion`
   * turns.
   */
  priorHistory?: ArchitectChatMessage[];
}

export type DiscussOutcome =
  | {
      kind: 'replied';
      userTurn: FreeFormDiscussionTurn;
      assistantTurn: FreeFormDiscussionTurn;
    }
  | {
      kind: 'error';
      userTurn: FreeFormDiscussionTurn;
      errorTurn: ErrorTurn;
    };

/**
 * Sub-phase (b): one round of the genuine multi-turn free-form chat. Appends the
 * user's `free-form-discussion` turn (verbatim), runs the open-phase loop's
 * `freeFormReply` (a plain assistant reply — no tool call), and appends the
 * assistant's `free-form-discussion` turn. On loop failure appends an `error`
 * turn after the user turn.
 */
export async function discuss(
  args: DiscussArgs,
  deps: OpenPhaseHandlerDeps = defaultOpenPhaseHandlerDeps,
): Promise<DiscussOutcome> {
  const userTurn: FreeFormDiscussionTurn = {
    kind: 'free-form-discussion',
    speaker: 'user',
    messageText: args.userMessage,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, userTurn);

  const result = await runFreeFormReply({
    llmClient: args.llmClient,
    grounding: args.grounding,
    history: args.priorHistory ?? [],
    userMessage: args.userMessage,
    abortSignal: args.abortSignal,
    roundLimit: args.roundLimit,
    perCallTimeoutMs: args.perCallTimeoutMs,
    wallClockMs: args.wallClockMs,
    model: args.model,
  });

  if (result.outcome === 'error') {
    const errorTurn = await appendOpenPhaseErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      result,
      deps.appendTurn,
    );
    return { kind: 'error', userTurn, errorTurn };
  }

  const assistantTurn: FreeFormDiscussionTurn = {
    kind: 'free-form-discussion',
    speaker: 'assistant',
    messageText: result.payload.replyText,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, assistantTurn);
  return { kind: 'replied', userTurn, assistantTurn };
}

// ---------------------------------------------------------------------------
// Sub-phase (b) — END: summarise the discussion into per-topic structured notes
//
// PRODUCES the structured notes; the WRITE (per-note-unique `note.<slug>` rows)
// is the dedicated open-phase capture path (Task Group 4). Explicit entry point
// — invoked by the route in response to the "Done / Close" control (S5), never
// inferred. No transcript turn is appended here: the notes become `note.<slug>`
// captured-decision rows (their own durable home); the free-form-discussion
// turns already recorded the conversation.
// ---------------------------------------------------------------------------

export interface SummariseDiscussionArgs extends OpenPhaseLoopInputs {
  projectId: string;
  targetArchitectureId: string;
  /** The verbatim free-form discussion to summarise (reconstructed by the route). */
  transcript: string;
}

export type SummariseDiscussionOutcome =
  | { kind: 'notes'; notes: DiscussionNote[] }
  | { kind: 'error'; errorTurn: ErrorTurn };

/**
 * Sub-phase (b) END (Q2a): summarise the free-form discussion into PER-TOPIC
 * structured notes via the open-phase loop's `record-discussion-note` tool. An
 * empty notes array is valid (nothing note-worthy / skipped). On loop failure
 * appends an `error` turn. The route writes each returned note as a per-note-
 * unique `note.<slug>` row (Task Group 4).
 */
export async function summariseDiscussion(
  args: SummariseDiscussionArgs,
  deps: OpenPhaseHandlerDeps = defaultOpenPhaseHandlerDeps,
): Promise<SummariseDiscussionOutcome> {
  const result: OpenPhaseLoopResult<{ notes: DiscussionNote[] }> =
    await runRecordDiscussionNotes({
      llmClient: args.llmClient,
      grounding: args.grounding,
      transcript: args.transcript,
      abortSignal: args.abortSignal,
      roundLimit: args.roundLimit,
      perCallTimeoutMs: args.perCallTimeoutMs,
      wallClockMs: args.wallClockMs,
      model: args.model,
    });

  if (result.outcome === 'error') {
    const errorTurn = await appendOpenPhaseErrorTurn(
      args.projectId,
      args.targetArchitectureId,
      result,
      deps.appendTurn,
    );
    return { kind: 'error', errorTurn };
  }

  return { kind: 'notes', notes: result.payload.notes };
}
