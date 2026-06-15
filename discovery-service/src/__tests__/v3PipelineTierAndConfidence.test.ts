/**
 * Tests for Task Group 3 of the 2026-04-20 V3 Tier UX spec:
 *  - `runDiscoveryV3` accepts a caller-supplied `tier` and does NOT
 *    re-invoke `computeTier` when one is provided (route-driven path).
 *  - When no `tier` is supplied, the pipeline falls back to
 *    `computeTier(techHints)` (legacy / backward-compat path).
 *  - LLM-emitted candidates carry per-tag confidence via `getConfidenceForTag`
 *    (applied inside `llmGapFillStep.ts::buildDiscoveryCandidate`).
 *  - Pack-adapter candidates retain their explicit confidence; pack
 *    candidates emitted without confidence get the adapter midpoint.
 *
 * The `runLlmGapFill` stage is mocked at the module level so orchestrator
 * tests do not touch any gateway / LLM plumbing. The confidence-at-emission
 * tests for LLM paths exercise the REAL `buildDiscoveryCandidate` by
 * re-requiring the module under `jest.isolateModules` with
 * `jest.dontMock('../services/llmGapFillStep')` + a doMock'd gatewayClient.
 *
 * 2026-05-31 structured-metadata amendment: `llmGapFillStep.parseAndValidate`
 * now enforces a per-type structured-metadata gate (`hasRequiredStructuredFields`)
 * AFTER the shape check. A `business_logics` row needs `className` (recoverable
 * from a `Class.method` name via `enrichRawCandidate`, or supplied directly).
 * The Tier C confidence fixture below therefore carries `className` so it
 * represents a VALID candidate — the test's intent (llm-solo tag + in-range
 * confidence pass-through) is unchanged; only the fixture is made schema-valid.
 */

// ---------------------------------------------------------------------------
// Top-level mocks — hoisted by Jest before imports resolve.
// ---------------------------------------------------------------------------

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
  },
}));

// Default: `runLlmGapFill` is mocked at the module level so Group A / B
// tests do not touch the gateway. Group C re-imports the real module via
// `jest.isolateModules` after `jest.dontMock`-ing this path.
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
import * as extensionPackRegistry from '../services/extensionPackRegistry';
import { archModelClient } from '../services/archModelClient';
import { runDiscoveryV3 } from '../services/discoveryV3Pipeline';
import { runLlmGapFill } from '../services/llmGapFillStep';
import { CONFIDENCE_DEFAULTS } from '../services/confidence';

const runLlmGapFillMock = runLlmGapFill as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = 'run-tier-conf-001';
const TEST_PROJECT_ID = 'proj-tier-conf-001';

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

function makeFakeLanguagePack(id: string, language: string): LanguagePack {
  return {
    id,
    when: { language },
    extract: (sourceFiles) =>
      new Map(
        Array.from(sourceFiles.keys()).map((fp) => [fp, makeIr(fp)]),
      ),
  };
}

/** Framework pack factory with configurable emitted confidence. */
function makeFakeFrameworkPack(options: {
  id: string;
  language: string;
  technology: string;
  adapterTag: string;
  /**
   * If `undefined`, the adapter emits a candidate without setting
   * `confidence` on the candidate object (simulating an adapter that
   * expects the pipeline to fill it in). Otherwise the explicit value is
   * used verbatim on every emitted candidate.
   */
  emittedConfidence: number | undefined;
}): FrameworkPack {
  return {
    id: options.id,
    when: { language: options.language, technology: options.technology },
    adapt: (irFiles, runId): DiscoveryCandidate[] => {
      const out: DiscoveryCandidate[] = [];
      for (const filePath of irFiles.keys()) {
        const cand: Partial<DiscoveryCandidate> & Record<string, unknown> = {
          id: `pack-cand-${options.id}-${out.length}`,
          runId,
          candidateType: 'service',
          name: `PackService${out.length}`,
          status: 'proposed',
          sourceClusterIds: [filePath],
          data: { _addedBy: options.adapterTag },
          synthesizedAt: new Date().toISOString(),
        };
        if (options.emittedConfidence !== undefined) {
          cand.confidence = options.emittedConfidence;
        }
        out.push(cand as DiscoveryCandidate);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared beforeEach helpers
// ---------------------------------------------------------------------------

function resetArchMocks(): void {
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
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
  });
  (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
  (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);
}

function resetGapFillMock(): void {
  runLlmGapFillMock.mockReset();
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
}

// ===========================================================================
// Group A: Tier input precedence (route-supplied vs fallback)
// ===========================================================================
describe('runDiscoveryV3 — tier input precedence', () => {
  beforeEach(() => {
    clearRegistry();
    jest.clearAllMocks();
    resetArchMocks();
    resetGapFillMock();
  });

  test('uses caller-supplied tier verbatim and does not re-compute via computeTier', async () => {
    // Register packs that WOULD normally compute tier=A, but the caller
    // supplies tier='C' and the pipeline must trust that.
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack({
        id: 'spring-classic',
        language: 'Java',
        technology: 'Spring',
        adapterTag: 'spring-classic-adapter',
        emittedConfidence: 0.9,
      }),
    );

    const computeTierSpy = jest.spyOn(extensionPackRegistry, 'computeTier');

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
      tier: 'C',
    });

    expect(result.tier).toBe('C');
    expect(computeTierSpy).not.toHaveBeenCalled();

    // The persisted `mode` on the run row must match the supplied tier.
    const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    const modeCall = updateCalls.find(
      (c) => (c[2] as { mode?: string }).mode === 'C',
    );
    expect(modeCall).toBeDefined();

    computeTierSpy.mockRestore();
  });

  test('falls back to computeTier(techHints) when no tier is supplied', async () => {
    // Register a language pack only — with no tier override, fallback
    // should compute tier='B'.
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));

    const computeTierSpy = jest.spyOn(extensionPackRegistry, 'computeTier');

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' } },
      // No `tier` supplied — legacy path.
    });

    expect(result.tier).toBe('B');
    expect(computeTierSpy).toHaveBeenCalledTimes(1);

    computeTierSpy.mockRestore();
  });
});

// ===========================================================================
// Group B: Adapter candidate confidence backfill
// ===========================================================================
describe('runDiscoveryV3 — pack-adapter candidate confidence', () => {
  beforeEach(() => {
    clearRegistry();
    jest.clearAllMocks();
    resetArchMocks();
    resetGapFillMock();
  });

  test('preserves adapter-emitted explicit confidence (no clobber)', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack({
        id: 'spring-classic',
        language: 'Java',
        technology: 'Spring',
        adapterTag: 'spring-classic-adapter',
        emittedConfidence: 0.88, // Explicit in-range adapter value.
      }),
    );

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    expect(result.candidates).toHaveLength(1);
    // Adapter-set value kept verbatim — NOT replaced by the midpoint.
    expect(result.candidates[0].confidence).toBe(0.88);
  });

  test('fills in adapter midpoint (0.9) when adapter omits confidence', async () => {
    registerLanguagePack(makeFakeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(
      makeFakeFrameworkPack({
        id: 'spring-classic',
        language: 'Java',
        technology: 'Spring',
        adapterTag: 'spring-classic-adapter',
        emittedConfidence: undefined, // Adapter leaves confidence unset.
      }),
    );

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    expect(result.candidates).toHaveLength(1);
    // Defaults table: adapter = 0.9.
    expect(result.candidates[0].confidence).toBe(CONFIDENCE_DEFAULTS.adapter);
  });
});

// ===========================================================================
// Group C: LLM-emitted candidate confidence via real llmGapFillStep
// ===========================================================================
//
// These tests exercise the REAL `llmGapFillStep.buildDiscoveryCandidate`
// path by using `jest.isolateModules` to re-require the module with the
// top-level `jest.mock('../services/llmGapFillStep', ...)` temporarily
// unmocked, and with `../services/gatewayClient` stubbed so we control the
// LLM response. This verifies `getConfidenceForTag` is actually applied
// inside the gap-fill stage at candidate emission time.
//
describe('llmGapFillStep — confidence applied at LLM candidate emission', () => {
  type GapFillRunner = (input: {
    runId: string;
    files: Array<Record<string, unknown>>;
  }) => Promise<{
    llmCandidates: Array<DiscoveryCandidate & Record<string, unknown>>;
    stageStatus: string;
    failures: Array<unknown>;
  }>;

  /**
   * Re-require the REAL `llmGapFillStep` with a doMock'd `gatewayClient`
   * so the stage's internal `getConfidenceForTag` wiring is exercised.
   * The top-level `jest.mock` is undone for this isolated module scope.
   */
  async function setupRealGapFill(llmContent: string): Promise<{
    runner: GapFillRunner;
    gapFillMock: jest.Mock;
  }> {
    let runner: GapFillRunner | null = null;
    let gapFillMock: jest.Mock | null = null;

    await jest.isolateModulesAsync(async () => {
      // Unmock llmGapFillStep so we get the REAL module.
      jest.dontMock('../services/llmGapFillStep');

      // Stub the gateway client (the only external dependency the stage
      // has beyond the composer + dedup helpers).
      jest.doMock('../services/gatewayClient', () => ({
        gatewayClient: {
          gapFill: jest.fn().mockResolvedValue({ content: llmContent }),
        },
        GapFillGatewayError: class extends Error {
          public readonly filePath: string;
          public readonly status: number | null;
          constructor(message: string, filePath: string, status: number | null) {
            super(message);
            this.filePath = filePath;
            this.status = status;
          }
        },
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const realMod = require('../services/llmGapFillStep');
      runner = realMod.runLlmGapFill as GapFillRunner;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const gatewayMod = require('../services/gatewayClient');
      gapFillMock = gatewayMod.gatewayClient.gapFill as jest.Mock;
    });

    if (!runner || !gapFillMock) {
      throw new Error('Failed to load real llmGapFillStep');
    }
    return { runner, gapFillMock };
  }

  beforeEach(() => {
    delete process.env.CONFIDENCE_LLM_GAP_FILL;
    delete process.env.CONFIDENCE_LLM_IR_GUIDED;
    delete process.env.CONFIDENCE_LLM_SOLO;
  });

  test('Tier A emits _addedBy=llm-gap-fill; in-range LLM confidence (0.75) passes through', async () => {
    const { runner } = await setupRealGapFill(
      JSON.stringify([
        {
          type: 'class',
          name: 'SynthA',
          filePath: 'a.java',
          confidence: 0.75,
        },
      ]),
    );

    const result = await runner({
      runId: 'run-A',
      files: [
        {
          filePath: 'a.java',
          sourceCode: 'class A {}',
          tier: 'A',
          language: 'java',
          frameworkPackId: 'spring-classic',
          packCandidates: [],
          ir: null,
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0];
    expect(c._addedBy).toBe('llm-gap-fill');
    // 0.75 is exactly the midpoint / inside [0.7, 0.8] — kept verbatim.
    expect(c.confidence).toBe(CONFIDENCE_DEFAULTS['llm-gap-fill']);
  });

  test('Tier B emits _addedBy=llm-ir-guided; out-of-range value clamps into [0.5, 0.7]', async () => {
    const { runner } = await setupRealGapFill(
      JSON.stringify([
        {
          type: 'class',
          name: 'SynthB',
          filePath: 'b.java',
          confidence: 0.95, // Above the llm-ir-guided range [0.5, 0.7].
        },
      ]),
    );

    const result = await runner({
      runId: 'run-B',
      files: [
        {
          filePath: 'b.java',
          sourceCode: 'class B {}',
          tier: 'B',
          language: 'java',
          frameworkPackId: null,
          packCandidates: [],
          ir: { classes: [], methods: [], imports: [] },
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0];
    expect(c._addedBy).toBe('llm-ir-guided');
    // Clamped to the range maximum 0.7.
    expect(c.confidence).toBe(0.7);
  });

  test('Tier C emits _addedBy=llm-solo; in-range LLM confidence (0.4) passes through', async () => {
    // `business_logics` rows must carry `className` to clear the structured-
    // metadata gate (`hasRequiredStructuredFields`). Supplied here directly so
    // the fixture is a VALID candidate; the assertion target is unchanged
    // (llm-solo tag + verbatim in-range 0.4 confidence).
    const { runner } = await setupRealGapFill(
      JSON.stringify([
        {
          type: 'business_logics',
          name: 'MysteryRule',
          className: 'LegacyBatchJob',
          filePath: 'scripts/legacy.pl',
          confidence: 0.4, // Midpoint of [0.3, 0.5].
        },
      ]),
    );

    const result = await runner({
      runId: 'run-C',
      files: [
        {
          filePath: 'scripts/legacy.pl',
          sourceCode: '#!/usr/bin/perl\nprint "hi";\n',
          tier: 'C',
          language: null,
          frameworkPackId: null,
          packCandidates: [],
          ir: null,
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0];
    expect(c._addedBy).toBe('llm-solo');
    // 0.4 is the llm-solo midpoint and in-range — kept verbatim.
    expect(c.confidence).toBe(CONFIDENCE_DEFAULTS['llm-solo']);
  });
});
