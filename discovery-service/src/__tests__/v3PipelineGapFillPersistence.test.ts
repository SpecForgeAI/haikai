/**
 * Tests for Task Group 6 — persist `promptVersion` + stage-payload fields on
 * `steps_payload.v3.gapFill` via `updateDiscoveryRun`.
 *
 * Spec: 2026-04-19 V3 Layered Prompt System.
 *
 * Focused tests (4 cases, within the 2-8 target):
 *  1. Completed run records `steps_payload.v3.gapFill.promptVersion` with all
 *     four 8-char hashes (`base`, `language`, `framework`, `composed`) and each
 *     is a non-empty string of length 8.
 *  2. `steps_payload.v3.gapFill.failures[]` persists per-file failure records
 *     (regression check covering Task Group 5's contribution).
 *  3. `dedupDroppedCount` persists on the stage payload.
 *  4. When every file skipped the LLM call, `runLlmGapFill` returns a
 *     synthetic empty-hash `promptVersion`. That still persists cleanly as a
 *     four-field object (never `undefined`) — Task Group 6 edge case.
 *
 * `runLlmGapFill` is mocked so these tests exercise purely the persistence
 * wiring between the pipeline's gap-fill stage and `updateDiscoveryRun`.
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

// Mock the gap-fill stage so tests exercise only the pipeline's persistence.
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

const TEST_RUN_ID = 'run-v3-tg6-001';
const TEST_PROJECT_ID = 'proj-v3-tg6-001';

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

/**
 * Find the `updateDiscoveryRun` call that carried the `steps_payload.v3.gapFill`
 * section. Returns the payload (third positional argument) for assertions.
 */
function findGapFillUpdatePayload(): {
  steps_payload: { v3: { gapFill: Record<string, unknown> } };
} {
  const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
  const gapFillCall = updateCalls.find((c) => {
    const payload = c[2] as { steps_payload?: Record<string, unknown> };
    const v3 = payload?.steps_payload?.v3 as Record<string, unknown> | undefined;
    return v3?.gapFill !== undefined;
  });
  expect(gapFillCall).toBeDefined();
  return gapFillCall![2] as {
    steps_payload: { v3: { gapFill: Record<string, unknown> } };
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Task Group 6: persistGapFillStagePayload persists promptVersion + metrics', () => {
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
  });

  // =========================================================================
  // Test 1: promptVersion persists with all four 8-char hashes.
  // =========================================================================
  test('records promptVersion with all four 8-char SHA-256 hashes', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    // Four distinct 8-char hashes — what `composePrompt` would emit in a
    // real run via `runLlmGapFill`.
    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 0,
      crossFileDedupCount: 0,
      promptVersion: {
        base: 'a1b2c3d4',
        language: '11223344',
        framework: 'deadbeef',
        composed: 'cafebabe',
      },
    });

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const payload = findGapFillUpdatePayload();
    const gap = payload.steps_payload.v3.gapFill;

    expect(gap.promptVersion).toBeDefined();
    expect(gap.promptVersion).toEqual({
      base: 'a1b2c3d4',
      language: '11223344',
      framework: 'deadbeef',
      composed: 'cafebabe',
    });

    // Strict shape per spec acceptance criterion: each of the four fields is
    // a non-empty string of length 8.
    const pv = gap.promptVersion as Record<string, unknown>;
    for (const key of ['base', 'language', 'framework', 'composed']) {
      expect(typeof pv[key]).toBe('string');
      expect((pv[key] as string).length).toBe(8);
    }
  });

  // =========================================================================
  // Test 2: failures[] persists per-file failure records (regression).
  // =========================================================================
  test('persists failures[] with per-file { filePath, error } records', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [
        { filePath: 'src/main/java/A.java', error: 'non-JSON response' },
        { filePath: 'src/main/java/B.java', error: 'network timeout' },
      ],
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

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const payload = findGapFillUpdatePayload();
    const gap = payload.steps_payload.v3.gapFill;

    expect(gap.failures).toEqual([
      { filePath: 'src/main/java/A.java', error: 'non-JSON response' },
      { filePath: 'src/main/java/B.java', error: 'network timeout' },
    ]);
  });

  // =========================================================================
  // Test 3: dedupDroppedCount persists on the stage payload.
  // =========================================================================
  test('persists dedupDroppedCount on the gap-fill stage payload', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 7,
      crossFileDedupCount: 0,
      promptVersion: {
        base: '11111111',
        language: '22222222',
        framework: '33333333',
        composed: '44444444',
      },
    });

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const payload = findGapFillUpdatePayload();
    const gap = payload.steps_payload.v3.gapFill;

    expect(gap.dedupDroppedCount).toBe(7);
  });

  // =========================================================================
  // Test 4: all-files-skipped edge case — synthetic promptVersion still
  // persists as a four-field object (never undefined).
  // =========================================================================
  test('persists a four-field promptVersion even when all files skipped the LLM call', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    // Task Group 4 specifies: when every file skipped, `runLlmGapFill`
    // returns a synthetic empty-string `PromptVersion` so the output shape
    // stays stable for persistence.
    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 0,
      crossFileDedupCount: 0,
      promptVersion: {
        base: '',
        language: '',
        framework: '',
        composed: '',
      },
    });

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const payload = findGapFillUpdatePayload();
    const gap = payload.steps_payload.v3.gapFill;

    // Must be defined (not undefined) and carry all four fields, even if
    // those fields are empty strings.
    expect(gap.promptVersion).toBeDefined();
    expect(gap.promptVersion).not.toBeNull();
    const pv = gap.promptVersion as Record<string, unknown>;
    expect(Object.keys(pv).sort()).toEqual(['base', 'composed', 'framework', 'language']);
    for (const key of ['base', 'language', 'framework', 'composed']) {
      expect(pv[key]).not.toBeUndefined();
      expect(typeof pv[key]).toBe('string');
    }
  });

  // =========================================================================
  // Test 5: Bug 4 fix (2026-04-20) — crossFileDedupCount persists on the
  // gap-fill stage payload so observability can monitor cross-file coalesce.
  // =========================================================================
  test('persists crossFileDedupCount on the gap-fill stage payload (Bug 4)', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack('spring-classic', 'Java', 'Spring', 'spring-classic-adapter'),
    );

    runLlmGapFillMock.mockResolvedValueOnce({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 2,
      crossFileDedupCount: 13,
      promptVersion: {
        base: 'a1a1a1a1',
        language: 'b2b2b2b2',
        framework: 'c3c3c3c3',
        composed: 'd4d4d4d4',
      },
    });

    const sourceFiles = new Map<string, string>([
      ['src/main/java/A.java', 'class A {}'],
    ]);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    const payload = findGapFillUpdatePayload();
    const gap = payload.steps_payload.v3.gapFill;

    expect(gap.crossFileDedupCount).toBe(13);
    // Sanity: the older dedupDroppedCount is unaffected by the new field.
    expect(gap.dedupDroppedCount).toBe(2);
  });
});
