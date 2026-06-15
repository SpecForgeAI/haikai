/**
 * ArchitectConversationTab
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5
 *
 * The new view-mode tab content rendered inside the Target State sub-tab,
 * peer to "Table editor" and "Compare with current" (per Spec 1's tab strip).
 *
 * Owns the conversation lifecycle:
 *
 *   - Surface 1: Tab renders inside the Target State sub-tab (handled by the
 *     parent <TargetArchitectureWorkspace />, which switches the centre pane
 *     to this component when `viewMode === 'conversation'`).
 *   - Surface 2: Empty-state when no active target draft per Q23 -- soft
 *     router push to the Table editor view-mode + one-frame highlight on the
 *     Suggest button.
 *   - Surface 3: Start-conversation flow + "Start new conversation" for
 *     re-opening prior closed sessions.
 *   - Surface 4: Cascade-summary accept-batch UX (via <ConversationMainPane />).
 *   - Surface 5: Per-question "Set exception" sub-dialog (via <ExceptionSubDialog />).
 *   - Surface 6: Close-conversation flow + retire-current per Q4.
 *   - Surface 7: Revise-prior-answer flow + Q6 banner.
 *   - 2026-06-06 Open-Ended LLM Phase: drives the open phase STRICTLY after the
 *     preset walk exhausts (read off the `phase` signal in `refreshNextQuestion`).
 *     The whole open phase is OPTIONAL — the user may still close immediately
 *     (preserving today's input-bar-hidden close state). Explicit "Done with
 *     decisions" / "Done / Close" controls drive the sub-phase transitions; the
 *     LLM never infers "done". The final close reuses `CloseConversationFlow`.
 *
 * Per Q4 there is NO optimistic locking on the thread file. UI-level
 * prevention only -- a second user opens the conversation and sees the
 * retire-current affordance if an open session exists.
 *
 * Per Q21 active-target lookup uses Spec 2's
 *   GET /api/projects/{projectId}/active-target-architecture-id
 * exclusively. No fallback logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptCascadeBatch,
  beginOpenPhase,
  captureAnswer,
  ArchitectConversationApiError,
  closeConversation,
  CapturedDecisionRow,
  CascadeSummaryEntry,
  CascadeSummaryTurn,
  ConversationEnvelope,
  ConversationPhase,
  ConversationTurn,
  DecisionCapturedTurn,
  DecisionScope,
  discussOpenPhase,
  fetchNextQuestion,
  fetchPromptReadyOutput,
  fetchQuestionLibraryScopes,
  loadConversation,
  PendingQuestion,
  openConversation,
  overrideCascade,
  pickOpenPhaseOption,
  pinException,
  QuestionLibraryScopeMap,
  raiseOpenPhaseTopic,
  revisePriorAnswer,
  ScopeRefType,
  summariseOpenPhaseDiscussion,
  TechStackPrefillSummaryTurn,
  TierFlags,
} from '../../../api/architectConversationApi';
import { ConversationMainPane, type OpenPhasePaneState } from './ConversationMainPane';
import { SummaryPanel } from './SummaryPanel';
import { TechStackPrefillBanner } from './TechStackPrefillBanner';
import { ExceptionSubDialog } from './ExceptionSubDialog';
import {
  CloseConversationFlow,
  buildCloseSummaryMarkdown,
} from './CloseConversationFlow';
import {
  DownstreamCodesBanner,
  RevisePriorAnswerDialog,
} from './RevisePriorAnswer';
import { exportTranscript, slugifyForFilename } from './exportTranscript';
import { Download } from 'lucide-react';
import { useArchitecture } from '../../../contexts/ArchitectureContext';
import type { ApplicationComponent, Service } from '../../../types/model';
import { deriveServiceTier } from '../../../utils/deriveServiceTier';
import styles from './ArchitectConversation.module.css';

export interface ArchitectConversationTabProps {
  projectId: string;
  /**
   * The target architecture id the user is currently viewing in the Target
   * State workspace. When null, the empty-state path fires.
   */
  selectedTargetArchitectureId: string | null;
  /** The current user's identifier (used as `openedBy`). */
  currentUserId: string;
  /**
   * Called by Surface 2's empty-state to soft-push the parent workspace back
   * to the Table editor view-mode (per Q23). Implementation lives in the
   * parent so the highlight ref stays inside <TargetArchitectureWorkspace />.
   */
  onEmptyStateRedirect?: () => void;
  /**
   * Spec 2026-05-26 Compare View Decoration: when set, the embedded
   * ConversationMainPane scrolls the matching `decision-captured` turn into
   * view (via a DOM id stamped on the turn render path). The pane invokes
   * `onScrolledToDecision` after the scroll attempt so the workspace can
   * clear the prop. Per Q3 this is a callback path, not URL-hash navigation.
   */
  scrollToDecisionId?: string | null;
  onScrolledToDecision?: () => void;
  /**
   * 2026-05-26 Architect Conversation Enrichments (#12): the display name of
   * the target architecture, sourced from the parent workspace
   * (`activeTarget?.name` at `TargetArchitectureWorkspace.tsx:938`). Used by
   * the Export-transcript toolbar to build the download filename and the
   * Markdown header. Falls back to `selectedTargetArchitectureId` when
   * null/empty so the filename always has a non-empty slug source.
   */
  architectureName?: string;
}

/**
 * Convert a `decision-captured` turn into the `CapturedDecisionRow` shape the
 * SummaryPanel renders. Used to keep the local captured-decisions snapshot in
 * sync after EVERY write path (answer, cascade accept/override, revise) so the
 * "Decisions captured" panel reflects the just-saved value without a reload.
 * The backend supersedes the prior row for the same (code, scope) tuple, and
 * `appendDecisionRow` mirrors that by upserting on the same key.
 */
function decisionRowFromCapturedTurn(
  turn: DecisionCapturedTurn,
): CapturedDecisionRow {
  return {
    decisionId: turn.decisionId,
    decisionCode: turn.decisionCode,
    scopeKind: turn.scope.kind === 'element' ? 'element' : 'architecture',
    scopeRefType: turn.scope.kind === 'element' ? turn.scope.refType : null,
    scopeRefId: turn.scope.kind === 'element' ? turn.scope.refId : null,
    answerValue:
      typeof turn.answerValue === 'string'
        ? turn.answerValue
        : String(turn.answerValue),
    answerSummary: null,
    standardsLookupRef: turn.standardsLookupRef,
    supersededById: null,
  };
}

export function ArchitectConversationTab({
  projectId,
  selectedTargetArchitectureId,
  currentUserId,
  onEmptyStateRedirect,
  scrollToDecisionId = null,
  onScrolledToDecision,
  architectureName,
}: ArchitectConversationTabProps) {
  const [envelope, setEnvelope] = useState<ConversationEnvelope | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Per-action in-flight + error state.
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [cascadeBusy, setCascadeBusy] = useState(false);
  const [cascadeError, setCascadeError] = useState<string | null>(null);

  // Cascade-summary pending state: which cascade-summary turn is awaiting
  // user resolution + the parent decision id that triggered it.
  const [pendingCascade, setPendingCascade] = useState<{
    turn: CascadeSummaryTurn;
    parentDecisionId: string;
  } | null>(null);

  // Sub-dialog state.
  const [exceptionDialog, setExceptionDialog] = useState<{
    decisionCode: string;
    allowedExceptionScopes: readonly ScopeRefType[];
    /**
     * True when the scope map fetch failed and the sub-dialog is opening
     * in graceful-degrade mode (per Q12 option a of the Four-Spec Hardening
     * Pass spec): the picker renders disabled with the
     * "no exception scopes available -- try again later" message and the
     * user can cancel out cleanly.
     */
    scopesUnavailable?: boolean;
  } | null>(null);

  // Four-Spec Hardening Pass (2026-05-25), Item 4: runtime-fetched question
  // library scope map. Session-cached in memory, no TTL; re-fetch fires only
  // on tab close + reopen. Null while the fetch is in flight; remains null
  // when the fetch fails -- the exception sub-dialog opens regardless and
  // surfaces the degrade UX.
  const [scopeMap, setScopeMap] = useState<QuestionLibraryScopeMap | null>(null);
  const [scopeMapFetchFailed, setScopeMapFetchFailed] = useState(false);
  const [reviseDialog, setReviseDialog] = useState<CapturedDecisionRow | null>(null);
  const [downstreamBanner, setDownstreamBanner] = useState<string[]>([]);

  // "Preview prompt-ready output" modal state (null = closed).
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // The question the architect should answer NEXT, driven by the gateway
  // question sequencer. The original feature derived this by scanning the
  // transcript for an unanswered `question` turn -- but a question turn only
  // ever appears AFTER answering, so nothing was ever asked (a deadlock). We
  // now fetch the next pending question from the gateway on session open and
  // after each captured answer.
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);

  // 2026-06-06 Open-Ended LLM Phase (S2): the phase signal the gateway returns
  // on `next-question`. `open-available` STRICTLY after the preset walk exhausts
  // (`pendingQuestion` is null); `preset-walk` while a question is still served.
  // The open phase is reachable ONLY in `open-available` — never mid-walk.
  const [phase, setPhase] = useState<ConversationPhase>('preset-walk');

  // 2026-06-06 Open-Ended LLM Phase: the open-phase surface state. The whole
  // phase is OPTIONAL — `engaged` flips true only when the user clicks
  // "Explore other areas" post-walk (the open prompt is fetched then). Until
  // then the post-walk state is exactly today's (input bar hidden + close CTA).
  const [openPhaseEngaged, setOpenPhaseEngaged] = useState(false);
  const [openPhaseSubPhase, setOpenPhaseSubPhase] = useState<
    'decisions' | 'discussion'
  >('decisions');
  const [openPhaseBusy, setOpenPhaseBusy] = useState(false);
  const [openPhaseError, setOpenPhaseError] = useState<string | null>(null);
  // Guard so the one-shot `beginOpenPhase` (suggested-areas prompt) fires once
  // per engagement, not on every re-render.
  const openPhaseBegunRef = useRef(false);

  const sessionStatus = envelope?.currentSession?.status ?? null;
  const sessionId = envelope?.currentSession?.sessionId ?? null;

  // -------------------------------------------------------------------------
  // Spec 2026-06-05-architect-tier-gating (Half B): derive the DEFAULT
  // technology-tier set client-side from the already-loaded target model — NO
  // new fetch / AMS endpoint (the AppShell caches the full per-(project,
  // architecture) model; same read pattern as DiscoveryReviewRoom.tsx:336-346).
  // For each service we resolve `service -> app_component_id -> tech_type` via
  // the shared `deriveServiceTier` helper and union the results into the three
  // booleans. FAIL-OPEN: a `'Unknown'` tier contributes nothing, and if the
  // derived set is empty/all-unknown we default ALL three flags true so no
  // question group is wrongly skipped. Derived from the TARGET architecture's
  // components only (NOT the discovery scan selection — that is Half A; no
  // cross-surface handoff). The tier-confirmation turn (Task Group 4) lets the
  // user adjust this default; until then `derivedTiers` is sent verbatim.
  // -------------------------------------------------------------------------
  const { model } = useArchitecture();
  const derivedTiers: TierFlags = useMemo(() => {
    const appComponentsById = new Map<string, ApplicationComponent>();
    for (const ac of model.metaModel.entities.app_components ?? []) {
      appComponentsById.set(ac.id, ac);
    }
    const services: Service[] = model.metaModel.entities.services ?? [];
    let hasUiTier = false;
    let hasServiceTier = false;
    let hasPersistenceTier = false;
    for (const svc of services) {
      switch (deriveServiceTier(svc, appComponentsById)) {
        case 'UI':
          hasUiTier = true;
          break;
        case 'Service':
          hasServiceTier = true;
          break;
        case 'Persistence':
          hasPersistenceTier = true;
          break;
        // 'Unknown' contributes no tier.
      }
    }
    // FAIL-OPEN: an empty / all-unknown derived set asks everything.
    if (!hasUiTier && !hasServiceTier && !hasPersistenceTier) {
      return { hasUiTier: true, hasServiceTier: true, hasPersistenceTier: true };
    }
    return { hasUiTier, hasServiceTier, hasPersistenceTier };
  }, [model.metaModel.entities.services, model.metaModel.entities.app_components]);

  // Spec 2026-06-05-architect-tier-gating (Half B, Task Group 4): the in-session
  // confirmed technology-tier set. Null until the user confirms/adjusts via the
  // tier-confirmation turn — until then the client-derived default (`derivedTiers`)
  // is the effective set the walk gates on. IN-SESSION ONLY: held in component
  // state, never persisted (Decision 1); re-deriving on reopen is idempotent.
  const [confirmedTiers, setConfirmedTiers] = useState<TierFlags | null>(null);

  // The set actually in play for the walk: the user-CONFIRMED set once the
  // tier-confirmation turn has been acted on (Task Group 4), else the
  // client-derived default. Threaded into every next-question call below.
  const effectiveTiers: TierFlags = confirmedTiers ?? derivedTiers;

  const refreshNextQuestion = useCallback(async () => {
    if (!selectedTargetArchitectureId || sessionStatus !== 'open') {
      setPendingQuestion(null);
      return;
    }
    try {
      // Thread the EFFECTIVE technology-tier set (user-confirmed once the
      // tier-confirmation turn is acted on, else the client-derived default) so
      // the gateway gates the walk on it — a tier toggled off skips its
      // questions on the next fetch; toggled on asks them.
      // fetchNextQuestion returns { question, phase } (Spec 2026-06-06
      // open-ended-phase, S2). The `phase` signal drives the open-phase surface
      // STRICTLY post-walk (`open-available` only when `question` is null).
      const { question, phase: nextPhase } = await fetchNextQuestion(
        projectId,
        selectedTargetArchitectureId,
        effectiveTiers,
      );
      setPendingQuestion(question);
      setPhase(nextPhase);
    } catch {
      // Leave the question hidden on error; the load-error banner covers fatal
      // cases and the user can retry by re-opening the tab.
      setPendingQuestion(null);
    }
    // sessionId is included so a retire-then-open cycle re-seeds the walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedTargetArchitectureId, sessionStatus, sessionId, effectiveTiers]);

  useEffect(() => {
    void refreshNextQuestion();
  }, [refreshNextQuestion]);

  // -------------------------------------------------------------------------
  // Load conversation envelope on mount + when the selected target changes.
  // -------------------------------------------------------------------------

  const refreshEnvelope = useCallback(async () => {
    if (!selectedTargetArchitectureId) {
      setEnvelope(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadConversation(projectId, selectedTargetArchitectureId);
      setEnvelope(data);
    } catch (err) {
      const msg =
        err instanceof ArchitectConversationApiError
          ? err.body.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load conversation';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedTargetArchitectureId]);

  useEffect(() => {
    void refreshEnvelope();
  }, [refreshEnvelope]);

  // -------------------------------------------------------------------------
  // Four-Spec Hardening Pass (2026-05-25), Item 4: fetch the question library
  // scope map on mount and session-cache it. The map only changes on gateway
  // redeploy (the question library is a frozen TS constant), so a session
  // refresh covers that.
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const map = await fetchQuestionLibraryScopes();
        if (cancelled) return;
        setScopeMap(map);
        setScopeMapFetchFailed(false);
      } catch {
        if (cancelled) return;
        // Graceful-degrade per Q12 option a: leave the map null and let the
        // exception sub-dialog open with the picker disabled and the
        // "no exception scopes available -- try again later" message.
        setScopeMap(null);
        setScopeMapFetchFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Surface 2 -- empty-state path (no active target draft).
  //
  // We treat "no target architecture selected" as the empty-state. Per Q23 we
  // soft-push the user back to the Table editor view-mode AND highlight the
  // Suggest button for one frame. The parent owns the actual nav + highlight
  // (handed in via `onEmptyStateRedirect`).
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedTargetArchitectureId && onEmptyStateRedirect) {
      onEmptyStateRedirect();
    }
  }, [selectedTargetArchitectureId, onEmptyStateRedirect]);

  // -------------------------------------------------------------------------
  // Surface 3 -- start-conversation flow.
  // -------------------------------------------------------------------------

  const hasOpenSession = envelope?.currentSession?.status === 'open';
  const sessionOwnedByMe =
    envelope?.currentSession?.openedBy === currentUserId;

  const handleStartConversation = async () => {
    if (!envelope) return;
    try {
      const result = await openConversation(projectId, selectedTargetArchitectureId!, {
        openedBy: currentUserId,
        // THE CORE BUG FIX: actually SEND the technology-tier set so the
        // gateway gates question groups on it. Previously omitted, so
        // `hasUiScreens` defaulted true and UI (Group E) was always asked.
        relevanceContext: derivedTiers,
      });
      // Optimistically append the new open turn + the tier-confirmation turn the
      // gateway emits right after it (the "which technology tiers are in play?"
      // confirm/adjust step shown BEFORE the first question). The optimistic open
      // path does NOT reload from the server, so without appending it here the
      // tier-confirmation turn never renders on a fresh start and the conversation
      // appears to jump straight to the first preset question.
      setEnvelope((prev) =>
        prev
          ? {
              ...prev,
              turns: [
                ...prev.turns,
                result.openTurn,
                ...(result.tierConfirmationTurn ? [result.tierConfirmationTurn] : []),
              ],
              currentSession: {
                sessionId: result.sessionId,
                status: 'open',
                openedBy: currentUserId,
                openedAt: new Date().toISOString(),
              },
            }
          : prev,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open conversation';
      setLoadError(msg);
    }
  };

  // -------------------------------------------------------------------------
  // Surface 4 -- answer / cascade accept / cascade override flow.
  // -------------------------------------------------------------------------

  const appendTurnLocal = (turn: ConversationTurn) => {
    setEnvelope((prev) =>
      prev ? { ...prev, turns: [...prev.turns, turn] } : prev,
    );
  };

  const appendDecisionRow = (row: CapturedDecisionRow) => {
    setEnvelope((prev) => {
      if (!prev) return prev;
      const sameSlot = (d: CapturedDecisionRow) =>
        d.decisionCode === row.decisionCode &&
        d.scopeKind === row.scopeKind &&
        d.scopeRefId === row.scopeRefId;
      const exists = prev.capturedDecisions.some(sameSlot);
      // Replace an existing row in place (so a revised/overridden decision keeps
      // its position in the panel) or append a brand-new one at the end.
      return {
        ...prev,
        capturedDecisions: exists
          ? prev.capturedDecisions.map((d) => (sameSlot(d) ? row : d))
          : [...prev.capturedDecisions, row],
      };
    });
  };

  const handleCaptureAnswer = async (
    decisionCode: string,
    value: string | string[],
    answerText?: string,
  ) => {
    if (!envelope?.currentSession) return;
    setAnswerBusy(true);
    setAnswerError(null);
    try {
      const result = await captureAnswer(projectId, selectedTargetArchitectureId!, {
        sessionId: envelope.currentSession.sessionId,
        decisionCode,
        value,
        answerText,
      });
      if (result.questionTurn) appendTurnLocal(result.questionTurn);
      if (result.answerTurn) appendTurnLocal(result.answerTurn);
      if (result.decisionCapturedTurn) {
        appendTurnLocal(result.decisionCapturedTurn);
        // Mirror the decision into the captured-decisions snapshot.
        appendDecisionRow(decisionRowFromCapturedTurn(result.decisionCapturedTurn));
      }
      if (result.cascadeSummaryTurn) {
        appendTurnLocal(result.cascadeSummaryTurn);
        setPendingCascade({
          turn: result.cascadeSummaryTurn,
          parentDecisionId: result.decisionCapturedTurn?.decisionId ?? '',
        });
      }
      if (result.mappingMutationSummaryTurn) {
        appendTurnLocal(result.mappingMutationSummaryTurn);
      }
      if (result.systemSkipTurn) appendTurnLocal(result.systemSkipTurn);
      if (result.errorTurn) appendTurnLocal(result.errorTurn);
      // Advance the walk to the next pending question now this decision is captured.
      void refreshNextQuestion();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to capture answer';
      setAnswerError(msg);
    } finally {
      setAnswerBusy(false);
    }
  };

  const handleAcceptCascadeAll = async (proposals: CascadeSummaryEntry[]) => {
    if (!envelope?.currentSession || !pendingCascade) return;
    setCascadeBusy(true);
    setCascadeError(null);
    try {
      const result = await acceptCascadeBatch(projectId, selectedTargetArchitectureId!, {
        sessionId: envelope.currentSession.sessionId,
        parentDecisionId: pendingCascade.parentDecisionId,
        proposals,
      });
      result.decisionCapturedTurns.forEach(appendTurnLocal);
      // Mirror each cascaded decision into the captured-decisions snapshot so
      // the SummaryPanel reflects the new values without a reload.
      result.decisionCapturedTurns.forEach((t) =>
        appendDecisionRow(decisionRowFromCapturedTurn(t)),
      );
      appendTurnLocal(result.cascadeAcceptedTurn);
      setPendingCascade(null);
      void refreshNextQuestion();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept cascades';
      setCascadeError(msg);
    } finally {
      setCascadeBusy(false);
    }
  };

  const handleOverrideCascade = async (
    proposal: CascadeSummaryEntry,
    overrideValue: string,
    reason: string,
  ) => {
    if (!envelope?.currentSession || !pendingCascade) return;
    setCascadeBusy(true);
    setCascadeError(null);
    try {
      const result = await overrideCascade(projectId, selectedTargetArchitectureId!, {
        sessionId: envelope.currentSession.sessionId,
        parentDecisionId: pendingCascade.parentDecisionId,
        proposal,
        overrideValue,
        overrideReason: reason,
      });
      appendTurnLocal(result.decisionCapturedTurn);
      appendTurnLocal(result.cascadeOverriddenTurn);
      // Mirror the overridden value into the captured-decisions snapshot so the
      // SummaryPanel reflects it immediately (it persisted server-side before,
      // but the panel kept showing the proposed default until a reload).
      appendDecisionRow(decisionRowFromCapturedTurn(result.decisionCapturedTurn));
      // Resolve ONLY this proposal: drop it from the pending cascade so its
      // siblings stay actionable, and dismiss the block only once none remain.
      // The transcript's cascade-summary turn is replaced in lock-step (kept
      // reference-equal to the new pending turn) so the inline controls keep
      // rendering the remaining proposals. Leaving the resolved row in the
      // pending set would let a later "Accept all" clobber this override with
      // the proposed default.
      const overriddenTurn = pendingCascade.turn;
      const remainingCascades = overriddenTurn.cascadedDecisions.filter(
        (c) => c.decisionCode !== proposal.decisionCode,
      );
      const reducedTurn: CascadeSummaryTurn = {
        ...overriddenTurn,
        cascadedDecisions: remainingCascades,
      };
      setEnvelope((prev) =>
        prev
          ? {
              ...prev,
              turns: prev.turns.map((t) => (t === overriddenTurn ? reducedTurn : t)),
            }
          : prev,
      );
      setPendingCascade(
        remainingCascades.length === 0
          ? null
          : { turn: reducedTurn, parentDecisionId: pendingCascade.parentDecisionId },
      );
      void refreshNextQuestion();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to override cascade';
      setCascadeError(msg);
    } finally {
      setCascadeBusy(false);
    }
  };

  // -------------------------------------------------------------------------
  // 2026-06-06 Open-Ended LLM Phase -- sub-phase handlers.
  //
  // All transitions are EXPLICIT user controls (the LLM never infers "done").
  // The open phase is OPTIONAL: it begins only when the user clicks
  // "Explore other areas" post-walk (`handleEngageOpenPhase`), which fires the
  // one-shot `beginOpenPhase` (suggested-areas prompt). Sub-phase (a) raises
  // topics -> option proposals -> first-class `adhoc.<slug>` decisions; (b) is a
  // free-form chat summarised into `note.<slug>` rows on "Done / Close".
  // -------------------------------------------------------------------------

  const handleEngageOpenPhase = useCallback(async () => {
    if (!selectedTargetArchitectureId || phase !== 'open-available') return;
    setOpenPhaseEngaged(true);
    setOpenPhaseSubPhase('decisions');
    setOpenPhaseError(null);
    if (openPhaseBegunRef.current) return;
    openPhaseBegunRef.current = true;
    setOpenPhaseBusy(true);
    try {
      const result = await beginOpenPhase(projectId, selectedTargetArchitectureId);
      if (result.outcome === 'error') {
        appendTurnLocal(result.errorTurn);
        setOpenPhaseError(result.errorTurn.errorMessage);
      } else {
        appendTurnLocal(result.openPhasePromptTurn);
      }
    } catch (err) {
      setOpenPhaseError(
        err instanceof Error ? err.message : 'Failed to start the open phase',
      );
      // Allow a retry if the begin call itself threw.
      openPhaseBegunRef.current = false;
    } finally {
      setOpenPhaseBusy(false);
    }
    // appendTurnLocal is stable enough for this one-shot; deps kept minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedTargetArchitectureId, phase]);

  const handleRaiseTopic = useCallback(
    async (topicLabel: string, topicText?: string) => {
      if (!selectedTargetArchitectureId) return;
      setOpenPhaseBusy(true);
      setOpenPhaseError(null);
      try {
        const result = await raiseOpenPhaseTopic(projectId, selectedTargetArchitectureId, {
          topicLabel,
          topicText,
        });
        appendTurnLocal(result.userRaisedTopicTurn);
        if (result.outcome === 'error') {
          appendTurnLocal(result.errorTurn);
          setOpenPhaseError(result.errorTurn.errorMessage);
        } else {
          appendTurnLocal(result.optionProposalTurn);
        }
      } catch (err) {
        setOpenPhaseError(
          err instanceof Error ? err.message : 'Failed to propose options',
        );
      } finally {
        setOpenPhaseBusy(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [projectId, selectedTargetArchitectureId],
  );

  const handlePickOption = useCallback(
    async (
      topicLabel: string,
      selectedValues: string[] | undefined,
      freeTextValue: string | undefined,
    ) => {
      if (!selectedTargetArchitectureId) return;
      setOpenPhaseBusy(true);
      setOpenPhaseError(null);
      try {
        const result = await pickOpenPhaseOption(projectId, selectedTargetArchitectureId, {
          topicLabel,
          selectedValues,
          freeTextValue,
          conversationThreadId: envelope?.threadId ?? null,
        });
        if (result.outcome === 'error') {
          appendTurnLocal(result.errorTurn);
          setOpenPhaseError(result.errorTurn.errorMessage);
        } else {
          appendTurnLocal(result.userPickTurn);
          appendTurnLocal(result.decisionCapturedTurn);
          // Mirror the first-class user-raised decision into the snapshot so the
          // SummaryPanel surfaces it immediately (it lands under Architecture-wide).
          appendDecisionRow(decisionRowFromCapturedTurn(result.decisionCapturedTurn));
        }
      } catch (err) {
        setOpenPhaseError(
          err instanceof Error ? err.message : 'Failed to capture your pick',
        );
      } finally {
        setOpenPhaseBusy(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [projectId, selectedTargetArchitectureId, envelope?.threadId],
  );

  const handleDiscuss = useCallback(
    async (userMessage: string) => {
      if (!selectedTargetArchitectureId) return;
      setOpenPhaseBusy(true);
      setOpenPhaseError(null);
      try {
        const result = await discussOpenPhase(projectId, selectedTargetArchitectureId, {
          userMessage,
        });
        appendTurnLocal(result.userTurn);
        if (result.outcome === 'error') {
          appendTurnLocal(result.errorTurn);
          setOpenPhaseError(result.errorTurn.errorMessage);
        } else {
          appendTurnLocal(result.assistantTurn);
        }
      } catch (err) {
        setOpenPhaseError(
          err instanceof Error ? err.message : 'Failed to send the message',
        );
      } finally {
        setOpenPhaseBusy(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [projectId, selectedTargetArchitectureId],
  );

  // Explicit "Done with decisions" — ends sub-phase (a) and moves to (b). Never
  // inferred from free text (S5).
  const handleDoneWithDecisions = useCallback(() => {
    setOpenPhaseSubPhase('discussion');
    setOpenPhaseError(null);
  }, []);

  // -------------------------------------------------------------------------
  // Surface 6 -- close conversation flow.
  // -------------------------------------------------------------------------

  const handleCloseConversation = async (summaryMarkdown: string) => {
    if (!envelope?.currentSession) return;
    try {
      const result = await closeConversation(projectId, selectedTargetArchitectureId!, {
        sessionId: envelope.currentSession.sessionId,
        closeReason: 'completed-by-user',
        summaryMarkdown,
      });
      appendTurnLocal(result.closeTurn);
      setEnvelope((prev) =>
        prev && prev.currentSession
          ? {
              ...prev,
              currentSession: { ...prev.currentSession, status: 'closed' },
            }
          : prev,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to close conversation';
      setLoadError(msg);
    }
  };

  // Explicit "Done / Close" — ends sub-phase (b), summarises the free-form chat
  // into per-topic `note.<slug>` rows (Q2a/b), then proceeds to the existing
  // close (reusing the same close path as `CloseConversationFlow`). Sub-phase
  // (b) is SKIPPABLE: the user may click this without having typed anything (the
  // summarise call simply returns an empty notes set). Never inferred (S5).
  const handleDoneAndClose = useCallback(async () => {
    if (!selectedTargetArchitectureId || !envelope?.currentSession) return;
    setOpenPhaseBusy(true);
    setOpenPhaseError(null);
    try {
      const result = await summariseOpenPhaseDiscussion(projectId, selectedTargetArchitectureId, {
        conversationThreadId: envelope.threadId ?? null,
      });
      if (result.outcome === 'error') {
        appendTurnLocal(result.errorTurn);
        setOpenPhaseError(result.errorTurn.errorMessage);
        setOpenPhaseBusy(false);
        return;
      }
    } catch (err) {
      // Note summarisation is best-effort; surface the error but still proceed
      // to the close so the user is never trapped in the open phase.
      setOpenPhaseError(
        err instanceof Error ? err.message : 'Failed to summarise the discussion',
      );
    }
    setOpenPhaseBusy(false);
    setOpenPhaseEngaged(false);
    // Reuse the existing close path so the close turn + target-tech-stack write
    // are identical to the standard close.
    await handleCloseConversation(buildCloseSummaryMarkdown(envelope.capturedDecisions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedTargetArchitectureId, envelope]);

  const handleRetireAndStartNew = async () => {
    if (!envelope?.currentSession) return;
    // Per Q4 write a synthetic close (reason=retired-by-other-user) followed
    // by a fresh open. The gateway endpoints handle the two writes; the UI
    // sequences them.
    try {
      const summaryMarkdown = buildCloseSummaryMarkdown(envelope.capturedDecisions);
      await closeConversation(projectId, selectedTargetArchitectureId!, {
        sessionId: envelope.currentSession.sessionId,
        closeReason: 'retired-by-other-user',
        summaryMarkdown,
      });
      const openResult = await openConversation(
        projectId,
        selectedTargetArchitectureId!,
        { openedBy: currentUserId },
      );
      // Reload from the server -- the synthetic close + new open are sequenced
      // server-side and we want canonical state.
      await refreshEnvelope();
      // Track the just-opened session id so the UI is in sync immediately.
      setEnvelope((prev) =>
        prev
          ? {
              ...prev,
              currentSession: {
                sessionId: openResult.sessionId,
                status: 'open',
                openedBy: currentUserId,
                openedAt: new Date().toISOString(),
              },
            }
          : prev,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to retire current session';
      setLoadError(msg);
    }
  };

  // -------------------------------------------------------------------------
  // Surface 5 -- exception sub-dialog flow.
  // -------------------------------------------------------------------------

  const openExceptionDialog = (decisionCode: string) => {
    // Four-Spec Hardening Pass (2026-05-25), Item 4: read scopes from the
    // session-cached map. When the fetch failed, open the sub-dialog with
    // an empty scope list AND the scopesUnavailable flag so the picker
    // renders disabled with the documented message (per Q12 option a).
    if (scopeMapFetchFailed) {
      setExceptionDialog({
        decisionCode,
        allowedExceptionScopes: [],
        scopesUnavailable: true,
      });
      return;
    }
    const entry = scopeMap?.[decisionCode];
    setExceptionDialog({
      decisionCode,
      allowedExceptionScopes: entry?.allowedExceptionScopes ?? [],
    });
  };

  const handlePinException = async (args: {
    scope: { kind: 'element'; refType: ScopeRefType; refId: string };
    answerValue: string;
  }) => {
    if (!envelope?.currentSession || !exceptionDialog) return;
    const result = await pinException(projectId, selectedTargetArchitectureId!, {
      sessionId: envelope.currentSession.sessionId,
      decisionCode: exceptionDialog.decisionCode,
      scope: args.scope,
      answerValue: args.answerValue,
    });
    appendTurnLocal(result.decisionCapturedTurn);
    appendTurnLocal(result.exceptionPinnedTurn);
    setExceptionDialog(null);
  };

  // -------------------------------------------------------------------------
  // Surface 7 -- revise prior answer + Q6 banner.
  // -------------------------------------------------------------------------

  const handleReviseSubmit = async (args: {
    newAnswerValue: string;
    scope?: DecisionScope;
  }) => {
    if (!envelope?.currentSession || !reviseDialog) return;
    const result = await revisePriorAnswer(projectId, selectedTargetArchitectureId!, {
      sessionId: envelope.currentSession.sessionId,
      decisionCode: reviseDialog.decisionCode,
      originalDecisionId: reviseDialog.decisionId,
      newAnswerValue: args.newAnswerValue,
      scope: args.scope,
    });
    appendTurnLocal(result.decisionCapturedTurn);
    // Mirror the revised value into the captured-decisions snapshot so the
    // SummaryPanel shows the new answer (the prior row is superseded server-side).
    appendDecisionRow(decisionRowFromCapturedTurn(result.decisionCapturedTurn));
    appendTurnLocal(result.editSupersededTurn);
    setReviseDialog(null);
    setDownstreamBanner(result.editSupersededTurn.affectedDownstreamCodes);
  };

  // -------------------------------------------------------------------------
  // 2026-05-25 Tech-Stack.md Pre-fill (Task Group 5)
  // -------------------------------------------------------------------------
  //
  // The orchestrator appends a `tech-stack-prefill-summary` turn after each
  // open-turn pre-fill batch. We surface the latest one as a banner at the
  // top of the transcript pane (peer to the existing `<SummaryPanel />`).
  // Clicking "Review" scrolls + focuses the SummaryPanel so the user can
  // audit each pre-filled decision and its source quote.

  const summaryPanelRef = useRef<HTMLDivElement | null>(null);

  const latestPrefillSummary: TechStackPrefillSummaryTurn | null = useMemo(() => {
    if (!envelope) return null;
    for (let i = envelope.turns.length - 1; i >= 0; i--) {
      const t = envelope.turns[i];
      if (t.kind === 'tech-stack-prefill-summary') {
        return t;
      }
    }
    return null;
  }, [envelope]);

  const handlePrefillReviewClick = useCallback(() => {
    const node = summaryPanelRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    node.focus({ preventScroll: true });
  }, []);

  // "Preview prompt-ready output": fetch the grouped-by-scope markdown the
  // downstream PM tasks would consume for this draft right now, and show it in
  // a modal. (Previously a dead, unwired stub.) 2026-06-06 Open-Ended LLM Phase:
  // the gateway resolver now also renders the `### Additional / user-raised
  // decisions` + `### Free-form discussion notes` sections (Task Group 5), so
  // this preview automatically includes them once those rows exist — no change
  // needed here beyond the existing `fetchPromptReadyOutput` call.
  const handlePreviewPromptOutput = useCallback(async () => {
    if (!selectedTargetArchitectureId) return;
    setPreviewLoading(true);
    setPromptPreview('');
    try {
      const text = await fetchPromptReadyOutput(projectId, selectedTargetArchitectureId);
      setPromptPreview(text);
    } catch (err) {
      setPromptPreview(
        err instanceof Error
          ? `Failed to load preview: ${err.message}`
          : 'Failed to load preview',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [projectId, selectedTargetArchitectureId]);

  // -------------------------------------------------------------------------
  // 2026-05-26 Architect Conversation Enrichments (#12): Export transcript.
  //
  // Builds a Markdown blob from the current envelope's turns and triggers a
  // browser download via a temporary <a download> element. The filename
  // slug is derived from the architecture display name (falling back to the
  // architecture id). The Object URL is revoked after the click to prevent
  // leaking the in-memory blob.
  // -------------------------------------------------------------------------

  const turnsForExport = useMemo(() => envelope?.turns ?? [], [envelope]);
  const effectiveArchitectureName =
    architectureName != null && architectureName.length > 0
      ? architectureName
      : selectedTargetArchitectureId ?? 'unknown';

  const handleExportTranscript = useCallback(() => {
    const markdown = exportTranscript({
      turns: turnsForExport,
      architectureName,
      selectedTargetArchitectureId,
      projectId,
    });
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const slug = slugifyForFilename(effectiveArchitectureName);
    const isoDate = new Date().toISOString().slice(0, 10);
    const filename = `architect-conversation-${slug}-${isoDate}.md`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [turnsForExport, architectureName, selectedTargetArchitectureId, projectId, effectiveArchitectureName]);

  // 2026-06-06 Open-Ended LLM Phase: the open-phase surface state handed to the
  // ConversationMainPane. Built only when the user has engaged the open phase
  // (post-walk). When undefined the pane behaves exactly as before.
  const openPhaseState: OpenPhasePaneState | undefined = openPhaseEngaged
    ? {
        active: true,
        subPhase: openPhaseSubPhase,
        busy: openPhaseBusy,
        error: openPhaseError,
        onRaiseTopic: handleRaiseTopic,
        onPickOption: handlePickOption,
        onDiscuss: handleDiscuss,
        onDoneWithDecisions: handleDoneWithDecisions,
        onDoneAndClose: () => void handleDoneAndClose(),
      }
    : undefined;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Empty-state (no active target draft). Placed AFTER all hooks so the hook
  // order is identical on every render (React rules-of-hooks); the parent is
  // still soft-redirected via the `onEmptyStateRedirect` effect above.
  if (!selectedTargetArchitectureId) {
    return (
      <div
        className={styles.emptyState}
        data-testid="architect-conversation-empty-state"
      >
        <p className={styles.emptyStateCopy}>
          Run <strong>Suggest</strong> first to generate a target draft, then
          come back to start the architect conversation.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={styles.container}
        data-testid="architect-conversation-loading"
      >
        Loading conversation...
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className={styles.container}
        data-testid="architect-conversation-load-error"
      >
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {loadError}
        </div>
      </div>
    );
  }

  // No active session yet -- show start CTA.
  if (!envelope?.currentSession || envelope.currentSession.status === 'closed') {
    const isResumingPrior = envelope?.currentSession?.status === 'closed';
    return (
      <div className={styles.container} data-testid="architect-conversation-tab">
        {isResumingPrior && envelope && (
          <ConversationMainPane
            turns={envelope.turns}
            pendingQuestion={null}
            pendingCascadeSummary={null}
            cascadeBusy={false}
            cascadeError={null}
            answerBusy={false}
            answerError={null}
            onCaptureAnswer={() => undefined}
            onAcceptCascadeAll={() => undefined}
            onOverrideCascade={() => undefined}
            scrollToDecisionId={scrollToDecisionId}
            onScrolledToDecision={onScrolledToDecision}
          />
        )}
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void handleStartConversation()}
          data-testid={
            isResumingPrior
              ? 'architect-conversation-start-new-button'
              : 'architect-conversation-start-button'
          }
        >
          {isResumingPrior ? 'Start new conversation' : 'Start conversation'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="architect-conversation-tab">
      <div className={styles.tabToolbar}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={handleExportTranscript}
          disabled={turnsForExport.length === 0}
          data-testid="architect-conversation-export-button"
        >
          <Download size={14} aria-hidden="true" />
          {' '}Export transcript
        </button>
      </div>
      {latestPrefillSummary && (
        <TechStackPrefillBanner
          turn={latestPrefillSummary}
          onReviewClick={handlePrefillReviewClick}
        />
      )}
      {downstreamBanner.length > 0 && (
        <DownstreamCodesBanner
          affectedDownstreamCodes={downstreamBanner}
          onDismiss={() => setDownstreamBanner([])}
        />
      )}
      {/* 2026-06-06 Open-Ended LLM Phase: the OPTIONAL "explore other areas"
          affordance, surfaced STRICTLY post-walk (`phase === 'open-available'`)
          and only until the user engages it. The whole phase is optional — the
          user may ignore this and close via the close flow below, exactly as
          today (preserving the input-bar-hidden post-walk state). */}
      {phase === 'open-available' && !openPhaseEngaged && (
        <div
          className={styles.banner}
          data-testid="architect-conversation-open-phase-available"
        >
          <span>
            You have covered the standard decisions. Want to explore any other
            migration-specific areas, or wrap up with some free-form notes?
          </span>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleEngageOpenPhase()}
            data-testid="architect-conversation-open-phase-engage"
          >
            Explore other areas
          </button>
        </div>
      )}
      <div className={styles.layout}>
        <ConversationMainPane
          turns={envelope.turns}
          pendingQuestion={pendingQuestion}
          pendingCascadeSummary={pendingCascade}
          cascadeBusy={cascadeBusy}
          cascadeError={cascadeError}
          answerBusy={answerBusy}
          answerError={answerError}
          onCaptureAnswer={handleCaptureAnswer}
          onAcceptCascadeAll={handleAcceptCascadeAll}
          onOverrideCascade={handleOverrideCascade}
          onOpenExceptionDialog={openExceptionDialog}
          onAnswerRetry={() => setAnswerError(null)}
          onCascadeRetry={() => setCascadeError(null)}
          confirmedTiers={effectiveTiers}
          onConfirmTiers={setConfirmedTiers}
          scrollToDecisionId={scrollToDecisionId}
          onScrolledToDecision={onScrolledToDecision}
          openPhase={openPhaseState}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <SummaryPanel
            ref={summaryPanelRef}
            decisions={envelope.capturedDecisions}
            onReviseDecision={setReviseDialog}
            onPreviewPromptOutput={() => void handlePreviewPromptOutput()}
          />
          <CloseConversationFlow
            decisions={envelope.capturedDecisions}
            isOpen={hasOpenSession}
            isOwnedByCurrentUser={!!sessionOwnedByMe}
            onClose={handleCloseConversation}
            onRetireAndStartNew={handleRetireAndStartNew}
          />
        </div>
      </div>

      {exceptionDialog && (
        <ExceptionSubDialog
          projectId={projectId}
          targetArchitectureId={selectedTargetArchitectureId}
          decisionCode={exceptionDialog.decisionCode}
          allowedExceptionScopes={exceptionDialog.allowedExceptionScopes}
          scopesUnavailable={exceptionDialog.scopesUnavailable === true}
          onSubmit={handlePinException}
          onCancel={() => setExceptionDialog(null)}
        />
      )}

      {reviseDialog && (
        <RevisePriorAnswerDialog
          decision={reviseDialog}
          onSubmit={handleReviseSubmit}
          onCancel={() => setReviseDialog(null)}
        />
      )}

      {(promptPreview !== null || previewLoading) && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="architect-conversation-prompt-preview"
          onClick={() => setPromptPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 6,
              padding: 16,
              width: 600,
              maxWidth: '90vw',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong>Prompt-ready output (what downstream tasks will read)</strong>
              <button
                type="button"
                onClick={() => setPromptPreview(null)}
                data-testid="architect-conversation-prompt-preview-close"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#1976d2',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                Close
              </button>
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: '0.85rem',
                margin: 0,
                overflow: 'auto',
                background: '#f6f8fa',
                padding: 12,
                borderRadius: 4,
              }}
            >
              {previewLoading ? 'Loading…' : promptPreview}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// The static frontend mirror of the question library exception-scope map
// was removed by the Four-Spec Hardening Pass (2026-05-25), Item 4. The
// scope map is now runtime-fetched from the gateway via
// `fetchQuestionLibraryScopes()` and session-cached in memory; downstream
// consumers that previously imported the static re-export should route
// through this tab's fetch state instead.
