/**
 * Implementation-Ready Migration Spec Generation -- gateway handler enrichment.
 *
 * Spec: 2026-06-14 Implementation-Ready Migration Spec Generation (Spec 1 of 4)
 * Task Group 2 (structured tests + coveredEndpointIds persistence + inline Test
 * Pack) and Task Group 3 (implement-state.json write per generated story).
 *
 * All LLM calls are injected via the `callLlm` dep (the llmGuard.setup.ts
 * live-LLM guard is active; no real model is reached). AMS-client calls used by
 * Group 3 (`fetchProjectFolder`) are mocked via the shared
 * architectureModelClientMock helper.
 */

// Mock the architecture-model client so fetchProjectFolder is deterministic and
// no live AMS call is made. Other exports keep their real implementations.
const mockFetchProjectFolder = jest.fn(async (_projectId: string) =>
  '/abs/project-parent'
);

jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: (...args: unknown[]) =>
      mockFetchProjectFolder(...(args as [string])),
  });
});

import {
  runShapeSpecGenerationBatch,
  toAmsWireShape,
  normaliseAmsRow,
  buildPlannerResponseFromGenerated,
  buildTestPlannerResponseFromTests,
  buildPersistedImplementStateLiteral,
  SpecGenerationResult,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
  ImplementStatePutter,
  LoadedBookOfWork,
  MigrationStorySpecGenerationDto,
} from '../services/migrationShapeSpecGenerationHandler';
import { MigrationSpecContextDto } from '../services/migrationSpecContextClient';
import { GeneratedShapeSpecResponseA } from '../services/specGenerationResponseValidator';

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-ready-1';
const BOOK_ID = 'book-ready-1';
const STORY_TITLE = 'Implement Customer Lookup API Compatibility';

function loadedBow(): LoadedBookOfWork {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    items: [
      {
        id: 'S1',
        type: 'story',
        parentId: 'F1',
        title: STORY_TITLE,
        sequenceOrder: 1,
        workItemId: 'wi-1',
      },
    ],
  };
}

function contextDto(): MigrationSpecContextDto {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'S1',
    workItemId: 'wi-1',
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    generatedAt: '2026-06-14T00:00:00Z',
    api: {
      operationId: 'op-1',
      oasContractId: 'oas-1',
      behaviourBaselineIds: ['baseline-1'],
      mappingIds: ['mapping-1'],
    },
  } as MigrationSpecContextDto;
}

function generatedLlmContent(
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${STORY_TITLE}\n\n` +
      'Feature summary: rehome the legacy operation to the target service as a like-for-like split.\n' +
      'Scope in: implement the target controller. Scope out: data migration (sibling story).\n' +
      'Acceptance criteria: byte-equivalent responses; OpenAPI conformance verified.',
    warnings: [],
    evidenceRefs: [
      { type: 'architecture_element_mapping', id: 'mapping-1' },
      { type: 'api_behaviour_baseline', id: 'baseline-1' },
    ],
    assumptions: ['Target service owns the customer domain per the split mapping.'],
    tests: [
      {
        title: 'GET /customers/{id} returns 200 for a known id',
        description:
          'Given a seeded active customer, the endpoint returns the documented schema.',
        type: 'functional',
      },
      {
        title: 'CustomerLookupService maps row to DTO',
        description: 'Unit-level mapping of a DB row to the Customer DTO.',
        type: 'unit',
      },
    ],
    coveredEndpointIds: ['55555555-5555-5555-5555-5555bbbb2004'],
    affectedAreas: ['target/customer-service/src/main/java/CustomerController.java'],
    ...overrides,
  });
}

function insufficientLlmContent(): string {
  return JSON.stringify({
    status: 'insufficient_context',
    missingInputs: [
      { kind: 'baseline', reason: 'No behaviour baseline captured for the operation.' },
    ],
    reason: 'Cannot produce an honest spec without the captured baseline.',
    recommendedNextAction:
      'Capture API Behaviour Baseline for the customer lookup operation.',
    evidenceRefs: [],
  });
}

interface DepsBundle {
  deps: {
    loadBookOfWork: BookOfWorkLoader;
    loadExistingGenerations: ExistingGenerationsLoader;
    fetchSpecContext: SpecContextFetcher;
    callLlm: LlmCaller;
    persistBatchResults: PersistBatchFn;
    putImplementState?: ImplementStatePutter;
  };
  persistedRows: SpecGenerationResult[];
  putCalls: Array<Parameters<ImplementStatePutter>[0]>;
}

function buildDeps(opts: {
  llmContent?: string;
  putImplementState?: ImplementStatePutter;
  omitPutter?: boolean;
  persistBatchResults?: PersistBatchFn;
} = {}): DepsBundle {
  const persistedRows: SpecGenerationResult[] = [];
  const putCalls: Array<Parameters<ImplementStatePutter>[0]> = [];

  const persistBatchResults: PersistBatchFn =
    opts.persistBatchResults ??
    (jest.fn(async (_p, _b, results) => {
      for (const r of results) persistedRows.push(r);
      // Hydrate ids so downstream code that reads row.id sees a value.
      const withIds = results.map((r, i) => ({ ...r, id: r.id ?? `spec-${i + 1}` }));
      return {
        persistedCount: results.length,
        resultsCouldNotPersist: 0,
        perStoryResults: withIds,
      };
    }) as PersistBatchFn);

  const putImplementState: ImplementStatePutter | undefined = opts.omitPutter
    ? undefined
    : opts.putImplementState ??
      (jest.fn(async (body) => {
        putCalls.push(body);
        return { success: true };
      }) as unknown as ImplementStatePutter);

  return {
    deps: {
      loadBookOfWork: (async () => loadedBow()) as BookOfWorkLoader,
      loadExistingGenerations: (async () => []) as ExistingGenerationsLoader,
      fetchSpecContext: (async () => contextDto()) as SpecContextFetcher,
      callLlm: (async () => ({
        content: opts.llmContent ?? generatedLlmContent(),
      })) as LlmCaller,
      persistBatchResults,
      putImplementState,
    },
    persistedRows,
    putCalls,
  };
}

// ---------------------------------------------------------------------------
// Group 2 -- structured tests + coveredEndpointIds persistence + inline pack
// ---------------------------------------------------------------------------

describe('Implementation-ready generator -- Group 2 persistence + inline pack', () => {
  it('toAmsWireShape emits structured_tests_json + covered_endpoint_ids (snake_case)', () => {
    const row: MigrationStorySpecGenerationDto = {
      projectId: PROJECT_ID,
      workItemId: 'wi-1',
      status: 'generated',
      structuredTestsJson: [
        { title: 't1', description: 'd1', type: 'unit' },
      ],
      coveredEndpointIds: ['ep-1', 'ep-2'],
    };
    const wire = toAmsWireShape(row);
    expect(wire.structured_tests_json).toEqual([
      { title: 't1', description: 'd1', type: 'unit' },
    ]);
    expect(wire.covered_endpoint_ids).toEqual(['ep-1', 'ep-2']);
  });

  it('normaliseAmsRow reads both fields back (snake_case AND camelCase tolerant)', () => {
    const fromSnake = normaliseAmsRow({
      project_id: PROJECT_ID,
      work_item_id: 'wi-1',
      status: 'generated',
      structured_tests_json: [{ title: 't', description: 'd', type: 'functional' }],
      covered_endpoint_ids: ['ep-9'],
    });
    expect(fromSnake.structuredTestsJson).toEqual([
      { title: 't', description: 'd', type: 'functional' },
    ]);
    expect(fromSnake.coveredEndpointIds).toEqual(['ep-9']);

    const fromCamel = normaliseAmsRow({
      projectId: PROJECT_ID,
      workItemId: 'wi-1',
      status: 'generated',
      structuredTestsJson: [{ title: 't', description: 'd', type: 'unit' }],
      coveredEndpointIds: ['ep-7'],
    });
    expect(fromCamel.structuredTestsJson).toEqual([
      { title: 't', description: 'd', type: 'unit' },
    ]);
    expect(fromCamel.coveredEndpointIds).toEqual(['ep-7']);
  });

  it('a generated row persists structuredTestsJson + coveredEndpointIds and inlines a Test Pack into generated_spec_text', async () => {
    const bundle = buildDeps();
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(bundle.persistedRows).toHaveLength(1);
    const row = bundle.persistedRows[0];
    expect(row.structuredTestsJson).toEqual([
      {
        title: 'GET /customers/{id} returns 200 for a known id',
        description:
          'Given a seeded active customer, the endpoint returns the documented schema.',
        type: 'functional',
      },
      {
        title: 'CustomerLookupService maps row to DTO',
        description: 'Unit-level mapping of a DB row to the Customer DTO.',
        type: 'unit',
      },
    ]);
    expect(row.coveredEndpointIds).toEqual([
      '55555555-5555-5555-5555-5555bbbb2004',
    ]);
    // Inline Test Pack rendered into the canonical spec body (D3); prefix kept.
    expect(row.generatedSpecText?.startsWith('/agent-os:shape-spec')).toBe(true);
    expect(row.generatedSpecText).toMatch(/Test Pack/i);
    expect(row.generatedSpecText).toContain(
      'GET /customers/{id} returns 200 for a known id'
    );
    expect(row.generatedSpecText).toMatch(/unit|functional/);
  });

  it('a non-endpoint story persists an EMPTY coveredEndpointIds array (D9)', async () => {
    const bundle = buildDeps({
      llmContent: generatedLlmContent({ coveredEndpointIds: [] }),
    });
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(bundle.persistedRows[0].coveredEndpointIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group 3 -- implement-state.json mapping + PUT
// ---------------------------------------------------------------------------

describe('Implementation-ready generator -- Group 3 implement-state write', () => {
  const generated: GeneratedShapeSpecResponseA = {
    status: 'generated',
    confidence: 'high',
    specText: `/agent-os:shape-spec ${STORY_TITLE} body`,
    warnings: [],
    evidenceRefs: [],
    assumptions: ['a1'],
    tests: [
      { title: 't1', description: 'd1', type: 'unit' },
      { title: 't2', description: 'd2', type: 'functional' },
    ],
    affectedAreas: ['x'],
    coveredEndpointIds: [],
  };

  it('buildPlannerResponseFromGenerated yields a ready PlannerResponse with empty openQuestions', () => {
    const planner = buildPlannerResponseFromGenerated(generated, STORY_TITLE);
    expect(planner.schemaVersion).toBe('1.1');
    expect(planner.plannerReadyForSpec).toBe(true);
    expect(planner.openQuestions).toEqual([]);
    expect(planner.implementationPlan).toBeNull();
    expect(planner.assumptions).toEqual(['a1']);
    expect(Array.isArray(planner.scope.in)).toBe(true);
    expect(Array.isArray(planner.scope.out)).toBe(true);
    expect(Array.isArray(planner.acceptanceCriteria)).toBe(true);
    expect(typeof planner.message).toBe('string');
    expect(planner.message.length).toBeGreaterThan(0);
  });

  it('buildTestPlannerResponseFromTests maps the structured tests 1:1 with hasTestPlan-equivalent state', () => {
    const tp = buildTestPlannerResponseFromTests(generated.tests, STORY_TITLE);
    expect(tp.testPlan).toEqual([
      { title: 't1', description: 'd1', type: 'unit' },
      { title: 't2', description: 'd2', type: 'functional' },
    ]);
    expect(tp.openQuestions).toEqual([]);
    expect(typeof tp.message).toBe('string');
  });

  it('buildPersistedImplementStateLiteral emits a schemaVersion-1 plain object with the ready fields + benign defaults', () => {
    const planner = buildPlannerResponseFromGenerated(generated, STORY_TITLE);
    const tp = buildTestPlannerResponseFromTests(generated.tests, STORY_TITLE);
    const state = buildPersistedImplementStateLiteral(planner, tp);
    expect(state.schemaVersion).toBe(1);
    expect(state.latestPlannerResponse).toBe(planner);
    expect(state.latestTestPlannerResponse).toBe(tp);
    expect(state.hasTestPlan).toBe(true);
    // Benign defaults so the panel deserializer hydrates cleanly.
    expect(state.answers).toEqual({});
    expect(state.questionStatuses).toEqual({});
    expect(state.teAnswers).toEqual({});
    expect(state.teQuestionStatuses).toEqual({});
    expect(state.specIntentTexts).toEqual({});
    expect(state.messages).toEqual([]);
    // No Maps leaked through (plain JSON object).
    expect(state.questionStatuses instanceof Map).toBe(false);
  });

  it('a generated story PUTs implement-state to /api/implement-state with the route contract', async () => {
    const bundle = buildDeps();
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(mockFetchProjectFolder).toHaveBeenCalledWith(PROJECT_ID);
    expect(bundle.putCalls).toHaveLength(1);
    const body = bundle.putCalls[0];
    expect(body.projectId).toBe(PROJECT_ID);
    expect(body.featureId).toBe('wi-1');
    expect(body.featureTitle).toBe(STORY_TITLE);
    expect(body.projectParentFolder).toBe('/abs/project-parent');
    expect(body.state.schemaVersion).toBe(1);
    expect((body.state.latestPlannerResponse as { plannerReadyForSpec: boolean }).plannerReadyForSpec).toBe(true);
    expect((body.state as { hasTestPlan: boolean }).hasTestPlan).toBe(true);
    expect(
      (body.state.latestTestPlannerResponse as { testPlan: unknown[] }).testPlan
    ).toHaveLength(2);
  });

  it('an insufficient_context story does NOT trigger a ready-state PUT (no fake-ready)', async () => {
    const bundle = buildDeps({ llmContent: insufficientLlmContent() });
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(bundle.putCalls).toHaveLength(0);
  });

  it('a PUT failure is isolated and never aborts the batch or AMS persistence (R-12 posture)', async () => {
    const failingPutter = jest.fn(async () => {
      throw new Error('disk full');
    }) as unknown as ImplementStatePutter;
    const bundle = buildDeps({ putImplementState: failingPutter });
    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    // The AMS persistence + summary still completed.
    expect(bundle.persistedRows).toHaveLength(1);
    expect(result.summary.generated).toBe(1);
    expect(failingPutter).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Group 5 -- strategic end-to-end seams (gap analysis)
//
// The per-group tests above pin each seam in isolation (validator, wire
// helpers, planner/test mappers, the PUT). The tests below close the genuine
// END-TO-END seams not otherwise covered:
//   (a) snake_case wire-agreement ROUND-TRIP: a generated row emitted via
//       toAmsWireShape (the literal POST body shape) reads back through
//       normaliseAmsRow (the GET read-back shape) with both new fields intact.
//   (b) the manual-add path (nullable book_of_work_id, D7) still carries both
//       new fields through the same wire shape + read-back.
//   (c) ONE batch run drives BOTH outputs for the same generated story: the
//       AMS-persisted snake_case wire row carries the two fields AND the
//       implement-state PUT is ready (PlannerResponse + Test Pack, zero open
//       questions, hasTestPlan).
// ---------------------------------------------------------------------------

describe('Implementation-ready generator -- Group 5 end-to-end seams', () => {
  it('snake_case wire-agreement: a generated row survives toAmsWireShape -> normaliseAmsRow round-trip with both new fields intact', () => {
    const structuredTests = [
      { title: 'GET /orders/{id} parity', description: 'byte-equivalent body', type: 'functional' },
      { title: 'OrderMapper unit', description: 'maps the legacy row', type: 'unit' },
    ];
    const row: MigrationStorySpecGenerationDto = {
      projectId: PROJECT_ID,
      workItemId: 'wi-rt',
      bookOfWorkId: BOOK_ID,
      bookItemId: 'S-rt',
      status: 'generated',
      confidence: 'high',
      generatedSpecText: '/agent-os:shape-spec migrate orders',
      structuredTestsJson: structuredTests,
      coveredEndpointIds: ['77777777-7777-7777-7777-777777777777'],
    };

    // Emit the exact JSON the batch POSTs to AMS, then re-serialise across a
    // JSON boundary to prove nothing relies on object identity, and read it
    // back via the GET-side normaliser. The two snake_case field names are the
    // wire contract shared with the AMS DTO (@JsonProperty) and the frontend
    // mapRowDtoToRow reader.
    const wire = toAmsWireShape(row);
    expect(wire.structured_tests_json).toEqual(structuredTests);
    expect(wire.covered_endpoint_ids).toEqual([
      '77777777-7777-7777-7777-777777777777',
    ]);

    const readBack = normaliseAmsRow(
      JSON.parse(JSON.stringify(wire)) as Record<string, unknown>
    );
    expect(readBack.structuredTestsJson).toEqual(structuredTests);
    expect(readBack.coveredEndpointIds).toEqual([
      '77777777-7777-7777-7777-777777777777',
    ]);
    expect(readBack.workItemId).toBe('wi-rt');
    expect(readBack.status).toBe('generated');
  });

  it('manual-add path (nullable book_of_work_id, D7) still carries both new fields through the wire shape + read-back', () => {
    // A manually-added work item produces a spec row whose book_of_work_id is
    // null (the entity already permits this). The two new fields must ride the
    // SAME generator/persistence path -- no separate manual-add wire shape.
    const structuredTests = [
      { title: 'Schema applies', description: 'changeset creates the table', type: 'functional' },
    ];
    const manualAddRow: MigrationStorySpecGenerationDto = {
      projectId: PROJECT_ID,
      workItemId: 'wi-manual',
      bookOfWorkId: null,
      bookItemId: null,
      status: 'generated',
      confidence: 'medium',
      generatedSpecText: '/agent-os:shape-spec build schema',
      structuredTestsJson: structuredTests,
      // Non-endpoint manual story -> empty endpoint ids (no fabrication).
      coveredEndpointIds: [],
    };

    const wire = toAmsWireShape(manualAddRow);
    expect(wire.book_of_work_id).toBeNull();
    expect(wire.structured_tests_json).toEqual(structuredTests);
    expect(wire.covered_endpoint_ids).toEqual([]);

    const readBack = normaliseAmsRow(
      JSON.parse(JSON.stringify(wire)) as Record<string, unknown>
    );
    expect(readBack.bookOfWorkId).toBeNull();
    expect(readBack.structuredTestsJson).toEqual(structuredTests);
    expect(readBack.coveredEndpointIds).toEqual([]);
  });

  it('one batch run drives BOTH the AMS-persisted snake_case wire row AND a ready implement-state PUT for the same story', async () => {
    // Capture the exact snake_case wire bodies the persistence dep receives, so
    // this asserts the round-trip the real defaultPersistBatchResults POSTs --
    // not just the camelCase result rows.
    const persistedWireBodies: Array<Record<string, unknown>> = [];
    const persistBatchResults: PersistBatchFn = jest.fn(
      async (_p, _b, results) => {
        for (const r of results) persistedWireBodies.push(toAmsWireShape(r));
        const withIds = results.map((r, i) => ({ ...r, id: r.id ?? `spec-${i + 1}` }));
        return {
          persistedCount: results.length,
          resultsCouldNotPersist: 0,
          perStoryResults: withIds,
        };
      }
    );
    const bundle = buildDeps({ persistBatchResults });

    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );

    // ---- Output 1: the AMS-persisted row (snake_case wire) carries both fields.
    expect(persistedWireBodies).toHaveLength(1);
    const wire = persistedWireBodies[0];
    expect(wire.work_item_id).toBe('wi-1');
    expect(wire.structured_tests_json).toEqual([
      {
        title: 'GET /customers/{id} returns 200 for a known id',
        description:
          'Given a seeded active customer, the endpoint returns the documented schema.',
        type: 'functional',
      },
      {
        title: 'CustomerLookupService maps row to DTO',
        description: 'Unit-level mapping of a DB row to the Customer DTO.',
        type: 'unit',
      },
    ]);
    expect(wire.covered_endpoint_ids).toEqual([
      '55555555-5555-5555-5555-5555bbbb2004',
    ]);
    // Read it back through the GET-side normaliser to close the AMS round-trip.
    const readBack = normaliseAmsRow(
      JSON.parse(JSON.stringify(wire)) as Record<string, unknown>
    );
    expect(readBack.structuredTestsJson).toHaveLength(2);
    expect(readBack.coveredEndpointIds).toEqual([
      '55555555-5555-5555-5555-5555bbbb2004',
    ]);

    // ---- Output 2: the implement-state PUT hydrates the screen as ready,
    // sourced from the SAME generated story (matched on featureId).
    expect(bundle.putCalls).toHaveLength(1);
    const body = bundle.putCalls[0];
    expect(body.featureId).toBe(wire.work_item_id);
    const planner = body.state.latestPlannerResponse as {
      plannerReadyForSpec: boolean;
      openQuestions: unknown[];
    };
    expect(planner.plannerReadyForSpec).toBe(true);
    expect(planner.openQuestions).toEqual([]);
    expect((body.state as { hasTestPlan: boolean }).hasTestPlan).toBe(true);
    // The Test Pack the panel reads is the SAME 2 structured tests just
    // persisted to AMS -- proving the dual outputs derive from one generation.
    const testPlan = (
      body.state.latestTestPlannerResponse as { testPlan: Array<{ type: string }> }
    ).testPlan;
    expect(testPlan).toHaveLength(2);
    expect(testPlan.map((t) => t.type).sort()).toEqual(['functional', 'unit']);
  });
});
