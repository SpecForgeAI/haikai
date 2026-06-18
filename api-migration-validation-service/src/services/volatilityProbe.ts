import {
  compareJsonShapes,
  type VolatilityEnvelope,
  type VolatilitySource,
} from './jsonShapeComparator';
import type { SessionHttpExecutor } from './httpExecutor';
import {
  VOLATILITY_PROBE_REPEATS as DEFAULT_REPEATS,
  VOLATILITY_PROBE_BUDGET_MS as DEFAULT_BUDGET_MS,
  VOLATILITY_PROBE_SPACING_MS as DEFAULT_SPACING_MS,
} from '../config';

/**
 * Capture-time empirical volatility probe.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 2.
 *
 * After a current-state scenario is captured, this probe REPLAYS the same
 * request against the current system `k` times (HTTP-only -- NO LLM, runs
 * inline at pin time, the only moment the current system is authoritative and
 * callable) and self-diffs the responses using the existing
 * `compareJsonShapes` machinery. Any JSON path that differs across the
 * repeats is a MEASURED volatile path, recorded as a normalised JSON-Pointer
 * list; an array path whose ORDER differs is additionally flagged
 * order-insensitive.
 *
 * Controls:
 *   - `VOLATILITY_PROBE_REPEATS` (`k`, default 3) -- the number of replays.
 *   - `VOLATILITY_PROBE_SPACING_MS` -- inter-replay spacing so per-second
 *     clock-bucket fields surface across the repeats.
 *   - `VOLATILITY_PROBE_BUDGET_MS` -- a WALL-CLOCK budget for the whole probe;
 *     on exceed the probe ABORTS and records a PARTIAL result from the replays
 *     that completed.
 *
 * `volatility_source` outcomes:
 *   - `probed`         -- a full `k`-repeat measurement.
 *   - `probed_partial` -- budget-hit / incomplete probe with results from the
 *                         completed replays; trusted like a full probe (NOT
 *                         down-ranked); the envelope's `k` is the
 *                         completed-repeat count.
 *   - `non_json`       -- a non-JSON / unparseable response body at probe time;
 *                         comparison stays strict, but the state is
 *                         DISTINGUISHABLE from a never-probed `null`.
 *   - `not_probed`     -- a mutating / non-idempotent scenario; the probe is
 *                         NOT run (replay would change state). NO replay calls
 *                         are made; the diff falls back to endpoint_signal /
 *                         heuristic / declared.
 *
 * A `null` ENVELOPE (this probe returning `null`) means "no volatility
 * recorded" => strict comparison. The probe returns a non-null envelope in
 * EVERY case it actually runs (including the empty / deterministic case so the
 * write is intentional), and returns the `not_probed` envelope WITHOUT making
 * any HTTP call for mutating scenarios.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The request shape replayed by the probe. Mirrors the captured item. */
export interface ProbeRequestShape {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface VolatilityProbeDeps {
  /**
   * The per-session HTTP executor to replay through. REQUIRED -- the probe
   * never builds its own (it reuses the replay client's executor so auth /
   * base URL / timeouts are identical to the captured call).
   */
  executor: SessionHttpExecutor;
  /** Repeat count (`k`). Defaults to {@link VOLATILITY_PROBE_REPEATS}. */
  repeats?: number;
  /** Whole-probe wall-clock budget (ms). Defaults to {@link VOLATILITY_PROBE_BUDGET_MS}. */
  budgetMs?: number;
  /** Inter-replay spacing (ms). Defaults to {@link VOLATILITY_PROBE_SPACING_MS}. */
  spacingMs?: number;
  /** Wall-clock provider (test-injectable). Defaults to `Date.now`. */
  now?: () => number;
  /** Sleep provider (test-injectable). Defaults to a real `setTimeout` promise. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * True when the captured scenario is mutating / non-idempotent. When set,
   * the probe makes NO replay calls and returns the `not_probed` envelope.
   * Callers SHOULD pass `mutating_calls_confirmed === true` here; the probe
   * additionally guards on the HTTP method as belt-and-braces.
   */
  mutatingConfirmed?: boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the comparable JSON body from a raw replay response. Mirrors the
 * `{ headers, body }` wrapper the comparator unwraps -- here we hand the
 * comparator the RAW body so its symmetric unwrap is a no-op (both sides are
 * already the raw body).
 */
function bodyOf(response: { data?: unknown }): unknown {
  return response?.data;
}

/**
 * Whether a response body is "non-JSON" for envelope purposes. axios parses a
 * JSON content-type into an object / array; a string (or other primitive)
 * payload means the body was NOT JSON (plain text / HTML / unparseable).
 * `null` is a legitimate JSON body (`null`), not non-JSON.
 */
function isNonJsonBody(body: unknown): boolean {
  if (body === null || body === undefined) return false;
  return typeof body !== 'object';
}

/**
 * Collect every LEAF JSON-Pointer path in a value, plus the set of ARRAY
 * pointers. Used to seed and intersect the per-repeat path universe.
 */
function collectPaths(
  value: unknown,
  pointer: string,
  leaves: Set<string>,
  arrays: Set<string>,
): void {
  if (Array.isArray(value)) {
    arrays.add(pointer);
    value.forEach((el, i) => collectPaths(el, `${pointer}/${i}`, leaves, arrays));
    return;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const token = k.replace(/~/g, '~0').replace(/\//g, '~1');
      collectPaths(obj[k], `${pointer}/${token}`, leaves, arrays);
    }
    return;
  }
  // Primitive / null leaf.
  leaves.add(pointer);
}

/**
 * Run the volatility probe. Returns the envelope to persist on the source
 * baseline item's `volatile_paths_json`, or a `not_probed` envelope for a
 * mutating scenario. The caller is responsible for writing the envelope on
 * the baseline-item CREATE request (write-once).
 */
export async function runVolatilityProbe(
  request: ProbeRequestShape,
  deps: VolatilityProbeDeps,
): Promise<VolatilityEnvelope> {
  const repeats = typeof deps.repeats === 'number' ? deps.repeats : DEFAULT_REPEATS;
  const budgetMs = typeof deps.budgetMs === 'number' ? deps.budgetMs : DEFAULT_BUDGET_MS;
  const spacingMs = typeof deps.spacingMs === 'number' ? deps.spacingMs : DEFAULT_SPACING_MS;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;

  const method = (request.method ?? 'GET').toUpperCase();

  // ----------------------------------------------------------------------
  // Mutating-scenario guard. NO replay calls -- replay would change state.
  // ----------------------------------------------------------------------
  if (deps.mutatingConfirmed === true || MUTATING_METHODS.has(method)) {
    return { paths: [], volatility_source: 'not_probed', k: 0 };
  }

  const startedAt = now();
  const bodies: unknown[] = [];
  let nonJsonSeen = false;

  for (let attempt = 0; attempt < repeats; attempt += 1) {
    // Budget check BEFORE each replay (after the first) so we never start a
    // replay we cannot afford. The spacing wait also counts toward the
    // budget below.
    if (attempt > 0) {
      if (now() - startedAt >= budgetMs) break;
      // Inter-replay spacing so per-second clock-bucket fields surface.
      if (spacingMs > 0) await sleep(spacingMs);
      if (now() - startedAt >= budgetMs) break;
    }

    const response = await deps.executor.request({
      method: method as never,
      url: request.path,
      params: request.query,
      headers: request.headers,
      data: request.body,
    });
    const body = bodyOf(response);
    if (isNonJsonBody(body)) {
      nonJsonSeen = true;
      break;
    }
    bodies.push(body);
  }

  // ----------------------------------------------------------------------
  // Non-JSON body at probe time -> strict, but distinguishable from null.
  // ----------------------------------------------------------------------
  if (nonJsonSeen) {
    return { paths: [], volatility_source: 'non_json', k: bodies.length };
  }

  const completed = bodies.length;

  // A single completed replay cannot establish variance (nothing to diff
  // against). Treat as a (partial) probe with no measured paths -- still a
  // distinct, trusted state from `null`.
  if (completed <= 1) {
    const source: VolatilitySource = completed >= repeats ? 'probed' : 'probed_partial';
    return { paths: [], volatility_source: source, k: completed };
  }

  // ----------------------------------------------------------------------
  // Self-diff every pair (1st vs Nth) and union the differing leaf paths.
  // A leaf that differs in ANY pair is volatile. An ARRAY whose order
  // differs (multiset-equal but not positionally equal) is flagged
  // order-insensitive.
  // ----------------------------------------------------------------------
  const volatileLeaves = new Set<string>();
  const volatileArrays = new Set<string>();

  // Pre-collect the array pointer universe from the first body so an
  // order-only difference (which surfaces as per-element value diffs under a
  // shared array parent) can be promoted to an array flag.
  const baseLeaves = new Set<string>();
  const baseArrays = new Set<string>();
  collectPaths(bodies[0], '', baseLeaves, baseArrays);

  for (let i = 1; i < bodies.length; i += 1) {
    const cmp = compareJsonShapes(bodies[0], bodies[i]);
    for (const entry of cmp.bodyDiffJson) {
      // A NON-volatile pure reorder now surfaces (Spec 2026-06-17) as a SINGLE
      // `ordering` marker on the ARRAY path itself, instead of the per-element
      // `value_changed` cascade the probe historically promoted via
      // nearestArrayAncestor. Flag that array path directly as
      // order-insensitive so the persisted envelope's `array_paths` carries it
      // exactly as before the comparator change.
      if (entry.kind === 'ordering') {
        volatileArrays.add(entry.path);
        continue;
      }
      if (entry.kind === 'value_changed') {
        volatileLeaves.add(entry.path);
        // If the differing leaf sits under an array, flag the nearest array
        // ancestor as order-insensitive too (its element values shuffle).
        const arrAncestor = nearestArrayAncestor(entry.path, baseArrays);
        if (arrAncestor !== null) volatileArrays.add(arrAncestor);
      }
      // key_added / key_removed / type_changed are SHAPE diffs -- a shape
      // change across self-replays is itself a form of (structural)
      // volatility; record the path so it is tolerated for VALUE/ORDER, but
      // shape always re-breaks at diff time per the per-path rule. We record
      // the path leaf so the envelope captures the location.
      if (
        entry.kind === 'key_added' ||
        entry.kind === 'key_removed' ||
        entry.kind === 'type_changed'
      ) {
        volatileLeaves.add(entry.path);
        const arrAncestor = nearestArrayAncestor(entry.path, baseArrays);
        if (arrAncestor !== null) volatileArrays.add(arrAncestor);
      }
    }
  }

  const source: VolatilitySource = completed >= repeats ? 'probed' : 'probed_partial';
  const envelope: VolatilityEnvelope = {
    paths: Array.from(volatileLeaves).sort(),
    volatility_source: source,
    k: completed,
  };
  if (volatileArrays.size > 0) {
    envelope.array_paths = Array.from(volatileArrays).sort();
  }
  return envelope;
}

/**
 * Convert the typed envelope into the snake_case `volatile_paths_json` wire
 * OBJECT that the baseline-item CREATE request carries. This is the value a
 * caller passes as `CreateBaselineItemRequest.volatile_paths_json` at pin
 * time -- write-once, never PATCHed (baseline immutability). Returns the wire
 * object verbatim (the envelope is already snake_case-keyed); kept as a named
 * seam so the CREATE call site reads intentionally rather than spreading an
 * internal type.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 2 sub-task 2.6.
 */
export function volatilityEnvelopeToWire(
  envelope: VolatilityEnvelope,
): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    paths: envelope.paths,
    volatility_source: envelope.volatility_source,
    k: envelope.k,
  };
  if (envelope.array_paths && envelope.array_paths.length > 0) {
    wire.array_paths = envelope.array_paths;
  }
  return wire;
}

/**
 * The nearest ANCESTOR pointer of `pointer` that is a known array pointer, or
 * null when none. e.g. `/items/0/id` -> `/items` when `/items` is an array.
 */
function nearestArrayAncestor(pointer: string, arrays: Set<string>): string | null {
  let p = pointer;
  while (p.length > 0) {
    const idx = p.lastIndexOf('/');
    if (idx < 0) break;
    p = p.slice(0, idx);
    if (arrays.has(p)) return p;
  }
  return null;
}
