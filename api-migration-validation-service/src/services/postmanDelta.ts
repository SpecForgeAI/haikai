/**
 * Mode 1(b) delta -- two-stage bounded subtraction orchestration (Spec
 * 2026-06-23 Import a Postman Collection into Capture, R6 / D3 / A5).
 *
 * NET-NEW helper that ties Stage-1 (code pre-filter) and Stage-2 (LLM judge)
 * together for ONE operation and enforces the per-operation scenario cap:
 *
 *   delta = defaultScenarioSet(op) MINUS (Stage-1 prefiltered + Stage-2 redundant)
 *
 * capped at `maxScenariosPerOp` INCLUDING the already-captured Postman scenarios.
 * The Postman captures are the deterministic "given" that ALSO count against the
 * cap, so the LLM top-up budget for an op is `maxScenariosPerOp - capturedCount`
 * (never negative). Survivors beyond that budget are trimmed (the most valuable
 * archetypes survive because `defaultScenarioSet` already orders happy_path +
 * discovery seeds first).
 *
 * The orchestrator calls this BEFORE the per-scenario `execute_http_request`
 * loop, so only the returned survivors are ever generated/sent.
 */

import type { GeneratedScenario } from './captureSessionOrchestrator';
import { stage1PreFilter, type PostmanCapturedRequest } from './postmanDeltaStage1';
import { stage2JudgeRedundant, type JudgeFn } from './postmanDeltaStage2';

export interface ComputeDeltaArgs {
  operationId: string;
  method: string;
  path: string;
  /** The planner's full candidate set for this operation. */
  candidates: ReadonlyArray<GeneratedScenario>;
  /** This operation's already-captured Postman requests (the "given"). */
  captured: ReadonlyArray<PostmanCapturedRequest>;
  /** Injected Stage-2 LLM oracle. */
  judge: JudgeFn;
  /** `MAX_SCENARIOS_PER_OP` -- the cap INCLUDING captured Postman scenarios. */
  maxScenariosPerOp: number;
}

export interface ComputeDeltaResult {
  /** Survivors to top up via execute_http_request, capped per operation. */
  topUp: GeneratedScenario[];
  /** Diagnostics: counts of each subtraction stage (for trace lines). */
  stats: {
    candidateCount: number;
    capturedCount: number;
    stage1Prefiltered: number;
    stage2Redundant: number;
    cappedOut: number;
    topUpCount: number;
  };
}

/**
 * Compute the Mode 1(b) per-operation delta. Always returns a `topUp` array that
 * is a subset of `candidates` in input order, sized so that
 * `capturedCount + topUp.length <= maxScenariosPerOp`.
 */
export async function computePostmanDelta(args: ComputeDeltaArgs): Promise<ComputeDeltaResult> {
  const { candidates, captured, judge, operationId, method, path, maxScenariosPerOp } = args;

  // Stage 1: drop candidates a captured request obviously covers.
  const s1 = stage1PreFilter(candidates, captured, method, path);

  // Stage 2: LLM judges the Stage-1 survivors redundant-or-not.
  const s2 = await stage2JudgeRedundant({
    operationId,
    method,
    path,
    candidates: s1.survivors,
    captured,
    judge,
  });

  // Cap INCLUDING the already-captured Postman scenarios: the captures consume
  // budget too, so the top-up budget is the remainder (floored at 0).
  const budget = Math.max(0, maxScenariosPerOp - captured.length);
  const topUp = s2.survivors.slice(0, budget);
  const cappedOut = s2.survivors.length - topUp.length;

  return {
    topUp,
    stats: {
      candidateCount: candidates.length,
      capturedCount: captured.length,
      stage1Prefiltered: s1.prefiltered.length,
      stage2Redundant: s2.redundant.length,
      cappedOut,
      topUpCount: topUp.length,
    },
  };
}
