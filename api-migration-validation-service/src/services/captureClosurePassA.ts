/**
 * Coverage Closure — Pass A: deterministic candidate generation (Spec
 * 2026-07-20, CC2). NO LLM, nearly free.
 *
 * The capture engine's 90-95% ceiling is STRUCTURAL, and its single biggest
 * cause is that learning only flows FORWARD: operations run in definition order,
 * one pass, so an endpoint early in the loop that 404s for want of a real id can
 * never benefit from ids harvested from endpoints captured AFTER it
 * (`GET /orders/{id}` at position 3 fails; `GET /orders` at position 40 returns
 * real ids too late). The second cause is that a path-param 404 is never
 * resolved from the source database even though the endpoint→table mapping is
 * committed.
 *
 * Pass A closes both deterministically. Given the uncovered endpoints and two
 * value sources — the WHOLE session's harvested id pool (not just what preceded
 * each endpoint) and the endpoint's mapped-table sampled values — it produces an
 * ORDERED, BOUNDED list of concrete candidate requests to re-fire. The driver
 * (CC3) fires each through the existing manual-capture primitive, stopping an
 * endpoint as soon as a candidate yields its happy-path baseline.
 *
 * This module is PURE (inputs in, candidates out — no I/O, no mutation) and
 * unit-tested. Only endpoints with at least one `{param}` path segment get
 * candidates here; a 404 with no path param (auth scope, body shape, sequencing)
 * is not a missing-id problem and is deferred to Pass B.
 */

/** An uncovered endpoint (happy-path baseline missing) to close. */
export interface UncoveredEndpointInput {
  operation_id: string;
  method: string;
  /** Path TEMPLATE, e.g. `/orders/{id}` or `/p/{pid}/c/{cid}`. */
  path: string;
}

/** A concrete request to re-fire, with provenance for the diagnostic trail. */
export interface ClosureCandidate {
  operation_id: string;
  method: string;
  /** Concrete path with every `{param}` substituted. */
  path: string;
  /** The param→value substitution that produced this concrete path. */
  substitution: Record<string, string>;
  /** Where the substituted values came from. */
  source: 'session_pool' | 'db_mined';
}

export interface PassAInputs {
  uncovered: ReadonlyArray<UncoveredEndpointInput>;
  /**
   * Every identifier value harvested ANYWHERE in the session (deduped, ordered
   * most-recent-first by the caller). This is the forward-only-learning fix:
   * the full pool, not the prefix available when each endpoint first ran.
   */
  sessionIdPool: ReadonlyArray<string>;
  /** Endpoint operation_id → its mapped physical tables (write/read-write). */
  tablesByOperationId: ReadonlyMap<string, ReadonlyArray<string>>;
  /**
   * DB-mined candidate values per table (the caller samples the table's key
   * column via the DbAdapter). Ordered as sampled.
   */
  dbValuesByTable: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** Cap on candidates emitted per endpoint — bounds combinatorial blow-up. */
export const MAX_CANDIDATES_PER_ENDPOINT = 20;

/** Ordered `{param}` names in a path template (duplicates removed, in order). */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Substitute a full param→value map into a path template. */
function substitutePath(template: string, subst: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_full, raw) => {
    const name = String(raw).trim();
    const value = subst[name];
    return value !== undefined ? encodeURIComponent(value) : `{${raw}}`;
  });
}

/**
 * Cartesian assignments of `values` to `params`, most-preferred-first and
 * bounded to `cap` total. Single-param is the overwhelming real case (one
 * resource id); multi-param uses a bounded diagonal-then-cartesian walk so the
 * first candidates pair like-index values (often the intended tuple) before
 * exhausting the cross product.
 */
function boundedAssignments(
  params: string[],
  values: string[],
  cap: number,
): Array<Record<string, string>> {
  if (params.length === 0 || values.length === 0) return [];
  const out: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  const push = (assign: Record<string, string>) => {
    const key = params.map((p) => assign[p]).join('');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(assign);
  };

  if (params.length === 1) {
    const [p] = params;
    for (const v of values) {
      if (out.length >= cap) break;
      push({ [p]: v });
    }
    return out;
  }

  // Diagonal first: same-index value across all params (the common tuple).
  for (const v of values) {
    if (out.length >= cap) break;
    push(Object.fromEntries(params.map((p) => [p, v])));
  }
  // Then a bounded cross product for the remainder.
  const indices = new Array(params.length).fill(0);
  const total = Math.pow(values.length, params.length);
  for (let n = 0; n < total && out.length < cap; n += 1) {
    let carry = n;
    for (let i = params.length - 1; i >= 0; i -= 1) {
      indices[i] = carry % values.length;
      carry = Math.floor(carry / values.length);
    }
    push(Object.fromEntries(params.map((p, i) => [p, values[indices[i]]])));
  }
  return out;
}

/**
 * Build the ordered candidate requests for every uncovered endpoint that has a
 * path parameter. Session-pool candidates come FIRST (free, no DB round-trip),
 * then DB-mined candidates. Concrete paths are deduped per endpoint and capped.
 * Pure.
 */
export function buildPassACandidates(inputs: PassAInputs): ClosureCandidate[] {
  const out: ClosureCandidate[] = [];
  const pool = dedupe(inputs.sessionIdPool);

  for (const ep of inputs.uncovered) {
    const params = pathParamNames(ep.path);
    if (params.length === 0) continue; // not a missing-id problem → Pass B.

    const seenPaths = new Set<string>();
    const emit = (subst: Record<string, string>, source: ClosureCandidate['source']) => {
      const path = substitutePath(ep.path, subst);
      if (path.includes('{')) return; // unresolved param → skip.
      if (seenPaths.has(path)) return;
      seenPaths.add(path);
      out.push({ operation_id: ep.operation_id, method: ep.method, path, substitution: subst, source });
    };

    // 1. Session id pool (the forward-only-learning fix).
    for (const assign of boundedAssignments(params, pool, MAX_CANDIDATES_PER_ENDPOINT)) {
      if (seenPaths.size >= MAX_CANDIDATES_PER_ENDPOINT) break;
      emit(assign, 'session_pool');
    }

    // 2. DB-mined values from the endpoint's mapped tables.
    const tables = inputs.tablesByOperationId.get(ep.operation_id) ?? [];
    const dbValues = dedupe(
      tables.flatMap((t) => Array.from(inputs.dbValuesByTable.get(t) ?? [])),
    );
    for (const assign of boundedAssignments(params, dbValues, MAX_CANDIDATES_PER_ENDPOINT)) {
      if (seenPaths.size >= MAX_CANDIDATES_PER_ENDPOINT) break;
      emit(assign, 'db_mined');
    }
  }
  return out;
}

/** The tables Pass A should DB-sample for an uncovered endpoint set. */
export function tablesToSample(
  uncovered: ReadonlyArray<UncoveredEndpointInput>,
  tablesByOperationId: ReadonlyMap<string, ReadonlyArray<string>>,
): string[] {
  const tables = new Set<string>();
  for (const ep of uncovered) {
    if (pathParamNames(ep.path).length === 0) continue;
    for (const t of tablesByOperationId.get(ep.operation_id) ?? []) tables.add(t);
  }
  return Array.from(tables);
}

function dedupe(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
