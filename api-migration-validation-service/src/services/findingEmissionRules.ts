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

export interface EmissionDetailJson {
  method: string;
  path: string;
  scenarioName: string;
  sourceStatus: number | null;
  targetStatus: number | null;
  statusClassification: string;
  bodyClassification: string | null;
  notes: string | null;
  bodyDiffJson: Record<string, unknown> | null;
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

function buildDetailJson(
  item: ApiBehaviourDiffItemDto,
  truncatedBodyDiff: { value: Record<string, unknown> | null; truncated: boolean },
): EmissionDetailJson {
  return {
    method: item.method,
    path: item.path,
    scenarioName: item.scenario_name,
    sourceStatus: item.source_response_status ?? null,
    targetStatus: item.target_response_status ?? null,
    statusClassification: item.status_classification,
    bodyClassification: item.body_classification ?? null,
    notes: item.notes ?? null,
    bodyDiffJson: truncatedBodyDiff.value,
    ...(truncatedBodyDiff.truncated ? { bodyDiffTruncated: true } : {}),
  };
}

/** No-emit instruction (e.g. fully-matched scenarios). */
function noEmit(
  item: ApiBehaviourDiffItemDto,
  truncatedBodyDiff: { value: Record<string, unknown> | null; truncated: boolean },
): EmissionInstruction {
  return {
    shouldEmit: false,
    findingType: '',
    severity: '',
    title: '',
    summary: '',
    detailJson: buildDetailJson(item, truncatedBodyDiff),
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
  const detailJson = buildDetailJson(item, truncated);

  // ---- target_only ----------------------------------------------------
  if (item.status_classification === 'target_only') {
    return {
      shouldEmit: true,
      findingType: 'api_behaviour_extra_target',
      severity: 'info',
      title: `Target-only: ${method} ${path}`,
      summary: `Target baseline contains scenario "${scenarioName}" but no source captured this scenario for comparison.`,
      detailJson,
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
      category: API_BEHAVIOUR_DRIFT_CATEGORY,
    };
  }

  // ---- status_drift ---------------------------------------------------
  if (item.status_classification === 'status_drift') {
    const severity = classifyStatusDriftSeverity(sourceStatus, targetStatus);
    return {
      shouldEmit: true,
      findingType: 'api_behaviour_status_drift',
      severity,
      title: `Status drift: ${method} ${path} responded ${sourceStatus} -> ${targetStatus}`,
      summary: `Source baseline captured a ${sourceStatus} response; target baseline captured ${targetStatus} for scenario "${scenarioName}".`,
      detailJson,
      category: API_BEHAVIOUR_DRIFT_CATEGORY,
    };
  }

  // ---- status_match: branch on body classification --------------------
  if (item.status_classification === 'status_match') {
    if (item.body_classification === 'body_shape_drift') {
      const counts = summariseBodyShapeDiff(item.body_diff_json ?? null);
      return {
        shouldEmit: true,
        findingType: 'api_behaviour_shape_drift',
        severity: 'medium',
        title: `Body shape drift: ${method} ${path}`,
        summary: `Response body shape changed for scenario "${scenarioName}": ${counts.added} keys added, ${counts.removed} keys removed, ${counts.typeChanges} type changes.`,
        detailJson,
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
        category: API_BEHAVIOUR_DRIFT_CATEGORY,
      };
    }
    // status_match + body_match (or null body classification) -- no emit.
    return noEmit(item, truncated);
  }

  // Fall-through -- unknown status_classification value. Don't emit;
  // returning shouldEmit=false keeps the runner's fail-soft loop quiet.
  return noEmit(item, truncated);
}
