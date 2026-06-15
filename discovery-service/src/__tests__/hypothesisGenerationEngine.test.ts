/**
 * Tests for Hypothesis Generation Engine (Increment 15, Task Group 2)
 *
 * 8 focused tests:
 * 1. Low-confidence rule: produces hypothesis for candidates below CANDIDATE_AUTO_ACCEPT_THRESHOLD
 * 2. Ambiguous-type rule: produces hypothesis for clusters with clusterType: 'unknown'
 * 3. Conflicting-evidence rule: produces hypothesis when a candidate has both code-sourced and log-sourced atoms
 * 4. Missing-attribute rule: produces hypothesis when candidate data payload is missing critical attributes
 * 5. Weak-cluster rule: produces hypothesis for low-confidence clusters
 * 6. Each rule returns zero hypotheses when conditions are not met (no false positives)
 * 7. Generated hypotheses have correct runId, subjectType, subjectId, and evidenceRefs populated
 * 8. Hypotheses are persisted correctly into steps_payload structure
 */

import {
  generateHypotheses,
  checkLowConfidenceCandidates,
  checkAmbiguousClusterTypes,
  checkConflictingEvidence,
  checkMissingAttributes,
  checkWeakClusters,
  persistHypotheses,
} from '../services/hypothesisGenerationEngine';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceCluster, ClusterMember } from '../types/cluster';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import { Hypothesis } from '../types/hypothesis';
import {
  CANDIDATE_AUTO_ACCEPT_THRESHOLD,
  CANDIDATE_AMBIGUOUS_THRESHOLD,
} from '../constants/candidateDefaults';

// =============================================================================
// Test Helpers
// =============================================================================

const RUN_ID = 'run-test-001';

/**
 * Builds a minimal DiscoveryCandidate for testing.
 */
function makeCandidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    id: 'candidate-001',
    runId: RUN_ID,
    candidateType: 'service',
    name: 'Test Service',
    confidence: 0.6,
    status: 'proposed',
    sourceClusterIds: ['cluster-001'],
    data: { description: 'A test service' },
    synthesizedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Builds a minimal EvidenceCluster for testing.
 */
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

/**
 * Builds a minimal EvidenceAtom for testing.
 */
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

/**
 * Builds a minimal EvidenceRelationship for testing.
 */
function makeRelationship(overrides: Partial<EvidenceRelationship> = {}): EvidenceRelationship {
  return {
    id: 'rel-001',
    runId: RUN_ID,
    sourceAtomId: 'atom-001',
    targetAtomId: 'atom-002',
    relationshipType: 'calls',
    confidence: 0.8,
    data: {
      callerSignature: 'test()',
      calleeSignature: 'handler()',
      line: 15,
    },
    inferredAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Hypothesis Generation Engine', () => {

  // ==========================================================================
  // Test 1: Low-confidence rule produces hypothesis for candidates below threshold
  // ==========================================================================
  test('checkLowConfidenceCandidates produces hypothesis for candidates below CANDIDATE_AUTO_ACCEPT_THRESHOLD', () => {
    const lowConfidenceCandidate = makeCandidate({
      id: 'candidate-low-001',
      name: 'Uncertain Service',
      confidence: CANDIDATE_AUTO_ACCEPT_THRESHOLD - 0.01, // Just below threshold
    });

    const cluster = makeCluster({
      id: 'cluster-001',
      members: [
        { memberType: 'atom', memberId: 'atom-001' },
      ],
    });

    const hypotheses = checkLowConfidenceCandidates(
      RUN_ID,
      [lowConfidenceCandidate],
      [cluster],
      [],
      []
    );

    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].category).toBe('low_confidence');
    expect(hypotheses[0].subjectType).toBe('candidate');
    expect(hypotheses[0].subjectId).toBe('candidate-low-001');
    expect(hypotheses[0].description).toContain('Uncertain Service');
    expect(hypotheses[0].description).toContain('below the auto-accept threshold');
    expect(hypotheses[0].status).toBe('pending');
    expect(hypotheses[0].runId).toBe(RUN_ID);
    // Evidence refs should include cluster and its members
    expect(hypotheses[0].evidenceRefs).toContain('cluster-001');
    expect(hypotheses[0].evidenceRefs).toContain('atom-001');
  });

  // ==========================================================================
  // Test 2: Ambiguous-type rule produces hypothesis for clusters with clusterType: 'unknown'
  // ==========================================================================
  test('checkAmbiguousClusterTypes produces hypothesis for clusters with clusterType unknown', () => {
    const unknownCluster = makeCluster({
      id: 'cluster-unknown-001',
      clusterType: 'unknown',
      name: 'Mystery Cluster',
      members: [
        { memberType: 'atom', memberId: 'atom-010' },
        { memberType: 'atom', memberId: 'atom-011' },
      ],
    });

    const typedCluster = makeCluster({
      id: 'cluster-typed-001',
      clusterType: 'service_boundary',
      name: 'Known Service Cluster',
    });

    const hypotheses = checkAmbiguousClusterTypes(
      RUN_ID,
      [],
      [unknownCluster, typedCluster],
      [],
      []
    );

    // Should only flag the unknown cluster, not the service_boundary cluster
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].category).toBe('ambiguous_type');
    expect(hypotheses[0].subjectType).toBe('cluster');
    expect(hypotheses[0].subjectId).toBe('cluster-unknown-001');
    expect(hypotheses[0].description).toContain('Mystery Cluster');
    expect(hypotheses[0].description).toContain('unknown');
    expect(hypotheses[0].evidenceRefs).toContain('cluster-unknown-001');
    expect(hypotheses[0].evidenceRefs).toContain('atom-010');
    expect(hypotheses[0].evidenceRefs).toContain('atom-011');
  });

  // ==========================================================================
  // Test 3: Conflicting-evidence rule produces hypothesis when candidate has both
  //         code-sourced and log-sourced atoms
  // ==========================================================================
  test('checkConflictingEvidence produces hypothesis when candidate has both code and log atoms', () => {
    const codeAtom = makeAtom({
      id: 'atom-code-001',
      source: 'code',
    });

    const logAtom = makeAtom({
      id: 'atom-log-001',
      source: 'log',
      logOrigin: {
        filePath: '/var/log/app.log',
        lineStart: 100,
        lineEnd: 105,
      },
    });

    const cluster = makeCluster({
      id: 'cluster-mixed-001',
      members: [
        { memberType: 'atom', memberId: 'atom-code-001' },
        { memberType: 'atom', memberId: 'atom-log-001' },
      ],
    });

    const candidate = makeCandidate({
      id: 'candidate-conflict-001',
      name: 'Conflicted Service',
      sourceClusterIds: ['cluster-mixed-001'],
    });

    const hypotheses = checkConflictingEvidence(
      RUN_ID,
      [candidate],
      [cluster],
      [codeAtom, logAtom],
      []
    );

    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].category).toBe('conflicting_evidence');
    expect(hypotheses[0].subjectType).toBe('candidate');
    expect(hypotheses[0].subjectId).toBe('candidate-conflict-001');
    expect(hypotheses[0].description).toContain('Conflicted Service');
    expect(hypotheses[0].description).toContain('code analysis');
    expect(hypotheses[0].description).toContain('log analysis');
    expect(hypotheses[0].evidenceRefs).toContain('atom-code-001');
    expect(hypotheses[0].evidenceRefs).toContain('atom-log-001');
  });

  // ==========================================================================
  // Test 4: Missing-attribute rule produces hypothesis when candidate data is missing
  //         critical attributes
  // ==========================================================================
  test('checkMissingAttributes produces hypothesis when candidate has empty name or missing description', () => {
    const missingNameCandidate = makeCandidate({
      id: 'candidate-noname-001',
      name: '',
      data: { description: 'Has description but no name' },
    });

    const missingDescCandidate = makeCandidate({
      id: 'candidate-nodesc-001',
      name: 'Has Name',
      data: {}, // No description in data payload
    });

    const completeCandidate = makeCandidate({
      id: 'candidate-complete-001',
      name: 'Complete Service',
      data: { description: 'A fully described service' },
    });

    const cluster = makeCluster({ id: 'cluster-001' });

    const hypotheses = checkMissingAttributes(
      RUN_ID,
      [missingNameCandidate, missingDescCandidate, completeCandidate],
      [cluster],
      [],
      []
    );

    // Should produce hypotheses for the two incomplete candidates, not the complete one
    expect(hypotheses).toHaveLength(2);

    const noNameHyp = hypotheses.find(h => h.subjectId === 'candidate-noname-001');
    expect(noNameHyp).toBeDefined();
    expect(noNameHyp!.category).toBe('missing_attribute');
    expect(noNameHyp!.description).toContain('missing critical attributes');
    expect(noNameHyp!.description).toContain('name');

    const noDescHyp = hypotheses.find(h => h.subjectId === 'candidate-nodesc-001');
    expect(noDescHyp).toBeDefined();
    expect(noDescHyp!.category).toBe('missing_attribute');
    expect(noDescHyp!.description).toContain('description');
  });

  // ==========================================================================
  // Test 5: Weak-cluster rule produces hypothesis for low-confidence clusters
  // ==========================================================================
  test('checkWeakClusters produces hypothesis for clusters with confidence below CANDIDATE_AMBIGUOUS_THRESHOLD', () => {
    const weakCluster = makeCluster({
      id: 'cluster-weak-001',
      name: 'Fragile Cluster',
      clusterType: 'data_domain',
      confidence: CANDIDATE_AMBIGUOUS_THRESHOLD - 0.01, // Just below threshold
      members: [
        { memberType: 'atom', memberId: 'atom-w1' },
        { memberType: 'atom', memberId: 'atom-w2' },
      ],
    });

    const strongCluster = makeCluster({
      id: 'cluster-strong-001',
      name: 'Solid Cluster',
      confidence: 0.9,
    });

    const hypotheses = checkWeakClusters(
      RUN_ID,
      [],
      [weakCluster, strongCluster],
      [],
      []
    );

    // Should only flag the weak cluster
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].category).toBe('weak_cluster');
    expect(hypotheses[0].subjectType).toBe('cluster');
    expect(hypotheses[0].subjectId).toBe('cluster-weak-001');
    expect(hypotheses[0].description).toContain('Fragile Cluster');
    expect(hypotheses[0].description).toContain('below the ambiguous threshold');
    expect(hypotheses[0].evidenceRefs).toContain('cluster-weak-001');
    expect(hypotheses[0].evidenceRefs).toContain('atom-w1');
    expect(hypotheses[0].evidenceRefs).toContain('atom-w2');
  });

  // ==========================================================================
  // Test 6: Each rule returns zero hypotheses when conditions are not met (no false positives)
  // ==========================================================================
  test('rules return zero hypotheses when conditions are not met', () => {
    // High-confidence candidate -- should NOT trigger low_confidence
    const highConfCandidate = makeCandidate({
      id: 'candidate-high-001',
      name: 'Confident Service',
      confidence: 0.95,
      data: { description: 'Well described service' },
    });

    // Typed cluster -- should NOT trigger ambiguous_type
    const typedCluster = makeCluster({
      id: 'cluster-typed-001',
      clusterType: 'service_boundary',
      confidence: 0.85,
    });

    // Only code atoms (no log atoms) -- should NOT trigger conflicting_evidence
    const codeOnlyAtom = makeAtom({
      id: 'atom-code-only-001',
      source: 'code',
    });

    const clusterForCode = makeCluster({
      id: 'cluster-001',
      members: [{ memberType: 'atom', memberId: 'atom-code-only-001' }],
    });
    highConfCandidate.sourceClusterIds = ['cluster-001'];

    // Check each rule individually
    const lowConfResult = checkLowConfidenceCandidates(
      RUN_ID, [highConfCandidate], [clusterForCode], [codeOnlyAtom], []
    );
    expect(lowConfResult).toHaveLength(0);

    const ambiguousTypeResult = checkAmbiguousClusterTypes(
      RUN_ID, [], [typedCluster], [], []
    );
    expect(ambiguousTypeResult).toHaveLength(0);

    const conflictResult = checkConflictingEvidence(
      RUN_ID, [highConfCandidate], [clusterForCode], [codeOnlyAtom], []
    );
    expect(conflictResult).toHaveLength(0);

    const missingAttrResult = checkMissingAttributes(
      RUN_ID, [highConfCandidate], [clusterForCode], [], []
    );
    expect(missingAttrResult).toHaveLength(0);

    const weakClusterResult = checkWeakClusters(
      RUN_ID, [], [typedCluster], [], []
    );
    expect(weakClusterResult).toHaveLength(0);

    // Also verify via the main generateHypotheses function
    const allHypotheses = generateHypotheses(
      RUN_ID,
      [highConfCandidate],
      [typedCluster, clusterForCode],
      [codeOnlyAtom],
      []
    );
    expect(allHypotheses).toHaveLength(0);
  });

  // ==========================================================================
  // Test 7: Generated hypotheses have correct runId, subjectType, subjectId,
  //         and evidenceRefs populated
  // ==========================================================================
  test('generateHypotheses produces hypotheses with correct runId, subjectType, subjectId, and evidenceRefs', () => {
    const candidate = makeCandidate({
      id: 'candidate-field-check-001',
      name: 'Field Check Service',
      confidence: 0.50, // Below auto-accept threshold
      sourceClusterIds: ['cluster-field-001'],
      data: {}, // Missing description
    });

    const cluster = makeCluster({
      id: 'cluster-field-001',
      clusterType: 'unknown', // Ambiguous type
      confidence: 0.20, // Below ambiguous threshold
      members: [
        { memberType: 'atom', memberId: 'atom-f1' },
      ],
    });

    const codeAtom = makeAtom({ id: 'atom-f1', source: 'code' });
    const logAtom = makeAtom({ id: 'atom-f2', source: 'log' });

    // Add log atom to cluster to trigger conflicting evidence
    cluster.members.push({ memberType: 'atom', memberId: 'atom-f2' });

    const allHypotheses = generateHypotheses(
      RUN_ID,
      [candidate],
      [cluster],
      [codeAtom, logAtom],
      []
    );

    // Should produce hypotheses for: low_confidence, ambiguous_type, conflicting_evidence,
    // missing_attribute (no description), weak_cluster
    expect(allHypotheses.length).toBeGreaterThanOrEqual(4);

    for (const hypothesis of allHypotheses) {
      // Every hypothesis must have runId set correctly
      expect(hypothesis.runId).toBe(RUN_ID);

      // Every hypothesis must have a valid UUID id
      expect(hypothesis.id).toBeTruthy();
      expect(typeof hypothesis.id).toBe('string');

      // Every hypothesis must have a valid subjectType
      expect(['candidate', 'cluster']).toContain(hypothesis.subjectType);

      // Every hypothesis must have a non-empty subjectId
      expect(hypothesis.subjectId).toBeTruthy();

      // Every hypothesis must have evidenceRefs as a non-empty array
      expect(Array.isArray(hypothesis.evidenceRefs)).toBe(true);
      expect(hypothesis.evidenceRefs.length).toBeGreaterThan(0);

      // Every hypothesis must have status 'pending'
      expect(hypothesis.status).toBe('pending');

      // Every hypothesis must have a createdAt timestamp
      expect(hypothesis.createdAt).toBeTruthy();

      // Every hypothesis must have a valid category
      expect([
        'low_confidence',
        'ambiguous_type',
        'conflicting_evidence',
        'missing_attribute',
        'weak_cluster',
      ]).toContain(hypothesis.category);
    }

    // Verify candidate-targeted hypotheses reference the correct subject
    const candidateHypotheses = allHypotheses.filter(h => h.subjectType === 'candidate');
    for (const h of candidateHypotheses) {
      expect(h.subjectId).toBe('candidate-field-check-001');
    }

    // Verify cluster-targeted hypotheses reference the correct subject
    const clusterHypotheses = allHypotheses.filter(h => h.subjectType === 'cluster');
    for (const h of clusterHypotheses) {
      expect(h.subjectId).toBe('cluster-field-001');
    }
  });

  // ==========================================================================
  // Test 8: Hypotheses are persisted correctly into steps_payload structure
  // ==========================================================================
  test('persistHypotheses stores hypotheses in steps_payload.hypothesisQa.hypotheses', async () => {
    const existingPayload = {
      '1a': { status: 'completed', atomCounts: { file_structure: 10 } },
      '1b': { status: 'completed' },
      '1c': { status: 'completed' },
      '1d': { status: 'completed' },
    };

    const mockRun = {
      id: RUN_ID,
      project_id: 'project-001',
      service_id: null,
      status: 'COMPLETED',
      steps_payload: existingPayload,
    };

    let savedPayload: object | undefined;

    const mockArchModelClient = {
      getDiscoveryRun: jest.fn().mockResolvedValue(mockRun),
      updateDiscoveryRun: jest.fn().mockImplementation(
        (_projectId: string, _runId: string, payload: { steps_payload?: object }) => {
          savedPayload = payload.steps_payload;
          return Promise.resolve(mockRun);
        }
      ),
    };

    const hypotheses: Hypothesis[] = [
      {
        id: 'hyp-persist-001',
        runId: RUN_ID,
        category: 'low_confidence',
        subjectType: 'candidate',
        subjectId: 'candidate-001',
        description: 'Low confidence candidate',
        evidenceRefs: ['cluster-001', 'atom-001'],
        status: 'pending',
        createdAt: '2026-04-06T10:00:00Z',
      },
      {
        id: 'hyp-persist-002',
        runId: RUN_ID,
        category: 'ambiguous_type',
        subjectType: 'cluster',
        subjectId: 'cluster-001',
        description: 'Unknown cluster type',
        evidenceRefs: ['cluster-001'],
        status: 'pending',
        createdAt: '2026-04-06T10:00:00Z',
      },
    ];

    await persistHypotheses('project-001', RUN_ID, hypotheses, mockArchModelClient);

    // Verify getDiscoveryRun was called
    expect(mockArchModelClient.getDiscoveryRun).toHaveBeenCalledWith('project-001', RUN_ID);

    // Verify updateDiscoveryRun was called
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenCalledWith(
      'project-001',
      RUN_ID,
      expect.objectContaining({
        steps_payload: expect.any(Object),
      })
    );

    // Verify the saved payload structure
    expect(savedPayload).toBeDefined();
    const payload = savedPayload as Record<string, unknown>;

    // Existing step results should be preserved
    expect(payload['1a']).toEqual({ status: 'completed', atomCounts: { file_structure: 10 } });
    expect(payload['1b']).toEqual({ status: 'completed' });
    expect(payload['1c']).toEqual({ status: 'completed' });
    expect(payload['1d']).toEqual({ status: 'completed' });

    // Hypothesis QA data should be stored under hypothesisQa key
    const hypothesisQa = payload.hypothesisQa as Record<string, unknown>;
    expect(hypothesisQa).toBeDefined();
    expect(hypothesisQa.hypotheses).toEqual(hypotheses);
    expect(hypothesisQa.hypothesisCount).toBe(2);
    expect(hypothesisQa.generatedAt).toBeTruthy();
  });
});
