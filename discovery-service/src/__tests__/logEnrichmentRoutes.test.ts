/**
 * Log Enrichment Route Tests (Task Group 4)
 *
 * 8 focused tests covering:
 * 1. POST /discovery/log-enrichment succeeds with valid logContent, returns summary
 * 2. POST /discovery/log-enrichment rejects when run is not in COMPLETED status (400)
 * 3. POST /discovery/log-enrichment rejects when neither logFilePath nor logContent provided (400)
 * 4. POST /discovery/log-enrichment rejects content exceeding LOG_MAX_CONTENT_SIZE_BYTES (413)
 * 5. POST /discovery/log-enrichment rejects content exceeding LOG_MAX_LINE_COUNT (413)
 * 6. POST /discovery/reprocess returns 202 Accepted immediately
 * 7. POST /discovery/reprocess rejects when run status is RUNNING (409)
 * 8. POST /discovery/reprocess rejects when run does not exist (404)
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-log-enrichment'),
}));

// Mock the archModelClient module
const mockGetDiscoveryRun = jest.fn();
const mockUpdateDiscoveryRun = jest.fn();
const mockBulkSaveEvidence = jest.fn();

jest.mock('../services/archModelClient', () => {
  return {
    archModelClient: {
      getDiscoveryRun: mockGetDiscoveryRun,
      updateDiscoveryRun: mockUpdateDiscoveryRun,
      bulkSaveEvidence: mockBulkSaveEvidence,
      createDiscoveryRun: jest.fn(),
      getDiscoveryConfig: jest.fn(),
      getEvidenceByRun: jest.fn(),
      getEvidenceCount: jest.fn(),
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn(),
      getRelationshipCount: jest.fn(),
      bulkSaveClusters: jest.fn(),
      getClustersByRun: jest.fn(),
      getClusterCount: jest.fn(),
      deleteClustersByRunId: jest.fn(),
      bulkSaveCandidates: jest.fn(),
      getCandidatesByRun: jest.fn(),
      getCandidateCount: jest.fn(),
      updateCandidate: jest.fn(),
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

// Mock executeStep1b, executeStep1c, executeStep1d from runManager
const mockExecuteStep1b = jest.fn().mockResolvedValue({ status: 'completed' });
const mockExecuteStep1c = jest.fn().mockResolvedValue({ status: 'completed' });
const mockExecuteStep1d = jest.fn().mockResolvedValue({ status: 'completed' });

jest.mock('../services/runManager', () => {
  const actual = jest.requireActual('../services/runManager');
  return {
    ...actual,
    executeStep1b: mockExecuteStep1b,
    executeStep1c: mockExecuteStep1c,
    executeStep1d: mockExecuteStep1d,
  };
});

// Mock fs.readFile for logFilePath tests (not used in these 8 tests but imported by route)
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue('mock log content'),
}));

import express from 'express';
import request from 'supertest';
import { discoveryRouter } from '../routes';

const PROJECT_ID = 'proj-001';
const RUN_ID = 'run-001';

function createTestApp() {
  const app = express();
  // Body-parser limit is intentionally ABOVE LOG_MAX_CONTENT_SIZE_BYTES (100MB)
  // so an oversized payload reaches the route's own size guard (which returns a
  // 413 carrying a descriptive error.message). At/under the route constant,
  // body-parser would 413 first with a bare PayloadTooLargeError (no body).
  app.use(express.json({ limit: '200mb' }));
  app.use('/discovery', discoveryRouter);
  return app;
}

describe('Log Enrichment Routes', () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Log Ingestion: POST /discovery/log-enrichment
  // --------------------------------------------------------------------------

  test('POST /discovery/log-enrichment succeeds with valid logContent, returns summary with atomsExtracted, formatDetected, linesProcessed', async () => {
    // Mock run exists and is COMPLETED
    mockGetDiscoveryRun.mockResolvedValue({
      id: RUN_ID,
      project_id: PROJECT_ID,
      service_id: null,
      status: 'COMPLETED',
      current_step: null,
      config_snapshot: { repoUrl: 'https://github.com/example/repo' },
      steps_payload: {},
      error_message: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });
    mockBulkSaveEvidence.mockResolvedValue(undefined);

    const logContent = [
      'GET /api/users/123 returned 200 in 45ms',
      'POST /api/orders completed successfully',
      'SELECT * FROM users WHERE id = 123',
    ].join('\n');

    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, logContent });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('atomsExtracted');
    expect(res.body).toHaveProperty('formatDetected');
    expect(res.body).toHaveProperty('linesProcessed');
    expect(res.body).toHaveProperty('atomsByType');
    expect(typeof res.body.atomsExtracted).toBe('number');
    expect(typeof res.body.formatDetected).toBe('string');
    expect(res.body.linesProcessed).toBe(3);
  });

  test('POST /discovery/log-enrichment rejects when run is not in COMPLETED status (400)', async () => {
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

    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, logContent: 'some log content' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('COMPLETED');
  });

  test('POST /discovery/log-enrichment rejects when neither logFilePath nor logContent is provided (400)', async () => {
    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('logFilePath');
  });

  test('POST /discovery/log-enrichment rejects content exceeding LOG_MAX_CONTENT_SIZE_BYTES (413)', async () => {
    // Create content just over the LOG_MAX_CONTENT_SIZE_BYTES cap (100MB).
    const oversizedContent = 'x'.repeat(100 * 1024 * 1024 + 1);

    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, logContent: oversizedContent });

    expect(res.status).toBe(413);
    expect(res.body.error.message).toContain('size');
  });

  test('POST /discovery/log-enrichment rejects content exceeding LOG_MAX_LINE_COUNT (413)', async () => {
    // Create content with 500,001 lines
    const lines = new Array(500_001).fill('log line').join('\n');

    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, logContent: lines });

    expect(res.status).toBe(413);
    expect(res.body.error.message).toContain('line');
  });

  // --------------------------------------------------------------------------
  // Reprocessing: POST /discovery/reprocess
  // --------------------------------------------------------------------------

  test('POST /discovery/reprocess returns 202 Accepted immediately', async () => {
    mockGetDiscoveryRun.mockResolvedValue({
      id: RUN_ID,
      project_id: PROJECT_ID,
      service_id: null,
      status: 'COMPLETED',
      current_step: null,
      config_snapshot: {},
      steps_payload: {},
      error_message: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });
    mockUpdateDiscoveryRun.mockResolvedValue({});

    const res = await request(app)
      .post('/discovery/reprocess')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.message).toContain('Reprocessing started');
  });

  test('POST /discovery/reprocess rejects when run status is RUNNING (409)', async () => {
    mockGetDiscoveryRun.mockResolvedValue({
      id: RUN_ID,
      project_id: PROJECT_ID,
      service_id: null,
      status: 'RUNNING',
      current_step: '1b',
      config_snapshot: {},
      steps_payload: {},
      error_message: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });

    const res = await request(app)
      .post('/discovery/reprocess')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('RUNNING');
  });

  test('POST /discovery/reprocess rejects when run does not exist (404)', async () => {
    mockGetDiscoveryRun.mockResolvedValue(null);

    const res = await request(app)
      .post('/discovery/reprocess')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('not found');
  });
});
