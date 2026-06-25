/**
 * API like-for-like lock — `api.surfaceMode` mode resolution + Group B lock /
 * auto-answer from source + provenance + question suppression
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR9 / FR1 `L`
 * treatment).
 *
 * Under the migration mode `api.surfaceMode = like_for_like` the WHOLE of Group
 * B (`api.protocol`, `api.versioning`, `api.contractFormat`, `api.auth`,
 * `api.errorContract`, `api.rateLimiting`) is:
 *
 *   1. AUTO-ANSWERED + LOCKED from the captured source contract / API Behaviour
 *      Baseline (treatment class `L`, superseding the underlying H/I/G class).
 *   2. WRITTEN through the EXISTING captured-decision envelope
 *      (`answerValue = JSON.stringify({ value, sourceQuote, sourceFile })`,
 *      `answerSummary` = the resolved label) with provenance pointing at the
 *      source contract / baseline — the same path
 *      `openTurnTechStackPrefill.ts` / `targetStateCapturedDecisionsWriter` use.
 *      No new persistence path; no new AMS DTO; snake_case-on-the-wire unchanged.
 *   3. EXCLUDED from the asked / offered question set (rendered read-only
 *      "locked — API like-for-like" by the frontend, NOT asked).
 *
 * Under `may_change` the six questions revert to their underlying H/I/G class
 * and are asked normally (no `L`, no lock write).
 *
 * `api.surfaceMode` DEFAULTS to `like_for_like` whenever the architecture has a
 * reconciled API Behaviour Baseline / oracle present (the like-for-like /
 * reconciliation contract forbids API-surface deviation); with NO baseline the
 * mode is not forced (caller-provided / unset).
 *
 * SCOPE: deriving the locked values is a THIN READ of the existing source
 * contract / oracle — wire the lock + provenance + read-only display; do NOT
 * rebuild the reconciliation engine. The source read is an INJECTABLE provider
 * (`deps.sourceContractProvider`) so this module performs no reconciliation
 * compute itself; production wires a thin reader over the existing baseline.
 *
 * GUARANTEES (all enforced + tested):
 *   - NO SILENT SKIPS. Every lock / auto-answer decision (code + source +
 *     locked outcome) is logged via the shared `logger`; a Group B question is
 *     never suppressed without a logged lock decision.
 *   - ADDITIVE. The underlying `dependencyClass` is untouched; `L` supersedes
 *     only while `like_for_like` is active.
 *
 * The injectable-deps shape mirrors `OpenTurnTechStackPrefillDeps` /
 * `GreyCompatibilityJudgeDeps`: a `deps` object (defaults supplied) so tests can
 * inject a source provider + assert the writes / suppression / logging.
 */

import {
  postCapturedDecision as defaultPostCapturedDecision,
  CreateCapturedDecisionRequestBody,
} from './targetStateCapturedDecisionsWriter';
import {
  ApiSurfaceMode,
  DEFAULT_API_SURFACE_MODE,
  LOCKABLE_GROUP_B_CODES,
  isLockableGroupBCode,
} from '../../config/architect-conversation/apiSurfaceMode';
import { logger } from '../logger';

/**
 * Fixed `created_by_task` value stamped on every captured-decision row written
 * by the API like-for-like lock. Discriminates locked Group B rows from
 * user-walked rows (`'architect-persona-conversation'`) and tech-stack pre-fill
 * rows (`'tech-stack-md-prefill'`) for audit + the read-only render.
 */
export const API_SURFACE_LOCK_TASK_NAME = 'api-like-for-like-lock';

// ---------------------------------------------------------------------------
// Source contract / baseline read shapes (thin read — NOT reconciliation)
// ---------------------------------------------------------------------------

/**
 * One Group B value read from the source contract / API Behaviour Baseline.
 * `value` is the resolved answer (e.g. `'REST/JSON'`); `sourceQuote` /
 * `sourceFile` are the provenance pointing at the source contract / baseline
 * (e.g. the OpenAPI file + the quoted line that established the value). All
 * three carry through verbatim into the captured-decision envelope.
 */
export interface SourceContractValue {
  /** The resolved Group B answer value (the `answerSummary` chip label). */
  value: string;
  /** Provenance quote from the source contract / baseline (nullable). */
  sourceQuote: string | null;
  /** Provenance file path of the source contract / baseline (nullable). */
  sourceFile: string | null;
}

/**
 * A thin reader over the EXISTING reconciled source contract / API Behaviour
 * Baseline. Returns the locked value for a Group B `decisionCode`, or
 * `undefined` when the baseline does not carry that code (the caller logs the
 * gap and leaves the question unanswered rather than guessing).
 *
 * IMPORTANT: this is a READ ONLY. It must NOT recompute / rebuild reconciliation
 * — production wires it over the already-reconciled baseline. The shape is
 * deliberately tiny so tests inject a fixture map.
 */
export interface SourceContractProvider {
  /**
   * True iff the architecture has a reconciled API Behaviour Baseline / oracle
   * at all. Drives the `like_for_like` default (FR9). Pure / synchronous.
   */
  hasReconciledBaseline(): boolean;
  /**
   * Read the locked value for a Group B code from the baseline, or `undefined`
   * when the baseline does not establish that code.
   */
  readGroupBValue(decisionCode: string): SourceContractValue | undefined;
}

/**
 * The default provider reports NO baseline and reads nothing — so without an
 * injected thin reader the mode is never force-defaulted to `like_for_like` and
 * nothing is locked. Production injects the real baseline reader at the route
 * layer; tests inject a fixture.
 */
export const defaultSourceContractProvider: SourceContractProvider = {
  hasReconciledBaseline: () => false,
  readGroupBValue: () => undefined,
};

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam) — mirrors OpenTurnTechStackPrefillDeps
// ---------------------------------------------------------------------------

export interface ApiSurfaceLockDeps {
  /** Thin reader over the reconciled source contract / baseline. */
  sourceContractProvider: SourceContractProvider;
  /** Captured-decision writer (the existing envelope/writer path). */
  postCapturedDecision: typeof defaultPostCapturedDecision;
}

export const defaultApiSurfaceLockDeps: ApiSurfaceLockDeps = {
  sourceContractProvider: defaultSourceContractProvider,
  postCapturedDecision: defaultPostCapturedDecision,
};

// ---------------------------------------------------------------------------
// Mode resolution (FR9 default)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective `api.surfaceMode`.
 *
 * - A `requestedMode` (caller-/user-provided) ALWAYS wins when supplied.
 * - Otherwise, when a reconciled baseline / oracle is present, default to
 *   `like_for_like` (FR9). With NO baseline the mode is left UNSET (`null`) —
 *   it is not forced — so the caller asks Group B normally.
 *
 * Pure; logs the resolution at debug.
 */
export function resolveApiSurfaceMode(args: {
  requestedMode?: ApiSurfaceMode | null;
  hasReconciledBaseline: boolean;
}): ApiSurfaceMode | null {
  const { requestedMode, hasReconciledBaseline } = args;
  if (requestedMode === 'like_for_like' || requestedMode === 'may_change') {
    logger.debug('api-surface-lock: mode resolved from request', {
      requestedMode,
      hasReconciledBaseline,
    });
    return requestedMode;
  }
  if (hasReconciledBaseline) {
    logger.debug('api-surface-lock: defaulting mode to like_for_like (baseline present)', {
      defaultMode: DEFAULT_API_SURFACE_MODE,
    });
    return DEFAULT_API_SURFACE_MODE;
  }
  logger.debug('api-surface-lock: no baseline + no requested mode; mode left unset', {});
  return null;
}

// ---------------------------------------------------------------------------
// Lock decision derivation (thin source read)
// ---------------------------------------------------------------------------

/**
 * One per-question lock decision. `locked: true` => the value was read from the
 * source contract / baseline and will be written + the question suppressed.
 * `locked: false` => the baseline did not establish this Group B code, so it is
 * left UNLOCKED (logged) and asked normally rather than guessed.
 */
export interface ApiSurfaceLockDecision {
  /** The Group B decision code. */
  decisionCode: string;
  /** Treatment class applied at runtime: `'locked'` (L) when locked. */
  treatment: 'locked' | 'unlocked';
  /** True iff this question is locked + auto-answered from source. */
  locked: boolean;
  /** The resolved source value when locked; `null` otherwise. */
  value: string | null;
  /** Provenance quote when locked; `null` otherwise. */
  sourceQuote: string | null;
  /** Provenance file when locked; `null` otherwise. */
  sourceFile: string | null;
  /** Reason a question is NOT locked (baseline gap), for logging; null when locked. */
  unlockedReason: string | null;
}

/**
 * Derive the per-question lock decisions for the six Group B codes from a thin
 * read of the source contract / baseline. Does NOT write anything — pure
 * computation over the injected provider. Logs every decision (locked or the
 * baseline-gap that left it unlocked). No silent skips.
 *
 * Called only when the resolved mode is `like_for_like`; under `may_change` the
 * caller never reaches this (Group B reverts to H/I/G + is asked).
 */
export function deriveApiSurfaceLockDecisions(
  provider: SourceContractProvider,
): ApiSurfaceLockDecision[] {
  const decisions: ApiSurfaceLockDecision[] = [];
  for (const decisionCode of LOCKABLE_GROUP_B_CODES) {
    const source = provider.readGroupBValue(decisionCode);
    if (source && typeof source.value === 'string' && source.value.trim().length > 0) {
      decisions.push({
        decisionCode,
        treatment: 'locked',
        locked: true,
        value: source.value,
        sourceQuote: source.sourceQuote ?? null,
        sourceFile: source.sourceFile ?? null,
        unlockedReason: null,
      });
      logger.debug('api-surface-lock: Group B question locked from source', {
        decisionCode,
        value: source.value,
        sourceFile: source.sourceFile ?? null,
        treatment: 'locked',
      });
    } else {
      const reason =
        'api like-for-like is active but the reconciled baseline did not establish this Group B code; left unlocked (asked) rather than guessed';
      decisions.push({
        decisionCode,
        treatment: 'unlocked',
        locked: false,
        value: null,
        sourceQuote: null,
        sourceFile: null,
        unlockedReason: reason,
      });
      logger.warn('api-surface-lock: Group B question NOT locked (baseline gap)', {
        decisionCode,
        reason,
      });
    }
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// Question suppression (FR9: locked questions are NOT asked under like_for_like)
// ---------------------------------------------------------------------------

/**
 * Compute the set of Group B codes that must be EXCLUDED from the asked /
 * offered question set for the resolved mode.
 *
 * - `like_for_like` => the LOCKED decisions' codes are suppressed (read-only,
 *   not asked). A baseline-gap (unlocked) Group B code is NOT suppressed — it is
 *   asked normally so the architect can answer it.
 * - `may_change` (or `null`/unset) => no suppression; Group B is asked under its
 *   underlying H/I/G class.
 */
export function suppressedGroupBCodes(
  mode: ApiSurfaceMode | null,
  decisions: readonly ApiSurfaceLockDecision[],
): Set<string> {
  if (mode !== 'like_for_like') return new Set<string>();
  return new Set(decisions.filter((d) => d.locked).map((d) => d.decisionCode));
}

/**
 * True iff `decisionCode` is a Group B code that is LOCKED + suppressed for the
 * resolved mode. Convenience for the question sequencer to skip the question.
 * Under `may_change` always returns false.
 */
export function isApiSurfaceLocked(
  decisionCode: string,
  mode: ApiSurfaceMode | null,
  decisions: readonly ApiSurfaceLockDecision[],
): boolean {
  if (mode !== 'like_for_like') return false;
  if (!isLockableGroupBCode(decisionCode)) return false;
  return decisions.some((d) => d.decisionCode === decisionCode && d.locked);
}

// ---------------------------------------------------------------------------
// Apply the lock — write locked answers + return the suppression set
// ---------------------------------------------------------------------------

export interface ApplyApiSurfaceLockArgs {
  projectId: string;
  targetArchitectureId: string;
  conversationThreadId?: string | null;
  /** The user-/caller-provided mode, if any (else defaulted from the baseline). */
  requestedMode?: ApiSurfaceMode | null;
}

export interface ApplyApiSurfaceLockOutcome {
  /** The resolved effective mode (`null` when unset: no baseline, no request). */
  mode: ApiSurfaceMode | null;
  /** Per-question lock decisions (empty unless mode is `like_for_like`). */
  decisions: ApiSurfaceLockDecision[];
  /** The Group B codes excluded from the asked set (locked + suppressed). */
  suppressedCodes: string[];
  /** Decision codes whose lock-row writes succeeded. */
  writtenCodes: string[];
  /** Decision codes whose lock-row writes failed (surfaced, not thrown). */
  writeFailureCodes: string[];
}

/**
 * Resolve the mode and, under `like_for_like`, write the locked Group B answers
 * through the existing captured-decision envelope + return the suppression set.
 *
 * Under `may_change` (or an unset mode) nothing is written and nothing is
 * suppressed — Group B is asked under its underlying H/I/G class.
 *
 * Write failures are CAPTURED (surfaced on the outcome), never thrown — a failed
 * lock write must not block the conversation; the question simply falls back to
 * being asked (it is not in `suppressedCodes`). Every decision + write is logged.
 */
export async function applyApiSurfaceLock(
  args: ApplyApiSurfaceLockArgs,
  deps: ApiSurfaceLockDeps = defaultApiSurfaceLockDeps,
): Promise<ApplyApiSurfaceLockOutcome> {
  const { projectId, targetArchitectureId, conversationThreadId, requestedMode } = args;
  const { sourceContractProvider, postCapturedDecision } = deps;

  const mode = resolveApiSurfaceMode({
    requestedMode: requestedMode ?? null,
    hasReconciledBaseline: sourceContractProvider.hasReconciledBaseline(),
  });

  // Only `like_for_like` locks Group B; every other mode asks it normally.
  if (mode !== 'like_for_like') {
    logger.debug('api-surface-lock: mode is not like_for_like; Group B asked normally', {
      mode,
    });
    return {
      mode,
      decisions: [],
      suppressedCodes: [],
      writtenCodes: [],
      writeFailureCodes: [],
    };
  }

  const decisions = deriveApiSurfaceLockDecisions(sourceContractProvider);

  const writtenCodes: string[] = [];
  const writeFailureCodes: string[] = [];

  for (const decision of decisions) {
    if (!decision.locked || decision.value === null) {
      // Baseline gap — already logged in deriveApiSurfaceLockDecisions. Not
      // written, not suppressed; the question is asked.
      continue;
    }
    const body: CreateCapturedDecisionRequestBody = {
      decisionCode: decision.decisionCode,
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      // Identical envelope shape to openTurnTechStackPrefill: the resolved value
      // rides the `value` slot; provenance points at the source contract.
      answerValue: JSON.stringify({
        value: decision.value,
        sourceQuote: decision.sourceQuote,
        sourceFile: decision.sourceFile,
      }),
      answerSummary: decision.value,
      standardsLookupRef: null,
      conversationThreadId: conversationThreadId ?? null,
      conversationTurnRef: null,
      createdByTask: API_SURFACE_LOCK_TASK_NAME,
    };
    try {
      await postCapturedDecision(projectId, targetArchitectureId, body);
      writtenCodes.push(decision.decisionCode);
      logger.debug('api-surface-lock: wrote locked Group B answer', {
        decisionCode: decision.decisionCode,
        value: decision.value,
        sourceFile: decision.sourceFile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeFailureCodes.push(decision.decisionCode);
      logger.error('api-surface-lock: failed to write locked Group B answer', {
        decisionCode: decision.decisionCode,
        reason: message,
      });
    }
  }

  // Only successfully-written locks are suppressed from the asked set — a write
  // failure means the value did not persist, so the question must still be
  // asked rather than silently dropped.
  const writtenSet = new Set(writtenCodes);
  const suppressedCodes = decisions
    .filter((d) => d.locked && writtenSet.has(d.decisionCode))
    .map((d) => d.decisionCode);

  logger.info('api-surface-lock: applied like_for_like lock', {
    mode,
    lockedCount: writtenCodes.length,
    writeFailureCount: writeFailureCodes.length,
    suppressedCount: suppressedCodes.length,
  });

  return {
    mode,
    decisions,
    suppressedCodes,
    writtenCodes,
    writeFailureCodes,
  };
}
