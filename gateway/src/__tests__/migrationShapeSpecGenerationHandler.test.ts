/**
 * Tests for the Migration Shape-Spec Batch Generation gateway orchestration handler.
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 6: Batch Generation Handler.
 *
 * Verifies the per-batch flow (R-2, R-3, R-4, R-12):
 *   1. Load BoW + saved WorkItems + per-story metadata from AMS.
 *   2. Select next N unattempted saved-story WorkItems in book-of-work sequenceOrder.
 *   3. SERIAL per-story loop:
 *      a. fetchMigrationSpecContext (Group 5 client) with six context types.
 *      b. applyTokenBudgetCascade (Spec 1 helper reuse, R-5 / A-3).
 *      c. Single synchronous LLM call (R-3).
 *      d. assertSpecGenerationResponse (Group 4 validator).
 *      e. Confidence downgrade post-validation (R-7).
 *      f. POST to AMS batch persistence endpoint (Group 8).
 *   4. Return per-story result list + batch summary.
 *
 * The 10 tests cover (per tasks.md Group 6):
 *   1. batch selection picks the next 25 unattempted saved-story WorkItems.
 *   2. batch selection preserves book-of-work sequenceOrder + parent hierarchy ordering.
 *   3. per-story focused-context call invokes the new resolver with the story's IDs and the six types.
 *   4. specText that starts with `/agent-os:shape-spec` passes; without it is rejected.
 *   5. specText that does not reference the story title/scope is rejected.
 *   6. a status='generated' row is persisted to AMS via the batch endpoint linked to the WorkItem.
 *   7. when focused-context payload is missing mappings/contracts/baselines: status='insufficient_context' with missingInputs[] populated.
 *   8. one story raising mid-batch does NOT abort the batch (R-12).
 *   9. re-running does NOT overwrite rows at status='generated' unless regenerateAll (R-8).
 *  10. a status='generated' result row includes non-empty evidenceRefs (acceptance signal 11).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  runShapeSpecGenerationBatch,
  SpecGenerationResult,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
  LoadedBookOfWork,
  CapturedDecisionsForCitationFetcher,
  ElementInventoryForCitationFetcher,
} from '../services/migrationShapeSpecGenerationHandler';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';
import {
  MigrationSpecContextDto,
} from '../services/migrationSpecContextClient';
import { MigrationStorySpecGenerationDto } from '../services/migrationShapeSpecGenerationHandler';

// ---------------------------------------------------------------------------
// Fixture loaders
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');

function loadGeneratedFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'llm-output-generated.json'), 'utf-8')
  );
}

function loadInsufficientContextFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(FIXTURE_DIR, 'llm-output-insufficient-context.json'),
      'utf-8'
    )
  );
}

function loadFailedFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'llm-output-failed.json'), 'utf-8')
  );
}

// ---------------------------------------------------------------------------
// Synthetic Book-of-Work + WorkItems builder
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
      title:
        i === 0
          ? 'Implement Customer Lookup API Compatibility'
          : `Story ${i + 1} title scope marker`,
      parentFeatureId: `F${Math.floor(i / 4) + 1}`,
      sequenceOrder: i + 1,
    });
  }
  return {
    bookOfWorkId: 'book-001',
    projectId: 'proj-001',
    currentArchitectureId: 'arch-current-001',
    targetArchitectureId: 'arch-target-001',
    stories,
  };
}

/**
 * Build a LoadedBookOfWork from the synthetic shape. Items expose the
 * sequenceOrder, parentId, type='story', and the workItemId linkage that the
 * batch handler reads.
 */
function asLoadedBow(bow: SyntheticBookOfWork): LoadedBookOfWork {
  // Add the parent feature/epic/initiative items so the hierarchy is
  // representable. The handler only selects type='story' items but should
  // ignore non-story items cleanly.
  const items: LoadedBookOfWork['items'] = [];
  // One initiative + one epic at the top.
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
  // Feature parents.
  const featureIds = new Set(bow.stories.map((s) => s.parentFeatureId));
  let featureSeq = 0;
  for (const fid of featureIds) {
    items.push({
      id: fid,
      type: 'feature',
      parentId: 'E1',
      title: `Feature ${fid}`,
      sequenceOrder: featureSeq++,
      workItemId: `wi-feature-${fid}`,
    });
  }
  // Stories (saved).
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

// ---------------------------------------------------------------------------
// Per-story helpers
// ---------------------------------------------------------------------------

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
    generatedAt: '2026-05-19T12:00:00Z',
    service: {
      serviceId: 'svc-001',
      name: 'CustomerService',
      currentArchitectureRefs: ['app-cur-001'],
      targetArchitectureRefs: ['app-tgt-001'],
      relatedComponentIds: ['comp-001'],
    },
    api: {
      operationId: 'op-001',
      oasContractId: 'oas-001',
      behaviourBaselineIds: ['baseline-001'],
      mappingIds: ['mapping-001'],
    },
    data: {
      entityId: 'entity-001',
      schemaRefs: ['schema-001'],
      mappingIds: ['mapping-001'],
      reconciliationRefs: ['recon-001'],
    },
    ...overrides,
  };
}

function makeGeneratedLlmContentForStory(
  storyTitle: string,
  evidenceRefs: unknown[] = [
    { type: 'architecture_element_mapping', id: 'aaaa-0003' },
    { type: 'api_behaviour_baseline', id: '4444-401' },
  ]
): string {
  const payload = {
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${storyTitle}\n\n` +
      'Feature summary: rehome the legacy operation to the target service as a like-for-like split.\n' +
      'Implementation steps: implement controller, openapi, contract test, reconciliation harness replay.\n' +
      'Acceptance criteria: byte-equivalent responses; OpenAPI conformance verified.',
    warnings: [],
    evidenceRefs,
    assumptions: ['Target service owns the customer domain per the split mapping.'],
    tests: [
      {
        title: 'Contract test: GET endpoint returns 200 with the documented response shape.',
        description:
          'Functional contract test asserting the documented 200 response shape.',
        type: 'functional',
      },
      {
        title: 'Reconciliation harness replay: all baseline captures pass.',
        description:
          'Functional replay of the captured baseline request/response pairs.',
        type: 'functional',
      },
    ],
    affectedAreas: [
      'target/customer-service/src/main/java/com/example/customer/CustomerController.java',
      'target/customer-service/src/main/resources/openapi.yaml',
    ],
    coveredEndpointIds: [],
  };
  return JSON.stringify(payload);
}

function makeNoPrefixLlmContent(storyTitle: string): string {
  // specText does NOT start with /agent-os:shape-spec -- should be rejected.
  return JSON.stringify({
    status: 'generated',
    confidence: 'medium',
    specText:
      `Implementation notes for ${storyTitle}.\n` +
      'Some general guidance about what to do but missing the required prefix.\n' +
      'Step 1 etc.',
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions: [],
    tests: [
      { title: 'Test 1', description: 'Unit test 1.', type: 'unit' },
      { title: 'Test 2', description: 'Functional test 2.', type: 'functional' },
    ],
    affectedAreas: ['some/path.ts'],
    coveredEndpointIds: [],
  });
}

function makeOffTopicLlmContent(otherStoryTitle: string): string {
  // specText prefix correct but body does not reference the target story.
  // Used to test that the handler's per-story title substring check kicks in.
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${otherStoryTitle}\n\n` +
      'Feature summary: rehome the off-topic operation; this body deliberately mentions only the other story so the title substring check fails.\n' +
      'Implementation steps: do unrelated work; this body has nothing to do with the target story.',
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions: [],
    tests: [
      {
        title: 'Off-topic contract test 1',
        description: 'Functional off-topic test.',
        type: 'functional',
      },
    ],
    affectedAreas: ['off-topic/path.ts'],
    coveredEndpointIds: [],
  });
}

// ---------------------------------------------------------------------------
// Spies + default-OK dependencies
// ---------------------------------------------------------------------------

interface MockDeps {
  loadBookOfWork: jest.Mock;
  loadExistingGenerations: jest.Mock;
  fetchSpecContext: jest.Mock;
  callLlm: jest.Mock;
  persistBatchResults: jest.Mock;
}

function buildDeps(
  bow: SyntheticBookOfWork,
  options: {
    existingGenerations?: MigrationStorySpecGenerationDto[];
    contextOverridesByWorkItem?: Record<string, Partial<MigrationSpecContextDto>>;
    llmContentByWorkItem?: Record<string, string | Error>;
    persistBehavior?: (
      projectId: string,
      bookOfWorkId: string,
      results: SpecGenerationResult[]
    ) =>
      | Promise<{ persistedCount: number; resultsCouldNotPersist: number }>
      | { persistedCount: number; resultsCouldNotPersist: number };
  } = {}
): MockDeps & {
  asTypedDeps: () => {
    loadBookOfWork: BookOfWorkLoader;
    loadExistingGenerations: ExistingGenerationsLoader;
    fetchSpecContext: SpecContextFetcher;
    callLlm: LlmCaller;
    persistBatchResults: PersistBatchFn;
  };
} {
  const loadBookOfWork: jest.Mock = jest.fn(
    async (_projectId: string, _bookOfWorkId: string) => asLoadedBow(bow)
  );
  const loadExistingGenerations: jest.Mock = jest.fn(
    async (_projectId: string, _bookOfWorkId: string) =>
      options.existingGenerations ?? []
  );
  const fetchSpecContext: jest.Mock = jest.fn(
    async (input: Parameters<SpecContextFetcher>[0]) => {
      const story = bow.stories.find((s) => s.workItemId === input.workItemId);
      if (!story) {
        throw new Error(`fixture missing story for workItemId=${input.workItemId}`);
      }
      return buildContextDto(
        bow,
        story,
        options.contextOverridesByWorkItem?.[input.workItemId]
      );
    }
  );
  const callLlm: jest.Mock = jest.fn(async (input: Parameters<LlmCaller>[0]) => {
    const override = options.llmContentByWorkItem?.[input.workItemId];
    if (override instanceof Error) {
      throw override;
    }
    if (typeof override === 'string') {
      return { content: override };
    }
    const story = bow.stories.find((s) => s.workItemId === input.workItemId);
    if (!story) {
      throw new Error(`fixture missing story for workItemId=${input.workItemId}`);
    }
    return { content: makeGeneratedLlmContentForStory(story.title) };
  });
  const persistBatchResults: jest.Mock = jest.fn(
    async (
      projectId: string,
      bookOfWorkId: string,
      results: SpecGenerationResult[]
    ) => {
      if (options.persistBehavior) {
        return await options.persistBehavior(projectId, bookOfWorkId, results);
      }
      return { persistedCount: results.length, resultsCouldNotPersist: 0 };
    }
  );
  return {
    loadBookOfWork,
    loadExistingGenerations,
    fetchSpecContext,
    callLlm,
    persistBatchResults,
    asTypedDeps: () => ({
      loadBookOfWork: loadBookOfWork as unknown as BookOfWorkLoader,
      loadExistingGenerations:
        loadExistingGenerations as unknown as ExistingGenerationsLoader,
      fetchSpecContext: fetchSpecContext as unknown as SpecContextFetcher,
      callLlm: callLlm as unknown as LlmCaller,
      persistBatchResults: persistBatchResults as unknown as PersistBatchFn,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Migration Shape-Spec Batch Generation handler (Spec 2026-05-19, Task Group 6)', () => {
  // Smoke: confirm fixtures parse (avoids opaque ENOENT later).
  it('fixtures load cleanly', () => {
    expect(loadGeneratedFixture()).toBeTruthy();
    expect(loadInsufficientContextFixture()).toBeTruthy();
    expect(loadFailedFixture()).toBeTruthy();
  });

  // ----- Test 1: batch selection picks the next 25 unattempted -----
  it('Test 1 — batch selection picks the next 25 unattempted saved-story WorkItems', async () => {
    const bow = buildBookOfWork(30);
    const deps = buildDeps(bow);

    const result = await runShapeSpecGenerationBatch(
      {
        projectId: bow.projectId,
        bookOfWorkId: bow.bookOfWorkId,
      },
      deps.asTypedDeps()
    );

    expect(result.perStoryResults).toHaveLength(25);
    // None of the per-story results should reference stories 26-30 (yet).
    const workItemsAttempted = result.perStoryResults.map((r) => r.workItemId);
    for (let i = 1; i <= 25; i++) {
      expect(workItemsAttempted).toContain(`wi-${i}`);
    }
    for (let i = 26; i <= 30; i++) {
      expect(workItemsAttempted).not.toContain(`wi-${i}`);
    }
    expect(result.summary.generated).toBe(25);
  });

  // ----- Test 2: batch selection preserves sequenceOrder + parent hierarchy ordering -----
  it('Test 2 — preserves book-of-work sequenceOrder and parent hierarchy ordering', async () => {
    const bow = buildBookOfWork(10);
    // Shuffle the story sequenceOrder to verify the handler re-orders.
    // We do this by reversing the items array BEFORE constructing the
    // LoadedBookOfWork (the handler must sort by sequenceOrder, not by array
    // order).
    const loaded = asLoadedBow(bow);
    loaded.items.reverse();
    const deps = buildDeps(bow);
    deps.loadBookOfWork.mockResolvedValue(loaded);

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 10 },
      deps.asTypedDeps()
    );

    const orderedWorkItems = result.perStoryResults.map((r) => r.workItemId);
    expect(orderedWorkItems).toEqual([
      'wi-1', 'wi-2', 'wi-3', 'wi-4', 'wi-5',
      'wi-6', 'wi-7', 'wi-8', 'wi-9', 'wi-10',
    ]);
  });

  // ----- Test 3: per-story focused-context call invokes resolver with six context types -----
  it('Test 3 — per-story focused-context call uses the story IDs and the seven context types', async () => {
    const bow = buildBookOfWork(2);
    const deps = buildDeps(bow);

    await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 2 },
      deps.asTypedDeps()
    );

    expect(deps.fetchSpecContext).toHaveBeenCalledTimes(2);
    const firstCall = deps.fetchSpecContext.mock.calls[0][0];
    expect(firstCall.projectId).toBe(bow.projectId);
    expect(firstCall.bookOfWorkId).toBe(bow.bookOfWorkId);
    expect(firstCall.workItemId).toBe('wi-1');
    expect(firstCall.bookItemId).toBe('S1');
    expect(firstCall.currentArchitectureId).toBe(bow.currentArchitectureId);
    expect(firstCall.targetArchitectureId).toBe(bow.targetArchitectureId);
    // The seven supported context types (D3 added `operational_capability`).
    expect(firstCall.contextTypes).toEqual(
      expect.arrayContaining([
        'service', 'api', 'soap', 'data', 'infrastructure', 'test_pack',
        'operational_capability',
      ])
    );
    expect(firstCall.contextTypes).toHaveLength(7);
  });

  // ----- Test 4: prefix-rule pass/fail -----
  it('Test 4 — specText starting with `/agent-os:shape-spec` passes; without it is rejected', async () => {
    const bow = buildBookOfWork(2);
    const deps = buildDeps(bow, {
      llmContentByWorkItem: {
        'wi-1': makeGeneratedLlmContentForStory(bow.stories[0].title),
        'wi-2': makeNoPrefixLlmContent(bow.stories[1].title),
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 2 },
      deps.asTypedDeps()
    );

    const story1 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    const story2 = result.perStoryResults.find((r) => r.workItemId === 'wi-2')!;
    expect(story1.status).toBe('generated');
    expect(story2.status).toBe('failed');
    expect(story2.errorMessage).toMatch(/agent-os:shape-spec/);
  });

  // ----- Test 5: scope-rule -----
  it('Test 5 — specText not referencing the story title/scope is rejected', async () => {
    const bow = buildBookOfWork(2);
    // Set up wi-1 with an LLM body that references a totally different story.
    const deps = buildDeps(bow, {
      llmContentByWorkItem: {
        'wi-1': makeOffTopicLlmContent('A Completely Unrelated Story Title'),
        'wi-2': makeGeneratedLlmContentForStory(bow.stories[1].title),
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 2 },
      deps.asTypedDeps()
    );

    const story1 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    expect(story1.status).toBe('failed');
    expect(story1.errorMessage).toMatch(/story|title|scope/i);
    // The other story passes.
    const story2 = result.perStoryResults.find((r) => r.workItemId === 'wi-2')!;
    expect(story2.status).toBe('generated');
  });

  // ----- Test 6: status='generated' row persisted with WorkItem linkage -----
  it('Test 6 — status=generated row is persisted via the batch endpoint and links to the saved WorkItem', async () => {
    const bow = buildBookOfWork(1);
    const deps = buildDeps(bow);

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asTypedDeps()
    );

    expect(deps.persistBatchResults).toHaveBeenCalledTimes(1);
    const [postedProjectId, postedBookOfWorkId, postedResults] =
      deps.persistBatchResults.mock.calls[0];
    expect(postedProjectId).toBe(bow.projectId);
    expect(postedBookOfWorkId).toBe(bow.bookOfWorkId);
    expect(postedResults).toHaveLength(1);
    expect(postedResults[0].workItemId).toBe('wi-1');
    expect(postedResults[0].status).toBe('generated');
    expect(postedResults[0].generatedSpecText).toContain('/agent-os:shape-spec');
    expect(result.persistedCount).toBe(1);
  });

  // ----- Test 7: missing mappings/contracts/baselines -> insufficient_context -----
  it('Test 7 — when the focused-context payload lacks mappings/contracts/baselines the handler records status=insufficient_context with missingInputs[]', async () => {
    const bow = buildBookOfWork(1);
    const deps = buildDeps(bow, {
      contextOverridesByWorkItem: {
        // Strip mappings / baselines / contracts; supply the top-level
        // missingInputs blockers AMS would surface in this case.
        'wi-1': {
          api: undefined,
          data: undefined,
          missingInputs: [
            { kind: 'mapping', id: 'mapping-missing', reason: 'no current-to-target mapping for the operation' },
            { kind: 'baseline', id: 'baseline-missing', reason: 'no API Behaviour Baseline captured' },
          ],
        },
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asTypedDeps()
    );

    // Handler MUST NOT call the LLM in this case (no fabricated spec).
    expect(deps.callLlm).not.toHaveBeenCalled();
    const r = result.perStoryResults[0];
    expect(r.status).toBe('insufficient_context');
    expect(r.missingInputsJson?.length ?? 0).toBeGreaterThan(0);
    expect(r.generatedSpecText).toBeFalsy();
    expect(result.summary.insufficient_context).toBe(1);
  });

  // ----- Test 8: failure isolation -- one story raising mid-batch does NOT abort -----
  it('Test 8 — one story raising mid-batch does NOT abort the batch; failed result is still persisted; remaining stories still process (R-12)', async () => {
    const bow = buildBookOfWork(3);
    const deps = buildDeps(bow, {
      llmContentByWorkItem: {
        // Story 2's LLM call throws -- the batch must absorb and continue.
        'wi-2': new Error('upstream LLM timeout (synthetic)'),
      },
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 3 },
      deps.asTypedDeps()
    );

    expect(result.perStoryResults).toHaveLength(3);
    expect(result.perStoryResults[0].status).toBe('generated');
    expect(result.perStoryResults[1].status).toBe('failed');
    expect(result.perStoryResults[1].errorMessage).toMatch(/LLM|timeout|synthetic/i);
    expect(result.perStoryResults[2].status).toBe('generated');
    expect(result.summary.generated).toBe(2);
    expect(result.summary.failed).toBe(1);
    // Both the generated rows + the failed row are persisted (failure isolation).
    expect(deps.persistBatchResults).toHaveBeenCalledTimes(1);
    const persistedArr = deps.persistBatchResults.mock.calls[0][2];
    expect(persistedArr).toHaveLength(3);
    const failed = persistedArr.find(
      (r: SpecGenerationResult) => r.workItemId === 'wi-2'
    );
    expect(failed?.status).toBe('failed');
  });

  // ----- Test 9: re-run idempotency -- skip rows already at status='generated' -----
  it('Test 9 — re-running does NOT overwrite rows already at status=generated unless regenerateAll=true (R-8)', async () => {
    const bow = buildBookOfWork(3);
    const existing: MigrationStorySpecGenerationDto[] = [
      {
        id: 'gen-1',
        projectId: bow.projectId,
        workItemId: 'wi-1',
        bookOfWorkId: bow.bookOfWorkId,
        bookItemId: 'S1',
        status: 'generated',
        confidence: 'high',
        predictedReadiness: null,
        generatedSpecText: '/agent-os:shape-spec already generated body',
        warningsJson: null,
        missingInputsJson: null,
        focusedContextRefsJson: null,
        evidenceRefsJson: null,
        generatedAt: '2026-05-19T12:00:00Z',
        errorMessage: null,
        generationAttemptNumber: 1,
        createdByTask: 'product-manager--migration-shape-spec-generation',
        createdAt: '2026-05-19T12:00:00Z',
        updatedAt: '2026-05-19T12:00:00Z',
      },
    ];
    const deps = buildDeps(bow, { existingGenerations: existing });

    // Default re-run: should skip the already-generated wi-1.
    const result1 = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 5 },
      deps.asTypedDeps()
    );
    const attempted1 = result1.perStoryResults.map((r) => r.workItemId);
    expect(attempted1).not.toContain('wi-1');
    expect(attempted1).toContain('wi-2');
    expect(attempted1).toContain('wi-3');
    // The LLM was called for the two stories that ARE eligible.
    expect(deps.callLlm).toHaveBeenCalledTimes(2);

    // Now with regenerateAll=true: wi-1 is re-attempted.
    deps.callLlm.mockClear();
    deps.fetchSpecContext.mockClear();
    deps.persistBatchResults.mockClear();
    const result2 = await runShapeSpecGenerationBatch(
      {
        projectId: bow.projectId,
        bookOfWorkId: bow.bookOfWorkId,
        batchSize: 5,
        regenerateAll: true,
      },
      deps.asTypedDeps()
    );
    const attempted2 = result2.perStoryResults.map((r) => r.workItemId);
    expect(attempted2).toContain('wi-1');
    expect(deps.callLlm).toHaveBeenCalledTimes(3);
  });

  // ----- Test 10: generated result row carries non-empty evidenceRefs (acceptance signal 11) -----
  it('Test 10 — a status=generated result row includes non-empty evidenceRefs (acceptance signal 11)', async () => {
    const bow = buildBookOfWork(1);
    const deps = buildDeps(bow);

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      deps.asTypedDeps()
    );

    const r = result.perStoryResults[0];
    expect(r.status).toBe('generated');
    expect(r.evidenceRefsJson).toBeDefined();
    expect((r.evidenceRefsJson as unknown[]).length).toBeGreaterThan(0);
  });
});


// ===========================================================================
// Spec 2026-05-26 story-level scope cross-check: handler enrichment test
// ===========================================================================

describe('Migration Shape-Spec Batch Generation handler -- story-level scope cross-check (Spec 2026-05-26)', () => {
  /**
   * Helper: build a minimal {@link TargetStateCapturedDecision} fixture row.
   */
  function makeCapturedDecision(
    overrides: Partial<TargetStateCapturedDecision> = {}
  ): TargetStateCapturedDecision {
    return {
      decisionId: 'dec-1',
      projectId: 'proj-001',
      targetArchitectureId: 'arch-target-001',
      decisionCode: 'cs.framework',
      scopeKind: 'element',
      scopeRefType: 'service',
      scopeRefId: 'svc-1',
      answerValue: 'spring-boot',
      answerSummary: null,
      standardsLookupRef: null,
      conversationThreadId: null,
      conversationTurnRef: null,
      createdAt: '2026-05-26T00:00:00Z',
      createdByTask: 'architect-conversation--capture-decision',
      supersededById: null,
      ...overrides,
    };
  }

  it('enriches element-scope decisions with scopeElementName from the inventory map BEFORE the citation validator runs; inventory fetch happens once per batch; out-of-scope element decision does NOT trigger downgrade', async () => {
    const bow = buildBookOfWork(2);
    const elementDecision = makeCapturedDecision({
      decisionCode: 'cs.framework',
      scopeKind: 'element',
      scopeRefId: 'svc-1',
    });

    const fetchCapturedDecisions: jest.Mock = jest.fn(
      async (_projectId: string) => ({
        decisions: [elementDecision],
        targetArchitectureId: 'arch-target-001',
      })
    );
    const inventoryMap = new Map<string, string>([['svc-1', 'customer-service']]);
    const fetchElementInventory: jest.Mock = jest.fn(
      async (_projectId: string, _architectureId: string) => inventoryMap
    );

    const deps = buildDeps(bow, {
      llmContentByWorkItem: {
        'wi-1': JSON.stringify({
          status: 'generated',
          confidence: 'high',
          specText:
            '/agent-os:shape-spec ' + bow.stories[0].title + '\n\n' +
            'Body about the customer-service migration (no captured_decision evidenceRef cited).\n' +
            'Implementation steps for the customer-service. ' + 'x'.repeat(120),
          warnings: [],
          evidenceRefs: [{ type: 'discovery_finding', id: 'df-1' }],
          assumptions: ['none'],
          tests: [
            { title: 't-1', description: 'Unit test t-1.', type: 'unit' },
          ],
          affectedAreas: ['target/customer-service/src/main/java/Foo.java'],
          coveredEndpointIds: [],
        }),
        'wi-2': JSON.stringify({
          status: 'generated',
          confidence: 'high',
          specText:
            '/agent-os:shape-spec ' + bow.stories[1].title + '\n\n' +
            'Body about a different element -- this should NOT trigger the citation downgrade.\n' +
            'Implementation steps. ' + 'x'.repeat(120),
          warnings: [],
          evidenceRefs: [{ type: 'discovery_finding', id: 'df-2' }],
          assumptions: ['none'],
          tests: [
            { title: 't-2', description: 'Unit test t-2.', type: 'unit' },
          ],
          affectedAreas: ['target/legacy-billing/src/Foo.java'],
          coveredEndpointIds: [],
        }),
      },
    });

    const typedDeps = {
      ...deps.asTypedDeps(),
      fetchCapturedDecisionsForCitationCheck:
        fetchCapturedDecisions as unknown as CapturedDecisionsForCitationFetcher,
      fetchElementInventoryForCitationCheck:
        fetchElementInventory as unknown as ElementInventoryForCitationFetcher,
    };

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 2 },
      typedDeps
    );

    // Inventory fetch happens ONCE for the batch (not per story).
    expect(fetchElementInventory).toHaveBeenCalledTimes(1);
    expect(fetchElementInventory).toHaveBeenCalledWith('proj-001', 'arch-target-001');
    // Captured-decisions fetch is also once per batch.
    expect(fetchCapturedDecisions).toHaveBeenCalledTimes(1);

    // Story 1 (customer-service): in-scope -> downgrade + missingDecisionCodes populated.
    const story1 = result.perStoryResults.find((r) => r.workItemId === 'wi-1')!;
    expect(story1.status).toBe('generated_with_warnings');
    expect(story1.confidence).toBe('medium');
    const story1Warnings = (story1.warningsJson ?? []) as Array<Record<string, unknown>>;
    const citationWarning1 = story1Warnings.find(
      (w) => w.kind === 'missing_decision_citation'
    );
    expect(citationWarning1).toBeDefined();
    expect(citationWarning1?.missingDecisionCodes).toEqual(['cs.framework']);

    // Story 2 (legacy-billing): element-scope decision `customer-service` does NOT
    // match the story content -> out-of-scope -> NO downgrade.
    const story2 = result.perStoryResults.find((r) => r.workItemId === 'wi-2')!;
    expect(story2.status).toBe('generated');
    expect(story2.confidence).toBe('high');
    const story2Warnings = (story2.warningsJson ?? []) as Array<Record<string, unknown>>;
    const citationWarning2 = story2Warnings.find(
      (w) => w.kind === 'missing_decision_citation'
    );
    expect(citationWarning2).toBeUndefined();
  });

  it('fail-open path: when the inventory fetcher rejects, element-scope decisions still flow into the validator with scopeElementName=null and the citation extension still fires', async () => {
    const bow = buildBookOfWork(1);
    const elementDecision = makeCapturedDecision({
      decisionCode: 'cs.framework',
      scopeKind: 'element',
      scopeRefId: 'svc-1',
    });

    const fetchCapturedDecisions: jest.Mock = jest.fn(async () => ({
      decisions: [elementDecision],
      targetArchitectureId: 'arch-target-001',
    }));
    const fetchElementInventory: jest.Mock = jest.fn(async () => {
      throw new Error('synthetic Architecture Model Service outage');
    });

    const deps = buildDeps(bow, {
      llmContentByWorkItem: {
        'wi-1': JSON.stringify({
          status: 'generated',
          confidence: 'high',
          specText:
            '/agent-os:shape-spec ' + bow.stories[0].title + '\n\n' +
            'Body about the customer-service migration with no captured_decision citation.\n' +
            'Implementation steps. ' + 'x'.repeat(120),
          warnings: [],
          evidenceRefs: [{ type: 'discovery_finding', id: 'df-1' }],
          assumptions: [],
          tests: [
            { title: 't-1', description: 'Unit test t-1.', type: 'unit' },
          ],
          affectedAreas: ['target/customer-service/src/Foo.java'],
          coveredEndpointIds: [],
        }),
      },
    });

    const typedDeps = {
      ...deps.asTypedDeps(),
      fetchCapturedDecisionsForCitationCheck:
        fetchCapturedDecisions as unknown as CapturedDecisionsForCitationFetcher,
      fetchElementInventoryForCitationCheck:
        fetchElementInventory as unknown as ElementInventoryForCitationFetcher,
    };

    const result = await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      typedDeps
    );

    expect(fetchElementInventory).toHaveBeenCalledTimes(1);
    const story = result.perStoryResults[0];
    // Fail-open: even though inventory lookup threw, the element-scope decision still
    // makes it through to the validator (scopeElementName=null -> in-scope -> warning fires).
    expect(story.status).toBe('generated_with_warnings');
    expect(story.confidence).toBe('medium');
    const warnings = (story.warningsJson ?? []) as Array<Record<string, unknown>>;
    const citationWarning = warnings.find(
      (w) => w.kind === 'missing_decision_citation'
    );
    expect(citationWarning).toBeDefined();
    expect(citationWarning?.missingDecisionCodes).toEqual(['cs.framework']);
  });

  it('skip-inventory guard: when ALL captured decisions are architecture-scope, the inventory fetcher is NOT called', async () => {
    const bow = buildBookOfWork(1);
    const archDecision = makeCapturedDecision({
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      scopeRefId: null,
    });

    const fetchCapturedDecisions: jest.Mock = jest.fn(async () => ({
      decisions: [archDecision],
      targetArchitectureId: 'arch-target-001',
    }));
    const fetchElementInventory: jest.Mock = jest.fn(async () => new Map<string, string>());

    const deps = buildDeps(bow);
    const typedDeps = {
      ...deps.asTypedDeps(),
      fetchCapturedDecisionsForCitationCheck:
        fetchCapturedDecisions as unknown as CapturedDecisionsForCitationFetcher,
      fetchElementInventoryForCitationCheck:
        fetchElementInventory as unknown as ElementInventoryForCitationFetcher,
    };

    await runShapeSpecGenerationBatch(
      { projectId: bow.projectId, bookOfWorkId: bow.bookOfWorkId, batchSize: 1 },
      typedDeps
    );

    expect(fetchCapturedDecisions).toHaveBeenCalledTimes(1);
    // Architecture-scope only -> skip inventory fetch (optimisation).
    expect(fetchElementInventory).not.toHaveBeenCalled();
  });
});
