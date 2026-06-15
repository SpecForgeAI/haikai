/**
 * Review-Decision Orchestrator for the discovery-review conversation (Spec 3 —
 * capstone, Task Group 2.4). The SOLE writer. Mirrors the target-state
 * `decisionCaptureOrchestrator.ts`: each method POSTs the deterministic
 * Spec 0-2 endpoint and appends the matching transcript turn. The LLM loop
 * NEVER writes — only this orchestrator does, and only after the coordinator
 * has cleared the HARD confirmation gate.
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Decision 1/3/4/5).
 *
 * The four writers (the LLM may NEVER fire any of these directly):
 *   - `applyDecision`            → POST AMS `candidates/bulk-review-cascade`
 *                                  (atomic cascade apply across candidates +
 *                                  linked findings); findings-only dispositions
 *                                  go via `findings/bulk-review`.
 *   - `resolveConflict`          → PATCH AMS `candidates/{id}/resolve-conflict`
 *                                  (the NEW Group-1 durable write).
 *   - `resolveConflictsByPattern`→ ONE deterministic resolve-by-SAME-SOURCE per
 *                                  similarity-class member, via the Group-1
 *                                  write (NEVER a per-item LLM loop, NEVER
 *                                  same-literal-value).
 *   - `save`                     → POST MCP `save_approved_candidates`.
 *
 * Endpoint targets MIRROR the existing gateway proxies' targets verbatim (the
 * gateway calls AMS / MCP directly here exactly as the proxies do — same paths,
 * same snake_case bodies) so the write path is identical whether driven by the
 * grid (via the proxy) or the conversation (via this orchestrator). Tests stub
 * `global.fetch` (the same seam the chassis writer uses).
 *
 * WIRE FORMAT (per CLAUDE.md): AMS speaks snake_case at the wire — the
 * request bodies are snake_case. CRITICAL EXCEPTION: the conflict-resolution
 * REQUEST body is snake_case (`chosen_value`/`chosen_source`/`resolved_by`/
 * `resolved_at`), but AMS itself stamps the camelCase keys inside
 * `data._conflictResolutions[attr]` — the orchestrator just forwards snake_case.
 */

import { getConfig } from '../../config';
import { logger } from '../logger';
import type { BulkReviewAction } from '../discovery/reviewModelWire';
import type {
  BulkPatternResolvedTurn,
  ConflictResolvedTurn,
  DecisionAppliedTurn,
  ErrorTurn,
  ReviewErrorKind,
  SavedTurn,
} from './reviewTurnShape';
import { appendReviewTurn as defaultAppendReviewTurn } from './discoveryReviewConversationStore';

// ---------------------------------------------------------------------------
// Fixed reviewer label stamped on conversational resolutions / notes.
// ---------------------------------------------------------------------------

export const REVIEW_CONVERSATION_REVIEWER = 'architect-review-conversation';

// ---------------------------------------------------------------------------
// HTTP error type (mirrors CapturedDecisionsWriteError)
// ---------------------------------------------------------------------------

export class ReviewWriteError extends Error {
  public readonly status: number;
  public readonly bodyText: string;
  constructor(status: number, bodyText: string, label: string) {
    super(`${label} failed: AMS responded ${status}: ${bodyText.slice(0, 200)}`);
    this.name = 'ReviewWriteError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

// ---------------------------------------------------------------------------
// Injectable deps (test seam) — a `fetch` shim + the turn appender.
// ---------------------------------------------------------------------------

export interface ReviewOrchestratorDeps {
  /** HTTP transport. Tests stub this (or stub `global.fetch`). */
  fetchImpl: typeof fetch;
  /** Append a turn to the discovery-review thread. Tests mock this. */
  appendTurn: typeof defaultAppendReviewTurn;
  /** Clock for the resolution timestamp (injectable for deterministic tests). */
  now: () => Date;
}

export const defaultReviewOrchestratorDeps: ReviewOrchestratorDeps = {
  fetchImpl: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
  appendTurn: defaultAppendReviewTurn,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Common args
// ---------------------------------------------------------------------------

interface RunScope {
  projectId: string;
  architectureId: string;
  /** The PRIMARY run id (keys the thread + the AMS write path). */
  runId: string;
}

export interface ApplyDecisionArgs extends RunScope {
  candidateIds: string[];
  findingIds: string[];
  action: BulkReviewAction;
  reviewerNotes?: string;
  /**
   * Spec 2026-06-08 (Bug 1): candidate/finding id → its OWN source `run_id`. A
   * cascade across a multi-run scan set touches candidates/findings from several
   * runs, but AMS `bulk-review-cascade` SILENTLY SKIPS those not in the URL's run
   * (a quiet under-apply that leaves the oracle incomplete). The write is grouped
   * per run; ids absent from a map fall back to the primary `runId`.
   */
  runIdByCandidateId?: Record<string, string>;
  runIdByFindingId?: Record<string, string>;
}

export interface ResolveConflictArgs extends RunScope {
  candidateId: string;
  attr: string;
  chosenValue: unknown;
  chosenSource: string;
  /**
   * Spec 2026-06-08 (Bug 1): candidate id → its OWN source `run_id`. The Review
   * Room reads candidates across the whole scan set (multiple runs), but AMS
   * validates that a resolve-conflict targets the candidate's run
   * (`DiscoveryCandidateService` throws "Candidate X does not belong to run Y" →
   * HTTP 400). When present, the write goes to the candidate's run; absent, it
   * falls back to the primary `runId`.
   */
  runIdByCandidateId?: Record<string, string>;
}

export interface ResolveConflictsByPatternArgs extends RunScope {
  attr: string;
  /** The source chosen for ALL members (resolve-by-SAME-SOURCE). */
  chosenSource: string;
  /** The candidate ids in the similarity class (≥2 — enforced by the coordinator). */
  classCandidateIds: string[];
  /**
   * The chosen value per member, keyed by candidate id. The value is the
   * member's OWN competing value from `chosenSource` (NEVER a shared literal) —
   * the coordinator computes this from each member's live `_conflicts[attr]`.
   */
  chosenValueByCandidateId: Record<string, unknown>;
  /**
   * Spec 2026-06-08 (Bug 1): candidate id → its OWN source `run_id`. A similarity
   * class (especially a cross-source DUPLICATE) spans the scan set's runs, so
   * each member's resolve-conflict must target ITS run or AMS returns 400 ("does
   * not belong to run"). Falls back to the primary `runId` for members absent
   * from the map.
   */
  runIdByCandidateId?: Record<string, string>;
}

export interface SaveArgs extends RunScope {
  /**
   * Spec 2026-06-08 (Bug 2): the FULL run set of the reviewed scan set. The Review
   * Room aggregates candidates across EVERY run, but the MCP
   * `save_approved_candidates` tool is run-scoped — saving only the primary run
   * silently drops secondary runs' approved candidates (the oracle is under-saved).
   * Save iterates every run; absent/empty falls back to `[runId]` (single-run).
   */
  runIds?: string[];
}

// ---------------------------------------------------------------------------
// Outcomes (a shared applied|error union per write)
// ---------------------------------------------------------------------------

export type ApplyDecisionOutcome =
  | { kind: 'applied'; turn: DecisionAppliedTurn }
  | { kind: 'error'; turn: ErrorTurn };

export type ResolveConflictOutcome =
  | { kind: 'applied'; turn: ConflictResolvedTurn }
  | { kind: 'error'; turn: ErrorTurn };

export type ResolveConflictsByPatternOutcome =
  | { kind: 'applied'; turn: BulkPatternResolvedTurn }
  | { kind: 'error'; turn: ErrorTurn };

export type SaveOutcome =
  | { kind: 'applied'; turn: SavedTurn }
  | { kind: 'error'; turn: ErrorTurn };

// ---------------------------------------------------------------------------
// Path builders (mirror the gateway proxies' AMS / MCP targets verbatim)
// ---------------------------------------------------------------------------

function amsCandidatesBase(base: string, s: RunScope): string {
  return (
    `${base}/api/model/projects/${encodeURIComponent(s.projectId)}` +
    `/architectures/${encodeURIComponent(s.architectureId)}` +
    `/discovery/runs/${encodeURIComponent(s.runId)}/candidates`
  );
}

function amsFindingsBase(base: string, s: RunScope): string {
  return (
    `${base}/api/model/projects/${encodeURIComponent(s.projectId)}` +
    `/architectures/${encodeURIComponent(s.architectureId)}` +
    `/discovery/runs/${encodeURIComponent(s.runId)}/findings`
  );
}

/**
 * Spec 2026-06-08 (Bug 1): group ids by their OWN source run for a multi-run scan
 * set. AMS candidate/finding writes are run-scoped — a write to the wrong run is
 * SILENTLY SKIPPED by `bulk-review-cascade` and REJECTED (400) by resolve-conflict
 * — so a cross-run touched set must be applied one run at a time. Ids absent from
 * the map fall back to the scan-set's primary run (the single-run/back-compat case).
 */
function groupIdsByOwnRun(
  ids: readonly string[],
  runByIdMap: Record<string, string> | undefined,
  fallbackRunId: string,
): Map<string, string[]> {
  const byRun = new Map<string, string[]>();
  for (const id of ids) {
    const runId = runByIdMap?.[id] ?? fallbackRunId;
    const bucket = byRun.get(runId);
    if (bucket) bucket.push(id);
    else byRun.set(runId, [id]);
  }
  return byRun;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class ReviewDecisionOrchestrator {
  constructor(private readonly deps: ReviewOrchestratorDeps = defaultReviewOrchestratorDeps) {}

  // -------------------------------------------------------------------------
  // APPLY DECISION (atomic cascade-aware bulk apply; Spec 2)
  // -------------------------------------------------------------------------

  /**
   * Apply a disposition across the confirmed candidate + finding set. When
   * candidates are present, posts the ATOMIC `bulk-review-cascade` (which AMS
   * applies across both candidates and their linked findings in ONE
   * transaction). A findings-ONLY apply (no candidate ids) posts
   * `findings/bulk-review`. Appends a `decision-applied` turn on success.
   */
  async applyDecision(args: ApplyDecisionArgs): Promise<ApplyDecisionOutcome> {
    const base = getConfig().architectureModelServiceBaseUrl;

    try {
      let appliedCandidateCount: number | null = null;
      let appliedFindingCount: number | null = null;

      // Spec 2026-06-08 (Bug 1): a cascade can span the scan set's runs, but AMS
      // bulk-review-cascade only applies to candidates/findings in the URL's run
      // (the rest are SILENTLY SKIPPED). Group each item by its OWN run and apply
      // once per run so nothing is left behind. With no run maps (single-run /
      // back-compat) every id lands in `args.runId` → a SINGLE call as before.
      const candidatesByRun = groupIdsByOwnRun(args.candidateIds, args.runIdByCandidateId, args.runId);
      const findingsByRun = groupIdsByOwnRun(args.findingIds, args.runIdByFindingId, args.runId);
      const runIds = new Set<string>([...candidatesByRun.keys(), ...findingsByRun.keys()]);

      for (const runId of runIds) {
        const runScope: RunScope = { ...args, runId };
        const runCandidateIds = candidatesByRun.get(runId) ?? [];
        const runFindingIds = findingsByRun.get(runId) ?? [];

        if (runCandidateIds.length > 0) {
          // ATOMIC cascade apply across this run's candidates + their linked findings.
          const url = `${amsCandidatesBase(base, runScope)}/bulk-review-cascade`;
          const body = {
            candidate_ids: runCandidateIds,
            finding_ids: runFindingIds,
            review_status: args.action,
            reviewer_notes: args.reviewerNotes ?? '',
          };
          const result = await this.postJson(url, body, 'apply-decision (bulk-review-cascade)');
          const cc = readCount(result, ['updated_candidate_count', 'updated_count']);
          if (cc != null) appliedCandidateCount = (appliedCandidateCount ?? 0) + cc;
          const fc = readCount(result, ['updated_finding_count']);
          if (fc != null) appliedFindingCount = (appliedFindingCount ?? 0) + fc;
        } else if (runFindingIds.length > 0) {
          // Findings-only disposition for this run.
          const url = `${amsFindingsBase(base, runScope)}/bulk-review`;
          const body = {
            ids: runFindingIds,
            review_status: args.action,
            reviewer_notes: args.reviewerNotes ?? '',
          };
          const result = await this.postJson(url, body, 'apply-decision (findings/bulk-review)');
          const fc = readCount(result, ['updated_count']);
          if (fc != null) appliedFindingCount = (appliedFindingCount ?? 0) + fc;
        }
      }

      const turn: DecisionAppliedTurn = {
        kind: 'decision-applied',
        action: args.action,
        candidateIds: args.candidateIds,
        findingIds: args.findingIds,
        appliedCandidateCount,
        appliedFindingCount,
      };
      await this.deps.appendTurn(args.projectId, args.runId, turn);
      return { kind: 'applied', turn };
    } catch (err) {
      return { kind: 'error', turn: await this.appendError(args, err, 'apply-failed') };
    }
  }

  // -------------------------------------------------------------------------
  // RESOLVE CONFLICT (the NEW Group-1 durable write)
  // -------------------------------------------------------------------------

  /**
   * Resolve a single attribute conflict on a candidate via the Group-1
   * `PATCH .../candidates/{id}/resolve-conflict` write. snake_case body; AMS
   * stamps the camelCase keys inside `data._conflictResolutions[attr]` itself.
   * Appends a `conflict-resolved` turn on success.
   */
  async resolveConflict(args: ResolveConflictArgs): Promise<ResolveConflictOutcome> {
    try {
      // Spec 2026-06-08 (Bug 1): write to the candidate's OWN run (AMS validates
      // candidate-in-run → 400 on a cross-run write); fall back to the primary run.
      const runId = args.runIdByCandidateId?.[args.candidateId] ?? args.runId;
      await this.resolveOneConflict({ ...args, runId }, args.candidateId, args.chosenValue);
      const turn: ConflictResolvedTurn = {
        kind: 'conflict-resolved',
        candidateId: args.candidateId,
        attr: args.attr,
        chosenValue: args.chosenValue,
        chosenSource: args.chosenSource,
      };
      await this.deps.appendTurn(args.projectId, args.runId, turn);
      return { kind: 'applied', turn };
    } catch (err) {
      return { kind: 'error', turn: await this.appendError(args, err, 'resolve-conflict-failed') };
    }
  }

  // -------------------------------------------------------------------------
  // RESOLVE CONFLICTS BY PATTERN (Decision 5 — one resolve per class member)
  // -------------------------------------------------------------------------

  /**
   * Resolve EVERY member of a similarity class to the SAME chosen SOURCE.
   * Issues one deterministic Group-1 resolve-conflict write PER member (never a
   * per-item LLM loop). Each member is resolved to ITS OWN competing value from
   * `chosenSource` (never a shared literal) — the coordinator supplied
   * `chosenValueByCandidateId`. Appends a `bulk-pattern-resolved` turn
   * summarising the batch.
   *
   * Members whose chosen value is missing (no competing value from
   * `chosenSource`) are skipped defensively; the resolved count reflects only
   * the writes that fired.
   */
  async resolveConflictsByPattern(
    args: ResolveConflictsByPatternArgs,
  ): Promise<ResolveConflictsByPatternOutcome> {
    try {
      const resolved: string[] = [];
      for (const candidateId of args.classCandidateIds) {
        const chosenValue = args.chosenValueByCandidateId[candidateId];
        if (chosenValue === undefined) continue; // no value from chosenSource — skip
        // Spec 2026-06-08 (Bug 1): each class member may belong to a DIFFERENT run
        // (a duplicate/conflict spans the scan set) — write each to its OWN run so
        // AMS does not reject it with "does not belong to run" (400).
        const runId = args.runIdByCandidateId?.[candidateId] ?? args.runId;
        await this.resolveOneConflict(
          { ...args, runId, attr: args.attr, chosenSource: args.chosenSource },
          candidateId,
          chosenValue,
        );
        resolved.push(candidateId);
      }

      const turn: BulkPatternResolvedTurn = {
        kind: 'bulk-pattern-resolved',
        attr: args.attr,
        chosenSource: args.chosenSource,
        candidateIds: resolved,
        resolvedCount: resolved.length,
      };
      await this.deps.appendTurn(args.projectId, args.runId, turn);
      return { kind: 'applied', turn };
    } catch (err) {
      return { kind: 'error', turn: await this.appendError(args, err, 'resolve-conflict-failed') };
    }
  }

  // -------------------------------------------------------------------------
  // SAVE (Spec 2 save-approved path verbatim)
  // -------------------------------------------------------------------------

  /**
   * Save the run's approved candidates back to the bound architecture via the
   * MCP `save_approved_candidates` tool (the same target the `save-approved`
   * proxy posts to). Appends a `saved` turn on success.
   */
  async save(args: SaveArgs): Promise<SaveOutcome> {
    const base = getConfig().mcpBaseUrl;
    try {
      // Spec 2026-06-08 (Bug 2): save EVERY run in the scan set (de-duped), not just
      // the primary — the MCP tool is run-scoped and would otherwise leave secondary
      // runs' approved candidates unsaved. Sequential so each run's read-modify-write
      // of the architecture model observes the prior run's just-saved candidates.
      // Falls back to the primary run for a single-run / back-compat save.
      const runIds =
        args.runIds && args.runIds.length > 0 ? Array.from(new Set(args.runIds)) : [args.runId];

      let savedCount: number | null = null;
      for (const runId of runIds) {
        const url = `${base}/mcp/tools/save_approved_candidates`;
        const body = {
          sessionId: 'gateway',
          projectId: args.projectId,
          architectureId: args.architectureId,
          runId,
        };
        const result = await this.postJson(url, body, 'save (save_approved_candidates)');
        const c = readCount(result, ['saved_count', 'savedCount', 'count']);
        if (c != null) savedCount = (savedCount ?? 0) + c;
      }

      const turn: SavedTurn = { kind: 'saved', savedCount };
      await this.deps.appendTurn(args.projectId, args.runId, turn);
      return { kind: 'applied', turn };
    } catch (err) {
      return { kind: 'error', turn: await this.appendError(args, err, 'save-failed') };
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Issue ONE Group-1 resolve-conflict PATCH (snake_case body). `args.runId` is
   * the CANDIDATE's OWN run (the caller resolves it from the review model via
   * `runIdByCandidateId`), NOT the scan-set's primary run — AMS validates
   * candidate-in-run and returns 400 for a cross-run write (Spec 2026-06-08 Bug 1).
   */
  private async resolveOneConflict(
    args: { projectId: string; architectureId: string; runId: string; attr: string; chosenSource: string },
    candidateId: string,
    chosenValue: unknown,
  ): Promise<void> {
    const base = getConfig().architectureModelServiceBaseUrl;
    const url = `${amsCandidatesBase(base, args)}/${encodeURIComponent(candidateId)}/resolve-conflict`;
    const body = {
      attr: args.attr,
      chosen_value: chosenValue,
      chosen_source: args.chosenSource,
      resolved_by: REVIEW_CONVERSATION_REVIEWER,
      resolved_at: this.deps.now().toISOString(),
    };
    const response = await this.deps.fetchImpl(url, {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ReviewWriteError(response.status, text, `resolve-conflict (candidate ${candidateId})`);
    }
  }

  /** POST a JSON body and return the parsed response (throws on non-2xx). */
  private async postJson(url: string, body: unknown, label: string): Promise<unknown> {
    const response = await this.deps.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ReviewWriteError(response.status, text, label);
    }
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /** Build + append an error turn from a write failure. */
  private async appendError(
    scope: RunScope,
    err: unknown,
    errorKind: ReviewErrorKind,
  ): Promise<ErrorTurn> {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof ReviewWriteError ? err.status : null;
    const turn: ErrorTurn = {
      kind: 'error',
      errorKind,
      errorMessage: message,
      recoverableHint:
        status !== null && status >= 500
          ? 'The architecture model service is unavailable. Retry the action.'
          : 'The write was rejected. Inspect the request and retry.',
    };
    logger.warn('discovery-review orchestrator write failed', {
      projectId: scope.projectId,
      architectureId: scope.architectureId,
      runId: scope.runId,
      errorKind,
      status,
      error: message,
    });
    await this.deps.appendTurn(scope.projectId, scope.runId, turn);
    return turn;
  }
}

// ---------------------------------------------------------------------------
// Count reader — tolerant of several AMS/MCP response key spellings.
// ---------------------------------------------------------------------------

function readCount(result: unknown, keys: string[]): number | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;
  for (const k of keys) {
    if (typeof obj[k] === 'number') return obj[k] as number;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Production-default singleton (tests construct their own with mocked deps).
// ---------------------------------------------------------------------------

export const defaultReviewDecisionOrchestrator = new ReviewDecisionOrchestrator(
  defaultReviewOrchestratorDeps,
);
