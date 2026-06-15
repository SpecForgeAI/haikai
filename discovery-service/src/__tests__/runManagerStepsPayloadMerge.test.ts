/**
 * Hotfix tests (2026-04-20): verify the runManager step-wrapper preserves
 * `steps_payload.v3.gapFill` when it persists its own per-step status keys.
 *
 * Bug context (run 735129eb-5d2c-4898-8137-f79010caa885):
 *   The V3 pipeline (`runDiscoveryV3`) writes `steps_payload.v3.gapFill`
 *   mid-step via `persistGapFillStagePayload` (which itself does
 *   read-merge-write semantics). The surrounding step-wrapper in
 *   `runManager.ts` later writes `steps_payload['service-scoped-llm-analysis']`
 *   (or '1c-llm-analysis' on the project-level path) and used to do so via
 *   `steps_payload: { ...localStepsPayload }` -- which OVERWRITES the entire
 *   jsonb column on the run row. Result: the V3 sub-tree was silently wiped,
 *   leaving only the wrapper's step key behind.
 *
 * Fix: every wrapper write now goes through `buildMergedStepsPayload`, which
 * re-reads the latest persisted `steps_payload` and overlays the local step
 * keys on top. Top-level keys we did not touch (notably `v3`) survive. The
 * regression is covered on BOTH terminal writes: the COMPLETED write (test 1)
 * and the FAILED write (test 2).
 *
 * These tests mock the archModelClient with stateful in-memory storage
 * (mirroring the jsonb column round-trip) and a fake `executeLlmFileAnalysis`
 * that writes `v3.gapFill` mid-step (mirroring what `persistGapFillStagePayload`
 * does inside `runDiscoveryV3`). After the run completes, both keys MUST be
 * present in the final stored `steps_payload`.
 *
 * NOTE on the FAILED path (test 2): the service-scoped orchestrator isolates
 * per-directory scan failures (R-12 -- one bad code-base directory does NOT
 * abort the run; the scan row is marked failed and the loop continues to a
 * COMPLETED terminal state). A thrown `executeLlmFileAnalysis` is therefore
 * soft-failed and does NOT drive the run to FAILED. To genuinely exercise the
 * FAILED terminal write (and prove the V3 sub-tree survives the read-merge-
 * write on it), test 2 drives a hard failure OUTSIDE the soft-failed scan loop
 * -- candidate persistence throwing -- which propagates to the outer catch and
 * the FAILED branch. The V3 sub-tree written mid-step before that failure must
 * still survive.
 */

// Mock dotenv before any side-effecting import.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Mock archModelClient with stateful in-memory storage so we can faithfully
// simulate the read-merge-write round-trip the persistence layer performs.
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    getDiscoveryRun: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getService: jest.fn(),
    getApplication: jest.fn(),
    getAppComponent: jest.fn(),
    bulkSaveCandidates: jest.fn(),
    getEvidenceCount: jest.fn(),
    getEvidenceByRun: jest.fn(),
    getEvidenceByRunPaginated: jest.fn(),
    getRelationshipCount: jest.fn(),
    getRelationshipsByRun: jest.fn(),
    getRelationshipsByRunPaginated: jest.fn(),
    resetDefaultArchitectureCache: jest.fn(),
    getModel: jest.fn().mockResolvedValue(null),
    getProject: jest.fn().mockResolvedValue(null),
    bulkCreateDiscoveryFindings: jest.fn().mockResolvedValue({ created: 0, findings: [] }),
  },
}));

// Mock executeLlmFileAnalysis so the wrapper's V3 invocation runs a
// controlled fake that writes `v3.gapFill` mid-step (the way the real
// `runDiscoveryV3` does via `persistGapFillStagePayload`).
jest.mock('../services/llmFileAnalysisStep', () => ({
  executeLlmFileAnalysis: jest.fn(),
  sortCandidatesParentsFirst: <T,>(arr: T[]): T[] => arr,
}));

// Mock repoAccess so service-scoped runs do not actually touch the
// filesystem or attempt git clones. Spread the actual module so helper
// exports (isGitRepoUrl, normalizeRepoLocation, normalizeRepoSubfolder)
// remain available to code under test.
jest.mock('../services/repoAccess', () => {
  const actual = jest.requireActual('../services/repoAccess');
  return {
    ...actual,
    buildTempDir: jest.fn(() => '/tmp/fake-clone'),
    gitCloneRepoAccess: {
      fetch: jest.fn(async () => {}),
      cloneRepo: jest.fn(async () => {}),
      cleanup: jest.fn(async () => {}),
    },
  };
});

import { archModelClient } from '../services/archModelClient';
import { executeLlmFileAnalysis } from '../services/llmFileAnalysisStep';
import { startRun } from '../services/runManager';

const archMock = archModelClient as unknown as {
  getDiscoveryRun: jest.Mock;
  updateDiscoveryRun: jest.Mock;
  getService: jest.Mock;
  bulkSaveCandidates: jest.Mock;
  getEvidenceCount: jest.Mock;
  getEvidenceByRun: jest.Mock;
  getRelationshipCount: jest.Mock;
  getRelationshipsByRun: jest.Mock;
};
const executeLlmFileAnalysisMock = executeLlmFileAnalysis as jest.Mock;

const TEST_PROJECT_ID = 'proj-merge-001';
const TEST_RUN_ID = 'run-merge-001';
const TEST_SERVICE_ID = 'svc-merge-001';
const TEST_ARCHITECTURE_ID = 'arch-merge-001';

/**
 * In-memory stand-in for the persisted discovery_run row's `steps_payload`
 * jsonb column. The mocks below read/write this object so the test sees the
 * same round-trip behaviour the production stack would.
 */
let storedSteps: Record<string, unknown>;
let storedRunMeta: Record<string, unknown>;

function rebindArchMocks(): void {
  storedSteps = {};
  storedRunMeta = {
    id: TEST_RUN_ID,
    project_id: TEST_PROJECT_ID,
    service_id: TEST_SERVICE_ID,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: { repos: [{ url: 'https://example/repo.git' }] },
    error_message: null,
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
  };

  archMock.getDiscoveryRun.mockImplementation(async () => ({
    ...storedRunMeta,
    steps_payload: { ...storedSteps },
  }));

  archMock.updateDiscoveryRun.mockImplementation(
    async (_projectId: string, _runId: string, patch: Record<string, unknown>) => {
      // Mirror the production behaviour: whatever `steps_payload` value the
      // caller sends REPLACES the jsonb column wholesale. Read-merge-write
      // is the caller's responsibility -- which is exactly what the hotfix
      // adds via `buildMergedStepsPayload`.
      if (patch.steps_payload !== undefined) {
        storedSteps = patch.steps_payload as Record<string, unknown>;
      }
      for (const k of Object.keys(patch)) {
        if (k === 'steps_payload') continue;
        storedRunMeta[k] = patch[k];
      }
      return { ...storedRunMeta, steps_payload: { ...storedSteps } };
    },
  );

  archMock.getService.mockResolvedValue({
    id: TEST_SERVICE_ID,
    name: 'TestService',
    repo_location: '/local/test/repo',
    repo_subfolder: '',
    core_tech: 'java',
    application_id: null,
    app_component_id: null,
  });

  archMock.bulkSaveCandidates.mockResolvedValue(undefined);
  archMock.getEvidenceCount.mockResolvedValue(0);
  archMock.getEvidenceByRun.mockResolvedValue([]);
  archMock.getRelationshipCount.mockResolvedValue(0);
  archMock.getRelationshipsByRun.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  rebindArchMocks();
});

describe('runManager steps_payload merge (hotfix 2026-04-20)', () => {
  it(
    'service-scoped run: final steps_payload contains BOTH `v3.gapFill` (written ' +
      'mid-step by the V3 pipeline) AND `service-scoped-llm-analysis` (written by ' +
      'the wrapper) -- regression cover for the wrapper-overwrites-v3 bug',
    async () => {
      // Fake `executeLlmFileAnalysis`: simulate the V3 pipeline writing
      // `steps_payload.v3.gapFill` mid-step (the way
      // `persistGapFillStagePayload` does inside `runDiscoveryV3`). Use the
      // same read-merge-write the real persistence path uses.
      executeLlmFileAnalysisMock.mockImplementation(async () => {
        const latest = await archMock.getDiscoveryRun(TEST_PROJECT_ID, TEST_RUN_ID);
        const currentSteps = (latest.steps_payload || {}) as Record<string, unknown>;
        const currentV3 = (currentSteps.v3 as Record<string, unknown>) ?? {};
        await archMock.updateDiscoveryRun(TEST_PROJECT_ID, TEST_RUN_ID, {
          steps_payload: {
            ...currentSteps,
            v3: {
              ...currentV3,
              gapFill: {
                stageStatus: 'completed',
                dedupDroppedCount: 0,
                crossFileDedupCount: 0,
                failures: [],
                filesProcessed: 1,
                promptVersion: {
                  base: 'aaaaaaaa',
                  language: 'bbbbbbbb',
                  framework: 'cccccccc',
                  composed: 'dddddddd',
                },
              },
            },
          },
          mode: 'A',
        });
        return {
          candidates: [],
          evidenceCount: 0,
          filesAnalyzed: 1,
          filesFailed: 0,
          findingInputs: [],
        };
      });

      // Drive a service-scoped run end-to-end.
      await startRun(TEST_PROJECT_ID, TEST_RUN_ID, TEST_ARCHITECTURE_ID, TEST_SERVICE_ID);

      // The persisted `steps_payload` after the wrapper finishes must contain
      // BOTH the wrapper's step key AND the V3 sub-tree the pipeline wrote
      // mid-step. Pre-fix, only the wrapper's key would survive.
      expect(storedSteps).toHaveProperty('service-scoped-llm-analysis');
      expect(storedSteps).toHaveProperty('v3');

      const wrapperEntry = storedSteps['service-scoped-llm-analysis'] as Record<string, unknown>;
      expect(wrapperEntry.status).toBe('completed');

      const v3Entry = storedSteps.v3 as Record<string, unknown>;
      expect(v3Entry.gapFill).toBeDefined();
      const gap = v3Entry.gapFill as Record<string, unknown>;
      expect(gap.stageStatus).toBe('completed');
      expect(gap.filesProcessed).toBe(1);
      expect(gap.promptVersion).toEqual({
        base: 'aaaaaaaa',
        language: 'bbbbbbbb',
        framework: 'cccccccc',
        composed: 'dddddddd',
      });

      // Final run status reflects success.
      expect(storedRunMeta.status).toBe('COMPLETED');
    },
  );

  it(
    'service-scoped run failure path: when the wrapper transitions to FAILED, the ' +
      'V3 sub-tree written before the failure survives (read-merge-write on every ' +
      'persisted step_payload write)',
    async () => {
      // V3 writes its sub-tree mid-step and returns ONE candidate. The thrown
      // error that drives the FAILED branch must come from OUTSIDE the
      // per-directory scan loop (which soft-fails / isolates per R-12 and would
      // otherwise leave the run COMPLETED). We use candidate persistence
      // (bulkSaveCandidates) -- it rethrows on failure (runManager.ts) and
      // propagates to the service-scoped outer catch -> FAILED branch.
      executeLlmFileAnalysisMock.mockImplementation(async () => {
        const latest = await archMock.getDiscoveryRun(TEST_PROJECT_ID, TEST_RUN_ID);
        const currentSteps = (latest.steps_payload || {}) as Record<string, unknown>;
        await archMock.updateDiscoveryRun(TEST_PROJECT_ID, TEST_RUN_ID, {
          steps_payload: {
            ...currentSteps,
            v3: {
              gapFill: {
                stageStatus: 'failed',
                dedupDroppedCount: 0,
                crossFileDedupCount: 0,
                failures: [{ filePath: 'a.java', error: 'boom' }],
                filesProcessed: 1,
                promptVersion: {
                  base: '11111111',
                  language: '22222222',
                  framework: '33333333',
                  composed: '44444444',
                },
              },
            },
          },
        });
        return {
          candidates: [
            {
              id: 'cand-fail-001',
              runId: TEST_RUN_ID,
              candidateType: 'class',
              name: 'Doomed',
              confidence: 0.5,
              status: 'proposed',
              sourceClusterIds: [],
              data: {},
              synthesizedAt: '2026-04-20T10:00:00Z',
            },
          ],
          evidenceCount: 0,
          filesAnalyzed: 1,
          filesFailed: 0,
          findingInputs: [],
        };
      });

      // Persisting the candidate throws -> propagates to the outer catch ->
      // FAILED branch (this failure is OUTSIDE the soft-failed scan loop).
      archMock.bulkSaveCandidates.mockRejectedValue(
        new Error('synthetic candidate-persist failure for FAILED-path coverage'),
      );

      await startRun(TEST_PROJECT_ID, TEST_RUN_ID, TEST_ARCHITECTURE_ID, TEST_SERVICE_ID);

      // Wrapper recorded the FAILED status AND preserved the V3 sub-tree.
      expect(storedRunMeta.status).toBe('FAILED');
      expect(storedSteps).toHaveProperty('service-scoped-llm-analysis');
      expect(storedSteps).toHaveProperty('v3');

      const wrapperEntry = storedSteps['service-scoped-llm-analysis'] as Record<string, unknown>;
      expect(wrapperEntry.status).toBe('failed');

      const v3Entry = storedSteps.v3 as Record<string, unknown>;
      const gap = v3Entry.gapFill as Record<string, unknown>;
      expect(gap.stageStatus).toBe('failed');
      expect(gap.failures).toEqual([{ filePath: 'a.java', error: 'boom' }]);
    },
  );
});
