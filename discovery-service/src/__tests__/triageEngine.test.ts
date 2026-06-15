/**
 * Tests for Phase 1b Candidate Triage Engine.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 4: Candidate Triage Engine
 *
 * 5 focused tests:
 * 1. High-confidence candidates (>= 0.8) are placed in the `accepted` bucket
 * 2. Mid-confidence candidates (0.4-0.79) are placed in the `ambiguous` bucket
 * 3. Low-confidence candidates (< 0.4) are placed in the `discarded` bucket
 * 4. Competing relationships (same sourceAtomId and same relationshipType, both ambiguous)
 *    are grouped into a single `resolve_competing_relationships` DecisionTask
 * 5. Non-competing ambiguous candidates each produce individual `confirm_relationship` DecisionTasks
 */

import { triageCandidates } from '../services/triageEngine';
import { CandidateRelationship } from '../types';
import { AUTO_ACCEPT_THRESHOLD, AMBIGUOUS_THRESHOLD } from '../constants/linkerDefaults';

// Helper to build a minimal CandidateRelationship for testing
function makeCandidate(overrides: Partial<CandidateRelationship> = {}): CandidateRelationship {
  return {
    sourceAtomId: 'atom-001',
    targetAtomId: 'atom-002',
    relationshipType: 'imports',
    confidence: 0.5,
    data: { importStatement: "import { Foo } from './foo'", line: 1, isDefault: false },
    ruleId: 'imports-by-pattern',
    ...overrides,
  };
}

describe('Candidate Triage Engine', () => {

  // ==========================================================================
  // Test 1: High-confidence candidates (>= 0.8) are placed in the accepted bucket
  // ==========================================================================
  test('high-confidence candidates (>= 0.8) are placed in the accepted bucket', () => {
    const candidates: CandidateRelationship[] = [
      makeCandidate({ sourceAtomId: 'a1', targetAtomId: 'a2', confidence: 0.95 }),
      makeCandidate({ sourceAtomId: 'a3', targetAtomId: 'a4', confidence: 0.8 }),
      makeCandidate({ sourceAtomId: 'a5', targetAtomId: 'a6', confidence: 1.0 }),
    ];

    const result = triageCandidates(candidates);

    expect(result.accepted).toHaveLength(3);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.discarded).toHaveLength(0);

    // All accepted candidates have confidence >= AUTO_ACCEPT_THRESHOLD
    for (const c of result.accepted) {
      expect(c.confidence).toBeGreaterThanOrEqual(AUTO_ACCEPT_THRESHOLD);
    }
  });

  // ==========================================================================
  // Test 2: Mid-confidence candidates (0.4-0.79) are placed in the ambiguous bucket
  // ==========================================================================
  test('mid-confidence candidates (0.4-0.79) are placed in the ambiguous bucket', () => {
    const candidates: CandidateRelationship[] = [
      makeCandidate({ sourceAtomId: 'a1', targetAtomId: 'a2', confidence: 0.5 }),
      makeCandidate({ sourceAtomId: 'a3', targetAtomId: 'a4', confidence: 0.79 }),
      makeCandidate({ sourceAtomId: 'a5', targetAtomId: 'a6', confidence: 0.4 }),
    ];

    const result = triageCandidates(candidates);

    expect(result.accepted).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(3);
    expect(result.discarded).toHaveLength(0);

    // All ambiguous candidates have confidence >= AMBIGUOUS_THRESHOLD and < AUTO_ACCEPT_THRESHOLD
    for (const c of result.ambiguous) {
      expect(c.confidence).toBeGreaterThanOrEqual(AMBIGUOUS_THRESHOLD);
      expect(c.confidence).toBeLessThan(AUTO_ACCEPT_THRESHOLD);
    }
  });

  // ==========================================================================
  // Test 3: Low-confidence candidates (< 0.4) are placed in the discarded bucket
  // ==========================================================================
  test('low-confidence candidates (< 0.4) are placed in the discarded bucket', () => {
    const candidates: CandidateRelationship[] = [
      makeCandidate({ sourceAtomId: 'a1', targetAtomId: 'a2', confidence: 0.1 }),
      makeCandidate({ sourceAtomId: 'a3', targetAtomId: 'a4', confidence: 0.39 }),
      makeCandidate({ sourceAtomId: 'a5', targetAtomId: 'a6', confidence: 0.0 }),
    ];

    const result = triageCandidates(candidates);

    expect(result.accepted).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.discarded).toHaveLength(3);

    // All discarded candidates have confidence < AMBIGUOUS_THRESHOLD
    for (const c of result.discarded) {
      expect(c.confidence).toBeLessThan(AMBIGUOUS_THRESHOLD);
    }
  });

  // ==========================================================================
  // Test 4: Competing relationships (same sourceAtomId and same relationshipType,
  //          both ambiguous) are grouped into a single resolve_competing_relationships
  //          DecisionTask group
  // ==========================================================================
  test('competing relationships (same sourceAtomId and same relationshipType, both ambiguous) are grouped into a single competing group', () => {
    const candidates: CandidateRelationship[] = [
      // Two ambiguous candidates with same sourceAtomId and same relationshipType -> competing
      makeCandidate({
        sourceAtomId: 'atom-source-1',
        targetAtomId: 'atom-target-A',
        relationshipType: 'imports',
        confidence: 0.6,
        ruleId: 'imports-by-pattern',
      }),
      makeCandidate({
        sourceAtomId: 'atom-source-1',
        targetAtomId: 'atom-target-B',
        relationshipType: 'imports',
        confidence: 0.55,
        ruleId: 'imports-by-pattern',
      }),
    ];

    const result = triageCandidates(candidates);

    // Both should be in the ambiguous bucket
    expect(result.ambiguous).toHaveLength(2);
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded).toHaveLength(0);

    // They should be grouped as competing relationships
    // The competingGroups map keys are "sourceAtomId::relationshipType"
    expect(result.competingGroups.size).toBe(1);

    const groupKey = 'atom-source-1::imports';
    expect(result.competingGroups.has(groupKey)).toBe(true);

    const group = result.competingGroups.get(groupKey)!;
    expect(group).toHaveLength(2);
    expect(group[0].targetAtomId).toBe('atom-target-A');
    expect(group[1].targetAtomId).toBe('atom-target-B');
  });

  // ==========================================================================
  // Test 5: Non-competing ambiguous candidates each produce individual
  //          confirm_relationship DecisionTasks (i.e., they are NOT grouped)
  // ==========================================================================
  test('non-competing ambiguous candidates are not grouped into competing groups', () => {
    const candidates: CandidateRelationship[] = [
      // Different sourceAtomId -> not competing with each other
      makeCandidate({
        sourceAtomId: 'atom-source-1',
        targetAtomId: 'atom-target-A',
        relationshipType: 'imports',
        confidence: 0.6,
      }),
      makeCandidate({
        sourceAtomId: 'atom-source-2',
        targetAtomId: 'atom-target-B',
        relationshipType: 'imports',
        confidence: 0.55,
      }),
      // Same sourceAtomId but different relationshipType -> also not competing
      makeCandidate({
        sourceAtomId: 'atom-source-1',
        targetAtomId: 'atom-target-C',
        relationshipType: 'references',
        confidence: 0.5,
        data: { referenceContext: 'test', line: 1 },
        ruleId: 'references-by-symbol',
      }),
    ];

    const result = triageCandidates(candidates);

    // All three should be in the ambiguous bucket
    expect(result.ambiguous).toHaveLength(3);
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded).toHaveLength(0);

    // No competing groups since each group key has only 1 candidate
    // (groups with fewer than 2 candidates are NOT competing)
    expect(result.competingGroups.size).toBe(0);
  });
});
