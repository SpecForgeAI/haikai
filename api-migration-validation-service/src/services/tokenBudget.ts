/**
 * Token budget helper for Phase 2 SOAP LLM tools.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- W-7 token budgeting. Both new AMVS LLM tools (Workstream A
 * `propose_endpoints_from_code` and Workstream B `get_operation_payload_context`)
 * route their per-call input-size checks through this helper.
 *
 * Behaviour (truncate-with-warning, NOT hard-fail):
 *  - Each call announces a `requestedTokens` count to `recordAndCheck`.
 *  - The helper checks the per-call cap and the per-session running total.
 *  - If both caps still have headroom, the helper records the usage against
 *    the session ledger and returns `{ allow: true, remainingBudget }` where
 *    `remainingBudget` is the lower of the remaining per-call and per-session
 *    headroom after this call.
 *  - If either cap would be breached, the helper RECORDS only what fits and
 *    returns `{ allow: 'truncate', maxAllowedTokens, warning }`. The caller is
 *    responsible for truncating its payload to `maxAllowedTokens` and
 *    surfacing the `warning` string in the LLM-facing response so the model
 *    knows context is incomplete.
 *
 * Per-session isolation: ledger entries are keyed by `sessionId`; two
 * sessionIds never share budget. Sessions are not automatically reaped --
 * callers may call `resetSession(sessionId)` when a session is closed; in
 * practice the AMVS process restart between capture runs is sufficient.
 *
 * Tool kind selector: `'extract'` routes to the Workstream A caps
 * (`AMVS_LLM_EXTRACT_*`); `'payload'` routes to the Workstream B caps
 * (`AMVS_PAYLOAD_CTX_*`). The env-var-driven caps are read at module-load
 * time via `../config`.
 */

import {
  AMVS_LLM_EXTRACT_CALL_TOKEN_CAP,
  AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP,
  AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP,
  AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP,
} from '../config';

export type ToolKind = 'extract' | 'payload';

export interface TokenBudgetAllowResult {
  allow: true;
  remainingBudget: number;
}

export interface TokenBudgetTruncateResult {
  allow: 'truncate';
  maxAllowedTokens: number;
  warning: string;
}

export type TokenBudgetResult =
  | TokenBudgetAllowResult
  | TokenBudgetTruncateResult;

interface BudgetCaps {
  callCap: number;
  sessionCap: number;
}

function getCapsForKind(kind: ToolKind): BudgetCaps {
  switch (kind) {
    case 'extract':
      return {
        callCap: AMVS_LLM_EXTRACT_CALL_TOKEN_CAP,
        sessionCap: AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP,
      };
    case 'payload':
      return {
        callCap: AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP,
        sessionCap: AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP,
      };
    default: {
      // Exhaustiveness guard — compile error if a new ToolKind is added
      // without updating the switch.
      const _never: never = kind;
      throw new Error(`Unknown ToolKind: ${String(_never)}`);
    }
  }
}

/**
 * Per-session ledger: `${sessionId}::${kind}` -> tokens used so far.
 *
 * Keyed by the tuple of session id AND tool kind so Workstream A and
 * Workstream B can run inside the same logical session without their
 * budgets colliding (e.g. a Step 4 review session that also opens a
 * capture loop afterwards).
 */
const sessionLedger: Map<string, number> = new Map();

function ledgerKey(sessionId: string, kind: ToolKind): string {
  return `${sessionId}::${kind}`;
}

/**
 * Record a token request against a session and report whether the call
 * fits inside the per-call and per-session caps. See module header for
 * full contract.
 */
export function recordAndCheck(
  sessionId: string,
  kind: ToolKind,
  requestedTokens: number,
): TokenBudgetResult {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('tokenBudget.recordAndCheck: sessionId must be a non-empty string');
  }
  if (!Number.isFinite(requestedTokens) || requestedTokens < 0) {
    throw new Error(
      `tokenBudget.recordAndCheck: requestedTokens must be a non-negative finite number; got ${requestedTokens}`,
    );
  }

  const { callCap, sessionCap } = getCapsForKind(kind);
  const key = ledgerKey(sessionId, kind);
  const usedSoFar = sessionLedger.get(key) ?? 0;
  const sessionRemainingBefore = Math.max(0, sessionCap - usedSoFar);

  // Per-call cap breach: even if the session has plenty of room, a single
  // call may not exceed the per-call cap.
  const callOverflow = requestedTokens > callCap;
  // Per-session cap breach: this call would push the running total over
  // the session cap.
  const sessionOverflow = usedSoFar + requestedTokens > sessionCap;

  if (callOverflow || sessionOverflow) {
    const maxAllowedFromCall = Math.min(requestedTokens, callCap);
    const maxAllowedFromSession = sessionRemainingBefore;
    const maxAllowedTokens = Math.max(
      0,
      Math.min(maxAllowedFromCall, maxAllowedFromSession),
    );

    // Record only what we actually allowed (what the caller will truncate to).
    sessionLedger.set(key, usedSoFar + maxAllowedTokens);

    const reasons: string[] = [];
    if (callOverflow) {
      reasons.push(
        `per-call cap ${callCap} exceeded (requested ${requestedTokens})`,
      );
    }
    if (sessionOverflow) {
      reasons.push(
        `per-session cap ${sessionCap} exceeded (used ${usedSoFar}, requested ${requestedTokens})`,
      );
    }
    const warning =
      `[diag-amvs] token_cap action=truncate kind=${kind} session=${sessionId} ` +
      `maxAllowedTokens=${maxAllowedTokens} reason="${reasons.join('; ')}"`;

    return {
      allow: 'truncate',
      maxAllowedTokens,
      warning,
    };
  }

  // Happy path: record the full request and report remaining headroom
  // as the lower of the post-call per-call slack and the post-call
  // per-session slack. `remainingBudget=0` is a legitimate "exactly at cap"
  // signal, not an overflow.
  const newUsed = usedSoFar + requestedTokens;
  sessionLedger.set(key, newUsed);
  const remainingPerCall = callCap - requestedTokens;
  const remainingPerSession = sessionCap - newUsed;
  const remainingBudget = Math.max(0, Math.min(remainingPerCall, remainingPerSession));

  return {
    allow: true,
    remainingBudget,
  };
}

/**
 * Reset a single session's running totals (both `extract` and `payload`
 * kinds). Intended for callers that close a Step 4 review session or a
 * capture session and want the budget recycled for the next one.
 */
export function resetSession(sessionId: string): void {
  if (!sessionId) {
    return;
  }
  sessionLedger.delete(ledgerKey(sessionId, 'extract'));
  sessionLedger.delete(ledgerKey(sessionId, 'payload'));
}

/**
 * Clear ALL session ledgers. Intended for tests; do not call from
 * production code.
 */
export function _resetAllForTests(): void {
  sessionLedger.clear();
}

/**
 * Read the tokens used so far for `(sessionId, kind)`. Intended for tests
 * and structured logging; production callers should rely on `recordAndCheck`
 * to manage the ledger.
 */
export function getUsedTokens(sessionId: string, kind: ToolKind): number {
  return sessionLedger.get(ledgerKey(sessionId, kind)) ?? 0;
}
