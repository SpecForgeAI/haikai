/**
 * Mode 1(b) delta -- Stage 2: LLM redundancy judge (Spec 2026-06-23 Import a
 * Postman Collection into Capture, R6 / D3 / A5).
 *
 * NET-NEW helper. After the Stage-1 code pre-filter has removed the obvious
 * duplicates, the REMAINING candidate scenarios are judged by the LLM against
 * the operation's already-captured Postman requests: a candidate the captured
 * requests already exercise (even if not caught by the heuristic) is REDUNDANT
 * and dropped; only the non-redundant survivors are topped up via the existing
 * per-scenario `execute_http_request` path.
 *
 * The actual LLM call is injected (`JudgeFn`) so this helper is pure + unit
 * testable and the orchestrator owns the gateway wiring. The judge receives the
 * candidate list + captured requests and returns the set of candidate NAMES it
 * deems redundant. The helper is defensive: an unknown name in the judge's reply
 * is ignored, a thrown judge degrades to "nothing redundant" (every survivor
 * tops up -- safe: at worst we run a scenario the Postman set already covered,
 * never silently drop a genuine gap), and the result is always a subset of the
 * input survivors in input order.
 */

import type { GeneratedScenario } from './captureSessionOrchestrator';
import type { PostmanCapturedRequest } from './postmanDeltaStage1';

/**
 * Injected redundancy oracle. Returns the candidate NAMES judged redundant
 * (already covered by the captured Postman requests for that operation). The
 * orchestrator wires this to a bounded gateway LLM call; tests inject a stub.
 */
export type JudgeFn = (input: {
  operationId: string;
  method: string;
  path: string;
  candidates: ReadonlyArray<GeneratedScenario>;
  captured: ReadonlyArray<PostmanCapturedRequest>;
}) => Promise<ReadonlyArray<string>>;

export interface Stage2Args {
  operationId: string;
  method: string;
  path: string;
  /** The Stage-1 survivors -- the only candidates the judge sees. */
  candidates: ReadonlyArray<GeneratedScenario>;
  /** The operation's already-captured Postman requests. */
  captured: ReadonlyArray<PostmanCapturedRequest>;
  /** Injected LLM oracle. */
  judge: JudgeFn;
}

export interface Stage2Result {
  /** Non-redundant survivors -- these top up via execute_http_request. */
  survivors: GeneratedScenario[];
  /** Candidates the judge marked redundant (dropped from the top-up). */
  redundant: GeneratedScenario[];
}

/**
 * Stage-2 LLM judge for ONE operation. Short-circuits when there is nothing to
 * judge (no candidates, or no captured Postman requests -> nothing can be
 * redundant). Otherwise calls the injected judge and partitions the survivors.
 *
 * Fail-soft: a thrown / rejected judge is treated as "no redundancy" so every
 * survivor still tops up (we never silently drop a genuine coverage gap on an
 * LLM hiccup).
 */
export async function stage2JudgeRedundant(args: Stage2Args): Promise<Stage2Result> {
  const { candidates, captured, judge, operationId, method, path } = args;

  if (candidates.length === 0) {
    return { survivors: [], redundant: [] };
  }
  // No captured requests -> nothing the LLM could call redundant. Skip the call.
  if (captured.length === 0) {
    return { survivors: [...candidates], redundant: [] };
  }

  let redundantNames: ReadonlyArray<string> = [];
  try {
    redundantNames = await judge({ operationId, method, path, candidates, captured });
  } catch {
    // LLM hiccup -> degrade to "nothing redundant". Every survivor tops up.
    return { survivors: [...candidates], redundant: [] };
  }

  const redundantSet = new Set(
    (Array.isArray(redundantNames) ? redundantNames : []).filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    ),
  );

  const survivors: GeneratedScenario[] = [];
  const redundant: GeneratedScenario[] = [];
  for (const c of candidates) {
    if (redundantSet.has(c.name)) redundant.push(c);
    else survivors.push(c);
  }
  return { survivors, redundant };
}
