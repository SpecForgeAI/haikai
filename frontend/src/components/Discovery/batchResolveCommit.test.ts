/**
 * batchResolveCommit tests
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 3.1.
 *
 * `resolveDiscoveryConflict` is mocked. Focused coverage of the four critical
 * behaviours:
 *
 *   (a) one call per selected (candidate, attribute) with the correct
 *       `ResolveDiscoveryConflictBody` incl. `resolved_by = "reviewer (batch)"`;
 *   (b) all-success returns `{ resolved: N, failed: 0 }` and the resolved
 *       (candidate, attr) pairs, with the local candidate mutation applied
 *       (canonical slot set, `_conflictResolutions` stamped, `_conflicts`
 *       cleared);
 *   (c) partial failure is best-effort / non-atomic -- a rejected call does not
 *       abort the rest -- and the failed (candidate, attr) set is returned;
 *   (d) re-firing with only the failed selections retries just those.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/discoveryApi', () => ({
  resolveDiscoveryConflict: vi.fn(),
}));

import { resolveDiscoveryConflict, type DiscoveryCandidateDto } from '../../api/discoveryApi';
import {
  batchResolveCommit,
  selectionsToCommitUnits,
  BATCH_RESOLVED_BY,
} from './batchResolveCommit';
import { type ConflictRow } from './batchResolveConflictsSupport';

const mockResolve = vi.mocked(resolveDiscoveryConflict);

const CTX = { projectId: 'p1', architectureId: 'a1', runId: 'r1' };

function candidate(id: string, conflicts: Record<string, unknown>): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'r1',
    candidate_type: 'service',
    name: id,
    confidence: null,
    status: 'active',
    source_cluster_ids: [],
    data: { _conflicts: conflicts },
    synthesized_at: '2026-06-23T00:00:00.000Z',
    parent_candidate_id: null,
    review_status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  } as DiscoveryCandidateDto;
}

function row(
  candidateId: string,
  attr: string,
  options: { value: unknown; source: string }[],
): ConflictRow {
  return { candidateId, candidateName: candidateId, type: 'service', attr, options };
}

/** Read a candidate's `data` as a plain record (test-only narrowing, no `any`). */
function dataOf(c: DiscoveryCandidateDto): Record<string, unknown> {
  return c.data as Record<string, unknown>;
}

/** Read a nested object slot on `data` as a plain record. */
function nested(c: DiscoveryCandidateDto, key: string): Record<string, unknown> {
  return (dataOf(c)[key] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mockResolve.mockReset();
});

describe('batchResolveCommit -- all success', () => {
  it('calls resolveDiscoveryConflict once per selected (candidate, attribute) with the correct body', async () => {
    mockResolve.mockResolvedValue({} as DiscoveryCandidateDto);

    const rowA = row('c1', 'name', [
      { value: 'llm', source: 'llm-gap-fill' },
      { value: 'fw', source: 'spring-classic-jaxrs' },
    ]);
    const rowB = row('c2', 'label', [{ value: 'rt', source: 'runtime-evidence' }]);

    const units = [
      { row: rowA, optionIndex: 1 }, // chose the framework value
      { row: rowB, optionIndex: 0 },
    ];

    const result = await batchResolveCommit(CTX, units, [
      candidate('c1', { name: [] }),
      candidate('c2', { label: [] }),
    ]);

    expect(mockResolve).toHaveBeenCalledTimes(2);
    // c1/name -> chosen framework value + source, batch reviewer label.
    expect(mockResolve).toHaveBeenCalledWith('p1', 'a1', 'r1', 'c1', {
      attr: 'name',
      chosen_value: 'fw',
      chosen_source: 'spring-classic-jaxrs',
      resolved_by: BATCH_RESOLVED_BY,
      resolved_at: expect.any(String),
    });
    expect(BATCH_RESOLVED_BY).toBe('reviewer (batch)');

    expect(result.resolved).toEqual([
      { candidateId: 'c1', attr: 'name' },
      { candidateId: 'c2', attr: 'label' },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('applies the local candidate mutation so resolved rows do not reappear', async () => {
    mockResolve.mockResolvedValue({} as DiscoveryCandidateDto);

    const rowA = row('c1', 'name', [{ value: 'fw', source: 'spring-classic-jaxrs' }]);
    const candidates = [candidate('c1', { name: [{ value: 'x', source: 'llm-gap-fill' }] })];

    const result = await batchResolveCommit(CTX, [{ row: rowA, optionIndex: 0 }], candidates);

    const updated = dataOf(result.candidates[0]);
    // Canonical slot set to the chosen value.
    expect(updated.name).toBe('fw');
    // Resolution stamped with camelCase keys + the batch reviewer label.
    expect((updated._conflictResolutions as Record<string, unknown>).name).toEqual({
      chosenValue: 'fw',
      chosenSource: 'spring-classic-jaxrs',
      resolvedBy: BATCH_RESOLVED_BY,
      resolvedAt: expect.any(String),
    });
    // The conflict entry was cleared.
    expect('name' in (updated._conflicts as Record<string, unknown>)).toBe(false);
    // Original input candidate is untouched (optimistic-revert safety).
    expect(nested(candidates[0], '_conflicts').name).toBeDefined();
  });
});

describe('batchResolveCommit -- partial failure (best-effort, non-atomic)', () => {
  it('a rejected call does not abort the rest; returns the failed (candidate, attr) set', async () => {
    // c1 succeeds, c2 fails, c3 succeeds.
    mockResolve
      .mockResolvedValueOnce({} as DiscoveryCandidateDto)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({} as DiscoveryCandidateDto);

    const units = [
      { row: row('c1', 'name', [{ value: 'a', source: 'spring-classic-jaxrs' }]), optionIndex: 0 },
      { row: row('c2', 'name', [{ value: 'b', source: 'spring-classic-jaxrs' }]), optionIndex: 0 },
      { row: row('c3', 'name', [{ value: 'c', source: 'spring-classic-jaxrs' }]), optionIndex: 0 },
    ];

    const result = await batchResolveCommit(CTX, units, [
      candidate('c1', { name: [] }),
      candidate('c2', { name: [] }),
      candidate('c3', { name: [] }),
    ]);

    expect(mockResolve).toHaveBeenCalledTimes(3); // all fired despite the middle rejection
    expect(result.resolved).toEqual([
      { candidateId: 'c1', attr: 'name' },
      { candidateId: 'c3', attr: 'name' },
    ]);
    expect(result.failed).toEqual([{ candidateId: 'c2', attr: 'name' }]);

    // Only the successes were mutated; the failed candidate keeps its conflict.
    const c2 = result.candidates.find((c) => c.id === 'c2')!;
    expect(nested(c2, '_conflicts').name).toBeDefined();
    expect(dataOf(c2).name).toBeUndefined();
    const c1 = result.candidates.find((c) => c.id === 'c1')!;
    expect(dataOf(c1).name).toBe('a');
  });

  it('re-firing with only the failed selections retries just those', async () => {
    const failedUnit = {
      row: row('c2', 'name', [{ value: 'b', source: 'spring-classic-jaxrs' }]),
      optionIndex: 0,
    };
    mockResolve.mockResolvedValue({} as DiscoveryCandidateDto);

    const retry = await batchResolveCommit(CTX, [failedUnit], [candidate('c2', { name: [] })]);

    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(
      'p1',
      'a1',
      'r1',
      'c2',
      expect.objectContaining({ attr: 'name', resolved_by: BATCH_RESOLVED_BY }),
    );
    expect(retry.resolved).toEqual([{ candidateId: 'c2', attr: 'name' }]);
    expect(retry.failed).toEqual([]);
  });
});

describe('selectionsToCommitUnits', () => {
  it('drops unselected and out-of-range rows, keeps selected ones', () => {
    const rowA = row('c1', 'name', [{ value: 'a', source: 's' }, { value: 'b', source: 't' }]);
    const rowB = row('c2', 'label', [{ value: 'c', source: 's' }]);
    const rowC = row('c3', 'desc', [{ value: 'd', source: 's' }]);

    const units = selectionsToCommitUnits([rowA, rowB, rowC], {
      [`c1::name`]: 1, // selected
      [`c2::label`]: undefined, // unselected
      [`c3::desc`]: 5, // out of range
    });

    expect(units).toEqual([{ row: rowA, optionIndex: 1 }]);
  });
});
