/**
 * Integration tests: `runDiscoveryV3` <-> runtime-evidence sub-stage.
 *
 * Per Spec 5 Task 4.1, kept tight (2 tests) and focused on:
 *   - The runtime-evidence orchestrator is invoked between Stage 2 and
 *     Stage 3, and its `RuntimeEvidenceLlmContext` is injected into
 *     `runLlmGapFill`'s input shape.
 *   - When the runtime-evidence sub-stage fails (orchestrator throws or
 *     reports `log_processing_failed`), the discovery RUN does NOT fail
 *     -- it continues to Stage 3 with no runtime context (acceptance
 *     criterion 22).
 *
 * `FrameworkPack.adapt` is exercised through a fake pack registered in
 * the in-process registry; `runLlmGapFill` is mocked so we can capture
 * the input it receives and stub its output. The runtime-evidence
 * orchestrator is mocked so we can simulate both happy and failure
 * paths without touching disk.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getProject: jest.fn(),
    updateCandidate: jest.fn(),
    getCandidatesByRun: jest.fn(),
  },
}));

jest.mock('../llmGapFillStep', () => ({
  runLlmGapFill: jest.fn(),
}));

jest.mock('../runtimeEvidence/runDiscoveryRuntimeEvidence', () => ({
  runDiscoveryRuntimeEvidence: jest.fn(),
}));

import type { DiscoveryCandidate } from '../../types/candidate';
import type { LanguagePack, FrameworkPack, SourceFileIR } from '../extensionPacks';
import {
  clearRegistry,
  registerLanguagePack,
  registerFrameworkPack,
} from '../extensionPackRegistry';
import { archModelClient } from '../archModelClient';
import { runDiscoveryV3 } from '../discoveryV3Pipeline';
import { runLlmGapFill } from '../llmGapFillStep';
import { runDiscoveryRuntimeEvidence } from '../runtimeEvidence/runDiscoveryRuntimeEvidence';

const runLlmGapFillMock = runLlmGapFill as jest.Mock;
const runRuntimeEvidenceMock = runDiscoveryRuntimeEvidence as jest.Mock;

const TEST_RUN_ID = 'run-rte-001';
const TEST_PROJECT_ID = 'proj-rte-001';

function makeIr(filePath: string): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
  };
}

function makeFakeLanguagePack(): LanguagePack {
  return {
    id: 'java-lang',
    when: { language: 'Java' },
    extract: (sourceFiles) =>
      new Map(Array.from(sourceFiles.keys()).map((fp) => [fp, makeIr(fp)])),
  };
}

function makeFakeFrameworkPack(): FrameworkPack {
  return {
    id: 'spring-classic',
    when: { language: 'Java', technology: 'Spring' },
    adapt: (irFiles, runId): DiscoveryCandidate[] => {
      const out: DiscoveryCandidate[] = [];
      for (const fp of irFiles.keys()) {
        out.push({
          id: `cand-${out.length}`,
          runId,
          candidateType: 'endpoints',
          name: `GET /api/things/{id}`,
          confidence: 0.9,
          status: 'proposed',
          sourceClusterIds: [fp],
          data: {
            method: 'GET',
            pathTemplate: '/api/things/{id}',
            _addedBy: 'spring-classic-adapter',
          },
          synthesizedAt: new Date().toISOString(),
        } as DiscoveryCandidate);
      }
      return out;
    },
  };
}

beforeEach(() => {
  clearRegistry();
  jest.clearAllMocks();

  (archModelClient.getDiscoveryRun as jest.Mock).mockResolvedValue({
    id: TEST_RUN_ID,
    project_id: TEST_PROJECT_ID,
    service_id: null,
    mode: null,
    status: 'RUNNING',
    current_step: '1c-llm-analysis',
    config_snapshot: {},
    steps_payload: {},
    error_message: null,
    created_at: '2026-05-10T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
    architecture_id: 'arch-1',
  });
  (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
  (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);
  // Project-folder resolution for the V3 pipeline's call-out.
  (archModelClient.getProject as jest.Mock).mockResolvedValue({
    id: TEST_PROJECT_ID,
    project_parent_folder: '/tmp/project-parent',
  });

  runLlmGapFillMock.mockResolvedValue({
    llmCandidates: [],
    stageStatus: 'completed',
    failures: [],
    dedupDroppedCount: 0,
    crossFileDedupCount: 0,
    promptVersion: {
      base: 'aaaaaaaa',
      language: 'bbbbbbbb',
      framework: 'cccccccc',
      composed: 'dddddddd',
    },
  });
});

describe('runDiscoveryV3 — runtime evidence sub-stage integration', () => {
  it('invokes runDiscoveryRuntimeEvidence between Stage 2 and Stage 3, and threads its llmContext into runLlmGapFill input', async () => {
    registerLanguagePack(makeFakeLanguagePack());
    registerFrameworkPack(makeFakeFrameworkPack());

    const fakeLlmContext = {
      runtimeEvidenceSummary: {
        logFilesProcessed: 1,
        logWindow: {
          firstSeen: '2026-05-10T00:00:00Z',
          lastSeen: '2026-05-10T01:00:00Z',
        },
        matchedEndpoints: [
          {
            candidateId: 'cand-0',
            method: 'GET',
            pathTemplate: '/api/things/{id}',
            observedUsageCount: 7,
            status2xxCount: 7,
            status3xxCount: 0,
            status4xxCount: 0,
            status5xxCount: 0,
          },
        ],
        codeEndpointsWithNoObservedUsage: [],
        unmatchedRuntimeRouteHints: [],
      },
    };
    runRuntimeEvidenceMock.mockResolvedValue({
      persistenceSummary: {
        logFilesProcessed: 1,
        logWindow: {},
        totals: {
          observations: 7,
          matchedEndpoints: 1,
          noUsageEndpoints: 0,
          unmatchedHints: 0,
        },
        warnings: [],
        unmatchedRouteHints: [],
      },
      llmContext: fakeLlmContext,
    });

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    // Orchestrator was called -- with the Stage 2 deterministic candidates
    // (the spring-classic-adapter emitted one endpoint candidate).
    expect(runRuntimeEvidenceMock).toHaveBeenCalledTimes(1);
    const orchestratorArgs = runRuntimeEvidenceMock.mock.calls[0][0];
    expect(orchestratorArgs.projectId).toBe(TEST_PROJECT_ID);
    expect(orchestratorArgs.runId).toBe(TEST_RUN_ID);
    expect(orchestratorArgs.projectFolder).toBe('/tmp/project-parent');
    expect(orchestratorArgs.deterministicCandidates).toHaveLength(1);
    expect(orchestratorArgs.deterministicCandidates[0].candidateType).toBe(
      'endpoints',
    );

    // Gap-fill was called with the runtime context attached.
    expect(runLlmGapFillMock).toHaveBeenCalledTimes(1);
    const gapFillInput = runLlmGapFillMock.mock.calls[0][0];
    expect(gapFillInput.runtimeEvidenceContext).toBe(fakeLlmContext);
  });

  it('does NOT fail the discovery run when log processing fails -- continues to Stage 3 with no runtime context', async () => {
    registerLanguagePack(makeFakeLanguagePack());
    registerFrameworkPack(makeFakeFrameworkPack());

    // Simulate a top-level orchestrator failure: it returns the
    // skipped-with-failure summary and an empty LLM context.
    runRuntimeEvidenceMock.mockResolvedValue({
      persistenceSummary: {
        skipped: true,
        reason: 'log_processing_failed',
        warnings: ['boom: every file failed to parse'],
      },
      llmContext: {
        runtimeEvidenceSummary: {
          logFilesProcessed: 0,
          logWindow: {},
          matchedEndpoints: [],
          codeEndpointsWithNoObservedUsage: [],
          unmatchedRuntimeRouteHints: [],
        },
      },
    });

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    // Run completed (returned a result) and the candidates from Stage 2
    // are still produced.
    expect(result.tier).toBe('A');
    expect(result.candidates.length).toBeGreaterThan(0);

    // Stage 3 still ran -- the empty context was passed in.
    expect(runLlmGapFillMock).toHaveBeenCalledTimes(1);
    const gapFillInput = runLlmGapFillMock.mock.calls[0][0];
    expect(gapFillInput.runtimeEvidenceContext).toBeDefined();
    expect(
      gapFillInput.runtimeEvidenceContext.runtimeEvidenceSummary
        .logFilesProcessed,
    ).toBe(0);
  });
});
