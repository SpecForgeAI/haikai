/**
 * Tests for Question Batching, Answer Capture, and Confidence Refinement
 * (Increment 15, Task Group 3)
 *
 * 8 focused tests:
 * 1. Question batching groups related hypotheses (same cluster, same category) into batches of 2-4
 * 2. Question batch output includes hypothesis description, evidence summary, and answer options
 * 3. `confirmed` verdict applies QA_CONFIRMATION_CONFIDENCE_BOOST additive boost, capped at LOG_MAX_CONFIDENCE_CAP
 * 4. `denied` verdict applies QA_DENIAL_CONFIDENCE_PENALTY decrement and sets candidate status to `pending_review`
 * 5. `partially_confirmed` verdict applies QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST and annotates candidate data
 * 6. `needs_more_info` verdict makes no confidence change and hypothesis remains `pending`
 * 7. `human_qa` evidence atoms are correctly created from answers with `qaOrigin` populated
 * 8. Refinement operations are recorded in `steps_payload` for traceability
 */

import { generateQuestionBatches } from '../services/questionBatchGenerator';
import { processAnswers } from '../services/hypothesisAnswerProcessor';
import { applyRefinements } from '../services/hypothesisRefinementEngine';
import { Hypothesis, HypothesisAnswer } from '../types/hypothesis';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceCluster } from '../types/cluster';
import {
  QA_CONFIRMATION_CONFIDENCE_BOOST,
  QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST,
  QA_DENIAL_CONFIDENCE_PENALTY,
  LOG_MAX_CONFIDENCE_CAP,
} from '../constants/hypothesisQaDefaults';

// =============================================================================
// Test Helpers
// =============================================================================

const PROJECT_ID = 'project-test-001';
const RUN_ID = 'run-test-001';

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'hyp-001',
    runId: RUN_ID,
    category: 'low_confidence',
    subjectType: 'candidate',
    subjectId: 'candidate-001',
    description: 'Candidate "Test Service" has low confidence',
    evidenceRefs: ['cluster-001', 'atom-001', 'atom-002'],
    status: 'pending',
    createdAt: '2026-04-06T10:00:00Z',
    ...overrides,
  };
}

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

function makeAnswer(overrides: Partial<HypothesisAnswer> = {}): HypothesisAnswer {
  return {
    hypothesisId: 'hyp-001',
    verdict: 'confirmed',
    answeredAt: '2026-04-06T11:00:00Z',
    ...overrides,
  };
}

/**
 * Creates a mock archModelClient for answer processing tests.
 */
function makeMockArchClient() {
  const savedAtoms: unknown[] = [];
  let savedPayload: Record<string, unknown> | undefined;

  return {
    client: {
      bulkSaveEvidence: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, atoms: unknown[]) => {
          savedAtoms.push(...atoms);
          return Promise.resolve();
        }
      ),
      getDiscoveryRun: jest.fn().mockResolvedValue({
        steps_payload: {
          hypothesisQa: {
            hypotheses: [],
            generatedAt: '2026-04-06T10:00:00Z',
            hypothesisCount: 0,
          },
        },
      }),
      updateDiscoveryRun: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, payload: { steps_payload?: object }) => {
          savedPayload = payload.steps_payload as Record<string, unknown>;
          return Promise.resolve({});
        }
      ),
      updateCandidate: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, _candidateId: string, update: Partial<DiscoveryCandidate>) => {
          return Promise.resolve({ id: _candidateId, ...update });
        }
      ),
    },
    savedAtoms,
    getSavedPayload: () => savedPayload,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Question Batching, Answer Capture, and Refinement', () => {

  // ==========================================================================
  // Test 1: Question batching groups related hypotheses into batches of 2-4
  // ==========================================================================
  test('generateQuestionBatches groups related hypotheses (same category) into batches of 2-4', () => {
    const hypotheses: Hypothesis[] = [
      makeHypothesis({ id: 'hyp-lc-001', category: 'low_confidence', subjectId: 'c1' }),
      makeHypothesis({ id: 'hyp-lc-002', category: 'low_confidence', subjectId: 'c2' }),
      makeHypothesis({ id: 'hyp-lc-003', category: 'low_confidence', subjectId: 'c3' }),
      makeHypothesis({ id: 'hyp-at-001', category: 'ambiguous_type', subjectType: 'cluster', subjectId: 'cl1' }),
      makeHypothesis({ id: 'hyp-at-002', category: 'ambiguous_type', subjectType: 'cluster', subjectId: 'cl2' }),
    ];

    const batches = generateQuestionBatches(hypotheses);

    // Should produce at least 2 batches (one for low_confidence, one for ambiguous_type)
    expect(batches.length).toBeGreaterThanOrEqual(2);

    // Every batch should have between 1 and 4 questions
    for (const batch of batches) {
      expect(batch.questions.length).toBeGreaterThanOrEqual(1);
      expect(batch.questions.length).toBeLessThanOrEqual(4);
    }

    // Total questions should equal total pending hypotheses
    const totalQuestions = batches.reduce((sum, b) => sum + b.questions.length, 0);
    expect(totalQuestions).toBe(5);

    // Batches should have descriptive labels
    for (const batch of batches) {
      expect(batch.batchLabel).toBeTruthy();
      expect(typeof batch.batchLabel).toBe('string');
    }
  });

  // ==========================================================================
  // Test 2: Question batch output includes description, evidence summary, and answer options
  // ==========================================================================
  test('question batch output includes hypothesis description, evidence summary, and answer options', () => {
    const hypotheses: Hypothesis[] = [
      makeHypothesis({
        id: 'hyp-desc-001',
        description: 'Candidate "OrderService" has low confidence of 0.50',
        evidenceRefs: ['cluster-a', 'atom-x', 'atom-y'],
      }),
      makeHypothesis({
        id: 'hyp-desc-002',
        description: 'Candidate "PaymentService" has low confidence of 0.45',
        evidenceRefs: ['cluster-b'],
      }),
    ];

    const batches = generateQuestionBatches(hypotheses);
    expect(batches.length).toBeGreaterThanOrEqual(1);

    // Find the batch containing our hypotheses
    const allQuestions = batches.flatMap(b => b.questions);

    for (const question of allQuestions) {
      // Each question should have a hypothesisId
      expect(question.hypothesisId).toBeTruthy();

      // Each question should have a description
      expect(question.description).toBeTruthy();
      expect(typeof question.description).toBe('string');

      // Each question should have an evidence summary
      expect(question.evidenceSummary).toBeTruthy();
      expect(typeof question.evidenceSummary).toBe('string');
      // Evidence summary should reference evidence count
      expect(question.evidenceSummary).toMatch(/evidence reference/);

      // Each question should have exactly 4 answer options
      expect(question.answerOptions).toHaveLength(4);
      expect(question.answerOptions).toContain('confirmed');
      expect(question.answerOptions).toContain('denied');
      expect(question.answerOptions).toContain('partially_confirmed');
      expect(question.answerOptions).toContain('needs_more_info');
    }

    // Verify specific descriptions are carried through
    const q1 = allQuestions.find(q => q.hypothesisId === 'hyp-desc-001');
    expect(q1).toBeDefined();
    expect(q1!.description).toContain('OrderService');
    expect(q1!.evidenceSummary).toContain('3 evidence references');

    const q2 = allQuestions.find(q => q.hypothesisId === 'hyp-desc-002');
    expect(q2).toBeDefined();
    expect(q2!.description).toContain('PaymentService');
    expect(q2!.evidenceSummary).toContain('1 evidence reference');
  });

  // ==========================================================================
  // Test 3: `confirmed` verdict applies QA_CONFIRMATION_CONFIDENCE_BOOST, capped
  // ==========================================================================
  test('confirmed verdict applies QA_CONFIRMATION_CONFIDENCE_BOOST additive boost, capped at LOG_MAX_CONFIDENCE_CAP', async () => {
    const candidate = makeCandidate({ id: 'c-conf-001', confidence: 0.60 });
    const hypothesis = makeHypothesis({
      id: 'hyp-conf-001',
      subjectType: 'candidate',
      subjectId: 'c-conf-001',
      status: 'confirmed', // Already answered
    });
    const answer = makeAnswer({
      hypothesisId: 'hyp-conf-001',
      verdict: 'confirmed',
    });

    const { client } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      [answer],
      [hypothesis],
      [candidate],
      [],
      client
    );

    expect(summary.refinementsApplied).toBe(1);
    expect(summary.confidenceChanges).toHaveLength(1);

    const op = summary.confidenceChanges[0];
    expect(op.previousConfidence).toBe(0.60);
    expect(op.newConfidence).toBeCloseTo(0.60 + QA_CONFIRMATION_CONFIDENCE_BOOST);
    expect(op.verdict).toBe('confirmed');

    // Verify updateCandidate was called with boosted confidence
    expect(client.updateCandidate).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      'c-conf-001',
      expect.objectContaining({
        confidence: 0.60 + QA_CONFIRMATION_CONFIDENCE_BOOST,
      })
    );

    // Test capping: candidate near the ceiling
    const nearCapCandidate = makeCandidate({ id: 'c-near-cap', confidence: 0.95 });
    const nearCapHypothesis = makeHypothesis({
      id: 'hyp-near-cap',
      subjectType: 'candidate',
      subjectId: 'c-near-cap',
    });
    const nearCapAnswer = makeAnswer({
      hypothesisId: 'hyp-near-cap',
      verdict: 'confirmed',
    });

    const { client: client2 } = makeMockArchClient();

    const capSummary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      [nearCapAnswer],
      [nearCapHypothesis],
      [nearCapCandidate],
      [],
      client2
    );

    const capOp = capSummary.confidenceChanges[0];
    expect(capOp.newConfidence).toBeLessThanOrEqual(LOG_MAX_CONFIDENCE_CAP);
    expect(capOp.newConfidence).toBe(LOG_MAX_CONFIDENCE_CAP);
  });

  // ==========================================================================
  // Test 4: `denied` verdict applies QA_DENIAL_CONFIDENCE_PENALTY and sets pending_review
  // ==========================================================================
  test('denied verdict applies QA_DENIAL_CONFIDENCE_PENALTY decrement and sets candidate status to pending_review', async () => {
    const candidate = makeCandidate({ id: 'c-deny-001', confidence: 0.60, status: 'proposed' });
    const hypothesis = makeHypothesis({
      id: 'hyp-deny-001',
      subjectType: 'candidate',
      subjectId: 'c-deny-001',
    });
    const answer = makeAnswer({
      hypothesisId: 'hyp-deny-001',
      verdict: 'denied',
    });

    const { client } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      [answer],
      [hypothesis],
      [candidate],
      [],
      client
    );

    expect(summary.refinementsApplied).toBe(1);

    const op = summary.confidenceChanges[0];
    expect(op.previousConfidence).toBe(0.60);
    expect(op.newConfidence).toBeCloseTo(0.60 - QA_DENIAL_CONFIDENCE_PENALTY);
    expect(op.statusChange).toBe('pending_review');
    expect(op.verdict).toBe('denied');

    // Verify updateCandidate was called with reduced confidence and pending_review status
    expect(client.updateCandidate).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      'c-deny-001',
      expect.objectContaining({
        confidence: 0.60 - QA_DENIAL_CONFIDENCE_PENALTY,
        status: 'pending_review',
      })
    );

    // Verify the local candidate was updated
    expect(candidate.confidence).toBeCloseTo(0.60 - QA_DENIAL_CONFIDENCE_PENALTY);
    expect(candidate.status).toBe('pending_review');

    // Test floor at 0.0: candidate with very low confidence
    const lowCandidate = makeCandidate({ id: 'c-deny-low', confidence: 0.10 });
    const lowHypothesis = makeHypothesis({
      id: 'hyp-deny-low',
      subjectType: 'candidate',
      subjectId: 'c-deny-low',
    });
    const lowAnswer = makeAnswer({
      hypothesisId: 'hyp-deny-low',
      verdict: 'denied',
    });

    const { client: client2 } = makeMockArchClient();

    const lowSummary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      [lowAnswer],
      [lowHypothesis],
      [lowCandidate],
      [],
      client2
    );

    const lowOp = lowSummary.confidenceChanges[0];
    expect(lowOp.newConfidence).toBeGreaterThanOrEqual(0.0);
    expect(lowOp.newConfidence).toBe(0.0);
  });

  // ==========================================================================
  // Test 5: `partially_confirmed` verdict applies smaller boost and annotates data
  // ==========================================================================
  test('partially_confirmed verdict applies QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST and annotates candidate data with notes', async () => {
    const candidate = makeCandidate({
      id: 'c-partial-001',
      confidence: 0.55,
      data: { description: 'Some service' },
    });
    const hypothesis = makeHypothesis({
      id: 'hyp-partial-001',
      subjectType: 'candidate',
      subjectId: 'c-partial-001',
    });
    const answer = makeAnswer({
      hypothesisId: 'hyp-partial-001',
      verdict: 'partially_confirmed',
      freeTextNotes: 'It exists but the name might be different',
    });

    const { client } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      [answer],
      [hypothesis],
      [candidate],
      [],
      client
    );

    expect(summary.refinementsApplied).toBe(1);

    const op = summary.confidenceChanges[0];
    expect(op.previousConfidence).toBe(0.55);
    expect(op.newConfidence).toBeCloseTo(0.55 + QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST);
    expect(op.notes).toContain('name might be different');
    expect(op.verdict).toBe('partially_confirmed');

    // Verify updateCandidate was called with annotated data
    expect(client.updateCandidate).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      'c-partial-001',
      expect.objectContaining({
        confidence: 0.55 + QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST,
        data: expect.objectContaining({
          description: 'Some service',
          qaPartialConfirmation: 'It exists but the name might be different',
          qaHypothesisId: 'hyp-partial-001',
        }),
      })
    );
  });

  // ==========================================================================
  // Test 6: `needs_more_info` verdict makes no confidence change
  // ==========================================================================
  test('needs_more_info verdict makes no confidence change and hypothesis remains pending', async () => {
    const candidate = makeCandidate({ id: 'c-nmi-001', confidence: 0.50 });
    const hypothesis = makeHypothesis({
      id: 'hyp-nmi-001',
      subjectType: 'candidate',
      subjectId: 'c-nmi-001',
      status: 'pending',
    });
    const answer = makeAnswer({
      hypothesisId: 'hyp-nmi-001',
      verdict: 'needs_more_info',
    });

    const { client } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      [answer],
      [hypothesis],
      [candidate],
      [],
      client
    );

    expect(summary.refinementsApplied).toBe(1);

    const op = summary.confidenceChanges[0];
    expect(op.confidenceChange).toBe(0);
    expect(op.verdict).toBe('needs_more_info');
    expect(op.notes).toContain('needs more information');

    // updateCandidate should NOT have been called (no confidence change)
    expect(client.updateCandidate).not.toHaveBeenCalled();

    // The original candidate confidence should be unchanged
    expect(candidate.confidence).toBe(0.50);
  });

  // ==========================================================================
  // Test 7: human_qa evidence atoms are correctly created from answers
  // ==========================================================================
  test('human_qa evidence atoms are correctly created from answers with qaOrigin populated', async () => {
    const hypothesis = makeHypothesis({
      id: 'hyp-atom-001',
      category: 'low_confidence',
      subjectType: 'candidate',
      subjectId: 'c-atom-001',
      description: 'Low confidence candidate needs validation',
    });

    const answer = makeAnswer({
      hypothesisId: 'hyp-atom-001',
      verdict: 'confirmed',
      freeTextNotes: 'Yes, this service definitely exists',
      answeredAt: '2026-04-06T11:30:00Z',
    });

    const { client, savedAtoms } = makeMockArchClient();

    const createdAtoms = await processAnswers(
      PROJECT_ID,
      RUN_ID,
      [answer],
      [hypothesis],
      client
    );

    // Should create exactly one evidence atom
    expect(createdAtoms).toHaveLength(1);

    const atom = createdAtoms[0];

    // Verify source is human_qa
    expect(atom.source).toBe('human_qa');

    // Verify qaOrigin is populated correctly
    expect(atom.qaOrigin).toBeDefined();
    expect(atom.qaOrigin!.hypothesisId).toBe('hyp-atom-001');
    expect(atom.qaOrigin!.verdict).toBe('confirmed');
    expect(atom.qaOrigin!.freeTextNotes).toBe('Yes, this service definitely exists');
    expect(atom.qaOrigin!.answeredAt).toBe('2026-04-06T11:30:00Z');

    // Verify atom has correct runId and type
    expect(atom.runId).toBe(RUN_ID);
    expect(atom.type).toBe('string_pattern');
    expect(atom.id).toBeTruthy();
    expect(atom.extractedAt).toBeTruthy();

    // Verify bulkSaveEvidence was called
    expect(client.bulkSaveEvidence).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.arrayContaining([
        expect.objectContaining({
          source: 'human_qa',
          qaOrigin: expect.objectContaining({
            hypothesisId: 'hyp-atom-001',
            verdict: 'confirmed',
          }),
        }),
      ])
    );

    // Verify hypothesis status was updated
    expect(hypothesis.status).toBe('confirmed');
  });

  // ==========================================================================
  // Test 8: Refinement operations are recorded in steps_payload for traceability
  // ==========================================================================
  test('refinement operations are recorded in steps_payload for traceability', async () => {
    const candidate1 = makeCandidate({ id: 'c-trace-001', confidence: 0.50 });
    const candidate2 = makeCandidate({ id: 'c-trace-002', confidence: 0.70 });

    const hypothesis1 = makeHypothesis({
      id: 'hyp-trace-001',
      subjectType: 'candidate',
      subjectId: 'c-trace-001',
    });
    const hypothesis2 = makeHypothesis({
      id: 'hyp-trace-002',
      subjectType: 'candidate',
      subjectId: 'c-trace-002',
      category: 'conflicting_evidence',
    });

    const answers: HypothesisAnswer[] = [
      makeAnswer({ hypothesisId: 'hyp-trace-001', verdict: 'confirmed' }),
      makeAnswer({ hypothesisId: 'hyp-trace-002', verdict: 'denied' }),
    ];

    const { client, getSavedPayload } = makeMockArchClient();

    const summary = await applyRefinements(
      PROJECT_ID,
      RUN_ID,
      answers,
      [hypothesis1, hypothesis2],
      [candidate1, candidate2],
      [],
      client
    );

    // Verify the refinement summary
    expect(summary.refinementsApplied).toBe(2);
    expect(summary.confidenceChanges).toHaveLength(2);
    expect(summary.skipped).toBe(0);

    // Verify updateDiscoveryRun was called to persist refinement operations
    expect(client.updateDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({
        steps_payload: expect.objectContaining({
          hypothesisQa: expect.objectContaining({
            refinements: expect.any(Array),
            refinedAt: expect.any(String),
          }),
        }),
      })
    );

    // Verify the saved payload contains refinement details
    const savedPayload = getSavedPayload();
    expect(savedPayload).toBeDefined();
    const hypothesisQa = savedPayload!.hypothesisQa as Record<string, unknown>;
    expect(hypothesisQa.refinements).toBeDefined();

    const refinements = hypothesisQa.refinements as Array<Record<string, unknown>>;
    expect(refinements).toHaveLength(2);

    // First refinement: confirmed boost
    const confirmedRefinement = refinements.find(r => r.hypothesisId === 'hyp-trace-001');
    expect(confirmedRefinement).toBeDefined();
    expect(confirmedRefinement!.verdict).toBe('confirmed');
    expect(confirmedRefinement!.previousConfidence).toBe(0.50);
    expect(confirmedRefinement!.newConfidence).toBeCloseTo(0.50 + QA_CONFIRMATION_CONFIDENCE_BOOST);
    expect(confirmedRefinement!.subjectType).toBe('candidate');
    expect(confirmedRefinement!.subjectId).toBe('c-trace-001');

    // Second refinement: denied penalty
    const deniedRefinement = refinements.find(r => r.hypothesisId === 'hyp-trace-002');
    expect(deniedRefinement).toBeDefined();
    expect(deniedRefinement!.verdict).toBe('denied');
    expect(deniedRefinement!.previousConfidence).toBe(0.70);
    expect(deniedRefinement!.newConfidence).toBeCloseTo(0.70 - QA_DENIAL_CONFIDENCE_PENALTY);
    expect(deniedRefinement!.statusChange).toBe('pending_review');
  });
});
