/**
 * Coverage Closure driver (Spec 2026-07-20, live integration for CC1-CC3).
 *
 * Orchestrates the "Retry uncovered APIs" run over a COMPLETED session:
 *
 *   Pass A (deterministic, free) — for each uncovered path-param endpoint, fire
 *   the ordered candidate requests `buildPassACandidates` produced (session id
 *   pool first, then DB-mined table ids), stopping the endpoint on its first
 *   happy-path 2xx.
 *
 *   Pass B (LLM repair, tail-only) — for whatever survives, run one repair loop
 *   per endpoint seeded with `buildRepairDirective` (failure-mode playbook +
 *   persisted diagnosis + the operator's notes), at the operator's per-endpoint
 *   attempt budget (reads default 15, mutating verbs capped 5).
 *
 * Then patch `coverage_summary_json` so the happy-path GATE reflects the newly
 * closed endpoints, and return the fresh gate.
 *
 * The orchestration here is PURE of transport/LLM/DB: the concrete firing,
 * repairing, and DB sampling are INJECTED (the route builds them from the real
 * http executor / runScenarioLoop / DbAdapter). That keeps the handoff logic —
 * which endpoints go to Pass A vs B, when an endpoint is considered closed, how
 * the summary is patched — unit-testable with fakes.
 */
import type {
  CoverageSummary,
  CoverageDimensionResult,
} from './captureSessionOrchestrator';
import {
  buildPassACandidates,
  tablesToSample,
  pathParamNames,
  type ClosureCandidate,
  type UncoveredEndpointInput,
} from './captureClosurePassA';
import {
  buildRepairDirective,
  type EndpointDiagnosis,
  type RepairConfig,
} from './captureClosurePassB';
import { computeHappyPathGate, type HappyPathGate } from './captureCoverageGate';

/** A 2xx is the happy-path oracle; everything else is not a baseline. */
export function isHappyStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/** Fire ONE concrete candidate request live and persist its capture. */
export interface ClosureFirer {
  fireCandidate(
    candidate: ClosureCandidate,
  ): Promise<{ status: number | null; captureId: string | null }>;
}

/** Run the Pass B LLM repair loop for one endpoint; report if it closed. */
export interface ClosureRepairer {
  repair(
    diagnosis: EndpointDiagnosis,
    directive: string,
    attempts: number,
  ): Promise<{ closed: boolean; captureId: string | null }>;
}

/** Sample real id candidate values from the source DB for the given tables. */
export interface ClosureDbSampler {
  /** table → distinct sampled id-ish values (best-effort; [] on failure). */
  sampleIds(tables: ReadonlyArray<string>, paramNames: ReadonlyArray<string>): Promise<Map<string, string[]>>;
}

export interface ClosureConfigEntry {
  operation_id: string;
  attempts?: number | null;
  notes?: string | null;
}

export interface ClosureOrchestrationInput {
  summary: CoverageSummary;
  /** operation_id → its mapped physical tables (from the effect-scope index). */
  tablesByOperationId: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Optional session-wide harvested id pool (empty when unavailable). */
  sessionIdPool?: ReadonlyArray<string>;
  /** Per-endpoint Pass B config from the retry modal, by operation_id. */
  configByOperationId: ReadonlyMap<string, ClosureConfigEntry>;
  /** Last-attempt diagnosis per uncovered endpoint (for Pass B directives). */
  diagnosisByOperationId: ReadonlyMap<string, EndpointDiagnosis>;
}

export interface ClosureOrchestrationResult {
  passA: { fired: number; closed: string[] };
  passB: { attempted: number; closed: string[] };
  /** operation_id → the capture id that closed it (Pass A or B). */
  captureIdByOperationId: Map<string, string>;
  updatedSummary: CoverageSummary;
  gate: HappyPathGate;
}

/**
 * Drive Pass A then Pass B over the uncovered endpoints and patch the summary.
 * Transport/LLM/DB are injected. Fail-soft per endpoint: a firer/repairer that
 * throws drops that endpoint (it simply stays unresolved), never the whole run.
 */
export async function runClosureOrchestration(
  input: ClosureOrchestrationInput,
  firer: ClosureFirer,
  repairer: ClosureRepairer,
  dbSampler: ClosureDbSampler,
): Promise<ClosureOrchestrationResult> {
  const gate0 = computeHappyPathGate(input.summary);
  const uncovered: UncoveredEndpointInput[] = gate0.unresolved.map((u) => ({
    operation_id: u.operation_id,
    method: u.method,
    path: u.path,
  }));

  const closedBy = new Map<string, string>(); // operation_id → capture id
  const passAClosed: string[] = [];
  let passAFired = 0;

  // ---- Pass A: deterministic candidate replay -----------------------------
  const paramEndpoints = uncovered.filter((e) => pathParamNames(e.path).length > 0);
  const tablesNeeded = tablesToSample(paramEndpoints, input.tablesByOperationId);
  const paramNames = Array.from(
    new Set(paramEndpoints.flatMap((e) => pathParamNames(e.path))),
  );
  let dbValuesByTable = new Map<string, string[]>();
  if (tablesNeeded.length > 0) {
    try {
      dbValuesByTable = await dbSampler.sampleIds(tablesNeeded, paramNames);
    } catch {
      dbValuesByTable = new Map();
    }
  }

  const candidates = buildPassACandidates({
    uncovered: paramEndpoints,
    sessionIdPool: input.sessionIdPool ?? [],
    tablesByOperationId: input.tablesByOperationId,
    dbValuesByTable,
  });

  // Fire in order; stop firing for an endpoint once it is closed.
  for (const candidate of candidates) {
    if (closedBy.has(candidate.operation_id)) continue;
    passAFired += 1;
    try {
      const { status, captureId } = await firer.fireCandidate(candidate);
      if (isHappyStatus(status) && captureId) {
        closedBy.set(candidate.operation_id, captureId);
        passAClosed.push(candidate.operation_id);
      }
    } catch {
      // fail-soft: this candidate is skipped; the endpoint may still close on a
      // later candidate or drop to Pass B.
    }
  }

  // ---- Pass B: LLM repair for survivors -----------------------------------
  const survivors = uncovered.filter((e) => !closedBy.has(e.operation_id));
  const passBClosed: string[] = [];
  let passBAttempted = 0;
  for (const ep of survivors) {
    const diag: EndpointDiagnosis =
      input.diagnosisByOperationId.get(ep.operation_id) ?? {
        operation_id: ep.operation_id,
        method: ep.method,
        path: ep.path,
        last_status: null,
        last_error_summary: null,
        last_request_summary: null,
      };
    const cfg = input.configByOperationId.get(ep.operation_id);
    const repairConfig: RepairConfig = { attempts: cfg?.attempts ?? null, notes: cfg?.notes ?? null };
    const directive = buildRepairDirective(diag, repairConfig);
    passBAttempted += 1;
    try {
      const { closed, captureId } = await repairer.repair(diag, directive.directive, directive.attempts);
      if (closed && captureId) {
        closedBy.set(ep.operation_id, captureId);
        passBClosed.push(ep.operation_id);
      }
    } catch {
      // fail-soft: endpoint stays unresolved.
    }
  }

  const updatedSummary = applyClosureToSummary(input.summary, closedBy);
  return {
    passA: { fired: passAFired, closed: passAClosed },
    passB: { attempted: passBAttempted, closed: passBClosed },
    captureIdByOperationId: closedBy,
    updatedSummary,
    gate: computeHappyPathGate(updatedSummary),
  };
}

/**
 * Exclude-with-reason (Pass C): drop one endpoint from the coverage summary so
 * it leaves the happy-path gate denominator — "accounted", not "unresolved" —
 * for the genuinely uncapturable (endpoint 500s, not deployed on non-prod).
 * PURE. Removes the endpoint from `per_endpoint`, records it under
 * `closure_excluded` with its reason + timestamp (audit trail), and recomputes
 * the aggregate counts/score. A no-op (returns the input) when the endpoint is
 * not present. `at` is injected (callers stamp the time) to keep this pure.
 */
export function removeEndpointFromSummary(
  summary: CoverageSummary,
  operationId: string,
  reason: string,
  at: string,
): CoverageSummary {
  const target = summary.per_endpoint.find((e) => e.operation_id === operationId);
  if (!target) return summary;
  const perEndpoint = summary.per_endpoint.filter((e) => e.operation_id !== operationId);
  const removedDims = target.dimensions.length;
  const removedAchieved = target.dimensions.filter((d) => d.achieved).length;
  const dimensionsTotal = Math.max(0, summary.dimensions_total - removedDims);
  const dimensionsAchieved = Math.max(0, summary.dimensions_achieved - removedAchieved);
  const priorExcluded = Array.isArray((summary as { closure_excluded?: unknown }).closure_excluded)
    ? ((summary as unknown as { closure_excluded: Array<Record<string, unknown>> }).closure_excluded)
    : [];
  return {
    ...summary,
    per_endpoint: perEndpoint,
    dimensions_total: dimensionsTotal,
    dimensions_achieved: dimensionsAchieved,
    overall_score: dimensionsTotal > 0 ? dimensionsAchieved / dimensionsTotal : 0,
    // Audit list rides alongside the typed fields (tolerated by the JSONB wire).
    ...({
      closure_excluded: [
        ...priorExcluded,
        { operation_id: operationId, method: target.method, path: target.path, reason, at },
      ],
    } as object),
  } as CoverageSummary;
}

/** A synthetic achieved happy dimension for an endpoint that had none. */
function achievedHappyDimension(captureId: string): CoverageDimensionResult {
  return {
    name: 'happy_path',
    type: 'happy_path',
    expected_status: 'success',
    dimension_kind: 'happy',
    reported_only: false,
    achieved: true,
    canonical_capture_id: captureId,
    reason: null,
    observation: null,
  };
}

/**
 * Patch a coverage summary so every closed endpoint's happy-path dimension
 * reads achieved (with its closing capture id), then recompute the aggregate
 * counts + scores. PURE. `dimensions_total` is unchanged — closure achieves
 * existing dimensions, it does not add rubric (except injecting a happy
 * dimension for an endpoint that never had one, which also bumps the total).
 */
export function applyClosureToSummary(
  summary: CoverageSummary,
  captureIdByOperationId: ReadonlyMap<string, string>,
): CoverageSummary {
  let addedDimensions = 0;
  const perEndpoint = summary.per_endpoint.map((ep) => {
    const captureId = captureIdByOperationId.get(ep.operation_id);
    if (!captureId) return ep;
    const idx = ep.dimensions.findIndex(
      (d) => d.type === 'happy_path' || d.name === 'happy_path',
    );
    let dimensions: CoverageDimensionResult[];
    if (idx === -1) {
      dimensions = [achievedHappyDimension(captureId), ...ep.dimensions];
      addedDimensions += 1;
    } else if (ep.dimensions[idx].achieved) {
      return ep; // already achieved; nothing to do.
    } else {
      dimensions = ep.dimensions.slice();
      dimensions[idx] = {
        ...dimensions[idx],
        achieved: true,
        canonical_capture_id: captureId,
        reason: null,
      };
    }
    const achieved = dimensions.filter((d) => d.achieved).length;
    return { ...ep, dimensions, score: dimensions.length ? achieved / dimensions.length : 0 };
  });

  const endpointAchieved = perEndpoint.reduce(
    (acc, e) => acc + e.dimensions.filter((d) => d.achieved).length,
    0,
  );
  const dimensionsTotal = summary.dimensions_total + addedDimensions;
  const dimensionsAchieved = endpointAchieved + (summary.auth_coverage.achieved ? 1 : 0);
  return {
    ...summary,
    per_endpoint: perEndpoint,
    dimensions_total: dimensionsTotal,
    dimensions_achieved: dimensionsAchieved,
    overall_score: dimensionsTotal > 0 ? dimensionsAchieved / dimensionsTotal : 0,
  };
}
