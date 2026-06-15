/**
 * D3 — Internal-behaviour implementation-ready spec generation (Group 5, strategic gap tests).
 *
 * Spec: 2026-06-14 internal-behaviour-implementation-ready-spec-generation
 * (Spec 3 of 6, the keystone).
 *
 * WHAT THIS COVERS THAT GROUPS 1-4 DO NOT
 * --------------------------------------
 * The per-group gateway tests (Group 3 `migrationShapeSpecOperationalCapability`)
 * inject BOTH the book-of-work loader AND the focused-context fetcher as stubs,
 * so they never exercise the real WIRE seams:
 *
 *   1. `defaultLoadBookOfWork` parsing `source_capability_id` off the AMS
 *      `book_of_work_json.items[]` blob (the provenance the append-capability-
 *      story endpoint stamped), and
 *   2. `fetchMigrationSpecContext` serialising that `sourceCapabilityId` into the
 *      AMS `POST /migration-spec-context` request body AND parsing the
 *      `operational_capability` block back out of the AMS response.
 *
 * These tests drive `runShapeSpecGenerationBatch` with the REAL loader + REAL
 * focused-context client, mocking only `global.fetch` (the two AMS round-trips:
 * GET book-of-work + POST migration-spec-context) and injecting the LLM /
 * persist / implement-state / citation deps. They assert the keystone claim from
 * the spec: `source_capability_id` flows BLOB -> CONTEXT REQUEST -> CAPABILITY
 * BLOCK (the capability path, NOT the finding fallback) -> a generated row +
 * implement-state.json + an effect-oriented test pack.
 *
 * The three seams under test (each genuinely uncovered by Groups 1-4):
 *   T1. Capability path END-TO-END through the real loader + real client.
 *   T2. Finding-fallback wire seam: NO `source_capability_id` on the blob =>
 *       the real client OMITS `sourceCapabilityId` from the AMS request body =>
 *       a finding-sourced `operational_capability` block still generates.
 *   T3. NO-REGRESSION: a normal `api` story (no capability id, no
 *       `operational_capability` block) still generates unchanged through the
 *       same real loader + real client (the 7th type is purely additive).
 *
 * The following Group 5 targets are ALREADY COVERED by earlier groups and are
 * deliberately NOT duplicated here:
 *   - thin capability -> `insufficient_context` with NO LLM call
 *     (Group 3 `migrationShapeSpecOperationalCapability.test.ts`).
 *   - members+spine but a missing target-tech decision ->
 *     `generated_with_warnings` (Group 3, same file).
 *   - a `monitoring`-kind capability also generates (Group 3, same file —
 *     kinds are opaque to the generator, so one non-batch kind suffices).
 *   - the 6 existing context types still resolve unchanged at the resolver
 *     (Group 1 AMS `MigrationSpecContextResolverOperationalCapabilityTest`).
 *
 * LLM-guard: the global `llmGuard.setup.ts` is active (no real model reachable);
 * the LLM is injected via the `callLlm` dep. The architecture-model client is
 * mocked via the shared `architectureModelClientMock` helper so
 * `fetchProjectFolder` (implement-state) + `resolveDefaultArchitectureId` are
 * deterministic and no live AMS call leaks.
 */

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE imports)
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

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  runShapeSpecGenerationBatch,
  SpecGenerationResult,
  ExistingGenerationsLoader,
  LlmCaller,
  PersistBatchFn,
  ImplementStatePutter,
  CapturedDecisionsForCitationFetcher,
  ElementInventoryForCitationFetcher,
} from '../services/migrationShapeSpecGenerationHandler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:8080';
const PROJECT_ID = 'proj-cap-e2e';
const BOOK_ID = 'book-cap-e2e';
const CAP_ID = 'cap-uuid-eod-risk-batch';
const WORK_ITEM_ID = 'wi-cap-e2e-1';
const CAP_STORY_TITLE = 'Modernise End-of-Day Risk Snapshot Batch Pipeline';
const API_STORY_TITLE = 'Modernise GET /risk/{book}/snapshot endpoint';

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () =>
      body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

/**
 * The AMS `GET /migration-books-of-work/{bookId}` wire shape (snake_case). The
 * single blob item carries `source_capability_id` when `capabilityId` is
 * provided — exactly the provenance the append-capability-story endpoint stamps.
 */
function bookOfWorkWire(opts: {
  capabilityId?: string | null;
  storyTitle: string;
}): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: 'CAP-S1',
    type: 'story',
    title: opts.storyTitle,
    sequenceOrder: 1,
    workItemId: WORK_ITEM_ID,
  };
  if (opts.capabilityId) {
    item.source_capability_id = opts.capabilityId;
  }
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-cur-1',
    target_architecture_id: 'arch-tgt-1',
    book_of_work_json: { items: [item] },
  };
}

/** The AMS `POST /migration-spec-context` DTO carrying a CAPABILITY-sourced block. */
function capabilityContextDtoWire(): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'CAP-S1',
    workItemId: WORK_ITEM_ID,
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    generatedAt: '2026-06-14T00:00:00Z',
    // 7th block — `source: 'capability'` proves the PREFERRED capability path
    // (NOT the finding fallback) was taken because `sourceCapabilityId` reached
    // the resolver.
    operational_capability: {
      capabilityId: CAP_ID,
      source: 'capability',
      name: 'End-of-Day Risk Snapshot',
      kind: 'batch_pipeline',
      summary: 'Autosys JIL DAG -> shell -> Java main() -> Sybase risk_snapshot.',
      behaviourBearing: true,
      members: [
        { kind: 'jil_job', name: 'EOD_RISK_TRIGGER' },
        { kind: 'java_main', name: 'RiskSnapshotJob' },
      ],
      memberKinds: ['jil_job', 'java_main'],
      detailJson: {
        schedule: '0 22 * * 1-5',
        invocations: [{ from: 'EOD_RISK_TRIGGER', to: 'RiskSnapshotJob' }],
        externalSystems: ['Sybase'],
        behaviourBearing: true,
      },
    },
  };
}

/** The AMS DTO carrying a FINDING-fallback-sourced block (no capability resolved). */
function findingContextDtoWire(): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'CAP-S1',
    workItemId: WORK_ITEM_ID,
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    generatedAt: '2026-06-14T00:00:00Z',
    operational_capability: {
      findingId: 'finding-uuid-jil-1',
      source: 'finding',
      name: 'daily_risk_load.jil',
      kind: 'autosys_jil',
      summary: 'CA Autosys JIL job that triggers the nightly risk load.',
      behaviourBearing: true,
      members: [],
      memberKinds: [],
      detailJson: {
        invokes: ['load_risk.sh'],
        outputs: ['RISK_HIERARCHY'],
        behaviourBearing: true,
      },
    },
  };
}

/** The AMS DTO for a NORMAL api story (no `operational_capability` block). */
function apiContextDtoWire(): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'CAP-S1',
    workItemId: WORK_ITEM_ID,
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    generatedAt: '2026-06-14T00:00:00Z',
    api: {
      operationId: 'getRiskSnapshot',
      oasContractId: 'oas-risk-1',
      behaviourBaselineIds: ['baseline-1'],
      mappingIds: ['map-1'],
    },
  };
}

/**
 * An effect-oriented generated LLM response (operational story): tests assert DB
 * tables / messages / snapshot outcomes, NOT HTTP request/response.
 * `coveredEndpointIds` is [].
 */
function effectGeneratedLlmContent(title: string): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'medium',
    specText:
      `/agent-os:shape-spec ${title}\n\n` +
      'Feature summary: re-express the Autosys EOD risk batch on the captured ' +
      'modern orchestrator [decision:orchestrator] writing to Postgres, ' +
      'preserving the same schedule + snapshot outcomes.\n' +
      'Scope in: port the JIL DAG ordering + the Java snapshot job.\n' +
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
        description: 'Unit-level mapping of one source position record.',
        type: 'unit',
      },
    ],
    coveredEndpointIds: [],
    affectedAreas: ['batch/eod-risk/RiskSnapshotJob'],
  });
}

/** A plain generated LLM response for the normal api story (covers an endpoint). */
function apiGeneratedLlmContent(title: string): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${title}\n\n` +
      'Feature summary: re-platform the risk snapshot read endpoint.\n' +
      'Acceptance criteria: Given a book id, when GET is called, then the ' +
      'current snapshot is returned with the same response shape.\n' +
      'Test Pack: see tests.',
    warnings: [],
    evidenceRefs: [],
    assumptions: [],
    tests: [
      {
        title: 'GET returns 200 with the snapshot for a known book',
        description:
          'Given a seeded snapshot, when GET /risk/{book}/snapshot is called, ' +
          'then 200 + the snapshot body is returned.',
        type: 'functional',
      },
    ],
    coveredEndpointIds: ['getRiskSnapshot'],
    affectedAreas: ['api/risk/snapshot'],
  });
}

// ---------------------------------------------------------------------------
// global.fetch router (the ONLY real AMS traffic: GET book-of-work + POST ctx)
// ---------------------------------------------------------------------------

/**
 * Routes the two AMS round-trips the REAL loader + REAL client make, records
 * every call (so the request body can be asserted), and returns the supplied
 * book + context wires. Any other URL is a test bug (we inject the remaining
 * deps so nothing else should hit `fetch`).
 */
function installFetchRouter(opts: {
  bookWire: Record<string, unknown>;
  contextWire: Record<string, unknown>;
  calls: FetchCall[];
}): void {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    opts.calls.push({ url, method, body });

    if (
      url === `${BASE_URL}/api/projects/${PROJECT_ID}/migration-spec-context` &&
      method === 'POST'
    ) {
      return jsonResponse(200, opts.contextWire);
    }
    if (
      url ===
        `${BASE_URL}/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}` &&
      method === 'GET'
    ) {
      return jsonResponse(200, opts.bookWire);
    }
    throw new Error(`Unexpected fetch in E2E test: ${method} ${url}`);
  });
}

// ---------------------------------------------------------------------------
// Injected deps (everything EXCEPT the loader + the focused-context client,
// which run for real against the routed global.fetch)
// ---------------------------------------------------------------------------

interface Captured {
  persistedRows: SpecGenerationResult[];
  putCalls: Array<Parameters<ImplementStatePutter>[0]>;
  llmCalls: Array<Parameters<LlmCaller>[0]>;
}

function buildInjectedDeps(llmContent: string): {
  deps: {
    loadExistingGenerations: ExistingGenerationsLoader;
    callLlm: LlmCaller;
    persistBatchResults: PersistBatchFn;
    putImplementState: ImplementStatePutter;
    fetchCapturedDecisionsForCitationCheck: CapturedDecisionsForCitationFetcher;
    fetchElementInventoryForCitationCheck: ElementInventoryForCitationFetcher;
  };
  captured: Captured;
} {
  const captured: Captured = { persistedRows: [], putCalls: [], llmCalls: [] };

  const loadExistingGenerations = (async () =>
    []) as ExistingGenerationsLoader;

  const callLlm = (async (input: Parameters<LlmCaller>[0]) => {
    captured.llmCalls.push(input);
    return { content: llmContent };
  }) as LlmCaller;

  const persistBatchResults = (async (
    _p: string,
    _b: string,
    results: SpecGenerationResult[]
  ) => {
    for (const r of results) captured.persistedRows.push(r);
    const withIds = results.map((r, i) => ({ ...r, id: r.id ?? `spec-${i + 1}` }));
    return {
      persistedCount: results.length,
      resultsCouldNotPersist: 0,
      perStoryResults: withIds,
    };
  }) as PersistBatchFn;

  const putImplementState = (async (
    body: Parameters<ImplementStatePutter>[0]
  ) => {
    captured.putCalls.push(body);
    return { success: true };
  }) as ImplementStatePutter;

  const fetchCapturedDecisionsForCitationCheck = (async () => ({
    decisions: [],
    targetArchitectureId: null,
  })) as CapturedDecisionsForCitationFetcher;

  const fetchElementInventoryForCitationCheck = (async () =>
    new Map<string, string>()) as ElementInventoryForCitationFetcher;

  return {
    deps: {
      loadExistingGenerations,
      callLlm,
      persistBatchResults,
      putImplementState,
      fetchCapturedDecisionsForCitationCheck,
      fetchElementInventoryForCitationCheck,
    },
    captured,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetchProjectFolder.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D3 operational_capability END-TO-END (Group 5) — real loader + real focused-context client', () => {
  it('T1: capability path END-TO-END — source_capability_id flows BLOB -> CONTEXT REQUEST -> CAPABILITY block -> generated row + implement-state + effect pack', async () => {
    const calls: FetchCall[] = [];
    installFetchRouter({
      bookWire: bookOfWorkWire({ capabilityId: CAP_ID, storyTitle: CAP_STORY_TITLE }),
      contextWire: capabilityContextDtoWire(),
      calls,
    });
    const { deps, captured } = buildInjectedDeps(
      effectGeneratedLlmContent(CAP_STORY_TITLE)
    );

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    // ---- BLOB -> CONTEXT REQUEST: the real client serialised the
    // source_capability_id (parsed by the real loader off the blob's
    // snake_case `source_capability_id`) into the AMS migration-spec-context
    // POST body, AND requested the 7th type.
    const ctxCall = calls.find((c) =>
      c.url.endsWith('/migration-spec-context')
    );
    expect(ctxCall).toBeDefined();
    expect(ctxCall?.method).toBe('POST');
    expect(ctxCall?.body?.sourceCapabilityId).toBe(CAP_ID);
    expect(ctxCall?.body?.contextTypes).toContain('operational_capability');

    // ---- CAPABILITY block (NOT the finding fallback) reached the generator and
    // a generated migration_story_spec_generations row was produced.
    expect(captured.llmCalls).toHaveLength(1);
    const sentUserPrompt = captured.llmCalls[0].userPrompt;
    // The capability-sourced block (source=capability + its members/spine) is
    // serialised into the generation prompt — the resolver context client
    // parsed `operational_capability` out of the AMS response.
    expect(sentUserPrompt).toContain('operational_capability');
    expect(sentUserPrompt).toContain('End-of-Day Risk Snapshot');

    expect(captured.persistedRows).toHaveLength(1);
    const row = captured.persistedRows[0];
    expect(['generated', 'generated_with_warnings']).toContain(row.status);
    expect(row.workItemId).toBe(WORK_ITEM_ID);
    expect(row.generatedSpecText?.startsWith('/agent-os:shape-spec')).toBe(true);

    // ---- the effect-oriented test pack persisted (DB-table / snapshot effects),
    // reusing the unit|functional shape; coveredEndpointIds is [].
    const types = (row.structuredTestsJson ?? []).map((t) => t.type);
    expect(types).toEqual(['functional', 'unit']);
    expect(types.every((t) => t === 'unit' || t === 'functional')).toBe(true);
    expect(row.coveredEndpointIds).toEqual([]);

    // ---- implement-state.json written for the generated capability story.
    expect(mockFetchProjectFolder).toHaveBeenCalledWith(PROJECT_ID);
    expect(captured.putCalls).toHaveLength(1);
    expect(captured.putCalls[0].featureId).toBe(WORK_ITEM_ID);
    expect(captured.putCalls[0].featureTitle).toBe(CAP_STORY_TITLE);

    expect(result.summary.generated + result.summary.generated_with_warnings).toBe(1);
  });

  it('T2: finding-fallback wire seam — NO source_capability_id on the blob => the real client OMITS sourceCapabilityId from the AMS request => a finding-sourced block still generates', async () => {
    const calls: FetchCall[] = [];
    installFetchRouter({
      // The blob carries NO source_capability_id — the resolver will fall back
      // to a behaviour-bearing operational_artifact finding (which the mocked
      // AMS returns as source='finding').
      bookWire: bookOfWorkWire({ capabilityId: null, storyTitle: CAP_STORY_TITLE }),
      contextWire: findingContextDtoWire(),
      calls,
    });
    const { deps, captured } = buildInjectedDeps(
      effectGeneratedLlmContent(CAP_STORY_TITLE)
    );

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    // The real client OMITS sourceCapabilityId from the request body entirely
    // when the blob had none (the wire trigger for the resolver's finding
    // fallback). The 7th type is still requested.
    const ctxCall = calls.find((c) =>
      c.url.endsWith('/migration-spec-context')
    );
    expect(ctxCall).toBeDefined();
    expect('sourceCapabilityId' in (ctxCall?.body ?? {})).toBe(false);
    expect(ctxCall?.body?.contextTypes).toContain('operational_capability');

    // The finding-sourced operational_capability block was parsed by the real
    // client and still drives a generated spec (D3 is testable WITHOUT a
    // populated D2 capability — D12).
    expect(captured.llmCalls).toHaveLength(1);
    expect(captured.llmCalls[0].userPrompt).toContain('daily_risk_load.jil');

    expect(captured.persistedRows).toHaveLength(1);
    const row = captured.persistedRows[0];
    expect(['generated', 'generated_with_warnings']).toContain(row.status);
    expect(row.coveredEndpointIds).toEqual([]);
    expect(captured.putCalls).toHaveLength(1);
    expect(result.summary.generated + result.summary.generated_with_warnings).toBe(1);
  });

  it('T3: NO-REGRESSION — a normal api story (no capability id, no operational_capability block) still generates unchanged through the same real loader + client', async () => {
    const calls: FetchCall[] = [];
    installFetchRouter({
      bookWire: bookOfWorkWire({ capabilityId: null, storyTitle: API_STORY_TITLE }),
      contextWire: apiContextDtoWire(),
      calls,
    });
    const { deps, captured } = buildInjectedDeps(
      apiGeneratedLlmContent(API_STORY_TITLE)
    );

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    // The 7th type is requested for EVERY story (additive), but no
    // sourceCapabilityId is serialised for a plain api story and the response
    // carries no operational_capability block.
    const ctxCall = calls.find((c) =>
      c.url.endsWith('/migration-spec-context')
    );
    expect(ctxCall?.body?.contextTypes).toContain('operational_capability');
    expect('sourceCapabilityId' in (ctxCall?.body ?? {})).toBe(false);

    // The api story generates exactly as before the 7th type existed.
    expect(captured.persistedRows).toHaveLength(1);
    const row = captured.persistedRows[0];
    expect(row.status).toBe('generated');
    expect(row.workItemId).toBe(WORK_ITEM_ID);
    // An endpoint story keeps its covered endpoint ids (NOT forced to []).
    expect(row.coveredEndpointIds).toEqual(['getRiskSnapshot']);
    expect(captured.putCalls).toHaveLength(1);
    expect(result.summary.generated).toBe(1);
  });
});
