/**
 * Mapping-suggest LLM rerank tests (direct build 2026-06-11, oracle
 * weaknesses #7 cherry-pick).
 *
 * Covers: the happy-path reorder (+ confidence/rationale refinement), the
 * permutation guarantee (invented ids dropped, omitted ids appended,
 * duplicates collapsed), every fail-soft path (LLM error, timeout,
 * unparseable reply), the precondition short-circuits (<2 candidates, no
 * snapshot, opt-out flag), and the route integration (reranked body returned;
 * AMS non-2xx passes through without invoking the LLM).
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

const mockRouteRerankLlm = jest.fn();
jest.mock('../services/mappingSuggestRerank', () => {
  const actual = jest.requireActual('../services/mappingSuggestRerank');
  return {
    ...actual,
    rerankMappingSuggestCandidates: (
      amsResponse: unknown,
      requestBody: unknown
    ) =>
      actual.rerankMappingSuggestCandidates(amsResponse, requestBody, {
        callLlm: mockRouteRerankLlm,
        timeoutMs: 5_000,
      }),
  };
});

import express from 'express';
import request from 'supertest';
import type { MappingSuggestWireResponse } from '../services/mappingSuggestRerank';
import { targetArchitecturesRouter } from '../routes/targetArchitectures';

// The module-level mock above only affects the ROUTE's import; unit tests
// exercise the real implementation directly.
const { rerankMappingSuggestCandidates } = jest.requireActual(
  '../services/mappingSuggestRerank'
) as typeof import('../services/mappingSuggestRerank');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAmsResponse(): MappingSuggestWireResponse {
  return {
    candidates: [
      {
        elementId: 'cur-1',
        elementType: 'application_components',
        name: 'Order Service',
        confidence: 0.9,
        rationale: "Name closely matches 'Order Management Service'",
      },
      {
        elementId: 'cur-2',
        elementType: 'application_components',
        name: 'OrderSvc Legacy',
        confidence: 0.6,
        rationale: 'Token overlap',
      },
      {
        elementId: 'cur-3',
        elementType: 'interfaces',
        name: 'Ordering API',
        confidence: 0.4,
        rationale: 'Partial match',
      },
    ],
  };
}

const REQUEST_BODY = {
  targetElementSnapshot: {
    name: 'Order Management Service',
    elementType: 'application_components',
    description: 'Replaces the legacy OrderSvc monolith module.',
  },
};

function makeDeps(reply: string | Promise<string>) {
  return {
    callLlm: jest.fn().mockImplementation(async () => reply),
    timeoutMs: 5_000,
  };
}

// ---------------------------------------------------------------------------
// Unit: rerankMappingSuggestCandidates
// ---------------------------------------------------------------------------

describe('rerankMappingSuggestCandidates', () => {
  afterEach(() => {
    delete process.env.TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK;
  });

  test('reorders candidates per the LLM ranking and refines confidence + rationale', async () => {
    const deps = makeDeps(
      JSON.stringify({
        ranking: [
          {
            elementId: 'cur-2',
            confidence: 0.95,
            rationale: 'OrderSvc Legacy is the module the description names.',
          },
          { elementId: 'cur-1', confidence: 0.5 },
          { elementId: 'cur-3', confidence: 0.1 },
        ],
      })
    );
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );

    expect(result.llmReranked).toBe(true);
    expect(result.candidates.map((c) => c.elementId)).toEqual([
      'cur-2',
      'cur-1',
      'cur-3',
    ]);
    expect(result.candidates[0].confidence).toBe(0.95);
    expect(result.candidates[0].rationale).toContain('OrderSvc Legacy');
    // cur-1 got a new confidence but kept its AMS rationale.
    expect(result.candidates[1].confidence).toBe(0.5);
    expect(result.candidates[1].rationale).toContain('closely matches');

    // The prompt carried both sides of the comparison.
    const userPrompt = deps.callLlm.mock.calls[0][1] as string;
    expect(userPrompt).toContain('Order Management Service');
    expect(userPrompt).toContain('cur-2');
    expect(userPrompt).toContain('legacy OrderSvc monolith');
  });

  test('permutation guarantee: invented ids dropped, omitted appended, duplicates collapsed', async () => {
    const deps = makeDeps(
      JSON.stringify({
        ranking: [
          { elementId: 'cur-3' },
          { elementId: 'invented-id' },
          { elementId: 'cur-3' }, // duplicate
          // cur-1 and cur-2 omitted entirely
        ],
      })
    );
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );
    expect(result.llmReranked).toBe(true);
    // cur-3 first (ranked), then cur-1 + cur-2 in original deterministic order.
    expect(result.candidates.map((c) => c.elementId)).toEqual([
      'cur-3',
      'cur-1',
      'cur-2',
    ]);
  });

  test('fail-soft: LLM error keeps the deterministic AMS order', async () => {
    const deps = {
      callLlm: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
      timeoutMs: 5_000,
    };
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );
    expect(result.llmReranked).toBe(false);
    expect(result.candidates.map((c) => c.elementId)).toEqual([
      'cur-1',
      'cur-2',
      'cur-3',
    ]);
  });

  test('fail-soft: timeout keeps the deterministic AMS order', async () => {
    const deps = {
      // Never resolves within the test's 50ms budget.
      callLlm: jest.fn().mockImplementation(
        () => new Promise<string>(() => undefined)
      ),
      timeoutMs: 50,
    };
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );
    expect(result.llmReranked).toBe(false);
  });

  test('fail-soft: unparseable reply keeps the deterministic AMS order', async () => {
    const deps = makeDeps('sorry, I cannot rank these');
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );
    expect(result.llmReranked).toBe(false);
    expect(result.candidates.map((c) => c.elementId)).toEqual([
      'cur-1',
      'cur-2',
      'cur-3',
    ]);
  });

  test('tolerates a fenced/wrapped JSON reply', async () => {
    const deps = makeDeps(
      'Here is the ranking:\n```json\n' +
        JSON.stringify({ ranking: [{ elementId: 'cur-3' }] }) +
        '\n```'
    );
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );
    expect(result.llmReranked).toBe(true);
    expect(result.candidates[0].elementId).toBe('cur-3');
  });

  test('skips the LLM entirely for <2 candidates, a missing snapshot, or the opt-out flag', async () => {
    const deps = makeDeps('{}');

    const single = makeAmsResponse();
    single.candidates = single.candidates.slice(0, 1);
    expect(
      (await rerankMappingSuggestCandidates(single, REQUEST_BODY, deps)).llmReranked
    ).toBe(false);

    expect(
      (await rerankMappingSuggestCandidates(makeAmsResponse(), {}, deps)).llmReranked
    ).toBe(false);

    process.env.TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK = '0';
    expect(
      (await rerankMappingSuggestCandidates(makeAmsResponse(), REQUEST_BODY, deps))
        .llmReranked
    ).toBe(false);

    expect(deps.callLlm).not.toHaveBeenCalled();
  });

  test('clamps out-of-range LLM confidence values into 0..1', async () => {
    const deps = makeDeps(
      JSON.stringify({
        ranking: [
          { elementId: 'cur-2', confidence: 7 },
          { elementId: 'cur-1', confidence: -3 },
          { elementId: 'cur-3' },
        ],
      })
    );
    const result = await rerankMappingSuggestCandidates(
      makeAmsResponse(),
      REQUEST_BODY,
      deps
    );
    expect(result.candidates[0].confidence).toBe(1);
    expect(result.candidates[1].confidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Route integration
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', targetArchitecturesRouter);
  return app;
}

const ROUTE = '/api/projects/p1/architectures/arch1/mapping-suggest';

describe('mapping-suggest route with the real rerank', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockRouteRerankLlm.mockReset();
  });

  test('returns the LLM-reordered candidates with llmReranked=true', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(makeAmsResponse()),
    });
    mockRouteRerankLlm.mockResolvedValue(
      JSON.stringify({
        ranking: [
          { elementId: 'cur-3', confidence: 0.9, rationale: 'Best semantic match.' },
          { elementId: 'cur-1' },
          { elementId: 'cur-2' },
        ],
      })
    );

    const res = await request(createTestApp()).post(ROUTE).send(REQUEST_BODY);
    expect(res.status).toBe(200);
    expect(res.body.llmReranked).toBe(true);
    expect(
      res.body.candidates.map((c: { elementId: string }) => c.elementId)
    ).toEqual(['cur-3', 'cur-1', 'cur-2']);
  });

  test('AMS non-2xx passes through verbatim and never invokes the LLM', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => 'application/json' },
      text: async () =>
        JSON.stringify({ code: 'no_active_target', message: 'No active target.' }),
    });

    const res = await request(createTestApp()).post(ROUTE).send(REQUEST_BODY);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('no_active_target');
    expect(mockRouteRerankLlm).not.toHaveBeenCalled();
  });

  test('LLM failure still returns 200 with the deterministic order (fail-soft)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(makeAmsResponse()),
    });
    mockRouteRerankLlm.mockRejectedValue(new Error('boom'));

    const res = await request(createTestApp()).post(ROUTE).send(REQUEST_BODY);
    expect(res.status).toBe(200);
    expect(res.body.llmReranked).toBe(false);
    expect(
      res.body.candidates.map((c: { elementId: string }) => c.elementId)
    ).toEqual(['cur-1', 'cur-2', 'cur-3']);
  });
});
