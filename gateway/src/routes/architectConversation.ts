/**
 * Architect Conversation HTTP routes.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Patch
 * between Commit 5 (frontend) and Commit 6 (verification). The original
 * tasks.md missed wiring the HTTP layer; this file fills that gap so the
 * Definition-of-Done can be met end-to-end.
 *
 * Exposes 8 endpoints under
 *   /api/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation
 *
 *   GET    .../architect-conversation                          -> envelope (turns + decisions + currentSession)
 *   POST   .../architect-conversation/open                     -> append `open` turn
 *   POST   .../architect-conversation/close                    -> append `close` turn
 *   POST   .../architect-conversation/answer                   -> coordinator.answerQuestion
 *   POST   .../architect-conversation/cascade/accept-batch     -> orchestrator.acceptCascadeBatch
 *   POST   .../architect-conversation/cascade/override         -> orchestrator.overrideCascade
 *   POST   .../architect-conversation/revise                   -> orchestrator.revisePriorAnswer
 *   POST   .../architect-conversation/exception                -> orchestrator.pinException
 *
 * Open-phase capture path (Spec 2026-06-06-architect-conversation-open-ended-
 * phase, Task Group 4) adds five `/open-phase/*` routes — see the section near
 * the foot of this file. They are DISTINCT from `/answer` + `/capture` (which
 * hard-404 on non-library decision codes via `findEntry`); the open-phase rows
 * carry `adhoc.<slug>` / `note.<slug>` codes that CANNOT flow through those.
 *
 * Each handler is a thin pass-through into the existing coordinator /
 * orchestrator (Commits 3 + 4 already implement the behaviour and carry the
 * full backend test coverage). The routes parse path params and JSON body,
 * delegate to the orchestrator, and return the structured result.
 *
 * Error policy (per the patch brief):
 *   - Missing / malformed required body fields  -> 400 { error: <message> }
 *   - Cross-project / target-not-found surfaces -> propagated as the upstream
 *     status (the captured-decisions writer throws `CapturedDecisionsWriteError`
 *     carrying the AMS status; we re-emit it verbatim so 404 / 409 round-trip)
 *   - Any other orchestrator throw              -> 500 { error: <message> }
 *
 * LLM client: no production `ArchitectLlmClient` is wired anywhere in the
 * gateway yet (Commit 5 implementer flagged this). The `/answer` handler
 * uses a small adapter (`buildArchitectLlmClient`) that bridges to the
 * gateway-default `getLlmClient()` so the production flow has *something*
 * to call. Tests / smoke runs that want to short-circuit can swap the deps
 * by importing `setArchitectConversationDeps` from this module.
 *
 * Mount point: `/api` -- same pattern as `targetArchitecturesRouter`.
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { QUESTION_LIBRARY, type QuestionLibraryEntry } from '../config/architect-conversation/questionLibrary';
import {
  selectNextQuestion,
  toPendingQuestionDto,
} from '../services/architectConversation/questionSequencer';
import { buildTargetStateDecisionsPromptText } from '../services/contextResolvers';
import {
  answerQuestion as coordinatorAnswerQuestion,
  appendTierConfirmationTurn,
  beginOpenPhase,
  captureDeterministicAnswer,
  defaultCoordinatorDeps,
  discuss as openPhaseDiscuss,
  preparePick as openPhasePreparePick,
  raiseTopic as openPhaseRaiseTopic,
  summariseDiscussion as openPhaseSummariseDiscussion,
  type AnswerQuestionArgs,
  type AnswerQuestionOutcome,
  type CoordinatorDeps,
  type OpenPhaseLoopInputs,
} from '../services/architectConversation/architectConversationCoordinator';
import {
  defaultDecisionCaptureOrchestrator,
  type DecisionCaptureOrchestrator,
} from '../services/architectConversation/decisionCaptureOrchestrator';
import {
  defaultMappingMutationOrchestrator,
  type MappingMutationOrchestrator,
} from '../services/architectConversation/mappingMutationOrchestrator';
import {
  appendTurn as defaultAppendTurn,
  loadTargetStateConversation,
} from '../services/targetStateConversationStore';
import {
  fetchLatestCapturedDecisions,
  stampConversationSaved as defaultStampConversationSaved,
  type TargetStateCapturedDecision,
} from '../services/targetStateCapturedDecisionsClient';
import type {
  ArchitectChatMessage,
  ArchitectLlmClient,
  ArchitectToolCall,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
  CallSingleShotOptions,
  CallSingleShotResponse,
  SingleShotPrompt,
} from '../services/architectConversation/architectLlmClient';
import { SingleShotLlmCallError } from '../services/architectConversation/architectLlmClient';
import { getLlmClient } from '../services/llmClient';
import type { OpenAIMessage, ChatRequestOptions } from '../services/openaiClient';
import {
  CapturedDecisionsWriteError,
  postCapturedDecision as defaultPostCapturedDecision,
} from '../services/architectConversation/targetStateCapturedDecisionsWriter';
import {
  ADHOC_DECISION_CREATED_BY_TASK,
  NOTE_CREATED_BY_TASK,
  noteCode,
} from '../services/architectConversation/openPhaseCodes';
import {
  resolveOpenPhaseGrounding as defaultResolveOpenPhaseGrounding,
} from '../services/architectConversation/resolveOpenPhaseGrounding';
import type {
  CloseReason,
  CloseTurn,
  ConversationPhase,
  ConversationTurn,
  DecisionCapturedTurn,
  DecisionScope,
  FreeFormDiscussionTurn,
  OpenTurn,
  TierConfirmationTurn,
} from '../services/architectConversation/turnShape';
import type { ScopeRefType } from '../config/architect-conversation/questionLibrary';
import { ALLOWED_SCOPE_REF_TYPES } from '../config/architect-conversation/loadConfigs';
import { logger } from '../services/logger';
import {
  runOpenTurnTechStackPrefill,
  type OpenTurnTechStackPrefillDeps,
  defaultOpenTurnTechStackPrefillDeps,
} from '../services/architectConversation/openTurnTechStackPrefill';
import { evaluateRelevance } from '../services/architectConversation/relevanceEvaluator';
import type { RelevanceContext } from '../config/architect-conversation/questionLibrary';
import { fetchProductName } from '../services/architectureModelClient';
import {
  writeTargetTechStackMarkdown,
  defaultWriteTargetTechStackDeps,
  type WriteTargetTechStackDeps,
} from '../services/architectConversation/writeTargetTechStackMarkdown';
import { registerTargetManifestUploadRoute } from './targetManifestUpload';
import { registerDecisionsFileImportRoute } from './decisionsFileImport';

// ---------------------------------------------------------------------------
// Injectable dependency container (test seam).
//
// Production wiring uses the default coordinator + default orchestrators.
// Tests can swap any of these via `setArchitectConversationDeps`.
// ---------------------------------------------------------------------------

interface ArchitectConversationRouteDeps {
  coordinatorDeps: CoordinatorDeps;
  decisionCaptureOrchestrator: DecisionCaptureOrchestrator;
  mappingMutationOrchestrator: MappingMutationOrchestrator;
  appendTurn: typeof defaultAppendTurn;
  loadConversation: typeof loadTargetStateConversation;
  loadCapturedDecisions: typeof fetchLatestCapturedDecisions;
  llmClient: ArchitectLlmClient;
  /**
   * Tech-stack pre-fill orchestrator deps (Spec 2026-05-25, Task Group 3).
   * Production wiring uses the default deps; tests override the loader, the
   * POST writer, and the prefill function to avoid real HTTP / filesystem
   * calls.
   */
  openTurnPrefillDeps: OpenTurnTechStackPrefillDeps;
  /**
   * Target-tech-stack writer deps (Spec 2026-05-25, Task Group 4).
   * Production wiring uses the default deps; tests override filesystem
   * primitives + AMS calls to keep close-turn tests hermetic.
   */
  writeTargetTechStackDeps: WriteTargetTechStackDeps;
  /**
   * Conversation-saved stamp client (Spec 2026-06-26, Task Group 3). The close
   * handler calls this AFTER the CloseTurn append + tech-stack write to stamp
   * `conversation_saved_at` on the target architecture. Fail-soft + additive:
   * a throw is surfaced on the close payload without aborting the close turn.
   * Tests override it to avoid a real AMS call.
   */
  stampConversationSaved: typeof defaultStampConversationSaved;
  /**
   * Open-phase capture-path deps (Spec 2026-06-06-architect-conversation-open-
   * ended-phase, Task Group 4). `postCapturedDecision` is the AMS writer
   * boundary (reused VERBATIM) for both `adhoc.<slug>` decision rows and
   * `note.<slug>` note rows; `resolveOpenPhaseGrounding` assembles the grounding
   * (Task Group 2 composer + the fetch shell). Tests stub both to keep the
   * open-phase route tests hermetic + LLM-mocked at the `ArchitectLlmClient`
   * boundary.
   */
  postCapturedDecision: typeof defaultPostCapturedDecision;
  resolveOpenPhaseGrounding: typeof defaultResolveOpenPhaseGrounding;
}

let deps: ArchitectConversationRouteDeps = {
  coordinatorDeps: defaultCoordinatorDeps,
  decisionCaptureOrchestrator: defaultDecisionCaptureOrchestrator,
  mappingMutationOrchestrator: defaultMappingMutationOrchestrator,
  appendTurn: defaultAppendTurn,
  loadConversation: loadTargetStateConversation,
  loadCapturedDecisions: fetchLatestCapturedDecisions,
  llmClient: buildArchitectLlmClient(),
  openTurnPrefillDeps: defaultOpenTurnTechStackPrefillDeps,
  writeTargetTechStackDeps: defaultWriteTargetTechStackDeps,
  stampConversationSaved: defaultStampConversationSaved,
  postCapturedDecision: defaultPostCapturedDecision,
  resolveOpenPhaseGrounding: defaultResolveOpenPhaseGrounding,
};

/**
 * Test seam -- swap any subset of route-level dependencies. Production code
 * never calls this. The router itself reads `deps` lazily on every request,
 * so re-binding here takes effect immediately.
 */
export function setArchitectConversationDeps(
  patch: Partial<ArchitectConversationRouteDeps>,
): void {
  deps = { ...deps, ...patch };
}

/** Reset back to the production defaults (test-only convenience). */
export function resetArchitectConversationDeps(): void {
  deps = {
    coordinatorDeps: defaultCoordinatorDeps,
    decisionCaptureOrchestrator: defaultDecisionCaptureOrchestrator,
    mappingMutationOrchestrator: defaultMappingMutationOrchestrator,
    appendTurn: defaultAppendTurn,
    loadConversation: loadTargetStateConversation,
    loadCapturedDecisions: fetchLatestCapturedDecisions,
    llmClient: buildArchitectLlmClient(),
    openTurnPrefillDeps: defaultOpenTurnTechStackPrefillDeps,
    writeTargetTechStackDeps: defaultWriteTargetTechStackDeps,
    stampConversationSaved: defaultStampConversationSaved,
    postCapturedDecision: defaultPostCapturedDecision,
    resolveOpenPhaseGrounding: defaultResolveOpenPhaseGrounding,
  };
}

// ---------------------------------------------------------------------------
// LLM bridge -- wraps the gateway's default `getLlmClient()` into the
// `ArchitectLlmClient` shape the loop runner expects. This is the only piece
// of production wiring this patch introduces; everything else is a re-use of
// the Commit-3/4 orchestrators.
//
// The bridge translates ArchitectChatMessage -> OpenAIMessage and unpacks the
// OpenAIResponse back into an ArchitectAssistantMessage. Tool definitions /
// tool-choice are forwarded via the existing `ChatRequestOptions.tools`
// surface (cast through `unknown` because the architect tool-definition shape
// is structurally compatible with the gateway-wide `ToolDefinition` but the
// nominal types live in separate files).
// ---------------------------------------------------------------------------

export function buildArchitectLlmClient(): ArchitectLlmClient {
  return {
    callLlmToolLoop: async (
      args: CallLlmToolLoopArgs,
    ): Promise<CallLlmToolLoopResponse> => {
      const llm = getLlmClient();
      const openaiMessages: OpenAIMessage[] = args.messages.map(
        (m: ArchitectChatMessage) => ({
          role: m.role,
          content: m.content ?? '',
          tool_call_id: m.tool_call_id,
          tool_calls: m.tool_calls,
        }),
      );
      const options: ChatRequestOptions = {
        tools: args.tools as unknown as ChatRequestOptions['tools'],
        toolChoice: args.toolChoice as unknown as ChatRequestOptions['toolChoice'],
      };
      const response = await llm.sendChatRequest(
        openaiMessages,
        `architect-conv-${uuidv4()}`,
        `architect-conv-session-${uuidv4()}`,
        options,
      );
      // OpenAIResponse.toolCalls uses the gateway-wide ToolCall shape
      // ({ name, arguments: Record, callId }); the architect-side wire shape
      // is the raw OpenAI tool-call envelope ({ id, type, function }). Map
      // back through the architect shape -- arguments must round-trip as a
      // JSON-serialised string.
      const archToolCalls: ArchitectToolCall[] | undefined = response.toolCalls?.map(
        (tc) => ({
          id: tc.callId,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        }),
      );
      return {
        message: {
          role: 'assistant',
          content: response.content ?? null,
          tool_calls: archToolCalls,
        },
      };
    },
    callSingleShot: async (
      prompt: SingleShotPrompt,
      _options?: CallSingleShotOptions,
    ): Promise<CallSingleShotResponse> => {
      // Translate the system+user prompt pair into the gateway-wide OpenAI
      // message shape. No tool calls are issued and no tool definitions
      // forwarded -- the pre-fill flow is a synchronous request/response.
      const llm = getLlmClient();
      const openaiMessages: OpenAIMessage[] = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];
      try {
        const response = await llm.sendChatRequest(
          openaiMessages,
          `architect-conv-prefill-${uuidv4()}`,
          `architect-conv-prefill-session-${uuidv4()}`,
          {},
        );
        return { content: response.content ?? '' };
      } catch (err) {
        throw new SingleShotLlmCallError(
          `Single-shot tech-stack pre-fill call failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------

export const architectConversationRouter = Router();

// ---------------------------------------------------------------------------
// Spec 2026-06-24-target-dependency-manifest-auto-answer (Spec 3, Task Group 1):
// mount the target dependency-manifest upload route ALONGSIDE the conversation
// routes on this same router (no new top-level mount, no new captured-decision
// endpoint). Full path:
//   POST /api/projects/:projectId/target-architectures/:targetArchitectureId/target-manifests
// ---------------------------------------------------------------------------
registerTargetManifestUploadRoute(architectConversationRouter);

// Spec 2026-06-26-target-state-decisions-file-import (Spec 3): the decisions-file
// import route mounts ALONGSIDE the manifest route on this same router. Full path:
//   POST /api/projects/:projectId/target-architectures/:targetArchitectureId/decisions-file-import
registerDecisionsFileImportRoute(architectConversationRouter);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sendError(
  res: ExpressResponse,
  status: number,
  message: string,
): void {
  res.status(status).json({ error: message });
}

/**
 * Translate an orchestrator throw into an HTTP status + JSON body. Captured-
 * decisions write failures carry the AMS upstream status so 404 / 409 round-
 * trip; everything else maps to 500.
 */
function handleOrchestratorError(
  res: ExpressResponse,
  err: unknown,
  route: string,
  extra: Record<string, string>,
): void {
  if (err instanceof CapturedDecisionsWriteError) {
    logger.warn(`architect-conversation: AMS write failed (${route})`, {
      ...extra,
      status: err.status,
      body: err.bodyText.slice(0, 200),
    });
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`architect-conversation: orchestrator failed (${route})`, {
    ...extra,
    error: message,
  });
  res.status(500).json({ error: message });
}

function findEntry(decisionCode: string): QuestionLibraryEntry | undefined {
  return QUESTION_LIBRARY.find((e) => e.code === decisionCode);
}

type RequireStringResult = string | { errorMessage: string };

function requireString(value: unknown, name: string): RequireStringResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { errorMessage: `Missing or invalid '${name}' (expected non-empty string)` };
  }
  return value;
}

function isScopeRefType(value: unknown): value is ScopeRefType {
  return (
    typeof value === 'string' &&
    (ALLOWED_SCOPE_REF_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Question Library scopes projection
// ---------------------------------------------------------------------------
//
// Four-Spec Hardening Pass (2026-05-25), Item 4.
//
// Projects the question library's per-entry `allowedExceptionScopes` field
// into a flat map keyed by decision code:
//
//   { <decisionCode>: { allowedExceptionScopes: ScopeRefType[] } }
//
// The frontend Architect Conversation tab fetches this map on mount via
// `GET /api/architect-conversation/question-library/scopes` to replace the
// hand-mirrored frontend constant (the static file
// `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts`
// is deleted as part of this commit).
//
// The QUESTION_LIBRARY constant is frozen at module load (it is a TS literal
// with all entries declared at file-scope) so the projection is computed
// exactly once below; second and subsequent endpoint calls hit the cached
// value with no recomputation.

interface QuestionLibraryScopeEntry {
  allowedExceptionScopes: ScopeRefType[];
}

type QuestionLibraryScopeMap = Record<string, QuestionLibraryScopeEntry>;

function projectQuestionLibraryScopes(): QuestionLibraryScopeMap {
  const out: QuestionLibraryScopeMap = {};
  for (const entry of QUESTION_LIBRARY) {
    // Spread the readonly array into a mutable copy so JSON serialisation
    // produces a plain array; the wire contract does not promise
    // `readonly`-ness.
    out[entry.code] = {
      allowedExceptionScopes: [...entry.allowedExceptionScopes],
    };
  }
  return out;
}

/**
 * Module-load-time projection of the question library's exception-scope map.
 * Frozen at first compute -- the gateway question library is a frozen TS
 * constant and only changes on edit + redeploy, so a session-cached
 * projection is safe.
 */
const QUESTION_LIBRARY_SCOPES_CACHE: QuestionLibraryScopeMap =
  projectQuestionLibraryScopes();

// ---------------------------------------------------------------------------
// GET /api/architect-conversation/question-library/scopes
//
// Four-Spec Hardening Pass (2026-05-25), Item 4. Returns the projected
// scope map from the gateway question library so the frontend no longer
// needs a hand-mirrored constant. Uses whatever middleware
// `architectConversationRouter` already applies -- no special auth, no
// rate-limit overrides (matches the existing convention; see Q4 of the
// hardening pass spec).
//
// The URL deliberately omits a `/v1/` prefix per Q10 of the spec; the
// gateway's existing `/api/...` convention applies.
// ---------------------------------------------------------------------------

architectConversationRouter.get(
  '/architect-conversation/question-library/scopes',
  (_req: Request, res: ExpressResponse) => {
    // Second and subsequent calls hit the module-load cache directly. The
    // projection itself is computed exactly once above; this handler simply
    // serialises the cached object.
    res.status(200).json(QUESTION_LIBRARY_SCOPES_CACHE);
  },
);

// ---------------------------------------------------------------------------
// GET .../architect-conversation
//
// Loads the conversation thread + the latest captured decisions and returns
// the envelope shape the frontend client expects (matches
// `ConversationEnvelope` in `frontend/src/api/architectConversationApi.ts`).
//
// `currentSession` is derived by walking the turns: the most recent `open`
// turn whose `sessionId` is NOT followed by a matching `close` turn is the
// active session. When no `open` turn has ever been written, `currentSession`
// is null.
// ---------------------------------------------------------------------------

architectConversationRouter.get(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    try {
      const [thread, decisions] = await Promise.all([
        deps.loadConversation(projectId, targetArchitectureId),
        deps.loadCapturedDecisions(projectId, targetArchitectureId).catch((err) => {
          // Fail-soft on the decisions fetch -- a freshly-created target with
          // no rows surfaces as an empty list. Network failures are logged
          // and we return an empty list so the transcript still renders.
          logger.warn(
            'architect-conversation: captured-decisions fetch failed; returning empty list',
            {
              projectId,
              targetArchitectureId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          return [] as TargetStateCapturedDecision[];
        }),
      ]);

      const currentSession = deriveCurrentSession(thread.turns);
      const capturedDecisionRows = decisions.map(mapCapturedDecisionRow);

      res.status(200).json({
        threadId: thread.threadId,
        turns: thread.turns,
        currentSession,
        capturedDecisions: capturedDecisionRows,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'load-conversation', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET .../architect-conversation/next-question
//
// The question-driver the original feature was missing. Given the codes already
// captured (answered / auto-skipped / pre-filled) it returns the NEXT question
// the architect should answer — honouring intra-group ordering and per-question
// relevance — or `{ question: null }` when the walk is complete. The frontend
// calls this on open and after each captured answer to drive the conversation;
// the actual answer submission still goes through the existing /answer route.
//
// Spec 2026-06-05-architect-tier-gating (Half B): three TECHNOLOGY-tier query
// params gate the walk — `?hasUiTier` (Group E), `?hasServiceTier` (Groups
// A/B/D/H), `?hasPersistenceTier` (Group C). Each defaults to true (FAIL-OPEN):
// a group is dropped ONLY when its tier is explicitly `false`, so nothing is
// wrongly skipped when a flag is absent/unknown. (This replaces the former
// single `?hasUiScreens` param, which is now folded into `?hasUiTier`.)
// ---------------------------------------------------------------------------

architectConversationRouter.get(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/next-question',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    // Read the three tier flags, each defaulting true (fail-open): only an
    // explicit `=false` skips that tier's group(s).
    const hasUiTier = req.query.hasUiTier !== 'false';
    const hasServiceTier = req.query.hasServiceTier !== 'false';
    const hasPersistenceTier = req.query.hasPersistenceTier !== 'false';
    try {
      const decisions = await deps
        .loadCapturedDecisions(projectId, targetArchitectureId)
        .catch((err) => {
          logger.warn(
            'architect-conversation next-question: captured-decisions fetch failed; treating as none',
            {
              projectId,
              targetArchitectureId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          return [] as TargetStateCapturedDecision[];
        });
      const answeredCodes = new Set(decisions.map((d) => d.decisionCode));
      const next = selectNextQuestion({
        answeredCodes,
        relevanceContext: {
          hasUiTier,
          hasServiceTier,
          hasPersistenceTier,
        },
      });
      // Phase signal (Spec 2026-06-06-architect-conversation-open-ended-phase,
      // S2): `open-available` STRICTLY when the deterministic preset walk is
      // exhausted (`selectNextQuestion` -> null); `preset-walk` while a
      // question is still returned. NO separate phase endpoint — the signal
      // rides this `next-question` response.
      const phase: ConversationPhase =
        next === null ? 'open-available' : 'preset-walk';
      res.status(200).json({
        question: next ? toPendingQuestionDto(next) : null,
        phase,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'next-question', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET .../architect-conversation/prompt-ready-output
//
// Backs the SummaryPanel "Preview prompt-ready output" link. Returns the
// grouped-by-scope, prompt-ready markdown that downstream Product-Manager tasks
// will consume — a faithful dry-run of what the captured decisions look like to
// the LLM right now. Scoped to the route's targetArchitectureId (the draft being
// authored), so it works before the draft is promoted to active.
// ---------------------------------------------------------------------------

architectConversationRouter.get(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/prompt-ready-output',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    try {
      const decisions = await deps
        .loadCapturedDecisions(projectId, targetArchitectureId)
        .catch(() => [] as TargetStateCapturedDecision[]);
      const promptReadyOutput =
        !decisions || decisions.length === 0
          ? 'no decisions captured yet'
          : buildTargetStateDecisionsPromptText(decisions);
      res.status(200).json({ promptReadyOutput });
    } catch (err) {
      handleOrchestratorError(res, err, 'prompt-ready-output', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

/**
 * Walk the turn sequence and return the most recent session marker. We track
 * close events by `sessionId` so a synthetic retire-then-open pair correctly
 * surfaces the new open session as current.
 *
 * `openedAt` is not persisted on the OpenTurn shape -- we surface the load-
 * time timestamp as a fallback. The frontend treats `openedAt` as informational
 * (display only); functional decisions key off `sessionId` + `openedBy`.
 */
function deriveCurrentSession(turns: unknown[]): {
  sessionId: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
} | null {
  const closed = new Set<string>();
  let lastOpen: OpenTurn | null = null;
  for (const t of turns) {
    if (!t || typeof t !== 'object') continue;
    const turn = t as ConversationTurn;
    if (turn.kind === 'close') {
      closed.add(turn.sessionId);
    } else if (turn.kind === 'open') {
      lastOpen = turn;
    }
  }
  if (!lastOpen) return null;
  const status: 'open' | 'closed' = closed.has(lastOpen.sessionId) ? 'closed' : 'open';
  return {
    sessionId: lastOpen.sessionId,
    status,
    openedBy: lastOpen.openedBy,
    openedAt: new Date().toISOString(),
  };
}

function mapCapturedDecisionRow(d: TargetStateCapturedDecision): {
  decisionId: string;
  decisionCode: string;
  scopeKind: 'architecture' | 'element';
  scopeRefType: ScopeRefType | null;
  scopeRefId: string | null;
  answerValue: string;
  answerSummary: string | null;
  standardsLookupRef: string | null;
  supersededById: string | null;
  createdByTask: string;
} {
  return {
    decisionId: d.decisionId,
    decisionCode: d.decisionCode,
    scopeKind: d.scopeKind === 'element' ? 'element' : 'architecture',
    scopeRefType: isScopeRefType(d.scopeRefType) ? d.scopeRefType : null,
    scopeRefId: d.scopeRefId ?? null,
    answerValue: d.answerValue,
    answerSummary: d.answerSummary ?? null,
    standardsLookupRef: d.standardsLookupRef ?? null,
    supersededById: d.supersededById ?? null,
    // 2026-05-25 Tech-Stack.md Pre-fill (Task Group 5): surface the audit
    // attribute so the SummaryPanel can identify pre-fill rows
    // (created_by_task === 'tech-stack-md-prefill') and unwrap their
    // answer_value JSON to show the source quote in the review surface.
    createdByTask: d.createdByTask,
  };
}

// ---------------------------------------------------------------------------
// POST .../architect-conversation/open
//
// Generates a fresh sessionId, appends an `open` turn carrying it +
// `openedBy`, and returns both to the caller so the UI can pin the session
// for subsequent calls.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/open',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const openedByResult = requireString(body.openedBy, 'openedBy');
    if (typeof openedByResult !== 'string') {
      return sendError(res, 400, openedByResult.errorMessage);
    }

    // Optional relevance-context body field. The open-turn pre-fill
    // (Spec 2026-05-25) runs auto-skip BEFORE pre-fill (per Q13) over this
    // context. Spec 2026-06-05-architect-tier-gating (Half B): read all three
    // TECHNOLOGY-tier flags the frontend now sends on
    // `body.relevanceContext` — each defaulting true (FAIL-OPEN) when
    // absent/non-boolean, so a group is dropped ONLY when its tier is an
    // explicit `false`. (The former single `hasUiScreens` field is folded into
    // `hasUiTier`.) The tier-confirmation turn is appended below from this set.
    const relevanceBody = body.relevanceContext as
      | Record<string, unknown>
      | undefined;
    const tierFlag = (value: unknown): boolean =>
      typeof value === 'boolean' ? value : true;
    const relevanceContext: RelevanceContext = {
      hasUiTier: tierFlag(relevanceBody?.hasUiTier),
      hasServiceTier: tierFlag(relevanceBody?.hasServiceTier),
      hasPersistenceTier: tierFlag(relevanceBody?.hasPersistenceTier),
    };

    try {
      const sessionId = uuidv4();
      const openTurn: OpenTurn = {
        kind: 'open',
        sessionId,
        openedBy: openedByResult,
      };
      await deps.appendTurn(projectId, targetArchitectureId, openTurn);

      // -----------------------------------------------------------------
      // Spec 2026-06-05-architect-tier-gating (Half B): append the
      // tier-confirmation turn immediately after the open turn and BEFORE the
      // first question (parallel to the Discovery Review Room open-turn step).
      // It carries the supplied (or all-true default) tier set; the derived +
      // confirmed sets seed identical. Emitted exactly once per open here
      // (Task 2.4 coordinates the helper; this is the single call site).
      // -----------------------------------------------------------------
      const tierConfirmationTurn: TierConfirmationTurn =
        await appendTierConfirmationTurn(
          projectId,
          targetArchitectureId,
          relevanceContext,
          deps.appendTurn,
        );

      // -----------------------------------------------------------------
      // Spec 2026-05-25 Task Group 3: run the tech-stack pre-fill after the
      // open turn is appended.
      //   1. Auto-skip first -- filter the library to only the codes whose
      //      relevance predicate evaluates true under the supplied context.
      //   2. Run `runOpenTurnTechStackPrefill` over the auto-skip-relevant
      //      codes. The orchestrator handles loader / LLM / POST / banner.
      //
      // Pre-fill is fail-soft -- any failure routes to a banner turn the
      // frontend renders; the open-turn response itself still succeeds.
      // -----------------------------------------------------------------
      const candidateDecisions = QUESTION_LIBRARY
        .filter((entry) => evaluateRelevance(entry, relevanceContext).relevant)
        .map((entry) => ({
          code: entry.code,
          prompt: entry.prompt,
          expectedAnswerShape: entry.expectedAnswerShape,
          choices: entry.choices,
        }));

      // Best-effort project name lookup for the prompt context. Failure is
      // non-fatal -- the pre-fill orchestrator falls back to "(unknown)".
      let projectName: string | null = null;
      try {
        projectName = await fetchProductName(projectId);
      } catch (lookupErr) {
        logger.debug('open-turn pre-fill: fetchProductName failed; using null', {
          projectId,
          error: lookupErr instanceof Error ? lookupErr.message : 'Unknown error',
        });
      }

      let prefillSummaryTurn: unknown = null;
      try {
        const thread = await deps.loadConversation(projectId, targetArchitectureId);
        const prefillOutcome = await runOpenTurnTechStackPrefill(
          {
            projectId,
            targetArchitectureId,
            conversationThreadId: thread.threadId,
            candidateDecisions,
            projectContext: {
              projectName,
              currentArchitectureId: null,
              targetArchitectureId,
            },
            llmClient: deps.llmClient,
          },
          deps.openTurnPrefillDeps,
        );
        prefillSummaryTurn = prefillOutcome.summaryTurn;
      } catch (prefillErr) {
        // Fail-soft: pre-fill should never abort the open-turn endpoint.
        logger.warn('open-turn pre-fill: unexpected error; open turn still succeeds', {
          projectId,
          targetArchitectureId,
          error: prefillErr instanceof Error ? prefillErr.message : 'Unknown error',
        });
      }

      res
        .status(200)
        .json({ sessionId, openTurn, tierConfirmationTurn, prefillSummaryTurn });
    } catch (err) {
      handleOrchestratorError(res, err, 'open-conversation', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/close
//
// Appends a `close` turn carrying the caller-supplied `sessionId`,
// `closeReason`, and `summaryMarkdown`. Per Q16 the summaryMarkdown is
// embedded inline so any later read of the transcript is self-contained.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/close',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    const closeReason = body.closeReason;
    if (
      closeReason !== 'completed-by-user' &&
      closeReason !== 'retired-by-other-user'
    ) {
      return sendError(
        res,
        400,
        "Missing or invalid 'closeReason' (expected 'completed-by-user' or 'retired-by-other-user')",
      );
    }
    const summaryMarkdownResult = requireString(body.summaryMarkdown, 'summaryMarkdown');
    if (typeof summaryMarkdownResult !== 'string') {
      return sendError(res, 400, summaryMarkdownResult.errorMessage);
    }
    try {
      const closeTurn: CloseTurn = {
        kind: 'close',
        sessionId: sessionIdResult,
        closeReason: closeReason as CloseReason,
        summaryMarkdown: summaryMarkdownResult,
      };
      await deps.appendTurn(projectId, targetArchitectureId, closeTurn);

      // --------------------------------------------------------------
      // Spec 2026-05-25 Task Group 4: write the deterministic
      // target-tech-stack-<id>.md file. File only written on close (per
      // Q16); write failure surfaces a clean error on the close-turn
      // payload without aborting the rest of the close turn.
      // --------------------------------------------------------------
      let targetTechStackWrite: unknown = null;
      try {
        targetTechStackWrite = await writeTargetTechStackMarkdown(
          { projectId, targetArchitectureId },
          deps.writeTargetTechStackDeps,
        );
      } catch (writeErr) {
        // Defensive fail-soft -- the writer itself returns typed outcomes
        // for known failure modes; only truly unexpected throws end up here.
        logger.warn('close-turn target-tech-stack write threw unexpectedly; close still succeeds', {
          projectId,
          targetArchitectureId,
          error: writeErr instanceof Error ? writeErr.message : 'Unknown error',
        });
        targetTechStackWrite = {
          kind: 'failed',
          reason: writeErr instanceof Error ? writeErr.message : String(writeErr),
          path: null,
        };
      }

      // --------------------------------------------------------------
      // Spec 2026-06-26 Task Group 3: stamp `conversation_saved_at` so the
      // plan can source this saved conversation independently of "active".
      // Fail-soft + additive (matches the tech-stack-write pattern): a stamp
      // failure is reported on the close payload WITHOUT aborting the close
      // turn -- the CloseTurn + tech-stack write have already succeeded.
      // --------------------------------------------------------------
      let conversationSavedStamp: unknown = null;
      try {
        const stamped = await deps.stampConversationSaved(projectId, targetArchitectureId);
        conversationSavedStamp = {
          kind: 'saved',
          conversationSavedAt: stamped.conversationSavedAt,
        };
      } catch (stampErr) {
        logger.warn('close-turn conversation-saved stamp failed; close still succeeds', {
          projectId,
          targetArchitectureId,
          error: stampErr instanceof Error ? stampErr.message : 'Unknown error',
        });
        conversationSavedStamp = {
          kind: 'failed',
          reason: stampErr instanceof Error ? stampErr.message : String(stampErr),
          conversationSavedAt: null,
        };
      }

      res.status(200).json({ closeTurn, targetTechStackWrite, conversationSavedStamp });
    } catch (err) {
      handleOrchestratorError(res, err, 'close-conversation', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/answer
//
// Per-question entry point. Looks up the library entry by `decisionCode`,
// loads the conversation thread to source `conversationThreadId`, and
// delegates to the coordinator's `answerQuestion`. The coordinator handles
// the LLM loop, captures the decision via Spec 2's POST, applies mapping
// mutations, and appends all surfaced turns.
//
// Returns the same outcome envelope shape the coordinator produces, mapped to
// the frontend's `AnswerQuestionResponse` discriminator (`outcome` field).
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/answer',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    const decisionCodeResult = requireString(body.decisionCode, 'decisionCode');
    if (typeof decisionCodeResult !== 'string') {
      return sendError(res, 400, decisionCodeResult.errorMessage);
    }
    const userResponseResult = requireString(body.userResponse, 'userResponse');
    if (typeof userResponseResult !== 'string') {
      return sendError(res, 400, userResponseResult.errorMessage);
    }
    const entry = findEntry(decisionCodeResult);
    if (!entry) {
      return sendError(
        res,
        404,
        `Question library entry not found for decisionCode='${decisionCodeResult}'`,
      );
    }
    try {
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const args: AnswerQuestionArgs = {
        projectId,
        targetArchitectureId,
        sessionId: sessionIdResult,
        conversationThreadId: thread.threadId,
        entry,
        userResponse: userResponseResult,
        capturedDecisionsContext: '',
        inlineCascadeSeedMap: JSON.stringify(entry.cascades),
        llmClient: deps.llmClient,
      };
      const outcome: AnswerQuestionOutcome = await coordinatorAnswerQuestion(
        args,
        deps.coordinatorDeps,
      );
      res.status(200).json(mapAnswerOutcomeToWire(outcome));
    } catch (err) {
      handleOrchestratorError(res, err, 'answer', {
        projectId,
        targetArchitectureId,
        decisionCode: decisionCodeResult,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/capture
//
// Deterministic answer capture for the click-to-answer UI (2026-06-01). The
// frontend sends the EXACT value the user chose -- a single option (string), a
// multi-choice selection (string[]), a custom value (string), or an opt-out
// marker -- and we capture it directly with NO LLM round-trip. Returns the same
// wire envelope as /answer (outcome: captured | error), so cascades surface
// identically. Values are trusted verbatim (custom + opt-out deliberately
// bypass the closed-choice set).
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/capture',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    const decisionCodeResult = requireString(body.decisionCode, 'decisionCode');
    if (typeof decisionCodeResult !== 'string') {
      return sendError(res, 400, decisionCodeResult.errorMessage);
    }
    const rawValue = body.value;
    const valueIsString = typeof rawValue === 'string' && rawValue.length > 0;
    const valueIsStringArray =
      Array.isArray(rawValue) &&
      rawValue.length > 0 &&
      rawValue.every((v) => typeof v === 'string');
    if (!valueIsString && !valueIsStringArray) {
      return sendError(
        res,
        400,
        "Missing or invalid 'value' (expected a non-empty string or string[])",
      );
    }
    const value = rawValue as string | string[];
    const answerText =
      typeof body.answerText === 'string' && body.answerText.length > 0
        ? body.answerText
        : Array.isArray(value)
          ? value.join(', ')
          : value;
    const entry = findEntry(decisionCodeResult);
    if (!entry) {
      return sendError(
        res,
        404,
        `Question library entry not found for decisionCode='${decisionCodeResult}'`,
      );
    }
    try {
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const outcome: AnswerQuestionOutcome = await captureDeterministicAnswer(
        {
          projectId,
          targetArchitectureId,
          sessionId: sessionIdResult,
          conversationThreadId: thread.threadId,
          entry,
          value,
          answerText,
        },
        deps.coordinatorDeps,
      );
      res.status(200).json(mapAnswerOutcomeToWire(outcome));
    } catch (err) {
      handleOrchestratorError(res, err, 'capture', {
        projectId,
        targetArchitectureId,
        decisionCode: decisionCodeResult,
      });
    }
  },
);

function mapAnswerOutcomeToWire(outcome: AnswerQuestionOutcome): Record<string, unknown> {
  if (outcome.kind === 'skipped') {
    return {
      outcome: 'skipped',
      systemSkipTurn: outcome.systemSkipTurn,
    };
  }
  if (outcome.kind === 'error') {
    return {
      outcome: 'error',
      questionTurn: outcome.questionTurn,
      answerTurn: outcome.answerTurn,
      errorTurn: outcome.errorTurn,
    };
  }
  // captured
  return {
    outcome: 'captured',
    questionTurn: outcome.questionTurn,
    answerTurn: outcome.answerTurn,
    decisionCapturedTurn: outcome.decisionCapturedTurn,
    cascadeSummaryTurn: outcome.cascadeSummaryTurn,
    mappingMutationSummaryTurn: outcome.mappingMutationSummaryTurn,
  };
}

// ---------------------------------------------------------------------------
// POST .../architect-conversation/cascade/accept-batch
//
// Forwards to the decision-capture orchestrator's `acceptCascadeBatch`. The
// orchestrator writes N rows sharing one `conversation_turn_ref` value (per
// Q10) and appends the `cascade-accepted` turn.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/cascade/accept-batch',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    // `parentDecisionId` carries through the wire contract for symmetry with
    // the frontend client. We do not need to forward it to the orchestrator --
    // the shared `conversation_turn_ref` is generated server-side.
    const proposals = body.proposals;
    if (!Array.isArray(proposals)) {
      return sendError(res, 400, "Missing or invalid 'proposals' (expected an array)");
    }
    for (const p of proposals) {
      if (
        !p ||
        typeof p !== 'object' ||
        typeof (p as Record<string, unknown>).decisionCode !== 'string' ||
        typeof (p as Record<string, unknown>).sourceStandardId !== 'string'
      ) {
        return sendError(
          res,
          400,
          'Each proposal must include decisionCode + sourceStandardId (proposedValue may be any JSON value)',
        );
      }
    }
    try {
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const result = await deps.decisionCaptureOrchestrator.acceptCascadeBatch({
        projectId,
        targetArchitectureId,
        sessionId: sessionIdResult,
        conversationThreadId: thread.threadId,
        proposals: proposals.map((p) => {
          const obj = p as Record<string, unknown>;
          return {
            decisionCode: obj.decisionCode as string,
            proposedValue: obj.proposedValue,
            sourceStandardId: obj.sourceStandardId as string,
          };
        }),
      });
      // Apply mapping mutations per cascade (one orchestrator pass per
      // captured row, per tasks.md §4.5).
      for (const d of result.decisions) {
        await deps.mappingMutationOrchestrator.applyForCapturedDecision({
          projectId,
          targetArchitectureId,
          decisionId: d.decisionId,
          decisionCode: d.decisionCode,
        });
      }
      res.status(200).json({
        cascadeAcceptedTurn: result.cascadeAcceptedTurn,
        decisionCapturedTurns: result.decisionCapturedTurns,
        sharedConversationTurnRef: result.sharedConversationTurnRef,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'cascade-accept-batch', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/cascade/override
//
// Forwards to the decision-capture orchestrator's `overrideCascade`. Writes
// a single row with `wasOverridden: true` + the override reason, then runs
// the mapping-mutation orchestrator for that decision.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/cascade/override',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    const proposal = body.proposal as Record<string, unknown> | undefined;
    if (
      !proposal ||
      typeof proposal.decisionCode !== 'string' ||
      typeof proposal.sourceStandardId !== 'string'
    ) {
      return sendError(
        res,
        400,
        "Missing or invalid 'proposal' (expected { decisionCode, proposedValue, sourceStandardId })",
      );
    }
    const overrideReasonResult = requireString(body.overrideReason, 'overrideReason');
    if (typeof overrideReasonResult !== 'string') {
      return sendError(res, 400, overrideReasonResult.errorMessage);
    }
    try {
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const result = await deps.decisionCaptureOrchestrator.overrideCascade({
        projectId,
        targetArchitectureId,
        sessionId: sessionIdResult,
        conversationThreadId: thread.threadId,
        proposal: {
          decisionCode: proposal.decisionCode as string,
          proposedValue: proposal.proposedValue,
          sourceStandardId: proposal.sourceStandardId as string,
        },
        overrideValue: body.overrideValue,
        overrideReason: overrideReasonResult,
      });
      await deps.mappingMutationOrchestrator.applyForCapturedDecision({
        projectId,
        targetArchitectureId,
        decisionId: result.decision.decisionId,
        decisionCode: result.decision.decisionCode,
      });
      res.status(200).json({
        cascadeOverriddenTurn: result.cascadeOverriddenTurn,
        decisionCapturedTurn: result.decisionCapturedTurn,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'cascade-override', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/revise
//
// Forwards to the decision-capture orchestrator's `revisePriorAnswer`. Writes
// a new superseding row (insert-only per settled decision #10) and emits the
// `edit-superseded` turn carrying the Q6 banner payload.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/revise',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    const decisionCodeResult = requireString(body.decisionCode, 'decisionCode');
    if (typeof decisionCodeResult !== 'string') {
      return sendError(res, 400, decisionCodeResult.errorMessage);
    }
    const originalDecisionIdResult = requireString(body.originalDecisionId, 'originalDecisionId');
    if (typeof originalDecisionIdResult !== 'string') {
      return sendError(res, 400, originalDecisionIdResult.errorMessage);
    }
    if (body.newAnswerValue === undefined) {
      return sendError(res, 400, "Missing 'newAnswerValue'");
    }
    const entry = findEntry(decisionCodeResult);
    if (!entry) {
      return sendError(
        res,
        404,
        `Question library entry not found for decisionCode='${decisionCodeResult}'`,
      );
    }
    const scope = parseOptionalScope(body.scope);
    if (scope && 'errorMessage' in scope) {
      return sendError(res, 400, scope.errorMessage);
    }
    try {
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const result = await deps.decisionCaptureOrchestrator.revisePriorAnswer({
        projectId,
        targetArchitectureId,
        sessionId: sessionIdResult,
        conversationThreadId: thread.threadId,
        entry,
        originalDecisionId: originalDecisionIdResult,
        newAnswerValue: body.newAnswerValue,
        scope: scope ?? undefined,
      });
      res.status(200).json({
        editSupersededTurn: result.editSupersededTurn,
        decisionCapturedTurn: result.decisionCapturedTurn,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'revise', {
        projectId,
        targetArchitectureId,
        decisionCode: decisionCodeResult,
      });
    }
  },
);

function parseOptionalScope(
  raw: unknown,
):
  | DecisionScope
  | { errorMessage: string }
  | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    return { errorMessage: "'scope' must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'architecture') return { kind: 'architecture' };
  if (obj.kind === 'element') {
    if (!isScopeRefType(obj.refType)) {
      return {
        errorMessage: `'scope.refType' must be one of: ${ALLOWED_SCOPE_REF_TYPES.join(', ')}`,
      };
    }
    if (typeof obj.refId !== 'string' || obj.refId.length === 0) {
      return { errorMessage: "'scope.refId' must be a non-empty string" };
    }
    return { kind: 'element', refType: obj.refType, refId: obj.refId };
  }
  return { errorMessage: "'scope.kind' must be 'architecture' or 'element'" };
}

// ---------------------------------------------------------------------------
// POST .../architect-conversation/exception
//
// Forwards to the decision-capture orchestrator's `pinException`. Writes an
// element-scoped row and emits the `exception-pinned` turn. The orchestrator
// already enforces that `scope.refType` is in the entry's
// `allowedExceptionScopes`; the gateway defence-in-depth checks the closed
// Q12 set up-front so out-of-set values surface as 400 (not 500).
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/exception',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionIdResult = requireString(body.sessionId, 'sessionId');
    if (typeof sessionIdResult !== 'string') {
      return sendError(res, 400, sessionIdResult.errorMessage);
    }
    const decisionCodeResult = requireString(body.decisionCode, 'decisionCode');
    if (typeof decisionCodeResult !== 'string') {
      return sendError(res, 400, decisionCodeResult.errorMessage);
    }
    if (body.answerValue === undefined) {
      return sendError(res, 400, "Missing 'answerValue'");
    }
    const scope = parseOptionalScope(body.scope);
    if (!scope) {
      return sendError(res, 400, "Missing 'scope'");
    }
    if ('errorMessage' in scope) {
      return sendError(res, 400, scope.errorMessage);
    }
    if (scope.kind !== 'element') {
      return sendError(res, 400, "'scope.kind' must be 'element' for exception pinning");
    }
    const entry = findEntry(decisionCodeResult);
    if (!entry) {
      return sendError(
        res,
        404,
        `Question library entry not found for decisionCode='${decisionCodeResult}'`,
      );
    }
    try {
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const result = await deps.decisionCaptureOrchestrator.pinException({
        projectId,
        targetArchitectureId,
        sessionId: sessionIdResult,
        conversationThreadId: thread.threadId,
        entry,
        scope,
        answerValue: body.answerValue,
      });
      res.status(200).json({
        exceptionPinnedTurn: result.exceptionPinnedTurn,
        decisionCapturedTurn: result.decisionCapturedTurn,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'exception', {
        projectId,
        targetArchitectureId,
        decisionCode: decisionCodeResult,
      });
    }
  },
);

// ===========================================================================
// OPEN-PHASE CAPTURE PATH
// (Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 4)
//
// Five `/open-phase/*` routes drive the open phase that begins STRICTLY after
// the preset walk exhausts. Each is an EXPLICIT user-control entry point (the
// LLM never infers "done" — S5). They are DISTINCT from `/answer` + `/capture`
// (which hard-404 on non-library decision codes via `findEntry`); the
// open-phase decision rows carry `adhoc.<slug>` codes and the note rows carry
// per-note-unique `note.<slug>` codes — neither is in `QUESTION_LIBRARY`, so
// they CANNOT flow through the preset routes.
//
//   POST .../architect-conversation/open-phase/begin        -> beginOpenPhase
//   POST .../architect-conversation/open-phase/raise-topic  -> raiseTopic
//   POST .../architect-conversation/open-phase/pick         -> preparePick + WRITE adhoc.<slug>
//   POST .../architect-conversation/open-phase/discuss      -> discuss
//   POST .../architect-conversation/open-phase/summarise    -> summariseDiscussion + WRITE note.<slug>
//
// Writes go via `postCapturedDecision` (reused VERBATIM) on the SAME captured-
// decisions plane (no AMS DDL — `decision_code` has no CHECK/enum; the scope
// CHECK already permits `architecture`). All new turn kinds are appended
// verbatim by the coordinator handlers (survive reopen).
// ===========================================================================

/**
 * Build the shared open-phase loop inputs (grounding + the LLM client) every
 * sub-phase handler threads. Grounding is resolved fail-soft (Task Group 2's
 * composer over the existing resolvers/clients).
 */
async function buildOpenPhaseLoopInputs(
  projectId: string,
  targetArchitectureId: string,
): Promise<OpenPhaseLoopInputs> {
  const grounding = await deps.resolveOpenPhaseGrounding(projectId, targetArchitectureId);
  return { llmClient: deps.llmClient, grounding };
}

// ---------------------------------------------------------------------------
// POST .../architect-conversation/open-phase/begin
//
// Sub-phase (a) ENTRY (P3): the architect's "other areas?" opener + the
// proactively-suggested grounded candidate areas. Appends the `open-phase-prompt`
// turn (or an `error` turn on loop failure). Invoked once when the open phase
// begins (explicit — the frontend calls it the moment `phase` is `open-available`
// and the user engages the open phase; never inferred).
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/open-phase/begin',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    try {
      const loopInputs = await buildOpenPhaseLoopInputs(projectId, targetArchitectureId);
      const outcome = await beginOpenPhase(
        { projectId, targetArchitectureId, ...loopInputs },
        { appendTurn: deps.appendTurn },
      );
      if (outcome.kind === 'error') {
        return res.status(200).json({ outcome: 'error', errorTurn: outcome.errorTurn });
      }
      res
        .status(200)
        .json({ outcome: 'prompt', openPhasePromptTurn: outcome.openPhasePromptTurn });
    } catch (err) {
      handleOrchestratorError(res, err, 'open-phase-begin', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/open-phase/raise-topic
//
// Sub-phase (a): the user raised a topic. Appends the `user-raised-topic` turn
// + the LLM `option-proposal` turn (single/multi PER TOPIC + a "something else…"
// escape; NO "Not applicable" — P4/S4). Body: { topicLabel, topicText? }.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/open-phase/raise-topic',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topicLabelResult = requireString(body.topicLabel, 'topicLabel');
    if (typeof topicLabelResult !== 'string') {
      return sendError(res, 400, topicLabelResult.errorMessage);
    }
    const topicText =
      typeof body.topicText === 'string' && body.topicText.length > 0
        ? body.topicText
        : undefined;
    try {
      const loopInputs = await buildOpenPhaseLoopInputs(projectId, targetArchitectureId);
      const outcome = await openPhaseRaiseTopic(
        {
          projectId,
          targetArchitectureId,
          topicLabel: topicLabelResult,
          topicText,
          ...loopInputs,
        },
        { appendTurn: deps.appendTurn },
      );
      if (outcome.kind === 'error') {
        return res.status(200).json({
          outcome: 'error',
          userRaisedTopicTurn: outcome.userRaisedTopicTurn,
          errorTurn: outcome.errorTurn,
        });
      }
      res.status(200).json({
        outcome: 'proposed',
        userRaisedTopicTurn: outcome.userRaisedTopicTurn,
        optionProposalTurn: outcome.optionProposalTurn,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'open-phase-raise-topic', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/open-phase/pick
//
// Sub-phase (a): the user picked option(s) / typed a "something else…" answer.
// Shapes the pick into a first-class decision intent (appends the `user-pick`
// turn), then WRITES the `adhoc.<slug>` captured-decision row via
// `postCapturedDecision` (architecture scope, distinct `createdByTask`) and
// appends a `decision-captured` turn. Body: { topicLabel, selectedValues?,
// freeTextValue? }. This is the NEW capture path — it does NOT 404 on the
// non-library `adhoc.*` code (contrast `/answer` + `/capture`).
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/open-phase/pick',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topicLabelResult = requireString(body.topicLabel, 'topicLabel');
    if (typeof topicLabelResult !== 'string') {
      return sendError(res, 400, topicLabelResult.errorMessage);
    }
    const selectedValues: string[] | undefined = Array.isArray(body.selectedValues)
      ? (body.selectedValues as unknown[]).filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        )
      : undefined;
    const freeTextValue =
      typeof body.freeTextValue === 'string' && body.freeTextValue.length > 0
        ? body.freeTextValue
        : undefined;
    if ((!selectedValues || selectedValues.length === 0) && !freeTextValue) {
      return sendError(
        res,
        400,
        "Provide 'selectedValues' (non-empty string[]) or 'freeTextValue' (the pick cannot be empty)",
      );
    }
    const conversationThreadIdRef =
      typeof body.conversationThreadId === 'string' ? body.conversationThreadId : undefined;
    try {
      const loopInputs = await buildOpenPhaseLoopInputs(projectId, targetArchitectureId);
      const prepared = await openPhasePreparePick(
        {
          projectId,
          targetArchitectureId,
          topicLabel: topicLabelResult,
          selectedValues,
          freeTextValue,
          ...loopInputs,
        },
        { appendTurn: deps.appendTurn },
      );
      if (prepared.kind === 'error') {
        return res.status(200).json({ outcome: 'error', errorTurn: prepared.errorTurn });
      }

      // WRITE the first-class user-raised decision row (S1) — the NEW capture
      // path. `adhoc.<slug>` code (slug from the topic label, so a repeated pick
      // on one topic supersedes; distinct topics get distinct codes), scope
      // architecture-wide (no scopeRefType/scopeRefId), distinct createdByTask.
      // `postCapturedDecision` reused verbatim; no AMS DDL.
      const written = await deps.postCapturedDecision(projectId, targetArchitectureId, {
        decisionCode: prepared.decisionIntent.decisionCode,
        scopeKind: 'architecture',
        answerValue: prepared.decisionIntent.answerValue,
        answerSummary: prepared.decisionIntent.answerSummary ?? null,
        conversationThreadId: conversationThreadIdRef ?? null,
        createdByTask: ADHOC_DECISION_CREATED_BY_TASK,
      });

      // Append a `decision-captured` turn so the row surfaces in the transcript
      // like every other captured decision (architecture scope).
      const decisionCapturedTurn: DecisionCapturedTurn = {
        kind: 'decision-captured',
        decisionId: written.decisionId,
        decisionCode: written.decisionCode,
        scope: { kind: 'architecture' },
        answerValue: written.answerValue,
        standardsLookupRef: null,
      };
      await deps.appendTurn(projectId, targetArchitectureId, decisionCapturedTurn);

      res.status(200).json({
        outcome: 'captured',
        userPickTurn: prepared.userPickTurn,
        decisionCapturedTurn,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'open-phase-pick', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/open-phase/discuss
//
// Sub-phase (b): one round of the multi-turn free-form chat. Appends the user's
// `free-form-discussion` turn + the assistant's reply turn. Body: { userMessage }.
// The assistant's conversational memory is reconstructed from the durable
// transcript's prior `free-form-discussion` turns.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/open-phase/discuss',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userMessageResult = requireString(body.userMessage, 'userMessage');
    if (typeof userMessageResult !== 'string') {
      return sendError(res, 400, userMessageResult.errorMessage);
    }
    try {
      // Reconstruct prior free-form history from the durable transcript so the
      // assistant has conversational memory across reopen.
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const priorHistory: ArchitectChatMessage[] = (thread.turns as ConversationTurn[])
        .filter((t): t is FreeFormDiscussionTurn => {
          return !!t && typeof t === 'object' && (t as ConversationTurn).kind === 'free-form-discussion';
        })
        .map((t) => ({
          role: t.speaker === 'assistant' ? 'assistant' : 'user',
          content: t.messageText,
        }));

      const loopInputs = await buildOpenPhaseLoopInputs(projectId, targetArchitectureId);
      const outcome = await openPhaseDiscuss(
        {
          projectId,
          targetArchitectureId,
          userMessage: userMessageResult,
          priorHistory,
          ...loopInputs,
        },
        { appendTurn: deps.appendTurn },
      );
      if (outcome.kind === 'error') {
        return res.status(200).json({
          outcome: 'error',
          userTurn: outcome.userTurn,
          errorTurn: outcome.errorTurn,
        });
      }
      res.status(200).json({
        outcome: 'replied',
        userTurn: outcome.userTurn,
        assistantTurn: outcome.assistantTurn,
      });
    } catch (err) {
      handleOrchestratorError(res, err, 'open-phase-discuss', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../architect-conversation/open-phase/summarise
//
// Sub-phase (b) END (Q2a/b): summarise the free-form discussion into PER-TOPIC
// structured notes and WRITE each as a per-note-unique `note.<slug>` row via
// `postCapturedDecision` (distinct `createdByTask`; per-note UNIQUE code so
// notes do NOT supersede one another). Explicit "Done / Close" control (S5).
// The discussion transcript is reconstructed from the durable
// `free-form-discussion` turns.
// ---------------------------------------------------------------------------

architectConversationRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation/open-phase/summarise',
  async (req: Request, res: ExpressResponse) => {
    const { projectId, targetArchitectureId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const conversationThreadIdRef =
      typeof body.conversationThreadId === 'string' ? body.conversationThreadId : undefined;
    try {
      // Reconstruct the free-form discussion transcript from the durable turns.
      const thread = await deps.loadConversation(projectId, targetArchitectureId);
      const transcript = (thread.turns as ConversationTurn[])
        .filter((t): t is FreeFormDiscussionTurn => {
          return !!t && typeof t === 'object' && (t as ConversationTurn).kind === 'free-form-discussion';
        })
        .map((t) => `${t.speaker}: ${t.messageText}`)
        .join('\n');

      const loopInputs = await buildOpenPhaseLoopInputs(projectId, targetArchitectureId);
      const outcome = await openPhaseSummariseDiscussion(
        { projectId, targetArchitectureId, transcript, ...loopInputs },
        { appendTurn: deps.appendTurn },
      );
      if (outcome.kind === 'error') {
        return res.status(200).json({ outcome: 'error', errorTurn: outcome.errorTurn });
      }

      // WRITE each note as a per-note-UNIQUE `note.<slug>` row (Q2b). The
      // per-note index is the uniqueness token so two distinct notes get
      // distinct codes and do NOT supersede one another. `postCapturedDecision`
      // reused verbatim; architecture scope; distinct `createdByTask`.
      const writtenNotes: Array<{ decisionCode: string; decisionId: string }> = [];
      for (let i = 0; i < outcome.notes.length; i += 1) {
        const note = outcome.notes[i];
        const code = noteCode(note.topicLabel, String(i + 1));
        const written = await deps.postCapturedDecision(projectId, targetArchitectureId, {
          decisionCode: code,
          scopeKind: 'architecture',
          answerValue: note.noteText,
          answerSummary: `${note.topicLabel}: ${note.noteText}`.slice(0, 500),
          conversationThreadId: conversationThreadIdRef ?? null,
          createdByTask: NOTE_CREATED_BY_TASK,
        });
        writtenNotes.push({ decisionCode: written.decisionCode, decisionId: written.decisionId });
      }

      res.status(200).json({ outcome: 'notes', notes: outcome.notes, writtenNotes });
    } catch (err) {
      handleOrchestratorError(res, err, 'open-phase-summarise', {
        projectId,
        targetArchitectureId,
      });
    }
  },
);
