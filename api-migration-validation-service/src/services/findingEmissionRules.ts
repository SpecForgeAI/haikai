// ============================================================================
// NOTE: This file deliberately introduces the FIRST-EVER `critical` severity
// in the platform. No existing emission in discovery-service or anywhere
// else in architecture-model-service produces `critical` -- the ceiling
// today is `high`. The `status_drift` 2xx -> 5xx mapping below breaks
// that ceiling on purpose: a previously-200 endpoint now 500ing is the
// highest-stakes drift signal we can detect. Confirmed via accepted Q1.
// ============================================================================
//
// Pure deterministic classifier mapping an `ApiBehaviourDiffItemDto` to a
// `DiscoveryFinding` emission instruction. No side effects, no I/O, no
// async -- safe to unit test in isolation.
//
// The severity ladder (11 rows) and wording table (7 rows) are pinned
// verbatim from `agent-os/specs/2026-05-25-api-test-harness-findings-
// integration/spec.md` (and tasks.md). Implementer drift between
// interpretations is the failure mode the wording-pin specifically
// guards against (accepted Q8).
//
// Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 2.

import type { ApiBehaviourDiffItemDto } from './archModelClient';

/** Maximum size of the embedded body_diff_json blob before truncation. */
const MAX_BODY_DIFF_BYTES = 8 * 1024;

/** Sentinel category for all findings emitted by this rules file. */
export const API_BEHAVIOUR_DRIFT_CATEGORY = 'api_behaviour_drift' as const;

/**
 * The five per-dimension break TYPES (Spec 2026-06-17, R1 + R2 + R6). A single
 * diff_item still produces exactly ONE break (no cardinality change), but that
 * break carries the SET of dimensions that drifted so triage / the frontend
 * can render per-dimension badges. Status-CLASS (2xx vs 4xx vs 5xx) is a
 * SEVERITY sub-label of the single `status` type -- NOT a sixth type (R6).
 */
export type BreakType =
  | 'status'
  | 'headers'
  | 'body-shape'
  | 'body-value'
  | 'ordering';

export interface EmissionDetailJson {
  method: string;
  path: string;
  scenarioName: string;
  sourceStatus: number | null;
  targetStatus: number | null;
  statusClassification: string;
  bodyClassification: string | null;
  /**
   * Per-dimension header classification (`header_match` /
   * `header_value_drift` / `header_presence_drift`), or null when the header
   * dimension was skipped. Spec 2026-06-17.
   */
  headerClassification: string | null;
  notes: string | null;
  bodyDiffJson: Record<string, unknown> | null;
  /**
   * The SET of dimensions that drifted on this diff_item, derived by
   * {@link deriveBreakTypes}. The gateway copies this onto the break
   * `detail_json` so the frontend can render per-dimension badges. Empty for
   * a clean match and for source_only / target_only (which carry their own
   * finding type, not a dimension set). Spec 2026-06-17, R1 + R2.
   */
  breakTypes: BreakType[];
  /** Set when `bodyDiffJson` was truncated above {@link MAX_BODY_DIFF_BYTES}. */
  bodyDiffTruncated?: boolean;
}

export interface EmissionInstruction {
  shouldEmit: boolean;
  /** `''` when `shouldEmit=false` -- callers must check the flag first. */
  findingType: string;
  /** `''` when `shouldEmit=false`. */
  severity: string;
  /** `''` when `shouldEmit=false`. */
  title: string;
  /** `''` when `shouldEmit=false`. */
  summary: string;
  /** Populated even when `shouldEmit=false` -- diagnostic-only in that case. */
  detailJson: EmissionDetailJson;
  /**
   * The derived break_type SET (mirror of {@link EmissionDetailJson.breakTypes}
   * for callers reading the instruction directly). Spec 2026-06-17.
   */
  breakTypes: BreakType[];
  category: typeof API_BEHAVIOUR_DRIFT_CATEGORY;
}

function statusBucket(status: number | null): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (status == null) return 'other';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

/**
 * Classify status_drift severity per the refined ladder from accepted Q2.
 *
 *   2xx -> 5xx = `critical`  (FIRST-EVER critical in the platform)
 *   2xx -> 4xx = `high`
 *   2xx -> 2xx differing = `medium`
 *   other (e.g. 3xx changes) = `low`
 *
 * Avoids high-flooding dashboards with benign 200->201 noise.
 */
function classifyStatusDriftSeverity(
  sourceStatus: number | null,
  targetStatus: number | null,
): 'critical' | 'high' | 'medium' | 'low' {
  const src = statusBucket(sourceStatus);
  const tgt = statusBucket(targetStatus);
  if (src === '2xx' && tgt === '5xx') return 'critical';
  if (src === '2xx' && tgt === '4xx') return 'high';
  if (src === '2xx' && tgt === '2xx') return 'medium';
  return 'low';
}

/** Count shape-diff entries by kind for the body_shape_drift summary line. */
function summariseBodyShapeDiff(bodyDiffJson: Record<string, unknown> | null): {
  added: number;
  removed: number;
  typeChanges: number;
} {
  let added = 0;
  let removed = 0;
  let typeChanges = 0;
  const entries =
    bodyDiffJson && Array.isArray(bodyDiffJson.entries)
      ? (bodyDiffJson.entries as unknown[])
      : [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    // The producer (jsonShapeComparator.walk) tags every entry with `kind`:
    // key_added | key_removed | type_changed | value_changed. (value_changed is
    // a value drift, counted separately by countBodyValueDiffs.) This previously
    // read a non-existent `op` field, so every shape-drift summary reported 0/0/0.
    const kind = (raw as { kind?: unknown }).kind;
    if (kind === 'key_added') added += 1;
    else if (kind === 'key_removed') removed += 1;
    else if (kind === 'type_changed') typeChanges += 1;
  }
  return { added, removed, typeChanges };
}

/** Count value-diff entries for the body_value_drift summary line. */
function countBodyValueDiffs(bodyDiffJson: Record<string, unknown> | null): number {
  const entries =
    bodyDiffJson && Array.isArray(bodyDiffJson.entries)
      ? (bodyDiffJson.entries as unknown[])
      : [];
  return entries.length;
}

/**
 * Truncate the body_diff_json blob if its JSON serialisation exceeds
 * {@link MAX_BODY_DIFF_BYTES}. Truncation drops the `entries` array
 * entirely and adds a `truncated=true` marker -- the reviewer can fall
 * back to the diff_item's own bodyDiffJson on the Drift report tab if
 * they need the full delta.
 */
function maybeTruncateBodyDiff(
  bodyDiffJson: Record<string, unknown> | null,
): { value: Record<string, unknown> | null; truncated: boolean } {
  if (!bodyDiffJson) return { value: null, truncated: false };
  let json: string;
  try {
    json = JSON.stringify(bodyDiffJson);
  } catch {
    return { value: { truncated: true, reason: 'serialise_error' }, truncated: true };
  }
  if (json.length <= MAX_BODY_DIFF_BYTES) {
    return { value: bodyDiffJson, truncated: false };
  }
  return {
    value: { truncated: true, original_size_bytes: json.length },
    truncated: true,
  };
}

/**
 * Count + summarise the header divergences on a diff_item's `header_entries`
 * blob (written by diffRunner). Returns the affected header names (incl.
 * tolerated allowlisted ones) and whether any presence drift is present, for
 * the header finding summary line.
 */
function summariseHeaderDiff(bodyDiffJson: Record<string, unknown> | null): {
  names: string[];
  presenceDrift: boolean;
} {
  const names: string[] = [];
  let presenceDrift = false;
  const entries =
    bodyDiffJson && Array.isArray(bodyDiffJson.header_entries)
      ? (bodyDiffJson.header_entries as unknown[])
      : [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as { headerName?: unknown; kind?: unknown };
    if (typeof e.headerName === 'string') names.push(e.headerName);
    if (e.kind === 'presence') presenceDrift = true;
  }
  return { names, presenceDrift };
}

/**
 * Derive the SET of per-dimension break TYPES that drifted on a diff_item
 * (Spec 2026-06-17, R1 + R2 + R6). A single diff_item still yields ONE break;
 * this set tags WHICH dimensions diverged for per-dimension badges.
 *
 * Precedence is NOT encoded here -- this is the unordered SET. Status-CLASS is
 * NOT a separate type: a status drift contributes the single `status` type
 * regardless of 2xx/4xx/5xx (the severity captures the class, R6).
 *
 * source_only / target_only carry their own finding type and are NOT dimension
 * drifts in the five-type taxonomy, so they yield an EMPTY set.
 */
function deriveBreakTypes(item: ApiBehaviourDiffItemDto): BreakType[] {
  const types: BreakType[] = [];
  if (item.status_classification === 'status_drift') types.push('status');
  const header = item.header_classification ?? null;
  if (header === 'header_value_drift' || header === 'header_presence_drift') {
    types.push('headers');
  }
  switch (item.body_classification) {
    case 'body_shape_drift':
      types.push('body-shape');
      break;
    case 'body_value_drift':
      types.push('body-value');
      break;
    case 'body_ordering_drift':
      types.push('ordering');
      break;
    default:
      break;
  }
  return types;
}

function buildDetailJson(
  item: ApiBehaviourDiffItemDto,
  truncatedBodyDiff: { value: Record<string, unknown> | null; truncated: boolean },
  breakTypes: BreakType[],
): EmissionDetailJson {
  return {
    method: item.method,
    path: item.path,
    scenarioName: item.scenario_name,
    sourceStatus: item.source_response_status ?? null,
    targetStatus: item.target_response_status ?? null,
    statusClassification: item.status_classification,
    bodyClassification: item.body_classification ?? null,
    headerClassification: item.header_classification ?? null,
    breakTypes,
    notes: item.notes ?? null,
    bodyDiffJson: truncatedBodyDiff.value,
    ...(truncatedBodyDiff.truncated ? { bodyDiffTruncated: true } : {}),
  };
}

/** No-emit instruction (e.g. fully-matched scenarios). */
function noEmit(
  item: ApiBehaviourDiffItemDto,
  truncatedBodyDiff: { value: Record<string, unknown> | null; truncated: boolean },
  breakTypes: BreakType[],
): EmissionInstruction {
  return {
    shouldEmit: false,
    findingType: '',
    severity: '',
    title: '',
    summary: '',
    detailJson: buildDetailJson(item, truncatedBodyDiff, breakTypes),
    breakTypes,
    category: API_BEHAVIOUR_DRIFT_CATEGORY,
  };
}

/**
 * Main entry point. Returns an instruction describing whether to emit a
 * finding for the given diff_item AND, when `shouldEmit=true`, the
 * finding's typed fields with title + summary substituted per the
 * wording table.
 *
 * Severity ladder (verbatim from spec.md):
 *
 *   status_match + body_match                          -> (no emit)
 *   status_match + body_value_drift only                -> api_behaviour_value_drift / info
 *   status_match + body_shape_drift                     -> api_behaviour_shape_drift / medium
 *   status_drift (2xx -> 5xx)                           -> api_behaviour_status_drift / critical
 *   status_drift (2xx -> 4xx)                           -> api_behaviour_status_drift / high
 *   status_drift (2xx -> 2xx differing)                 -> api_behaviour_status_drift / medium
 *   status_drift (other, e.g. 3xx changes)              -> api_behaviour_status_drift / low
 *   source_only notes=mutating_skipped                   -> api_behaviour_unreplayed / info
 *   source_only notes=transport_failure                  -> api_behaviour_unreplayed / low
 *   source_only notes=no_paired_target                   -> api_behaviour_missing_target / high
 *   target_only                                          -> api_behaviour_extra_target / info
 *
 * Wording table (verbatim from spec.md) -- substitutes `{METHOD}`, `{path}`,
 * `{scenarioName}`, `{sourceStatus}`, `{targetStatus}`, plus shape/value
 * counts where the rule calls for them.
 */
export function classifyDiffItem(
  item: ApiBehaviourDiffItemDto,
): EmissionInstruction {
  const method = (item.method ?? 'GET').toUpperCase();
  const path = item.path ?? '/';
  const scenarioName = item.scenario_name ?? '';
  const sourceStatus = item.source_response_status ?? null;
  const targetStatus = item.target_response_status ?? null;
  const truncated = maybeTruncateBodyDiff(item.body_diff_json ?? null);
  // The derived per-dimension break_type SET (Spec 2026-06-17, R1 + R2). One
  // break per diff_item; this set tags WHICH dimensions drifted so the gateway
  // can copy it onto detail_json and the frontend can render per-dimension
  // badges. Threaded onto EVERY returned instruction + its detail_json.
  const breakTypes = deriveBreakTypes(item);
  const detailJson = buildDetailJson(item, truncated, breakTypes);

  // ---- target_only ----------------------------------------------------
  if (item.status_classification === 'target_only') {
    return {
      shouldEmit: true,
      findingType: 'api_behaviour_extra_target',
      severity: 'info',
      title: `Target-only: ${method} ${path}`,
      summary: `Target baseline contains scenario "${scenarioName}" but no source captured this scenario for comparison.`,
      detailJson,
      breakTypes,
      category: API_BEHAVIOUR_DRIFT_CATEGORY,
    };
  }

  // ---- source_only ----------------------------------------------------
  if (item.status_classification === 'source_only') {
    const notes = item.notes ?? '';
    if (notes === 'mutating_skipped') {
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_unreplayed',
        severity: 'info',
        title: `Source-only: ${method} ${path} (mutating call skipped on replay)`,
        summary: `Mutating source scenario "${scenarioName}" was skipped during target replay because mutating_calls_confirmed was false.`,
        detailJson,
        breakTypes,
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    if (notes === 'transport_failure') {
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_unreplayed',
        severity: 'low',
        title: `Source-only: ${method} ${path} (target replay transport failure)`,
        summary: `Target replay for scenario "${scenarioName}" hit a transport-level failure; no target response captured.`,
        detailJson,
        breakTypes,
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    // Default source_only branch -- covers `no_paired_target` and any
    // unexpected notes shape. Treat as missing target (the most
    // actionable interpretation when we don't have a more-specific hint).
    return {
      shouldEmit: true,
      findingType: 'api_behaviour_missing_target',
      severity: 'high',
      title: `Source-only: ${method} ${path} (no paired target capture)`,
      summary: `Source baseline contains scenario "${scenarioName}" but no matching target capture was produced.`,
      detailJson,
      breakTypes,
      category: API_BEHAVIOUR_DRIFT_CATEGORY,
    };
  }

  // ---- status_drift (dominant; status-CLASS is its severity, R6) -------
  // A status drift takes the primary finding type even when it co-occurs with
  // a header / body / ordering drift; `breakTypes` still carries the full set
  // so the gateway / frontend surface every drifted dimension.
  if (item.status_classification === 'status_drift') {
    const severity = classifyStatusDriftSeverity(sourceStatus, targetStatus);
    return {
      shouldEmit: true,
      findingType: 'api_behaviour_status_drift',
      severity,
      title: `Status drift: ${method} ${path} responded ${sourceStatus} -> ${targetStatus}`,
      summary: `Source baseline captured a ${sourceStatus} response; target baseline captured ${targetStatus} for scenario "${scenarioName}".`,
      detailJson,
      breakTypes,
      category: API_BEHAVIOUR_DRIFT_CATEGORY,
    };
  }

  // ---- status_match: branch on body / header / ordering classification -
  if (item.status_classification === 'status_match') {
    // Body SHAPE wins the primary finding type (strongest body signal).
    if (item.body_classification === 'body_shape_drift') {
      const counts = summariseBodyShapeDiff(item.body_diff_json ?? null);
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_shape_drift',
        severity: 'medium',
        title: `Body shape drift: ${method} ${path}`,
        summary: `Response body shape changed for scenario "${scenarioName}": ${counts.added} keys added, ${counts.removed} keys removed, ${counts.typeChanges} type changes.`,
        detailJson,
        breakTypes,
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    // Header drift (presence/value). A header divergence is a real
    // behavioural break -- emit a dedicated header finding. presence drift
    // (a header appeared/disappeared) is the more serious signal -> medium;
    // a value change -> info (allowlisted-value tolerance is handled by the
    // gateway auto-dispose pass, not suppressed here). Ranked AFTER body
    // shape so a shape+header diff reads primarily as the shape break, with
    // `headers` still in breakTypes.
    const header = item.header_classification ?? null;
    if (header === 'header_presence_drift' || header === 'header_value_drift') {
      const summary = summariseHeaderDiff(item.body_diff_json ?? null);
      const names = summary.names.length > 0 ? summary.names.join(', ') : '(none)';
      const severity = header === 'header_presence_drift' ? 'medium' : 'info';
      const kindLabel =
        header === 'header_presence_drift'
          ? 'a response header appeared or disappeared'
          : 'a response header value changed';
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_header_drift',
        severity,
        title: `Header drift: ${method} ${path}`,
        summary: `Response headers changed for scenario "${scenarioName}": ${kindLabel} (${names}).`,
        detailJson,
        breakTypes,
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    if (item.body_classification === 'body_value_drift') {
      const valueDiffCount = countBodyValueDiffs(item.body_diff_json ?? null);
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_value_drift',
        severity: 'info',
        title: `Body value drift: ${method} ${path}`,
        summary: `Response body shape unchanged but ${valueDiffCount} value(s) differ for scenario "${scenarioName}".`,
        detailJson,
        breakTypes,
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    // Array ORDERING drift (Spec 2026-06-17): a NON-volatile reorder, surfaced
    // as its own dimension rather than a value cascade. Weakest body signal.
    if (item.body_classification === 'body_ordering_drift') {
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_ordering_drift',
        severity: 'info',
        title: `Array ordering drift: ${method} ${path}`,
        summary: `Response body has the same elements in a different order for scenario "${scenarioName}".`,
        detailJson,
        breakTypes,
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    // status_match + body_match + header_match/skipped -- no emit.
    return noEmit(item, truncated, breakTypes);
  }

  // Fall-through -- unknown status_classification value. Don't emit;
  // returning shouldEmit=false keeps the runner's fail-soft loop quiet.
  return noEmit(item, truncated, breakTypes);
}
