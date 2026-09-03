/**
 * Handler-routing pins for the SCL spec carriage (SCL pipeline spec 8,
 * 2026-08-18), driven through the REAL runShapeSpecGenerationBatch (DI seams;
 * no AMS / no LLM network — the migrationSeedBuildFilesEndToEnd mock style):
 *
 *   1. A `provenance:scl_corpus` story routes to the DETERMINISTIC carriage:
 *      the LLM mock is NEVER called for it, its persisted spec embeds the
 *      verbatim contract blocks, and the batch's ordinary story still runs
 *      the LLM path untouched.
 *   2. FAIL-SOFT: when the corpus fetch THROWS, the SCL story becomes honest
 *      `insufficient_context` naming `scl_contracts` — the batch never
 *      crashes and the story never falls through to the LLM path.
 *   3. The corpus fetch happens ONCE per batch (not per story).
 */

import {
  runShapeSpecGenerationBatch,
  ShapeSpecGenerationDeps,
  LoadedBookOfWork,
  LoadedBookOfWorkItem,
  SpecGenerationResult,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
} from '../services/migrationShapeSpecGenerationHandler';
import { MigrationSpecContextDto } from '../services/migrationSpecContextClient';
import { SclContractDto } from '../services/sclCorpusPlanner';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GET_ORDER = 'com.app.OrdersController#getOrder(String)';

function corpusContracts(): SclContractDto[] {
  return [
    {
      contract_key: 'T-GET',
      kind: 'behaviour_table',
      source_path: 'src/com/app/OrdersController.java',
      source_symbol: GET_ORDER,
      fan_in: 0,
      roots_json: { roots: [GET_ORDER] },
      body_json: {
        symbol: GET_ORDER,
        annotations: ['@GET', '@Path("/orders/{id}")'],
        rows: [
          {
            index: 0,
            kind: 'branch',
            conditionVerbatim: 'if (id == null)',
            conditionRef: { path: 'src/com/app/OrdersController.java', line: 42 },
            outcome: {
              type: 'terminal',
              verbatim: 'throw new BadRequestException("id required")',
              ref: { path: 'src/com/app/OrdersController.java', line: 43 },
              outcomeLabel: 'BAD_REQUEST',
            },
          },
        ],
        references: [],
      },
    },
  ];
}

function modernizeDecision(): TargetStateCapturedDecision {
  return {
    decisionId: 'd-http',
    projectId: 'proj-001',
    targetArchitectureId: 'arch-target-001',
    decisionCode: 'modernize.http.jaxrs-annotations',
    scopeKind: 'architecture',
    scopeRefId: null,
    answerValue: 'Spring MVC annotations',
    answerSummary: 'JAX-RS resource annotations -> Spring MVC annotations',
    createdAt: '2026-08-18T00:00:00Z',
    createdByTask: 'scl-modernization-review',
  };
}

function buildBow(): LoadedBookOfWork {
  const items: LoadedBookOfWorkItem[] = [
    {
      id: 'SCL-1',
      type: 'story',
      parentId: null,
      title: 'Implement OrdersController (1 endpoints)',
      sequenceOrder: 1,
      workItemId: 'wi-scl',
      tags: [
        'provenance:plan-deterministic',
        'stream:api_migration',
        'provenance:scl_corpus',
        'scl',
        'scl:endpoint:external',
      ],
      codeStoryKind: 'scl-endpoint-group',
      apiEndpointIds: [],
      sclContractKeys: ['T-GET'],
      sclLayer: 'endpoint:external',
      sclControllerClass: 'com.app.OrdersController',
      sclRowCount: 1,
    },
    {
      id: 'ORD-1',
      type: 'story',
      parentId: null,
      title: 'Ordinary feature story scope marker',
      sequenceOrder: 2,
      workItemId: 'wi-ordinary',
    },
  ];
  return {
    bookOfWorkId: 'book-001',
    projectId: 'proj-001',
    currentArchitectureId: 'arch-current-001',
    targetArchitectureId: 'arch-target-001',
    items,
  };
}

function genLlmContent(title: string): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${title}\n\n` +
      'Feature summary: deliver the work for this story.\n' +
      'Implementation steps: build the controller and wiring.\n' +
      'Acceptance criteria: verified behaviour.',
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions: [],
    tests: [{ title: 'Test 1', description: 'Functional test.', type: 'functional' }],
    affectedAreas: ['some/path.ts'],
    coveredEndpointIds: [],
  });
}

function makeDeps(
  bow: LoadedBookOfWork,
  capturedPersist: SpecGenerationResult[][],
  fetchSclContractsForSpecs: NonNullable<
    ShapeSpecGenerationDeps['fetchSclContractsForSpecs']
  >,
  llmSpy: jest.Mock,
): ShapeSpecGenerationDeps {
  const loadBookOfWork: BookOfWorkLoader = async () => bow;
  const loadExistingGenerations: ExistingGenerationsLoader = async () => [];
  const fetchSpecContext: SpecContextFetcher = async (input) =>
    ({
      projectId: 'proj-001',
      bookOfWorkId: 'book-001',
      workItemId: input.workItemId,
      currentArchitectureId: 'arch-current-001',
      targetArchitectureId: 'arch-target-001',
      generatedAt: '2026-08-18T00:00:00Z',
    } as MigrationSpecContextDto);
  const callLlm: LlmCaller = async (input) => {
    llmSpy(input.workItemId);
    const story = bow.items.find((it) => it.workItemId === input.workItemId);
    return { content: genLlmContent(story?.title ?? 'unknown') };
  };
  const persistBatchResults: PersistBatchFn = async (_p, _b, results) => {
    capturedPersist.push(results.map((r) => ({ ...r })));
    return { persistedCount: results.length, resultsCouldNotPersist: 0 };
  };
  return {
    loadBookOfWork,
    loadExistingGenerations,
    fetchSpecContext,
    callLlm,
    persistBatchResults,
    fetchSclContractsForSpecs,
    fetchCapturedDecisionsForSpecs: async () => [modernizeDecision()],
    fetchBaselineWireItems: async () => [],
    fetchCapturedDecisionsForCitationCheck: async () => ({
      decisions: [],
      targetArchitectureId: null,
    }),
    fetchElementInventoryForCitationCheck: async () => new Map<string, string>(),
    putImplementState: async () => ({ success: true }),
  };
}

async function runBatch(deps: ShapeSpecGenerationDeps) {
  return runShapeSpecGenerationBatch(
    { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
    deps,
  );
}

function rowFor(
  persisted: SpecGenerationResult[][],
  workItemId: string,
): SpecGenerationResult {
  const row = persisted.flat().find((r) => r.workItemId === workItemId);
  if (!row) throw new Error(`row for ${workItemId} not persisted`);
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SCL spec carriage routing through the REAL handler', () => {
  it('routes the provenance:scl_corpus story to the deterministic carriage — the LLM is never called for it', async () => {
    const persisted: SpecGenerationResult[][] = [];
    const llmSpy = jest.fn();
    const fetchScl = jest.fn().mockResolvedValue(corpusContracts());

    const result = await runBatch(makeDeps(buildBow(), persisted, fetchScl, llmSpy));

    // The corpus was fetched exactly ONCE for the whole batch.
    expect(fetchScl).toHaveBeenCalledTimes(1);
    expect(fetchScl).toHaveBeenCalledWith('proj-001', 'arch-current-001');

    // The SCL story: deterministic carriage output, no LLM call.
    expect(llmSpy).not.toHaveBeenCalledWith('wi-scl');
    const sclRow = rowFor(persisted, 'wi-scl');
    expect(sclRow.status).toBe('generated');
    expect(sclRow.confidence).toBe('high');
    const text = sclRow.generatedSpecText as string;
    expect(text).toContain('assembled DETERMINISTICALLY from the SCL corpus');
    expect(text).toContain(`### Behaviour: ${GET_ORDER}`);
    expect(text).toContain('`if (id == null)` (src/com/app/OrdersController.java:42)');
    expect(text).toContain('- [decision:modernize.http.jaxrs-annotations]');
    expect(text).not.toContain('Captured examples');
    expect(sclRow.focusedContextRefsJson).toMatchObject({ source: 'scl_spec_carriage' });

    // The ordinary story still ran the LLM path, untouched by SCL machinery.
    expect(llmSpy).toHaveBeenCalledWith('wi-ordinary');
    const ordinaryRow = rowFor(persisted, 'wi-ordinary');
    expect(ordinaryRow.generatedSpecText).toContain('/agent-os:shape-spec');
    expect(ordinaryRow.generatedSpecText).not.toContain('### Behaviour:');

    expect(result.summary.failed).toBe(0);
  });

  it('FAIL-SOFT: a corpus fetch failure makes the SCL story insufficient_context naming scl_contracts (never the LLM path, never a crashed batch)', async () => {
    const persisted: SpecGenerationResult[][] = [];
    const llmSpy = jest.fn();
    const fetchScl = jest.fn().mockRejectedValue(new Error('AMS scl read down'));

    const result = await runBatch(makeDeps(buildBow(), persisted, fetchScl, llmSpy));

    const sclRow = rowFor(persisted, 'wi-scl');
    expect(sclRow.status).toBe('insufficient_context');
    expect(sclRow.generatedSpecText ?? null).toBeNull();
    const missing = (sclRow.missingInputsJson ?? []) as Array<Record<string, unknown>>;
    expect(missing[0]?.input).toBe('scl_contracts');
    expect(String(missing[0]?.reason)).toContain('Re-run the code scan');

    // The SCL story NEVER reached the LLM; the ordinary story still generated.
    expect(llmSpy).not.toHaveBeenCalledWith('wi-scl');
    expect(rowFor(persisted, 'wi-ordinary').generatedSpecText).toContain(
      '/agent-os:shape-spec',
    );
    expect(result.summary.failed).toBe(0);
  });

  it('a corpus story whose apiEndpointIds RESOLVED still routes to the SCL carriage (2026-09-03 precedence regression)', async () => {
    // The endpoint-identity join (2026-08-30) started resolving apiEndpointIds
    // on external corpus stories. The handler tests the code-carriage branch
    // first, and its predicate accepted any code-provenance story with
    // endpoint ids — so every external corpus story was generated by the code
    // carriage (zero behaviour rows, no ACs, graded F). Pin: with ids
    // resolved, the story is STILL the deterministic SCL carriage's.
    const bow = buildBow();
    const scl = bow.items.find((i) => i.id === 'SCL-1')!;
    scl.apiEndpointIds = ['ep-orders-get'];
    const persisted: SpecGenerationResult[][] = [];
    const llmSpy = jest.fn();
    const fetchScl = jest.fn().mockResolvedValue(corpusContracts());

    const result = await runBatch(makeDeps(bow, persisted, fetchScl, llmSpy));

    const sclRow = rowFor(persisted, 'wi-scl');
    expect(sclRow.status).toBe('generated');
    expect(sclRow.focusedContextRefsJson).toMatchObject({ source: 'scl_spec_carriage' });
    expect(sclRow.generatedSpecText).toContain(`### Behaviour: ${GET_ORDER}`);
    expect(sclRow.generatedSpecText).not.toContain('No committed response contract');
    expect(llmSpy).not.toHaveBeenCalledWith('wi-scl');
    expect(result.summary.failed).toBe(0);
  });

  it('does not touch the corpus at all when the batch has no SCL stories', async () => {
    const persisted: SpecGenerationResult[][] = [];
    const llmSpy = jest.fn();
    const fetchScl = jest.fn().mockResolvedValue(corpusContracts());
    const bow = buildBow();
    bow.items = bow.items.filter((i) => i.workItemId !== 'wi-scl');

    await runBatch(makeDeps(bow, persisted, fetchScl, llmSpy));

    expect(fetchScl).not.toHaveBeenCalled();
    expect(rowFor(persisted, 'wi-ordinary').generatedSpecText).toContain(
      '/agent-os:shape-spec',
    );
  });
});
