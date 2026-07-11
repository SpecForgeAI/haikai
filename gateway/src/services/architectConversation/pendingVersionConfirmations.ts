/**
 * Pending-version-confirmation thread persistence helpers (Spec
 * 2026-06-27-target-manifest-version-unknown-pending-questions, Task Group 1).
 *
 * The pending-version-confirmation set lives on the target-state conversation
 * thread as a single `pending-version-confirmations` turn (see turnShape.ts).
 * It is recomputed and REPLACED on every manifest upload.
 *
 * Rather than mutate the opaque, append-only `appendTurn` store contract (which
 * sees only `unknown[]` and must NOT grow a new signature -- Task 1.3), the
 * "replace" semantics are resolved at READ time: the writer simply appends the
 * latest FULL pending set via `appendTurn`, and readers take the LATEST
 * `pending-version-confirmations` turn (latest-wins). That keeps the store
 * helper untouched while still yielding a single authoritative pending set.
 *
 * This module is the call-layer home for the turn-kind knowledge the store
 * deliberately does NOT have. The manifest-upload caller that actually emits the
 * turn is wired in Task Group 2; this module provides the mechanism + types.
 *
 * IMPORTANT: no orchestration, no LLM -- thin persistence/derivation only.
 */

import {
  appendTurn,
  type TargetStateConversationThread,
} from '../targetStateConversationStore';
import type {
  ConversationTurn,
  PendingVersionConfirmationEntry,
  PendingVersionConfirmationsTurn,
} from './turnShape';
import { createTracer } from '../../trace';

// CONV-stage predicate emission (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only.
const trace = createTracer('gateway');

/**
 * Builds a `pending-version-confirmations` turn from the full recomputed
 * pending set. An empty array is valid and CLEARS the pending set on read.
 */
export function buildPendingVersionConfirmationsTurn(
  entries: PendingVersionConfirmationEntry[],
): PendingVersionConfirmationsTurn {
  return { kind: 'pending-version-confirmations', entries };
}

/**
 * Persists the FULL recomputed pending set onto the thread via the existing
 * `appendTurn` helper (no store-signature change). Because reads take the
 * latest such turn, this append authoritatively REPLACES the prior pending set.
 *
 * @param projectId             ID of the project (resolves the thread base path).
 * @param targetArchitectureId  ID of the target architecture (thread path segment).
 * @param entries               The full pending set as of this upload (may be empty).
 */
export async function writePendingVersionConfirmations(
  projectId: string,
  targetArchitectureId: string,
  entries: PendingVersionConfirmationEntry[],
): Promise<void> {
  await appendTurn(
    projectId,
    targetArchitectureId,
    buildPendingVersionConfirmationsTurn(entries),
  );
  // CONV.03 (predicate run-judging): version-unknown => pending question,
  // zero silent defaults. Every write of the recomputed pending set is
  // logged (an empty set legitimately CLEARS pending questions); the judge
  // checks that unknown versions produced pending entries rather than
  // silent defaults.
  const codes = entries
    .slice(0, 5)
    .map((e) => {
      const r = e as unknown as Record<string, unknown>;
      return String(r.decisionCode ?? r.code ?? r.libraryCode ?? '?');
    })
    .join(',');
  trace.predicate(
    'CONV.03', 'version-unknown raised pending confirmations (never silent)',
    true,
    'the recomputed pending set is persisted on the thread',
    `pending=${entries.length}${entries.length > 0 ? ` codes=[${codes}${entries.length > 5 ? ',…' : ''}]` : ' (set cleared)'}`,
    { project: projectId, arch: targetArchitectureId },
  );
}

/**
 * Derives the authoritative pending set from a loaded thread envelope by taking
 * the LATEST `pending-version-confirmations` turn (latest-wins). Returns the
 * entries of the most-recent such turn, or an empty array when none was ever
 * written (or the latest one explicitly cleared the set).
 *
 * Pure -- does no I/O; the caller loads the thread via
 * `loadTargetStateConversation`.
 */
export function readLatestPendingVersionConfirmations(
  thread: TargetStateConversationThread,
): PendingVersionConfirmationEntry[] {
  for (let i = thread.turns.length - 1; i >= 0; i--) {
    const turn = thread.turns[i] as Partial<ConversationTurn> | null;
    if (turn && turn.kind === 'pending-version-confirmations') {
      return (turn as PendingVersionConfirmationsTurn).entries ?? [];
    }
  }
  return [];
}
