/**
 * D5 — Net-new backlog items + provenance (Group 3, gateway).
 *
 * Spec: 2026-06-14 net-new-backlog-items-and-provenance (Spec 5 of 6).
 *
 * These tests cover the GATEWAY half of D5:
 *
 *   1. DESCRIPTION-GROUNDED spec-gen mode for a manual add. A manually-added
 *      story carries a `provenance` + `kind` (+ a human `description`) on the
 *      `book_of_work_json` blob and NO `source_capability_id`. The handler runs
 *      the SAME two-pass / confidence / implement-state / persistence generator
 *      but swaps the CONTEXT SOURCE: the human description REPLACES the
 *      discovered-context resolver fetch (`fetchMigrationSpecContext`). For
 *      `net_new` the no-fabrication / insufficient-context short-circuit RELAXES
 *      (the description is authoritative), so generation reaches `generated` +
 *      writes the implement-state + the test pack the normal way.
 *
 *   2. `kind` tunes ONLY the prompt FLAVOUR: `api` -> endpoint orientation;
 *      `operational` -> effect-test orientation (description-grounded, NOT D3's
 *      discovered operational_capability / capability path).
 *
 *   3. The add-item gateway route: calls the AMS add-item endpoint (which mints
 *      the story + stamps provenance) then triggers description-grounded
 *      generation for that one `workItemId`.
 *
 *   4. Read-only confirmations (no new code): a `net_new` spec-ready story
 *      dispatches UNCHANGED through `buildOrderedDispatchSet` (which reads no
 *      provenance) and is NOT in D4's carry_over must-account set (the gate's
 *      must-account set is DISCOVERED capabilities/findings only).
 *
 * LLM-guard: the live-LLM guard is active; the LLM is ALWAYS injected via the
 * `callLlm` dep (no real model is ever reached). The architecture-model client
 * is mocked via the shared `architectureModelClientMock` helper so
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
    fetchProjectConfigWithDefaults: jest.fn(),
  });
});

jest.mock('../services/epicCapturedDecisionsClient', () => ({
  autoSeedEpicCapturedDecision: jest.fn(),
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import {
  runShapeSpecGenerationBatch,
  SpecGenerationResult,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
  ImplementStatePutter,
  CapturedDecisionsForCitationFetcher,
  ElementInventoryForCitationFetcher,
  LoadedBookOfWork,
} from '../services/migrationShapeSpecGenerationHandler';
import {
  buildOrderedDispatchSet,
} from '../services/migrationExecutionDriver';
import {
  computeCarryOverCoverage,
} from '../services/migrationCarryOverCoverage';
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-net-new';
const BOOK_ID = 'book-net-new';
const WORK_ITEM_ID = 'wi-net-new-1';
const API_TITLE = 'Add a new GET /portfolio/{id}/summary endpoint';
const OPERATIONAL_TITLE = 'Add a nightly portfolio-revaluation batch job';
const API_DESCRIPTION =
  'A brand new read endpoint that returns an aggregated portfolio summary ' +
  '(positions + P&L) for a portfolio id. There is no current-state endpoint ' +
  'for this; it is genuinely additive.';
const OPERATIONAL_DESCRIPTION =
  'A new scheduled job that revalues every open portfolio at 02:00 and writes ' +
  'the result to a portfolio_valuation table, emitting a completion event. No ' +
  'such job exists today.';

/**
 * A book-of-work carrying ONE MANUAL-ADD story. The `provenance` + `kind` (+
 * description) are what the AMS add-item endpoint stamps onto the blob item;
 * there is deliberately NO `sourceCapabilityId` (a manual add has no discovered
 * capability/finding) — that is the signal the handler uses to run
 * description-grounded.
 */
function manualAddBow(opts: {
  provenance: 'carry_over' | 'net_new';
  kind: 'api' | 'operational';
  title: string;
  description: string;
}): LoadedBookOfWork {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur-1',
    targetArchitectureId: 'arch-tgt-1',
    items: [
      {
        id: 'NN-S1',
        type: 'story',
        parentId: null,
        title: opts.title,
        sequenceOrder: 1,
        workItemId: WORK_ITEM_ID,
        description: opts.description,
        provenance: opts.provenance,
        kind: opts.kind,
        // NO sourceCapabilityId — this is what keeps it OUT of the discovered
        // capability path and routes it to description-grounded spec-gen.
      },
    ],
  };
}

/** A generated LLM response for the API-flavoured manual add (covers an endpoint). */
function apiGeneratedLlmContent(title: string): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${title}\n\n` +
      'Feature summary: add a new aggregated portfolio summary read endpoint.\n' +
      'Acceptance criteria: Given a portfolio id, when GET /portfolio/{id}/summary ' +
      'is called, then a 200 with positions + P&L is returned.\n' +
      'Test Pack: see tests.',
    warnings: [],
    evidenceRefs: [],
    assumptions: ['The portfolio aggregate is computed from current positions.'],
    tests: [
      {
        title: 'GET returns 200 with the portfolio summary for a known id',
        description:
          'Given a seeded portfolio, when GET /portfolio/{id}/summary is called, ' +
          'then 200 + the summary body is returned.',
        type: 'functional',
      },
    ],
    coveredEndpointIds: ['getPortfolioSummary'],
    affectedAreas: ['api/portfolio/summary'],
  });
}

/**
 * An effect-oriented generated LLM response for the OPERATIONAL-flavoured manual
 * add: tests assert the DB table / completion event the job produces, NOT an
 * HTTP request/response. `coveredEndpointIds` is [].
 */
function effectGeneratedLlmContent(title: string): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'medium',
    specText:
      `/agent-os:shape-spec ${title}\n\n` +
      'Feature summary: add a nightly portfolio-revaluation batch job that ' +
      'writes portfolio_valuation and emits a completion event.\n' +
      'Acceptance criteria: Given open portfolios, when the job runs at 02:00, ' +
      'then portfolio_valuation has one row per portfolio.\n' +
      'Test Pack: see tests.',
    warnings: [],
    evidenceRefs: [],
    assumptions: ['The revaluation reuses the current pricing source.'],
    tests: [
      {
        title: 'Running the revaluation job populates portfolio_valuation',
        description:
          'Given open portfolios, when the batch runs to completion, then the ' +
          'portfolio_valuation table contains one row per portfolio (effect on ' +
          'the DB table, not an HTTP response).',
        type: 'functional',
      },
      {
        title: 'Job emits the completion event when finished',
        description:
          'Given the batch completes, then a completion event is emitted ' +
          '(downstream effect).',
        type: 'functional',
      },
    ],
    coveredEndpointIds: [],
    affectedAreas: ['batch/portfolio-revaluation'],
  });
}

/**
 * An `insufficient_context` LLM response — the shape a discovered story gets
 * when the resolver returns nothing. For a `net_new` manual add this MUST NOT
 * be the terminal status: the description is the authoritative intent, so the
 * relaxed mode promotes it to a real generated spec (we assert the handler does
 * not park at insufficient_context). NOTE: in the relaxed path the handler does
 * not call the LLM with the "guess from discovered context" framing, so this
 * fixture is used to PROVE the manual-add path never even reaches a resolver
 * blocker.
 */

interface Captured {
  persistedRows: SpecGenerationResult[];
  putCalls: Array<Parameters<ImplementStatePutter>[0]>;
  llmCalls: Array<Parameters<LlmCaller>[0]>;
  contextFetches: number;
}

/**
 * Inject every dep EXCEPT the loader: the loader is supplied per-test so we can
 * vary provenance/kind. `fetchSpecContext` is wired to a spy that THROWS if it
 * is ever called for a manual add (the description-grounded mode must NOT hit
 * the resolver).
 */
function buildInjectedDeps(opts: {
  bow: LoadedBookOfWork;
  llmContent: string;
}): {
  deps: {
    loadBookOfWork: BookOfWorkLoader;
    loadExistingGenerations: ExistingGenerationsLoader;
    fetchSpecContext: SpecContextFetcher;
    callLlm: LlmCaller;
    persistBatchResults: PersistBatchFn;
    putImplementState: ImplementStatePutter;
    fetchCapturedDecisionsForCitationCheck: CapturedDecisionsForCitationFetcher;
    fetchElementInventoryForCitationCheck: ElementInventoryForCitationFetcher;
  };
  captured: Captured;
} {
  const captured: Captured = {
    persistedRows: [],
    putCalls: [],
    llmCalls: [],
    contextFetches: 0,
  };

  const loadBookOfWork = (async () => opts.bow) as BookOfWorkLoader;
  const loadExistingGenerations = (async () => []) as ExistingGenerationsLoader;

  // The discovered-context resolver. For a manual add the handler MUST NOT call
  // this — the description is the context. If it is called, the test fails.
  const fetchSpecContext = (async () => {
    captured.contextFetches += 1;
    throw new Error(
      'fetchSpecContext (discovered-context resolver) must NOT be called for a ' +
        'manual add — the human description is the sole context.'
    );
  }) as SpecContextFetcher;

  const callLlm = (async (input: Parameters<LlmCaller>[0]) => {
    captured.llmCalls.push(input);
    return { content: opts.llmContent };
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
      loadBookOfWork,
      loadExistingGenerations,
      fetchSpecContext,
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

// ===========================================================================
// 1 + 2 — description-grounded mode (API + operational flavours)
// ===========================================================================

describe('D5 description-grounded spec-gen for manual adds', () => {
  it('a net_new API-kind manual add runs description-grounded (description is the sole context, NOT the resolver) and reaches generated + implement-state + a test pack', async () => {
    const { deps, captured } = buildInjectedDeps({
      bow: manualAddBow({
        provenance: 'net_new',
        kind: 'api',
        title: API_TITLE,
        description: API_DESCRIPTION,
      }),
      llmContent: apiGeneratedLlmContent(API_TITLE),
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    // The discovered-context resolver was NEVER called (description-grounded).
    expect(captured.contextFetches).toBe(0);

    // The human description IS the context fed to the generator prompt.
    expect(captured.llmCalls).toHaveLength(1);
    const userPrompt = captured.llmCalls[0].userPrompt;
    expect(userPrompt).toContain(API_DESCRIPTION);
    // API flavour => endpoint orientation in the prompt framing.
    expect(userPrompt.toLowerCase()).toContain('endpoint');

    // Reached `generated` the normal way + persisted a row.
    expect(captured.persistedRows).toHaveLength(1);
    const row = captured.persistedRows[0];
    expect(row.status).toBe('generated');
    expect(row.workItemId).toBe(WORK_ITEM_ID);
    expect(row.generatedSpecText?.startsWith('/agent-os:shape-spec')).toBe(true);
    // The structured test pack rode along.
    expect((row.structuredTestsJson ?? []).length).toBeGreaterThan(0);
    // API story keeps its covered endpoint ids.
    expect(row.coveredEndpointIds).toEqual(['getPortfolioSummary']);

    // implement-state.json written for the generated manual-add story.
    expect(mockFetchProjectFolder).toHaveBeenCalledWith(PROJECT_ID);
    expect(captured.putCalls).toHaveLength(1);
    expect(captured.putCalls[0].featureId).toBe(WORK_ITEM_ID);

    expect(result.summary.generated).toBe(1);
  });

  it('a net_new OPERATIONAL-kind manual add tunes the prompt to effect-test orientation and produces an effect-oriented pack (description-grounded, NOT the capability path)', async () => {
    const { deps, captured } = buildInjectedDeps({
      bow: manualAddBow({
        provenance: 'net_new',
        kind: 'operational',
        title: OPERATIONAL_TITLE,
        description: OPERATIONAL_DESCRIPTION,
      }),
      llmContent: effectGeneratedLlmContent(OPERATIONAL_TITLE),
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    // Description-grounded: the resolver was not called, and the story never
    // routed through D3's operational_capability path (no operational_capability
    // block is built — the description is the context).
    expect(captured.contextFetches).toBe(0);
    expect(captured.llmCalls).toHaveLength(1);
    const userPrompt = captured.llmCalls[0].userPrompt;
    expect(userPrompt).toContain(OPERATIONAL_DESCRIPTION);
    // Operational flavour => effect-test orientation in the framing.
    expect(userPrompt.toLowerCase()).toContain('effect');
    // It is NOT the discovered operational_capability resolver path.
    expect(userPrompt).not.toContain('operational_capability');

    expect(captured.persistedRows).toHaveLength(1);
    const row = captured.persistedRows[0];
    expect(['generated', 'generated_with_warnings']).toContain(row.status);
    // An effect-oriented operational story carries NO covered endpoints.
    expect(row.coveredEndpointIds).toEqual([]);
    const types = (row.structuredTestsJson ?? []).map((t) => t.type);
    expect(types.every((t) => t === 'unit' || t === 'functional')).toBe(true);
    expect(types).toContain('functional');

    expect(captured.putCalls).toHaveLength(1);
    expect(result.summary.generated + result.summary.generated_with_warnings).toBe(1);
  });

  it('a net_new manual add does NOT short-circuit at insufficient_context for "missing discovered context" — the resolver is never consulted, so there is no resolver blocker to park on', async () => {
    // If the handler wrongly used the discovered-context resolver here it would
    // see no capability/finding/endpoint and either throw (our spy) or yield an
    // insufficient_context blocker. The relaxed description-grounded mode means
    // the resolver is never called and the LLM produces a full spec.
    const { deps, captured } = buildInjectedDeps({
      bow: manualAddBow({
        provenance: 'net_new',
        kind: 'api',
        title: API_TITLE,
        description: API_DESCRIPTION,
      }),
      llmContent: apiGeneratedLlmContent(API_TITLE),
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    expect(captured.contextFetches).toBe(0);
    expect(result.summary.insufficient_context).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.generated).toBe(1);
    expect(captured.persistedRows[0].status).toBe('generated');
  });

  it('an undiscoverable carry_over manual add is ALSO description-grounded (both provenance values flow the same path) and reaches generated', async () => {
    const { deps, captured } = buildInjectedDeps({
      bow: manualAddBow({
        provenance: 'carry_over',
        kind: 'operational',
        title: OPERATIONAL_TITLE,
        description: OPERATIONAL_DESCRIPTION,
      }),
      llmContent: effectGeneratedLlmContent(OPERATIONAL_TITLE),
    });

    const result = await runShapeSpecGenerationBatch(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID },
      deps
    );

    expect(captured.contextFetches).toBe(0);
    expect(captured.llmCalls[0].userPrompt).toContain(OPERATIONAL_DESCRIPTION);
    expect(captured.persistedRows).toHaveLength(1);
    expect(['generated', 'generated_with_warnings']).toContain(
      captured.persistedRows[0].status
    );
    expect(result.summary.generated + result.summary.generated_with_warnings).toBe(1);
  });
});

// ===========================================================================
// 3 — the add-item gateway route (AMS add-item -> trigger generation)
// ===========================================================================

describe('POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/items/add-item', () => {
  function createTestApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      (req as unknown as { requestId: string }).requestId = 'add-item-test';
      next();
    });
    app.use('/api/v1', migrationShapeSpecGenerationRouter);
    return app;
  }

  function amsResponse(body: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => body,
      text: async () =>
        body === null || body === undefined ? '' : JSON.stringify(body),
    };
  }

  it('calls the AMS add-item endpoint (which stamps provenance) then triggers description-grounded generation for the created workItemId', async () => {
    const addItemPayload = {
      work_item_id: WORK_ITEM_ID,
      book_item_id: 'NN-S1',
      provenance: 'net_new',
      kind: 'api',
      message: 'Work item created.',
    };
    // The route makes the AMS add-item POST, then the generation pass loads the
    // book-of-work (GET) + persists the batch (POST spec-generations/batch). All
    // three round-trips go through the routed global.fetch.
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/items/add-item') && method === 'POST') {
        return amsResponse(addItemPayload, 200);
      }
      if (
        url ===
          `http://localhost:8080/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}` &&
        method === 'GET'
      ) {
        return amsResponse(
          {
            id: BOOK_ID,
            project_id: PROJECT_ID,
            current_architecture_id: 'arch-cur-1',
            target_architecture_id: 'arch-tgt-1',
            book_of_work_json: {
              items: [
                {
                  id: 'NN-S1',
                  type: 'story',
                  title: API_TITLE,
                  sequenceOrder: 1,
                  workItemId: WORK_ITEM_ID,
                  description: API_DESCRIPTION,
                  provenance: 'net_new',
                  kind: 'api',
                },
              ],
            },
          },
          200
        );
      }
      if (url.endsWith('/spec-generations') && method === 'GET') {
        return amsResponse([], 200);
      }
      if (url.endsWith('/spec-generations/batch') && method === 'POST') {
        // Echo persisted rows back with ids (the handler hydrates ids).
        const rows = JSON.parse((init?.body as string) ?? '[]') as Array<
          Record<string, unknown>
        >;
        return amsResponse(
          {
            persistedCount: rows.length,
            resultsCouldNotPersist: 0,
            perStoryResults: rows.map((r, i) => ({ ...r, id: `spec-${i + 1}` })),
          },
          200
        );
      }
      throw new Error(`Unexpected fetch in add-item route test: ${method} ${url}`);
    });

    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/add-item`
      )
      .set('X-User-Id', 'user-bob')
      .send({
        provenance: 'net_new',
        kind: 'api',
        title: API_TITLE,
        description: API_DESCRIPTION,
        sequence_order: 1,
      });

    expect(res.status).toBe(200);
    // The route surfaces the created workItemId so the UI can follow generation.
    expect(res.body.work_item_id).toBe(WORK_ITEM_ID);
    expect(res.body.provenance).toBe('net_new');

    // The AMS add-item endpoint was called with the snake_case body + the
    // forwarded X-User-Id header.
    const addItemCall = mockFetch.mock.calls.find(
      ([u]) => typeof u === 'string' && u.endsWith('/items/add-item')
    );
    expect(addItemCall).toBeDefined();
    const addInit = addItemCall?.[1] as RequestInit;
    expect((addInit.headers as Record<string, string>)['X-User-Id']).toBe(
      'user-bob'
    );
    const addBody = JSON.parse(addInit.body as string);
    expect(addBody.provenance).toBe('net_new');
    expect(addBody.kind).toBe('api');
    expect(addBody.title).toBe(API_TITLE);
    expect(addBody.description).toBe(API_DESCRIPTION);

    // Description-grounded generation was triggered for the created story: the
    // book-of-work GET + the spec-generations batch POST both fired. (The
    // discovered-context resolver POST /migration-spec-context is NEVER called.)
    const ctxCall = mockFetch.mock.calls.find(
      ([u]) => typeof u === 'string' && u.endsWith('/migration-spec-context')
    );
    expect(ctxCall).toBeUndefined();
    const batchCall = mockFetch.mock.calls.find(
      ([u]) => typeof u === 'string' && u.endsWith('/spec-generations/batch')
    );
    expect(batchCall).toBeDefined();
  });

  it('D6: forwards net_new_operations verbatim to the AMS add-item endpoint (the reconcile-time match source rides the blob)', async () => {
    const addItemPayload = {
      work_item_id: WORK_ITEM_ID,
      book_item_id: 'NN-S1',
      provenance: 'net_new',
      kind: 'api',
      message: 'Work item created.',
    };
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/items/add-item') && method === 'POST') {
        return amsResponse(addItemPayload, 200);
      }
      if (
        url ===
          `http://localhost:8080/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}` &&
        method === 'GET'
      ) {
        return amsResponse(
          {
            id: BOOK_ID,
            project_id: PROJECT_ID,
            current_architecture_id: 'arch-cur-1',
            target_architecture_id: 'arch-tgt-1',
            book_of_work_json: {
              items: [
                {
                  id: 'NN-S1',
                  type: 'story',
                  title: API_TITLE,
                  sequenceOrder: 1,
                  workItemId: WORK_ITEM_ID,
                  description: API_DESCRIPTION,
                  provenance: 'net_new',
                  kind: 'api',
                  net_new_operations: ['POST /accounts'],
                },
              ],
            },
          },
          200
        );
      }
      if (url.endsWith('/spec-generations') && method === 'GET') {
        return amsResponse([], 200);
      }
      if (url.endsWith('/spec-generations/batch') && method === 'POST') {
        const rows = JSON.parse((init?.body as string) ?? '[]') as Array<
          Record<string, unknown>
        >;
        return amsResponse(
          {
            persistedCount: rows.length,
            resultsCouldNotPersist: 0,
            perStoryResults: rows.map((r, i) => ({ ...r, id: `spec-${i + 1}` })),
          },
          200
        );
      }
      throw new Error(`Unexpected fetch in add-item route test: ${method} ${url}`);
    });

    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/add-item`
      )
      .send({
        provenance: 'net_new',
        kind: 'api',
        title: API_TITLE,
        description: API_DESCRIPTION,
        sequence_order: 1,
        net_new_operations: ['POST /accounts'],
      });

    expect(res.status).toBe(200);

    // The AMS add-item endpoint received net_new_operations VERBATIM in the
    // forwarded snake_case body (the route JSON-stringifies the whole req.body;
    // the field is not stripped). The AMS service is what stamps it on the blob.
    const addItemCall = mockFetch.mock.calls.find(
      ([u]) => typeof u === 'string' && u.endsWith('/items/add-item')
    );
    expect(addItemCall).toBeDefined();
    const addInit = addItemCall?.[1] as RequestInit;
    const addBody = JSON.parse(addInit.body as string);
    expect(addBody.net_new_operations).toEqual(['POST /accounts']);
    expect(addBody.provenance).toBe('net_new');
    expect(addBody.kind).toBe('api');
  });

  it('returns 400 when the title is missing (no AMS call)', async () => {
    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/add-item`
      )
      .send({ provenance: 'net_new', kind: 'api' });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('round-trips a 404 (unknown book) from the AMS add-item endpoint and does NOT trigger generation', async () => {
    mockFetch.mockResolvedValueOnce(amsResponse('', 404));

    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/unknown-book/items/add-item`
      )
      .send({ provenance: 'net_new', kind: 'api', title: API_TITLE });

    expect(res.status).toBe(404);
    // Only the AMS add-item call fired — no generation follow-up.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4 — dispatch + D4-gate stay provenance-blind (read-only confirmations)
// ===========================================================================

describe('D5 dispatch + D4-gate are provenance-blind (read-only confirmations, no new code)', () => {
  it('a net_new spec-ready story is in buildOrderedDispatchSet UNCHANGED (the dispatch builder reads no provenance)', () => {
    const book = {
      id: BOOK_ID,
      project_id: PROJECT_ID,
      book_of_work_json: {
        items: [
          {
            id: 'NN-S1',
            type: 'story',
            parentId: null,
            title: API_TITLE,
            sequenceOrder: 1,
            workItemId: WORK_ITEM_ID,
            // provenance rides the work_item column, NOT the dispatch path; even
            // if a stray value sat on the blob the dispatch builder ignores it.
            provenance: 'net_new',
          },
        ],
      },
    } as unknown as Parameters<typeof buildOrderedDispatchSet>[0]['book'];

    const specGens = [
      {
        id: 'spec-1',
        work_item_id: WORK_ITEM_ID,
        status: 'generated',
        generated_spec_text: '/agent-os:shape-spec Add summary endpoint\nBody.',
        stale_reason: null,
        generation_attempt_number: 1,
      },
    ] as unknown as Parameters<typeof buildOrderedDispatchSet>[0]['specGens'];

    const dispatch = buildOrderedDispatchSet({
      book,
      specGens,
      deferredWorkItemIds: new Set<string>(),
    });

    // The net_new story dispatches exactly like any other spec-ready story.
    expect(dispatch).toHaveLength(1);
    expect(dispatch[0].workItemId).toBe(WORK_ITEM_ID);
    expect(dispatch[0].specGenerationId).toBe('spec-1');
    // It is the final (only) item -> deploys on complete.
    expect(dispatch[0].deployOnComplete).toBe(true);
  });

  it('a net_new (or manual carry_over) item is NOT in D4\'s carry_over must-account set — it has no discovered capability/finding so the gate ignores it', () => {
    // D4's must-account set is DISCOVERED capabilities/findings ONLY, keyed by
    // a work_item.source_capability_id citation or a discoveryFindingReferences
    // citation. A manual add carries NEITHER, so it can never appear here —
    // there is simply no capability/finding row for it to be.
    const coverage = computeCarryOverCoverage({
      capabilities: [
        {
          id: 'cap-discovered-1',
          behaviourBearing: true,
          reviewStatus: 'approved',
          reviewerNotes: null,
          memberFindingIds: [],
        },
      ],
      findings: [],
      // The manual add's workItemId is deliberately NOT a cited capability id —
      // a manual add has no source_capability_id, so it cites nothing.
      citedCapabilityIds: new Set<string>(),
      citedFindingIds: new Set<string>(),
    });

    // The discovered capability is the ONLY must-account item; the manual add
    // (net_new or carry_over) contributes nothing to this set.
    expect(coverage.mustAccount.map((i) => i.id)).toEqual(['cap-discovered-1']);
    expect(coverage.mustAccount.map((i) => i.id)).not.toContain(WORK_ITEM_ID);
    // The manual-add workItemId is nowhere in the coverage items either.
    expect(coverage.items.map((i) => i.id)).not.toContain(WORK_ITEM_ID);
  });
});

// ===========================================================================
// 5 — hand-author -> promote (the gateway side of the AMS applyManualEdit fix)
//
// The AMS applyManualEdit fix (Group 1) PROMOTES `status` to `generated` on
// non-empty hand-authored spec text, so a previously-`insufficient_context`
// row becomes dispatchable. The gateway `manual-edit` route is a pure
// pass-through (no behavioural change), so the gateway-side acceptance is: the
// proxy round-trips the AMS-promoted `status: 'generated'` body verbatim — the
// now-dispatchable row surfaces to the UI unchanged.
// ===========================================================================

describe('POST /api/v1/projects/:projectId/spec-generations/:specId/manual-edit — hand-author promotion round-trip', () => {
  function createProxyApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      (req as unknown as { requestId: string }).requestId = 'manual-edit-promote-test';
      next();
    });
    app.use('/api/v1', migrationShapeSpecGenerationRouter);
    return app;
  }

  it('round-trips the AMS-promoted status=generated body so a hand-authored row is dispatchable (gateway pass-through, no behavioural change)', async () => {
    // The AMS applyManualEdit fix promoted a row that was `insufficient_context`
    // to `generated` on non-empty hand-authored text. The gateway proxy returns
    // that body verbatim — proving the now-dispatchable row reaches the caller.
    const promotedDto = {
      id: 'spec-hand-1',
      projectId: PROJECT_ID,
      workItemId: WORK_ITEM_ID,
      status: 'generated',
      generatedSpecText:
        '/agent-os:shape-spec Hand-authored net_new spec\nBody.',
      manuallyEdited: true,
      lastManuallyEditedBy: 'user-carol',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify(promotedDto),
    });

    const res = await request(createProxyApp())
      .post(`/api/v1/projects/${PROJECT_ID}/spec-generations/spec-hand-1/manual-edit`)
      .set('X-User-Id', 'user-carol')
      .send({ specText: '/agent-os:shape-spec Hand-authored net_new spec\nBody.' });

    expect(res.status).toBe(200);
    // The promoted status surfaces verbatim -> the row is now dispatchable.
    expect(res.body.status).toBe('generated');
    expect(res.body.workItemId).toBe(WORK_ITEM_ID);

    // Forwarded to the AMS manual-edit endpoint with the X-User-Id header.
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `http://localhost:8080/api/projects/${PROJECT_ID}/spec-generations/spec-hand-1/manual-edit`
    );
    expect((calledInit.headers as Record<string, string>)['X-User-Id']).toBe('user-carol');
  });
});
