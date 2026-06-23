/**
 * Mode 1(b) delta -- Stage 1: code pre-filter heuristic (Spec 2026-06-23 Import
 * a Postman Collection into Capture, R6 / D3 / A5).
 *
 * NET-NEW pure helper. Given one operation's `defaultScenarioSet` candidate
 * scenarios and the SAME operation's already-captured Postman requests, remove
 * the candidates that OBVIOUSLY duplicate a captured request -- so the LLM judge
 * (Stage 2) and the per-scenario `execute_http_request` top-up only ever run for
 * the genuine delta. Keyed by the dimensions the spec calls out:
 *   - archetype (`type`)         e.g. happy_path / not_found / bad_request
 *   - method                     the HTTP verb
 *   - path                       the operation path (already op-scoped, but kept
 *                                explicit so a multi-path op set never crosses)
 *   - which-param                the parameter a negative scenario targets
 *   - expectedStatus             success / not_found / client_error class
 *
 * This is DELIBERATELY conservative: a candidate is pre-filtered out ONLY when a
 * captured request clearly exercises the SAME archetype + expected-status class
 * (and, for param-targeted negatives, the SAME which-param). Anything ambiguous
 * is LEFT IN for the Stage-2 LLM judge -- the heuristic never removes a candidate
 * the LLM has not had a chance to keep.
 *
 * Pure: no fetch / DOM / AMS / LLM. Total (never throws on malformed input).
 */

import type { GeneratedScenario, ScenarioExpectedStatus } from './captureSessionOrchestrator';

/**
 * One imported Postman request that was captured for an operation (the
 * deterministic "given"). Minimal shape so the heuristic stays decoupled from
 * the capture DTO: the orchestrator projects each captured manual scenario into
 * this before calling. `whichParam` is the parameter a negative request targeted
 * (when known); `expectedStatus` is the captured response class (derived from the
 * real HTTP status); `archetype` is the scenario `type` when it was captured with
 * one (manual Postman captures usually carry none -> undefined).
 */
export interface PostmanCapturedRequest {
  method: string;
  path: string;
  /** Captured response class, derived from the real HTTP status. */
  expectedStatus?: ScenarioExpectedStatus | null;
  /** Scenario archetype (`type`) when the captured request carried one. */
  archetype?: string | null;
  /** The parameter a negative/param-targeted request exercised, when known. */
  whichParam?: string | null;
}

/** Result of the Stage-1 split: candidates to keep vs the ones pre-filtered out. */
export interface Stage1Result {
  /** Candidates NOT obviously covered -- forwarded to the Stage-2 LLM judge. */
  survivors: GeneratedScenario[];
  /** Candidates removed because a captured request obviously covers them. */
  prefiltered: GeneratedScenario[];
}

/** Map an HTTP status onto the same expected-status class the planner uses. */
export function classifyStatus(status: number | null | undefined): ScenarioExpectedStatus | null {
  if (typeof status !== 'number') return null;
  if (status === 404) return 'not_found';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'client_error';
  return null;
}

/**
 * Extract the parameter a candidate scenario targets from its NAME. The planner
 * names param-targeted scenarios `not_found_<p>`, `bad_request_<p>`,
 * `bad_request_<p>_type`, `edge_<p>`, `enum_<p>_<value>`, `filter_combo_<a>_<b>`.
 * Returns the first param token when present, else null (happy_path,
 * bad_request_body, etc. target no single param).
 */
export function candidateWhichParam(name: string): string | null {
  const n = name ?? '';
  let m = n.match(/^not_found_(.+)$/);
  if (m) return m[1];
  m = n.match(/^edge_(.+)$/);
  if (m) return m[1];
  m = n.match(/^bad_request_(.+?)(?:_type)?$/);
  if (m && m[1] !== 'body') return m[1];
  m = n.match(/^enum_(.+?)_/);
  if (m) return m[1];
  return null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Does a captured Postman request OBVIOUSLY cover this candidate scenario?
 *
 * - Method must match (case-insensitive).
 * - Path must match when the captured request carries one (op-scoped, but a
 *   mismatch is a hard no).
 * - The candidate's expected-status class must match the captured response
 *   class. (A happy_path candidate is only covered by a captured 2xx; a
 *   not_found only by a captured 404; a client_error only by a captured 4xx.)
 * - For a param-targeted candidate (`whichParam` non-null) the captured request
 *   must target the SAME param (when the capture records which-param); if the
 *   capture does NOT record which-param we DO NOT pre-filter param-targeted
 *   candidates -- we leave them for the LLM judge.
 */
function captureCoversCandidate(
  candidate: GeneratedScenario,
  cap: PostmanCapturedRequest,
  opMethod: string,
  opPath: string,
): boolean {
  if (norm(cap.method) !== norm(opMethod)) return false;
  if (cap.path && norm(cap.path) !== norm(opPath)) return false;

  const capClass = cap.expectedStatus ?? null;
  if (capClass === null) return false;
  if (capClass !== candidate.expectedStatus) return false;

  const candParam = candidateWhichParam(candidate.name);
  if (candParam !== null) {
    // A param-targeted candidate. Only pre-filter if the capture records the
    // SAME which-param; otherwise leave it for the LLM judge.
    if (!cap.whichParam) return false;
    if (norm(cap.whichParam) !== norm(candParam)) return false;
  }

  return true;
}

/**
 * Stage-1 pre-filter for ONE operation. Splits the planner's candidate scenarios
 * into the survivors (forwarded to the LLM judge) and the obviously-covered
 * pre-filtered set. `opMethod` / `opPath` are the operation's identity (so a
 * capture whose path differs never matches).
 *
 * Empty `captured` -> every candidate survives (no Postman coverage to subtract).
 */
export function stage1PreFilter(
  candidates: ReadonlyArray<GeneratedScenario>,
  captured: ReadonlyArray<PostmanCapturedRequest>,
  opMethod: string,
  opPath: string,
): Stage1Result {
  const survivors: GeneratedScenario[] = [];
  const prefiltered: GeneratedScenario[] = [];
  for (const candidate of candidates) {
    const covered = captured.some((cap) =>
      captureCoversCandidate(candidate, cap, opMethod, opPath),
    );
    if (covered) prefiltered.push(candidate);
    else survivors.push(candidate);
  }
  return { survivors, prefiltered };
}
