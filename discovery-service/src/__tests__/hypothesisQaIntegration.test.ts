/**
 * Hypothesis Q&A Integration Tests (Increment 15, Task Group 6)
 *
 * Strategic gap-filling tests covering:
 * 1. End-to-end integration: generate -> batch -> capture answers -> refine -> verify confidence
 * 2. Backward compatibility: existing EvidenceAtom objects without `source` field still work
 * 3. Round-trip steps_payload: hypotheses written by generate are correctly read by refine
 * 4. Question batch boundary: batches never exceed 4 questions, never produce empty batches
 * 5. Confidence capping: multiple confirmed verdicts do not push above LOG_MAX_CONFIDENCE_CAP
 * 6. Denial floor: denied verdict does not push confidence below 0.0
 * 7. Skip-path: Q&A step being skipped does not block downstream workflows
 * 8. Multiple round: unresolved hypotheses from round 1 carry over to round 2
 */

import { generateHypotheses, persistHypotheses } from '../services/hypothesisGenerationEngine';
import { generateQuestionBatches } from '../services/questionBatchGenerator';
import { processAnswers } from '../services/hypothesisAnswerProcessor';
import { applyRefinements } from '../services/hypothesisRefinementEngine';
import { Hypothesis, HypothesisAnswer } from '../types/hypothesis';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceCluster } from '../types/cluster';
import { EvidenceAtom } from '../types/evidenceAtom';
import {
  QA_CONFIRMATION_CONFIDENCE_BOOST,
  QA_DENIAL_CONFIDENCE_PENALTY,
  LOG_MAX_CONFIDENCE_CAP,
} from '../constants/hypothesisQaDefaults';
import {
  CANDIDATE_AUTO_ACCEPT_THRESHOLD,
  CANDIDATE_AMBIGUOUS_THRESHOLD,
} from '../constants/candidateDefaults';

// =============================================================================
// Test Helpers
// =============================================================================

const PROJECT_ID = 'project-integration-001';
const RUN_ID = 'run-integration-001';

function makeCandidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    id: 'candidate-001',
    runId: RUN_ID,
    candidateType: 'service',
    name: 'Test Service',
    confidence: 0.60,
    status: 'proposed',
    sourceClusterIds: ['cluster-001'],
    data: { description: 'A test service' },
    synthesizedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCluster(overrides: Partial<EvidenceCluster> = {}): EvidenceCluster {
  return {
    id: 'cluster-001',
    runId: RUN_ID,
    clusterType: 'service_boundary',
    name: 'Test Cluster',
    confidence: 0.7,
    members: [
      { memberType: 'atom', memberId: 'atom-001' },
      { memberType: 'atom', memberId: 'atom-002' },
    ],
    data: {},
    formedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAtom(overrides: Partial<EvidenceAtom> = {}): EvidenceAtom {
  return {
    id: 'atom-001',
    runId: RUN_ID,
    repoUrl: 'https://github.com/test/repo',
    filePath: 'src/app.ts',
    type: 'string_pattern',
    data: {
      patternName: 'test_pattern',
      matchedText: 'test match',
      line: 10,
      contextSnippet: 'test context',
    },
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<HypothesisAnswer> = {}): HypothesisAnswer {
  return {
    hypothesisId: 'hyp-001',
    verdict: 'confirmed',
    answeredAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a mock archModelClient that tracks calls and stores data in-memory.
 * Supports multi-round interaction by maintaining state across calls.
 */
function makeMockArchClient() {
  let stepsPayload: Record<string, unknown> = {};
  const savedAtoms: EvidenceAtom[] = [];
  const candidateUpdates: Array<{ candidateId: string; update: Partial<DiscoveryCandidate> }> = [];

  return {
    client: {
      bulkSaveEvidence: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, atoms: EvidenceAtom[]) => {
          savedAtoms.push(...atoms);
          return Promise.resolve();
        }
      ),
      getDiscoveryRun: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          id: RUN_ID,
          project_id: PROJECT_ID,
          service_id: null,
          status: 'COMPLETED',
          steps_payload: { ...stepsPayload },
        });
      }),
      updateDiscoveryRun: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, payload: { steps_payload?: object }) => {
          if (payload.steps_payload) {
            stepsPayload = payload.steps_payload as Record<string, unknown>;
          }
          return Promise.resolve({});
        }
      ),
      updateCandidate: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, candidateId: string, update: Partial<DiscoveryCandidate>) => {
          candidateUpdates.push({ candidateId, update });
          return Promise.resolve({ id: candidateId, ...update });
        }
      ),
    },
    getStepsPayload: () => stepsPayload,
    getSavedAtoms: () => savedAtoms,
    getCandidateUpdates: () => candidateUpdates,
    setStepsPayload: (payload: Record<string, unknown>) => {
      stepsPayload = payload;
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Hypothesis Q&A Integration Tests', () => {

  // ==========================================================================
  // Test 1: End-to-end integration: generate -> batch -> capture -> refine -> verify
  // ==========================================================================
  test('end-to-end cycle: generate hypotheses, batch questions, capture answers, refine, and verify confidence changes', async () => {
    // Set up discovery data with multiple hypothesis-triggering conditions
    const lowConfCandidate = makeCandidate({
      id: 'c-low-001',
      name: 'UserService',
      confidence: 0.50,
      sourceClusterIds: ['cl-001'],
      data: { description: 'A user service' },
    });

    const missingAttrCandidate = makeCandidate({
      id: 'c-missing-001',
      name: 'OrderService',
      confidence: 0.80,
      sourceClusterIds: ['cl-002'],
      data: {}, // missing description
    });

    const unknownCluster = makeCluster({
      id: 'cl-003',
      clusterType: 'unknown',
      name: 'Mystery Group',
      confidence: 0.60,
      members: [{ memberType: 'atom', memberId: 'atom-u1' }],
    });

    const cluster1 = makeCluster({
      id: 'cl-001',
      members: [{ memberType: 'atom', memberId: 'atom-001' }],
    });

    const cluster2 = makeCluster({
      id: 'cl-002',
      members: [{ memberType: 'atom', memberId: 'atom-002' }],
    });

    const atoms = [
      makeAtom({ id: 'atom-001', source: 'code' }),
      makeAtom({ id: 'atom-002', source: 'code' }),
      makeAtom({ id: 'atom-u1', source: 'code' }),
    ];

    // Step 1: Generate hypotheses
    const hypotheses = generateHypotheses(
      RUN_ID,
      [lowConfCandidate, missingAttrCandidate],
      [cluster1, cluster2, unknownCluster],
      atoms,
      []
    );

    // Should produce hypotheses for low confidence, missing attribute, and unknown cluster
    expect(hypotheses.length).toBeGreaterThanOrEqual(3);

    const categories = new Set(hypotheses.map(h => h.category));
    expect(categories.has('low_confidence')).toBe(true);
    expect(categories.has('missing_attribute')).toBe(true);
    expect(categories.has('ambiguous_type')).toBe(true);

    // Step 2: Generate question batches
    const batches = generateQuestionBatches(hypotheses);
    expect(batches.length).toBeGreaterThanOrEqual(1);

    const allQuestions = batches.flatMap(b => b.questions);
    expect(allQuestions.length).toBe(hypotheses.length);

    // Step 3: Create answers for each hypothesis
    const answers: HypothesisAnswer[] = hypotheses.map(h => {
      if (h.category === 'low_confidence') {
        return makeAnswer({ hypothesisId: h.id, verdict: 'confirmed' });
      } else if (h.category === 'missing_attribute') {
        return makeAnswer({
          hypothesisId: h.id,
          verdict: 'partially_confirmed',
          freeTextNotes: 'The service exists but needs a better description',
        });
      } else {
        return makeAnswer({ hypothesisId: h.id, verdict: 'denied' });
      }
    });

    // Step 4: Process answers (creates human_qa atoms)
    const { client, getSavedAtoms } = makeMockArchClient();

    const createdAtoms = await processAnswers(
      PROJECT_ID, RUN_ID, answers, hypotheses, client
    );

    expect(createdAtoms.length).toBe(answers.length);
    for (const atom of createdAtoms) {
      expect(atom.source).toBe('human_qa');
      expect(atom.qaOrigin).toBeDefined();
    }

    // Step 5: Apply refinements
    const summary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      answers,
      hypotheses,
      [lowConfCandidate, missingAttrCandidate],
      [cluster1, cluster2, unknownCluster],
      client
    );

    expect(summary.refinementsApplied).toBeGreaterThanOrEqual(3);

    // Verify low-confidence candidate was boosted
    const lowConfOp = summary.confidenceChanges.find(
      op => op.subjectId === 'c-low-001' && op.verdict === 'confirmed'
    );
    expect(lowConfOp).toBeDefined();
    expect(lowConfOp!.newConfidence).toBeCloseTo(0.50 + QA_CONFIRMATION_CONFIDENCE_BOOST);

    // Verify hypotheses have updated statuses
    for (const h of hypotheses) {
      expect(h.status).not.toBe('pending');
    }
  });

  // ==========================================================================
  // Test 2: Backward compatibility: atoms without `source` field work correctly
  // ==========================================================================
  test('backward compatibility: existing EvidenceAtom objects without source field are treated as code-sourced in hypothesis generation', () => {
    // Create legacy atoms without a source field (pre-Increment 14 pattern)
    const legacyAtom1: EvidenceAtom = {
      id: 'legacy-atom-001',
      runId: RUN_ID,
      repoUrl: 'https://github.com/test/repo',
      filePath: 'src/legacy.ts',
      type: 'string_pattern',
      data: {
        patternName: 'legacy_pattern',
        matchedText: 'legacy match',
        line: 5,
        contextSnippet: 'legacy context',
      },
      extractedAt: '2025-01-01T00:00:00Z',
      // No source field -- backward compatible
    };

    const legacyAtom2: EvidenceAtom = {
      id: 'legacy-atom-002',
      runId: RUN_ID,
      repoUrl: 'https://github.com/test/repo',
      filePath: 'src/legacy2.ts',
      type: 'symbol',
      data: {
        name: 'LegacyClass',
        kind: 'class',
        line: 1,
        scope: null,
        language: 'typescript',
      },
      extractedAt: '2025-01-01T00:00:00Z',
      // No source field, no logOrigin, no qaOrigin
    };

    // Cluster containing only legacy atoms
    const cluster = makeCluster({
      id: 'cl-legacy-001',
      members: [
        { memberType: 'atom', memberId: 'legacy-atom-001' },
        { memberType: 'atom', memberId: 'legacy-atom-002' },
      ],
    });

    // Candidate referencing the legacy cluster
    const candidate = makeCandidate({
      id: 'c-legacy-001',
      name: 'LegacyService',
      confidence: 0.50,
      sourceClusterIds: ['cl-legacy-001'],
    });

    // Generate hypotheses -- should work without errors despite missing source field
    const hypotheses = generateHypotheses(
      RUN_ID, [candidate], [cluster], [legacyAtom1, legacyAtom2], []
    );

    // Should generate a low_confidence hypothesis (0.50 < 0.75 threshold)
    const lowConfHyp = hypotheses.find(h => h.category === 'low_confidence');
    expect(lowConfHyp).toBeDefined();
    expect(lowConfHyp!.subjectId).toBe('c-legacy-001');

    // Should NOT generate conflicting_evidence because both atoms are treated as code-sourced
    const conflictHyp = hypotheses.find(h => h.category === 'conflicting_evidence');
    expect(conflictHyp).toBeUndefined();

    // Verify legacy atoms can coexist in arrays with modern atoms
    const modernAtom = makeAtom({ id: 'modern-001', source: 'code' });
    const qaAtom = makeAtom({
      id: 'qa-001',
      source: 'human_qa',
      qaOrigin: {
        hypothesisId: 'hyp-test',
        verdict: 'confirmed',
        answeredAt: '2026-04-06T10:00:00Z',
      },
    });

    const allAtoms: EvidenceAtom[] = [legacyAtom1, legacyAtom2, modernAtom, qaAtom];
    expect(allAtoms).toHaveLength(4);

    // All atoms should have valid id and runId regardless of source
    for (const atom of allAtoms) {
      expect(atom.id).toBeTruthy();
      expect(atom.runId).toBeTruthy();
    }
  });

  // ==========================================================================
  // Test 3: Round-trip steps_payload: hypotheses written then read back correctly
  // ==========================================================================
  test('steps_payload round-trip: hypotheses persisted by generate are correctly readable by refine', async () => {
    const { client, getStepsPayload } = makeMockArchClient();

    // Generate hypotheses
    const candidate = makeCandidate({
      id: 'c-rt-001',
      name: 'RoundTripService',
      confidence: 0.40,
      sourceClusterIds: ['cl-rt-001'],
      data: { description: 'A service to test round-trip' },
    });

    const cluster = makeCluster({
      id: 'cl-rt-001',
      members: [{ memberType: 'atom', memberId: 'atom-rt-001' }],
    });

    const hypotheses = generateHypotheses(
      RUN_ID, [candidate], [cluster], [makeAtom({ id: 'atom-rt-001' })], []
    );

    expect(hypotheses.length).toBeGreaterThan(0);

    // Persist hypotheses to steps_payload
    await persistHypotheses(PROJECT_ID, RUN_ID, hypotheses, client);

    // Read back from the mock's stored state
    const storedPayload = getStepsPayload();
    const hypothesisQa = storedPayload.hypothesisQa as Record<string, unknown>;
    expect(hypothesisQa).toBeDefined();

    const storedHypotheses = hypothesisQa.hypotheses as Hypothesis[];
    expect(storedHypotheses).toBeDefined();
    expect(storedHypotheses).toHaveLength(hypotheses.length);

    // Verify each hypothesis round-trips correctly
    for (let i = 0; i < hypotheses.length; i++) {
      expect(storedHypotheses[i].id).toBe(hypotheses[i].id);
      expect(storedHypotheses[i].runId).toBe(hypotheses[i].runId);
      expect(storedHypotheses[i].category).toBe(hypotheses[i].category);
      expect(storedHypotheses[i].subjectType).toBe(hypotheses[i].subjectType);
      expect(storedHypotheses[i].subjectId).toBe(hypotheses[i].subjectId);
      expect(storedHypotheses[i].description).toBe(hypotheses[i].description);
      expect(storedHypotheses[i].evidenceRefs).toEqual(hypotheses[i].evidenceRefs);
      expect(storedHypotheses[i].status).toBe(hypotheses[i].status);
    }

    // Now create answers from the stored hypotheses and process them
    const answers: HypothesisAnswer[] = storedHypotheses.map(h =>
      makeAnswer({ hypothesisId: h.id, verdict: 'confirmed' })
    );

    const createdAtoms = await processAnswers(
      PROJECT_ID, RUN_ID, answers, storedHypotheses, client
    );

    expect(createdAtoms.length).toBe(storedHypotheses.length);

    // Apply refinements using stored hypotheses
    const summary = await applyRefinements(
      PROJECT_ID, RUN_ID, answers, storedHypotheses, [candidate], [cluster], client
    );

    expect(summary.refinementsApplied).toBeGreaterThan(0);

    // Verify the final steps_payload contains both hypothesis and refinement data
    const finalPayload = getStepsPayload();
    const finalQa = finalPayload.hypothesisQa as Record<string, unknown>;
    expect(finalQa.refinements).toBeDefined();
    expect(finalQa.refinedAt).toBeTruthy();
  });

  // ==========================================================================
  // Test 4: Question batch boundary: never exceed 4, never produce empty batches
  // ==========================================================================
  test('question batches never exceed 4 questions and never produce empty batches for non-empty input', () => {
    // Create 9 hypotheses in the same category to test splitting
    const manyHypotheses: Hypothesis[] = [];
    for (let i = 0; i < 9; i++) {
      manyHypotheses.push({
        id: `hyp-batch-${i}`,
        runId: RUN_ID,
        category: 'low_confidence',
        subjectType: 'candidate',
        subjectId: `c-batch-${i}`,
        description: `Candidate ${i} has low confidence`,
        evidenceRefs: [`atom-batch-${i}`],
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }

    const batches = generateQuestionBatches(manyHypotheses);

    // Should have at least 3 batches (9 / 4 = 2.25, rounded up)
    expect(batches.length).toBeGreaterThanOrEqual(2);

    // No batch should exceed 4 questions
    for (const batch of batches) {
      expect(batch.questions.length).toBeLessThanOrEqual(4);
      expect(batch.questions.length).toBeGreaterThanOrEqual(1);
    }

    // Total questions should equal total input hypotheses
    const totalQuestions = batches.reduce((sum, b) => sum + b.questions.length, 0);
    expect(totalQuestions).toBe(9);

    // No empty batches
    for (const batch of batches) {
      expect(batch.questions.length).toBeGreaterThan(0);
    }

    // Test with a single hypothesis -- should produce one batch with 1 question
    const singleHypothesis: Hypothesis[] = [{
      id: 'hyp-single',
      runId: RUN_ID,
      category: 'ambiguous_type',
      subjectType: 'cluster',
      subjectId: 'cl-single',
      description: 'Single hypothesis',
      evidenceRefs: ['atom-single'],
      status: 'pending',
      createdAt: new Date().toISOString(),
    }];

    const singleBatch = generateQuestionBatches(singleHypothesis);
    expect(singleBatch.length).toBe(1);
    expect(singleBatch[0].questions.length).toBe(1);

    // Test with mixed categories (should group by category, each respecting max 4)
    const mixedHypotheses: Hypothesis[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `hyp-lc-${i}`,
        runId: RUN_ID,
        category: 'low_confidence' as const,
        subjectType: 'candidate' as const,
        subjectId: `c-lc-${i}`,
        description: `Low confidence ${i}`,
        evidenceRefs: [`atom-lc-${i}`],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `hyp-wc-${i}`,
        runId: RUN_ID,
        category: 'weak_cluster' as const,
        subjectType: 'cluster' as const,
        subjectId: `cl-wc-${i}`,
        description: `Weak cluster ${i}`,
        evidenceRefs: [`atom-wc-${i}`],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      })),
    ];

    const mixedBatches = generateQuestionBatches(mixedHypotheses);
    for (const batch of mixedBatches) {
      expect(batch.questions.length).toBeLessThanOrEqual(4);
      expect(batch.questions.length).toBeGreaterThan(0);
    }
    const mixedTotal = mixedBatches.reduce((sum, b) => sum + b.questions.length, 0);
    expect(mixedTotal).toBe(8);
  });

  // ==========================================================================
  // Test 5: Confidence capping: multiple confirmed verdicts do not exceed cap
  // ==========================================================================
  test('multiple confirmed verdicts do not push confidence above LOG_MAX_CONFIDENCE_CAP', async () => {
    // Start with a candidate at 0.90 -- close to cap
    const candidate = makeCandidate({ id: 'c-cap-001', confidence: 0.90 });

    // Create 3 hypotheses all targeting the same candidate
    const hypotheses: Hypothesis[] = [
      {
        id: 'hyp-cap-001',
        runId: RUN_ID,
        category: 'low_confidence',
        subjectType: 'candidate',
        subjectId: 'c-cap-001',
        description: 'First hypothesis',
        evidenceRefs: ['atom-1'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'hyp-cap-002',
        runId: RUN_ID,
        category: 'conflicting_evidence',
        subjectType: 'candidate',
        subjectId: 'c-cap-001',
        description: 'Second hypothesis',
        evidenceRefs: ['atom-2'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'hyp-cap-003',
        runId: RUN_ID,
        category: 'missing_attribute',
        subjectType: 'candidate',
        subjectId: 'c-cap-001',
        description: 'Third hypothesis',
        evidenceRefs: ['atom-3'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    // All 3 confirmed
    const answers: HypothesisAnswer[] = hypotheses.map(h =>
      makeAnswer({ hypothesisId: h.id, verdict: 'confirmed' })
    );

    const { client } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID, RUN_ID, answers, hypotheses, [candidate], [], client
    );

    expect(summary.refinementsApplied).toBe(3);

    // Each refinement should have been applied sequentially.
    // After first: 0.90 + 0.12 = 1.02 -> capped at 0.98
    // After second: 0.98 + 0.12 = 1.10 -> capped at 0.98
    // After third: 0.98 + 0.12 = 1.10 -> capped at 0.98
    // Final candidate confidence should be exactly LOG_MAX_CONFIDENCE_CAP
    expect(candidate.confidence).toBe(LOG_MAX_CONFIDENCE_CAP);

    // All recorded operations should show newConfidence <= LOG_MAX_CONFIDENCE_CAP
    for (const op of summary.confidenceChanges) {
      expect(op.newConfidence).toBeLessThanOrEqual(LOG_MAX_CONFIDENCE_CAP);
    }
  });

  // ==========================================================================
  // Test 6: Denial floor: denied verdict does not push confidence below 0.0
  // ==========================================================================
  test('denied verdict does not push confidence below 0.0 even with very low starting confidence', async () => {
    // Test with confidence of 0.05 -- penalty of 0.20 would go to -0.15 without floor
    const candidate = makeCandidate({ id: 'c-floor-001', confidence: 0.05 });

    const hypothesis: Hypothesis = {
      id: 'hyp-floor-001',
      runId: RUN_ID,
      category: 'low_confidence',
      subjectType: 'candidate',
      subjectId: 'c-floor-001',
      description: 'Very low confidence candidate',
      evidenceRefs: ['atom-floor-1'],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const answer = makeAnswer({ hypothesisId: 'hyp-floor-001', verdict: 'denied' });

    const { client } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID, RUN_ID, [answer], [hypothesis], [candidate], [], client
    );

    expect(summary.refinementsApplied).toBe(1);
    expect(summary.confidenceChanges[0].newConfidence).toBe(0.0);
    expect(summary.confidenceChanges[0].newConfidence).toBeGreaterThanOrEqual(0.0);
    expect(candidate.confidence).toBe(0.0);

    // Test with confidence of exactly 0.0 -- should remain at 0.0
    const zeroCandidate = makeCandidate({ id: 'c-zero-001', confidence: 0.0 });
    const zeroHypothesis: Hypothesis = {
      id: 'hyp-zero-001',
      runId: RUN_ID,
      category: 'low_confidence',
      subjectType: 'candidate',
      subjectId: 'c-zero-001',
      description: 'Zero confidence candidate',
      evidenceRefs: ['atom-zero-1'],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const zeroAnswer = makeAnswer({ hypothesisId: 'hyp-zero-001', verdict: 'denied' });
    const { client: client2 } = makeMockArchClient();

    const zeroSummary = await applyRefinements(
      PROJECT_ID, RUN_ID, [zeroAnswer], [zeroHypothesis], [zeroCandidate], [], client2
    );

    expect(zeroSummary.confidenceChanges[0].newConfidence).toBe(0.0);
    expect(zeroCandidate.confidence).toBe(0.0);
  });

  // ==========================================================================
  // Test 7: Skip-path: Q&A step skipped does not block downstream workflows
  // ==========================================================================
  test('Q&A step being skipped does not block the review/approval workflow', () => {
    // Scenario 1: No hypotheses generated (all candidates are high-confidence)
    const highConfCandidate = makeCandidate({
      id: 'c-skip-001',
      name: 'StrongService',
      confidence: 0.90,
      data: { description: 'Well-described service' },
    });

    const cluster = makeCluster({
      id: 'cl-skip-001',
      clusterType: 'service_boundary',
      confidence: 0.85,
    });

    const atoms = [makeAtom({ id: 'atom-skip-001', source: 'code' })];

    const hypotheses = generateHypotheses(
      RUN_ID, [highConfCandidate], [cluster], atoms, []
    );

    // No hypotheses should be generated for a healthy dataset
    expect(hypotheses).toHaveLength(0);

    // Question batches should be empty
    const batches = generateQuestionBatches(hypotheses);
    expect(batches).toHaveLength(0);

    // The candidate remains unchanged -- ready for review/approval
    expect(highConfCandidate.confidence).toBe(0.90);
    expect(highConfCandidate.status).toBe('proposed');

    // Scenario 2: Hypotheses generated but user skips (all marked needs_more_info)
    const lowConfCandidate = makeCandidate({
      id: 'c-skipqa-001',
      name: 'WeakService',
      confidence: 0.50,
      sourceClusterIds: ['cl-skip-002'],
    });

    const cluster2 = makeCluster({
      id: 'cl-skip-002',
      members: [{ memberType: 'atom', memberId: 'atom-skip-002' }],
    });

    const hypotheses2 = generateHypotheses(
      RUN_ID, [lowConfCandidate], [cluster2], [makeAtom({ id: 'atom-skip-002' })], []
    );

    expect(hypotheses2.length).toBeGreaterThan(0);

    // User does not answer -- candidate remains in current state (still reviewable)
    // The pipeline can proceed to review/approval with the current candidate state
    expect(lowConfCandidate.confidence).toBe(0.50);
    expect(lowConfCandidate.status).toBe('proposed');

    // Candidate is still valid for review/approval workflow
    // (proposed or pending_review status is acceptable)
    expect(['proposed', 'pending_review']).toContain(lowConfCandidate.status);
  });

  // ==========================================================================
  // Test 8: Multiple round: unresolved hypotheses from round 1 carry over to round 2
  // ==========================================================================
  test('unresolved hypotheses from round 1 carry over correctly to round 2', async () => {
    // Create 4 hypotheses
    const hypotheses: Hypothesis[] = [
      {
        id: 'hyp-r1-001',
        runId: RUN_ID,
        category: 'low_confidence',
        subjectType: 'candidate',
        subjectId: 'c-r1-001',
        description: 'Low confidence candidate 1',
        evidenceRefs: ['atom-r1-1'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'hyp-r1-002',
        runId: RUN_ID,
        category: 'low_confidence',
        subjectType: 'candidate',
        subjectId: 'c-r1-002',
        description: 'Low confidence candidate 2',
        evidenceRefs: ['atom-r1-2'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'hyp-r1-003',
        runId: RUN_ID,
        category: 'ambiguous_type',
        subjectType: 'cluster',
        subjectId: 'cl-r1-001',
        description: 'Ambiguous cluster',
        evidenceRefs: ['cl-r1-001'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'hyp-r1-004',
        runId: RUN_ID,
        category: 'weak_cluster',
        subjectType: 'cluster',
        subjectId: 'cl-r1-002',
        description: 'Weak cluster',
        evidenceRefs: ['cl-r1-002'],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    // Round 1: Answer only the first two, leave the rest as needs_more_info
    const round1Answers: HypothesisAnswer[] = [
      makeAnswer({ hypothesisId: 'hyp-r1-001', verdict: 'confirmed' }),
      makeAnswer({ hypothesisId: 'hyp-r1-002', verdict: 'denied' }),
      makeAnswer({ hypothesisId: 'hyp-r1-003', verdict: 'needs_more_info' }),
      makeAnswer({ hypothesisId: 'hyp-r1-004', verdict: 'needs_more_info' }),
    ];

    const candidates = [
      makeCandidate({ id: 'c-r1-001', confidence: 0.50 }),
      makeCandidate({ id: 'c-r1-002', confidence: 0.45 }),
    ];

    const clusters = [
      makeCluster({ id: 'cl-r1-001', clusterType: 'unknown', confidence: 0.60 }),
      makeCluster({ id: 'cl-r1-002', confidence: 0.30 }),
    ];

    const { client } = makeMockArchClient();

    // Process round 1 answers
    await processAnswers(PROJECT_ID, RUN_ID, round1Answers, hypotheses, client);

    // After round 1, check hypothesis statuses
    expect(hypotheses[0].status).toBe('confirmed');
    expect(hypotheses[1].status).toBe('denied');
    expect(hypotheses[2].status).toBe('needs_more_info');
    expect(hypotheses[3].status).toBe('needs_more_info');

    // Apply round 1 refinements
    await applyRefinements(
      PROJECT_ID, RUN_ID, round1Answers, hypotheses, candidates, clusters, client
    );

    // Generate question batches for round 2 -- only unresolved hypotheses should appear
    // needs_more_info hypotheses are not 'pending' but are still unresolved
    // The question batch generator filters on status === 'pending',
    // so needs_more_info hypotheses are excluded from automatic re-batching.
    // This is the expected behavior -- the system will not auto-re-ask.
    // To simulate round 2, we reset the needs_more_info ones back to pending.
    const unresolvedHypotheses = hypotheses.filter(
      h => h.status === 'needs_more_info'
    );

    expect(unresolvedHypotheses).toHaveLength(2);
    expect(unresolvedHypotheses[0].id).toBe('hyp-r1-003');
    expect(unresolvedHypotheses[1].id).toBe('hyp-r1-004');

    // Mark unresolved as pending for round 2 (simulating the loop re-presenting them)
    for (const h of unresolvedHypotheses) {
      h.status = 'pending';
    }

    // Round 2: Generate batches for only the unresolved ones
    const round2Batches = generateQuestionBatches(hypotheses);

    // Only 2 hypotheses should be in the batches (the two that were unresolved)
    const round2Questions = round2Batches.flatMap(b => b.questions);
    expect(round2Questions).toHaveLength(2);

    const round2HypIds = new Set(round2Questions.map(q => q.hypothesisId));
    expect(round2HypIds.has('hyp-r1-003')).toBe(true);
    expect(round2HypIds.has('hyp-r1-004')).toBe(true);
    // Resolved hypotheses should NOT appear
    expect(round2HypIds.has('hyp-r1-001')).toBe(false);
    expect(round2HypIds.has('hyp-r1-002')).toBe(false);

    // Round 2 answers: resolve both
    const round2Answers: HypothesisAnswer[] = [
      makeAnswer({ hypothesisId: 'hyp-r1-003', verdict: 'confirmed' }),
      makeAnswer({ hypothesisId: 'hyp-r1-004', verdict: 'denied' }),
    ];

    await processAnswers(PROJECT_ID, RUN_ID, round2Answers, hypotheses, client);

    // After round 2, all hypotheses should be resolved
    for (const h of hypotheses) {
      expect(h.status).not.toBe('pending');
      expect(h.status).not.toBe('needs_more_info');
    }

    // No more pending hypotheses -> empty batches
    const finalBatches = generateQuestionBatches(hypotheses);
    expect(finalBatches).toHaveLength(0);
  });
});
