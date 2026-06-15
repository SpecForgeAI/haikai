/**
 * Discovery-Review Conversation HTTP routes (Spec 3 — capstone, Task Group 3.4).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect.
 *
 * Thin pass-throughs into the discovery-review coordinator (Group 2). Mirrors
 * the target-state `architectConversation.ts` route shape: an LLM `/answer`
 * path wiring `buildArchitectLlmClient()` -> `getLlmClient()`, a deterministic
 * `/capture` (no-LLM) path that drives the click-to-confirm + click-to-answer
 * paths through the SAME orchestrator, plus `/start`, `/confirm`, and a thread
 * read.
 *
 * Endpoints (mounted at `/api/v1/discovery-review`):
 *   GET    .../projects/:p/architectures/:a/runs/:runId/review-conversation
 *            -> the thread envelope { threadId, turns }
 *   POST   .../review-conversation/start
 *            -> append `open` + first `chunk-summary` (records the scan pair)
 *   POST   .../review-conversation/answer
 *            -> coordinator.answerTurn (LLM path; proposes an intent)
 *   POST   .../review-conversation/capture
 *            -> coordinator.captureDeterministicTurn (NO-LLM degrade-in-place)
 *   POST   .../review-conversation/confirm
 *            -> coordinator.confirmPending (the ONLY write path)
 *
 * SAFETY: `/answer` and `/capture` NEVER write — they at most surface a
 * `pending-confirmation` turn. Only `/confirm` (an explicit click OR a
 * re-validated NL "yes") drives the orchestrator's write.
 *
 * The review MODEL the tools/sequencer read is fetched once per request from
 * the discovery-service `review-model` endpoint (the same Spec 1 backbone the
 * grid + the gateway proxy consume), forwarding the FULL additional-run-id set
 * (every run beyond `primaryRunId`) as repeated `secondRunId=` query params for
 * the N-run union (per-service scan selection,
 * `2026-06-05-per-service-scan-selection`). The existing `GET .../runs` listing
 * (discovery.ts) already lists runs for the scan-selection opener, so no new
 * run-listing read is added here.
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getConfig } from '../config';
import { logger } from '../services/logger';
import { getLlmClient } from '../services/llmClient';
import type { OpenAIMessage, ChatRequestOptions } from '../services/openaiClient';
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
import {
  answerTurn,
  captureDeterministicTurn,
  confirmPending,
  startReview,
  defaultReviewCoordinatorDeps,
  type ReviewCoordinatorDeps,
} from '../services/discoveryReviewConversation/reviewConversationCoordinator';
import { loadDiscoveryReviewConversation } from '../services/discoveryReviewConversation/discoveryReviewConversationStore';
import type {
  FullReviewModelWire,
} from '../services/discoveryReviewConversation/reviewModelFull';
import type {
  ProposedReviewIntent,
  SelectedScanSet,
} from '../services/discoveryReviewConversation/reviewTurnShape';

// ---------------------------------------------------------------------------
// Injectable dependency container (test seam) — mirrors the architect-
// conversation route deps pattern.
// ---------------------------------------------------------------------------

interface ReviewRouteDeps {
  coordinatorDeps: ReviewCoordinatorDeps;
  loadConversation: typeof loadDiscoveryReviewConversation;
  llmClient: ArchitectLlmClient;
  /** Fetch the Spec 1 review model the tools/sequencer read. Tests stub this. */
  fetchReviewModel: typeof fetchReviewModel;
}

let deps: ReviewRouteDeps = {
  coordinatorDeps: defaultReviewCoordinatorDeps,
  loadConversation: loadDiscoveryReviewConversation,
  llmClient: buildArchitectLlmClient(),
  fetchReviewModel,
};

/** Test seam — swap any subset of route-level deps. Production never calls this. */
export function setDiscoveryReviewConversationDeps(patch: Partial<ReviewRouteDeps>): void {
  deps = { ...deps, ...patch };
}

/** Reset back to production defaults (test-only convenience). */
export function resetDiscoveryReviewConversationDeps(): void {
  deps = {
    coordinatorDeps: defaultReviewCoordinatorDeps,
    loadConversation: loadDiscoveryReviewConversation,
    llmClient: buildArchitectLlmClient(),
    fetchReviewModel,
  };
}

// ---------------------------------------------------------------------------
// LLM bridge — identical to architectConversation.ts's `buildArchitectLlmClient`
// (the documented reuse seam). READS the configured model via `getLlmClient()`;
// does NOT hard-code a model.
// ---------------------------------------------------------------------------

function buildArchitectLlmClient(): ArchitectLlmClient {
  return {
    callLlmToolLoop: async (args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> => {
      const llm = getLlmClient();
      const openaiMessages: OpenAIMessage[] = args.messages.map((m: ArchitectChatMessage) => ({
        role: m.role,
        content: m.content ?? '',
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls,
      }));
      const options: ChatRequestOptions = {
        tools: args.tools as unknown as ChatRequestOptions['tools'],
        toolChoice: args.toolChoice as unknown as ChatRequestOptions['toolChoice'],
      };
      const response = await llm.sendChatRequest(
        openaiMessages,
        `discovery-review-${uuidv4()}`,
        `discovery-review-session-${uuidv4()}`,
        options,
      );
      const archToolCalls: ArchitectToolCall[] | undefined = response.toolCalls?.map((tc) => ({
        id: tc.callId,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments ?? {}),
        },
      }));
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
      const llm = getLlmClient();
      const openaiMessages: OpenAIMessage[] = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];
      try {
        const response = await llm.sendChatRequest(
          openaiMessages,
          `discovery-review-singleshot-${uuidv4()}`,
          `discovery-review-singleshot-session-${uuidv4()}`,
          {},
        );
        return { content: response.content ?? '' };
      } catch (err) {
        throw new SingleShotLlmCallError(
          `Discovery-review single-shot call failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Review-model fetch — the Spec 1 backbone the tools/sequencer read. Calls the
// discovery-service review-model endpoint directly (the same target the gateway
// `review-model` proxy forwards to), forwarding the FULL additional-run-id set
// (every run beyond `primaryRunId`) as repeated `secondRunId=` query params.
// ---------------------------------------------------------------------------

export async function fetchReviewModel(args: {
  projectId: string;
  architectureId: string;
  runId: string;
  /**
   * The ADDITIONAL run ids beyond the primary `runId` (the rest of the
   * `SelectedScanSet`). Each is emitted as one repeated `secondRunId=` query
   * param alongside the `runId` path anchor (per-service scan selection,
   * `2026-06-05-per-service-scan-selection`). The discovery-service unions
   * `[runId, ...additionalRunIds]` into one review model.
   */
  additionalRunIds: readonly string[];
}): Promise<FullReviewModelWire> {
  const { discoveryServiceBaseUrl } = getConfig();
  let url =
    `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(args.projectId)}` +
    `/architectures/${encodeURIComponent(args.architectureId)}` +
    `/runs/${encodeURIComponent(args.runId)}/review-model`;
  const extra = args.additionalRunIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (extra.length > 0) {
    url += `?${extra.map((id) => `secondRunId=${encodeURIComponent(id)}`).join('&')}`;
  }
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`review-model fetch failed: ${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as FullReviewModelWire;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const discoveryReviewConversationRouter = Router();

const ROUTE_BASE =
  '/projects/:projectId/architectures/:architectureId/runs/:runId/review-conversation';

function sendError(res: ExpressResponse, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function requireString(value: unknown, name: string): string | { errorMessage: string } {
  if (typeof value !== 'string' || value.length === 0) {
    return { errorMessage: `Missing or invalid '${name}' (expected non-empty string)` };
  }
  return value;
}

/**
 * Parse the selected scan SET from a request body into the typed
 * {@link SelectedScanSet} (per-service scan selection,
 * `2026-06-05-per-service-scan-selection`).
 *
 * `primaryRunId` is the `:runId` path anchor (the thread key) and is ALWAYS
 * present in `runs[]` — if the body omits it from `scanPair.runs`, it is
 * back-filled (defaulting to a `code` scan kind, the AMS default) so the set is
 * always self-consistent. Each `runs[]` entry carries `{ runId, scanKind,
 * serviceId }`; unknown scan kinds default to `code`, and a missing/blank
 * `serviceId` becomes null (an orphan / "Unassigned" run).
 */
export function parseScanPair(body: Record<string, unknown>, primaryRunId: string): SelectedScanSet {
  const sp = (body.scanPair ?? {}) as Record<string, unknown>;
  const rawRuns = Array.isArray(sp.runs) ? sp.runs : [];

  const runs: SelectedScanSet['runs'] = [];
  const seen = new Set<string>();
  for (const raw of rawRuns) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const runId = typeof r.runId === 'string' && r.runId.length > 0 ? r.runId : null;
    if (runId === null || seen.has(runId)) continue;
    seen.add(runId);
    runs.push({
      runId,
      scanKind: r.scanKind === 'database' ? 'database' : 'code',
      serviceId: typeof r.serviceId === 'string' && r.serviceId.length > 0 ? r.serviceId : null,
    });
  }

  // The primary run is the thread/path anchor and MUST appear in the set.
  if (!seen.has(primaryRunId)) {
    runs.unshift({ runId: primaryRunId, scanKind: 'code', serviceId: null });
  }

  return { runs, primaryRunId };
}

/** The additional run ids of a {@link SelectedScanSet} beyond its `primaryRunId`. */
export function additionalRunIdsOf(scanPair: SelectedScanSet): string[] {
  return scanPair.runs.map((r) => r.runId).filter((id) => id !== scanPair.primaryRunId);
}

// ---------------------------------------------------------------------------
// GET .../review-conversation — the thread envelope.
// ---------------------------------------------------------------------------

discoveryReviewConversationRouter.get(ROUTE_BASE, async (req: Request, res: ExpressResponse) => {
  const { projectId, runId } = req.params;
  try {
    const thread = await deps.loadConversation(projectId, runId);
    res.status(200).json({ threadId: thread.threadId, turns: thread.turns });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('discovery-review-conversation: load failed', { projectId, runId, error: message });
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// POST .../review-conversation/start — append open + first chunk.
// ---------------------------------------------------------------------------

discoveryReviewConversationRouter.post(
  `${ROUTE_BASE}/start`,
  async (req: Request, res: ExpressResponse) => {
    const { projectId, architectureId, runId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const openedBy = requireString(body.openedBy, 'openedBy');
    if (typeof openedBy !== 'string') return sendError(res, 400, openedBy.errorMessage);

    const scanPair = parseScanPair(body, runId);
    try {
      const model = await deps.fetchReviewModel({
        projectId,
        architectureId,
        runId,
        additionalRunIds: additionalRunIdsOf(scanPair),
      });
      const sessionId = uuidv4();
      const outcome = await startReview(
        { projectId, architectureId, runId, model, scanPair, sessionId, openedBy },
        deps.coordinatorDeps,
      );
      res.status(200).json({ sessionId, openTurn: outcome.openTurn, firstChunk: outcome.firstChunk });
    } catch (err) {
      handleError(res, err, 'start', { projectId, architectureId, runId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../review-conversation/answer — the LLM path (proposes an intent).
// ---------------------------------------------------------------------------

discoveryReviewConversationRouter.post(
  `${ROUTE_BASE}/answer`,
  async (req: Request, res: ExpressResponse) => {
    const { projectId, architectureId, runId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userMessage = requireString(body.userMessage, 'userMessage');
    if (typeof userMessage !== 'string') return sendError(res, 400, userMessage.errorMessage);

    const scanPair = parseScanPair(body, runId);
    try {
      const model = await deps.fetchReviewModel({
        projectId,
        architectureId,
        runId,
        additionalRunIds: additionalRunIdsOf(scanPair),
      });
      const outcome = await answerTurn(
        { projectId, architectureId, runId, model, scanPair, userMessage, llmClient: deps.llmClient },
        deps.coordinatorDeps,
      );
      res.status(200).json(outcome);
    } catch (err) {
      handleError(res, err, 'answer', { projectId, architectureId, runId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../review-conversation/capture — the NO-LLM degrade-in-place path.
//
// Body: either { action: 'advance-chunk', agendaCursor } OR
//       { action: 'propose-intent', intent, userText? }.
// ---------------------------------------------------------------------------

discoveryReviewConversationRouter.post(
  `${ROUTE_BASE}/capture`,
  async (req: Request, res: ExpressResponse) => {
    const { projectId, architectureId, runId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scanPair = parseScanPair(body, runId);

    let action:
      | { kind: 'propose-intent'; intent: ProposedReviewIntent; userText?: string }
      | { kind: 'advance-chunk'; agendaCursor: number };

    if (body.action === 'advance-chunk') {
      const cursor = typeof body.agendaCursor === 'number' ? body.agendaCursor : 0;
      action = { kind: 'advance-chunk', agendaCursor: cursor };
    } else if (body.action === 'propose-intent') {
      const intent = body.intent as ProposedReviewIntent | undefined;
      if (!intent || typeof intent !== 'object' || typeof (intent as { kind?: unknown }).kind !== 'string') {
        return sendError(res, 400, "Missing or invalid 'intent' for propose-intent");
      }
      action = {
        kind: 'propose-intent',
        intent,
        userText: typeof body.userText === 'string' ? body.userText : undefined,
      };
    } else {
      return sendError(res, 400, "Missing or invalid 'action' (expected 'advance-chunk' or 'propose-intent')");
    }

    try {
      const model = await deps.fetchReviewModel({
        projectId,
        architectureId,
        runId,
        additionalRunIds: additionalRunIdsOf(scanPair),
      });
      const outcome = await captureDeterministicTurn(
        { projectId, architectureId, runId, model, scanPair, action },
        deps.coordinatorDeps,
      );
      res.status(200).json(outcome);
    } catch (err) {
      handleError(res, err, 'capture', { projectId, architectureId, runId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST .../review-conversation/confirm — the ONLY write path.
//
// Body: { pendingId, intent, confirmation: { kind: 'click' } |
//         { kind: 'natural-language', text }, scanPair? }.
// ---------------------------------------------------------------------------

discoveryReviewConversationRouter.post(
  `${ROUTE_BASE}/confirm`,
  async (req: Request, res: ExpressResponse) => {
    const { projectId, architectureId, runId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pendingId = requireString(body.pendingId, 'pendingId');
    if (typeof pendingId !== 'string') return sendError(res, 400, pendingId.errorMessage);

    const intent = body.intent as ProposedReviewIntent | undefined;
    if (!intent || typeof intent !== 'object' || typeof (intent as { kind?: unknown }).kind !== 'string') {
      return sendError(res, 400, "Missing or invalid 'intent'");
    }

    const rawConfirm = (body.confirmation ?? {}) as Record<string, unknown>;
    let confirmation: { kind: 'click' } | { kind: 'natural-language'; text: string };
    if (rawConfirm.kind === 'click') {
      confirmation = { kind: 'click' };
    } else if (rawConfirm.kind === 'natural-language' && typeof rawConfirm.text === 'string') {
      confirmation = { kind: 'natural-language', text: rawConfirm.text };
    } else {
      return sendError(
        res,
        400,
        "Missing or invalid 'confirmation' (expected { kind: 'click' } or { kind: 'natural-language', text })",
      );
    }

    const scanPair = parseScanPair(body, runId);
    try {
      const model = await deps.fetchReviewModel({
        projectId,
        architectureId,
        runId,
        additionalRunIds: additionalRunIdsOf(scanPair),
      });
      const outcome = await confirmPending(
        { projectId, architectureId, runId, pendingId, intent, confirmation, model },
        deps.coordinatorDeps,
      );
      res.status(200).json(outcome);
    } catch (err) {
      handleError(res, err, 'confirm', { projectId, architectureId, runId });
    }
  },
);

// ---------------------------------------------------------------------------
// Shared error handler.
// ---------------------------------------------------------------------------

function handleError(
  res: ExpressResponse,
  err: unknown,
  route: string,
  ctx: Record<string, string>,
): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`discovery-review-conversation: ${route} failed`, { ...ctx, error: message });
  res.status(500).json({ error: message });
}
