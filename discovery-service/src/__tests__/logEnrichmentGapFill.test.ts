/**
 * Log Enrichment Gap-Fill Tests (Task Group 7)
 *
 * Strategic tests filling critical coverage gaps identified during
 * review of Task Groups 1-6. These tests focus on integration points
 * and edge cases not covered by the 34 existing tests.
 *
 * Up to 10 additional tests maximum per spec requirements.
 *
 * Gap 1: parseLogContent convenience function (format detection + parsing in one call)
 * Gap 2: Empty log content (0 lines) handled gracefully
 * Gap 3: Reprocessing background flow: COMPLETED -> RUNNING -> COMPLETED status transitions
 * Gap 4: Reprocessing failure flow: COMPLETED -> RUNNING -> FAILED status transitions
 * Gap 5: End-to-end ingestion flow: content in, atoms persisted with correct source/logOrigin
 * Gap 6: Mixed atom coexistence: code atoms + log atoms in same cluster get confidence boost
 * Gap 7: Log content at exactly the size limit boundary (accepted, not rejected)
 * Gap 8: Cluster triage does NOT boost when all atoms are code-sourced (regression guard)
 */

// =============================================================================
// Tests 1-2: parseLogContent convenience function and empty content
// =============================================================================

import { parseLogContent } from '../services/logParsing';

describe('parseLogContent convenience function', () => {
  // Gap 1: parseLogContent performs format detection + parsing in one call
  test('parseLogContent auto-detects JSON lines format and returns parsed entries', () => {
    const content = [
      '{"timestamp":"2024-01-15T10:00:00Z","level":"INFO","message":"Server started","port":8080}',
      '{"timestamp":"2024-01-15T10:00:01Z","level":"DEBUG","message":"Config loaded"}',
      '{"timestamp":"2024-01-15T10:00:02Z","level":"ERROR","message":"Connection failed","host":"db-1"}',
    ].join('\n');

    const result = parseLogContent(content);

    expect(result.format).toBe('json_lines');
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].message).toBe('Server started');
    expect(result.entries[0].level).toBe('INFO');
    expect(result.entries[0].timestamp).toBe('2024-01-15T10:00:00Z');
    expect(result.entries[1].message).toBe('Config loaded');
    expect(result.entries[2].message).toBe('Connection failed');
    expect(result.entries[2].metadata).toEqual({ host: 'db-1' });
  });

  // Gap 2: Empty log content (0 lines) handled gracefully
  test('parseLogContent handles empty content gracefully with zero entries', () => {
    const result = parseLogContent('');

    expect(result.format).toBe('unknown');
    expect(result.entries).toHaveLength(0);
  });
});

// =============================================================================
// Tests 3-7: Route integration with background processing and edge cases
// =============================================================================

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-gap-fill'),
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

// Mock executeStep1b + executeStepLlmAnalysis from runManager. The reprocess
// route now runs step 1b then 1c-llm-analysis (executeStepLlmAnalysis), which
// replaced the legacy 1c clustering + 1d candidate-generation steps.
const mockExecuteStep1b = jest.fn();
const mockExecuteStepLlmAnalysis = jest.fn();

jest.mock('../services/runManager', () => {
  const actual = jest.requireActual('../services/runManager');
  return {
    ...actual,
    executeStep1b: mockExecuteStep1b,
    executeStepLlmAnalysis: mockExecuteStepLlmAnalysis,
  };
});

// Mock fs.readFile
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue('mock log content'),
}));

import express from 'express';
import request from 'supertest';
import { discoveryRouter } from '../routes';

const PROJECT_ID = 'proj-gap-001';
const RUN_ID = 'run-gap-001';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use('/discovery', discoveryRouter);
  return app;
}

describe('Log Enrichment Route Integration (Gap Fill)', () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteStep1b.mockResolvedValue({ status: 'completed' });
    mockExecuteStepLlmAnalysis.mockResolvedValue({ status: 'completed' });
  });

  // Gap 3: Reprocessing background flow - verify status transitions
  test('POST /discovery/reprocess transitions run status COMPLETED -> RUNNING -> COMPLETED on success', async () => {
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

    // Allow the fire-and-forget async to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify status transitions: first call sets RUNNING with step 1b
    expect(mockUpdateDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({ status: 'RUNNING', current_step: '1b' })
    );

    // Verify both reprocess steps ran in order: 1b then 1c-llm-analysis.
    expect(mockExecuteStep1b).toHaveBeenCalledWith(PROJECT_ID, RUN_ID);
    expect(mockExecuteStepLlmAnalysis).toHaveBeenCalledWith(PROJECT_ID, RUN_ID);

    // Verify final status is COMPLETED
    const finalUpdateCall = mockUpdateDiscoveryRun.mock.calls.find(
      (call: any[]) => call[2]?.status === 'COMPLETED'
    );
    expect(finalUpdateCall).toBeDefined();
    expect(finalUpdateCall![2]).toEqual({ status: 'COMPLETED', current_step: null });
  });

  // Gap 4: Reprocessing failure flow - verify FAILED status on error
  test('POST /discovery/reprocess transitions run status to FAILED when step execution fails', async () => {
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
    mockExecuteStep1b.mockRejectedValue(new Error('Step 1b database connection lost'));

    const res = await request(app)
      .post('/discovery/reprocess')
      .send({ projectId: PROJECT_ID, runId: RUN_ID });

    expect(res.status).toBe(202);

    // Allow the fire-and-forget async to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify initial status transition to RUNNING
    expect(mockUpdateDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({ status: 'RUNNING', current_step: '1b' })
    );

    // Verify step 1b was called (and failed)
    expect(mockExecuteStep1b).toHaveBeenCalledWith(PROJECT_ID, RUN_ID);

    // Verify 1c-llm-analysis was NOT called (the 1b failure aborted the sequence)
    expect(mockExecuteStepLlmAnalysis).not.toHaveBeenCalled();

    // Verify status was set to FAILED with error message
    const failedUpdateCall = mockUpdateDiscoveryRun.mock.calls.find(
      (call: any[]) => call[2]?.status === 'FAILED'
    );
    expect(failedUpdateCall).toBeDefined();
    expect(failedUpdateCall![2]).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        current_step: null,
        error_message: 'Step 1b database connection lost',
      })
    );
  });

  // Gap 5: End-to-end ingestion flow - atoms persisted with correct source and logOrigin
  test('POST /discovery/log-enrichment persists atoms with source:"log" and valid logOrigin metadata', async () => {
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
      '2024-01-15 10:30:45.123 [main] INFO com.example.App - Handling GET /api/users/123',
      '2024-01-15 10:30:45.456 [main] ERROR com.example.Db - SELECT * FROM users WHERE id = 123',
      '2024-01-15 10:30:45.789 [main] WARN com.example.Net - Calling https://auth-service:8443/validate',
    ].join('\n');

    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, logContent });

    expect(res.status).toBe(200);
    expect(res.body.atomsExtracted).toBeGreaterThan(0);
    expect(res.body.formatDetected).toBe('framework_pattern');
    expect(res.body.linesProcessed).toBe(3);

    // Verify bulkSaveEvidence was called with atoms having source: "log"
    expect(mockBulkSaveEvidence).toHaveBeenCalled();
    const savedAtoms = mockBulkSaveEvidence.mock.calls[0][2];
    expect(savedAtoms.length).toBeGreaterThan(0);

    // Every persisted atom must have source: "log"
    for (const atom of savedAtoms) {
      expect(atom.source).toBe('log');
      expect(atom.logOrigin).toBeDefined();
      expect(typeof atom.logOrigin.filePath).toBe('string');
      expect(typeof atom.logOrigin.lineStart).toBe('number');
      expect(typeof atom.logOrigin.lineEnd).toBe('number');
    }
  });

  // Gap 7: Log content at exactly the size limit boundary
  test('POST /discovery/log-enrichment accepts content at exactly LOG_MAX_LINE_COUNT lines', async () => {
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

    // Create content with exactly 500,000 lines (the limit)
    // Using short lines to avoid hitting the byte limit
    const lines = new Array(500_000).fill('log line');
    const logContent = lines.join('\n');

    const res = await request(app)
      .post('/discovery/log-enrichment')
      .send({ projectId: PROJECT_ID, runId: RUN_ID, logContent });

    // Should be accepted (exactly at the limit, not exceeding it)
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('atomsExtracted');
    expect(res.body).toHaveProperty('formatDetected');
  });
});

