/**
 * Conversation Transcript Turn Shape — Target State Architect-Persona Conversation
 * (Spec 3, Commit 3)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Per Q19/Q20 the transcript is a closed union of typed turn payloads (15 kinds
 * as of Spec 2026-06-05-architect-tier-gating, which added `tier-confirmation`;
 * extended to 20 kinds by Spec 2026-06-06-architect-conversation-open-ended-phase,
 * which added the five open-phase turn kinds).
 * The Spec-2 thread store helper (`targetStateConversationStore.ts`) sees only
 * `unknown[]` — this file owns the typed shape and is the single source of
 * truth for downstream readers (the orchestrator, the conversation reader, the
 * frontend).
 *
 * IMPORTANT: This file is type-only. No I/O, no orchestration, no LLM.
 *
 * Persistence: write turns via `appendTurn` from Spec 2's
 * `targetStateConversationStore.ts` verbatim — DO NOT extend that helper's
 * signature (per Q3).
 */

import type { ScopeRefType } from '../../config/architect-conversation/questionLibrary';

// ---------------------------------------------------------------------------
// Closed 20-kind turn union (per Q19; 'tech-stack-prefill-summary' +
// 'tier-confirmation' added by later specs; the five 'open-phase-*' /
// 'free-form-discussion' kinds added by the open-ended-phase spec)
// ---------------------------------------------------------------------------

export type ConversationTurnKind =
  | 'question'
  | 'answer'
  | 'cascade-summary'
  | 'cascade-accepted'
  | 'cascade-overridden'
  | 'decision-captured'
  | 'mapping-mutation-summary'
  | 'exception-pinned'
  | 'edit-superseded'
  | 'system-skip'
  | 'error'
  | 'open'
  | 'close'
  // Spec 2026-05-25 Tech-Stack.md Pre-fill (Task Group 3): a single
  // review-banner-shaped turn appended after the open turn carrying the
  // pre-fill batch outcome (matched count, banner variant, source-file flags).
  | 'tech-stack-prefill-summary'
  // Spec 2026-06-05 Architect Tier-Gating (Half B): the opening confirmation
  // turn carrying the derived + confirmed technology-tier set (UI / Service /
  // Persistence). Surfaced at OPEN, before the first question, so the user can
  // confirm/adjust which question groups are in play. See TierConfirmationTurn.
  | 'tier-confirmation'
  // ---------------------------------------------------------------------------
  // Spec 2026-06-06 Architect Conversation — Open-Ended LLM Phase (S6). The five
  // new durable turn kinds for the open phase that begins STRICTLY after the
  // deterministic preset walk exhausts. All five are appended verbatim via
  // `targetStateConversationStore` so they survive reopen, following the
  // `tier-confirmation` interactive-turn precedent. See the per-kind payloads
  // below the existing turns.
  // ---------------------------------------------------------------------------
  // (1) Architect's "we've covered the standard decisions — are there other
  //     areas you'd like to decide?" prompt + the proactively-suggested grounded
  //     candidate areas (P3). Opens sub-phase (a).
  | 'open-phase-prompt'
  // (2) A topic the USER raised in sub-phase (a) for the LLM to propose options on.
  | 'user-raised-topic'
  // (3) The LLM's concrete option proposal for a user-raised topic — single- or
  //     multi-select per topic (mirroring the preset `single-choice`/`multi-choice`
  //     shapes) + a "something else…" free-text escape marker. NO "Not applicable".
  | 'option-proposal'
  // (4) The user's pick against an `option-proposal` (the selected option(s) or the
  //     free-text "something else…" value) — written downstream as a first-class
  //     `adhoc.<slug>` captured decision.
  | 'user-pick'
  // (5) A single free-form-discussion message in sub-phase (b) — `speaker`
  //     discriminates the user vs the assistant role within the one kind.
  | 'free-form-discussion';

// ---------------------------------------------------------------------------
// Shared payload bits
// ---------------------------------------------------------------------------

/**
 * Decision scope shape carried on `decision-captured` and `exception-pinned`
 * turns. `kind = 'architecture'` for the architecture-wide default (the common
 * case); `kind = 'element'` when the user pinned a per-element exception via
 * the exception sub-dialog. Element scope requires `refType` (one of the
 * Q12 closed set) and `refId`.
 */
export type DecisionScope =
  | { kind: 'architecture' }
  | { kind: 'element'; refType: ScopeRefType; refId: string };

/**
 * The technology-tier flag set carried on the {@link TierConfirmationTurn}
 * (Spec 2026-06-05-architect-tier-gating). Structurally identical to the
 * gateway `RelevanceContext` so the confirmed set threads straight into the
 * sequencer. NOTE: this "tier" is the architectural TECHNOLOGY tier
 * (UI / Service / Persistence) derived from `app_component.tech_type` — it is
 * UNRELATED to `DiscoveryRunDto.tier` (the V3 confidence ladder A/B/C).
 */
export interface TierFlags {
  /** Target has at least one UI-tier component (gates Group E). */
  hasUiTier: boolean;
  /** Target has at least one Service-tier component (gates Groups A/B/D/H). */
  hasServiceTier: boolean;
  /** Target has at least one Persistence-tier component (gates Group C). */
  hasPersistenceTier: boolean;
}

/**
 * Phase signal carried on the `next-question` response (Spec
 * 2026-06-06-architect-conversation-open-ended-phase, S2). There is NO separate
 * phase endpoint — phase availability rides the existing `next-question` wire.
 *
 *   - 'preset-walk'    — `selectNextQuestion` still returns a question; the
 *                        deterministic preset walk is in progress and the open
 *                        phase is NOT yet available.
 *   - 'open-available' — `selectNextQuestion` returned `null` (the walk is
 *                        exhausted); the open phase is now reachable. The whole
 *                        open phase is OPTIONAL — the user may still close
 *                        immediately, exactly as today.
 */
export type ConversationPhase = 'preset-walk' | 'open-available';

// ---------------------------------------------------------------------------
// Per-kind payload extras (per Q20)
// ---------------------------------------------------------------------------

export interface QuestionTurn {
  kind: 'question';
  decisionCode: string;
  /** Fully assembled prompt — `discoveryContextLead` (if any) is already prepended. */
  promptText: string;
  /** 1-based LLM round index this question prompt was sent on (1 for the first round). */
  roundIndex: number;
  /**
   * Optional curated framing paragraph mirrored from the library entry's
   * `staticContextLeadIn` (see `QuestionLibraryEntry.staticContextLeadIn` in
   * `config/architect-conversation/questionLibrary.ts`). Hand-authored per
   * question; surfaced by the frontend above the prompt. Older persisted
   * turns from before this field existed will not carry it — readers must
   * treat it as optional.
   */
  staticContextLeadIn?: string;
}

export interface AnswerTurn {
  kind: 'answer';
  decisionCode: string;
  /** The user's free-text input verbatim — pre-parse, pre-validation. */
  answerText: string;
  /** 1-based LLM round index the user answered against. */
  roundIndex: number;
}

export interface CascadeSummaryEntry {
  decisionCode: string;
  proposedValue: unknown;
  sourceStandardId: string;
}

export interface CascadeSummaryTurn {
  kind: 'cascade-summary';
  cascadedDecisions: CascadeSummaryEntry[];
}

export interface CascadeAcceptedEntry {
  decisionCode: string;
  answerValue: unknown;
  wasOverridden: false;
}

export interface CascadeAcceptedTurn {
  kind: 'cascade-accepted';
  cascadedDecisions: CascadeAcceptedEntry[];
}

export interface CascadeOverriddenEntry {
  decisionCode: string;
  answerValue: unknown;
  wasOverridden: true;
  overrideReason: string;
}

export interface CascadeOverriddenTurn {
  kind: 'cascade-overridden';
  cascadedDecisions: CascadeOverriddenEntry[];
}

export interface DecisionCapturedTurn {
  kind: 'decision-captured';
  decisionId: string;
  decisionCode: string;
  scope: DecisionScope;
  answerValue: unknown;
  /** Pulled from the cascade entry's `sourceStandardId` on cascaded rows; null on the primary answer. */
  standardsLookupRef: string | null;
}

export interface MappingMutationTableSetSummary {
  tableSet: string;
  affectedMappings: number;
  mappingTypeChanges: number;
  notesDecorations: number;
}

export interface MappingMutationSummaryTurn {
  kind: 'mapping-mutation-summary';
  affectedMappings: number;
  mappingTypeChanges: number;
  notesDecorations: number;
  tableSetSummary: MappingMutationTableSetSummary[];
}

export interface ExceptionPinnedTurn {
  kind: 'exception-pinned';
  decisionCode: string;
  /** Always element-scoped — that is what "pin an exception" means. */
  scope: Extract<DecisionScope, { kind: 'element' }>;
  answerValue: unknown;
}

export interface EditSupersededTurn {
  kind: 'edit-superseded';
  originalDecisionId: string;
  newDecisionId: string;
  /**
   * Q6 banner payload — the downstream decision codes that may need review now
   * that the user revised an upstream answer. v1 surfaces this list to the
   * user; no auto-replay happens.
   */
  affectedDownstreamCodes: string[];
}

export interface SystemSkipTurn {
  kind: 'system-skip';
  decisionCode: string;
  relevanceReason: string;
}

export type ConversationErrorKind =
  | 'round-budget-exhausted'
  | 'llm-call-timeout'
  | 'wall-clock-exceeded'
  | 'aborted'
  | 'llm-call-failed'
  | 'submit-answer-malformed'
  | 'decision-capture-failed'
  | 'mapping-mutation-failed';

export interface ErrorTurn {
  kind: 'error';
  errorKind: ConversationErrorKind;
  errorMessage: string;
  recoverableHint?: string;
}

export interface OpenTurn {
  kind: 'open';
  sessionId: string;
  openedBy: string;
}

export type CloseReason = 'completed-by-user' | 'retired-by-other-user';

export interface CloseTurn {
  kind: 'close';
  sessionId: string;
  closeReason: CloseReason;
  /**
   * Per Q16 — the full grouped-by-scope summary embedded inline so any later
   * read of the transcript is self-contained (no resolver re-query needed).
   */
  summaryMarkdown: string;
}

/**
 * Banner variant key surfaced by the {@link TechStackPrefillSummaryTurn}.
 *
 *   - 'both-files-matched'         org + project both present, pre-fill ran
 *   - 'organisation-only-matched'  only org file present
 *   - 'project-only-matched'       only project file present
 *   - 'no-standards-found'         neither file present
 *   - 'failure'                    truncation / LLM error / validator error
 */
export type TechStackPrefillBannerVariant =
  | 'both-files-matched'
  | 'organisation-only-matched'
  | 'project-only-matched'
  | 'no-standards-found'
  | 'failure';

/**
 * Banner-shaped turn appended after a fresh `open` turn carrying the
 * tech-stack pre-fill outcome.
 *
 * Source-quote text is deliberately NOT included on this turn payload — the
 * SummaryPanel review surface reads the quote from the captured-decision row's
 * `answer_value` JSON. Keeping the quote off the transcript turn enforces the
 * spec's isolation rule (per Q22): source quotes never appear in the main
 * transcript pane.
 */
export interface TechStackPrefillSummaryTurn {
  kind: 'tech-stack-prefill-summary';
  /** The five-variant banner key the frontend keys off. */
  bannerVariant: TechStackPrefillBannerVariant;
  /** Number of captured-decision rows successfully written from pre-fill. */
  matchedCount: number;
  /** Static library entry count (51 in v1, per Q12 of the requirements). */
  denominator: number;
  /** Whether the organisation file was present (regardless of pre-fill outcome). */
  orgFilePresent: boolean;
  /** Whether the project file was present (regardless of pre-fill outcome). */
  projectFilePresent: boolean;
  /** Resolved absolute path of the org file if present (informational). */
  orgFilePath: string | null;
  /** Resolved absolute path of the project file if present (informational). */
  projectFilePath: string | null;
  /** When the pre-fill ran but failed on at least one row write — failed codes list. */
  partialFailureCodes: string[];
  /** Failure-variant detail (truncation reason, LLM error message, validator errors). */
  failureReason: string | null;
}

/**
 * Opening tier-confirmation turn (Spec 2026-06-05-architect-tier-gating, Half B).
 *
 * Appended at conversation OPEN, immediately after the `open` turn and BEFORE
 * the first question is fetched (parallel to the Discovery Review Room's
 * `open`-turn pattern). Carries:
 *
 *   - `derivedTiers`   — the DEFAULT technology-tier set the frontend derived
 *                        from the target model's `app_component.tech_type`
 *                        (via `deriveServiceTier`). Self-contained on the turn
 *                        so a later read shows what was originally detected.
 *   - `confirmedTiers` — the set actually in play for this session (the user
 *                        may have toggled a tier on/off in the confirmation
 *                        UI). At open these equal `derivedTiers`; after the
 *                        user adjusts they may differ. The sequencer gates on
 *                        the confirmed set.
 *
 * IN-SESSION ONLY (Decision 1): the set is ephemeral — no durable
 * captured-decision row. Re-deriving on reopen is idempotent.
 */
export interface TierConfirmationTurn {
  kind: 'tier-confirmation';
  derivedTiers: TierFlags;
  confirmedTiers: TierFlags;
}

// ---------------------------------------------------------------------------
// Open-phase turn payloads (Spec 2026-06-06-architect-conversation-open-ended-phase,
// S6). These five interactive in-transcript turns model the open phase that
// begins STRICTLY after the deterministic preset walk exhausts. The
// `tier-confirmation` turn above is the precedent: a typed payload + a dedicated
// frontend renderer + verbatim append to the durable transcript.
// ---------------------------------------------------------------------------

/**
 * A single proactively-suggested candidate area the architect floats at the
 * open-phase prompt (P3). Grounded in the migration (discovery findings when
 * available + captured decisions so far + target-model summary + migration
 * goal/product summary — assembled in Task Group 2). `label` is the short,
 * user-facing area name (e.g. "Batch processing strategy"); `rationale` is the
 * optional one-line reason it is relevant to THIS system.
 */
export interface SuggestedCandidateArea {
  /** Short user-facing area label (e.g. "Batch processing strategy"). */
  label: string;
  /** Optional one-line reason this area is relevant to the actual system. */
  rationale?: string;
}

/**
 * (1) Open-phase prompt turn — the architect's "we've covered the standard
 * decisions — are there other areas you'd like to decide?" message plus the
 * proactively-suggested grounded candidate areas (P3). Opens sub-phase (a).
 * Appended once when the open phase begins; the suggested areas are advisory
 * (the user may raise any topic, not just a suggested one).
 */
export interface OpenPhasePromptTurn {
  kind: 'open-phase-prompt';
  /** The architect's free-text "other areas?" opener. */
  promptText: string;
  /** A few proactively-suggested grounded candidate areas (may be empty). */
  suggestedAreas: SuggestedCandidateArea[];
}

/**
 * (2) User-raised-topic turn — a topic the USER raised in sub-phase (a) for the
 * LLM to propose options on. `topicLabel` is the user-facing topic name the
 * `adhoc.<slug>` decision code is later derived from; `topicText` is the user's
 * verbatim phrasing when it differs from the label.
 */
export interface UserRaisedTopicTurn {
  kind: 'user-raised-topic';
  /** User-facing topic label (the basis for the later `adhoc.<slug>` code). */
  topicLabel: string;
  /** The user's verbatim phrasing of the topic, when distinct from the label. */
  topicText?: string;
}

/**
 * A single concrete option the LLM proposes for a user-raised topic. Mirrors a
 * preset library choice: `value` is the canonical answer value persisted on the
 * captured decision; `label` is the optional friendlier display text.
 */
export interface ProposedOption {
  /** Canonical option value (persisted verbatim as the decision answer). */
  value: string;
  /** Optional friendlier display label (defaults to `value`). */
  label?: string;
}

/**
 * (3) LLM option-proposal turn — the LLM's concrete options for a user-raised
 * topic. The LLM chooses single-select vs multi-select PER TOPIC via
 * `selectionMode`, mirroring the preset `single-choice`/`multi-choice` shapes.
 * There is ALWAYS a "something else…" free-text escape (`allowFreeTextEscape`,
 * captured verbatim as the answer) and explicitly NEVER a "Not applicable"
 * option (P4 — the universal opt-out stays ONLY on the preset questions).
 */
export interface OptionProposalTurn {
  kind: 'option-proposal';
  /** The topic these options are for (links back to the `user-raised-topic` turn). */
  topicLabel: string;
  /**
   * Per-topic select mode. `single` mirrors the preset `single-choice`;
   * `multi` mirrors the preset `multi-choice`. Chosen by the LLM per topic (S4).
   */
  selectionMode: 'single' | 'multi';
  /** The concrete options the LLM proposed. */
  options: ProposedOption[];
  /**
   * Whether a "something else…" free-text escape is offered (captured verbatim
   * as the decision answer). Always true for user-raised topics (S4); modelled
   * explicitly so the renderer is data-driven.
   */
  allowFreeTextEscape: boolean;
  /** Optional friendly label for the free-text escape ("Something else…"). */
  freeTextEscapeLabel?: string;
}

/**
 * (4) User pick turn — the user's pick against an {@link OptionProposalTurn}.
 * For a `single` proposal `selectedValues` holds one entry; for a `multi`
 * proposal it holds the selected set. When the user took the "something else…"
 * escape, `freeTextValue` carries the verbatim text and `selectedValues` is
 * empty. The pick is written downstream as a first-class `adhoc.<slug>`
 * captured decision (the write itself is Task Group 4).
 */
export interface UserPickTurn {
  kind: 'user-pick';
  /** The topic this pick answers (links back to the proposal). */
  topicLabel: string;
  /** The generated `adhoc.<slug>` decision code the pick is persisted under. */
  decisionCode: string;
  /** The selected option value(s); empty when the free-text escape was taken. */
  selectedValues: string[];
  /** The verbatim "something else…" free-text value, when the escape was taken. */
  freeTextValue?: string;
}

/**
 * (5) Free-form-discussion turn — a single message in the sub-phase (b)
 * multi-turn free-form chat. `speaker` discriminates the user vs the assistant
 * role within the one kind (both roles are modelled as this kind, mirroring an
 * ordinary chat transcript). The end-of-(b) per-topic note SUMMARISATION is
 * persisted separately as `note.<slug>` captured-decision rows (Task Group 4),
 * NOT on this turn.
 */
export interface FreeFormDiscussionTurn {
  kind: 'free-form-discussion';
  /** Which side spoke this message. */
  speaker: 'user' | 'assistant';
  /** The message text verbatim. */
  messageText: string;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type ConversationTurn =
  | QuestionTurn
  | AnswerTurn
  | CascadeSummaryTurn
  | CascadeAcceptedTurn
  | CascadeOverriddenTurn
  | DecisionCapturedTurn
  | MappingMutationSummaryTurn
  | ExceptionPinnedTurn
  | EditSupersededTurn
  | SystemSkipTurn
  | ErrorTurn
  | OpenTurn
  | CloseTurn
  | TechStackPrefillSummaryTurn
  | TierConfirmationTurn
  | OpenPhasePromptTurn
  | UserRaisedTopicTurn
  | OptionProposalTurn
  | UserPickTurn
  | FreeFormDiscussionTurn;

/**
 * Exhaustiveness helper for switch statements walking the turn union — keeps
 * the closed 20-kind union honest at type-check time. Any consumer `switch`
 * that ends in `default: assertExhaustiveTurnKind(turn.kind)` fails to compile
 * the moment a new union member is added but not handled (the argument is no
 * longer narrowed to `never`).
 */
export function assertExhaustiveTurnKind(k: never): never {
  throw new Error(`Unexpected conversation turn kind: ${String(k)}`);
}
