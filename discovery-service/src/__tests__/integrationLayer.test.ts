/**
 * Integration Layer Tests
 *
 * 6 focused tests covering Task Group 4:
 * Test 1: phase1aAnalyzerPack.analyze() returns an AnalyzerResult with evidence atoms
 * Test 2: phase1aAnalyzerPack is registered in the analyzer registry after initializeAnalyzerRegistry()
 * Test 3: archModelClient.bulkSaveEvidence() sends POST to the correct endpoint
 * Test 4: archModelClient.getEvidenceByRun() calls GET with optional ?type= query param
 * Test 5: archModelClient.getEvidenceCount() calls GET on the /count endpoint and returns the numeric count
 * Test 6: Run manager executeStep('1a', ...) calls the 1a analyzer pack and persists atoms via bulkSaveEvidence()
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios for archModelClient tests
jest.mock('axios');

const ARCH_ID = 'arch-uuid-test';

// Mock runArchitectureRegistry so _resolveArchitectureForRun returns ARCH_ID
// without falling back to resolveDefaultArchitectureId.
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

describe('Integration Layer', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: phase1aAnalyzerPack.analyze() returns an AnalyzerResult with evidence atoms
  // ==========================================================================
  test('phase1aAnalyzerPack.analyze() returns an AnalyzerResult with evidence atoms', async () => {
    // We need to mock the sub-extractors and repo access to avoid real I/O
    jest.mock('../services/extractors/fileStructureExtractor', () => ({
      extractFileStructure: jest.fn().mockResolvedValue([
        {
          id: 'fs-atom-1',
          runId: 'test-run',
          repoUrl: 'https://github.com/org/repo',
          filePath: 'src/index.ts',
          type: 'file_structure',
          data: { relativePath: 'src/index.ts', extension: '.ts', sizeBytes: 100, lineCount: 10 },
          extractedAt: '2026-04-05T00:00:00Z',
        },
      ]),
    }));

    jest.mock('../services/extractors/symbolExtractor', () => ({
      extractSymbols: jest.fn().mockResolvedValue([
        {
          id: 'sym-atom-1',
          runId: 'test-run',
          repoUrl: 'https://github.com/org/repo',
          filePath: 'src/index.ts',
          type: 'symbol',
          data: { name: 'MyClass', kind: 'class', line: 5, scope: null, language: 'TypeScript' },
          extractedAt: '2026-04-05T00:00:00Z',
        },
      ]),
    }));

    jest.mock('../services/extractors/stringPatternExtractor', () => ({
      extractStringPatterns: jest.fn().mockResolvedValue([
        {
          id: 'sp-atom-1',
          runId: 'test-run',
          repoUrl: 'https://github.com/org/repo',
          filePath: 'src/index.ts',
          type: 'string_pattern',
          data: { patternName: 'import_statement', matchedText: "import express from 'express'", line: 1, contextSnippet: "import express from 'express';" },
          extractedAt: '2026-04-05T00:00:00Z',
        },
      ]),
    }));

    // Mock the repo access provider to avoid actual git cloning
    jest.mock('../services/repoAccess', () => ({
      ...jest.requireActual('../services/repoAccess'),
      gitCloneRepoAccess: {
        cloneRepo: jest.fn().mockResolvedValue('/tmp/test-clone'),
        cleanup: jest.fn().mockResolvedValue(undefined),
      },
    }));

    const { phase1aAnalyzerPack, setRepoAccessProvider } = require('../services/phase1aAnalyzerPack');

    // Override the repo access provider with a mock
    setRepoAccessProvider({
      cloneRepo: jest.fn().mockResolvedValue('/tmp/test-clone'),
      cleanup: jest.fn().mockResolvedValue(undefined),
    });

    const result = await phase1aAnalyzerPack.analyze({
      projectId: 'test-project',
      phase: 'phase1',
      step: '1a',
      context: {
        repos: [{ url: 'https://github.com/org/repo', branch: 'main' }],
        runId: 'test-run',
      },
    });

    // Verify the result shape
    expect(result.analyzerId).toBe('phase-1a-universal-extraction');
    expect(result.phase).toBe('phase1');
    expect(result.step).toBe('1a');
    expect(result.findings).toEqual([]);

    // Verify evidence atoms are present
    expect(result.evidenceAtoms).toBeDefined();
    expect(result.evidenceAtoms.length).toBe(3);

    // Verify atom types
    const types = result.evidenceAtoms.map((a: { type: string }) => a.type);
    expect(types).toContain('file_structure');
    expect(types).toContain('symbol');
    expect(types).toContain('string_pattern');

    // Verify metadata includes atom counts
    expect(result.metadata.atomCounts).toEqual({
      file_structure: 1,
      symbol: 1,
      string_pattern: 1,
    });
    expect(result.metadata.totalAtoms).toBe(3);
    expect(result.metadata.reposProcessed).toBe(1);
    expect(result.metadata.reposFailed).toBe(0);
  });

  // ==========================================================================
  // Test 2: phase1aAnalyzerPack is registered in the analyzer registry
  //         after initializeAnalyzerRegistry()
  // ==========================================================================
  test('phase1aAnalyzerPack is registered in the analyzer registry after initializeAnalyzerRegistry()', () => {
    const { initializeAnalyzerRegistry, getAnalyzerRegistry } = require('../services/analyzerRegistry');

    initializeAnalyzerRegistry();

    const registry = getAnalyzerRegistry();

    // Verify the Phase 1a analyzer pack is registered
    expect(registry.has('phase-1a-universal-extraction')).toBe(true);

    const pack = registry.get('phase-1a-universal-extraction');
    expect(pack).toBeDefined();
    expect(pack.id).toBe('phase-1a-universal-extraction');
    expect(pack.name).toBe('Phase 1a Universal Extraction');
    expect(pack.supportedPhases).toEqual(['phase1']);

    // Verify the stub pack is still registered (backward compatibility)
    expect(registry.has('stub-noop')).toBe(true);

    // Verify the registry has exactly 2 packs
    expect(registry.size).toBe(2);
  });

  // ==========================================================================
  // Test 3: archModelClient.bulkSaveEvidence() sends POST to the correct endpoint
  // ==========================================================================
  test('archModelClient.bulkSaveEvidence() sends a POST request to the correct endpoint with evidence atoms as the request body', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const runId = 'run-uuid-001';
    const atoms = [
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

    // Setup axios mock
    const axios = require('axios');
    const mockPost = jest.fn().mockResolvedValue({ data: atoms });
    const mockAxiosInstance = {
      post: mockPost,
        interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Import the client (after mocks are set up)
    const { archModelClient } = require('../services/archModelClient');

    await archModelClient.bulkSaveEvidence(projectId, runId, atoms);

    // Verify POST was called with the correct URL and body.
    // Production maps atoms to snake_case (run_id, repo_url, file_path,
    // extracted_at) and applies `?? null` defaulting for `source` and
    // `log_origin` before sending; assert the wire shape.
    const expectedAtomsBody = atoms.map((a) => ({
      id: a.id,
      run_id: a.runId,
      repo_url: a.repoUrl,
      file_path: a.filePath,
      type: a.type,
      data: a.data,
      extracted_at: a.extractedAt,
      source: null,
      log_origin: null,
    }));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/evidence`,
      expectedAtomsBody
    );
  });

  // ==========================================================================
  // Test 4: archModelClient.getEvidenceByRun() calls GET with optional ?type= query param
  // ==========================================================================
  test('archModelClient.getEvidenceByRun() calls GET with optional ?type= query param', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const runId = 'run-uuid-001';
    const mockAtoms = [
      {
        id: 'atom-1',
        runId,
        repoUrl: 'https://github.com/org/repo',
        filePath: 'src/index.ts',
        type: 'symbol',
        data: { name: 'MyClass', kind: 'class', line: 5, scope: null, language: 'TypeScript' },
        extractedAt: '2026-04-05T00:00:00Z',
      },
    ];

    // Setup axios mock
    const axios = require('axios');
    const mockGet = jest.fn().mockResolvedValue({ data: mockAtoms });
    const mockAxiosInstance = {
      get: mockGet,
        interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Import the client (after mocks are set up)
    const { archModelClient } = require('../services/archModelClient');

    // Call without type filter
    const resultNoType = await archModelClient.getEvidenceByRun(projectId, runId);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/evidence`,
      { params: {} }
    );
    expect(resultNoType).toEqual(mockAtoms);

    // Call with type filter
    mockGet.mockClear();
    const resultWithType = await archModelClient.getEvidenceByRun(projectId, runId, 'symbol');
    expect(mockGet).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/evidence`,
      { params: { type: 'symbol' } }
    );
    expect(resultWithType).toEqual(mockAtoms);
  });

  // ==========================================================================
  // Test 5: archModelClient.getEvidenceCount() calls GET on the /count endpoint
  //         and returns the numeric count
  // ==========================================================================
  test('archModelClient.getEvidenceCount() calls GET on the /count endpoint and returns the numeric count', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const runId = 'run-uuid-001';

    // Setup axios mock
    const axios = require('axios');
    const mockGet = jest.fn().mockResolvedValue({ data: 42 });
    const mockAxiosInstance = {
      get: mockGet,
        interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Import the client (after mocks are set up)
    const { archModelClient } = require('../services/archModelClient');

    const count = await archModelClient.getEvidenceCount(projectId, runId);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/evidence/count`
    );
    expect(count).toBe(42);
  });

  // ==========================================================================
  // Test 6: Run manager step 1a calls the 1a analyzer pack and persists atoms
  //         via archModelClient.bulkSaveEvidence(), then the pipeline
  //         (1a -> 1b -> 1c-llm-analysis) reaches COMPLETED with step 1a's
  //         atomCounts in the final stepsPayload.
  // ==========================================================================
  test('Run manager step 1a calls the 1a analyzer pack and persists atoms via bulkSaveEvidence()', async () => {
    const projectId = 'proj-001';
    const runId = 'run-001';

    // Create mock evidence atoms
    const mockAtoms = [
      {
        id: 'fs-1', runId, repoUrl: 'https://github.com/org/repo',
        filePath: 'src/index.ts', type: 'file_structure',
        data: { relativePath: 'src/index.ts', extension: '.ts', sizeBytes: 100, lineCount: 10 },
        extractedAt: '2026-04-05T00:00:00Z',
      },
      {
        id: 'sym-1', runId, repoUrl: 'https://github.com/org/repo',
        filePath: 'src/index.ts', type: 'symbol',
        data: { name: 'MyClass', kind: 'class', line: 5, scope: null, language: 'TypeScript' },
        extractedAt: '2026-04-05T00:00:00Z',
      },
    ];

    // Mock the analyzer registry to return a mock 1a analyzer pack
    const mockAnalyze = jest.fn().mockResolvedValue({
      analyzerId: 'phase-1a-universal-extraction',
      phase: 'phase1',
      step: '1a',
      findings: [],
      evidenceAtoms: mockAtoms,
      metadata: {
        atomCounts: { file_structure: 1, symbol: 1, string_pattern: 0 },
        totalAtoms: 2,
      },
    });

    jest.mock('../services/analyzerRegistry', () => ({
      getAnalyzerRegistry: jest.fn().mockReturnValue(
        new Map([
          ['phase-1a-universal-extraction', {
            id: 'phase-1a-universal-extraction',
            name: 'Phase 1a Universal Extraction',
            supportedPhases: ['phase1'],
            analyze: mockAnalyze,
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

    // Mock archModelClient with all methods needed by steps 1a, 1b, 1c-llm-analysis.
    jest.mock('../services/archModelClient', () => ({
      archModelClient: {
        getDiscoveryRun: jest.fn().mockResolvedValue({
          id: runId,
          project_id: projectId,
          service_id: null,
          mode: null,
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
          mode: null,
          status: 'RUNNING',
          current_step: '1a',
          config_snapshot: {},
          steps_payload: {},
          error_message: null,
          created_at: '2026-04-05T00:00:00Z',
          updated_at: '2026-04-05T00:00:00Z',
        }),
        bulkSaveEvidence: jest.fn().mockResolvedValue(undefined),
        getEvidenceByRun: jest.fn().mockResolvedValue([]),
        getEvidenceByRunPaginated: jest.fn().mockResolvedValue([]),
        getEvidenceCount: jest.fn().mockResolvedValue(0),
        bulkSaveRelationships: jest.fn().mockResolvedValue(undefined),
        getRelationshipsByRun: jest.fn().mockResolvedValue([]),
        getRelationshipsByRunPaginated: jest.fn().mockResolvedValue([]),
        getRelationshipCount: jest.fn().mockResolvedValue(0),
        bulkSaveCandidates: jest.fn().mockResolvedValue(undefined),
        bulkSaveDecisionTasks: jest.fn().mockResolvedValue(undefined),
        updateDecisionTask: jest.fn().mockResolvedValue({}),
        getClusterCount: jest.fn().mockResolvedValue(0),
        createDiscoveryRun: jest.fn(),
        getDiscoveryConfig: jest.fn(),
        // Methods added to archModelClient by committed specs that the V3
        // LLM-analysis step now calls. Defaults take the graceful/no-op path.
        resetDefaultArchitectureCache: jest.fn(),
        getModel: jest.fn().mockResolvedValue(null),
        getProject: jest.fn().mockResolvedValue(null),
        bulkCreateDiscoveryFindings: jest.fn().mockResolvedValue({ created: 0, findings: [] }),
      },
    }));

    // Mock the linker rule registry with an empty registry (no rules = no candidates in 1b)
    jest.mock('../services/linkerRuleRegistry', () => ({
      getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
      initializeLinkerRuleRegistry: jest.fn(),
      registerLinkerRule: jest.fn(),
    }));

    // Mock the gateway client (needed by executeStep1b)
    jest.mock('../services/gatewayClient', () => ({
      gatewayClient: {
        resolveDecisionTasks: jest.fn().mockResolvedValue({ results: [] }),
      },
    }));

    // Mock the repo-access seam so step `1c-llm-analysis` does NOT perform a
    // real git clone of the fixture repo URL.
    jest.mock('../services/repoAccess', () => ({
      ...jest.requireActual('../services/repoAccess'),
      buildTempDir: jest.fn(() => '/tmp/integration-mock-repo'),
      gitCloneRepoAccess: {
        cloneRepo: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
      },
    }));

    // Mock the LLM file-analysis step so 1c-llm-analysis completes without a
    // real LLM call. Empty candidates -> persist + emit no-op.
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

    // Mock uuid (needed by executeStep1b)
    jest.mock('uuid', () => ({
      v4: jest.fn(() => 'mock-uuid-integration'),
    }));

    // Import the real startRun (which will use our mocked dependencies)
    const { startRun } = require('../services/runManager');
    const { archModelClient } = require('../services/archModelClient');

    await startRun(projectId, runId, ARCH_ID);

    // Verify the analyzer pack was called with correct input
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    const analyzerInput = mockAnalyze.mock.calls[0][0];
    expect(analyzerInput.projectId).toBe(projectId);
    expect(analyzerInput.phase).toBe('phase1');
    expect(analyzerInput.step).toBe('1a');
    expect(analyzerInput.context.repos).toEqual([{ url: 'https://github.com/org/repo', branch: 'main' }]);

    // Verify bulkSaveEvidence was called with the atoms
    expect(archModelClient.bulkSaveEvidence).toHaveBeenCalledTimes(1);
    expect(archModelClient.bulkSaveEvidence).toHaveBeenCalledWith(
      projectId,
      runId,
      mockAtoms
    );

    // Verify updateDiscoveryRun was called, and the final call sets COMPLETED
    // with step 1a having atomCounts in its payload
    const updateCalls = archModelClient.updateDiscoveryRun.mock.calls;

    // Find the final COMPLETED call
    const completedCall = updateCalls.find(
      (call: unknown[]) => (call[2] as Record<string, unknown>).status === 'COMPLETED'
    );
    expect(completedCall).toBeDefined();
    const completedPayload = completedCall[2] as Record<string, unknown>;
    expect(completedPayload.current_step).toBeNull();

    // Verify step 1a in the completed stepsPayload has atomCounts
    const stepsPayload = completedPayload.steps_payload as Record<string, Record<string, unknown>>;
    expect(stepsPayload['1a'].status).toBe('completed');
    expect(stepsPayload['1a'].atomCounts).toEqual({
      file_structure: 1,
      symbol: 1,
      string_pattern: 0,
    });
  });
});
