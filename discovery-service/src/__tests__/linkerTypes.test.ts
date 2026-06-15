/**
 * Tests for Phase 1b Linker and DecisionTask type definitions.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 1: LinkerRule, CandidateRelationship, and DecisionTask Types
 *
 * 4 focused tests:
 * 1. CandidateRelationship confidence field accepts values in the 0.0-1.0 range
 * 2. DecisionTask type discriminators (confirm_relationship, resolve_competing_relationships) are valid
 * 3. ConfirmRelationshipInput and ResolveCompetingInput are structurally correct with required fields
 * 4. DecisionTaskOutput union types resolve correctly for both task types
 */

import {
  CandidateRelationship,
  LinkerRule,
  DecisionTask,
  DecisionTaskType,
  DecisionTaskStatus,
  ConfirmRelationshipInput,
  ResolveCompetingInput,
  DecisionTaskInput,
  ConfirmRelationshipOutput,
  ResolveCompetingOutput,
  DecisionTaskOutput,
  EvidenceAtom,
} from '../types';

// Helper to build a minimal evidence atom for testing
function makeAtom(overrides: Partial<EvidenceAtom> = {}): EvidenceAtom {
  return {
    id: 'atom-001',
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath: 'src/index.ts',
    type: 'file_structure',
    data: { relativePath: 'src/index.ts', extension: '.ts', sizeBytes: 100, lineCount: 10 },
    extractedAt: '2026-04-05T10:00:00Z',
    ...overrides,
  };
}

describe('Phase 1b Linker and DecisionTask Type Definitions', () => {

  // ==========================================================================
  // Test 1: CandidateRelationship confidence field accepts values in 0.0-1.0
  // ==========================================================================
  test('CandidateRelationship confidence field accepts values in the 0.0-1.0 range', () => {
    const candidate: CandidateRelationship = {
      sourceAtomId: 'atom-001',
      targetAtomId: 'atom-002',
      relationshipType: 'imports',
      confidence: 0.85,
      data: { importStatement: "import { Foo } from './foo'", line: 1, isDefault: false },
      ruleId: 'imports-by-pattern',
    };

    expect(candidate.confidence).toBe(0.85);
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.0);
    expect(candidate.confidence).toBeLessThanOrEqual(1.0);

    // Verify boundary values are assignable
    const lowConfidence: CandidateRelationship = { ...candidate, confidence: 0.0 };
    const highConfidence: CandidateRelationship = { ...candidate, confidence: 1.0 };
    expect(lowConfidence.confidence).toBe(0.0);
    expect(highConfidence.confidence).toBe(1.0);

    // Verify all required fields exist
    expect(candidate.sourceAtomId).toBe('atom-001');
    expect(candidate.targetAtomId).toBe('atom-002');
    expect(candidate.relationshipType).toBe('imports');
    expect(candidate.ruleId).toBe('imports-by-pattern');
    expect(candidate.data).toBeDefined();
  });

  // ==========================================================================
  // Test 2: DecisionTask type discriminators are valid
  // ==========================================================================
  test('DecisionTask type discriminators (confirm_relationship, resolve_competing_relationships) are valid', () => {
    const confirmType: DecisionTaskType = 'confirm_relationship';
    const resolveType: DecisionTaskType = 'resolve_competing_relationships';

    expect(confirmType).toBe('confirm_relationship');
    expect(resolveType).toBe('resolve_competing_relationships');

    const pendingStatus: DecisionTaskStatus = 'pending';
    const resolvedStatus: DecisionTaskStatus = 'resolved';
    const failedStatus: DecisionTaskStatus = 'failed';

    expect(pendingStatus).toBe('pending');
    expect(resolvedStatus).toBe('resolved');
    expect(failedStatus).toBe('failed');

    // Build a complete DecisionTask to verify structure mirrors the DB table
    const task: DecisionTask = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      runId: 'run-001',
      taskType: 'confirm_relationship',
      status: 'pending',
      inputData: {
        sourceAtom: makeAtom({ id: 'atom-001' }),
        targetAtom: makeAtom({ id: 'atom-002' }),
        proposedRelationshipType: 'imports',
        confidence: 0.6,
        ruleId: 'imports-by-pattern',
      } as ConfirmRelationshipInput,
      outputData: null,
      createdAt: '2026-04-05T10:00:00Z',
      resolvedAt: null,
    };

    expect(task.taskType).toBe('confirm_relationship');
    expect(task.status).toBe('pending');
    expect(task.outputData).toBeNull();
    expect(task.resolvedAt).toBeNull();
  });

  // ==========================================================================
  // Test 3: ConfirmRelationshipInput and ResolveCompetingInput are structurally correct
  // ==========================================================================
  test('ConfirmRelationshipInput and ResolveCompetingInput are structurally correct with required fields', () => {
    const confirmInput: ConfirmRelationshipInput = {
      sourceAtom: makeAtom({ id: 'atom-source' }),
      targetAtom: makeAtom({ id: 'atom-target', filePath: 'src/utils.ts' }),
      proposedRelationshipType: 'imports',
      confidence: 0.65,
      ruleId: 'imports-by-pattern',
    };

    expect(confirmInput.sourceAtom.id).toBe('atom-source');
    expect(confirmInput.targetAtom.id).toBe('atom-target');
    expect(confirmInput.proposedRelationshipType).toBe('imports');
    expect(confirmInput.confidence).toBe(0.65);
    expect(confirmInput.ruleId).toBe('imports-by-pattern');

    const resolveInput: ResolveCompetingInput = {
      sourceAtom: makeAtom({ id: 'atom-source' }),
      competitors: [
        {
          targetAtom: makeAtom({ id: 'atom-target-1' }),
          relationshipType: 'imports',
          confidence: 0.6,
          ruleId: 'imports-by-pattern',
        },
        {
          targetAtom: makeAtom({ id: 'atom-target-2' }),
          relationshipType: 'imports',
          confidence: 0.55,
          ruleId: 'imports-by-pattern',
        },
      ],
    };

    expect(resolveInput.sourceAtom.id).toBe('atom-source');
    expect(resolveInput.competitors).toHaveLength(2);
    expect(resolveInput.competitors[0].targetAtom.id).toBe('atom-target-1');
    expect(resolveInput.competitors[0].relationshipType).toBe('imports');
    expect(resolveInput.competitors[0].confidence).toBe(0.6);
    expect(resolveInput.competitors[0].ruleId).toBe('imports-by-pattern');
    expect(resolveInput.competitors[1].targetAtom.id).toBe('atom-target-2');

    // Verify both are valid as DecisionTaskInput
    const input1: DecisionTaskInput = confirmInput;
    const input2: DecisionTaskInput = resolveInput;
    expect(input1).toBeDefined();
    expect(input2).toBeDefined();
  });

  // ==========================================================================
  // Test 4: DecisionTaskOutput union types resolve correctly for both task types
  // ==========================================================================
  test('DecisionTaskOutput union types resolve correctly for both task types', () => {
    const confirmOutput: ConfirmRelationshipOutput = {
      decision: 'confirm',
      adjustedConfidence: 0.92,
      reasoning: 'The import statement clearly references the target symbol.',
    };

    expect(confirmOutput.decision).toBe('confirm');
    expect(confirmOutput.adjustedConfidence).toBe(0.92);
    expect(confirmOutput.reasoning).toBeTruthy();

    const rejectOutput: ConfirmRelationshipOutput = {
      decision: 'reject',
      adjustedConfidence: 0.1,
      reasoning: 'The reference is coincidental; the symbol names are common.',
    };

    expect(rejectOutput.decision).toBe('reject');
    expect(rejectOutput.adjustedConfidence).toBe(0.1);

    const resolveOutput: ResolveCompetingOutput = {
      selectedIndex: 0,
      adjustedConfidence: 0.88,
      reasoning: 'The first target is the correct import based on the module path.',
    };

    expect(resolveOutput.selectedIndex).toBe(0);
    expect(resolveOutput.adjustedConfidence).toBe(0.88);
    expect(resolveOutput.reasoning).toBeTruthy();

    const resolveNoneOutput: ResolveCompetingOutput = {
      selectedIndex: null,
      adjustedConfidence: 0.0,
      reasoning: 'None of the competing targets appear to be a valid match.',
    };

    expect(resolveNoneOutput.selectedIndex).toBeNull();
    expect(resolveNoneOutput.adjustedConfidence).toBe(0.0);

    // Verify both are valid as DecisionTaskOutput
    const output1: DecisionTaskOutput = confirmOutput;
    const output2: DecisionTaskOutput = resolveOutput;
    const output3: DecisionTaskOutput = rejectOutput;
    const output4: DecisionTaskOutput = resolveNoneOutput;
    expect(output1).toBeDefined();
    expect(output2).toBeDefined();
    expect(output3).toBeDefined();
    expect(output4).toBeDefined();

    // Build a complete resolved DecisionTask with output
    const resolvedTask: DecisionTask = {
      id: 'task-001',
      runId: 'run-001',
      taskType: 'confirm_relationship',
      status: 'resolved',
      inputData: {
        sourceAtom: makeAtom(),
        targetAtom: makeAtom({ id: 'atom-002' }),
        proposedRelationshipType: 'imports',
        confidence: 0.6,
        ruleId: 'imports-by-pattern',
      } as ConfirmRelationshipInput,
      outputData: confirmOutput,
      createdAt: '2026-04-05T10:00:00Z',
      resolvedAt: '2026-04-05T10:01:00Z',
    };

    expect(resolvedTask.status).toBe('resolved');
    expect(resolvedTask.outputData).toBe(confirmOutput);
    expect(resolvedTask.resolvedAt).not.toBeNull();
  });
});
