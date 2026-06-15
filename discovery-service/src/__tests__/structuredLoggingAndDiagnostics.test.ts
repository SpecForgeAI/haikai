/**
 * Tests for Structured Logging, Diagnostics Endpoint, and Request Logger
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 6: Structured Logging, Diagnostics Endpoint, and Request Logger
 *
 * 6 focused tests covering:
 * 1. startRun emits structured JSON log entries with runId, projectId, step, event, timestamp
 * 2. step_start and step_complete events include correct step identifier
 * 3. step_failed event includes error message and stack trace
 * 4. run_complete event includes total durationMs
 * 5. Each step log entry includes durationMs (wall-clock timing)
 * 6. GET /discovery/runs/:runId/diagnostics returns stepsPayload with timing and counts
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-logging-test'),
}));

// Mock the archModelClient module with all methods needed by run manager
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
      // Methods added to archModelClient by committed specs that startRun /
      // the V3 pipeline now call. Defaults take the graceful/no-op path so
      // these structured-logging timing tests stay focused on the run loop.
      resetDefaultArchitectureCache: jest.fn(),
      getModel: jest.fn().mockResolvedValue(null),
      getProject: jest.fn().mockResolvedValue(null),
      bulkCreateDiscoveryFindings: jest.fn().mockResolvedValue([]),
    },
  };
});

// Mock the gateway client module
jest.mock('../services/gatewayClient', () => {
  return {
    gatewayClient: {
      resolveDecisionTasks: jest.fn(),
    },
  };
});

// Mock the repo-access seam so step `1c-llm-analysis` does NOT perform a real
// `git clone` of the fixture repo URL (which would fail on the network and turn
// 1c into a step_failed). These structured-logging tests only care about the
// run loop's start/complete/run_complete events, not a real clone.
jest.mock('../services/repoAccess', () => ({
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  buildTempDir: jest.fn(() => '/tmp/structured-logging-mock-repo'),
  isGitRepoUrl: jest.fn(() => true),
  normalizeRepoLocation: jest.fn((v: string) => v),
  normalizeRepoSubfolder: jest.fn((v: string) => v),
}));

// Mock the LLM file-analysis step so 1c completes without invoking a real LLM.
// Empty atoms -> zero candidates / findings, so the downstream persist + emit
// paths no-op and 1c reaches step_complete.
jest.mock('../services/llmFileAnalysisStep', () => ({
  executeLlmFileAnalysis: jest.fn().mockResolvedValue({
    candidates: [],
    filesAnalyzed: 0,
    filesFailed: 0,
    evidenceCount: 0,
    findingInputs: [],
  }),
  sortCandidatesParentsFirst: jest.fn((c: unknown[]) => c),
}));

// Mock the analyzer registry so that 1a uses a mock pack returning atoms
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
        atomCounts: { file_structure: 10, symbol: 5, string_pattern: 2 },
        totalAtoms: 17,
      },
    }),
  };
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(
      new Map([
        ['phase-1a-universal-extraction', mockPhase1aPack],
      ])
    ),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Mock the linker rule registry with empty registry
jest.mock('../services/linkerRuleRegistry', () => {
  return {
    getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
    initializeLinkerRuleRegistry: jest.fn(),
    registerLinkerRule: jest.fn(),
  };
});


import { archModelClient } from '../services/archModelClient';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;

/**
 * Sample run DTO shape returned by archModelClient.
 */
function sampleRunDto() {
  return {
    id: 'run-uuid-log-001',
    project_id: '550e8400-e29b-41d4-a716-446655440000',
    service_id: null,
    // V3 pipeline tier column (Spec: V3 Discovery Pipeline Foundation); now a
    // required field on DiscoveryRunResponseDto. Null for these pre-tier fixtures.
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
    steps_payload: {
      '1a': { status: 'pending' },
      '1b': { status: 'pending' },
      '1c': { status: 'pending' },
      '1d': { status: 'pending' },
    },
    error_message: null,
    created_at: '2026-04-06T10:00:00Z',
    updated_at: '2026-04-06T10:00:00Z',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepsPayload = Record<string, { status: string; [key: string]: any }>;

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

describe('Structured Logging and Diagnostics (TG6)', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runId = 'run-uuid-log-001';
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Default mock returns
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

  // ==========================================================================
  // Test 1: startRun emits structured JSON log entries with runId, projectId,
  //         step, event, timestamp
  // ==========================================================================
  test('startRun emits structured JSON log entries with runId, projectId, step, event, timestamp', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string) => Promise<void>;
    };

    await realStartRun(projectId, runId);

    const entries = captureLogEntries(consoleSpy);

    // Should have at least step_start and step_complete for each of the 3 steps
    // plus a run_complete entry. The V3 pipeline runs 3 steps:
    // ['1a', '1b', '1c-llm-analysis'] (the legacy 1c clustering + 1d candidate
    // generation steps were folded into 1c-llm-analysis).
    expect(entries.length).toBeGreaterThanOrEqual(7); // 3 start + 3 complete + 1 run_complete

    // Verify all entries have required fields
    for (const entry of entries) {
      expect(entry.runId).toBe(runId);
      expect(entry.projectId).toBe(projectId);
      expect(entry.event).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      // Verify timestamp is valid ISO-8601
      expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
    }

    // Verify step entries have the step field
    const stepEntries = entries.filter(e => e.event === 'step_start' || e.event === 'step_complete');
    for (const entry of stepEntries) {
      expect(entry.step).toBeDefined();
      expect(['1a', '1b', '1c-llm-analysis']).toContain(entry.step);
    }
  });

  // ==========================================================================
  // Test 2: step_start and step_complete events include correct step identifier
  // ==========================================================================
  test('step_start and step_complete events include correct step identifier', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string) => Promise<void>;
    };

    await realStartRun(projectId, runId);

    const entries = captureLogEntries(consoleSpy);

    const stepStartEntries = entries.filter(e => e.event === 'step_start');
    const stepCompleteEntries = entries.filter(e => e.event === 'step_complete');

    // Should have 3 step_start and 3 step_complete entries for steps
    // 1a, 1b, 1c-llm-analysis.
    expect(stepStartEntries.length).toBe(3);
    expect(stepCompleteEntries.length).toBe(3);

    // Verify step identifiers match expected steps in order
    const expectedSteps = ['1a', '1b', '1c-llm-analysis'];
    for (let i = 0; i < expectedSteps.length; i++) {
      expect(stepStartEntries[i].step).toBe(expectedSteps[i]);
      expect(stepCompleteEntries[i].step).toBe(expectedSteps[i]);
    }
  });

  // ==========================================================================
  // Test 3: step_failed event includes error message and stack trace
  // ==========================================================================
  test('step_failed event includes error message and stack trace', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string) => Promise<void>;
    };

    // Make step 1b fail
    mockArchModelClient.getEvidenceByRun.mockRejectedValue(
      new Error('connection timeout')
    );

    await realStartRun(projectId, runId);

    const entries = captureLogEntries(consoleSpy);

    const failedEntries = entries.filter(e => e.event === 'step_failed');
    expect(failedEntries.length).toBe(1);

    const failedEntry = failedEntries[0];
    expect(failedEntry.step).toBe('1b');
    expect(failedEntry.error).toBe('connection timeout');
    expect(failedEntry.stack).toBeDefined();
    expect(typeof failedEntry.stack).toBe('string');
    // Stack trace should reference the Error class
    expect(failedEntry.stack).toContain('Error');
  });

  // ==========================================================================
  // Test 4: run_complete event includes total durationMs
  // ==========================================================================
  test('run_complete event includes total durationMs', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string) => Promise<void>;
    };

    await realStartRun(projectId, runId);

    const entries = captureLogEntries(consoleSpy);

    const runCompleteEntries = entries.filter(e => e.event === 'run_complete');
    expect(runCompleteEntries.length).toBe(1);

    const runComplete = runCompleteEntries[0];
    expect(runComplete.durationMs).toBeDefined();
    expect(typeof runComplete.durationMs).toBe('number');
    expect(runComplete.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ==========================================================================
  // Test 5: Each step log entry includes durationMs (wall-clock timing)
  // ==========================================================================
  test('each step_complete log entry includes durationMs (wall-clock timing)', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string) => Promise<void>;
    };

    await realStartRun(projectId, runId);

    const entries = captureLogEntries(consoleSpy);

    const stepCompleteEntries = entries.filter(e => e.event === 'step_complete');
    expect(stepCompleteEntries.length).toBe(3);

    for (const entry of stepCompleteEntries) {
      expect(entry.durationMs).toBeDefined();
      expect(typeof entry.durationMs).toBe('number');
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ==========================================================================
  // Test 6: GET /discovery/runs/:runId/diagnostics returns stepsPayload with
  //         timing and counts
  // ==========================================================================
  test('GET /discovery/runs/:runId/diagnostics returns stepsPayload with timing and counts', async () => {
    // This test exercises the diagnostics route handler directly
    // We import the runsRouter and use supertest-style approach
    // by importing express and mounting the router
    const express = require('express');
    const { runsRouter } = require('../routes/runs');

    const app = express();
    app.use(express.json());
    app.use('/discovery/runs', runsRouter);

    // Mock getDiscoveryRun to return a run with timing data in steps_payload
    const runWithTimingData = {
      ...sampleRunDto(),
      status: 'COMPLETED',
      steps_payload: {
        '1a': {
          status: 'completed',
          atomCounts: { file_structure: 10, symbol: 5, string_pattern: 2 },
          totalAtoms: 17,
          stepStartedAt: '2026-04-06T10:00:01Z',
          stepCompletedAt: '2026-04-06T10:00:05Z',
          durationMs: 4000,
        },
        '1b': {
          status: 'completed',
          relationshipCount: 42,
          upstreamAtomCount: 17,
          stepStartedAt: '2026-04-06T10:00:05Z',
          stepCompletedAt: '2026-04-06T10:00:10Z',
          durationMs: 5000,
        },
        '1c': {
          status: 'completed',
          clusterCount: 3,
          stepStartedAt: '2026-04-06T10:00:10Z',
          stepCompletedAt: '2026-04-06T10:00:14Z',
          durationMs: 4000,
        },
        '1d': {
          status: 'completed',
          candidateCount: 8,
          stepStartedAt: '2026-04-06T10:00:14Z',
          stepCompletedAt: '2026-04-06T10:00:20Z',
          durationMs: 6000,
        },
      },
    };
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(runWithTimingData);

    const supertest = require('supertest');
    const response = await supertest(app)
      .get(`/discovery/runs/${runId}/diagnostics?projectId=${projectId}`);

    expect(response.status).toBe(200);
    expect(response.body.runId).toBe(runId);
    expect(response.body.projectId).toBe(projectId);
    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.stepsPayload).toBeDefined();

    // Verify timing data is present in stepsPayload
    const sp = response.body.stepsPayload;
    expect(sp['1a'].durationMs).toBe(4000);
    expect(sp['1a'].stepStartedAt).toBe('2026-04-06T10:00:01Z');
    expect(sp['1a'].stepCompletedAt).toBe('2026-04-06T10:00:05Z');

    // Verify counts are present
    expect(sp['1a'].atomCounts).toEqual({ file_structure: 10, symbol: 5, string_pattern: 2 });
    expect(sp['1b'].relationshipCount).toBe(42);
    expect(sp['1c'].clusterCount).toBe(3);
    expect(sp['1d'].candidateCount).toBe(8);
  });
});
