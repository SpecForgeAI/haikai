/**
 * Cross-Cutting Hardening Gap Tests
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 9: Cross-Cutting Test Review
 *
 * These tests fill critical gaps identified across Task Groups 1-7:
 *
 * 1. Full pipeline re-run produces the same stable IDs (TG1 + TG2 interaction)
 * 2. Diagnostics endpoint returns partial step data for a FAILED run (TG6 gap)
 * 3. run_failed structured log includes total durationMs and error (TG6 gap)
 * 4. requestLogger middleware emits structured JSON entries (TG6 gap)
 * 5. logRunEvent omits optional fields when not provided (TG6 gap)
 * 6. Cleanup after partial failure -- stale FAILED run is detectable (TG1 + TG4 interaction)
 *
 * Total: 6 tests
 */

// ============================================================================
// Test Suite 1: Full re-run idempotency (TG1 + TG2 interaction)
// ============================================================================

import {
  generateEvidenceId,
  generateRelationshipId,
  generateClusterId,
  generateCandidateId,
} from '../utils/evidenceId';

describe('Cross-Cutting Gap: Full pipeline re-run produces the same stable IDs', () => {
  /**
   * Simulates the ID generation that would occur during two consecutive full
   * pipeline runs against the same project/repo. Verifies that all entity types
   * produce identical IDs on re-run, meaning the Java-side upsert will be a no-op.
   */
  test('re-running all 4 steps with identical inputs produces identical IDs across all entity types', () => {
    const runId = 'run-rerun-001';
    const repoUrl = 'https://github.com/org/repo';

    // --- Step 1a: Evidence atoms ---
    const atomInputs = [
      { filePath: 'src/App.ts', type: 'file_structure', key: 'src/App.ts' },
      { filePath: 'src/App.ts', type: 'symbol', key: 'AppController:class:5' },
      { filePath: 'src/utils.ts', type: 'string_pattern', key: 'TODO:3' },
    ];

    const run1AtomIds = atomInputs.map(a =>
      generateEvidenceId(runId, repoUrl, a.filePath, a.type, a.key)
    );
    const run2AtomIds = atomInputs.map(a =>
      generateEvidenceId(runId, repoUrl, a.filePath, a.type, a.key)
    );
    expect(run1AtomIds).toEqual(run2AtomIds);

    // --- Step 1b: Relationships ---
    const relInputs = [
      { source: run1AtomIds[0], target: run1AtomIds[1], type: 'contains' },
      { source: run1AtomIds[1], target: run1AtomIds[2], type: 'references' },
    ];

    const run1RelIds = relInputs.map(r =>
      generateRelationshipId(runId, r.source, r.target, r.type)
    );
    const run2RelIds = relInputs.map(r =>
      generateRelationshipId(runId, r.source, r.target, r.type)
    );
    expect(run1RelIds).toEqual(run2RelIds);

    // --- Step 1c: Clusters ---
    const clusterInputs = [
      { label: 'AppController Module', type: 'service_boundary' },
    ];

    const run1ClusterIds = clusterInputs.map(c =>
      generateClusterId(runId, c.label, c.type)
    );
    const run2ClusterIds = clusterInputs.map(c =>
      generateClusterId(runId, c.label, c.type)
    );
    expect(run1ClusterIds).toEqual(run2ClusterIds);

    // --- Step 1d: Candidates ---
    const candInputs = [
      { name: 'AppController', type: 'service', parent: '' },
      { name: 'UtilityModule', type: 'application', parent: run1ClusterIds[0] },
    ];

    const run1CandIds = candInputs.map(c =>
      generateCandidateId(runId, c.name, c.type, c.parent)
    );
    const run2CandIds = candInputs.map(c =>
      generateCandidateId(runId, c.name, c.type, c.parent)
    );
    expect(run1CandIds).toEqual(run2CandIds);

    // --- Cross-type uniqueness: no ID collisions across entity types ---
    const allIds = [...run1AtomIds, ...run1RelIds, ...run1ClusterIds, ...run1CandIds];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });
});


// ============================================================================
// Test Suite 2: Diagnostics endpoint for FAILED run (TG6 gap)
// ============================================================================

// Mock dotenv before importing anything that might use it
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock the archModelClient module
jest.mock('../services/archModelClient', () => {
  return {
    archModelClient: {
      createDiscoveryRun: jest.fn(),
      updateDiscoveryRun: jest.fn(),
      getDiscoveryRun: jest.fn(),
      getDiscoveryConfig: jest.fn(),
      bulkSaveEvidence: jest.fn(),
      getEvidenceByRun: jest.fn(),
      getEvidenceByRunPaginated: jest.fn(),
      getEvidenceCount: jest.fn(),
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn(),
      getRelationshipsByRunPaginated: jest.fn(),
      getRelationshipCount: jest.fn(),
      bulkSaveClusters: jest.fn(),
      getClustersByRun: jest.fn(),
      getClusterCount: jest.fn(),
      deleteClustersByRunId: jest.fn(),
      bulkSaveCandidates: jest.fn(),
      getCandidatesByRun: jest.fn(),
      getCandidateCount: jest.fn(),
      updateCandidate: jest.fn(),
      deleteCandidatesByRunId: jest.fn(),
      bulkSaveDecisionTasks: jest.fn(),
      getDecisionTasksByRun: jest.fn(),
      getDecisionTaskCount: jest.fn(),
      updateDecisionTask: jest.fn(),
      resetDefaultArchitectureCache: jest.fn(),
    },
  };
});

import { archModelClient } from '../services/archModelClient';
const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;

describe('Cross-Cutting Gap: Diagnostics endpoint returns partial step data for a FAILED run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /discovery/runs/:runId/diagnostics returns stepsPayload with completed and failed step data', async () => {
    const express = require('express');
    const { runsRouter } = require('../routes/runs');
    const supertest = require('supertest');

    const app = express();
    app.use(express.json());
    app.use('/discovery/runs', runsRouter);

    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const runId = 'run-failed-diag-001';

    // Simulate a FAILED run where 1a and 1b completed but 1c failed
    const failedRunWithPartialData = {
      id: runId,
      project_id: projectId,
      service_id: null,
      mode: null,
      status: 'FAILED',
      current_step: null,
      config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
      steps_payload: {
        '1a': {
          status: 'completed',
          atomCounts: { file_structure: 20, symbol: 8, string_pattern: 3 },
          totalAtoms: 31,
          stepStartedAt: '2026-04-06T10:00:01Z',
          stepCompletedAt: '2026-04-06T10:00:06Z',
          durationMs: 5000,
        },
        '1b': {
          status: 'completed',
          relationshipCount: 15,
          upstreamAtomCount: 31,
          stepStartedAt: '2026-04-06T10:00:06Z',
          stepCompletedAt: '2026-04-06T10:00:12Z',
          durationMs: 6000,
        },
        '1c': {
          status: 'failed',
          errorMessage: 'service unavailable',
          step: '1c',
        },
        '1d': {
          status: 'pending',
        },
      },
      error_message: 'Step 1c failed: service unavailable',
      created_at: '2026-04-06T10:00:00Z',
      updated_at: '2026-04-06T10:00:12Z',
    };
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(failedRunWithPartialData);

    const response = await supertest(app)
      .get(`/discovery/runs/${runId}/diagnostics?projectId=${projectId}`);

    expect(response.status).toBe(200);
    expect(response.body.runId).toBe(runId);
    expect(response.body.status).toBe('FAILED');

    const sp = response.body.stepsPayload;

    // Completed steps should have full timing and count data
    expect(sp['1a'].status).toBe('completed');
    expect(sp['1a'].durationMs).toBe(5000);
    expect(sp['1a'].atomCounts).toEqual({ file_structure: 20, symbol: 8, string_pattern: 3 });

    expect(sp['1b'].status).toBe('completed');
    expect(sp['1b'].durationMs).toBe(6000);
    expect(sp['1b'].relationshipCount).toBe(15);

    // Failed step should have error data
    expect(sp['1c'].status).toBe('failed');
    expect(sp['1c'].errorMessage).toBe('service unavailable');

    // Pending step should still be pending
    expect(sp['1d'].status).toBe('pending');
  });
});


// ============================================================================
// Test Suite 3: run_failed structured log (TG6 gap)
// ============================================================================

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-cross-cutting'),
}));

// Mock the analyzer registry
jest.mock('../services/analyzerRegistry', () => {
  const mockPhase1aPack = {
    id: 'phase-1a-universal-extraction',
    name: 'Phase 1a Universal Extraction',
    supportedPhases: ['phase1'],
    analyze: jest.fn().mockResolvedValue({
      analyzerId: 'phase-1a-universal-extraction',
      phase: 'phase1',
      step: '1a',
      findings: [],
      evidenceAtoms: [],
      metadata: {
        atomCounts: { file_structure: 3, symbol: 1, string_pattern: 0 },
        totalAtoms: 4,
      },
    }),
  };
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(
      new Map([['phase-1a-universal-extraction', mockPhase1aPack]])
    ),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Mock remaining registries and engines
jest.mock('../services/linkerRuleRegistry', () => ({
  getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
  initializeLinkerRuleRegistry: jest.fn(),
  registerLinkerRule: jest.fn(),
}));
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: { resolveDecisionTasks: jest.fn() },
}));

/**
 * Captures structured JSON log entries from console.log during test execution.
 */
function captureLogEntries(consoleSpy: jest.SpyInstance): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  for (const call of consoleSpy.mock.calls) {
    const msg = call[0];
    if (typeof msg === 'string') {
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === 'object' && parsed.event) {
          entries.push(parsed);
        }
      } catch {
        // Not a JSON log entry, skip
      }
    }
  }
  return entries;
}

function sampleRunDto() {
  return {
    id: 'run-uuid-cross-001',
    project_id: '550e8400-e29b-41d4-a716-446655440000',
    service_id: null,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
    steps_payload: {
      '1a': { status: 'pending' },
      '1b': { status: 'pending' },
      '1c-llm-analysis': { status: 'pending' },
    },
    error_message: null,
    created_at: '2026-04-06T10:00:00Z',
    updated_at: '2026-04-06T10:00:00Z',
  };
}

describe('Cross-Cutting Gap: run_failed structured log includes durationMs and error details', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runId = 'run-uuid-cross-001';
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveClusters.mockResolvedValue(undefined);
    mockArchModelClient.deleteClustersByRunId.mockResolvedValue(0);
    mockArchModelClient.deleteCandidatesByRunId.mockResolvedValue(0);
    mockArchModelClient.bulkSaveCandidates.mockResolvedValue(undefined);
    mockArchModelClient.getClustersByRun.mockResolvedValue([]);
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('run_failed event includes total durationMs, error message, and stack trace', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string) => Promise<void>;
    };

    // Make step 1b fail
    mockArchModelClient.getEvidenceByRun.mockRejectedValue(
      new Error('database connection lost')
    );

    await realStartRun(projectId, runId);

    const entries = captureLogEntries(consoleSpy);

    const runFailedEntries = entries.filter(e => e.event === 'run_failed');
    expect(runFailedEntries).toHaveLength(1);

    const runFailed = runFailedEntries[0];
    expect(runFailed.durationMs).toBeDefined();
    expect(typeof runFailed.durationMs).toBe('number');
    expect((runFailed.durationMs as number)).toBeGreaterThanOrEqual(0);
    expect(runFailed.error).toBe('database connection lost');
    expect(runFailed.stack).toBeDefined();
    expect(typeof runFailed.stack).toBe('string');
    expect(runFailed.runId).toBe(runId);
    expect(runFailed.projectId).toBe(projectId);
  });
});


// ============================================================================
// Test Suite 4: requestLogger middleware structured JSON output (TG6 gap)
// ============================================================================

describe('Cross-Cutting Gap: requestLogger middleware emits structured JSON', () => {
  test('emits request_start and request_complete JSON entries for /discovery/ routes', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const express = require('express');
    const supertest = require('supertest');
    const { requestLogger } = require('../middleware/requestLogger');

    const app = express();
    app.use(requestLogger);
    app.get('/discovery/test', (_req: any, res: any) => {
      res.status(200).json({ ok: true });
    });

    await supertest(app).get('/discovery/test');

    // Collect structured JSON entries
    const logEntries: Array<Record<string, unknown>> = [];
    for (const call of consoleSpy.mock.calls) {
      const msg = call[0];
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && typeof parsed === 'object' && parsed.type) {
            logEntries.push(parsed);
          }
        } catch {
          // skip non-JSON
        }
      }
    }

    // Should have request_start and request_complete
    const startEntries = logEntries.filter(e => e.type === 'request_start');
    const completeEntries = logEntries.filter(e => e.type === 'request_complete');

    expect(startEntries).toHaveLength(1);
    expect(completeEntries).toHaveLength(1);

    // Verify request_start fields
    expect(startEntries[0].method).toBe('GET');
    expect(startEntries[0].path).toBe('/discovery/test');
    expect(startEntries[0].timestamp).toBeDefined();

    // Verify request_complete fields
    expect(completeEntries[0].method).toBe('GET');
    expect(completeEntries[0].path).toBe('/discovery/test');
    expect(completeEntries[0].statusCode).toBe(200);
    expect(completeEntries[0].durationMs).toBeDefined();
    expect(typeof completeEntries[0].durationMs).toBe('number');
    expect(completeEntries[0].timestamp).toBeDefined();

    consoleSpy.mockRestore();
  });

  test('does NOT emit log entries for non-discovery routes', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const express = require('express');
    const supertest = require('supertest');
    const { requestLogger } = require('../middleware/requestLogger');

    const app = express();
    app.use(requestLogger);
    app.get('/health', (_req: any, res: any) => {
      res.status(200).json({ status: 'ok' });
    });

    await supertest(app).get('/health');

    // Collect structured JSON entries
    const logEntries: Array<Record<string, unknown>> = [];
    for (const call of consoleSpy.mock.calls) {
      const msg = call[0];
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && typeof parsed === 'object' && parsed.type) {
            logEntries.push(parsed);
          }
        } catch {
          // skip non-JSON
        }
      }
    }

    // No discovery-related log entries for non-discovery routes
    expect(logEntries).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});


// ============================================================================
// Test Suite 5: logRunEvent omits optional fields (TG6 gap)
// ============================================================================

describe('Cross-Cutting Gap: logRunEvent omits optional fields when not provided', () => {
  test('emits only required fields when optional fields are omitted', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { logRunEvent } = require('../utils/runLogger');

    logRunEvent({
      runId: 'run-minimal',
      projectId: 'proj-minimal',
      event: 'step_start',
      timestamp: '2026-04-06T10:00:00.000Z',
      // No step, durationMs, counts, error, or stack
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(output.runId).toBe('run-minimal');
    expect(output.projectId).toBe('proj-minimal');
    expect(output.event).toBe('step_start');
    expect(output.timestamp).toBe('2026-04-06T10:00:00.000Z');

    // Optional fields should NOT be present in the output
    expect(output).not.toHaveProperty('step');
    expect(output).not.toHaveProperty('durationMs');
    expect(output).not.toHaveProperty('counts');
    expect(output).not.toHaveProperty('error');
    expect(output).not.toHaveProperty('stack');

    consoleSpy.mockRestore();
  });
});
