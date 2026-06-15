/**
 * Hypothesis Q&A Route Tests (Task Group 4)
 *
 * 6 focused tests covering:
 * 1. POST /discovery/hypothesis-qa/generate returns 400 if required fields (projectId, runId) are missing
 * 2. POST /discovery/hypothesis-qa/generate returns 400 if run is not COMPLETED
 * 3. POST /discovery/hypothesis-qa/generate succeeds and returns hypothesis summary for a valid completed run
 * 4. POST /discovery/hypothesis-qa/refine returns 400 if required fields are missing
 * 5. POST /discovery/hypothesis-qa/refine succeeds, applies refinements, and returns refinement summary
 * 6. Generate endpoint persists hypotheses to steps_payload and refine endpoint updates candidate confidence
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-hypothesis-qa'),
}));

// Mock the archModelClient module
const mockGetDiscoveryRun = jest.fn();
const mockUpdateDiscoveryRun = jest.fn();
const mockBulkSaveEvidence = jest.fn();
const mockGetCandidatesByRun = jest.fn();
const mockGetClustersByRun = jest.fn();
const mockGetEvidenceByRun = jest.fn();
const mockUpdateCandidate = jest.fn();

jest.mock('../services/archModelClient', () => {
  return {
    archModelClient: {
      getDiscoveryRun: mockGetDiscoveryRun,
      updateDiscoveryRun: mockUpdateDiscoveryRun,
      bulkSaveEvidence: mockBulkSaveEvidence,
      createDiscoveryRun: jest.fn(),
      getDiscoveryConfig: jest.fn(),
      getEvidenceByRun: mockGetEvidenceByRun,
      getEvidenceCount: jest.fn(),
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn(),
      getRelationshipCount: jest.fn(),
      bulkSaveClusters: jest.fn(),
      getClustersByRun: mockGetClustersByRun,
      getClusterCount: jest.fn(),
      deleteClustersByRunId: jest.fn(),
      bulkSaveCandidates: jest.fn(),
      getCandidatesByRun: mockGetCandidatesByRun,
      getCandidateCount: jest.fn(),
      updateCandidate: mockUpdateCandidate,
      deleteCandidatesByRunId: jest.fn(),
      bulkSaveDecisionTasks: jest.fn(),
      getDecisionTasksByRun: jest.fn(),
      getDecisionTaskCount: jest.fn(),
      updateDecisionTask: jest.fn(),
    },
  };
});

// Mock the gateway client (needed by runManager imports)
jest.mock('../services/gatewayClient', () => {
  return {
    gatewayClient: {
      resolveDecisionTasks: jest.fn(),
    },
  };
});

// Mock the analyzer registry (needed by runManager imports)
jest.mock('../services/analyzerRegistry', () => {
  const mockPack = {
    id: 'phase-1a-universal-extraction',
    name: 'Phase 1a Universal Extraction',
    supportedPhases: ['phase1'],
    analyze: jest.fn().mockResolvedValue({
      analyzerId: 'phase-1a-universal-extraction',
      phase: 'phase1',
      step: '1a',
      findings: [],
      evidenceAtoms: [],
      metadata: { atomCounts: { file_structure: 0, symbol: 0, string_pattern: 0 }, totalAtoms: 0 },
    }),
  };
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(
      new Map([['phase-1a-universal-extraction', mockPack]])
    ),
    initializeAnalyzerRegistry: jest.fn(),
  };
});

// Mock fs.readFile (imported indirectly by logEnrichment route)
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue('mock log content'),
}));

import express from 'express';
import request from 'supertest';
import { discoveryRouter } from '../routes';

const PROJECT_ID = 'proj-qa-001';
const RUN_ID = 'run-qa-001';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use('/discovery', discoveryRouter);
  return app;
}

/**
 * Helper: creates a mock completed discovery run response.
 */
function mockCompletedRun(stepsPayload: object = {}) {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    service_id: null,
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: { repoUrl: 'https://github.com/example/repo' },
    steps_payload: stepsPayload,
    error_message: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

/**
 * Helper: creates a mock candidate with configurable confidence.
 */
function mockCandidate(id: string, confidence: number, name = 'TestCandidate') {
  return {
    id,
    runId: RUN_ID,
    candidateType: 'service',
    name,
    confidence,
    status: 'proposed',
    sourceClusterIds: ['cluster-001'],
    data: { description: 'A test candidate' },
    synthesizedAt: '2024-01-01T00:00:00Z',
  };
}

/**
 * Helper: creates a mock cluster.
 */
function mockCluster(id: string, clusterType = 'service_boundary', confidence = 0.8) {
  return {
    id,
    runId: RUN_ID,
    clusterType,
    name: 'TestCluster',
    confidence,
    members: [
      { memberType: 'atom', memberId: 'atom-001' },
    ],
    data: {},
    formedAt: '2024-01-01T00:00:00Z',
  };
}

/**
 * Helper: creates a mock evidence atom.
 */
function mockAtom(id: string, source: 'code' | 'log' = 'code') {
  return {
    id,
    runId: RUN_ID,
    repoUrl: 'https://github.com/example/repo',
    filePath: 'src/test.ts',
    type: 'string_pattern',
    data: {
      patternName: 'test_pattern',
      matchedText: 'test',
      line: 1,
      contextSnippet: 'test context',
    },
    extractedAt: '2024-01-01T00:00:00Z',
    source,
  };
}

describe('Hypothesis Q&A Routes', () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Generate: POST /discovery/hypothesis-qa/generate
  // --------------------------------------------------------------------------

  test('POST /discovery/hypothesis-qa/generate returns 400 if required fields (projectId, runId) are missing', async () => {
    // Missing both projectId and runId
    const res1 = await request(app)
      .post('/discovery/hypothesis-qa/generate')
      .send({});

    expect(res1.status).toBe(400);
    expect(res1.body.error.message).toContain('projectId');

    // Missing runId
    const res2 = await request(app)
      .post('/discovery/hypothesis-qa/generate')
      .send({ projectId: PROJECT_ID });

    expect(res2.status).toBe(400);
    expect(res2.body.error.message).toContain('runId');
  });

  test('POST /discovery/hypothesis-qa/generate returns 400/404 if run does not exist or is not COMPLETED', async () => {
    // Run does not exist: 404
    mockGetDiscoveryRun.mockResolvedValue(null);

    const res1 = await request(app)
      .post('/discovery/hypothesis-qa/generate')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res1.status).toBe(404);
    expect(res1.body.error.message).toContain('not found');

    // Run exists but is RUNNING: 400
    mockGetDiscoveryRun.mockResolvedValue({
      id: RUN_ID,
      project_id: PROJECT_ID,
      service_id: null,
      status: 'RUNNING',
      current_step: '1a',
      config_snapshot: {},
      steps_payload: {},
      error_message: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });

    const res2 = await request(app)
      .post('/discovery/hypothesis-qa/generate')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res2.status).toBe(400);
    expect(res2.body.error.message).toContain('COMPLETED');
  });

  test('POST /discovery/hypothesis-qa/generate succeeds and returns hypothesis summary for a valid completed run', async () => {
    // Set up a completed run with a low-confidence candidate to trigger a hypothesis
    const lowConfidenceCandidate = mockCandidate('cand-001', 0.40, 'WeakService');
    const cluster = mockCluster('cluster-001');
    const atom = mockAtom('atom-001');

    mockGetDiscoveryRun.mockResolvedValue(mockCompletedRun());
    mockGetCandidatesByRun.mockResolvedValue([lowConfidenceCandidate]);
    mockGetClustersByRun.mockResolvedValue([cluster]);
    mockGetEvidenceByRun.mockResolvedValue([atom]);
    mockUpdateDiscoveryRun.mockResolvedValue({});

    const res = await request(app)
      .post('/discovery/hypothesis-qa/generate')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hypothesisCount');
    expect(res.body).toHaveProperty('categoryCounts');
    expect(res.body).toHaveProperty('hypotheses');
    expect(typeof res.body.hypothesisCount).toBe('number');
    expect(res.body.hypothesisCount).toBeGreaterThan(0);
    expect(Array.isArray(res.body.hypotheses)).toBe(true);

    // Verify at least one low_confidence hypothesis was generated
    expect(res.body.categoryCounts).toHaveProperty('low_confidence');
    expect(res.body.categoryCounts.low_confidence).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Refine: POST /discovery/hypothesis-qa/refine
  // --------------------------------------------------------------------------

  test('POST /discovery/hypothesis-qa/refine returns 400 if required fields are missing', async () => {
    // Missing all required fields
    const res1 = await request(app)
      .post('/discovery/hypothesis-qa/refine')
      .send({});

    expect(res1.status).toBe(400);
    expect(res1.body.error.message).toContain('projectId');

    // Missing answers
    const res2 = await request(app)
      .post('/discovery/hypothesis-qa/refine')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res2.status).toBe(400);
    expect(res2.body.error.message).toContain('answers');

    // Empty answers array
    const res3 = await request(app)
      .post('/discovery/hypothesis-qa/refine')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, answers: [] });

    expect(res3.status).toBe(400);
    expect(res3.body.error.message).toContain('answers');
  });

  test('POST /discovery/hypothesis-qa/refine succeeds, applies refinements, and returns refinement summary', async () => {
    const hypothesisId = 'hyp-001';
    const candidateId = 'cand-001';

    // Mock run with hypotheses already generated in steps_payload
    const stepsPayload = {
      hypothesisQa: {
        hypotheses: [
          {
            id: hypothesisId,
            runId: RUN_ID,
            category: 'low_confidence',
            subjectType: 'candidate',
            subjectId: candidateId,
            description: 'Candidate has low confidence',
            evidenceRefs: ['atom-001'],
            status: 'pending',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        generatedAt: '2024-01-01T00:00:00Z',
        hypothesisCount: 1,
      },
    };

    mockGetDiscoveryRun.mockResolvedValue(mockCompletedRun(stepsPayload));
    mockBulkSaveEvidence.mockResolvedValue(undefined);
    mockUpdateDiscoveryRun.mockResolvedValue({});
    mockGetCandidatesByRun.mockResolvedValue([
      mockCandidate(candidateId, 0.40, 'WeakService'),
    ]);
    mockGetClustersByRun.mockResolvedValue([mockCluster('cluster-001')]);
    mockUpdateCandidate.mockResolvedValue({
      ...mockCandidate(candidateId, 0.52, 'WeakService'),
    });

    const answers = [
      {
        hypothesisId,
        verdict: 'confirmed',
        freeTextNotes: 'Yes, this service exists.',
        answeredAt: '2024-01-02T00:00:00Z',
      },
    ];

    const res = await request(app)
      .post('/discovery/hypothesis-qa/refine')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, answers });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('refinementsApplied');
    expect(res.body).toHaveProperty('confidenceChanges');
    expect(res.body).toHaveProperty('atomsCreated');
    expect(typeof res.body.refinementsApplied).toBe('number');
    expect(res.body.refinementsApplied).toBeGreaterThan(0);
    expect(typeof res.body.atomsCreated).toBe('number');
    expect(res.body.atomsCreated).toBeGreaterThan(0);
  });

  test('Generate endpoint persists hypotheses to steps_payload and refine endpoint updates candidate confidence', async () => {
    // --- Part 1: Generate ---
    const candidateId = 'cand-persist-001';
    const lowConfidenceCandidate = mockCandidate(candidateId, 0.35, 'PersistTestService');
    const cluster = mockCluster('cluster-persist-001');
    const atom = mockAtom('atom-persist-001');

    mockGetDiscoveryRun.mockResolvedValue(mockCompletedRun());
    mockGetCandidatesByRun.mockResolvedValue([lowConfidenceCandidate]);
    mockGetClustersByRun.mockResolvedValue([cluster]);
    mockGetEvidenceByRun.mockResolvedValue([atom]);
    mockUpdateDiscoveryRun.mockResolvedValue({});

    const genRes = await request(app)
      .post('/discovery/hypothesis-qa/generate')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(genRes.status).toBe(200);
    expect(genRes.body.hypothesisCount).toBeGreaterThan(0);

    // Verify persistHypotheses was called: updateDiscoveryRun should have been called
    // with steps_payload containing hypothesisQa.hypotheses
    expect(mockUpdateDiscoveryRun).toHaveBeenCalled();
    const persistCall = mockUpdateDiscoveryRun.mock.calls.find(
      (call: any[]) => call[2]?.steps_payload?.hypothesisQa?.hypotheses
    );
    expect(persistCall).toBeDefined();
    const persistedHypotheses = persistCall![2].steps_payload.hypothesisQa.hypotheses;
    expect(Array.isArray(persistedHypotheses)).toBe(true);
    expect(persistedHypotheses.length).toBeGreaterThan(0);

    // --- Part 2: Refine ---
    jest.clearAllMocks();

    const hypothesisId = persistedHypotheses[0].id;

    // Mock run with persisted hypotheses
    const stepsPayloadWithHypotheses = {
      hypothesisQa: {
        hypotheses: persistedHypotheses,
        generatedAt: '2024-01-01T00:00:00Z',
        hypothesisCount: persistedHypotheses.length,
      },
    };

    mockGetDiscoveryRun.mockResolvedValue(mockCompletedRun(stepsPayloadWithHypotheses));
    mockBulkSaveEvidence.mockResolvedValue(undefined);
    mockUpdateDiscoveryRun.mockResolvedValue({});
    mockGetCandidatesByRun.mockResolvedValue([lowConfidenceCandidate]);
    mockGetClustersByRun.mockResolvedValue([cluster]);
    mockUpdateCandidate.mockResolvedValue({
      ...lowConfidenceCandidate,
      confidence: 0.47, // 0.35 + 0.12 boost
    });

    const answers = [
      {
        hypothesisId,
        verdict: 'confirmed',
        freeTextNotes: 'Confirmed it exists',
        answeredAt: '2024-01-02T00:00:00Z',
      },
    ];

    const refineRes = await request(app)
      .post('/discovery/hypothesis-qa/refine')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, answers });

    expect(refineRes.status).toBe(200);
    expect(refineRes.body.refinementsApplied).toBeGreaterThan(0);

    // Verify updateCandidate was called with a confidence boost
    expect(mockUpdateCandidate).toHaveBeenCalled();
    const updateCall = mockUpdateCandidate.mock.calls[0];
    expect(updateCall[0]).toBe(PROJECT_ID);
    expect(updateCall[1]).toBe(RUN_ID);
    expect(updateCall[2]).toBe(candidateId);
    // The confidence should be boosted from 0.35 by QA_CONFIRMATION_CONFIDENCE_BOOST (0.12) = 0.47
    expect(updateCall[3].confidence).toBeCloseTo(0.47, 2);
  });
});
