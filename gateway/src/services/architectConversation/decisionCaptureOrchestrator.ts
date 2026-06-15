/**
 * Decision Capture Orchestrator — Target State Architect-Persona Conversation
 * (Spec 3, Commit 3)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Owns the per-question side-effect flow once `runArchitectQuestionLoop`
 * (Commit 2) hands back a validated structured answer (or a relevance
 * auto-skip outcome):
 *
 *   1. Capture primary answer  → Spec 2 POST → `decision-captured` turn
 *   2. Compute cascade summary → `cascade-summary` turn (UX gate point)
 *   3. On accept-batch          → N sequential POSTs with shared
 *                                 `conversationTurnRef` → `cascade-accepted` turn
 *   4. On per-cascade override  → single POST with the override value →
 *                                 `cascade-overridden` turn
 *   5. On revision              → new superseding POST (insert-only per Spec
 *                                 settled-decision #10) → `edit-superseded`
 *                                 turn carrying the Q6 affected-downstream-codes
 *                                 banner payload
 *   6. On exception pin         → element-scoped POST → `exception-pinned`
 *                                 turn
 *   7. On auto-skip             → `not_applicable` POST + `system-skip` turn
 *
 * Mapping mutations are NOT applied here — that is Commit 4. The orchestrator
 * is the only writer for captured decisions; the LLM proposes cascades but
 * never writes them.
 *
 * Persistence: every transcript turn is appended via Spec 2's
 * `targetStateConversationStore.appendTurn` verbatim (per Q3 — we do NOT
 * extend that helper's signature). The store sees `unknown` turns; this
 * module guarantees they conform to the typed 13-kind union in
 * `turnShape.ts`.
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  CascadeEntry,
  QuestionLibrary,
  QuestionLibraryEntry,
} from '../../config/architect-conversation/questionLibrary';
import {
  appendTurn as defaultAppendTurn,
  loadTargetStateConversation as defaultLoadConversation,
} from '../targetStateConversationStore';
import {
  CapturedDecisionsWriteError,
  CreateCapturedDecisionRequestBody,
  postCapturedDecision as defaultPostCapturedDecision,
} from './targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import {
  defaultNotApplicableReason,
  evaluateRelevance,
  NOT_APPLICABLE_ANSWER_VALUE,
} from './relevanceEvaluator';
import type {
  CascadeAcceptedEntry,
  CascadeAcceptedTurn,
  CascadeOverriddenEntry,
  CascadeOverriddenTurn,
  CascadeSummaryEntry,
  CascadeSummaryTurn,
  DecisionCapturedTurn,
  DecisionScope,
  EditSupersededTurn,
  ErrorTurn,
  ExceptionPinnedTurn,
  SystemSkipTurn,
} from './turnShape';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Fixed task name on every captured-decision row written by this orchestrator.
// AMS requires `createdByTask` NOT NULL (per Q9 of the Spec 2 decisions).
// ---------------------------------------------------------------------------

export const ARCHITECT_CONVERSATION_TASK_NAME = 'architect-persona-conversation';

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam)
// ---------------------------------------------------------------------------

export interface DecisionCaptureDeps {
  /** POST a new captured-decision row via Spec 2. Tests mock this directly. */
  postCapturedDecision: typeof defaultPostCapturedDecision;
  /** Append a turn to the thread store. Tests mock this directly. */
  appendTurn: typeof defaultAppendTurn;
  /** Load the conversation thread (for revisions — we walk it to compute affected downstream codes). */
  loadConversation: typeof defaultLoadConversation;
  /** UUID factory — injectable so cascade-batch tests can assert shared turnRef values deterministically. */
  newId: () => string;
}

export const defaultDecisionCaptureDeps: DecisionCaptureDeps = {
  postCapturedDecision: defaultPostCapturedDecision,
  appendTurn: defaultAppendTurn,
  loadConversation: defaultLoadConversation,
  newId: () => uuidv4(),
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CapturePrimaryAnswerArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  /** The question library entry that was just answered. */
  entry: QuestionLibraryEntry;
  /** The validated structured answer (from the loop runner). */
  answerValue: unknown;
  /** The conversation thread id (sourced from `loadTargetStateConversation`). */
  conversationThreadId: string;
  /**
   * Whether the user reached this answer via the default-when-unchanged
   * short-circuit. The orchestrator records the same `defaultsWhenUnchanged`
   * value on the row regardless — but tests differentiate the path via the
   * `defaultUnchangedPath` flag on the returned outcome.
   */
  defaultUnchangedPath?: boolean;
}

export interface CapturePrimaryAnswerOutcome {
  decision: TargetStateCapturedDecision;
  decisionCapturedTurn: DecisionCapturedTurn;
  /** Built when the library entry declares cascades for the chosen answer value. */
  cascadeSummaryTurn: CascadeSummaryTurn | null;
  /** Internal payload — the orchestrator hands this back so callers can drive accept-batch / override per-cascade. */
  pendingCascadeProposals: PendingCascadeProposal[];
}

/**
 * Internal payload representing a single cascade the orchestrator computed
 * from the library entry's `cascades[]` map. The caller (the UI) decides
 * accept-vs-override per entry and feeds the choice back through
 * `acceptCascadeBatch` / `overrideCascade`.
 */
export interface PendingCascadeProposal {
  decisionCode: string;
  proposedValue: unknown;
  sourceStandardId: string;
}

export interface AcceptCascadeBatchArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  proposals: PendingCascadeProposal[];
}

export interface AcceptCascadeBatchOutcome {
  /** The captured-decision rows the batch wrote, in input order. */
  decisions: TargetStateCapturedDecision[];
  /** Per-row decision-captured turns (one per cascade). */
  decisionCapturedTurns: DecisionCapturedTurn[];
  /** Single cascade-accepted turn summarising the batch. */
  cascadeAcceptedTurn: CascadeAcceptedTurn;
  /**
   * The `conversationTurnRef` value all rows in the batch share — exposed so
   * tests can assert the audit linkage per Q10.
   */
  sharedConversationTurnRef: string;
}

export interface OverrideCascadeArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  /** The cascade entry the user is overriding (e.g. proposed JUnit 5, user said TestNG). */
  proposal: PendingCascadeProposal;
  overrideValue: unknown;
  overrideReason: string;
}

export interface OverrideCascadeOutcome {
  decision: TargetStateCapturedDecision;
  decisionCapturedTurn: DecisionCapturedTurn;
  cascadeOverriddenTurn: CascadeOverriddenTurn;
}

export interface ReviseAnswerArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  /** The library entry being revised. */
  entry: QuestionLibraryEntry;
  /** The id of the prior captured-decision row this revision supersedes. */
  originalDecisionId: string;
  /** The new answer the user picked. */
  newAnswerValue: unknown;
  /**
   * Optional scope override — defaults to architecture-wide. Set this when
   * revising a per-element exception.
   */
  scope?: DecisionScope;
  /**
   * Optional library handle so the orchestrator can walk it to compute the
   * `affectedDownstreamCodes` banner payload. Defaults to the production
   * QUESTION_LIBRARY but tests inject a tighter fixture.
   */
  library?: QuestionLibrary;
}

export interface ReviseAnswerOutcome {
  /** The new superseding row (insert-only per settled decision #10). */
  decision: TargetStateCapturedDecision;
  decisionCapturedTurn: DecisionCapturedTurn;
  editSupersededTurn: EditSupersededTurn;
}

export interface PinExceptionArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  entry: QuestionLibraryEntry;
  /** Element-scoped — `refType` must be in the entry's `allowedExceptionScopes`. */
  scope: Extract<DecisionScope, { kind: 'element' }>;
  answerValue: unknown;
}

export interface PinExceptionOutcome {
  decision: TargetStateCapturedDecision;
  decisionCapturedTurn: DecisionCapturedTurn;
  exceptionPinnedTurn: ExceptionPinnedTurn;
}

export interface AutoSkipArgs {
  projectId: string;
  targetArchitectureId: string;
  sessionId: string;
  conversationThreadId: string;
  entry: QuestionLibraryEntry;
  /** Same context shape the loop entry-point uses. */
  relevanceContext: import('../../config/architect-conversation/questionLibrary').RelevanceContext;
}

export type AutoSkipOutcome =
  | {
      skipped: false;
    }
  | {
      skipped: true;
      decision: TargetStateCapturedDecision;
      systemSkipTurn: SystemSkipTurn;
    };

// ---------------------------------------------------------------------------
// Cascade computation — reads the library entry's `cascades[]`
// ---------------------------------------------------------------------------

/**
 * Walk the library entry's `cascades[]` array and return the cascade
 * proposals triggered by the user's chosen answer value. Each proposal pairs
 * the downstream decisionCode + the seed-map value + the `sourceStandardId`
 * (recorded on the captured-decision row's `standardsLookupRef` per Q9 audit
 * continuity).
 *
 * When the user's answer is not a key in the cascade's `valueByTriggerValue`
 * map (e.g. they picked a choice with no downstream seed) the cascade is
 * silently skipped — the seed map is a partial function over allowed answers
 * by design (see Appendix A Group A.1 where `Go 1.22` triggers cascades for
 * service.runtime/testing.unit/build.tool but NOT dto.style).
 */
export function computeCascadeProposals(
  entry: QuestionLibraryEntry,
  triggerAnswerValue: unknown,
): PendingCascadeProposal[] {
  if (!Array.isArray(entry.cascades) || entry.cascades.length === 0) return [];
  const triggerKey =
    typeof triggerAnswerValue === 'string' ? triggerAnswerValue : null;
  if (triggerKey === null) return [];

  const proposals: PendingCascadeProposal[] = [];
  for (const cascade of entry.cascades as CascadeEntry[]) {
    const seedValue = cascade.valueByTriggerValue[triggerKey];
    if (seedValue === undefined) continue;
    proposals.push({
      decisionCode: cascade.decisionCode,
      proposedValue: seedValue,
      sourceStandardId: cascade.sourceStandardId,
    });
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Q6 affected-downstream-codes banner — walks the library + thread
// ---------------------------------------------------------------------------

/**
 * Compute the Q6 banner payload for an `edit-superseded` turn. The list is
 * the union of:
 *   (a) the library entry's declared cascade decision codes
 *   (b) any captured-decision rows for those codes that were written off the
 *       prior answer (i.e. the user accepted-or-overrode them earlier in the
 *       same conversation)
 *
 * v1 surfaces (a) for completeness and (b) is implicit — if a downstream code
 * was never captured, the banner still names it so the architect knows it MAY
 * need attention. No auto-replay (per Q6 + settled decision #14).
 *
 * We dedupe while preserving the library entry's cascade order so the UI
 * renders a stable list.
 */
export function computeAffectedDownstreamCodes(
  entry: Pick<QuestionLibraryEntry, 'cascades'>,
): string[] {
  if (!Array.isArray(entry.cascades) || entry.cascades.length === 0) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const cascade of entry.cascades as CascadeEntry[]) {
    if (seen.has(cascade.decisionCode)) continue;
    seen.add(cascade.decisionCode);
    ordered.push(cascade.decisionCode);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Shared turn builders (kept private so callers always go through the
// orchestrator methods — turns must always pair with their POST).
// ---------------------------------------------------------------------------

function buildDecisionCapturedTurn(
  row: TargetStateCapturedDecision,
  scope: DecisionScope,
): DecisionCapturedTurn {
  return {
    kind: 'decision-captured',
    decisionId: row.decisionId,
    decisionCode: row.decisionCode,
    scope,
    answerValue: row.answerValue,
    standardsLookupRef: row.standardsLookupRef ?? null,
  };
}

function buildRequestBodyForArchitectureScope(
  entry: QuestionLibraryEntry,
  answerValue: unknown,
  conversationThreadId: string,
  conversationTurnRef: string | null,
  standardsLookupRef: string | null,
  answerSummary: string | null,
): CreateCapturedDecisionRequestBody {
  return {
    decisionCode: entry.code,
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: serialiseAnswer(answerValue),
    answerSummary,
    standardsLookupRef,
    conversationThreadId,
    conversationTurnRef,
    createdByTask: ARCHITECT_CONVERSATION_TASK_NAME,
  };
}

function buildRequestBodyForCascade(
  proposal: PendingCascadeProposal,
  conversationThreadId: string,
  conversationTurnRef: string,
  overrideValue: unknown | undefined,
  overrideReason: string | null,
): CreateCapturedDecisionRequestBody {
  // The cascade's `decisionCode` is the LIBRARY DOWNSTREAM code (e.g.
  // `service.runtime`). The row is architecture-scoped — cascades never pin
  // per-element exceptions in v1 (the UX path for per-element exceptions is
  // the dedicated exception sub-dialog).
  return {
    decisionCode: proposal.decisionCode,
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: serialiseAnswer(
      overrideValue !== undefined ? overrideValue : proposal.proposedValue,
    ),
    answerSummary: overrideReason,
    standardsLookupRef: proposal.sourceStandardId,
    conversationThreadId,
    conversationTurnRef,
    createdByTask: ARCHITECT_CONVERSATION_TASK_NAME,
  };
}

function buildRequestBodyForElementScope(
  entry: QuestionLibraryEntry,
  scope: Extract<DecisionScope, { kind: 'element' }>,
  answerValue: unknown,
  conversationThreadId: string,
): CreateCapturedDecisionRequestBody {
  return {
    decisionCode: entry.code,
    scopeKind: 'element',
    scopeRefType: scope.refType,
    scopeRefId: scope.refId,
    answerValue: serialiseAnswer(answerValue),
    answerSummary: null,
    standardsLookupRef: null,
    conversationThreadId,
    conversationTurnRef: null,
    createdByTask: ARCHITECT_CONVERSATION_TASK_NAME,
  };
}

/**
 * Coerce a typed answer into the string column on the captured-decision row.
 * Multi-choice arrays are JSON-stringified to preserve order; primitive types
 * pass through `String(...)`. Structured payloads are JSON-stringified.
 *
 * The AMS DTO's `answerValue` column is `text NOT NULL`, so we MUST hand a
 * non-null, non-empty string.
 */
function serialiseAnswer(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Error turn builder
// ---------------------------------------------------------------------------

function buildErrorTurnFromWriteFailure(err: unknown): ErrorTurn {
  if (err instanceof CapturedDecisionsWriteError) {
    return {
      kind: 'error',
      errorKind: 'decision-capture-failed',
      errorMessage: err.message,
      recoverableHint:
        err.status >= 500
          ? 'Architecture model service is unavailable. Retry the answer to write the decision.'
          : 'Captured-decision write rejected by the architecture model service. Inspect the request and retry.',
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    kind: 'error',
    errorKind: 'decision-capture-failed',
    errorMessage: `Unexpected error while writing the captured decision: ${message}`,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator class
// ---------------------------------------------------------------------------

export class DecisionCaptureOrchestrator {
  constructor(private readonly deps: DecisionCaptureDeps = defaultDecisionCaptureDeps) {}

  // -------------------------------------------------------------------------
  // PRIMARY ANSWER
  // -------------------------------------------------------------------------

  /**
   * Capture the primary answer to a library entry. Writes one row via Spec 2,
   * appends a `decision-captured` turn, and (when the entry declares
   * cascades) appends a `cascade-summary` turn carrying the proposals.
   *
   * The cascade-summary is the UX gate point: the orchestrator does NOT
   * write the cascade rows until the caller invokes `acceptCascadeBatch` or
   * `overrideCascade`.
   *
   * Throws `CapturedDecisionsWriteError` if the primary POST fails. The caller
   * should translate the throw into an `error` turn via `buildErrorTurnFromWriteFailure`
   * — exposed via `tryAppendErrorTurn` below for one-stop error handling.
   */
  async capturePrimaryAnswer(args: CapturePrimaryAnswerArgs): Promise<CapturePrimaryAnswerOutcome> {
    const body = buildRequestBodyForArchitectureScope(
      args.entry,
      args.answerValue,
      args.conversationThreadId,
      null,
      null,
      null,
    );

    const decision = await this.deps.postCapturedDecision(
      args.projectId,
      args.targetArchitectureId,
      body,
    );

    const scope: DecisionScope = { kind: 'architecture' };
    const decisionCapturedTurn = buildDecisionCapturedTurn(decision, scope);
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      decisionCapturedTurn,
    );

    const pendingCascadeProposals = computeCascadeProposals(args.entry, args.answerValue);
    let cascadeSummaryTurn: CascadeSummaryTurn | null = null;
    if (pendingCascadeProposals.length > 0) {
      const summaryEntries: CascadeSummaryEntry[] = pendingCascadeProposals.map((p) => ({
        decisionCode: p.decisionCode,
        proposedValue: p.proposedValue,
        sourceStandardId: p.sourceStandardId,
      }));
      cascadeSummaryTurn = {
        kind: 'cascade-summary',
        cascadedDecisions: summaryEntries,
      };
      await this.deps.appendTurn(
        args.projectId,
        args.targetArchitectureId,
        cascadeSummaryTurn,
      );
    }

    return {
      decision,
      decisionCapturedTurn,
      cascadeSummaryTurn,
      pendingCascadeProposals,
    };
  }

  // -------------------------------------------------------------------------
  // CASCADE ACCEPT-BATCH (per Q10)
  // -------------------------------------------------------------------------

  /**
   * Accept every cascade in the supplied batch. Writes N sequential POSTs, all
   * carrying the SAME `conversationTurnRef` value so the transcript surface
   * can attribute the batch to a single triggering answer (per Q10).
   *
   * Each row records the cascade's `sourceStandardId` in `standardsLookupRef`
   * for audit continuity (per Q9 — the value is the inline seed id; Spec 5
   * will swap this for a runtime lookup later without changing the contract).
   */
  async acceptCascadeBatch(args: AcceptCascadeBatchArgs): Promise<AcceptCascadeBatchOutcome> {
    const sharedConversationTurnRef = this.deps.newId();
    const decisions: TargetStateCapturedDecision[] = [];
    const decisionCapturedTurns: DecisionCapturedTurn[] = [];

    for (const proposal of args.proposals) {
      const body = buildRequestBodyForCascade(
        proposal,
        args.conversationThreadId,
        sharedConversationTurnRef,
        undefined,
        null,
      );
      const decision = await this.deps.postCapturedDecision(
        args.projectId,
        args.targetArchitectureId,
        body,
      );
      decisions.push(decision);
      const turn = buildDecisionCapturedTurn(decision, { kind: 'architecture' });
      decisionCapturedTurns.push(turn);
      await this.deps.appendTurn(args.projectId, args.targetArchitectureId, turn);
    }

    const cascadeAcceptedTurn: CascadeAcceptedTurn = {
      kind: 'cascade-accepted',
      cascadedDecisions: decisions.map(
        (d): CascadeAcceptedEntry => ({
          decisionCode: d.decisionCode,
          answerValue: d.answerValue,
          wasOverridden: false,
        }),
      ),
    };
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      cascadeAcceptedTurn,
    );

    return {
      decisions,
      decisionCapturedTurns,
      cascadeAcceptedTurn,
      sharedConversationTurnRef,
    };
  }

  // -------------------------------------------------------------------------
  // CASCADE OVERRIDE (per-cascade — the user said "yes to the others but not this one")
  // -------------------------------------------------------------------------

  /**
   * Override a single cascade with a different value + reason. Writes one row
   * (`wasOverridden: true`) plus the corresponding `decision-captured` and
   * `cascade-overridden` turns.
   *
   * The override row still records the cascade's `sourceStandardId` for audit
   * continuity — the architect overrode the recommendation but the
   * provenance of "what we proposed and why" remains intact.
   */
  async overrideCascade(args: OverrideCascadeArgs): Promise<OverrideCascadeOutcome> {
    const body = buildRequestBodyForCascade(
      args.proposal,
      args.conversationThreadId,
      this.deps.newId(),
      args.overrideValue,
      args.overrideReason,
    );

    const decision = await this.deps.postCapturedDecision(
      args.projectId,
      args.targetArchitectureId,
      body,
    );
    const decisionCapturedTurn = buildDecisionCapturedTurn(decision, { kind: 'architecture' });
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      decisionCapturedTurn,
    );

    const cascadeOverriddenTurn: CascadeOverriddenTurn = {
      kind: 'cascade-overridden',
      cascadedDecisions: [
        {
          decisionCode: decision.decisionCode,
          answerValue: decision.answerValue,
          wasOverridden: true,
          overrideReason: args.overrideReason,
        } as CascadeOverriddenEntry,
      ],
    };
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      cascadeOverriddenTurn,
    );

    return { decision, decisionCapturedTurn, cascadeOverriddenTurn };
  }

  // -------------------------------------------------------------------------
  // REVISE PRIOR ANSWER (per Q6 — new superseding row + banner payload)
  // -------------------------------------------------------------------------

  /**
   * Revise a prior captured-decision row. Per settled decision #10 the data
   * plane is insert-only — we POST a new row and AMS atomically sets the
   * prior row's `supersededById`. We then build an `edit-superseded` turn
   * carrying the Q6 banner payload (`affectedDownstreamCodes`) so the UI can
   * prompt the architect to re-visit the cascaded decisions that descended
   * from the old answer.
   *
   * No auto-replay (per Q6 + settled decision #14). The banner is review-only.
   */
  async revisePriorAnswer(args: ReviseAnswerArgs): Promise<ReviseAnswerOutcome> {
    const scope: DecisionScope = args.scope ?? { kind: 'architecture' };

    let body: CreateCapturedDecisionRequestBody;
    if (scope.kind === 'element') {
      body = buildRequestBodyForElementScope(
        args.entry,
        scope,
        args.newAnswerValue,
        args.conversationThreadId,
      );
    } else {
      body = buildRequestBodyForArchitectureScope(
        args.entry,
        args.newAnswerValue,
        args.conversationThreadId,
        null,
        null,
        null,
      );
    }

    const decision = await this.deps.postCapturedDecision(
      args.projectId,
      args.targetArchitectureId,
      body,
    );
    const decisionCapturedTurn = buildDecisionCapturedTurn(decision, scope);
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      decisionCapturedTurn,
    );

    const affectedDownstreamCodes = computeAffectedDownstreamCodes(args.entry);
    const editSupersededTurn: EditSupersededTurn = {
      kind: 'edit-superseded',
      originalDecisionId: args.originalDecisionId,
      newDecisionId: decision.decisionId,
      affectedDownstreamCodes,
    };
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      editSupersededTurn,
    );

    return { decision, decisionCapturedTurn, editSupersededTurn };
  }

  // -------------------------------------------------------------------------
  // PIN PER-ELEMENT EXCEPTION (per Q11 — element-scope override)
  // -------------------------------------------------------------------------

  /**
   * Pin a per-element exception. Writes one element-scoped row + the matching
   * `decision-captured` and `exception-pinned` turns.
   *
   * The orchestrator enforces that `scope.refType` is in the entry's
   * `allowedExceptionScopes` (defence-in-depth — the exception sub-dialog
   * also filters its entity picker per Q11). Out-of-set scopes throw before
   * any POST is issued so we never leave a half-written transcript.
   */
  async pinException(args: PinExceptionArgs): Promise<PinExceptionOutcome> {
    if (!args.entry.allowedExceptionScopes.includes(args.scope.refType)) {
      throw new Error(
        `Scope ref type '${args.scope.refType}' is not in allowedExceptionScopes for decision '${args.entry.code}'.`,
      );
    }

    const body = buildRequestBodyForElementScope(
      args.entry,
      args.scope,
      args.answerValue,
      args.conversationThreadId,
    );

    const decision = await this.deps.postCapturedDecision(
      args.projectId,
      args.targetArchitectureId,
      body,
    );
    const decisionCapturedTurn = buildDecisionCapturedTurn(decision, args.scope);
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      decisionCapturedTurn,
    );

    const exceptionPinnedTurn: ExceptionPinnedTurn = {
      kind: 'exception-pinned',
      decisionCode: args.entry.code,
      scope: args.scope,
      answerValue: args.answerValue,
    };
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      exceptionPinnedTurn,
    );

    return { decision, decisionCapturedTurn, exceptionPinnedTurn };
  }

  // -------------------------------------------------------------------------
  // RELEVANCE AUTO-SKIP (per Q7 — silently captures `not_applicable`)
  // -------------------------------------------------------------------------

  /**
   * Evaluate the entry's relevance predicate. When the predicate returns
   * false: POST a `not_applicable` captured-decision row and append a
   * `system-skip` turn — never surface the question to the user.
   *
   * Returns `{ skipped: false }` when the entry is relevant (the caller
   * proceeds to drive the LLM loop normally).
   */
  async maybeAutoSkip(args: AutoSkipArgs): Promise<AutoSkipOutcome> {
    const outcome = evaluateRelevance(args.entry, args.relevanceContext);
    if (outcome.relevant) {
      return { skipped: false };
    }
    const reason = outcome.reason;

    const body = buildRequestBodyForArchitectureScope(
      args.entry,
      NOT_APPLICABLE_ANSWER_VALUE,
      args.conversationThreadId,
      null,
      null,
      reason,
    );

    let decision: TargetStateCapturedDecision;
    try {
      decision = await this.deps.postCapturedDecision(
        args.projectId,
        args.targetArchitectureId,
        body,
      );
    } catch (err) {
      // Auto-skip failure is fatal for THIS question — surface an error turn
      // and bubble the throw up so the caller stops driving the conversation.
      const errorTurn = buildErrorTurnFromWriteFailure(err);
      await this.deps.appendTurn(
        args.projectId,
        args.targetArchitectureId,
        errorTurn,
      );
      throw err;
    }

    const systemSkipTurn: SystemSkipTurn = {
      kind: 'system-skip',
      decisionCode: args.entry.code,
      relevanceReason: reason,
    };
    await this.deps.appendTurn(
      args.projectId,
      args.targetArchitectureId,
      systemSkipTurn,
    );

    logger.debug('architect-conversation auto-skipped a question', {
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      decisionCode: args.entry.code,
      reason,
    });

    return { skipped: true, decision, systemSkipTurn };
  }

  // -------------------------------------------------------------------------
  // ERROR TURN APPEND (shared helper for callers that catch a write failure)
  // -------------------------------------------------------------------------

  /**
   * Append an `error` turn derived from a captured-decisions write failure.
   * The orchestrator method that owned the original POST (e.g.
   * `capturePrimaryAnswer`) is allowed to throw — this helper lets the
   * caller surface the failure in the transcript before re-throwing or
   * recovering.
   */
  async appendErrorTurn(
    projectId: string,
    targetArchitectureId: string,
    err: unknown,
  ): Promise<ErrorTurn> {
    const turn = buildErrorTurnFromWriteFailure(err);
    await this.deps.appendTurn(projectId, targetArchitectureId, turn);
    return turn;
  }
}

// ---------------------------------------------------------------------------
// Convenience singleton + helpers (production usage)
// ---------------------------------------------------------------------------

/**
 * Production-default orchestrator wired to the real Spec 2 helpers. Tests
 * construct their own instance with mocked deps.
 */
export const defaultDecisionCaptureOrchestrator = new DecisionCaptureOrchestrator(
  defaultDecisionCaptureDeps,
);

export { defaultNotApplicableReason };
