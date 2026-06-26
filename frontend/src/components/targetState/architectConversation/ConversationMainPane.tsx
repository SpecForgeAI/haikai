/**
 * ConversationMainPane
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5
 *
 * The chat-style central pane:
 *
 *   - Left rail: LLM messages (question prompts with `discoveryContextLead`
 *     prepended, cascade summaries, mutation summaries).
 *   - Right rail: user responses + structured-answer chips ("accept default",
 *     "no change", free-text input).
 *   - Per-question "Set exception for..." button opening the exception
 *     sub-dialog (Surface 5; the parent owns the dialog state).
 *   - Cascade-summary turn shows accept-all + per-cascade override controls
 *     (Surface 4; rendered via <CascadeSummaryControls />).
 *   - 60-second per-turn frontend timeout per Q18; "Thinking..." spinner.
 *   - Renders the turn kinds per their typed payload (turnShape.ts), incl. the
 *     2026-06-05 `tier-confirmation` opening turn (confirm/adjust the technology
 *     tiers in play before the first question — IN-SESSION ONLY).
 *   - 2026-06-06 Open-Ended LLM Phase: renders the five open-phase turn kinds
 *     (open-phase-prompt / user-raised-topic / option-proposal / user-pick /
 *     free-form-discussion) in the `TurnView` switch, the interactive
 *     option-pick UI (NO "Not applicable" opt-out for user-raised options;
 *     a "something else…" free-text escape; single/multi per `selectionMode`),
 *     a free-form chat input, and the explicit "Done with decisions" /
 *     "Done / Close" transition controls (driven by the parent via `openPhase`).
 */

import { useEffect, useState } from 'react';
import {
  OPT_OUT_ANSWER_VALUE,
  type CascadeSummaryEntry,
  type CascadeSummaryTurn,
  type ConversationTurn,
  type OptionProposalTurn,
  type PendingQuestion,
  type TierConfirmationTurn,
  type TierFlags,
} from '../../../api/architectConversationApi';
import { CascadeSummaryControls } from './CascadeSummaryControls';
import { VersionedAnswerControl } from './VersionedAnswerControl';
import { isVersionedCode, buildFrameworkVersionCaptureValue } from './versionControlConfig';
import { resolveFrameworkVersionChip, resolveCapturedAnswerLabel, type FrameworkVersion } from '../../../api/architectConversationApi';
import styles from './ArchitectConversation.module.css';

/**
 * 2026-06-06 Open-Ended LLM Phase: the open-phase surface state + callbacks the
 * parent (`ArchitectConversationTab`) threads in. When `active` is true the
 * preset walk has exhausted (`phase === 'open-available'`) and the user has
 * engaged the open phase; the pane renders the sub-phase (a)/(b) controls. The
 * whole phase is OPTIONAL — when the parent leaves `openPhase` undefined the
 * pane behaves exactly as before (post-walk input-bar-hidden close state).
 */
export interface OpenPhasePaneState {
  /** True once the user has engaged the open phase (post-walk). */
  active: boolean;
  /** Which sub-phase the user is in: (a) decisions, (b) free-form discussion. */
  subPhase: 'decisions' | 'discussion';
  /** True while any open-phase call (raise/pick/discuss/summarise) is in flight. */
  busy: boolean;
  /** Last open-phase error message (null when clear). */
  error: string | null;
  /** Sub-phase (a): the user raised a topic by label (+ optional verbatim text). */
  onRaiseTopic: (topicLabel: string, topicText?: string) => Promise<void> | void;
  /**
   * Sub-phase (a): the user picked option(s) / typed a "something else…" answer
   * against an option-proposal. Exactly one of `selectedValues`/`freeTextValue`
   * is populated. Writes a first-class `adhoc.<slug>` decision (parent owns it).
   */
  onPickOption: (
    topicLabel: string,
    selectedValues: string[] | undefined,
    freeTextValue: string | undefined,
  ) => Promise<void> | void;
  /** Sub-phase (b): one round of the free-form chat. */
  onDiscuss: (userMessage: string) => Promise<void> | void;
  /** Explicit "Done with decisions": ends sub-phase (a) → (b). Never inferred. */
  onDoneWithDecisions: () => void;
  /** Explicit "Done / Close": ends sub-phase (b) → the existing close. (b) is skippable. */
  onDoneAndClose: () => void;
}

export interface ConversationMainPaneProps {
  turns: ConversationTurn[];
  /**
   * The question currently awaiting an answer — its fixed library prompt is
   * rendered above the input bar and its decisionCode drives submit + the
   * exception button. Null when the walk is complete (or no open session).
   */
  pendingQuestion: PendingQuestion | null;
  /**
   * Last cascade-summary turn awaiting user resolution. When non-null the
   * input is gated behind cascade resolution.
   */
  pendingCascadeSummary: { turn: CascadeSummaryTurn; parentDecisionId: string } | null;
  cascadeBusy: boolean;
  cascadeError: string | null;
  /** Whether the answer call is in flight. */
  answerBusy: boolean;
  answerError: string | null;
  /**
   * Deterministic capture (2026-06-01): the user clicked an option, typed a
   * custom value, or opted out. `value` is the exact value to record (a string,
   * or a string[] for multi-choice); `answerText` is the display label.
   */
  onCaptureAnswer: (
    decisionCode: string,
    value: string | string[],
    answerText?: string,
  ) => Promise<void> | void;
  onAcceptCascadeAll: (proposals: CascadeSummaryEntry[]) => Promise<void> | void;
  onOverrideCascade: (
    proposal: CascadeSummaryEntry,
    overrideValue: string,
    reason: string,
  ) => Promise<void> | void;
  onCascadeRetry?: () => void;
  onOpenExceptionDialog?: (decisionCode: string) => void;
  onAnswerRetry?: () => void;
  /**
   * Spec 2026-06-05-architect-tier-gating (Half B): the in-session confirmed
   * technology-tier set the parent tab holds. When present it seeds the
   * tier-confirmation turn's toggles so the controls reflect the live confirmed
   * state across re-renders (the turn payload's `confirmedTiers` is only the
   * server-seeded default at open). Null until the tab derives it.
   */
  confirmedTiers?: TierFlags | null;
  /**
   * Spec 2026-06-05-architect-tier-gating (Half B): invoked when the user
   * confirms/adjusts the tier-confirmation turn. The parent threads the chosen
   * set into every subsequent `next-question` call. IN-SESSION ONLY — no
   * persistence, no captured-decision row (Decision 1).
   */
  onConfirmTiers?: (tiers: TierFlags) => void;
  /**
   * Spec 2026-05-26 Compare View Decoration: when set, the pane scrolls the
   * matching `decision-captured` turn into view via
   * `document.getElementById('conv-turn-decision-' + scrollToDecisionId)`
   * + scrollIntoView. The pane invokes `onScrolledToDecision` after the
   * scroll attempt so the parent can clear the prop and prevent re-trigger
   * on subsequent re-renders. Per Q3 this is a callback-driven path, not
   * URL-hash navigation. Per Q2 the id is keyed by decisionId, not the
   * (unused-in-v1) conversation_turn_ref.
   */
  scrollToDecisionId?: string | null;
  onScrolledToDecision?: () => void;
  /**
   * 2026-06-06 Open-Ended LLM Phase: the open-phase surface state + callbacks.
   * Undefined when the open phase is not engaged (the pane then behaves exactly
   * as before). The parent enters this STRICTLY after the preset walk exhausts.
   */
  openPhase?: OpenPhasePaneState;
  /**
   * Spec 4 (2026-06-24-vulnerability-reduction-and-steering, Task Group 6): a
   * stable render slot for the inline NON-BLOCKING vulnerability nudge on the
   * versioned-selection control. The parent supplies a node (typically a
   * <VulnerabilityNudge>) scoped to the current versioned question; it is
   * forwarded VERBATIM to VersionedAnswerControl's reserved `nudgeSlot` and
   * rendered above the version input. The pane implements NO Spec 4 compute — it
   * only threads the slot. Receives the current framework + version so the host
   * can scope the nudge. Undefined => no nudge (the control renders as before).
   */
  versionedNudgeSlot?: (ctx: { decisionCode: string; framework: string | null; version: string }) => React.ReactNode;
}

/**
 * Auto-select-recommended-version preference (Spec 2026-06-26, FR3). Sticky per
 * machine in localStorage; defaults ON the first time. Drives the versioned
 * answer control: ON => a framework-chip click commits the stem + its curated
 * default version in ONE action; OFF => the two-step editable version field.
 * localStorage ONLY -- no backend (Q3).
 */
const AUTO_SELECT_VERSION_STORAGE_KEY =
  'architect-conversation.autoSelectRecommendedVersion';

function readAutoSelectVersionPref(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTO_SELECT_VERSION_STORAGE_KEY);
    // Default ON the first time (no stored value yet).
    return raw === null ? true : raw !== 'false';
  } catch {
    return true;
  }
}

function writeAutoSelectVersionPref(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_SELECT_VERSION_STORAGE_KEY, String(value));
  } catch {
    // Non-fatal: a blocked/absent localStorage just means the toggle is not
    // sticky this session; the in-session state still drives the control.
  }
}

export function ConversationMainPane({
  turns,
  pendingQuestion,
  pendingCascadeSummary,
  cascadeBusy,
  cascadeError,
  answerBusy,
  answerError,
  onCaptureAnswer,
  onAcceptCascadeAll,
  onOverrideCascade,
  onCascadeRetry,
  onOpenExceptionDialog,
  onAnswerRetry,
  confirmedTiers = null,
  onConfirmTiers,
  scrollToDecisionId = null,
  onScrolledToDecision,
  openPhase,
  versionedNudgeSlot,
}: ConversationMainPaneProps) {
  // Click-to-answer local state (2026-06-01). Reset whenever the pending
  // question changes so each question starts clean.
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // FR3 auto-select toggle (conversation header, right-aligned, sticky in
  // localStorage). Threaded into <VersionedAnswerControl autoSelect>.
  const [autoSelectVersion, setAutoSelectVersion] = useState<boolean>(
    readAutoSelectVersionPref,
  );
  const handleToggleAutoSelectVersion = () => {
    setAutoSelectVersion((prev) => {
      const next = !prev;
      writeAutoSelectVersionPref(next);
      return next;
    });
  };

  const pendingDecisionCode = pendingQuestion?.decisionCode ?? null;
  useEffect(() => {
    setCustomText('');
    setShowCustom(false);
    setMultiSelected([]);
    setShowAdvanced(false);
  }, [pendingDecisionCode]);

  // Spec 2026-05-26: when the parent stashes a scrollToDecisionId we look up
  // the DOM node stamped by the decision-captured turn render path below and
  // scroll it into view. The effect re-runs whenever the id changes (or when
  // the turns list changes -- if the conversation envelope is still loading
  // the matching node may not yet exist; the next turns-update will trigger
  // the effect again and we will retry). After a successful scroll we invoke
  // the clear callback so the same id does not re-trigger on re-render.
  useEffect(() => {
    if (!scrollToDecisionId) return;
    const node = document.getElementById(
      'conv-turn-decision-' + scrollToDecisionId,
    );
    if (!node) {
      // The matching turn may not be in the DOM yet (transcript still
      // loading). Leave the prop set; the parent re-renders when turns
      // arrive, this effect re-runs, and we retry.
      return;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    onScrolledToDecision?.();
  }, [scrollToDecisionId, turns, onScrolledToDecision]);

  const capture = (value: string | string[], answerText?: string) => {
    if (!pendingQuestion) return;
    void onCaptureAnswer(pendingQuestion.decisionCode, value, answerText);
  };

  const handlePickChoice = (choice: string) => capture(choice, choice);

  const toggleMultiChoice = (choice: string) => {
    setMultiSelected((prev) =>
      prev.includes(choice) ? prev.filter((c) => c !== choice) : [...prev, choice],
    );
  };

  const handleSubmitMultiChoice = () => {
    if (multiSelected.length === 0) return;
    capture(multiSelected, multiSelected.join(', '));
  };

  const handleSubmitCustom = () => {
    const trimmed = customText.trim();
    if (!trimmed) return;
    capture(trimmed, trimmed);
    setCustomText('');
    setShowCustom(false);
  };

  const handleOptOut = () => capture(OPT_OUT_ANSWER_VALUE, 'N/A');

  // Derived render flags for the answer area.
  const choices = pendingQuestion?.choices ?? [];
  const hasChoices = choices.length > 0;
  const isMultiChoice = pendingQuestion?.expectedAnswerShape === 'multi-choice';
  // Free-text questions show the text input as the primary control; choice
  // questions reveal it behind "Something else…".
  const showTextInput = !hasChoices || showCustom;

  // Spec 2026-06-24 (FR5): the seven `versioned` codes render the decoupled
  // framework+version control instead of plain chips. The offered `choices`
  // ARE the (Task-Group-4-filtered) framework axis; the version axis is the
  // dedicated control. Submitting captures the structured { framework, version }
  // through the EXISTING capture path (envelope value string + resolved chip),
  // so no gateway change is needed. Every other question renders as today.
  const isVersioned = pendingQuestion ? isVersionedCode(pendingQuestion.decisionCode) : false;
  const handleVersionedSubmit = (value: FrameworkVersion) => {
    if (!pendingQuestion) return;
    void onCaptureAnswer(
      pendingQuestion.decisionCode,
      buildFrameworkVersionCaptureValue(value),
      resolveFrameworkVersionChip(value),
    );
  };

  // 2026-06-06 Open-Ended LLM Phase: when the open phase is engaged the preset
  // input bar is gone (the walk exhausted -> `pendingQuestion` is null) and the
  // pane renders the open-phase bottom controls instead.
  const openPhaseActive = openPhase?.active === true;

  return (
    <div
      className={styles.mainPane}
      data-testid="architect-conversation-main-pane"
    >
      {/* Conversation header (FR3): right-aligned auto-select-recommended-version
          toggle. Default ON, sticky per machine in localStorage. */}
      <div
        data-testid="architect-conversation-pane-header"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '0.4rem 1rem',
          borderBottom: '1px solid #d0d7de',
        }}
      >
        <label
          data-testid="architect-conversation-auto-select-toggle"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.8rem',
            color: '#57606a',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={autoSelectVersion}
            onChange={handleToggleAutoSelectVersion}
            data-testid="architect-conversation-auto-select-toggle-input"
          />
          Auto-select recommended version
        </label>
      </div>
      <div
        className={styles.transcript}
        data-testid="architect-conversation-transcript"
      >
        {turns.length === 0 && (
          <p style={{ color: '#57606a', textAlign: 'center' }}>
            No turns yet. Submit an answer to begin.
          </p>
        )}
        {turns.map((turn, idx) => (
          <TurnView
            key={`${turn.kind}-${idx}`}
            turn={turn}
            parentDecisionIdForCascade={
              pendingCascadeSummary && turn === pendingCascadeSummary.turn
                ? pendingCascadeSummary.parentDecisionId
                : null
            }
            cascadeBusy={cascadeBusy}
            cascadeError={cascadeError}
            onAcceptCascadeAll={onAcceptCascadeAll}
            onOverrideCascade={onOverrideCascade}
            onCascadeRetry={onCascadeRetry}
            confirmedTiers={confirmedTiers}
            onConfirmTiers={onConfirmTiers}
            openPhase={openPhase}
            isLatestTurn={idx === turns.length - 1}
          />
        ))}
      </div>

      {pendingQuestion && !pendingCascadeSummary && (
        <div className={styles.inputBar} data-testid="architect-conversation-input-bar">
          {/* The current question -- fixed library prompt (never LLM-paraphrased)
              with its hand-authored framing line above it. */}
          <div
            className={`${styles.turn} ${styles.turnLlm}`}
            data-testid={`architect-conversation-pending-question-${pendingQuestion.decisionCode}`}
          >
            <div className={styles.turnLabel}>
              Question · {pendingQuestion.decisionCode} · group {pendingQuestion.group}
            </div>
            {pendingQuestion.promptText}
          </div>

          {/* Spec 2026-06-24 (FR5): versioned codes render the decoupled
              framework+version control; all other codes keep the existing
              chips / custom / opt-out answer area below (additive). */}
          {isVersioned ? (
            <VersionedAnswerControl
              decisionCode={pendingQuestion.decisionCode}
              frameworkChoices={choices}
              autoSelect={autoSelectVersion}
              busy={answerBusy}
              onSubmit={handleVersionedSubmit}
              nudgeSlot={
                versionedNudgeSlot
                  ? (ctx) =>
                      versionedNudgeSlot({
                        decisionCode: pendingQuestion.decisionCode,
                        framework: ctx.framework,
                        version: ctx.version,
                      })
                  : undefined
              }
            />
          ) : (
          <>
          {/* Choices -- click to answer (single-choice) or toggle + confirm
              (multi-choice). No option is pre-selected; the user actively picks. */}
          {hasChoices && (
            <>
              {isMultiChoice && (
                <div style={{ fontSize: '0.8rem', color: '#57606a' }}>
                  Select one or more, then confirm.
                </div>
              )}
              <div className={styles.chipRow}>
                {choices.map((choice) => {
                  const selected = isMultiChoice && multiSelected.includes(choice);
                  return (
                    <button
                      key={choice}
                      type="button"
                      className={
                        selected
                          ? `${styles.choiceButton} ${styles.choiceButtonSelected}`
                          : styles.choiceButton
                      }
                      onClick={() =>
                        isMultiChoice ? toggleMultiChoice(choice) : handlePickChoice(choice)
                      }
                      disabled={answerBusy}
                      aria-pressed={isMultiChoice ? selected : undefined}
                      data-testid={`architect-conversation-choice-${choice}`}
                    >
                      {selected ? '✓ ' : ''}
                      {choice}
                    </button>
                  );
                })}
              </div>
              {isMultiChoice && (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={multiSelected.length === 0 || answerBusy}
                  onClick={handleSubmitMultiChoice}
                  data-testid="architect-conversation-choice-submit-multi"
                >
                  {answerBusy ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" /> Saving…
                    </>
                  ) : (
                    `Confirm selection (${multiSelected.length})`
                  )}
                </button>
              )}
            </>
          )}

          {/* Custom value: primary control for free-text questions; revealed by
              "Something else…" for choice questions. */}
          {showTextInput ? (
            <div className={styles.inputRow}>
              <input
                type="text"
                className={styles.inputField}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={hasChoices ? 'Type a custom value…' : 'Type your answer…'}
                disabled={answerBusy}
                data-testid="architect-conversation-custom-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitCustom();
                  }
                }}
              />
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!customText.trim() || answerBusy}
                onClick={handleSubmitCustom}
                data-testid="architect-conversation-custom-submit"
              >
                {answerBusy ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" /> Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setShowCustom(true)}
              disabled={answerBusy}
              data-testid="architect-conversation-something-else"
            >
              Something else…
            </button>
          )}

          {/* Opt-out -- ALWAYS available. A consistent escape so the architect
              can mark ANY technology option not applicable to this migration,
              not just the capability-omission questions. */}
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleOptOut}
            disabled={answerBusy}
            data-testid="architect-conversation-not-needed"
          >
            Not applicable to this migration
          </button>
          </>
          )}

          {/* Advanced -- per-element exception (rarely needed). */}
          {onOpenExceptionDialog && (
            <div>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                data-testid="architect-conversation-advanced-toggle"
              >
                {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
              </button>
              {showAdvanced && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                    marginTop: '0.35rem',
                  }}
                >
                  <small style={{ color: '#57606a' }}>
                    Use this only if one specific service needs a different answer
                    than the rest &mdash; your answer above applies to every service.
                  </small>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => onOpenExceptionDialog(pendingQuestion.decisionCode)}
                    disabled={answerBusy}
                    data-testid="architect-conversation-chip-set-exception"
                  >
                    Differs for a specific service…
                  </button>
                </div>
              )}
            </div>
          )}

          {answerError && (
            <div
              className={`${styles.banner} ${styles.bannerError}`}
              role="alert"
              data-testid="architect-conversation-answer-error"
            >
              {answerError}
              {onAnswerRetry && (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={onAnswerRetry}
                  data-testid="architect-conversation-answer-retry"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2026-06-06 Open-Ended LLM Phase bottom bar. Rendered post-walk once the
          user engages the open phase (NEVER mid-walk — `pendingQuestion` is null
          here because the preset walk exhausted). Sub-phase (a): raise a topic +
          "Done with decisions". Sub-phase (b): free-form chat + "Done / Close".
          The option-pick itself is an interactive transcript turn (no opt-out). */}
      {openPhaseActive && openPhase && !pendingQuestion && !pendingCascadeSummary && (
        <OpenPhaseControls openPhase={openPhase} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenPhaseControls: the 2026-06-06 open-phase bottom bar.
//
// Sub-phase (a) "decisions": a topic-raising input + the explicit
// "Done with decisions" control (ends (a) -> (b); never inferred — S5).
// Sub-phase (b) "discussion": a free-form chat input + the explicit
// "Done / Close" control (ends (b) -> the existing close; (b) is skippable).
// ---------------------------------------------------------------------------

function OpenPhaseControls({ openPhase }: { openPhase: OpenPhasePaneState }) {
  const [topicText, setTopicText] = useState('');
  const [discussText, setDiscussText] = useState('');

  const submitTopic = () => {
    const trimmed = topicText.trim();
    if (!trimmed) return;
    void openPhase.onRaiseTopic(trimmed, trimmed);
    setTopicText('');
  };

  const submitDiscuss = () => {
    const trimmed = discussText.trim();
    if (!trimmed) return;
    void openPhase.onDiscuss(trimmed);
    setDiscussText('');
  };

  return (
    <div
      className={styles.inputBar}
      data-testid="architect-conversation-open-phase-controls"
      data-sub-phase={openPhase.subPhase}
    >
      {openPhase.subPhase === 'decisions' ? (
        <>
          <div style={{ fontSize: '0.8rem', color: '#57606a' }}>
            Raise any other area you would like to decide on. We will turn your
            pick into a captured decision.
          </div>
          <div className={styles.inputRow}>
            <input
              type="text"
              className={styles.inputField}
              value={topicText}
              onChange={(e) => setTopicText(e.target.value)}
              placeholder="e.g. Batch processing strategy…"
              disabled={openPhase.busy}
              data-testid="architect-conversation-open-phase-topic-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitTopic();
                }
              }}
            />
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!topicText.trim() || openPhase.busy}
              onClick={submitTopic}
              data-testid="architect-conversation-open-phase-raise-topic"
            >
              {openPhase.busy ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" /> Thinking…
                </>
              ) : (
                'Raise topic'
              )}
            </button>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={openPhase.onDoneWithDecisions}
            disabled={openPhase.busy}
            data-testid="architect-conversation-open-phase-done-decisions"
          >
            Done with decisions
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: '0.8rem', color: '#57606a' }}>
            Anything else to discuss? We will summarise this into notes for the
            backlog when you close.
          </div>
          <div className={styles.inputRow}>
            <input
              type="text"
              className={styles.inputField}
              value={discussText}
              onChange={(e) => setDiscussText(e.target.value)}
              placeholder="Type a message…"
              disabled={openPhase.busy}
              data-testid="architect-conversation-open-phase-discuss-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitDiscuss();
                }
              }}
            />
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!discussText.trim() || openPhase.busy}
              onClick={submitDiscuss}
              data-testid="architect-conversation-open-phase-discuss-send"
            >
              {openPhase.busy ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" /> Thinking…
                </>
              ) : (
                'Send'
              )}
            </button>
          </div>
          {/* "Done / Close" ends sub-phase (b) and proceeds to the existing
              close. Sub-phase (b) is skippable — the user may click this without
              having typed anything. */}
          <button
            type="button"
            className={styles.primaryButton}
            onClick={openPhase.onDoneAndClose}
            disabled={openPhase.busy}
            data-testid="architect-conversation-open-phase-done-close"
          >
            Done / Close
          </button>
        </>
      )}

      {openPhase.error && (
        <div
          className={`${styles.banner} ${styles.bannerError}`}
          role="alert"
          data-testid="architect-conversation-open-phase-error"
        >
          {openPhase.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TurnView: renders ONE conversation turn per its kind.
// ---------------------------------------------------------------------------

interface TurnViewProps {
  turn: ConversationTurn;
  parentDecisionIdForCascade: string | null;
  cascadeBusy: boolean;
  cascadeError: string | null;
  onAcceptCascadeAll: (proposals: CascadeSummaryEntry[]) => Promise<void> | void;
  onOverrideCascade: (
    proposal: CascadeSummaryEntry,
    overrideValue: string,
    reason: string,
  ) => Promise<void> | void;
  onCascadeRetry?: () => void;
  /** Spec 2026-06-05-architect-tier-gating (Half B): see ConversationMainPaneProps. */
  confirmedTiers?: TierFlags | null;
  onConfirmTiers?: (tiers: TierFlags) => void;
  /** 2026-06-06 Open-Ended LLM Phase: see ConversationMainPaneProps. */
  openPhase?: OpenPhasePaneState;
  /** True when this is the most recent turn (the only actionable option-proposal). */
  isLatestTurn?: boolean;
}

function TurnView({
  turn,
  parentDecisionIdForCascade,
  cascadeBusy,
  cascadeError,
  onAcceptCascadeAll,
  onOverrideCascade,
  onCascadeRetry,
  confirmedTiers,
  onConfirmTiers,
  openPhase,
  isLatestTurn,
}: TurnViewProps) {
  switch (turn.kind) {
    case 'question':
      return (
        <div
          className={`${styles.turn} ${styles.turnLlm}`}
          data-testid={`architect-conversation-turn-question-${turn.decisionCode}`}
        >
          <div className={styles.turnLabel}>
            Question · {turn.decisionCode} · round {turn.roundIndex}
          </div>
          {/*
            Spec 2026-06-26 (FR3): the per-question static context lead-in is
            DROPPED from the on-screen transcript render -- it repeated the
            question text and cluttered the compact layout. The
            `staticContextLeadIn` field stays on the turn shape and in the
            Markdown export for backward-compat.
          */}
          {turn.promptText}
        </div>
      );
    case 'answer':
      return (
        <div
          className={`${styles.turn} ${styles.turnUser}`}
          data-testid={`architect-conversation-turn-answer-${turn.decisionCode}`}
        >
          <div className={styles.turnLabel}>You</div>
          {turn.answerText}
        </div>
      );
    case 'cascade-summary':
      if (parentDecisionIdForCascade) {
        return (
          <CascadeSummaryControls
            turn={turn}
            parentDecisionId={parentDecisionIdForCascade}
            busy={cascadeBusy}
            error={cascadeError}
            onAcceptAll={onAcceptCascadeAll}
            onOverrideOne={onOverrideCascade}
            onRetry={onCascadeRetry}
          />
        );
      }
      return (
        <div
          className={`${styles.turn} ${styles.turnCascadeSummary}`}
          data-testid="architect-conversation-turn-cascade-summary-readonly"
        >
          <div className={styles.turnLabel}>Cascade summary (resolved)</div>
          {turn.cascadedDecisions.map((c) => (
            <div key={c.decisionCode}>
              {c.decisionCode} → {String(c.proposedValue)}
            </div>
          ))}
        </div>
      );
    case 'cascade-accepted':
      return (
        <div
          className={`${styles.turn} ${styles.turnUser}`}
          data-testid="architect-conversation-turn-cascade-accepted"
        >
          <div className={styles.turnLabel}>Cascades accepted</div>
          {turn.cascadedDecisions.map((c) => (
            <div key={c.decisionCode}>
              {c.decisionCode} → {resolveCapturedAnswerLabel(c.answerValue)}
            </div>
          ))}
        </div>
      );
    case 'cascade-overridden':
      return (
        <div
          className={`${styles.turn} ${styles.turnUser}`}
          data-testid="architect-conversation-turn-cascade-overridden"
        >
          <div className={styles.turnLabel}>Cascade overridden</div>
          {turn.cascadedDecisions.map((c) => (
            <div key={c.decisionCode}>
              {c.decisionCode} → {resolveCapturedAnswerLabel(c.answerValue)} ({c.overrideReason})
            </div>
          ))}
        </div>
      );
    case 'decision-captured':
      return (
        <div
          // Spec 2026-05-26 Q2: stable DOM id keyed by decisionId (NOT
          // conversation_turn_ref) so the Compare View chip's "View in
          // conversation" callback can scrollIntoView the matching turn.
          // Only emitted on decision-captured turns; other turn kinds keep
          // their existing render path untouched.
          id={`conv-turn-decision-${turn.decisionId}`}
          className={`${styles.turn} ${styles.turnSystem}`}
          data-testid={`architect-conversation-turn-decision-captured-${turn.decisionCode}`}
        >
          Decision captured: {turn.decisionCode} = {resolveCapturedAnswerLabel(turn.answerValue)}
        </div>
      );
    case 'mapping-mutation-summary':
      return (
        <div
          className={`${styles.turn} ${styles.turnMutationSummary}`}
          data-testid="architect-conversation-turn-mutation-summary"
        >
          <div className={styles.turnLabel}>Mapping mutation summary</div>
          Affected mappings: {turn.affectedMappings}. Type changes:{' '}
          {turn.mappingTypeChanges}. Notes decorations: {turn.notesDecorations}.
        </div>
      );
    case 'exception-pinned':
      return (
        <div
          className={`${styles.turn} ${styles.turnSystem}`}
          data-testid={`architect-conversation-turn-exception-pinned-${turn.decisionCode}`}
        >
          Exception pinned: {turn.decisionCode} on {turn.scope.refType}{' '}
          {turn.scope.refId} = {resolveCapturedAnswerLabel(turn.answerValue)}
        </div>
      );
    case 'edit-superseded':
      return (
        <div
          className={`${styles.turn} ${styles.turnSystem}`}
          data-testid="architect-conversation-turn-edit-superseded"
        >
          Decision revised. New id: {turn.newDecisionId}. Downstream codes:{' '}
          {turn.affectedDownstreamCodes.join(', ') || '(none)'}.
        </div>
      );
    case 'system-skip':
      return (
        <div
          className={`${styles.turn} ${styles.turnSystem}`}
          data-testid={`architect-conversation-turn-system-skip-${turn.decisionCode}`}
        >
          Auto-skipped {turn.decisionCode}: {turn.relevanceReason}
        </div>
      );
    case 'error':
      return (
        <div
          className={`${styles.turn} ${styles.turnError}`}
          role="alert"
          data-testid={`architect-conversation-turn-error-${turn.errorKind}`}
        >
          <div className={styles.turnLabel}>Error · {turn.errorKind}</div>
          {turn.errorMessage}
          {turn.recoverableHint && (
            <p style={{ marginTop: '0.5rem' }}>{turn.recoverableHint}</p>
          )}
        </div>
      );
    case 'open':
      return (
        <div
          className={`${styles.turn} ${styles.turnSystem}`}
          data-testid="architect-conversation-turn-open"
        >
          Session opened by {turn.openedBy}
        </div>
      );
    case 'close':
      return (
        <div
          className={`${styles.turn} ${styles.turnSystem}`}
          data-testid="architect-conversation-turn-close"
          data-close-reason={turn.closeReason}
        >
          <div className={styles.turnLabel}>
            Session closed · {turn.closeReason}
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: '0.85rem',
              margin: 0,
            }}
          >
            {turn.summaryMarkdown}
          </pre>
        </div>
      );
    case 'tech-stack-prefill-summary':
      // 2026-05-25 Tech-Stack.md Pre-fill (Task Group 5): the banner for this
      // turn is rendered at the top of the tab (peer to the transcript pane)
      // by <TechStackPrefillBanner />. Source-quote text MUST NOT appear in
      // the main transcript pane (per Q22 isolation rule) -- the quote lives
      // exclusively on the captured-decision rows surfaced by SummaryPanel.
      // We render nothing here so the transcript stays clear of pre-fill
      // payload data.
      return null;
    case 'tier-confirmation':
      // 2026-06-05 Architect Tier-Gating (Half B, Task Group 4): the opening
      // confirm/adjust turn. Toggles seed from the live in-session
      // `confirmedTiers` (held by the tab) when present, else the turn payload's
      // server-seeded default. Confirming threads the chosen set into every
      // subsequent next-question call. IN-SESSION ONLY (Decision 1).
      return (
        <TierConfirmationView
          turn={turn}
          confirmedTiers={confirmedTiers ?? null}
          onConfirmTiers={onConfirmTiers}
        />
      );
    // -----------------------------------------------------------------------
    // 2026-06-06 Open-Ended LLM Phase (S6): the five open-phase turn kinds.
    // The interactive option-proposal turn follows the `TierConfirmationView`
    // precedent (turn payload + dedicated interactive renderer). The other
    // four are read-back transcript turns reusing the existing turn styling.
    // -----------------------------------------------------------------------
    case 'open-phase-prompt':
      return (
        <div
          className={`${styles.turn} ${styles.turnLlm}`}
          data-testid="architect-conversation-turn-open-phase-prompt"
          style={{ maxWidth: '100%', alignSelf: 'stretch' }}
        >
          <div className={styles.turnLabel}>Other areas to decide?</div>
          <p style={{ margin: '0 0 0.5rem' }}>{turn.promptText}</p>
          {turn.suggestedAreas.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {turn.suggestedAreas.map((area, i) => (
                <li
                  key={`${area.label}-${i}`}
                  data-testid="architect-conversation-suggested-area"
                >
                  <strong>{area.label}</strong>
                  {area.rationale ? ` — ${area.rationale}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case 'user-raised-topic':
      return (
        <div
          className={`${styles.turn} ${styles.turnUser}`}
          data-testid="architect-conversation-turn-user-raised-topic"
        >
          <div className={styles.turnLabel}>You raised</div>
          {turn.topicText && turn.topicText !== turn.topicLabel
            ? turn.topicText
            : turn.topicLabel}
        </div>
      );
    case 'option-proposal':
      // Interactive: pickable options WITHOUT the "Not applicable" opt-out
      // (P4 — suppressed for user-raised topics), a "something else…" free-text
      // escape, single/multi per `selectionMode`. Only the LATEST turn is
      // actionable; older proposals render read-only so the transcript stays
      // honest. Driven by the parent via `openPhase.onPickOption`.
      return (
        <OptionProposalView
          turn={turn}
          actionable={isLatestTurn === true && openPhase?.active === true}
          busy={openPhase?.busy === true}
          onPick={
            openPhase
              ? (selected, freeText) =>
                  openPhase.onPickOption(turn.topicLabel, selected, freeText)
              : undefined
          }
        />
      );
    case 'user-pick':
      return (
        <div
          className={`${styles.turn} ${styles.turnUser}`}
          data-testid="architect-conversation-turn-user-pick"
        >
          <div className={styles.turnLabel}>Your pick · {turn.topicLabel}</div>
          {turn.freeTextValue && turn.freeTextValue.length > 0
            ? turn.freeTextValue
            : turn.selectedValues.join(', ')}
        </div>
      );
    case 'free-form-discussion':
      return (
        <div
          className={`${styles.turn} ${
            turn.speaker === 'assistant' ? styles.turnLlm : styles.turnUser
          }`}
          data-testid={`architect-conversation-turn-free-form-${turn.speaker}`}
        >
          <div className={styles.turnLabel}>
            {turn.speaker === 'assistant' ? 'Architect' : 'You'}
          </div>
          {turn.messageText}
        </div>
      );
    default:
      // Exhaustiveness guard -- if a future spec adds a new turn kind, TS
      // will error on the unsafe `as never` widening below at compile time.
      return null as never;
  }
}

// ---------------------------------------------------------------------------
// OptionProposalView: the 2026-06-06 interactive option-pick turn.
//
// Renders the LLM-proposed options for a user-raised topic. CRITICALLY there is
// NO "Not applicable to this migration" opt-out here (P4 — the universal opt-out
// stays ONLY on the preset questions); the only escape is the verbatim
// "something else…" free-text input. Single-select picks on click; multi-select
// toggles then confirms. Older (non-latest) proposals render read-only.
// ---------------------------------------------------------------------------

interface OptionProposalViewProps {
  turn: OptionProposalTurn;
  actionable: boolean;
  busy: boolean;
  onPick?: (
    selectedValues: string[] | undefined,
    freeTextValue: string | undefined,
  ) => Promise<void> | void;
}

function OptionProposalView({ turn, actionable, busy, onPick }: OptionProposalViewProps) {
  const isMulti = turn.selectionMode === 'multi';
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [showFreeText, setShowFreeText] = useState(false);
  const [freeText, setFreeText] = useState('');

  const toggleMulti = (value: string) =>
    setMultiSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );

  const pickSingle = (value: string) => {
    if (!onPick) return;
    void onPick([value], undefined);
  };

  const submitMulti = () => {
    if (!onPick || multiSelected.length === 0) return;
    void onPick(multiSelected, undefined);
  };

  const submitFreeText = () => {
    const trimmed = freeText.trim();
    if (!onPick || !trimmed) return;
    void onPick(undefined, trimmed);
    setFreeText('');
    setShowFreeText(false);
  };

  return (
    <div
      className={`${styles.turn} ${styles.turnLlm}`}
      data-testid="architect-conversation-turn-option-proposal"
      data-selection-mode={turn.selectionMode}
      style={{ maxWidth: '100%', alignSelf: 'stretch' }}
    >
      <div className={styles.turnLabel}>
        Options · {turn.topicLabel} · {isMulti ? 'select any' : 'pick one'}
      </div>
      <div className={styles.chipRow}>
        {turn.options.map((opt) => {
          const selected = isMulti && multiSelected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={
                selected
                  ? `${styles.choiceButton} ${styles.choiceButtonSelected}`
                  : styles.choiceButton
              }
              onClick={() =>
                isMulti ? toggleMulti(opt.value) : pickSingle(opt.value)
              }
              disabled={!actionable || busy}
              aria-pressed={isMulti ? selected : undefined}
              data-testid={`architect-conversation-option-${opt.value}`}
            >
              {selected ? '✓ ' : ''}
              {opt.label ?? opt.value}
            </button>
          );
        })}
      </div>

      {isMulti && actionable && (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={multiSelected.length === 0 || busy}
          onClick={submitMulti}
          data-testid="architect-conversation-option-submit-multi"
          style={{ marginTop: '0.5rem' }}
        >
          {busy ? (
            <>
              <span className={styles.spinner} aria-hidden="true" /> Saving…
            </>
          ) : (
            `Confirm selection (${multiSelected.length})`
          )}
        </button>
      )}

      {/* "something else…" free-text escape — captured verbatim. NO opt-out. */}
      {turn.allowFreeTextEscape && actionable && (
        <div style={{ marginTop: '0.5rem' }}>
          {showFreeText ? (
            <div className={styles.inputRow}>
              <input
                type="text"
                className={styles.inputField}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Describe your own answer…"
                disabled={busy}
                data-testid="architect-conversation-option-free-text-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitFreeText();
                  }
                }}
              />
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!freeText.trim() || busy}
                onClick={submitFreeText}
                data-testid="architect-conversation-option-free-text-submit"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setShowFreeText(true)}
              disabled={busy}
              data-testid="architect-conversation-option-something-else"
            >
              {turn.freeTextEscapeLabel ?? 'Something else…'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TierConfirmationView: the 2026-06-05 opening tier-confirmation turn.
//
// Renders "I see this migration involves <tiers> — is that right?" with a
// toggle per technology tier (UI / Service / Persistence) and a Confirm action.
// The toggles seed from the live in-session confirmed set (`confirmedTiers`,
// held by the tab) when present, otherwise the turn payload's `confirmedTiers`
// (which the gateway seeds equal to `derivedTiers` at open). Confirming or
// adjusting hands the chosen set up via `onConfirmTiers`; the tab threads it
// into every subsequent next-question call. IN-SESSION ONLY — no persistence.
//
// "tier" here is the architectural TECHNOLOGY tier, NOT `DiscoveryRunDto.tier`
// (the V3 confidence ladder A/B/C).
// ---------------------------------------------------------------------------

const TIER_FIELDS: { key: keyof TierFlags; label: string }[] = [
  { key: 'hasUiTier', label: 'UI Tier' },
  { key: 'hasServiceTier', label: 'Service Tier' },
  { key: 'hasPersistenceTier', label: 'Persistence Tier' },
];

function describeTiers(flags: TierFlags): string {
  const present = TIER_FIELDS.filter((f) => flags[f.key]).map((f) => f.label);
  if (present.length === 0) return 'no specific technology tier';
  if (present.length === 1) return present[0];
  if (present.length === 2) return `${present[0]} and ${present[1]}`;
  return `${present.slice(0, -1).join(', ')} and ${present[present.length - 1]}`;
}

interface TierConfirmationViewProps {
  turn: TierConfirmationTurn;
  confirmedTiers: TierFlags | null;
  onConfirmTiers?: (tiers: TierFlags) => void;
}

function TierConfirmationView({
  turn,
  confirmedTiers,
  onConfirmTiers,
}: TierConfirmationViewProps) {
  // Seed the toggles from the live in-session confirmed set when the tab has
  // one, else the turn payload's confirmed default (== derived at open).
  const seed = confirmedTiers ?? turn.confirmedTiers;
  const [draft, setDraft] = useState<TierFlags>(seed);

  // If the tab's confirmed set changes underneath us (e.g. a re-derive on
  // reopen), resync the local draft so the toggles never drift from the
  // source of truth.
  useEffect(() => {
    setDraft(seed);
    // Only resync when the seed booleans actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed.hasUiTier, seed.hasServiceTier, seed.hasPersistenceTier]);

  // Spec 2026-06-06 fix: once the user clicks "Confirm tiers" the action is DONE
  // — swap the button for a "Confirmed" marker and lock the toggles, so the click
  // visibly resolves (previously the button stayed put and looked inert). The
  // chosen set is also handed up via `onConfirmTiers` (the tab holds it for the
  // walk); this local flag is in-session only, matching the tab's non-persisted
  // confirmed set (a fresh open re-renders the turn unconfirmed).
  const [confirmed, setConfirmed] = useState(false);

  const toggle = (key: keyof TierFlags) =>
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      className={`${styles.turn} ${styles.turnSystem}`}
      data-testid="architect-conversation-turn-tier-confirmation"
      style={{ maxWidth: '100%', alignSelf: 'stretch', fontStyle: 'normal' }}
    >
      <div className={styles.turnLabel}>Technology tiers</div>
      <p style={{ margin: '0 0 0.5rem' }}>
        I see this migration involves <strong>{describeTiers(turn.derivedTiers)}</strong>{' '}
        — is that right? Toggle a tier off to skip its questions, or on to include
        them.
      </p>
      <div className={styles.chipRow}>
        {TIER_FIELDS.map((f) => {
          const on = draft[f.key];
          return (
            <button
              key={f.key}
              type="button"
              role="switch"
              aria-checked={on}
              className={
                on
                  ? `${styles.choiceButton} ${styles.choiceButtonSelected}`
                  : styles.choiceButton
              }
              onClick={() => toggle(f.key)}
              disabled={confirmed}
              data-testid={`architect-conversation-tier-toggle-${f.key}`}
            >
              {on ? '✓ ' : ''}
              {f.label}
            </button>
          );
        })}
      </div>
      {confirmed ? (
        <div
          style={{ marginTop: '0.5rem', color: '#1a7f37', fontWeight: 600 }}
          data-testid="architect-conversation-tier-confirmed"
        >
          ✓ Confirmed
        </div>
      ) : (
        <button
          type="button"
          className={styles.primaryButton}
          style={{ marginTop: '0.5rem' }}
          onClick={() => {
            if (!onConfirmTiers) return;
            onConfirmTiers(draft);
            setConfirmed(true);
          }}
          disabled={!onConfirmTiers}
          data-testid="architect-conversation-tier-confirm"
        >
          Confirm tiers
        </button>
      )}
    </div>
  );
}
