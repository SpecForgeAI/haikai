/**
 * Phase 1b Gap Tests -- Strategic tests filling coverage gaps
 * identified during Task Group 11 review.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 11: Test Review and Gap Analysis
 *
 * Tests (pure unit tests, no external mocks needed):
 * 1. Triage engine edge case: empty candidate list returns empty buckets
 * 2. ContainsByPathRule edge case: root-level files with no parent directory
 * 3. Linker registry: initializeLinkerRuleRegistry creates fresh state each time
 * 4. Multiple competing relationship groups in a single triage
 */

import { triageCandidates } from '../services/triageEngine';
import { CandidateRelationship, EvidenceAtom } from '../types';
import { containsByPathRule } from '../services/linkerRules/containsByPathRule';
import {
  getLinkerRuleRegistry,
  initializeLinkerRuleRegistry,
  registerLinkerRule,
} from '../services/linkerRuleRegistry';
import { LinkerRule } from '../types';

// Helper to build a minimal CandidateRelationship
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

// Helper to create a file_structure atom
function makeFileAtom(id: string, relativePath: string): EvidenceAtom {
  return {
    id,
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath: relativePath,
    type: 'file_structure',
    data: {
      relativePath,
      extension: relativePath.includes('.') ? '.' + relativePath.split('.').pop()! : '',
      sizeBytes: 100,
      lineCount: 10,
    },
    extractedAt: '2026-04-05T10:00:00Z',
  };
}

describe('Phase 1b Gap Tests', () => {

  // ==========================================================================
  // Test 1: Triage engine with empty candidate list
  // ==========================================================================
  test('triageCandidates with empty candidate list returns empty buckets and no competing groups', () => {
    const result = triageCandidates([]);

    expect(result.accepted).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.discarded).toHaveLength(0);
    expect(result.competingGroups.size).toBe(0);
  });

  // ==========================================================================
  // Test 2: ContainsByPathRule with root-level files (no parent directory)
  // ==========================================================================
  test('ContainsByPathRule: root-level files with no parent directory produce no containment candidates', () => {
    const atoms: EvidenceAtom[] = [
      makeFileAtom('file-readme', 'README.md'),
      makeFileAtom('file-package', 'package.json'),
      makeFileAtom('file-license', 'LICENSE'),
    ];

    const candidates = containsByPathRule.match(atoms);

    // Root-level files cannot contain each other -- no directory-prefix relationship
    expect(candidates).toHaveLength(0);
  });

  // ==========================================================================
  // Test 3: Linker registry creates fresh state on each initialization
  // ==========================================================================
  test('initializeLinkerRuleRegistry creates fresh registry and custom rules do not persist across re-initialization', () => {
    // Initialize and verify 4 built-in rules
    initializeLinkerRuleRegistry();
    const registry1 = getLinkerRuleRegistry();
    expect(registry1.size).toBe(4);

    // Register a custom rule
    const customRule: LinkerRule = {
      id: 'custom-test-rule',
      name: 'Custom Test',
      description: 'Temporary custom rule',
      targetRelationshipType: 'references',
      match: () => [],
    };
    registerLinkerRule(customRule);
    expect(registry1.size).toBe(5);
    expect(registry1.has('custom-test-rule')).toBe(true);

    // Re-initialize -- should create a fresh Map with only the 4 built-in rules
    initializeLinkerRuleRegistry();
    const registry2 = getLinkerRuleRegistry();
    expect(registry2.size).toBe(4);
    expect(registry2.has('custom-test-rule')).toBe(false);

    // Verify the 4 built-in rules are present
    expect(registry2.has('contains-by-path')).toBe(true);
    expect(registry2.has('imports-by-pattern')).toBe(true);
    expect(registry2.has('extends-by-pattern')).toBe(true);
    expect(registry2.has('references-by-symbol')).toBe(true);
  });

  // ==========================================================================
  // Test 4: Multiple competing relationship groups in a single triage
  // ==========================================================================
  test('triageCandidates correctly identifies multiple separate competing groups in a single triage', () => {
    const candidates: CandidateRelationship[] = [
      // Group 1: atom-src-1 + imports -- two competing targets
      makeCandidate({
        sourceAtomId: 'atom-src-1',
        targetAtomId: 'atom-tgt-A',
        relationshipType: 'imports',
        confidence: 0.6,
      }),
      makeCandidate({
        sourceAtomId: 'atom-src-1',
        targetAtomId: 'atom-tgt-B',
        relationshipType: 'imports',
        confidence: 0.55,
      }),
      // Group 2: atom-src-2 + extends -- two competing targets (different source)
      makeCandidate({
        sourceAtomId: 'atom-src-2',
        targetAtomId: 'atom-tgt-C',
        relationshipType: 'extends',
        confidence: 0.7,
        data: { parentName: 'Base', childName: 'Derived', mechanism: 'extends' },
        ruleId: 'extends-by-pattern',
      }),
      makeCandidate({
        sourceAtomId: 'atom-src-2',
        targetAtomId: 'atom-tgt-D',
        relationshipType: 'extends',
        confidence: 0.5,
        data: { parentName: 'Base', childName: 'Derived2', mechanism: 'extends' },
        ruleId: 'extends-by-pattern',
      }),
      // Non-competing: atom-src-3 has only one ambiguous candidate
      makeCandidate({
        sourceAtomId: 'atom-src-3',
        targetAtomId: 'atom-tgt-E',
        relationshipType: 'references',
        confidence: 0.45,
        data: { referenceContext: 'some ref', line: 1 },
        ruleId: 'references-by-symbol',
      }),
    ];

    const result = triageCandidates(candidates);

    // All 5 are ambiguous (0.4 <= confidence < 0.8)
    expect(result.ambiguous).toHaveLength(5);
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded).toHaveLength(0);

    // Should have exactly 2 competing groups
    expect(result.competingGroups.size).toBe(2);

    // Group 1: atom-src-1::imports
    const group1 = result.competingGroups.get('atom-src-1::imports');
    expect(group1).toBeDefined();
    expect(group1).toHaveLength(2);
    const group1Targets = group1!.map(c => c.targetAtomId).sort();
    expect(group1Targets).toEqual(['atom-tgt-A', 'atom-tgt-B']);

    // Group 2: atom-src-2::extends
    const group2 = result.competingGroups.get('atom-src-2::extends');
    expect(group2).toBeDefined();
    expect(group2).toHaveLength(2);
    const group2Targets = group2!.map(c => c.targetAtomId).sort();
    expect(group2Targets).toEqual(['atom-tgt-C', 'atom-tgt-D']);

    // atom-src-3::references should NOT be in competing groups (only 1 candidate)
    expect(result.competingGroups.has('atom-src-3::references')).toBe(false);
  });
});
