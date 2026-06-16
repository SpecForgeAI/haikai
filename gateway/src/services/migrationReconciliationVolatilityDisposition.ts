/**
 * `expected_volatile` volatility classification (gateway-only; Spec
 * 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling, Task Group 4).
 *
 * The PURE classifier the post-diff `expected_volatile` auto-disposition pass
 * runs over each created break. The api-migration-validation-service diff stays
 * VOLATILITY-AGNOSTIC at break-creation time -- it only ANNOTATES tolerated
 * value/order diff entries with a `volatilitySource` tag and surfaces the
 * DISTINCT set on `body_diff_json.volatility_sources`. ALL the dispose-vs-open
 * policy lives HERE (and in the driver), never in the diff runner.
 *
 * Contract from the validation-service diff engine (the persisted diff_item's
 * `body_diff_json`, copied verbatim onto the break's `detail_json.body_diff_json`):
 *
 *   {
 *     entries: BodyDiffEntry[],            // every diff entry (value + shape)
 *     volatility_sources?: VolatilitySource[]  // DISTINCT tags that touched a
 *                                              // TOLERATED value/order entry
 *   }
 *
 *   - When a body diverges ONLY on tolerated paths, the diff engine sets
 *     `body_classification` to `body_match` while keeping `body_diff_json`
 *     non-null WITH `volatility_sources`. Such a break is a pure-volatile break.
 *   - A surviving NON-volatile entry keeps `body_classification` as
 *     `body_value_drift` / `body_shape_drift` -> a real break -> the
 *     `volatility_sources` may still be present (a volatile timestamp alongside a
 *     genuine regression). This is the MIXED case -> stays `open`.
 *   - `non_json` / `not_probed` / `null` envelopes produce NO volatility metadata
 *     -> `volatility_sources` absent -> strict, never auto-disposed.
 *
 * Trust taxonomy (mirrors the AMS / validation-service `volatility_source`):
 *   - AUTO-TERMINAL sources: `probed`, `probed_partial`, `endpoint_signal`,
 *     `declared`. A break justified ENTIRELY by these is auto-dispositioned to
 *     the terminal `expected_volatile`.
 *   - DOWN-RANK-ONLY source: `heuristic`. A guess must never silently absorb a
 *     real break, so a heuristic-only justification only down-ranks the break to
 *     `info` (stays open + visible), never auto-terminates.
 *   - STRICT sources (`non_json` / `not_probed`) never reach the diff-entry tag
 *     set (the comparator does not tolerate them), so they never appear here.
 */

/** The trust tags the validation-service stamps on a tolerated diff entry. */
export type VolatilitySource =
  | 'probed'
  | 'probed_partial'
  | 'endpoint_signal'
  | 'heuristic'
  | 'declared'
  | 'non_json'
  | 'not_probed';

/** The `volatility_source` tags that are sufficient to AUTO-TERMINATE a break. */
export const AUTO_TERMINAL_VOLATILITY_SOURCES: ReadonlySet<string> = new Set<string>([
  'probed',
  'probed_partial',
  'endpoint_signal',
  'declared',
]);

/**
 * Whether a break's body_classification (copied onto its detail snapshot)
 * represents a SURVIVING real body break -- a non-volatile entry the comparator
 * did NOT tolerate. When the body diverged ONLY on tolerated paths the diff
 * engine downgrades the classification to `body_match`, so any other body
 * classification means a real (non-volatile) entry survived.
 */
function bodyHasSurvivingDrift(bodyClassification: string | null | undefined): boolean {
  const bc = (bodyClassification ?? '').trim();
  return bc === 'body_value_drift' || bc === 'body_shape_drift';
}

/** The outcome of classifying one break's volatility metadata. */
export type VolatilityClassification =
  /**
   * Divergence ENTIRELY on auto-terminal volatile paths (no surviving
   * non-volatile drift). The break is auto-dispositioned to the terminal
   * `expected_volatile` with `needs_human=false`.
   */
  | { outcome: 'expected_volatile'; sources: VolatilitySource[]; paths: string[] }
  /**
   * The break is justified ONLY by `heuristic` paths -> DOWN-RANK to `info`,
   * stays open (a guess never auto-terminates).
   */
  | { outcome: 'info'; sources: VolatilitySource[]; paths: string[] }
  /**
   * Volatility tags are present but a NON-volatile entry survived (the
   * comparator left `body_value_drift` / `body_shape_drift`). The non-volatile
   * part is a real break -> stays `open`. The volatile paths are still recorded
   * for the audit note so the human sees the partial allowance.
   */
  | { outcome: 'mixed'; sources: VolatilitySource[]; paths: string[] }
  /**
   * No volatility metadata (`non_json` / `not_probed` / `null` envelope, or no
   * tolerated entry at all) -> strict comparison, NO auto-disposition. The break
   * is left EXACTLY as today.
   */
  | { outcome: 'none' };

/**
 * Read the volatility metadata off a break's persisted detail snapshot. The
 * driver copies the diff_item's `body_diff_json` (`{ entries, volatility_sources }`)
 * + `body_classification` onto `detail_json` at break-creation
 * (`diffItemToBreak`), so this reads from the same snapshot without a re-walk.
 *
 * Tolerates both the nested `detail_json.body_diff_json` shape and a flat
 * `volatility_sources` on the detail (belt-and-braces for forward-compat /
 * direct break rows), plus snake / camel `body_classification`.
 */
export function readBreakVolatility(detail: Record<string, unknown> | null | undefined): {
  sources: VolatilitySource[];
  paths: string[];
  bodyClassification: string | null;
} {
  const d = (detail ?? {}) as Record<string, unknown>;
  const bodyDiff = (d.body_diff_json ?? d.bodyDiffJson ?? null) as
    | Record<string, unknown>
    | null;

  // volatility_sources: prefer the nested body_diff_json, fall back to a flat
  // field on the detail.
  const rawSources =
    (bodyDiff?.volatility_sources as unknown) ??
    (bodyDiff?.volatilitySources as unknown) ??
    (d.volatility_sources as unknown) ??
    (d.volatilitySources as unknown) ??
    null;
  const sources: VolatilitySource[] = Array.isArray(rawSources)
    ? (rawSources.filter((s) => typeof s === 'string') as VolatilitySource[])
    : [];

  // The tolerated paths -- collected off any entry carrying a volatilitySource
  // tag (the comparator only tags VALUE/ORDER tolerated entries). Used purely
  // for the human-facing audit note.
  const paths: string[] = [];
  const entries = (bodyDiff?.entries as unknown) ?? null;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const entry = e as Record<string, unknown>;
      const tag = entry.volatilitySource ?? entry.volatility_source ?? null;
      const path = entry.path;
      if (typeof tag === 'string' && typeof path === 'string') {
        paths.push(path);
      }
    }
  }

  const bodyClassification =
    (d.body_classification as string | null | undefined) ??
    (d.bodyClassification as string | null | undefined) ??
    null;

  return { sources, paths, bodyClassification };
}

/**
 * Classify a break from its volatility metadata. The policy:
 *
 *   - NO sources                          -> `none`   (strict; no auto-disposition)
 *   - sources present, surviving drift    -> `mixed`  (stays open; real break)
 *   - sources ⊆ auto-terminal, no drift   -> `expected_volatile` (terminal)
 *   - any heuristic in the mix, no drift  -> `info`   (down-rank; guess never terminal)
 *
 * The MIXED check (a surviving non-volatile entry) is the no-override guard (G3):
 * a deliberately-changed NON-volatile value still produces an `open` break even
 * when the same response also carries volatile paths.
 */
export function classifyBreakVolatility(
  detail: Record<string, unknown> | null | undefined,
): VolatilityClassification {
  const { sources, paths, bodyClassification } = readBreakVolatility(detail);

  // No volatility metadata at all -> strict; leave the break exactly as today.
  if (sources.length === 0) {
    return { outcome: 'none' };
  }

  // A surviving NON-volatile entry (the comparator left a real drift) -> the
  // non-volatile part is a genuine break. Stays open (the no-override guard).
  if (bodyHasSurvivingDrift(bodyClassification)) {
    return { outcome: 'mixed', sources, paths };
  }

  // Every justifying source must be auto-terminal for the break to be
  // auto-dispositioned. The presence of ANY heuristic source (the only
  // down-rank-only tag the comparator emits) demotes the whole break to `info`
  // -- a guess can never carry the break terminal on its own.
  const everyAutoTerminal = sources.every((s) => AUTO_TERMINAL_VOLATILITY_SOURCES.has(s));
  if (everyAutoTerminal) {
    return { outcome: 'expected_volatile', sources, paths };
  }

  // Mixed-trust or heuristic-only -> down-rank to info, stays open.
  return { outcome: 'info', sources, paths };
}
