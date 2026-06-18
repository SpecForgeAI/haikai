/**
 * jsonShapeComparator header-diff + ordering-drift unit tests, plus the
 * break_type-set derivation in findingEmissionRules.classifyDiffItem.
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types --
 * Task Group 2 sub-task 2.1.
 *
 * Focused inventory (load-bearing behaviours only):
 *   1. Content-Type value change (NOT allowlisted) -> header_value_drift, no
 *      tolerance tag (a real break).
 *   2. Date value change (allowlisted) -> header_value_drift tagged `declared`
 *      (tolerable; surfaced in volatilitySourcesTouched, NOT a hard break).
 *   3. Header presence/absence breaks even for an allowlisted name (ETag) ->
 *      header_presence_drift (presence is NEVER tolerated).
 *   4. A side lacking the { headers, body } wrapper -> header dimension
 *      SKIPPED (headerClassification null, no header entries) -- graceful
 *      degrade, no false break.
 *   5. Non-volatile array reorder -> body_ordering_drift (single marker, not a
 *      value cascade).
 *   6. classifyDiffItem break_type SET: single-dimension + multi-dimension.
 */

import { compareJsonShapes } from '../services/jsonShapeComparator';
import { classifyDiffItem } from '../services/findingEmissionRules';
import type { ApiBehaviourDiffItemDto } from '../services/archModelClient';

function diffItem(
  overrides: Partial<ApiBehaviourDiffItemDto> = {},
): ApiBehaviourDiffItemDto {
  return {
    id: 'item-1',
    diff_id: 'diff-1',
    method: 'GET',
    path: '/widgets',
    scenario_name: 'happy_path',
    source_baseline_item_id: 'src-1',
    target_baseline_item_id: 'tgt-1',
    status_classification: 'status_match',
    body_classification: 'body_match',
    header_classification: null,
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
    notes: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Content-Type (non-allowlisted) value change breaks
// ---------------------------------------------------------------------------
test('Content-Type value change is header_value_drift and is NOT tolerated', () => {
  const source = {
    headers: { 'content-type': 'application/json' },
    body: { ok: true },
  };
  const target = {
    headers: { 'content-type': 'text/plain' },
    body: { ok: true },
  };

  const result = compareJsonShapes(source, target);

  expect(result.bodyClassification).toBe('body_match');
  expect(result.headerClassification).toBe('header_value_drift');
  const entry = result.headerDiffJson.find((e) => e.headerName === 'content-type');
  expect(entry?.kind).toBe('value');
  // Content-Type is deliberately NOT on the allowlist -> no tolerance tag.
  expect(entry?.volatilitySource).toBeUndefined();
  expect(result.volatilitySourcesTouched).toEqual([]);
});

// ---------------------------------------------------------------------------
// 2. Allowlisted header value change is tolerated (tagged `declared`)
// ---------------------------------------------------------------------------
test('Date value change (allowlisted) is header_value_drift tagged declared (tolerable)', () => {
  const source = {
    headers: { Date: 'Mon, 16 Jun 2026 10:00:00 GMT', 'content-type': 'application/json' },
    body: { ok: true },
  };
  const target = {
    headers: { date: 'Tue, 17 Jun 2026 11:30:00 GMT', 'content-type': 'application/json' },
    body: { ok: true },
  };

  const result = compareJsonShapes(source, target);

  // Visible (create-then-auto-dispose), but tagged volatile so the gateway
  // pass disposes it -- it is NOT a hard, non-tolerable break.
  expect(result.headerClassification).toBe('header_value_drift');
  const entry = result.headerDiffJson.find(
    (e) => e.headerName.toLowerCase() === 'date',
  );
  expect(entry?.kind).toBe('value');
  expect(entry?.volatilitySource).toBe('declared');
  // No NON-tolerable header break entry exists (the only value entry is the
  // tolerated Date).
  const hardBreaks = result.headerDiffJson.filter(
    (e) => e.volatilitySource === undefined,
  );
  expect(hardBreaks).toHaveLength(0);
  expect(result.volatilitySourcesTouched).toEqual(['declared']);
});

// ---------------------------------------------------------------------------
// 3. Presence/absence ALWAYS breaks, even for an allowlisted name
// ---------------------------------------------------------------------------
test('header presence/absence breaks even for an allowlisted name (ETag)', () => {
  const source = {
    headers: { ETag: 'W/"abc"', 'content-type': 'application/json' },
    body: { ok: true },
  };
  // ETag (allowlisted for VALUE tolerance) disappears entirely -> presence
  // drift, which is NEVER tolerated.
  const target = {
    headers: { 'content-type': 'application/json' },
    body: { ok: true },
  };

  const result = compareJsonShapes(source, target);

  expect(result.headerClassification).toBe('header_presence_drift');
  const entry = result.headerDiffJson.find(
    (e) => e.headerName.toLowerCase() === 'etag',
  );
  expect(entry?.kind).toBe('presence');
  // Presence is never tolerated -- no volatility tag.
  expect(entry?.volatilitySource).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 4. Graceful degrade: a side lacking the wrapper skips the header dimension
// ---------------------------------------------------------------------------
test('missing { headers, body } wrapper on a side -> header dimension SKIPPED (no false break)', () => {
  // Source is a RAW body (old baseline, no wrapper); target is wrapped.
  const source = { ok: true };
  const target = {
    headers: { 'content-type': 'text/plain' },
    body: { ok: true },
  };

  const result = compareJsonShapes(source, target);

  // Body still compares fine (unwrap is symmetric); header dimension skipped.
  expect(result.bodyClassification).toBe('body_match');
  expect(result.headerClassification).toBeNull();
  expect(result.headerDiffJson).toEqual([]);
});

// ---------------------------------------------------------------------------
// 5. Non-volatile array reorder -> body_ordering_drift (single marker)
// ---------------------------------------------------------------------------
test('non-volatile array reorder -> body_ordering_drift (single marker, not a value cascade)', () => {
  const source = { items: ['a', 'b', 'c'] };
  const target = { items: ['c', 'a', 'b'] };

  const result = compareJsonShapes(source, target);

  expect(result.bodyClassification).toBe('body_ordering_drift');
  expect(result.bodyDiffJson).toHaveLength(1);
  expect(result.bodyDiffJson[0].kind).toBe('ordering');
  expect(result.bodyDiffJson[0].path).toBe('/items');
});

// ---------------------------------------------------------------------------
// 6. classifyDiffItem derives the break_type SET (single + multi-dimension)
// ---------------------------------------------------------------------------
test('classifyDiffItem break_type set: single-dimension and multi-dimension', () => {
  // Single dimension: header-only drift on a status_match/body_match item.
  const headerOnly = classifyDiffItem(
    diffItem({ header_classification: 'header_value_drift' }),
  );
  expect(headerOnly.shouldEmit).toBe(true);
  expect(headerOnly.findingType).toBe('api_behaviour_header_drift');
  expect(headerOnly.breakTypes).toEqual(['headers']);
  expect(headerOnly.detailJson.breakTypes).toEqual(['headers']);

  // Single dimension: ordering-only drift.
  const orderingOnly = classifyDiffItem(
    diffItem({ body_classification: 'body_ordering_drift' }),
  );
  expect(orderingOnly.breakTypes).toEqual(['ordering']);
  expect(orderingOnly.findingType).toBe('api_behaviour_ordering_drift');

  // Multi-dimension: status drift + header presence + body shape. Status-class
  // (200->404) is the SEVERITY of the single `status` type, NOT a 6th type.
  const multi = classifyDiffItem(
    diffItem({
      status_classification: 'status_drift',
      source_response_status: 200,
      target_response_status: 404,
      header_classification: 'header_presence_drift',
      body_classification: 'body_shape_drift',
    }),
  );
  // Dominant finding type is the status drift; severity reflects the class.
  expect(multi.findingType).toBe('api_behaviour_status_drift');
  expect(multi.severity).toBe('high'); // 2xx -> 4xx
  // The full set of drifted dimensions is carried (no `status-class` member).
  expect([...multi.breakTypes].sort()).toEqual(
    ['body-shape', 'headers', 'status'].sort(),
  );
});
