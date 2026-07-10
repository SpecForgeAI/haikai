/**
 * Target State Captured Decisions Writer — Architect-Persona Conversation
 * (Spec 3, Commit 3)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Thin POST wrapper over Spec 2's
 *   POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions
 *
 * Sibling to `gateway/src/services/targetStateCapturedDecisionsClient.ts` (which
 * is read-only — `GET` calls feeding the resolver). The orchestrator (Commit 3
 * of Spec 3) is the first caller of the POST path; rather than mutate the
 * read-only client we add a focused writer module here so import boundaries
 * stay clean and the test mock seam stays narrow.
 *
 * The shape mirrors the AMS `CreateTargetStateCapturedDecisionRequest` DTO
 * verbatim (lowerCamelCase wire format per `@JsonNaming`). Atomic supersession
 * of any prior matching-tuple row is handled inside the AMS transaction —
 * callers POST a new row and AMS sets `supersededById` on the prior row when
 * present.
 *
 * IMPORTANT: This module makes HTTP calls. Tests stub `global.fetch`.
 */

import { getConfig } from '../../config';
import { logger } from '../logger';
import type { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import { createTracer } from '../../trace';

// CONV-stage predicate emission (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only.
const trace = createTracer('gateway');

// ---------------------------------------------------------------------------
// Wire-format request shape (mirrors the AMS Java DTO verbatim)
// ---------------------------------------------------------------------------

/**
 * Mirrors {@code CreateTargetStateCapturedDecisionRequest} on the
 * Architecture Model Service side. All fields are nullable strings except
 * `decisionCode`, `scopeKind`, `answerValue`, and `createdByTask` which the
 * AMS service rejects when missing.
 *
 * Field meanings:
 * - `decisionCode`: the question library code (e.g. `service.language`).
 * - `scopeKind`: `'architecture'` for the architecture-wide default,
 *   `'element'` for a per-element exception.
 * - `scopeRefType` / `scopeRefId`: required when `scopeKind = 'element'`;
 *   `scopeRefType` must be a member of the Q12 closed set.
 * - `answerValue`: the captured answer (or `'not_applicable'` / `'deferred'`).
 * - `answerSummary`: optional human-readable summary; the orchestrator copies
 *   the relevance reason here for auto-skip rows.
 * - `standardsLookupRef`: present on cascaded rows (the cascade entry's
 *   `sourceStandardId`); null on primary answers and revisions.
 * - `conversationThreadId`: the thread file id (Spec 2's thread envelope).
 * - `conversationTurnRef`: shared across rows written for one batch (e.g.
 *   cascade-accept-batch writes N rows all sharing the same value per Q10).
 * - `createdByTask`: the task / workflow id that produced this row. The
 *   architect conversation uses a fixed task name.
 */
export interface CreateCapturedDecisionRequestBody {
  decisionCode: string;
  scopeKind: 'architecture' | 'element';
  scopeRefType?: string | null;
  scopeRefId?: string | null;
  answerValue: string;
  answerSummary?: string | null;
  standardsLookupRef?: string | null;
  conversationThreadId?: string | null;
  conversationTurnRef?: string | null;
  createdByTask: string;
}

// ---------------------------------------------------------------------------
// HTTP error type
// ---------------------------------------------------------------------------

/**
 * Raised when the AMS POST returns a non-2xx status. The orchestrator catches
 * this and surfaces an `error` turn (with `errorKind = 'decision-capture-failed'`)
 * rather than throwing through the rest of the conversation flow.
 */
export class CapturedDecisionsWriteError extends Error {
  public readonly status: number;
  public readonly bodyText: string;
  constructor(status: number, bodyText: string) {
    super(
      `architecture model service captured-decisions POST failed: HTTP ${status} body=${bodyText.slice(0, 200)}`,
    );
    this.name = 'CapturedDecisionsWriteError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * POSTs a new captured-decision row via Spec 2's create endpoint.
 *
 * Atomic supersession of any prior matching-tuple row happens inside the AMS
 * `@Transactional` boundary — the caller does not need to issue a separate
 * PATCH or DELETE. The returned DTO is the new row (with server-assigned
 * `decisionId` and `createdAt`).
 *
 * Throws `CapturedDecisionsWriteError` on non-2xx response so the orchestrator
 * can translate the failure into an `error` turn without unwinding state it
 * has already written (e.g. the prior `question` + `answer` turns).
 */
export async function postCapturedDecision(
  projectId: string,
  targetArchitectureId: string,
  body: CreateCapturedDecisionRequestBody,
): Promise<TargetStateCapturedDecision> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/captured-decisions`;

  logger.debug('POSTing captured-decision to architecture model service', {
    projectId,
    targetArchitectureId,
    decisionCode: body.decisionCode,
    scopeKind: body.scopeKind,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    trace.predicate(
      'CONV.01', 'captured decision persisted bound to target architecture', false,
      'AMS captured-decisions POST returns 2xx',
      `HTTP ${response.status} decision=${body.decisionCode} target=${targetArchitectureId}`,
      { project: projectId, arch: targetArchitectureId },
    );
    throw new CapturedDecisionsWriteError(response.status, text);
  }

  const created = (await response.json()) as TargetStateCapturedDecision;
  trace.predicate(
    'CONV.01', 'captured decision persisted bound to target architecture', true,
    'AMS captured-decisions POST returns 2xx',
    `decision=${body.decisionCode} scope=${body.scopeKind} target=${targetArchitectureId}`,
    { project: projectId, arch: targetArchitectureId },
  );
  return created;
}
