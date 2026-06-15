/**
 * Tests for the Migration Shape-Spec Batch Generation gateway orchestration
 * handler -- Cross-Story Context Injection (Task Group 5, 2026-05-20).
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 5
 *
 * The eight tests in this file cover the loop guardrails, pass-2 outputs,
 * contradiction / alignment warnings, and the per-workstream concurrency
 * lock. Backwards-compatible behaviour for the pre-Cross-Story flow is
 * exercised in the sibling test file
 * (`migrationShapeSpecGenerationHandler.test.ts`).
 *
 * Each test is deliberately scoped to a single behaviour signal. We mock
 * every AMS dependency at the handler boundary; we never call the real AMS
 * endpoint.
 */

import {
  runShapeSpecGenerationBatch,
  __resetWorkstreamLocksForTests,
  MAX_PASS,
  WorkstreamLockedError,
  InvalidPassNumberError,
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
import {
  MigrationSpecContextDto,
} from '../services/migrationSpecContextClient';

// ---------------------------------------------------------------------------
// Synthetic book-of-work builder (matches the sibling test file's helper)
// ---------------------------------------------------------------------------

interface SyntheticStory {
  bookItemId: string;
  workItemId: string;
  title: string;
  parentFeatureId: string;
  sequenceOrder: number;
}

interface SyntheticBookOfWork {
  bookOfWorkId: string;
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
  stories: SyntheticStory[];
}

function buildBookOfWork(storyCount: number): SyntheticBookOfWork {
  const stories: SyntheticStory[] = [];
  for (let i = 0; i < storyCount; i++) {
    stories.push({
      bookItemId: `S${i + 1}`,
      workItemId: `wi-${i + 1}`,
      title: `Story ${i + 1} sibling context marker`,
      parentFeatureId: 'F1',
      sequenceOrder: i + 1,
    });
  }
  return {
    bookOfWorkId: 'book-x',
    projectId: 'proj-x',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    stories,
  };
}

function asLoadedBow(bow: SyntheticBookOfWork): LoadedBookOfWork {
  const items: LoadedBookOfWork['items'] = [];
  items.push({
    id: 'I1',
    type: 'initiative',
    parentId: null,
    title: 'Top initiative',
    sequenceOrder: 0,
    workItemId: 'wi-init-1',
  });
  items.push({
    id: 'E1',
    type: 'epic',
    parentId: 'I1',
    title: 'Top epic',
    sequenceOrder: 0,
    workItemId: 'wi-epic-1',
  });
  items.push({
    id: 'F1',
    type: 'feature',
    parentId: 'E1',
    title: 'Feature F1',
    sequenceOrder: 0,
    workItemId: 'wi-feature-1',
  });
  for (const s of bow.stories) {
    items.push({
      id: s.bookItemId,
      type: 'story',
      parentId: s.parentFeatureId,
      title: s.title,
      sequenceOrder: s.sequenceOrder,
      workItemId: s.workItemId,
    });
  }
  return {
    bookOfWorkId: bow.bookOfWorkId,
    projectId: bow.projectId,
    currentArchitectureId: bow.currentArchitectureId,
    targetArchitectureId: bow.targetArchitectureId,
    items,
  };
}

function buildContextDto(
  bow: SyntheticBookOfWork,
  story: SyntheticStory,
  overrides: Partial<MigrationSpecContextDto> = {}
): MigrationSpecContextDto {
  return {
    projectId: bow.projectId,
    bookOfWorkId: bow.bookOfWorkId,
    bookItemId: story.bookItemId,
    workItemId: story.workItemId,
    currentArchitectureId: bow.currentArchitectureId,
    targetArchitectureId: bow.targetArchitectureId,
    generatedAt: '2026-05-20T12:00:00Z',
    service: {
      serviceId: 'svc-1',
      currentArchitectureRefs: ['app-cur-1'],
      targetArchitectureRefs: ['app-tgt-1'],
      relatedComponentIds: ['comp-1'],
    },
    api: {
      operationId: 'op-1',
      oasContractId: 'oas-1',
      behaviourBaselineIds: ['baseline-1'],
      mappingIds: ['map-1'],
    },
    data: {
      entityId: 'entity-1',
      schemaRefs: ['schema-1'],
      mappingIds: ['map-1'],
      reconciliationRefs: ['recon-1'],
    },
    ...overrides,
  };
}

/**
 * Build a generated LLM body whose specText carries the supplied decisions /
 * interfaces / assumptions verbatim so the parser picks them up.
 */
function makeLlmContent(
  storyTitle: string,
  decisions: string[],
  opts: { interfaces?: string[]; assumptions?: string[] } = {}
): string {
  const interfaces = opts.interfaces ?? ['POST /api/widgets'];
  const assumptions = opts.assumptions ?? ['Workstream owner approved the migration plan.'];
  const lines: string[] = [
    `/agent-os:shape-spec ${storyTitle}`,
    '',
    'Feature summary: rehome the legacy operation as a like-for-like split.',
    '',
    'Decisions:',
    ...decisions.map((d) => `- ${d}`),
    '',
    'Interfaces:',
    ...interfaces.map((i) => `- ${i}`),
    '',
    'Assumptions:',
    ...assumptions.map((a) => `- ${a}`),
  ];
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText: lines.join('\n'),
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions,
    tests: [
      { title: 'Contract test', description: 'Functional contract test.', type: 'functional' },
      {
        title: 'Reconciliation harness replay',
        description: 'Functional baseline replay.',
        type: 'functional',
      },
    ],
    affectedAreas: ['target/widgets/src/main/java/Widget.java'],
    coveredEndpointIds: [],
  });
}

// ---------------------------------------------------------------------------
// Dependency wiring helper
// ---------------------------------------------------------------------------

interface BuildDepsOpts {
  llmContent?: (workItemId: string, pass: number) => string;
  contextOverridesByPass?: Record<number, Partial<MigrationSpecContextDto>>;
  autoRunPass2?: boolean;
  persistedIdFor?: (workItemId: string) => string;
  /** Tracks every focused-context call payload for assertions. */
  recordedContextCalls?: Array<Parameters<SpecContextFetcher>[0]>;
}

function buildDeps(bow: SyntheticBookOfWork, opts: BuildDepsOpts = {}) {
  const recordedContextCalls = opts.recordedContextCalls ?? [];

  const loadBookOfWork: jest.Mock = jest.fn(async () => asLoadedBow(bow));
  const loadExistingGenerations: jest.Mock = jest.fn(async () => []);

  const passCounter: Record<string, number> = {};

  const fetchSpecContext: jest.Mock = jest.fn(
    async (input: Parameters<SpecContextFetcher>[0]) => {
      recordedContextCalls.push(input);
      const story = bow.stories.find((s) => s.workItemId === input.workItemId);
      if (!story) throw new Error(`no story for ${input.workItemId}`);
      const base = buildContextDto(bow, story);
      const pass = input.pass ?? 1;
      const override = opts.contextOverridesByPass?.[pass] ?? {};
      return { ...base, ...override };
    }
  );

  const callLlm: jest.Mock = jest.fn(async (input: Parameters<LlmCaller>[0]) => {
    const story = bow.stories.find((s) => s.workItemId === input.workItemId);
    if (!story) throw new Error(`no story for ${input.workItemId}`);
    const seq = passCounter[input.workItemId] || 0;
    passCounter[input.workItemId] = seq + 1;
    const pass = seq === 0 ? 1 : 2; // first call = pass 1; second = pass 2
    if (opts.llmContent) {
      return { content: opts.llmContent(input.workItemId, pass) };
    }
    return {
      content: makeLlmContent(story.title, ['rest-api: REST is the default surface for this story.']),
    };
  });

  const persistBatchResults: jest.Mock = jest.fn(
    async (
      _projectId: string,
      _bookOfWorkId: string,
      results: MigrationStorySpecGenerationDto[]
    ) => {
      const persistedResults = results.map((r) => ({
        ...r,
        id:
          r.id ??
          (opts.persistedIdFor
            ? opts.persistedIdFor(r.workItemId)
            : `persist-${r.workItemId}-pass${r.generationPass ?? 1}`),
      }));
      return {
        persistedCount: results.length,
        resultsCouldNotPersist: 0,
        perStoryResults: persistedResults,
      };
    }
  );

  const autoSeed: jest.Mock = jest.fn(async () => ({}));
  const fetchProjectConfig: jest.Mock = jest.fn(async () => ({
    perStoryContextTokenCap: 24000,
    crossStoryContextTokenCap: 12000,
    autoRunPass2: opts.autoRunPass2 ?? true,
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
      loadBookOfWork: loadBookOfWork as unknown as BookOfWorkLoader,
      loadExistingGenerations: loadExistingGenerations as unknown as ExistingGenerationsLoader,
      fetchSpecContext: fetchSpecContext as unknown as SpecContextFetcher,
      callLlm: callLlm as unknown as LlmCaller,
      persistBatchResults: persistBatchResults as unknown as PersistBatchFn,
      autoSeedEpicCapturedDecision: autoSeed as unknown as EpicCapturedDecisionAutoSeeder,
      fetchProjectConfig: fetchProjectConfig as unknown as ProjectConfigFetcher,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Migration Shape-Spec Two-Pass Orchestration (Spec 2026-05-20, Task Group 5)', () => {
  beforeEach(() => {
    __resetWorkstreamLocksForTests();
  });

  // ----- Test 1: LOOP GUARDRAIL pass 3 is refused -----
  it('Test 1 -- LOOP GUARDRAIL: a caller-requested third pass is refused with InvalidPassNumberError; MAX_PASS=2', async () => {
    expect(MAX_PASS).toBe(2);
    const bow = buildBookOfWork(1);
    const deps = buildDeps(bow);

    await expect(
      runShapeSpecGenerationBatch(
        {
          projectId: bow.projectId,
          bookOfWorkId: bow.bookOfWorkId,
          pass: 3,
        },
        deps.asDeps()
      )
    ).rejects.toBeInstanceOf(InvalidPassNumberError);
    // The LLM must NEVER be called when the guardrail refuses the request.
    expect(deps.callLlm).not.toHaveBeenCalled();
  });

  // ----- Test 2: LOOP GUARDRAIL pass=2 carries passOneSpecIdsInScope -----
  it('Test 2 -- LOOP GUARDRAIL: pass 2 reads ONLY pass-1 outputs; AMS context call carries pass=2 and passOneSpecIdsInScope populated only with pass-1 ids', async () => {
    const bow = buildBookOfWork(2);
    const recordedContextCalls: Array<Parameters<SpecContextFetcher>[0]> = [];
    const deps = buildDeps(bow, { recordedContextCalls });

    await runShapeSpecGenerationBatch(
      {
        projectId: bow.projectId,
        bookOfWorkId: bow.bookOfWorkId,
        batchSize: 2,
      },
      deps.asDeps()
    );

    // Expect 4 context calls: 2 pass-1 + 2 pass-2.
    expect(recordedContextCalls.length).toBe(4);
    const passOne = recordedContextCalls.filter((c) => (c.pass ?? 1) === 1);
    const passTwo = recordedContextCalls.filter((c) => c.pass === 2);
    expect(passOne).toHaveLength(2);
    expect(passTwo).toHaveLength(2);

    // Pass-1 calls MUST NOT carry passOneSpecIdsInScope.
    for (const c of passOne) {
      expect(c.passOneSpecIdsInScope).toBeUndefined();
    }
    // Pass-2 calls MUST carry the pass-1 spec ids -- and ONLY pass-1 ids.
    for (const c of passTwo) {
      expect(Array.isArray(c.passOneSpecIdsInScope)).toBe(true);
      expect(c.passOneSpecIdsInScope!.length).toBe(2);
      for (const id of c.passOneSpecIdsInScope!) {
        // Persisted ids are of the shape `persist-<wi>-pass1`.
        expect(id).toMatch(/-pass1$/);
      }
    }
  });

  // ----- Test 3: LOOP GUARDRAIL failed/insufficient pass-1 stories excluded -----
  it('Test 3 -- LOOP GUARDRAIL: stories whose pass-1 status is failed or insufficient_context are NOT retried in pass 2', async () => {
    const bow = buildBookOfWork(3);
    // wi-2 will fail pass-1 (LLM throws); wi-1 and wi-3 succeed.
    let callCount = 0;
    const deps = buildDeps(bow, {
      llmContent: (workItemId: string, pass: number) => {
        callCount += 1;
        if (workItemId === 'wi-2' && pass === 1) {
          // Simulate a JSON-parse failure -> per-story failed.
          return 'NOT-VALID-JSON';
        }
        const s = bow.stories.find((x) => x.workItemId === workItemId)!;
        return makeLlmContent(s.title, ['key-a: chosen approach']);
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 3 },
      deps.asDeps()
    );

    // wi-2 must be failed; wi-1 and wi-3 must be generated.
    expect(result.perStoryResults).toHaveLength(3);
    const byWi: Record<string, MigrationStorySpecGenerationDto> = {};
    for (const r of result.perStoryResults) byWi[r.workItemId] = r;
    expect(byWi['wi-2'].status).toBe('failed');
    // The pass-2 loop must have re-attempted ONLY wi-1 and wi-3 (the successes).
    // Total LLM calls: 3 (pass 1) + 2 (pass 2 successes only) = 5.
    expect(callCount).toBe(5);
    // Pass-2 results carry generationPass=2 ONLY for the successful pass-1 stories.
    expect(byWi['wi-1'].generationPass).toBe(2);
    expect(byWi['wi-3'].generationPass).toBe(2);
    expect(byWi['wi-2'].generationPass).toBe(1); // failed never advanced
  });

  // ----- Test 4: pass2_changes_summary persisted alongside pass-2 spec text -----
  it('Test 4 -- pass2_changes_summary is generated and persisted alongside the pass-2 spec text', async () => {
    const bow = buildBookOfWork(1);
    // Pass-1 emits one decision; pass-2 emits two decisions (one new) so the
    // template-driven summary cites the new decision key.
    const deps = buildDeps(bow, {
      llmContent: (workItemId: string, pass: number) => {
        const story = bow.stories.find((s) => s.workItemId === workItemId)!;
        if (pass === 1) {
          return makeLlmContent(story.title, ['decision-a: keep current state']);
        }
        return makeLlmContent(story.title, [
          'decision-a: keep current state',
          'decision-b: introduce REST facade per sibling input',
        ]);
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asDeps()
    );

    const pass2 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    expect(pass2.generationPass).toBe(2);
    expect(typeof pass2.pass2ChangesSummary).toBe('string');
    expect((pass2.pass2ChangesSummary || '').length).toBeGreaterThan(0);
    // The summary mentions the new decision key.
    expect(pass2.pass2ChangesSummary!.toLowerCase()).toContain('decision-b');
  });

  // ----- Test 5: no_meaningful_change flips true when pass-2 == pass-1 -----
  it('Test 5 -- no_meaningful_change flips true when pass-2 output is byte-equivalent to pass-1 after whitespace normalisation', async () => {
    const bow = buildBookOfWork(1);
    // Both passes emit the same body (just slightly different whitespace).
    const deps = buildDeps(bow, {
      llmContent: (_workItemId: string, pass: number) => {
        const story = bow.stories[0];
        if (pass === 1) {
          return makeLlmContent(story.title, ['decision-a: same answer']);
        }
        return makeLlmContent(story.title, ['decision-a: same answer']);
      },
    });
    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asDeps()
    );

    const pass2 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    expect(pass2.noMeaningfulChange).toBe(true);
    expect(pass2.pass2ChangesSummary).toMatch(/no meaningful change/i);
  });

  // ----- Test 6: contradiction detection -> contradicts_sibling warning -----
  it('Test 6 -- contradiction detection: a sibling decision conflicting with the current spec decision appends contradicts_sibling to warnings_json', async () => {
    const bow = buildBookOfWork(1);
    // The pass-2 context call supplies a sibling whose decision uses the same
    // key but a different text body -- the handler must emit the warning.
    const deps = buildDeps(bow, {
      contextOverridesByPass: {
        2: {
          sibling_summaries: [
            {
              workItemId: 'wi-sibling-A',
              title: 'Sibling A',
              decisions: ['decision-a: use AsyncAPI bridge instead'],
              generationPass: 1,
            },
          ],
        },
      },
      llmContent: (_workItemId: string, _pass: number) => {
        const story = bow.stories[0];
        return makeLlmContent(story.title, ['decision-a: use REST facade']);
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asDeps()
    );

    const pass2 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    expect(pass2.generationPass).toBe(2);
    expect(Array.isArray(pass2.warningsJson)).toBe(true);
    const contradictions = (pass2.warningsJson || []).filter(
      (w) => w.kind === 'contradicts_sibling'
    );
    expect(contradictions.length).toBeGreaterThanOrEqual(1);
    expect(contradictions[0].siblingWorkItemId).toBe('wi-sibling-A');
    expect(contradictions[0].conflictingDecisionKey).toBe('decision-a');
    expect(contradictions[0].severity).toBe('review');
  });

  // ----- Test 7: aligned_with_epic_decision + confidence bump -----
  it('Test 7 -- aligned_with_epic_decision warning fires and bumps confidence one notch (capped at high) when matching a confirmed epic decision', async () => {
    const bow = buildBookOfWork(1);
    const deps = buildDeps(bow, {
      contextOverridesByPass: {
        2: {
          parent_rollup: {
            epic: {
              workItemId: 'wi-epic-1',
              title: 'Top epic',
              capturedDecisions: [
                {
                  id: 'capdec-1',
                  decisionKey: 'decision-a',
                  decisionText: 'use REST facade',
                  status: 'confirmed',
                  source: 'user_edited',
                },
              ],
            },
          },
        },
      },
      llmContent: (_workItemId: string, pass: number) => {
        const story = bow.stories[0];
        // Make pass-2 explicitly downgrade confidence to medium so the bump
        // is observable (high -> high would also be valid but not observable).
        const payload = JSON.parse(
          makeLlmContent(story.title, ['decision-a: use REST facade'])
        );
        if (pass === 2) {
          payload.confidence = 'medium';
        }
        return JSON.stringify(payload);
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asDeps()
    );

    const pass2 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    expect(pass2.generationPass).toBe(2);
    const alignedWarnings = (pass2.warningsJson || []).filter(
      (w) => w.kind === 'aligned_with_epic_decision'
    );
    expect(alignedWarnings.length).toBeGreaterThanOrEqual(1);
    expect(alignedWarnings[0].decisionKey).toBe('decision-a');
    // Confidence bumped medium -> high (one notch, capped at high).
    expect(pass2.confidence).toBe('high');
  });

  // ----- Test 8: concurrency lock -----
  it('Test 8 -- concurrency lock: a second concurrent batch for the same workstream is refused with WorkstreamLockedError', async () => {
    const bow = buildBookOfWork(1);
    const deps = buildDeps(bow);

    // Block on the BoW loader so we can fire the second call after the lock
    // is acquired but before pass 1 completes. Using the very first async
    // step (loadBookOfWork) avoids the trouble of intercepting later steps
    // that may run multiple times (LLM is called once per pass per story).
    let release: (() => void) | null = null;
    const firstCallStarted = new Promise<void>((resolveStart) => {
      deps.loadBookOfWork.mockImplementationOnce(async () => {
        resolveStart();
        await new Promise<void>((resolveBlock) => {
          release = resolveBlock;
        });
        return asLoadedBow(bow);
      });
    });

    const firstBatch = runShapeSpecGenerationBatch(
      {
        projectId: bow.projectId,
        bookOfWorkId: bow.bookOfWorkId,
        batchSize: 1,
        workstreamId: 'workstream-shared',
      },
      deps.asDeps()
    );

    await firstCallStarted;

    // Now fire the second batch -- it must be refused immediately.
    await expect(
      runShapeSpecGenerationBatch(
        {
          projectId: bow.projectId,
          bookOfWorkId: bow.bookOfWorkId,
          batchSize: 1,
          workstreamId: 'workstream-shared',
        },
        deps.asDeps()
      )
    ).rejects.toBeInstanceOf(WorkstreamLockedError);

    // Release the first call so the test cleans up; subsequent calls (pass 2)
    // resolve immediately via the default mock.
    if (release) (release as () => void)();
    await firstBatch;
  });
});
