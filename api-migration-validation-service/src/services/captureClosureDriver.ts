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
import {
  computeHappyPathGate,
  type HappyPathGate,
  type FailedDimensionRef,
} from './captureCoverageGate';
import {
  classifyObservedBehaviour,
  type ResponseSemanticsConfig,
} from './responseSemantics';

/** A 2xx is the happy-path oracle; everything else is not a baseline. */
export function isHappyStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/**
 * The closing capture for a NAMED dimension: the LAST capture whose OBSERVED
 * behaviour matches the dimension's intended class (a not_found dimension
 * closes on its intended not-found behaviour, never on a stray 2xx). This is
 * deliberately STRICTER than `selectCanonicalCapture`, whose "last usable
 * oracle" fallback would close a dimension on the wrong behaviour class.
 */
export function selectDimensionClosingCapture(
  captures: ReadonlyArray<{ captureId: string; status: number | null; body?: unknown }>,
  expectedStatus: FailedDimensionRef['expected_status'],
  config?: ResponseSemanticsConfig | null,
): { captureId: string; status: number | null } | null {
  for (let i = captures.length - 1; i >= 0; i -= 1) {
    const ob = classifyObservedBehaviour(captures[i].status, captures[i].body, config);
    if (ob.observed && ob.bucket === expectedStatus) {
      return { captureId: captures[i].captureId, status: captures[i].status };
    }
  }
  return null;
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

/**
 * Run one repair loop for a NAMED failed dimension (2026-07-25 — dimensional
 * closure). The implementation judges closure per the dimension's
 * expected_status class (via {@link selectDimensionClosingCapture}), NOT the
 * happy 2xx oracle.
 */
export interface ClosureDimensionRepairer {
  repairDimension(
    dimension: FailedDimensionRef,
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
  /**
   * OPTIONAL dimensional retry set (2026-07-25): the failed non-happy
   * dimensions to repair after Pass A/B (from `collectFailedDimensions`).
   * Empty/absent -> the dimensional pass is skipped entirely.
   */
  failedDimensions?: ReadonlyArray<FailedDimensionRef>;
}

export interface ClosedDimensionRef {
  operation_id: string;
  name: string;
  capture_id: string;
}

export interface ClosureOrchestrationResult {
  passA: { fired: number; closed: string[] };
  passB: { attempted: number; closed: string[] };
  /** Dimensional pass (only runs when failedDimensions were supplied). */
  dimensional: { attempted: number; closed: ClosedDimensionRef[] };
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
  dimensionRepairer?: ClosureDimensionRepairer,
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

  // ---- Dimensional pass (2026-07-25): repair the OTHER failed dimensions ---
  // Runs after Pass A/B so a freshly-closed endpoint's remaining dimensions
  // are retried in the same run. Fail-soft per dimension, like the passes
  // above. Skipped entirely when no dimensions (or no repairer) were supplied.
  const dimensionalClosed: ClosedDimensionRef[] = [];
  let dimensionalAttempted = 0;
  const failedDimensions = input.failedDimensions ?? [];
  if (dimensionRepairer && failedDimensions.length > 0) {
    for (const dim of failedDimensions) {
      const cfg = input.configByOperationId.get(dim.operation_id);
      const repairConfig: RepairConfig = {
        attempts: cfg?.attempts ?? null,
        notes: cfg?.notes ?? null,
      };
      // Reuse the failure-mode playbook seeded from the dimension's recorded
      // miss reason, then bolt the dimension intent on top — the repair goal
      // is the dimension's expected behaviour class, not a 2xx.
      const base = buildRepairDirective(
        {
          operation_id: dim.operation_id,
          method: dim.method,
          path: dim.path,
          last_status: null,
          last_error_summary: dim.reason,
          last_request_summary: null,
        },
        repairConfig,
      );
      const directive =
        `Coverage dimension repair — scenario "${dim.name}" (type ${dim.type}) for ` +
        `${dim.method.toUpperCase()} ${dim.path}. The goal is to elicit the ` +
        `"${dim.expected_status}" behaviour class for this scenario (NOT the happy path). ` +
        (dim.reason ? `Recorded miss reason: ${dim.reason}. ` : '') +
        `\n${base.directive}`;
      dimensionalAttempted += 1;
      try {
        const { closed, captureId } = await dimensionRepairer.repairDimension(
          dim,
          directive,
          base.attempts,
        );
        if (closed && captureId) {
          dimensionalClosed.push({
            operation_id: dim.operation_id,
            name: dim.name,
            capture_id: captureId,
          });
        }
      } catch {
        // fail-soft: the dimension stays unachieved.
      }
    }
  }

  let updatedSummary = applyClosureToSummary(input.summary, closedBy);
  updatedSummary = applyDimensionClosuresToSummary(updatedSummary, dimensionalClosed);
  return {
    passA: { fired: passAFired, closed: passAClosed },
    passB: { attempted: passBAttempted, closed: passBClosed },
    dimensional: { attempted: dimensionalAttempted, closed: dimensionalClosed },
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

/**
 * Dimension-level exclude-with-reason (2026-08-02): mark ONE failed non-happy
 * dimension of an endpoint `reported_only` so it leaves the retryable/failed
 * coverage population (the "Not Possible" action on an `other` row) WITHOUT
 * removing the endpoint or touching its happy-path gate. PURE. Records the
 * disposition under `closure_excluded` (with the scenario name) for the audit
 * trail. A no-op (returns the input) when the endpoint or dimension is absent.
 */
export function excludeDimensionFromSummary(
  summary: CoverageSummary,
  operationId: string,
  scenarioName: string,
  reason: string,
  at: string,
): CoverageSummary {
  const target = summary.per_endpoint.find((e) => e.operation_id === operationId);
  if (!target) return summary;
  const idx = target.dimensions.findIndex((d) => d.name === scenarioName);
  if (idx === -1 || target.dimensions[idx].reported_only) return summary;
  const dimensions = target.dimensions.slice();
  dimensions[idx] = { ...dimensions[idx], reported_only: true };
  const perEndpoint = summary.per_endpoint.map((e) =>
    e.operation_id === operationId ? { ...e, dimensions } : e,
  );
  const priorExcluded = Array.isArray((summary as { closure_excluded?: unknown }).closure_excluded)
    ? ((summary as unknown as { closure_excluded: Array<Record<string, unknown>> }).closure_excluded)
    : [];
  return {
    ...summary,
    per_endpoint: perEndpoint,
    ...({
      closure_excluded: [
        ...priorExcluded,
        {
          operation_id: operationId,
          method: target.method,
          path: target.path,
          scenario_name: scenarioName,
          reason,
          at,
        },
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

/**
 * Replace the session-level auth-negative coverage with a fresh probe result
 * and recompute the aggregate counts/score. PURE. The auth dimension
 * contributes exactly ONE dimension to the totals (already counted in
 * `dimensions_total`), so only `dimensions_achieved`/`overall_score` move.
 * Used by the dimensional retry (2026-07-25): the auth dimension lives
 * OUTSIDE `per_endpoint`, so `collectFailedDimensions` never sees it — the
 * route re-runs the deterministic probes and patches the result in here.
 */
export function applyAuthCoverageToSummary(
  summary: CoverageSummary,
  authCoverage: CoverageSummary['auth_coverage'],
): CoverageSummary {
  const endpointAchieved = summary.per_endpoint.reduce(
    (acc, e) => acc + e.dimensions.filter((d) => d.achieved).length,
    0,
  );
  const dimensionsAchieved = endpointAchieved + (authCoverage.achieved ? 1 : 0);
  return {
    ...summary,
    auth_coverage: authCoverage,
    dimensions_achieved: dimensionsAchieved,
    overall_score:
      summary.dimensions_total > 0 ? dimensionsAchieved / summary.dimensions_total : 0,
  };
}

/**
 * Patch a coverage summary so each closed NAMED dimension reads achieved (with
 * its closing capture id), then recompute the per-endpoint scores + aggregate
 * counts. PURE — the dimensional sibling of {@link applyClosureToSummary}.
 * Unknown operation/dimension names are ignored (never throws); the total
 * dimension count is unchanged (a named dimension exists by definition).
 */
export function applyDimensionClosuresToSummary(
  summary: CoverageSummary,
  closed: ReadonlyArray<ClosedDimensionRef>,
): CoverageSummary {
  if (closed.length === 0) return summary;
  const byOperation = new Map<string, Map<string, string>>();
  for (const c of closed) {
    const dims = byOperation.get(c.operation_id) ?? new Map<string, string>();
    dims.set(c.name, c.capture_id);
    byOperation.set(c.operation_id, dims);
  }
  const perEndpoint = summary.per_endpoint.map((ep) => {
    const dims = byOperation.get(ep.operation_id);
    if (!dims) return ep;
    let changed = false;
    const dimensions = ep.dimensions.map((d) => {
      const captureId = dims.get(d.name);
      if (!captureId || d.achieved) return d;
      changed = true;
      return { ...d, achieved: true, canonical_capture_id: captureId, reason: null };
    });
    if (!changed) return ep;
    const achieved = dimensions.filter((d) => d.achieved).length;
    return { ...ep, dimensions, score: dimensions.length ? achieved / dimensions.length : 0 };
  });
  const endpointAchieved = perEndpoint.reduce(
    (acc, e) => acc + e.dimensions.filter((d) => d.achieved).length,
    0,
  );
  const dimensionsAchieved = endpointAchieved + (summary.auth_coverage.achieved ? 1 : 0);
  return {
    ...summary,
    per_endpoint: perEndpoint,
    dimensions_achieved: dimensionsAchieved,
    overall_score:
      summary.dimensions_total > 0 ? dimensionsAchieved / summary.dimensions_total : 0,
  };
}
