/**
 * `expected_volatile` volatility classification (gateway-only; Spec
 * 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling, Task Group 4;
 * extended by Spec 2026-06-17 Reconcile Full-Response Fidelity, Task Group 3 for
 * the HEADER dimension).
 *
 * The PURE classifier the post-diff `expected_volatile` auto-disposition pass
 * runs over each created break. The api-migration-validation-service diff stays
 * VOLATILITY-AGNOSTIC at break-creation time -- it only ANNOTATES tolerated
 * value/order/header diff entries with a `volatilitySource` tag and surfaces the
 * DISTINCT set on `body_diff_json.volatility_sources`. ALL the dispose-vs-open
 * policy lives HERE (and in the driver), never in the diff runner.
 *
 * Contract from the validation-service diff engine (the persisted diff_item's
 * `body_diff_json`, copied verbatim onto the break's `detail_json.body_diff_json`):
 *
 *   {
 *     entries: BodyDiffEntry[],            // every body diff entry (value + shape)
 *     header_entries?: HeaderDiffEntry[],  // every header divergence (Spec 2026-06-17)
 *     volatility_sources?: VolatilitySource[]  // DISTINCT tags that touched a
 *                                              // TOLERATED value/order/header entry
 *   }
 *
 *   - When a body diverges ONLY on tolerated paths, the diff engine sets
 *     `body_classification` to `body_match` while keeping `body_diff_json`
 *     non-null WITH `volatility_sources`. Such a break is a pure-volatile break.
 *   - A surviving NON-volatile entry keeps `body_classification` as
 *     `body_value_drift` / `body_shape_drift` / `body_ordering_drift` -> a real
 *     break -> the `volatility_sources` may still be present (a volatile timestamp
 *     alongside a genuine regression). This is the MIXED case -> stays `open`.
 *   - HEADERS (Spec 2026-06-17): a `header_value_drift` whose every changed header
 *     name is allowlisted-volatile is tagged `declared` (auto-terminal) on each
 *     `header_entries` entry -- tolerated. A NON-allowlisted header value change
 *     (no tag) or a `header_presence_drift` (header appeared / disappeared) is a
 *     SURVIVING header drift -> a real break -> MIXED-stays-open. Header presence
 *     is NEVER tolerated.
 *   - `non_json` / `not_probed` / `null` envelopes produce NO volatility metadata
 *     -> `volatility_sources` absent -> strict, never auto-disposed.
 *
 * Trust taxonomy (mirrors the AMS / validation-service `volatility_source`):
 *   - AUTO-TERMINAL sources: `probed`, `probed_partial`, `endpoint_signal`,
 *     `declared`. A break justified ENTIRELY by these is auto-dispositioned to
 *     the terminal `expected_volatile`. Allowlisted header VALUE changes are
 *     tagged `declared` and so are auto-terminal.
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
 *
 * Spec 2026-06-17: `body_ordering_drift` (a non-volatile array reorder) is also
 * a surviving body break -- a volatile-flagged array stays order-insensitive in
 * the comparator (so it never reaches `body_ordering_drift`); an item that DID
 * reach `body_ordering_drift` is a real ordering divergence.
 */
function bodyHasSurvivingDrift(bodyClassification: string | null | undefined): boolean {
  const bc = (bodyClassification ?? '').trim();
  return (
    bc === 'body_value_drift' ||
    bc === 'body_shape_drift' ||
    bc === 'body_ordering_drift'
  );
}

/**
 * Whether a break's HEADER dimension represents a SURVIVING (un-tolerated) header
 * break (Spec 2026-06-17). The gateway RELIES on the validation-service
 * comparator's classification + per-entry tagging rather than re-deriving from
 * the allowlist:
 *
 *   - `header_presence_drift` -- a header appeared / disappeared. NEVER tolerated
 *     (tolerance applies to allowlisted VALUE changes only, never presence) -> a
 *     surviving header break.
 *   - `header_value_drift` -- a header VALUE changed. The comparator tags each
 *     allowlisted-volatile value entry `volatilitySource='declared'` on
 *     `header_entries`; a NON-allowlisted value change carries NO tag. So the
 *     header dimension survives iff ANY value entry lacks a `volatilitySource`
 *     (a non-allowlisted change). When `header_entries` is absent (a flat /
 *     forward-compat break row) we conservatively treat a `header_value_drift`
 *     as surviving unless the distinct `volatility_sources` set vouches for it
 *     (handled by the caller via the auto-terminal source check).
 *   - `header_match` / null (dimension skipped) -> no header break.
 */
function headerHasSurvivingDrift(
  headerClassification: string | null | undefined,
  headerEntries: ReadonlyArray<Record<string, unknown>>,
): boolean {
  const hc = (headerClassification ?? '').trim();
  if (hc === '' || hc === 'header_match') return false;

  // Presence drift is NEVER tolerated -- always a surviving break.
  if (hc === 'header_presence_drift') return true;

  // header_value_drift: survives iff any header entry is an un-tolerated change
  // (a presence entry, or a value entry with NO volatilitySource tag -> a
  // non-allowlisted header). The comparator tags allowlisted value changes
  // `declared`; anything untagged is a real break.
  if (headerEntries.length > 0) {
    return headerEntries.some((e) => {
      const kind = e.kind;
      const tag = e.volatilitySource ?? e.volatility_source ?? null;
      if (kind === 'presence') return true;
      if (kind === 'value') return tag == null;
      return false;
    });
  }

  // No per-entry detail available for a header_value_drift: be conservative --
  // treat it as surviving so a break is never silently auto-disposed without
  // evidence the changed header(s) were allowlisted. (In practice TG2 always
  // emits header_entries for a header_value_drift.)
  return true;
}

/** The outcome of classifying one break's volatility metadata. */
export type VolatilityClassification =
  /**
   * Divergence ENTIRELY on auto-terminal volatile paths / allowlisted header
   * values (no surviving non-volatile body OR header drift). The break is
   * auto-dispositioned to the terminal `expected_volatile` with
   * `needs_human=false`.
   */
  | { outcome: 'expected_volatile'; sources: VolatilitySource[]; paths: string[] }
  /**
   * The break is justified ONLY by `heuristic` paths -> DOWN-RANK to `info`,
   * stays open (a guess never auto-terminates).
   */
  | { outcome: 'info'; sources: VolatilitySource[]; paths: string[] }
  /**
   * Volatility tags are present but a NON-volatile entry survived (the
   * comparator left `body_value_drift` / `body_shape_drift` /
   * `body_ordering_drift`, OR a header presence/absence or non-allowlisted header
   * value change). The non-volatile part is a real break -> stays `open`. The
   * volatile paths are still recorded for the audit note so the human sees the
   * partial allowance.
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
 * driver copies the diff_item's `body_diff_json` (`{ entries, header_entries?,
 * volatility_sources }`) + `body_classification` + `header_classification` onto
 * `detail_json` at break-creation ({@link diffItemToBreak}), so this reads from
 * the same snapshot without a re-walk.
 *
 * Tolerates both the nested `detail_json.body_diff_json` shape and a flat
 * `volatility_sources` on the detail (belt-and-braces for forward-compat /
 * direct break rows), plus snake / camel `body_classification` /
 * `header_classification`.
 */
export function readBreakVolatility(detail: Record<string, unknown> | null | undefined): {
  sources: VolatilitySource[];
  paths: string[];
  bodyClassification: string | null;
  headerClassification: string | null;
  headerEntries: Array<Record<string, unknown>>;
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
  // tag (the comparator only tags VALUE/ORDER/HEADER tolerated entries). Used
  // purely for the human-facing audit note.
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

  // Header diff entries (Spec 2026-06-17). Carried on `body_diff_json.header_entries`
  // by TG2. A tolerated (allowlisted) header VALUE change is tagged `declared`;
  // collect its header pointer/name into the audit path set the same way body
  // paths are collected, so the human sees WHICH header names were tolerated.
  const headerEntries: Array<Record<string, unknown>> = [];
  const rawHeaderEntries =
    (bodyDiff?.header_entries as unknown) ?? (bodyDiff?.headerEntries as unknown) ?? null;
  if (Array.isArray(rawHeaderEntries)) {
    for (const e of rawHeaderEntries) {
      if (!e || typeof e !== 'object') continue;
      const entry = e as Record<string, unknown>;
      headerEntries.push(entry);
      const tag = entry.volatilitySource ?? entry.volatility_source ?? null;
      const name =
        (typeof entry.headerName === 'string' && entry.headerName) ||
        (typeof entry.header_name === 'string' && entry.header_name) ||
        (typeof entry.path === 'string' && entry.path) ||
        null;
      if (typeof tag === 'string' && typeof name === 'string') {
        paths.push(`header:${name}`);
      }
    }
  }

  const bodyClassification =
    (d.body_classification as string | null | undefined) ??
    (d.bodyClassification as string | null | undefined) ??
    null;

  const headerClassification =
    (d.header_classification as string | null | undefined) ??
    (d.headerClassification as string | null | undefined) ??
    null;

  return { sources, paths, bodyClassification, headerClassification, headerEntries };
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
 *
 * Spec 2026-06-17 (R-volatile, load-bearing): the MIXED check now ALSO considers
 * the HEADER dimension. A break auto-disposes to `expected_volatile` ONLY when
 * ALL drifted dimensions are volatile-tolerated -- i.e. NO surviving body drift
 * AND NO surviving header drift. ANY non-volatile body drift, OR a header
 * presence/absence (`header_presence_drift`), OR a non-allowlisted header value
 * change -> the break STAYS OPEN (`mixed`).
 */
export function classifyBreakVolatility(
  detail: Record<string, unknown> | null | undefined,
): VolatilityClassification {
  const { sources, paths, bodyClassification, headerClassification, headerEntries } =
    readBreakVolatility(detail);

  // No volatility metadata at all -> strict; leave the break EXACTLY as today
  // (the G1/strict invariant: a metadata-less break is never touched by this
  // pass, so it stays OPEN, untouched -- no audit note written). A header
  // presence/absence or a non-allowlisted header value change with no volatile
  // source falls here too: the break stays OPEN (untouched), which is the
  // required MIXED-stays-open outcome -- there is simply no tolerated allowance
  // to record alongside it.
  if (sources.length === 0) {
    return { outcome: 'none' };
  }

  // A surviving NON-volatile entry (the comparator left a real body OR header
  // drift) WHILE some other dimension was tolerated -> the non-volatile part is
  // a genuine break. Stays open (the no-override guard, extended to headers per
  // R-volatile). This is the MIXED case: e.g. an allowlisted Date header value
  // (declared) alongside a real /total body change, or alongside a header
  // presence/absence or non-allowlisted header value change.
  const survivingBody = bodyHasSurvivingDrift(bodyClassification);
  const survivingHeader = headerHasSurvivingDrift(headerClassification, headerEntries);
  if (survivingBody || survivingHeader) {
    return { outcome: 'mixed', sources, paths };
  }

  // Every justifying source must be auto-terminal for the break to be
  // auto-dispositioned. The presence of ANY heuristic source (the only
  // down-rank-only tag the comparator emits) demotes the whole break to `info`
  // -- a guess can never carry the break terminal on its own. Allowlisted header
  // VALUE changes are tagged `declared` (auto-terminal), so a pure
  // allowlisted-header-value drift lands here as expected_volatile.
  const everyAutoTerminal = sources.every((s) => AUTO_TERMINAL_VOLATILITY_SOURCES.has(s));
  if (everyAutoTerminal) {
    return { outcome: 'expected_volatile', sources, paths };
  }

  // Mixed-trust or heuristic-only -> down-rank to info, stays open.
  return { outcome: 'info', sources, paths };
}
