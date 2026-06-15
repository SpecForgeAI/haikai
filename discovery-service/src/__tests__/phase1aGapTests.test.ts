/**
 * Phase 1a Gap Tests
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * Task Group 5: Test Review and Gap Analysis
 *
 * 6 strategic tests covering critical gaps identified during review:
 *
 * Gap 1: Git clone failure for one repo does not block other repos (partial success)
 * Gap 2: Bulk persistence failure causes step to fail (FAILED status)
 * Gap 3: Batching -- large atom set (>1000 atoms) is sent in multiple HTTP calls
 * Gap 4: Multi-repo -- analyzer pack processes 2 repos and aggregates all atoms
 * Gap 5: Cleanup -- temp directory cleanup is called even when extraction fails
 * Gap 6: Ctags unavailable at analyzer pack level yields partial results (no symbol atoms)
 *
 * Gap 7 (includePaths integration) is in extractionLogic.test.ts alongside
 * the other file structure extractor tests, to avoid jest.mock conflicts.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios for archModelClient / gatewayClient tests.
//
// 2026-05-31: a bare `jest.mock('axios')` auto-mock makes `axios.create()`
// return `undefined`, so the `GatewayClient` constructor — which runs at
// `runManager` MODULE-LOAD time (`require('../services/runManager')` below)
// and immediately calls `this.client.interceptors.response.use(...)` — throws
// `Cannot read properties of undefined (reading 'interceptors')`. Provide a
// factory whose `create()` returns an interceptor-bearing instance (request +
// response `.use`, plus the verb methods the clients call) so construction
// succeeds. Mirrors the proven idiom in `startRunArchitectureUrl.regression.test.ts`,
// but as a module factory so it survives the per-test `jest.resetModules()`
// and the load-time construction without per-test wiring.
jest.mock('axios', () => {
  const makeInstance = () => ({
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    request: jest.fn().mockResolvedValue({ data: {} }),
  });
  const axiosMock: Record<string, unknown> = {
    create: jest.fn(() => makeInstance()),
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    request: jest.fn().mockResolvedValue({ data: {} }),
  };
  // Support both `import axios from 'axios'` (default) and `require('axios')`.
  axiosMock.default = axiosMock;
  return axiosMock;
});

describe('Phase 1a Gap Tests', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Gap 1: Git clone failure for one repo does not block other repos
  // ==========================================================================
  test('Gap 1: clone failure for one repo does not block other repos (partial success)', async () => {
    // Mock extractors to return predictable atoms
    jest.mock('../services/extractors/fileStructureExtractor', () => ({
      extractFileStructure: jest.fn().mockResolvedValue([
        {
          id: 'fs-atom-repo2',
          runId: 'test-run',
          repoUrl: 'https://github.com/org/repo-two',
          filePath: 'src/app.ts',
          type: 'file_structure',
          data: { relativePath: 'src/app.ts', extension: '.ts', sizeBytes: 200, lineCount: 20 },
          extractedAt: '2026-04-05T00:00:00Z',
        },
      ]),
    }));
    jest.mock('../services/extractors/symbolExtractor', () => ({
      extractSymbols: jest.fn().mockResolvedValue([]),
    }));
    jest.mock('../services/extractors/stringPatternExtractor', () => ({
      extractStringPatterns: jest.fn().mockResolvedValue([]),
    }));

    const { phase1aAnalyzerPack, setRepoAccessProvider } = require('../services/phase1aAnalyzerPack');

    // First repo clone fails, second succeeds
    const mockCloneRepo = jest.fn()
      .mockRejectedValueOnce(new Error('git clone failed: repository not found'))
      .mockResolvedValueOnce('/tmp/test-clone-2');

    const mockCleanup = jest.fn().mockResolvedValue(undefined);

    setRepoAccessProvider({
      cloneRepo: mockCloneRepo,
      cleanup: mockCleanup,
    });

    const result = await phase1aAnalyzerPack.analyze({
      projectId: 'proj-1',
      phase: 'phase1',
      step: '1a',
      context: {
        repos: [
          { url: 'https://github.com/org/repo-one', branch: 'main' },
          { url: 'https://github.com/org/repo-two', branch: 'main' },
        ],
        runId: 'test-run',
      },
    });

    // Should have atoms from repo-two only
    expect(result.evidenceAtoms.length).toBeGreaterThanOrEqual(1);

    // Metadata should reflect partial success
    expect(result.metadata.reposProcessed).toBe(1);
    expect(result.metadata.reposFailed).toBe(1);
    expect(result.metadata.failedRepos).toEqual(['https://github.com/org/repo-one']);

    // Both repos should have had cleanup called
    expect(mockCleanup).toHaveBeenCalledTimes(2);
  });

  // ==========================================================================
  // Gap 2: Bulk persistence failure causes step to fail (FAILED status)
  // ==========================================================================
  test('Gap 2: bulk persistence failure causes step to fail with FAILED status', async () => {
    const projectId = 'proj-bulk-fail';
    const runId = 'run-bulk-fail';

    // Mock analyzer pack to return some atoms
    const mockAtoms = [
      {
        id: 'atom-1',
        runId,
        repoUrl: 'https://github.com/org/repo',
        filePath: 'src/index.ts',
        type: 'file_structure',
        data: { relativePath: 'src/index.ts', extension: '.ts', sizeBytes: 100, lineCount: 10 },
        extractedAt: '2026-04-05T00:00:00Z',
      },
    ];

    jest.mock('../services/analyzerRegistry', () => ({
      getAnalyzerRegistry: jest.fn().mockReturnValue(
        new Map([
          ['phase-1a-universal-extraction', {
            id: 'phase-1a-universal-extraction',
            name: 'Phase 1a Universal Extraction',
            supportedPhases: ['phase1'],
            analyze: jest.fn().mockResolvedValue({
              analyzerId: 'phase-1a-universal-extraction',
              phase: 'phase1',
              step: '1a',
              findings: [],
              evidenceAtoms: mockAtoms,
              metadata: {
                atomCounts: { file_structure: 1, symbol: 0, string_pattern: 0 },
                totalAtoms: 1,
              },
            }),
          }],
          ['stub-noop', {
            id: 'stub-noop',
            name: 'Stub No-Op Analyzer',
            supportedPhases: ['phase0', 'phase1'],
            analyze: jest.fn().mockResolvedValue({
              analyzerId: 'stub-noop',
              phase: 'phase1',
              step: '1b',
              findings: [],
              metadata: { stub: true },
            }),
          }],
        ])
      ),
      initializeAnalyzerRegistry: jest.fn(),
    }));

    jest.mock('../services/archModelClient', () => ({
      archModelClient: {
        getDiscoveryRun: jest.fn().mockResolvedValue({
          id: runId,
          project_id: projectId,
          service_id: null,
          status: 'RUNNING',
          current_step: '1a',
          config_snapshot: {
            repos: [{ url: 'https://github.com/org/repo', branch: 'main' }],
          },
          steps_payload: { '1a': { status: 'running' } },
          error_message: null,
          created_at: '2026-04-05T00:00:00Z',
          updated_at: '2026-04-05T00:00:00Z',
        }),
        updateDiscoveryRun: jest.fn().mockResolvedValue({
          id: runId,
          project_id: projectId,
          service_id: null,
          status: 'RUNNING',
          current_step: '1a',
          config_snapshot: {},
          steps_payload: {},
          error_message: null,
          created_at: '2026-04-05T00:00:00Z',
          updated_at: '2026-04-05T00:00:00Z',
        }),
        // bulkSaveEvidence FAILS
        bulkSaveEvidence: jest.fn().mockRejectedValue(new Error('Connection refused to arch-model-service')),
        createDiscoveryRun: jest.fn(),
        getDiscoveryConfig: jest.fn(),
        // 2026-05-31: startRun() now resets the default-architecture cache at
        // run start (Multi-Architecture Plumbing, 2026-05-01). Stub it so the
        // run can begin; the cache reset is a no-op for these mocks.
        resetDefaultArchitectureCache: jest.fn(),
      },
    }));

    const { startRun } = require('../services/runManager');
    const { archModelClient } = require('../services/archModelClient');

    // 2026-05-31: startRun gained a required `architectureId` 3rd arg
    // (Multi-Architecture Plumbing). The route layer binds it; supply a
    // stable fixture id here so the run binds + proceeds.
    await startRun(projectId, runId, 'arch-phase1a-gap');

    // The run should have been set to FAILED because bulkSaveEvidence threw
    const updateCalls = archModelClient.updateDiscoveryRun.mock.calls;
    const failedCall = updateCalls.find(
      (call: unknown[]) => (call[2] as Record<string, unknown>).status === 'FAILED'
    );
    expect(failedCall).toBeDefined();

    const failedPayload = failedCall[2] as Record<string, unknown>;
    expect(failedPayload.status).toBe('FAILED');
    expect(failedPayload.error_message).toContain('Connection refused');

    // Step 1a should be marked as failed in stepsPayload
    const stepsPayload = failedPayload.steps_payload as Record<string, Record<string, unknown>>;
    expect(stepsPayload['1a'].status).toBe('failed');

    // Downstream steps should remain pending (never reached). The pipeline's
    // VALID_STEPS is now ['1a', '1b', '1c-llm-analysis'] (the legacy '1c'/'1d'
    // keys were replaced by the single '1c-llm-analysis' step); assert the
    // current downstream keys stay pending after the 1a failure.
    expect(stepsPayload['1b'].status).toBe('pending');
    expect(stepsPayload['1c-llm-analysis'].status).toBe('pending');
  });

  // ==========================================================================
  // Gap 3: Batching -- large atom set (>1000) is sent in multiple HTTP calls
  // ==========================================================================
  test('Gap 3: large atom set (>1000 atoms) is sent in multiple HTTP calls of 500 each', async () => {
    const projectId = 'proj-batch';
    const runId = 'run-batch';

    // Generate 1200 mock atoms to exceed the 500-atom batch size
    const mockAtoms = Array.from({ length: 1200 }, (_, i) => ({
      id: `atom-${i}`,
      runId,
      repoUrl: 'https://github.com/org/big-repo',
      filePath: `src/file${i}.ts`,
      type: 'file_structure',
      data: { relativePath: `src/file${i}.ts`, extension: '.ts', sizeBytes: 100, lineCount: 10 },
      extractedAt: '2026-04-05T00:00:00Z',
    }));

    jest.mock('../services/analyzerRegistry', () => ({
      getAnalyzerRegistry: jest.fn().mockReturnValue(
        new Map([
          ['phase-1a-universal-extraction', {
            id: 'phase-1a-universal-extraction',
            name: 'Phase 1a Universal Extraction',
            supportedPhases: ['phase1'],
            analyze: jest.fn().mockResolvedValue({
              analyzerId: 'phase-1a-universal-extraction',
              phase: 'phase1',
              step: '1a',
              findings: [],
              evidenceAtoms: mockAtoms,
              metadata: {
                atomCounts: { file_structure: 1200, symbol: 0, string_pattern: 0 },
                totalAtoms: 1200,
              },
            }),
          }],
          ['stub-noop', {
            id: 'stub-noop',
            name: 'Stub No-Op Analyzer',
            supportedPhases: ['phase0', 'phase1'],
            analyze: jest.fn().mockResolvedValue({
              analyzerId: 'stub-noop',
              phase: 'phase1',
              step: '1b',
              findings: [],
              metadata: { stub: true },
            }),
          }],
        ])
      ),
      initializeAnalyzerRegistry: jest.fn(),
    }));

    jest.mock('../services/archModelClient', () => ({
      archModelClient: {
        getDiscoveryRun: jest.fn().mockResolvedValue({
          id: runId,
          project_id: projectId,
          service_id: null,
          status: 'RUNNING',
          current_step: '1a',
          config_snapshot: {
            repos: [{ url: 'https://github.com/org/big-repo', branch: 'main' }],
          },
          steps_payload: { '1a': { status: 'running' } },
          error_message: null,
          created_at: '2026-04-05T00:00:00Z',
          updated_at: '2026-04-05T00:00:00Z',
        }),
        updateDiscoveryRun: jest.fn().mockResolvedValue({
          id: runId,
          project_id: projectId,
          service_id: null,
          status: 'RUNNING',
          current_step: '1a',
          config_snapshot: {},
          steps_payload: {},
          error_message: null,
          created_at: '2026-04-05T00:00:00Z',
          updated_at: '2026-04-05T00:00:00Z',
        }),
        bulkSaveEvidence: jest.fn().mockResolvedValue(undefined),
        createDiscoveryRun: jest.fn(),
        getDiscoveryConfig: jest.fn(),
        // 2026-05-31: startRun() now resets the default-architecture cache at
        // run start (Multi-Architecture Plumbing, 2026-05-01). Stub it so the
        // run can begin; the cache reset is a no-op for these mocks.
        resetDefaultArchitectureCache: jest.fn(),
      },
    }));

    const { startRun } = require('../services/runManager');
    const { archModelClient } = require('../services/archModelClient');

    // 2026-05-31: startRun gained a required `architectureId` 3rd arg
    // (Multi-Architecture Plumbing). The route layer binds it; supply a
    // stable fixture id here so the run binds + proceeds.
    await startRun(projectId, runId, 'arch-phase1a-gap');

    // With 1200 atoms and BULK_SAVE_BATCH_SIZE = 500, expect 3 batches:
    // batch 1: atoms 0-499 (500)
    // batch 2: atoms 500-999 (500)
    // batch 3: atoms 1000-1199 (200)
    expect(archModelClient.bulkSaveEvidence).toHaveBeenCalledTimes(3);

    // Verify first batch has 500 atoms
    const firstBatchAtoms = archModelClient.bulkSaveEvidence.mock.calls[0][2];
    expect(firstBatchAtoms.length).toBe(500);

    // Verify second batch has 500 atoms
    const secondBatchAtoms = archModelClient.bulkSaveEvidence.mock.calls[1][2];
    expect(secondBatchAtoms.length).toBe(500);

    // Verify third batch has remaining 200 atoms
    const thirdBatchAtoms = archModelClient.bulkSaveEvidence.mock.calls[2][2];
    expect(thirdBatchAtoms.length).toBe(200);
  });

  // ==========================================================================
  // Gap 4: Multi-repo -- analyzer pack processes 2 repos and aggregates atoms
  // ==========================================================================
  test('Gap 4: analyzer pack processes multiple repos and aggregates all atoms', async () => {
    // Track which repo directories extractors are called with
    let extractCallCount = 0;

    jest.mock('../services/extractors/fileStructureExtractor', () => ({
      extractFileStructure: jest.fn().mockImplementation((opts: { repoDir: string; runId: string; repoUrl: string }) => {
        extractCallCount++;
        return Promise.resolve([
          {
            id: `fs-atom-${extractCallCount}`,
            runId: opts.runId,
            repoUrl: opts.repoUrl,
            filePath: 'src/main.ts',
            type: 'file_structure',
            data: { relativePath: 'src/main.ts', extension: '.ts', sizeBytes: 100, lineCount: 10 },
            extractedAt: '2026-04-05T00:00:00Z',
          },
        ]);
      }),
    }));
    jest.mock('../services/extractors/symbolExtractor', () => ({
      extractSymbols: jest.fn().mockResolvedValue([]),
    }));
    jest.mock('../services/extractors/stringPatternExtractor', () => ({
      extractStringPatterns: jest.fn().mockImplementation((opts: { repoDir: string; runId: string; repoUrl: string }) => {
        return Promise.resolve([
          {
            id: `sp-atom-${opts.repoUrl}`,
            runId: opts.runId,
            repoUrl: opts.repoUrl,
            filePath: 'src/main.ts',
            type: 'string_pattern',
            data: { patternName: 'import_statement', matchedText: "import x from 'y'", line: 1, contextSnippet: "import x from 'y';" },
            extractedAt: '2026-04-05T00:00:00Z',
          },
        ]);
      }),
    }));

    const { phase1aAnalyzerPack, setRepoAccessProvider } = require('../services/phase1aAnalyzerPack');

    setRepoAccessProvider({
      cloneRepo: jest.fn().mockResolvedValue('/tmp/clone'),
      cleanup: jest.fn().mockResolvedValue(undefined),
    });

    const result = await phase1aAnalyzerPack.analyze({
      projectId: 'proj-multi',
      phase: 'phase1',
      step: '1a',
      context: {
        repos: [
          { url: 'https://github.com/org/repo-a', branch: 'main' },
          { url: 'https://github.com/org/repo-b', branch: 'develop' },
        ],
        runId: 'run-multi',
      },
    });

    // 2 repos x (1 file_structure + 1 string_pattern each) = 4 atoms
    expect(result.evidenceAtoms.length).toBe(4);
    expect(result.metadata.reposProcessed).toBe(2);
    expect(result.metadata.reposFailed).toBe(0);
    expect(result.metadata.atomCounts.file_structure).toBe(2);
    expect(result.metadata.atomCounts.string_pattern).toBe(2);

    // Verify atoms from both repos are present
    const repoUrls = new Set(result.evidenceAtoms.map((a: { repoUrl: string }) => a.repoUrl));
    expect(repoUrls.size).toBe(2);
    expect(repoUrls.has('https://github.com/org/repo-a')).toBe(true);
    expect(repoUrls.has('https://github.com/org/repo-b')).toBe(true);
  });

  // ==========================================================================
  // Gap 5: Cleanup -- temp directory cleanup is called even on extraction failure
  // ==========================================================================
  test('Gap 5: temp directory cleanup is called even when extraction fails', async () => {
    // Mock extractors to throw errors
    jest.mock('../services/extractors/fileStructureExtractor', () => ({
      extractFileStructure: jest.fn().mockRejectedValue(new Error('extraction failure: ENOMEM')),
    }));
    jest.mock('../services/extractors/symbolExtractor', () => ({
      extractSymbols: jest.fn().mockResolvedValue([]),
    }));
    jest.mock('../services/extractors/stringPatternExtractor', () => ({
      extractStringPatterns: jest.fn().mockResolvedValue([]),
    }));

    const { phase1aAnalyzerPack, setRepoAccessProvider } = require('../services/phase1aAnalyzerPack');

    const mockCleanup = jest.fn().mockResolvedValue(undefined);

    setRepoAccessProvider({
      cloneRepo: jest.fn().mockResolvedValue('/tmp/test-clone'),
      cleanup: mockCleanup,
    });

    const result = await phase1aAnalyzerPack.analyze({
      projectId: 'proj-cleanup',
      phase: 'phase1',
      step: '1a',
      context: {
        repos: [{ url: 'https://github.com/org/failing-repo', branch: 'main' }],
        runId: 'run-cleanup',
      },
    });

    // Cleanup should have been called despite the extraction failure
    // (the error occurs inside the try block after cloneRepo succeeds,
    //  so the finally block should invoke cleanup)
    expect(mockCleanup).toHaveBeenCalledTimes(1);

    // The repo should be counted as failed
    expect(result.metadata.reposFailed).toBe(1);
    expect(result.metadata.failedRepos).toEqual(['https://github.com/org/failing-repo']);
  });

  // ==========================================================================
  // Gap 6: Ctags unavailable at analyzer pack level yields partial results
  // ==========================================================================
  test('Gap 6: ctags unavailable yields file_structure and string_pattern atoms only (no symbol atoms)', async () => {
    jest.mock('../services/extractors/fileStructureExtractor', () => ({
      extractFileStructure: jest.fn().mockResolvedValue([
        {
          id: 'fs-1',
          runId: 'run-no-ctags',
          repoUrl: 'https://github.com/org/repo',
          filePath: 'src/app.ts',
          type: 'file_structure',
          data: { relativePath: 'src/app.ts', extension: '.ts', sizeBytes: 300, lineCount: 30 },
          extractedAt: '2026-04-05T00:00:00Z',
        },
      ]),
    }));

    // Symbol extractor returns empty array when ctags is unavailable
    jest.mock('../services/extractors/symbolExtractor', () => ({
      extractSymbols: jest.fn().mockResolvedValue([]),
    }));

    jest.mock('../services/extractors/stringPatternExtractor', () => ({
      extractStringPatterns: jest.fn().mockResolvedValue([
        {
          id: 'sp-1',
          runId: 'run-no-ctags',
          repoUrl: 'https://github.com/org/repo',
          filePath: 'src/app.ts',
          type: 'string_pattern',
          data: { patternName: 'import_statement', matchedText: "import x from 'y'", line: 1, contextSnippet: "import x from 'y';" },
          extractedAt: '2026-04-05T00:00:00Z',
        },
      ]),
    }));

    const { phase1aAnalyzerPack, setRepoAccessProvider } = require('../services/phase1aAnalyzerPack');

    setRepoAccessProvider({
      cloneRepo: jest.fn().mockResolvedValue('/tmp/test-clone'),
      cleanup: jest.fn().mockResolvedValue(undefined),
    });

    const result = await phase1aAnalyzerPack.analyze({
      projectId: 'proj-no-ctags',
      phase: 'phase1',
      step: '1a',
      context: {
        repos: [{ url: 'https://github.com/org/repo', branch: 'main' }],
        runId: 'run-no-ctags',
      },
    });

    // Should have file_structure + string_pattern but no symbol atoms
    expect(result.evidenceAtoms.length).toBe(2);
    expect(result.metadata.atomCounts.file_structure).toBe(1);
    expect(result.metadata.atomCounts.symbol).toBe(0);
    expect(result.metadata.atomCounts.string_pattern).toBe(1);

    // Verify atom types explicitly
    const types = result.evidenceAtoms.map((a: { type: string }) => a.type);
    expect(types).toContain('file_structure');
    expect(types).toContain('string_pattern');
    expect(types).not.toContain('symbol');

    // Result should still report success (partial results are acceptable)
    expect(result.metadata.reposProcessed).toBe(1);
    expect(result.metadata.reposFailed).toBe(0);
  });
});
