/**
 * Tests for CandidateStatus `committed` extension.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 3: Add `committed` to CandidateStatus Union
 *
 * 2 focused tests:
 * 1. `committed` is a valid CandidateStatus value (type-level test using a typed variable assignment)
 * 2. Existing values (`proposed`, `accepted`, `rejected`, `merged`) still compile correctly alongside `committed`
 */

import { CandidateStatus, DiscoveryCandidate } from '../types';

describe('CandidateStatus committed extension', () => {

  // ==========================================================================
  // Test 1: `committed` is a valid CandidateStatus value
  // ==========================================================================
  test('committed is a valid CandidateStatus value', () => {
    // Type-level test: this assignment must compile without error
    const status: CandidateStatus = 'committed';
    expect(status).toBe('committed');

    // Verify it works within a DiscoveryCandidate interface
    const candidate: DiscoveryCandidate = {
      id: 'cand-001',
      runId: 'run-001',
      candidateType: 'application',
      name: 'Payment Service',
      confidence: 0.95,
      status: 'committed',
      sourceClusterIds: ['cluster-001'],
      data: { committedEntityId: 'app-abc123', committedEntityType: 'applications' },
      synthesizedAt: '2026-04-05T10:00:00Z',
    };

    expect(candidate.status).toBe('committed');
    expect(candidate.data.committedEntityId).toBe('app-abc123');
    expect(candidate.data.committedEntityType).toBe('applications');
  });

  // ==========================================================================
  // Test 2: Existing values still compile correctly alongside `committed`
  // ==========================================================================
  test('existing values (proposed, accepted, rejected, merged) still compile correctly alongside committed', () => {
    // Type-level test: all five values must be assignable to CandidateStatus
    const proposed: CandidateStatus = 'proposed';
    const accepted: CandidateStatus = 'accepted';
    const rejected: CandidateStatus = 'rejected';
    const merged: CandidateStatus = 'merged';
    const committed: CandidateStatus = 'committed';

    expect(proposed).toBe('proposed');
    expect(accepted).toBe('accepted');
    expect(rejected).toBe('rejected');
    expect(merged).toBe('merged');
    expect(committed).toBe('committed');

    // Verify all five values are distinct
    const allStatuses: CandidateStatus[] = [proposed, accepted, rejected, merged, committed];
    const uniqueStatuses = new Set(allStatuses);
    expect(uniqueStatuses.size).toBe(5);

    // Verify each can be used in a DiscoveryCandidate
    const baseCandidate: Omit<DiscoveryCandidate, 'status'> = {
      id: 'cand-002',
      runId: 'run-002',
      candidateType: 'service',
      name: 'Order Service',
      confidence: 0.85,
      sourceClusterIds: ['cluster-002'],
      data: {},
      synthesizedAt: '2026-04-05T11:00:00Z',
    };

    for (const status of allStatuses) {
      const candidate: DiscoveryCandidate = { ...baseCandidate, status };
      expect(candidate.status).toBe(status);
    }
  });
});
