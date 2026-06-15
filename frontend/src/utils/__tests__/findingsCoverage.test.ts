/**
 * Tests for the shared on-read findings-coverage computation.
 *
 * Spec 2026-06-11 Deterministic Findings-Coverage Verification + Gap
 * Wayfinding — Task Group 2 (pure unit tests, no rendering).
 */

import { describe, it, expect } from 'vitest';
import { computeFindingsCoverage } from '../findingsCoverage';
// Shared trust-chain fixture (Task Group 5): the EXACT generationSummary
// wire shape the gateway end-to-end test
// (gateway/src/__tests__/migrationBookOfWorkFindingsCoverage.test.ts)
// asserts the real handler + default fetcher persist at create. Parsing it
// here proves gateway producer and frontend consumer agree on one shape.
import trustChainFixtureRaw from '../../../../agent-os/specs/2026-06-11-findings-coverage-and-gap-wayfinding/planning/fixture-findings-coverage-trust-chain.json?raw';

const SNAPSHOT_FINDINGS = [
  { id: 'FND-1', title: 'Stored procedure not migrated', severity: 'critical', runId: 'run-1' },
  { id: 'FND-2', title: 'Trigger side effect', severity: 'high', runId: 'run-1' },
  { id: 'FND-3', title: 'Implicit conversion risk', severity: 'high', runId: 'run-2' },
];

describe('computeFindingsCoverage (Spec 2026-06-11, Task Group 2)', () => {
  it('returns null when the snapshot is absent or not an array (legacy / fetch-failed / missing summary)', () => {
    // Missing summary entirely.
    expect(computeFindingsCoverage(null, [])).toBeNull();
    expect(computeFindingsCoverage(undefined, [])).toBeNull();
    // Legacy draft: summary present, no findingsCoverage key.
    expect(
      computeFindingsCoverage({ totalItems: 4, initiativeCount: 1 }, []),
    ).toBeNull();
    // Fetch-failed / malformed snapshot: findings is not an array.
    expect(
      computeFindingsCoverage({ findingsCoverage: { findings: 'nope' } }, []),
    ).toBeNull();
    expect(computeFindingsCoverage({ findingsCoverage: {} }, [])).toBeNull();
  });

  it('grades the snapshot against the UNION of items[].discoveryFindingReferences with trimmed, case-insensitive id matching', () => {
    const items = [
      // Trim + case-insensitivity: ' fnd-1 ' matches FND-1.
      { discoveryFindingReferences: [' fnd-1 '] },
      // Missing reference field tolerated.
      {},
      // Non-array reference field tolerated.
      { discoveryFindingReferences: 'FND-2' },
      // Second item contributes FND-3 to the union.
      { discoveryFindingReferences: ['FND-3', 'unrelated-ref'] },
    ];
    const result = computeFindingsCoverage(
      { findingsCoverage: { findings: SNAPSHOT_FINDINGS } },
      items,
    );
    expect(result).toEqual({
      total: 3,
      addressedCount: 2,
      notAddressedCount: 1,
      unaddressed: [
        {
          id: 'FND-2',
          title: 'Trigger side effect',
          severity: 'high',
          runId: 'run-1',
        },
      ],
    });
  });

  it('returns zero totals and an EMPTY unaddressed list (not null) for an empty snapshot', () => {
    const result = computeFindingsCoverage(
      { findingsCoverage: { findings: [] } },
      [{ discoveryFindingReferences: ['FND-1'] }],
    );
    expect(result).toEqual({
      total: 0,
      addressedCount: 0,
      notAddressedCount: 0,
      unaddressed: [],
    });
  });
  // ==========================================================================
  // Task Group 5 — strategic end-to-end addition
  // ==========================================================================

  // 5.2(a) + 5.2(c): generate -> snapshot -> expand -> coverage-improves.
  // The gateway-persisted snapshot (shared fixture) grades to N unaddressed;
  // an epic-expansion-style items APPEND carrying a matching
  // discoveryFindingReferences re-derives to N-1 ON READ, with NO write to
  // (no mutation of) the create-time generationSummary.
  it('trust-chain fixture: gateway snapshot grades on read, an expansion append improves coverage to N-1, and the snapshot is never written', () => {
    const fixture = JSON.parse(trustChainFixtureRaw) as {
      generationSummary: Record<string, unknown>;
      items: Array<{ discoveryFindingReferences?: unknown }>;
      expansionAppendedItems: Array<{ discoveryFindingReferences?: unknown }>;
    };
    const summaryBefore = JSON.parse(JSON.stringify(fixture.generationSummary));

    // Pre-expansion: ' FND-A ' addresses fnd-a (trim + case); fnd-b, fnd-c open.
    const before = computeFindingsCoverage(fixture.generationSummary, fixture.items);
    expect(before).toEqual({
      total: 3,
      addressedCount: 1,
      notAddressedCount: 2,
      unaddressed: [
        {
          id: 'fnd-b',
          title: 'Trigger cascade on customer delete',
          severity: 'high',
          runId: 'run-1',
        },
        {
          id: 'fnd-c',
          title: 'View SQL relies on implicit conversion',
          severity: 'high',
          runId: 'run-2',
        },
      ],
    });

    // Epic-expansion append: the refreshed draft's items now include a story
    // referencing FND-B -> coverage improves N -> N-1 purely on read.
    const after = computeFindingsCoverage(fixture.generationSummary, [
      ...fixture.items,
      ...fixture.expansionAppendedItems,
    ]);
    expect(after).toEqual({
      total: 3,
      addressedCount: 2,
      notAddressedCount: 1,
      unaddressed: [
        {
          id: 'fnd-c',
          title: 'View SQL relies on implicit conversion',
          severity: 'high',
          runId: 'run-2',
        },
      ],
    });

    // No recompute write: generation_summary_json stays untouched.
    expect(fixture.generationSummary).toEqual(summaryBefore);
  });
});
