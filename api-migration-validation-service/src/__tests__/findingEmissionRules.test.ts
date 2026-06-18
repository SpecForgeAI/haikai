/**
 * findingEmissionRules unit tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 2
 * sub-task 2.1.
 *
 * Representative subset of the 11-row severity ladder + 7-row wording
 * table verbatim from spec.md. Asserts:
 *   1. status_match + body_match -> no emit
 *   2. status_drift 2xx -> 5xx -> critical (FIRST-EVER critical platform-wide)
 *   3. body_shape_drift -> medium with N/M/K counts in the summary
 *   4. source_only notes=mutating_skipped -> info / api_behaviour_unreplayed
 *   5. target_only -> info / api_behaviour_extra_target
 *   6. body_value_drift (status_match) -> info with value-count
 *   7. status_drift 2xx -> 4xx -> high (severity-ladder split coverage)
 */

import {
  classifyDiffItem,
  API_BEHAVIOUR_DRIFT_CATEGORY,
} from '../services/findingEmissionRules';
import type { ApiBehaviourDiffItemDto } from '../services/archModelClient';

function buildItem(overrides: Partial<ApiBehaviourDiffItemDto> = {}): ApiBehaviourDiffItemDto {
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
// Test 1: status_match + body_match -> no emit
// ---------------------------------------------------------------------------
test('status_match + body_match -> shouldEmit=false (no finding)', () => {
  const item = buildItem({
    status_classification: 'status_match',
    body_classification: 'body_match',
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(false);
  // findingType / severity / title / summary are all empty when no-emit.
  expect(result.findingType).toBe('');
  expect(result.severity).toBe('');
  expect(result.title).toBe('');
  expect(result.summary).toBe('');
  // detailJson is still populated for diagnostic-only use.
  expect(result.detailJson.method).toBe('GET');
  expect(result.detailJson.path).toBe('/widgets');
  expect(result.category).toBe(API_BEHAVIOUR_DRIFT_CATEGORY);
});

// ---------------------------------------------------------------------------
// Test 2: status_drift 2xx -> 5xx -> critical (FIRST-EVER critical)
// ---------------------------------------------------------------------------
test('status_drift 2xx -> 5xx -> emits critical api_behaviour_status_drift', () => {
  const item = buildItem({
    method: 'GET',
    path: '/payments/42',
    scenario_name: 'fetch_payment',
    status_classification: 'status_drift',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 500,
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(true);
  expect(result.severity).toBe('critical');
  expect(result.findingType).toBe('api_behaviour_status_drift');
  expect(result.category).toBe('api_behaviour_drift');
  // Title + summary substituted verbatim per the wording table.
  expect(result.title).toBe(
    'Status drift: GET /payments/42 responded 200 -> 500',
  );
  expect(result.summary).toBe(
    'Source baseline captured a 200 response; target baseline captured 500 for scenario "fetch_payment".',
  );
});

// ---------------------------------------------------------------------------
// Test 3: status_match + body_shape_drift -> medium with shape counts
// ---------------------------------------------------------------------------
test('body_shape_drift -> emits medium api_behaviour_shape_drift with N/M/K counts', () => {
  const item = buildItem({
    method: 'POST',
    path: '/orders',
    scenario_name: 'create_order',
    status_classification: 'status_match',
    body_classification: 'body_shape_drift',
    // Faithful to the producer shape (jsonShapeComparator.walk): each entry is
    // tagged with `kind` (key_added | key_removed | type_changed | value_changed)
    // and value fields -- NOT a hand-invented `op` field. A prior fixture used
    // `op`, which masked a bug where summariseBodyShapeDiff read `.op` and so
    // always reported 0/0/0 in production.
    body_diff_json: {
      entries: [
        { path: '/discount_code', kind: 'key_added', targetValue: 'SAVE10' },
        { path: '/loyalty_points', kind: 'key_added', targetValue: 120 },
        { path: '/promo', kind: 'key_removed', sourceValue: 'OLD' },
        { path: '/total', kind: 'type_changed', sourceValue: 42, targetValue: '42' },
      ],
    },
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(true);
  expect(result.severity).toBe('medium');
  expect(result.findingType).toBe('api_behaviour_shape_drift');
  expect(result.title).toBe('Body shape drift: POST /orders');
  expect(result.summary).toBe(
    'Response body shape changed for scenario "create_order": 2 keys added, 1 keys removed, 1 type changes.',
  );
});

// ---------------------------------------------------------------------------
// Test 4: source_only notes=mutating_skipped -> info / unreplayed
// ---------------------------------------------------------------------------
test('source_only mutating_skipped -> emits info api_behaviour_unreplayed', () => {
  const item = buildItem({
    method: 'POST',
    path: '/widgets',
    scenario_name: 'create_widget',
    status_classification: 'source_only',
    body_classification: null,
    notes: 'mutating_skipped',
    source_response_status: 201,
    target_response_status: null,
    target_baseline_item_id: null,
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(true);
  expect(result.severity).toBe('info');
  expect(result.findingType).toBe('api_behaviour_unreplayed');
  expect(result.title).toBe(
    'Source-only: POST /widgets (mutating call skipped on replay)',
  );
  expect(result.summary).toBe(
    'Mutating source scenario "create_widget" was skipped during target replay because mutating_calls_confirmed was false.',
  );
});

// ---------------------------------------------------------------------------
// Test 5: target_only -> info / api_behaviour_extra_target
// ---------------------------------------------------------------------------
test('target_only -> emits info api_behaviour_extra_target', () => {
  const item = buildItem({
    method: 'GET',
    path: '/new-endpoint',
    scenario_name: 'list_new',
    status_classification: 'target_only',
    body_classification: null,
    source_response_status: null,
    target_response_status: 200,
    source_baseline_item_id: null,
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(true);
  expect(result.severity).toBe('info');
  expect(result.findingType).toBe('api_behaviour_extra_target');
  expect(result.title).toBe('Target-only: GET /new-endpoint');
  expect(result.summary).toBe(
    'Target baseline contains scenario "list_new" but no source captured this scenario for comparison.',
  );
});

// ---------------------------------------------------------------------------
// Test 6: body_value_drift (status_match) -> info with value-count
// ---------------------------------------------------------------------------
test('body_value_drift on status_match -> emits info api_behaviour_value_drift', () => {
  const item = buildItem({
    method: 'GET',
    path: '/users/7',
    scenario_name: 'fetch_user',
    status_classification: 'status_match',
    body_classification: 'body_value_drift',
    body_diff_json: {
      entries: [
        { op: 'value_changed', path: '/email' },
        { op: 'value_changed', path: '/last_login' },
      ],
    },
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(true);
  expect(result.severity).toBe('info');
  expect(result.findingType).toBe('api_behaviour_value_drift');
  expect(result.title).toBe('Body value drift: GET /users/7');
  expect(result.summary).toBe(
    'Response body shape unchanged but 2 value(s) differ for scenario "fetch_user".',
  );
});

// ---------------------------------------------------------------------------
// Test 7: status_drift 2xx -> 4xx -> high (severity-ladder split)
// ---------------------------------------------------------------------------
test('status_drift 2xx -> 4xx -> emits high api_behaviour_status_drift', () => {
  const item = buildItem({
    method: 'GET',
    path: '/restricted',
    scenario_name: 'fetch_restricted',
    status_classification: 'status_drift',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 403,
  });
  const result = classifyDiffItem(item);
  expect(result.shouldEmit).toBe(true);
  expect(result.severity).toBe('high');
  expect(result.findingType).toBe('api_behaviour_status_drift');
  expect(result.title).toBe(
    'Status drift: GET /restricted responded 200 -> 403',
  );
});
