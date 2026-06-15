/**
 * jsonShapeComparator unit tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3
 * sub-task 3.1.
 *
 * The CRITICAL test in this file is the wrapper-unwrap test (`Test 1`)
 * which guards against the source-raw vs target-wrapped response_json
 * mismatch. Without this normalisation, every paired item would be
 * flagged `body_shape_drift` and the v1 feature would look broken on
 * day one. See `jsonShapeComparator.ts` header for the full rationale.
 */

import { compareJsonShapes } from '../services/jsonShapeComparator';

// ---------------------------------------------------------------------------
// Test 1 (critical): wrapper-unwrap normalisation
// ---------------------------------------------------------------------------
describe('compareJsonShapes -- Step 1 wrapper unwrap', () => {
  test('source raw + target wrapped { headers, body } => body_match', () => {
    // Source side persists the raw response body.
    const source = { user: { id: 1, name: 'alice' } };
    // Target side persists { headers, body } -- the wrapper added by
    // targetReplayRunner.ts.
    const target = {
      headers: { 'content-type': 'application/json' },
      body: { user: { id: 1, name: 'alice' } },
    };

    const result = compareJsonShapes(source, target);

    expect(result.bodyClassification).toBe('body_match');
    expect(result.bodyDiffJson).toEqual([]);
  });

  test('both sides wrapped { headers, body } => body_match (symmetric unwrap)', () => {
    const source = { headers: { a: '1' }, body: { ok: true } };
    const target = { headers: { b: '2' }, body: { ok: true } };

    const result = compareJsonShapes(source, target);

    // Headers differ but they're unwrapped away on both sides; the bodies
    // are identical so the classification is body_match.
    expect(result.bodyClassification).toBe('body_match');
  });

  test('body that legitimately has headers + body + other keys is NOT unwrapped', () => {
    // A legitimate response body that happens to contain `headers` and
    // `body` as nested keys (alongside other keys) MUST be left verbatim.
    // The two-key-only guard prevents accidental unwrapping.
    const source = { headers: { a: '1' }, body: { x: 1 }, metadata: 'foo' };
    const target = { headers: { a: '1' }, body: { x: 1 }, metadata: 'bar' };

    const result = compareJsonShapes(source, target);

    // The 'metadata' field differs in value -> body_value_drift (NOT
    // body_match, which would indicate spurious unwrapping had happened).
    expect(result.bodyClassification).toBe('body_value_drift');
    expect(result.bodyDiffJson).toEqual([
      {
        path: '/metadata',
        kind: 'value_changed',
        sourceValue: 'foo',
        targetValue: 'bar',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 2: identical objects -> body_match
// ---------------------------------------------------------------------------
test('identical objects classify as body_match', () => {
  const source = { user: { id: 1, items: [1, 2, 3] } };
  const target = { user: { id: 1, items: [1, 2, 3] } };
  const result = compareJsonShapes(source, target);
  expect(result.bodyClassification).toBe('body_match');
  expect(result.bodyDiffJson).toEqual([]);
});

// ---------------------------------------------------------------------------
// Test 3: key added on target -> body_shape_drift
// ---------------------------------------------------------------------------
test('key added on target classifies as body_shape_drift', () => {
  const source = { user: { id: 1 } };
  const target = { user: { id: 1, name: 'alice' } };
  const result = compareJsonShapes(source, target);
  expect(result.bodyClassification).toBe('body_shape_drift');
  expect(result.bodyDiffJson).toEqual([
    { path: '/user/name', kind: 'key_added', targetValue: 'alice' },
  ]);
});

// ---------------------------------------------------------------------------
// Test 4: value changed only -> body_value_drift
// ---------------------------------------------------------------------------
test('value changed only classifies as body_value_drift', () => {
  const source = { user: { id: 1, name: 'alice' } };
  const target = { user: { id: 1, name: 'bob' } };
  const result = compareJsonShapes(source, target);
  expect(result.bodyClassification).toBe('body_value_drift');
  expect(result.bodyDiffJson).toEqual([
    {
      path: '/user/name',
      kind: 'value_changed',
      sourceValue: 'alice',
      targetValue: 'bob',
    },
  ]);
});

// ---------------------------------------------------------------------------
// Test 5: shape drift wins over value drift
// ---------------------------------------------------------------------------
test('shape drift wins over value drift when both present', () => {
  // Target adds a key AND changes an existing value -> body_shape_drift
  // (shape wins, per the aggregation rule).
  const source = { user: { id: 1, name: 'alice' } };
  const target = { user: { id: 1, name: 'bob', email: 'b@x' } };
  const result = compareJsonShapes(source, target);
  expect(result.bodyClassification).toBe('body_shape_drift');
  // Both a value_changed and a key_added entry are recorded.
  const kinds = result.bodyDiffJson.map((d) => d.kind).sort();
  expect(kinds).toEqual(['key_added', 'value_changed']);
});

// ---------------------------------------------------------------------------
// Test 6 (sanity): array comparison is ordered/positional
// ---------------------------------------------------------------------------
test('arrays compared positionally; reordering surfaces value_changed', () => {
  const source = { items: [1, 2, 3] };
  const target = { items: [3, 2, 1] };
  const result = compareJsonShapes(source, target);
  // Positional comparison: items[0] and items[2] differ.
  expect(result.bodyClassification).toBe('body_value_drift');
  expect(result.bodyDiffJson.map((d) => d.path).sort()).toEqual([
    '/items/0',
    '/items/2',
  ]);
});

// ---------------------------------------------------------------------------
// Test 7 (sanity): type change at a leaf surfaces type_changed -> shape_drift
// ---------------------------------------------------------------------------
test('leaf type change classifies as body_shape_drift', () => {
  const source = { count: 5 };
  const target = { count: '5' }; // number -> string
  const result = compareJsonShapes(source, target);
  expect(result.bodyClassification).toBe('body_shape_drift');
  expect(result.bodyDiffJson).toEqual([
    {
      path: '/count',
      kind: 'type_changed',
      sourceValue: 5,
      targetValue: '5',
    },
  ]);
});
