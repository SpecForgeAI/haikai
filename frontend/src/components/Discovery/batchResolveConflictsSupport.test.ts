/**
 * Tests for `batchResolveConflictsSupport` (Spec 2026-06-23 Batch "Resolve
 * Conflicts" Modal -- Task Group 1.1).
 *
 * Coverage scope (focused; the four critical behaviors from 1.1):
 *  - authority rank ordering (structural-framework-pack > contract-pack >
 *    runtime-evidence > llm-gap-fill) and the unknown-label-defaults-to-
 *    structural-framework rule;
 *  - label map returns a friendly label for a known `CandidateType` and a
 *    title-cased fallback for an unmapped token;
 *  - "most-authoritative" pre-selection picks the highest-tier option and
 *    breaks ties by FIRST option;
 *  - "prefer-source" pre-selection selects that source where present and leaves
 *    rows where it is absent UNSELECTED.
 *
 * Exhaustive per-member / per-label coverage is intentionally skipped.
 */

import { describe, it, expect } from 'vitest';
import {
  sourceLabelRank,
  candidateTypeLabel,
  selectMostAuthoritative,
  selectPreferredSource,
  markMostAuthoritative,
  presentSourceLabels,
  rowKey,
  type ConflictRow,
} from './batchResolveConflictsSupport';

// ---------------------------------------------------------------------------
// (a) Source-authority ladder
// ---------------------------------------------------------------------------

describe('sourceLabelRank -- authority ladder (LOWER wins)', () => {
  it('ranks the four tiers structural-framework > contract-pack > runtime > llm', () => {
    const framework = sourceLabelRank('spring-classic-jaxrs'); // a framework adapter
    const contract = sourceLabelRank('rest-wadl-pack'); // contract-pack label
    const runtime = sourceLabelRank('runtime-evidence');
    const llm = sourceLabelRank('llm-gap-fill');

    expect(framework).toBe(0);
    expect(contract).toBe(1);
    expect(runtime).toBe(2);
    expect(llm).toBe(3);
    // The ordering invariant the modal relies on.
    expect(framework).toBeLessThan(contract);
    expect(contract).toBeLessThan(runtime);
    expect(runtime).toBeLessThan(llm);
  });

  it('defaults an unknown / new label to the structural-framework tier (rank 0)', () => {
    expect(sourceLabelRank('some-brand-new-pack')).toBe(0);
    expect(sourceLabelRank(undefined)).toBe(0);
    expect(sourceLabelRank('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) CandidateType -> human label map
// ---------------------------------------------------------------------------

describe('candidateTypeLabel -- known + fallback', () => {
  it('returns the friendly label for known CandidateType members', () => {
    expect(candidateTypeLabel('logical_data_entity_relationships')).toBe(
      'Logical Data Entity Relationships',
    );
    expect(candidateTypeLabel('ui_screens')).toBe('UI Screens');
    expect(candidateTypeLabel('service')).toBe('Services');
  });

  it('title-cases an unmapped / new token and tolerates null / empty input', () => {
    expect(candidateTypeLabel('totally_made_up_type')).toBe('Totally Made Up Type');
    expect(candidateTypeLabel(null)).toBe('');
    expect(candidateTypeLabel('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// (c) Pure pre-selection helpers
// ---------------------------------------------------------------------------

function row(
  candidateId: string,
  attr: string,
  options: { value: unknown; source: string }[],
  candidateName = candidateId,
  type = 'service',
): ConflictRow {
  return { candidateId, candidateName, type, attr, options };
}

describe('most-authoritative pre-selection', () => {
  it('picks the highest-tier option and breaks ties by the FIRST option', () => {
    // Row A: llm then framework -> framework (index 1) wins on authority.
    const rowA = row('c1', 'name', [
      { value: 'guessed', source: 'llm-gap-fill' },
      { value: 'scanned', source: 'spring-classic-jaxrs' },
    ]);
    // Row B: two framework-tier options (same tier) -> tie breaks to FIRST.
    const rowB = row('c2', 'name', [
      { value: 'first', source: 'spring-classic-servlet' },
      { value: 'second', source: 'spring-boot-adapter' },
    ]);

    expect(markMostAuthoritative(rowA)).toBe(1);
    expect(markMostAuthoritative(rowB)).toBe(0);

    const selections = selectMostAuthoritative([rowA, rowB]);
    expect(selections).toEqual({
      [rowKey(rowA)]: 1,
      [rowKey(rowB)]: 0,
    });
  });
});

describe('prefer-source pre-selection', () => {
  it('selects the source where present and leaves rows lacking it UNSELECTED', () => {
    const withRuntime = row('c1', 'desc', [
      { value: 'fw', source: 'spring-classic-jaxrs' },
      { value: 'rt', source: 'runtime-evidence' },
    ]);
    const withoutRuntime = row('c2', 'desc', [
      { value: 'fw', source: 'spring-classic-jaxrs' },
      { value: 'llm', source: 'llm-gap-fill' },
    ]);

    const selections = selectPreferredSource([withRuntime, withoutRuntime], 'runtime-evidence');

    // Present on c1 -> its runtime option index (1) is selected.
    expect(selections[rowKey(withRuntime)]).toBe(1);
    // Absent on c2 -> that row stays unselected (absent from the map).
    expect(rowKey(withoutRuntime) in selections).toBe(false);
  });

  it('lists ONLY sources present, de-duplicated and authority-ranked', () => {
    const rows = [
      row('c1', 'a', [
        { value: 1, source: 'llm-gap-fill' },
        { value: 2, source: 'runtime-evidence' },
      ]),
      row('c2', 'b', [
        { value: 3, source: 'spring-classic-jaxrs' },
        { value: 4, source: 'runtime-evidence' },
      ]),
    ];

    // De-duplicated (runtime appears twice) and ranked LOWER-first.
    expect(presentSourceLabels(rows)).toEqual([
      'spring-classic-jaxrs',
      'runtime-evidence',
      'llm-gap-fill',
    ]);
  });
});
