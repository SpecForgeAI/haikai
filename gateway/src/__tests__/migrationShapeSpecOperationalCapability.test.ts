/**
 * D3 — Internal-behaviour implementation-ready spec generation (Group 3).
 *
 * Spec: 2026-06-14 internal-behaviour-implementation-ready-spec-generation
 * (Spec 3 of 6, the keystone). These tests prove the ALREADY-BUILT migration
 * spec generator runs UNCHANGED on the 7th `operational_capability` context
 * type — there is NO fork. The generator turns a capability story into a
 * generated `migration_story_spec_generations` row + an `implement-state.json`
 * PUT + an effect-oriented test pack, short-circuits a thin capability to
 * `insufficient_context` with NO LLM call, and downgrades a members+spine story
 * with a missing target-tech decision to `generated_with_warnings`.
 *
 * The capability path is exercised here via the FINDING-fallback-agnostic
 * resolver seam: the test injects the focused-context DTO the AMS resolver would
 * return (an `operational_capability` block + aggregated top-level
 * `missingInputs[]` for the thin case) via the `fetchSpecContext` dep, so the
 * gateway suite is green WITHOUT a live / populated D2 run (D12). The handler's
 * own `selectEligibleStories` + two-pass loop + implement-state writer are the
 * single path under test.
 *
 * LLM-guard: all LLM calls are injected via the `callLlm` dep (the
 * llmGuard.setup.ts live-LLM guard is active; no real model is reached). The
 * AMS-client `fetchProjectFolder` used by the implement-state writer is mocked
 * via the shared architectureModelClientMock helper.
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
  SpecGenerationResult,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
  ImplementStatePutter,
  LoadedBookOfWork,
} from '../services/migrationShapeSpecGenerationHandler';
import {
  MigrationSpecContextDto,
  FetchMigrationSpecContextInput,
} from '../services/migrationSpecContextClient';

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-cap-1';
const BOOK_ID = 'book-cap-1';
const CAP_ID = 'cap-uuid-eod-risk-batch';
const STORY_TITLE = 'Modernise End-of-Day Risk Snapshot Batch Pipeline';

/**
 * A book-of-work carrying ONE capability story. `sourceCapabilityId` is the
 * provenance link the append-capability-story endpoint stamped onto the blob
 * item; the handler reads it and forwards it to the resolver.
 */
function loadedBow(): LoadedBookOfWork {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    items: [
      {
        id: 'CAP-S1',
        type: 'story',
        parentId: null,
        title: STORY_TITLE,
        sequenceOrder: 1,
        workItemId: 'wi-cap-1',
        sourceCapabilityId: CAP_ID,
      },
    ],
  };
}

/**
 * The focused-context DTO the AMS resolver returns for a HEALTHY capability:
 * an `operational_capability` block (members + spine + behaviour) and NO
 * top-level missingInputs. `coveredEndpointIds` is irrelevant on the context
 * payload — the generator emits [] for capability stories from the LLM side.
 */
function healthyCapabilityCtx(): MigrationSpecContextDto {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'CAP-S1',
    workItemId: 'wi-cap-1',
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    generatedAt: '2026-06-14T00:00:00Z',
    operational_capability: {
      capabilityId: CAP_ID,
      source: 'capability',
      name: 'End-of-Day Risk Snapshot',
      kind: 'batch_pipeline',
      summary: 'Autosys JIL DAG -> shell -> Java main() -> Sybase risk_snapshot.',
      behaviourBearing: true,
      members: [
        { kind: 'jil_job', name: 'EOD_RISK_TRIGGER' },
        { kind: 'shell_script', name: 'run_eod.sh' },
        { kind: 'java_main', name: 'RiskSnapshotJob' },
      ],
      memberKinds: ['jil_job', 'shell_script', 'java_main'],
      detailJson: {
        schedule: '0 22 * * 1-5',
        invocations: [
          { from: 'EOD_RISK_TRIGGER', to: 'run_eod.sh' },
          { from: 'run_eod.sh', to: 'RiskSnapshotJob' },
          { from: 'RiskSnapshotJob', to: 'risk_snapshot' },
        ],
        externalSystems: ['Sybase'],
        behaviourBearing: true,
      },
    },
  } as MigrationSpecContextDto;
}

/**
 * The focused-context DTO for a THIN capability: zero members / no behaviour
 * signal. The AMS resolver aggregates the block-level `missingInputs[]` into the
 * DTO top-level array; the gateway's pre-LLM blocker path reads top-level
 * missingInputs and short-circuits to insufficient_context with NO LLM call.
 */
function thinCapabilityCtx(): MigrationSpecContextDto {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'CAP-S1',
    workItemId: 'wi-cap-1',
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    generatedAt: '2026-06-14T00:00:00Z',
    operational_capability: {
      capabilityId: CAP_ID,
      source: 'capability',
      name: 'Orphan capability',
      kind: 'housekeeping',
      summary: 'No members, no behaviour.',
      behaviourBearing: false,
      members: [],
      memberKinds: [],
      detailJson: { behaviourBearing: false },
      missingInputs: [
        {
          kind: 'capability_members',
          id: CAP_ID,
          reason: 'Capability has no members.',
        },
        {
          kind: 'capability_behaviour',
          id: CAP_ID,
          reason: 'Capability has no behaviour-bearing signal.',
        },
      ],
    },
    // Mirrors the AMS resolver's top-level aggregation of block missingInputs.
    missingInputs: [
      {
        kind: 'capability_members',
        id: CAP_ID,
        reason: 'Capability has no members.',
      },
      {
        kind: 'capability_behaviour',
        id: CAP_ID,
        reason: 'Capability has no behaviour-bearing signal.',
      },
    ],
  } as MigrationSpecContextDto;
}

/**
 * An effect-oriented generated response (the shape the prompt now steers the
 * LLM toward for operational stories): tests assert DB tables / messages /
 * snapshot outcomes, NOT HTTP request/response. `coveredEndpointIds` is [].
 */
function effectGeneratedLlmContent(
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'medium',
    specText:
      `/agent-os:shape-spec ${STORY_TITLE}\n\n` +
      'Feature summary: re-express the Autosys EOD risk batch on the captured ' +
      'modern orchestrator [decision:orchestrator] writing to Postgres, ' +
      'preserving the same schedule + snapshot outcomes.\n' +
      'Scope in: port the JIL DAG ordering + the Java snapshot job. ' +
      'Scope out: the Sybase->Postgres data migration (sibling story).\n' +
      'Acceptance criteria: Given the modern job runs at 22:00 on a weekday, ' +
      'when it completes, then risk_snapshot has one row per book.\n' +
      'Test Pack: see tests.',
    warnings: [],
    evidenceRefs: [{ type: 'captured_decision', id: 'orchestrator' }],
    assumptions: ['The captured orchestrator decision covers batch scheduling.'],
    tests: [
      {
        title: 'Running the modern EOD job populates risk_snapshot',
        description:
          'Given seeded books, when the orchestrated pipeline runs to ' +
          'completion, then the risk_snapshot table contains one row per book ' +
          '(effect assertion on the DB table, not an HTTP response).',
        type: 'functional',
      },
      {
        title: 'RiskSnapshotJob maps a source position row to a snapshot row',
        description:
          'Unit-level mapping of one source position record to the target ' +
          'risk_snapshot row shape.',
        type: 'unit',
      },
    ],
    coveredEndpointIds: [],
    affectedAreas: ['batch/eod-risk/RiskSnapshotJob'],
    ...overrides,
  });
}

/**
 * A members+spine generated response that flags a MISSING modern target-tech
 * decision: the LLM produces a spec but downgrades to generated_with_warnings
 * + a MISSING_DECISION_CONTEXT warning (per the modernisation clause) rather
 * than inventing a modern orchestrator.
 */
function missingDecisionLlmContent(): string {
  return JSON.stringify({
    status: 'generated_with_warnings',
    confidence: 'low',
    specText:
      `/agent-os:shape-spec ${STORY_TITLE}\n\n` +
      'Feature summary: modernise the EOD risk batch preserving the same ' +
      'snapshot outcomes; the modern orchestrator target is NOT yet captured.\n' +
      'Scope in: port the pipeline behaviour. Scope out: data migration.\n' +
      'Acceptance criteria: Given the pipeline runs, then risk_snapshot is ' +
      'populated with one row per book.\n' +
      'Test Pack: see tests.',
    warnings: [
      { code: 'MISSING_DECISION_CONTEXT', decision_scope: 'orchestrator' },
    ],
    evidenceRefs: [],
    assumptions: ['No modern orchestrator decision is captured yet.'],
    tests: [
      {
        title: 'Pipeline run populates risk_snapshot',
        description:
          'Given the batch runs, then the risk_snapshot table is populated ' +
          'with one row per book (effect assertion).',
        type: 'functional',
      },
    ],
    coveredEndpointIds: [],
    affectedAreas: ['batch/eod-risk'],
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
  llmCalls: number;
  contextRequests: FetchMigrationSpecContextInput[];
}

function buildDeps(opts: {
  ctx?: MigrationSpecContextDto;
  llmContent?: string;
} = {}): DepsBundle {
  const persistedRows: SpecGenerationResult[] = [];
  const putCalls: Array<Parameters<ImplementStatePutter>[0]> = [];
  const contextRequests: FetchMigrationSpecContextInput[] = [];
  const counters = { llmCalls: 0 };

  const persistBatchResults: PersistBatchFn = jest.fn(
    async (_p, _b, results) => {
      for (const r of results) persistedRows.push(r);
      const withIds = results.map((r, i) => ({ ...r, id: r.id ?? `spec-${i + 1}` }));
      return {
        persistedCount: results.length,
        resultsCouldNotPersist: 0,
        perStoryResults: withIds,
      };
    }
  ) as PersistBatchFn;

  const putImplementState = jest.fn(async (body) => {
    putCalls.push(body);
    return { success: true };
  }) as unknown as ImplementStatePutter;

  const fetchSpecContext = (async (input: FetchMigrationSpecContextInput) => {
    contextRequests.push(input);
    return opts.ctx ?? healthyCapabilityCtx();
  }) as SpecContextFetcher;

  const callLlm = (async () => {
    counters.llmCalls += 1;
    return { content: opts.llmContent ?? effectGeneratedLlmContent() };
  }) as LlmCaller;

  return {
    deps: {
      loadBookOfWork: (async () => loadedBow()) as BookOfWorkLoader,
      loadExistingGenerations: (async () => []) as ExistingGenerationsLoader,
      fetchSpecContext,
      callLlm,
      persistBatchResults,
      putImplementState,
    },
    persistedRows,
    putCalls,
    get llmCalls() {
      return counters.llmCalls;
    },
    contextRequests,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D3 operational_capability generation (Group 3) — single generator, no fork', () => {
  it('forwards the story sourceCapabilityId AND the 7th context type to the resolver request', async () => {
    const bundle = buildDeps();
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(bundle.contextRequests).toHaveLength(1);
    const req = bundle.contextRequests[0];
    // The provenance link is threaded through to the resolver so it picks the
    // capability path.
    expect(req.sourceCapabilityId).toBe(CAP_ID);
    // The 7th type is requested automatically (SHAPE_SPEC_CONTEXT_TYPES spread).
    expect(req.contextTypes).toContain('operational_capability');
  });

  it('a capability story -> a generated row + implement-state PUT + an effect-oriented test pack', async () => {
    const bundle = buildDeps();
    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );

    // ---- a generated migration_story_spec_generations row.
    expect(bundle.persistedRows).toHaveLength(1);
    const row = bundle.persistedRows[0];
    expect(['generated', 'generated_with_warnings']).toContain(row.status);
    expect(row.workItemId).toBe('wi-cap-1');
    expect(row.generatedSpecText?.startsWith('/agent-os:shape-spec')).toBe(true);

    // ---- the effect-oriented test pack persisted (DB-table / snapshot effects,
    // not HTTP request/response), reusing the unit|functional shape.
    expect(row.structuredTestsJson).toEqual([
      {
        title: 'Running the modern EOD job populates risk_snapshot',
        description:
          'Given seeded books, when the orchestrated pipeline runs to ' +
          'completion, then the risk_snapshot table contains one row per book ' +
          '(effect assertion on the DB table, not an HTTP response).',
        type: 'functional',
      },
      {
        title: 'RiskSnapshotJob maps a source position row to a snapshot row',
        description:
          'Unit-level mapping of one source position record to the target ' +
          'risk_snapshot row shape.',
        type: 'unit',
      },
    ]);
    // The persisted pack is genuinely effect-flavoured + carries no E2E types.
    const types = (row.structuredTestsJson ?? []).map((t) => t.type);
    expect(types.every((t) => t === 'unit' || t === 'functional')).toBe(true);

    // ---- implement-state.json written for the generated capability story.
    expect(mockFetchProjectFolder).toHaveBeenCalledWith(PROJECT_ID);
    expect(bundle.putCalls).toHaveLength(1);
    const put = bundle.putCalls[0];
    expect(put.featureId).toBe('wi-cap-1');
    expect(put.featureTitle).toBe(STORY_TITLE);
    expect(put.state.schemaVersion).toBe(1);
    expect((put.state as { hasTestPlan: boolean }).hasTestPlan).toBe(true);

    expect(result.summary.generated + result.summary.generated_with_warnings).toBe(1);
  });

  it('coveredEndpointIds is EMPTY [] for the capability story (validator allows empty)', async () => {
    const bundle = buildDeps();
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(bundle.persistedRows[0].coveredEndpointIds).toEqual([]);
  });

  it('a thin capability (zero members / no behaviour) short-circuits to insufficient_context with NO LLM call', async () => {
    const bundle = buildDeps({ ctx: thinCapabilityCtx() });
    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    // No LLM call — the pre-LLM blocker path fired on the aggregated top-level
    // missingInputs the resolver emitted for the thin capability.
    expect(bundle.llmCalls).toBe(0);
    expect(bundle.persistedRows).toHaveLength(1);
    const row = bundle.persistedRows[0];
    expect(row.status).toBe('insufficient_context');
    const kinds = (row.missingInputsJson ?? []).map((m) => m.kind);
    expect(kinds).toContain('capability_members');
    expect(kinds).toContain('capability_behaviour');
    // No fake-ready implement-state PUT for a blocked story.
    expect(bundle.putCalls).toHaveLength(0);
    expect(result.summary.insufficient_context).toBe(1);
  });

  it('members+spine but a MISSING target-tech decision -> generated_with_warnings (downgraded, NOT blocked)', async () => {
    const bundle = buildDeps({ llmContent: missingDecisionLlmContent() });
    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    // The LLM WAS called (members + spine are sufficient context) and produced a
    // spec, but flagged the missing modern target rather than inventing one.
    expect(bundle.llmCalls).toBe(1);
    expect(bundle.persistedRows).toHaveLength(1);
    const row = bundle.persistedRows[0];
    expect(row.status).toBe('generated_with_warnings');
    const codes = (row.warningsJson ?? []).map((w) => w.code);
    expect(codes).toContain('MISSING_DECISION_CONTEXT');
    // A downgraded-but-generated story is NOT blocked.
    expect(result.summary.generated_with_warnings).toBe(1);
    expect(result.summary.insufficient_context).toBe(0);
  });

  it('a monitoring-kind capability also generates (kinds handled uniformly, not just batch_pipeline)', async () => {
    const monitoringCtx = {
      ...healthyCapabilityCtx(),
      operational_capability: {
        ...(healthyCapabilityCtx().operational_capability as Record<string, unknown>),
        kind: 'monitoring',
        name: 'Geneos EOD heartbeat',
      },
    } as MigrationSpecContextDto;
    const bundle = buildDeps({ ctx: monitoringCtx });
    await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      bundle.deps
    );
    expect(bundle.persistedRows).toHaveLength(1);
    expect(['generated', 'generated_with_warnings']).toContain(
      bundle.persistedRows[0].status
    );
  });
});
