/**
 * Tests for Task Group 5 — wire `llmGapFillStep` into `runDiscoveryV3`.
 *
 * Spec: 2026-04-19 V3 Layered Prompt System.
 *
 * Focused tests (5 cases, within the 2–8 target):
 *  1. `runDiscoveryV3` invokes `runLlmGapFill` after the pack stage.
 *  2. Surviving LLM candidates are merged with pack candidates in the final
 *     pipeline output (pack candidates appear first, LLM candidates appended).
 *  3. Pack candidates are untouched by the gap-fill stage (identity
 *     preservation — referential equality preserved on merge).
 *  4. `steps_payload.gapFill` is populated via `updateDiscoveryRun` with
 *     `stageStatus`, `dedupDroppedCount`, `failures`, and `filesProcessed`.
 *  5. Tier is threaded through to the per-file gap-fill input: Tier A files
 *     get `frameworkPackId` set; Tier B/C files have it null.
 *
 * `runLlmGapFill` is mocked so these tests focus purely on wiring without
 * touching the gateway. Per-file LLM mechanics live in
 * `llmGapFillStep.test.ts` (Task Group 4).
 */

// Mock dotenv before importing anything so config side-effects don't hit disk.
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock the arch-model-service HTTP client — only the methods the V3
// orchestrator actually calls need to exist.
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
  },
}));

// Mock the gap-fill stage so tests exercise only the pipeline wiring.
jest.mock('../services/llmGapFillStep', () => ({
  runLlmGapFill: jest.fn(),
}));

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import type { LanguagePack, FrameworkPack } from '../services/extensionPacks';
import {
  clearRegistry,
  registerLanguagePack,
  registerFrameworkPack,
} from '../services/extensionPackRegistry';
import { archModelClient } from '../services/archModelClient';
import { runDiscoveryV3 } from '../services/discoveryV3Pipeline';
import { runLlmGapFill } from '../services/llmGapFillStep';

const runLlmGapFillMock = runLlmGapFill as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = 'run-v3-tg5-001';
const TEST_PROJECT_ID = 'proj-v3-tg5-001';

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

function makeFakeLanguagePack(
  id: string,
  language: string,
): LanguagePack {
  return {
    id,
    when: { language },
    extract: (sourceFiles) =>
      new Map(
        Array.from(sourceFiles.keys()).map((fp) => [fp, makeIr(fp)]),
      ),
  };
}

/**
 * Builds a fake FrameworkPack. Emits one candidate per IR file, with
 * `sourceClusterIds[0]` pointing at the file so per-file dedup and per-file
 * gap-fill routing can be exercised.
 */
function makeFakeFrameworkPack(
  id: string,
  language: string,
  technology: string,
  adapterTag: string,
): FrameworkPack {
  return {
    id,
    when: { language, technology },
    adapt: (irFiles, runId): DiscoveryCandidate[] => {
      const out: DiscoveryCandidate[] = [];
      let i = 0;
      for (const filePath of irFiles.keys()) {
        out.push({
          id: `pack-cand-${id}-${i}`,
          runId,
          candidateType: 'service',
          name: `PackService${i}`,
          confidence: 0.9,
          status: 'proposed',
          sourceClusterIds: [filePath],
          data: { _addedBy: adapterTag },
          synthesizedAt: new Date().toISOString(),
        });
        i += 1;
      }
      return out;
    },
  };
}

function makeLlmCandidate(name: string, filePath: string): DiscoveryCandidate {
  return {
    id: '',
    runId: TEST_RUN_ID,
    candidateType: 'class',
    name,
    confidence: 0.7,
    status: 'proposed',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: new Date().toISOString(),
    // Stage-injected marker, kept on top-level per llmGapFillStep output.
    ...({ _addedBy: 'llm-gap-fill', discoveryRunId: TEST_RUN_ID } as Record<string, unknown>),
  } as DiscoveryCandidate & Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Task Group 5: runDiscoveryV3 wires llmGapFillStep', () => {
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
      created_at: '2026-04-19T10:00:00Z',
      updated_at: '2026-04-19T10:00:00Z',
    });
    (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
    (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);

    // Default gap-fill: succeeds with zero LLM candidates.
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

  // =========================================================================
  // Test 1: runLlmGapFill is invoked after the pack stage.
  // =========================================================================
  test('invokes runLlmGapFill after Stage 2 with runId + per-file inputs', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
      ['src/main/java/B.java', 'class B {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    expect(runLlmGapFillMock).toHaveBeenCalledTimes(1);
    const input = runLlmGapFillMock.mock.calls[0][0];
    expect(input.runId).toBe(TEST_RUN_ID);
    expect(Array.isArray(input.files)).toBe(true);
    expect(input.files).toHaveLength(2);
    // Per-file input carries filePath + sourceCode.
    const paths = input.files.map((f: { filePath: string }) => f.filePath).sort();
    expect(paths).toEqual(['src/main/java/A.java', 'src/main/java/B.java']);
    for (const f of input.files as Array<{ sourceCode: string }>) {
      expect(typeof f.sourceCode).toBe('string');
      expect(f.sourceCode.length).toBeGreaterThan(0);
    }
  });

  // =========================================================================
  // Test 2: LLM candidates are merged (appended) to pack candidates.
  // =========================================================================
  test('merges surviving LLM candidates with pack candidates in pipeline output', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    const llmCand1 = makeLlmCandidate('LlmDiscoveredClass1', 'src/main/java/A.java');
    const llmCand2 = makeLlmCandidate('LlmDiscoveredClass2', 'src/main/java/B.java');
    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [llmCand1, llmCand2],
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

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
      ['src/main/java/B.java', 'class B {}'],
    ]);

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    // 2 pack candidates + 2 LLM candidates = 4 total.
    expect(result.candidates).toHaveLength(4);

    // Pack candidates (from adapter) are present and tagged. Spec 0 (Q4)
    // upgraded `data._addedBy` to a `string[]`; the two `service` pack
    // candidates pass through the merge as single-source survivors carrying the
    // tag as a single-element array. (The LLM candidates are `class`-typed,
    // which the merge never touches, so they keep their top-level marker.)
    const packTagged = result.candidates.filter((c) => {
      const addedBy = (c.data as { _addedBy?: string[] | string })._addedBy;
      const labels = Array.isArray(addedBy) ? addedBy : addedBy ? [addedBy] : [];
      return labels.includes('spring-classic-adapter');
    });
    expect(packTagged).toHaveLength(2);

    // LLM candidates are present and tagged with `llm-gap-fill`.
    const llmTagged = result.candidates.filter(
      (c) => (c as unknown as { _addedBy?: string })._addedBy === 'llm-gap-fill',
    );
    expect(llmTagged).toHaveLength(2);
    const llmNames = llmTagged.map((c) => c.name).sort();
    expect(llmNames).toEqual(['LlmDiscoveredClass1', 'LlmDiscoveredClass2']);
  });

  // =========================================================================
  // Test 3: Pack candidates are untouched — identity preservation.
  // =========================================================================
  test('preserves pack-candidate object identity through the gap-fill stage', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    // Capture the pack candidates emitted by the adapter by spying on the
    // Stage 2 pack output via the mock's input argument: the gap-fill mock
    // receives `packCandidates` per file, and those must be the SAME objects
    // the pipeline later emits in `result.candidates`.
    runLlmGapFillMock.mockImplementation(async (input: { files: Array<{ packCandidates: DiscoveryCandidate[] }> }) => {
      // Return zero LLM candidates so only pack candidates survive.
      return {
        llmCandidates: [],
        stageStatus: 'completed',
        failures: [],
        dedupDroppedCount: 0,
        crossFileDedupCount: 0,
        promptVersion: {
          base: '00000000',
          language: '00000000',
          framework: '00000000',
          composed: '00000000',
        },
      };
    });

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
    ]);

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const input = runLlmGapFillMock.mock.calls[0][0] as { files: Array<{ packCandidates: DiscoveryCandidate[] }> };
    // The file with source path 'A.java' should have one pack candidate.
    const fileEntry = input.files.find((f) => (f as unknown as { filePath: string }).filePath === 'src/main/java/A.java')!;
    expect(fileEntry.packCandidates).toHaveLength(1);

    // The SAME candidate object must appear in the pipeline result.
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toBe(fileEntry.packCandidates[0]);
  });

  // =========================================================================
  // Test 4: steps_payload.gapFill carries stage metrics.
  // =========================================================================
  test('persists steps_payload.gapFill with stageStatus, dedupDroppedCount, failures, filesProcessed', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [{ filePath: 'src/main/java/B.java', error: 'non-JSON response' }],
      dedupDroppedCount: 3,
      crossFileDedupCount: 0,
      promptVersion: {
        base: 'eeeeeeee',
        language: 'ffffffff',
        framework: 'gggggggg',
        composed: 'hhhhhhhh',
      },
    });

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
      ['src/main/java/B.java', 'class B {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    // Find the PUT that carried the gapFill section.
    const gapFillCall = updateCalls.find((c) => {
      const payload = c[2] as { steps_payload?: Record<string, unknown> };
      const v3 = payload?.steps_payload?.v3 as Record<string, unknown> | undefined;
      return v3?.gapFill !== undefined;
    });
    expect(gapFillCall).toBeDefined();
    const payload = gapFillCall![2] as {
      steps_payload: { v3: { gapFill: Record<string, unknown> } };
    };
    const gap = payload.steps_payload.v3.gapFill;
    expect(gap.stageStatus).toBe('completed');
    expect(gap.dedupDroppedCount).toBe(3);
    expect(gap.failures).toEqual([{ filePath: 'src/main/java/B.java', error: 'non-JSON response' }]);
    expect(gap.filesProcessed).toBe(2);
  });

  // =========================================================================
  // Test 5: Tier threaded through to per-file gap-fill input.
  // =========================================================================
  test('threads the run-level tier to per-file gap-fill input (Tier A sets frameworkPackId)', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const input = runLlmGapFillMock.mock.calls[0][0] as {
      files: Array<{ tier: string; language: string | null; frameworkPackId: string | null }>;
    };
    expect(input.files).toHaveLength(1);
    expect(input.files[0].tier).toBe('A');
    expect(input.files[0].language).toBe('Java');
    expect(input.files[0].frameworkPackId).toBe('spring-classic');

    // --- Tier B: language pack only -----------------------------------------
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
      created_at: '2026-04-19T10:00:00Z',
      updated_at: '2026-04-19T10:00:00Z',
    });
    (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
    (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);
    runLlmGapFillMock.mockResolvedValue({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 0,
      crossFileDedupCount: 0,
      promptVersion: {
        base: '00000000',
        language: '00000000',
        framework: '00000000',
        composed: '00000000',
      },
    });

    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    // No framework pack registered -> Tier B.

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' } },
    });

    const tierBInput = runLlmGapFillMock.mock.calls[0][0] as {
      files: Array<{ tier: string; frameworkPackId: string | null }>;
    };
    expect(tierBInput.files[0].tier).toBe('B');
    expect(tierBInput.files[0].frameworkPackId).toBeNull();
  });
});
