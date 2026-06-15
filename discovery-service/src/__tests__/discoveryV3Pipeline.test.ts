/**
 * Tests for the V3 Discovery Pipeline Orchestrator.
 *
 * Originally authored for the V3 Discovery Pipeline Foundation (Task Group 5)
 * stub. Updated by the 2026-04-19 V3 Layered Prompt System spec (Task Group
 * 5 — wire `runLlmGapFill` into `runDiscoveryV3`) to match the real gap-fill
 * stage: the earlier `V3_STAGE3_STUB_MARKER` has been retired. Tests now:
 *
 *   1. `runDiscoveryV3` persists `steps_payload.v3.gapFill` with stage
 *      metrics (stageStatus, dedupDroppedCount, failures, filesProcessed)
 *      on EVERY run, regardless of matched packs.
 *   2. `runDiscoveryV3` with techHints matching Java + Spring runs both
 *      stages and returns candidates tagged `_addedBy: 'spring-classic-adapter'`.
 *   3. `runDiscoveryV3` computes and persists the tier on the run record
 *      (A when spring-classic present, B when only the language pack
 *      registers, C when neither registers). Covers all three tiers.
 *
 * `runLlmGapFill` is mocked so these tests focus purely on the orchestrator
 * wiring, not the stage-level mechanics (those live in
 * `llmGapFillStep.test.ts` and `v3PipelineGapFillIntegration.test.ts`).
 *
 * Persistence is mocked — real candidate / steps_payload persistence is
 * integration-verified in Task Group 7 via the OpenMRS local harness.
 */

// Mock dotenv before importing anything else so config side-effects don't hit disk.
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

// Mock the gap-fill stage — the orchestrator tests only need to verify the
// call happens and the output flows into the pipeline result / persistence.
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

const TEST_RUN_ID = 'run-v3-001';
const TEST_PROJECT_ID = 'proj-v3-001';

/** A minimal SourceFileIR the fake language pack will emit per file. */
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

/** Builds a fake LanguagePack matching `when.language`. */
function makeFakeLanguagePack(
  id: string,
  language: string,
  extractImpl?: (sourceFiles: Map<string, string>) => Map<string, SourceFileIR>,
): LanguagePack {
  return {
    id,
    when: { language },
    extract: (sourceFiles) =>
      extractImpl
        ? extractImpl(sourceFiles)
        : new Map(
            Array.from(sourceFiles.keys()).map((fp) => [fp, makeIr(fp)]),
          ),
  };
}

/** Builds a fake FrameworkPack matching `when.language` + `when.technology`. */
function makeFakeFrameworkPack(
  id: string,
  language: string,
  technology: string,
  adapterTag: string,
  candidateCount: number,
): FrameworkPack {
  return {
    id,
    when: { language, technology },
    adapt: (irFiles, runId): DiscoveryCandidate[] => {
      const out: DiscoveryCandidate[] = [];
      for (let i = 0; i < candidateCount; i++) {
        out.push({
          id: `fake-cand-${id}-${i}`,
          runId,
          candidateType: 'service',
          name: `FakeService${i}`,
          confidence: 0.9,
          status: 'proposed',
          sourceClusterIds: Array.from(irFiles.keys()).slice(0, 1),
          data: { _addedBy: adapterTag },
          synthesizedAt: new Date().toISOString(),
        });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Task Group 5: runDiscoveryV3 orchestrator', () => {
  beforeEach(() => {
    clearRegistry();
    jest.clearAllMocks();

    // Default: getDiscoveryRun returns a run with an empty steps_payload so
    // the gap-fill payload merge has something to merge into.
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
  // Test 1: steps_payload.v3.gapFill is written on EVERY run.
  // =========================================================================
  test('writes steps_payload.v3.gapFill with stage metrics on every run', async () => {
    // Tier C: no packs registered — payload must still be written.
    const sourceFiles = new Map<string, string>([
      ['src/Foo.java', 'public class Foo {}'],
    ]);

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { repo1: { language: 'Python' } },
    });

    const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const gapFillCall = updateCalls.find((c) => {
      const payload = c[2] as { steps_payload?: Record<string, unknown> };
      const v3 = payload?.steps_payload?.v3 as Record<string, unknown> | undefined;
      return v3?.gapFill !== undefined;
    });
    expect(gapFillCall).toBeDefined();

    const payload = gapFillCall![2] as {
      steps_payload: { v3: { gapFill: Record<string, unknown> } };
      mode?: string;
    };
    const gap = payload.steps_payload.v3.gapFill;
    expect(gap.stageStatus).toBe('completed');
    expect(gap.dedupDroppedCount).toBe(0);
    expect(gap.failures).toEqual([]);
    expect(gap.filesProcessed).toBe(1);

    // Tier C, no packs -> no pack candidates, no LLM candidates (stubbed).
    expect(result.candidates).toHaveLength(0);
    expect(result.tier).toBe('C');
  });

  // =========================================================================
  // Test 2: Java + Spring techHints runs both stages and returns
  //         `_addedBy: 'spring-classic-adapter'`-tagged candidates.
  // =========================================================================
  test('with Java + Spring techHints runs both stages and emits spring-classic-adapter-tagged candidates', async () => {
    const javaPack = makeFakeLanguagePack('java-lang', 'Java');
    const springPack = makeFakeFrameworkPack(
      'spring-classic',
      'Java',
      'Spring',
      'spring-classic-adapter',
      3,
    );
    registerLanguagePack(javaPack);
    registerFrameworkPack(springPack);

    const sourceFiles = new Map<string, string>([
      ['src/A.java', 'class A {}'],
      ['src/B.java', 'class B {}'],
    ]);

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      // Classic-spring techHints split shape produced by parseCoretech.
      techHints: {
        '0': { language: 'Java' },
        '1': { technology: 'Spring' },
      },
    });

    expect(result.tier).toBe('A');
    expect(result.candidates).toHaveLength(3);
    // Every candidate must carry the spring-classic-adapter tag. Spec 0
    // (Unique, Aggregate Discovery Candidates, Q4) upgraded `data._addedBy` to a
    // `string[]` set of contributing sources, so the merged survivor carries the
    // tag as a single-element array (these fake candidates pass through the merge
    // as single-source survivors).
    for (const c of result.candidates) {
      const addedBy = (c.data as { _addedBy?: string[] | string })._addedBy;
      const labels = Array.isArray(addedBy) ? addedBy : [addedBy];
      expect(labels).toContain('spring-classic-adapter');
    }

    // Stage 1 ran: `filesAnalyzed` == number of IR files == input files.
    expect(result.filesAnalyzed).toBe(2);

    // Stage 4 persisted candidates via bulkSaveCandidates.
    expect(archModelClient.bulkSaveCandidates).toHaveBeenCalledTimes(1);
    const [projId, runId, batch] = (archModelClient.bulkSaveCandidates as jest.Mock).mock.calls[0];
    expect(projId).toBe(TEST_PROJECT_ID);
    expect(runId).toBe(TEST_RUN_ID);
    expect(batch).toHaveLength(3);
  });

  // =========================================================================
  // Test 2b (bug-fix 2026-05-29): the pipeline RETURNS its findings on the
  // result (`findingInputs`) instead of emitting them inline. Emission is
  // deferred to runManager, AFTER candidates persist, so the findings'
  // discovery_candidate links validate at AMS. Previously the inline
  // pre-persist emit hit dangling links -> AMS rolled back the whole bulk ->
  // FindingEmitter soft-failed -> the Findings tab silently showed 0.
  // =========================================================================
  test('returns built findings on the result for deferred post-persist emission; every candidate link targets a returned candidate', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter', 3),
    );

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    // Each fake `service` candidate has no owner + no parent, so the
    // evidence-gap scanner yields a `service_missing_owner` finding per candidate.
    expect(Array.isArray(result.findingInputs)).toBe(true);
    expect(result.findingInputs!.length).toBeGreaterThanOrEqual(3);

    // The core invariant that makes deferred emission safe: every
    // discovery_candidate link points at a candidate present in the SAME
    // result set, so runManager persisting candidates first makes the links
    // resolve at AMS.
    const candidateIds = new Set(result.candidates.map((c) => c.id));
    const candidateLinks = result
      .findingInputs!.flatMap((f) => f.links ?? [])
      .filter((l) => l.targetType === 'discovery_candidate');
    expect(candidateLinks.length).toBeGreaterThan(0);
    for (const link of candidateLinks) {
      expect(candidateIds.has(link.targetId)).toBe(true);
    }
  });

  // =========================================================================
  // Test 3: Tier is persisted on the run record — A, B, C all covered.
  // =========================================================================
  test('computes and persists tier (A when both match, B when only language, C when neither)', async () => {
    // ----- Tier A: LanguagePack + FrameworkPack -----
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter', 1),
    );

    const resultA = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });
    expect(resultA.tier).toBe('A');

    // Verify mode='A' was sent to updateDiscoveryRun.
    const callsAfterA = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    const modeACall = callsAfterA.find(
      (c) => (c[2] as { mode?: string }).mode === 'A',
    );
    expect(modeACall).toBeDefined();

    // ----- Tier B: LanguagePack only -----
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
        base: 'aaaaaaaa',
        language: 'bbbbbbbb',
        framework: 'cccccccc',
        composed: 'dddddddd',
      },
    });

    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    // No framework pack registered → Tier B.

    const resultB = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' } },
    });
    expect(resultB.tier).toBe('B');
    // No framework pack → no candidates.
    expect(resultB.candidates).toHaveLength(0);
    const callsAfterB = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    const modeBCall = callsAfterB.find(
      (c) => (c[2] as { mode?: string }).mode === 'B',
    );
    expect(modeBCall).toBeDefined();

    // ----- Tier C: nothing matches -----
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
        base: 'aaaaaaaa',
        language: 'bbbbbbbb',
        framework: 'cccccccc',
        composed: 'dddddddd',
      },
    });

    const resultC = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.py', 'print(1)']]),
      techHints: { '0': { language: 'Python' } },
    });
    expect(resultC.tier).toBe('C');
    expect(resultC.candidates).toHaveLength(0);
    const callsAfterC = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    const modeCCall = callsAfterC.find(
      (c) => (c[2] as { mode?: string }).mode === 'C',
    );
    expect(modeCCall).toBeDefined();
  });
});
