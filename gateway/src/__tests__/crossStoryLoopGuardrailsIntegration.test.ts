/**
 * Cross-Story Context Injection -- Task Group 10 gap-filling tests.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection.
 *
 * After review of Groups 1-9 tests (see
 * `agent-os/specs/2026-05-20-cross-story-context-injection/verifications/loop-guardrail-coverage.md`),
 * three strategic gaps remained at the gateway / cross-layer boundary:
 *
 *   1. The per-batch `autoRunPass2: false` override is documented (and the
 *      handler implements it) but no existing test asserts that pass 2 is
 *      actually skipped when a per-batch override is provided AND the
 *      project-level default is ON. Other tests cover the project-default
 *      path; this one covers the per-batch override path explicitly.
 *
 *   2. Route-layer 409 mapping for `WorkstreamLockedError`. The
 *      `migrationShapeSpecGenerationRoute.test.ts` file covers the
 *      generate-batch and regenerate-single happy paths but never asserts
 *      the structured `{ code: 'WORKSTREAM_LOCKED', workstreamId, activePass }`
 *      envelope that the frontend depends on for the "Batch in progress"
 *      banner.
 *
 *   3. The handler's pass-2 `SpecGenerationResult` and the drawer's
 *      `StoryPassTwoDetail` are physically separate types in physically
 *      separate codebases. Group 5 tests cover the handler shape; Group 7
 *      tests cover the drawer shape; nothing pins the contract BETWEEN
 *      them. A silent rename or removal of any of the pass-2 fields would
 *      slip past both layers' tests. This test asserts that every field the
 *      drawer reads is produced by the handler with the same name and
 *      compatible type.
 *
 * Three strategic tests, well within Group 10's 10-test budget.
 */

// ---------------------------------------------------------------------------
// Mocks (declared first)
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Route-test mock for the handler (Test 2 only). The handler is the real
// module for Tests 1 and 3 -- the mock is only consulted by the route under
// test in Test 2 because the route imports the handler via the same module
// path. We control whether the mock is exercised by which path we call from
// each test.
const mockRunBatchForRoute = jest.fn();
jest.mock('../services/migrationShapeSpecGenerationHandler', () => {
  const actual = jest.requireActual(
    '../services/migrationShapeSpecGenerationHandler'
  );
  return {
    ...actual,
    // The route imports `runShapeSpecGenerationBatch` and
    // `WorkstreamLockedError`. We override the function so the route test
    // can drive a synthetic error path; everything else delegates to the
    // real module (including `WorkstreamLockedError` itself).
    runShapeSpecGenerationBatch: (...args: unknown[]) =>
      mockRunBatchForRoute(...args),
  };
});

// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import {
  runShapeSpecGenerationBatch as realRunShapeSpecGenerationBatch,
  __resetWorkstreamLocksForTests,
  WorkstreamLockedError,
  LoadedBookOfWork,
  MigrationStorySpecGenerationDto,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
  EpicCapturedDecisionAutoSeeder,
  ProjectConfigFetcher,
} from '../services/migrationShapeSpecGenerationHandler';
import { MigrationSpecContextDto } from '../services/migrationSpecContextClient';
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';

// Reach the REAL handler. Jest hoists the mock above so the module bound to
// `migrationShapeSpecGenerationHandler` is the mocked one; jest.requireActual
// gives us the unmocked module for Tests 1 and 3.
const realHandlerModule = jest.requireActual<
  typeof import('../services/migrationShapeSpecGenerationHandler')
>('../services/migrationShapeSpecGenerationHandler');
const runRealBatch =
  realHandlerModule.runShapeSpecGenerationBatch as typeof realRunShapeSpecGenerationBatch;

// ---------------------------------------------------------------------------
// Fixtures (mirrored from migrationShapeSpecGenerationHandlerTwoPass.test.ts)
// ---------------------------------------------------------------------------

function buildBow(): LoadedBookOfWork {
  return {
    bookOfWorkId: 'book-ten',
    projectId: 'proj-ten',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    items: [
      {
        id: 'I1',
        type: 'initiative',
        parentId: null,
        title: 'Initiative',
        sequenceOrder: 0,
        workItemId: 'wi-init',
      },
      {
        id: 'E1',
        type: 'epic',
        parentId: 'I1',
        title: 'Epic',
        sequenceOrder: 0,
        workItemId: 'wi-epic',
      },
      {
        id: 'F1',
        type: 'feature',
        parentId: 'E1',
        title: 'Feature',
        sequenceOrder: 0,
        workItemId: 'wi-feature',
      },
      {
        id: 'S1',
        type: 'story',
        parentId: 'F1',
        title: 'Story marker for cross-story injection',
        sequenceOrder: 1,
        workItemId: 'wi-s1',
      },
    ],
  };
}

function buildContextDto(bow: LoadedBookOfWork): MigrationSpecContextDto {
  return {
    projectId: bow.projectId,
    bookOfWorkId: bow.bookOfWorkId,
    bookItemId: 'S1',
    workItemId: 'wi-s1',
    currentArchitectureId: bow.currentArchitectureId,
    targetArchitectureId: bow.targetArchitectureId,
    generatedAt: '2026-05-20T12:00:00Z',
    service: {
      serviceId: 'svc-1',
      currentArchitectureRefs: ['app-cur-1'],
      targetArchitectureRefs: ['app-tgt-1'],
    },
    api: {
      operationId: 'op-1',
      oasContractId: 'oas-1',
      behaviourBaselineIds: ['baseline-1'],
      mappingIds: ['map-1'],
    },
  };
}

function llmBodyWith(storyTitle: string, decisions: string[]): string {
  const lines = [
    `/agent-os:shape-spec ${storyTitle}`,
    '',
    'Decisions:',
    ...decisions.map((d) => `- ${d}`),
    '',
    'Interfaces:',
    '- POST /api/widgets',
    '',
    'Assumptions:',
    '- workstream lead approved.',
  ];
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText: lines.join('\n'),
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions: ['workstream lead approved.'],
    tests: [
      { title: 'Contract test', description: 'Functional contract test.', type: 'functional' },
    ],
    affectedAreas: ['target/widgets/src/main/java/Widget.java'],
    coveredEndpointIds: [],
  });
}

interface BuildDepsOpts {
  autoRunPass2FromProjectConfig?: boolean;
  recordedContextCalls?: Array<Parameters<SpecContextFetcher>[0]>;
}

function buildDeps(bow: LoadedBookOfWork, opts: BuildDepsOpts = {}) {
  const recordedContextCalls = opts.recordedContextCalls ?? [];

  const loadBookOfWork = jest.fn(async () => bow) as unknown as BookOfWorkLoader;
  const loadExistingGenerations = jest.fn(
    async () => []
  ) as unknown as ExistingGenerationsLoader;

  const fetchSpecContext: SpecContextFetcher = jest.fn(async (input) => {
    recordedContextCalls.push(input);
    return buildContextDto(bow);
  });

  const passCounter: Record<string, number> = {};
  const callLlm: LlmCaller = jest.fn(async (input) => {
    const seq = passCounter[input.workItemId] || 0;
    passCounter[input.workItemId] = seq + 1;
    const story = bow.items.find((i) => i.workItemId === input.workItemId);
    const title = story?.title ?? 'Untitled';
    return {
      content: llmBodyWith(title, ['decision-a: keep current state']),
    };
  });

  const persistBatchResults: PersistBatchFn = jest.fn(
    async (_projectId, _bookOfWorkId, results) => ({
      persistedCount: results.length,
      resultsCouldNotPersist: 0,
      perStoryResults: results.map((r) => ({
        ...r,
        id: `persist-${r.workItemId}-pass${r.generationPass ?? 1}`,
      })),
    })
  );

  const autoSeed: EpicCapturedDecisionAutoSeeder = jest.fn(async () => ({}));
  const fetchProjectConfig: ProjectConfigFetcher = jest.fn(async () => ({
    perStoryContextTokenCap: 24000,
    crossStoryContextTokenCap: 12000,
    autoRunPass2: opts.autoRunPass2FromProjectConfig ?? true,
  }));

  return {
    loadBookOfWork,
    loadExistingGenerations,
    fetchSpecContext,
    callLlm,
    persistBatchResults,
    autoSeed,
    fetchProjectConfig,
    recordedContextCalls,
    asDeps: () => ({
      loadBookOfWork,
      loadExistingGenerations,
      fetchSpecContext,
      callLlm,
      persistBatchResults,
      autoSeedEpicCapturedDecision: autoSeed,
      fetchProjectConfig,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-Story Context Injection -- Task Group 10 gap-fillers', () => {
  beforeEach(() => {
    __resetWorkstreamLocksForTests();
    mockRunBatchForRoute.mockReset();
  });

  // -------------------------------------------------------------------------
  // Gap 1: per-batch `autoRunPass2: false` override skips pass 2 even when
  // the project default is true.
  // -------------------------------------------------------------------------
  it('autoRunPass2 per-batch override OFF -- pass 2 is skipped even when project default is ON', async () => {
    const bow = buildBow();
    const recordedContextCalls: Array<Parameters<SpecContextFetcher>[0]> = [];
    // Project default = true (so the project-level path would normally
    // trigger pass 2); per-batch override = false (must win).
    const deps = buildDeps(bow, {
      autoRunPass2FromProjectConfig: true,
      recordedContextCalls,
    });

    const result = await runRealBatch(
      {
        projectId: bow.projectId,
        bookOfWorkId: bow.bookOfWorkId,
        batchSize: 1,
        autoRunPass2: false,
      },
      deps.asDeps()
    );

    // Exactly ONE LLM call -- pass 1 only.
    expect((deps.callLlm as unknown as jest.Mock).mock.calls).toHaveLength(1);
    // Exactly ONE context call -- pass 1 only.
    expect(recordedContextCalls).toHaveLength(1);
    expect(recordedContextCalls[0].pass ?? 1).toBe(1);
    // The per-story result carries generationPass = 1.
    const story = result.perStoryResults.find((r) => r.workItemId === 'wi-s1')!;
    expect(story.generationPass).toBe(1);
    // No pass-2-specific fields are populated.
    expect(story.pass2ChangesSummary ?? null).toBeNull();
    expect(story.noMeaningfulChange ?? null).toBeNull();
    // The fetchProjectConfig dep MUST NOT have been called: the per-batch
    // override short-circuits the project-config lookup entirely. (This is
    // the behaviour the handler documents at lines 1011-1019.)
    expect(
      (deps.fetchProjectConfig as unknown as jest.Mock).mock.calls
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Gap 2: Route maps WorkstreamLockedError to HTTP 409 with the
  // WORKSTREAM_LOCKED envelope the frontend depends on.
  // -------------------------------------------------------------------------
  it('Route maps WorkstreamLockedError to HTTP 409 with WORKSTREAM_LOCKED envelope', async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      (req as unknown as { requestId: string }).requestId = 'group10-test';
      next();
    });
    app.use('/api/v1', migrationShapeSpecGenerationRouter);

    mockRunBatchForRoute.mockRejectedValueOnce(
      new WorkstreamLockedError('ws-shared', 2)
    );

    const res = await request(app)
      .post(
        '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/generate-batch'
      )
      .send({ workstreamId: 'ws-shared' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'WORKSTREAM_LOCKED',
      workstreamId: 'ws-shared',
      activePass: 2,
    });
    // The message must be a non-empty human-readable string so the UI
    // banner has fallback text.
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    // The frontend's WorkstreamLockedErrorPayload type-guard
    // (`specGenerationApi.ts` and `migrationShapeSpecCostPreviewApi.ts`)
    // checks exactly these fields -- if any drift, this test fails before
    // the UI does.
  });

  // -------------------------------------------------------------------------
  // Gap 3: Cross-layer contract -- the gateway's pass-2 SpecGenerationResult
  // produces every field the drawer's StoryPassTwoDetail reads.
  //
  // The drawer interface (frontend StoryPassTwoDetail) declares:
  //   - generationPass: number | null
  //   - pass1SpecText: string | null
  //   - generatedSpecText: string | null
  //   - pass2ChangesSummary: string | null
  //   - budgetMetaJson: Record<string, unknown> | null
  //   - noMeaningfulChange: boolean | null
  //   - warnings?: Array<Record<string, unknown>>  (i.e. warningsJson)
  //
  // This test runs a real pass-1 + pass-2 batch through the handler with
  // mocked deps and asserts that every required drawer-read field is
  // populated with a type-compatible value on the pass-2 row.
  // -------------------------------------------------------------------------
  it('Cross-layer contract: pass-2 BatchResult carries every field the StoryPassTwoDetail drawer reads', async () => {
    const bow = buildBow();
    const deps = buildDeps(bow, { autoRunPass2FromProjectConfig: true });

    // Per-pass context override: give pass 2 a non-null budget_meta and a
    // sibling summary so we can assert the drawer-shape contract end-to-end
    // (sibling -> contradiction detection -> warningsJson).
    const baseFetch = deps.fetchSpecContext as unknown as jest.Mock;
    baseFetch.mockImplementation(
      async (input: Parameters<SpecContextFetcher>[0]) => {
        const dto = buildContextDto(bow);
        if (input.pass === 2) {
          return {
            ...dto,
            budget_meta: {
              used_tokens: 1234,
              max_tokens: 24000,
              trimmed: {
                sibling_specs_dropped: 0,
                evidence_refs_dropped: 0,
                findings_dropped: 0,
              },
              warnings: [],
            },
            sibling_summaries: [
              {
                workItemId: 'wi-sibling-A',
                title: 'Sibling A',
                decisions: ['decision-a: use AsyncAPI bridge instead'],
                generationPass: 1,
              },
            ],
          };
        }
        return dto;
      }
    );

    const result = await runRealBatch(
      {
        projectId: bow.projectId,
        bookOfWorkId: bow.bookOfWorkId,
        batchSize: 1,
      },
      deps.asDeps()
    );

    const passTwoRow = result.perStoryResults.find(
      (r) => r.workItemId === 'wi-s1'
    );
    expect(passTwoRow).toBeDefined();
    if (!passTwoRow) return;
    expect(passTwoRow.generationPass).toBe(2);

    // ---- The contract: every drawer-read field is present + type-compat. --
    // generationPass: number | null
    expect(typeof passTwoRow.generationPass === 'number').toBe(true);
    // pass1SpecText: string | null -- pass-2 row MUST carry the snapshot.
    expect(typeof passTwoRow.pass1SpecText).toBe('string');
    expect((passTwoRow.pass1SpecText ?? '').length).toBeGreaterThan(0);
    // generatedSpecText: string | null -- current pass-2 text.
    expect(typeof passTwoRow.generatedSpecText).toBe('string');
    expect((passTwoRow.generatedSpecText ?? '').length).toBeGreaterThan(0);
    // pass2ChangesSummary: string | null -- the "what changed and why" blurb.
    expect(typeof passTwoRow.pass2ChangesSummary).toBe('string');
    expect((passTwoRow.pass2ChangesSummary ?? '').length).toBeGreaterThan(0);
    // budgetMetaJson: Record<string, unknown> | null -- mirror of resolver.
    expect(passTwoRow.budgetMetaJson).not.toBeNull();
    expect(typeof passTwoRow.budgetMetaJson).toBe('object');
    expect(passTwoRow.budgetMetaJson!).toHaveProperty('used_tokens');
    expect(passTwoRow.budgetMetaJson!).toHaveProperty('max_tokens');
    expect(passTwoRow.budgetMetaJson!).toHaveProperty('trimmed');
    // noMeaningfulChange: boolean | null -- pass-2 wrap-up always sets it.
    expect(typeof passTwoRow.noMeaningfulChange).toBe('boolean');
    // warnings (warningsJson): may be empty BUT must be an array shape if
    // present (the drawer reads warnings.filter(...)).
    if (passTwoRow.warningsJson != null) {
      expect(Array.isArray(passTwoRow.warningsJson)).toBe(true);
      // Sibling decision conflicts the current spec decision (sibling says
      // "use AsyncAPI bridge"; pass-2 keeps "keep current state") so the
      // contradiction-detection step should emit at least one
      // `contradicts_sibling` entry. This is the end-to-end signal the
      // drawer T7-5 test reads.
      const contradictions = passTwoRow.warningsJson.filter(
        (w) => (w as { kind?: string }).kind === 'contradicts_sibling'
      );
      expect(contradictions.length).toBeGreaterThanOrEqual(1);
      const first = contradictions[0] as Record<string, unknown>;
      // Drawer reads `siblingWorkItemId` directly off each warning entry --
      // its key MUST be exactly this string.
      expect(first).toHaveProperty('siblingWorkItemId');
      expect(first.siblingWorkItemId).toBe('wi-sibling-A');
    }
    // The handler's own per-pass result splits should match exactly one
    // pass-1 row and one pass-2 row (the drawer reads the latest of each).
    expect(result.passOneResults).toBeDefined();
    expect(result.passTwoResults).toBeDefined();
    expect(result.passOneResults!).toHaveLength(1);
    expect(result.passTwoResults!).toHaveLength(1);
    expect(result.passOneResults![0].generationPass).toBe(1);
    expect(result.passTwoResults![0].generationPass).toBe(2);
  });
});
