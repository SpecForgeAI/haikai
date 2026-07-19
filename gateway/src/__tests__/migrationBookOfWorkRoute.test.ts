/**
 * Migration Book of Work route — focused route-wiring tests.
 *
 * Spec 2026-05-17 PM Migration Delivery Plan (Spec 1) — follow-up wiring.
 *
 * These tests cover the HTTP surface only — they mock the handler / fetch
 * directly. The handler's behaviour is already covered by the 13 cases in
 * `migrationBookOfWorkHandler.test.ts`. Here we only verify:
 *
 *   1. POST generate happy path forwards the parsed body to the handler and
 *      returns its result.
 *   2. POST generate returns 400 when `currentArchitectureId` is missing.
 *   3. POST generate maps `TokenBudgetOverflowError` to 422.
 *   4. POST generate maps `MigrationBookOfWorkSchemaError` to 502.
 *   5. GET draft proxies the upstream AMS response byte-for-byte.
 *
 * Phase-2 expansion routes (Spec 2026-06-11 Two-Phase generation, 4.8 + Task
 * Group 6): expand-one forwarding + precondition mapping, expand-all fan-out
 * outcome forwarding + AMS error round-trip, and the items/append proxy.
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing the units under test
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

const mockGenerate = jest.fn();
jest.mock('../services/migrationBookOfWorkHandler', () => {
  const actual = jest.requireActual('../services/migrationBookOfWorkHandler');
  return {
    ...actual,
    generateMigrationBookOfWork: (...args: unknown[]) => mockGenerate(...args),
  };
});

const mockExpandEpic = jest.fn();
const mockExpandAll = jest.fn();
jest.mock('../services/migrationBookOfWorkExpansionHandler', () => {
  const actual = jest.requireActual('../services/migrationBookOfWorkExpansionHandler');
  return {
    ...actual,
    expandMigrationBookOfWorkEpic: (...args: unknown[]) => mockExpandEpic(...args),
    expandAllMigrationBookOfWorkEpics: (...args: unknown[]) => mockExpandAll(...args),
  };
});

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import {
  TokenBudgetOverflowError,
  MigrationBookOfWorkSchemaError,
} from '../services/migrationBookOfWorkHandler';
import {
  AmsRoundTripError,
  ExpansionPreconditionError,
} from '../services/migrationBookOfWorkExpansionHandler';
import { migrationBookOfWorkRouter } from '../routes/migrationBookOfWork';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'mbow-route-test';
    next();
  });
  app.use('/api/v1', migrationBookOfWorkRouter);
  return app;
}

beforeEach(() => {
  mockGenerate.mockReset();
  mockFetch.mockReset();
  mockExpandEpic.mockReset();
  mockExpandAll.mockReset();
});

describe('POST /api/v1/projects/:projectId/migration-books-of-work/generate', () => {
  it('forwards the body to the handler and returns its result', async () => {
    mockGenerate.mockResolvedValueOnce({
      draftId: 'd-1',
      summary: 'ok',
      warnings: [],
    });
    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/migration-books-of-work/generate')
      .send({
        currentArchitectureId: 'arch-current',
        targetArchitectureId: 'arch-target',
        wizardAnswers: { migrationIntent: ['lift-and-shift'] },
        discoveryRunIds: ['run-1'],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ draftId: 'd-1', summary: 'ok', warnings: [] });
    expect(mockGenerate).toHaveBeenCalledWith({
      projectId: 'p-1',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
      wizardAnswers: { migrationIntent: ['lift-and-shift'] },
      discoveryRunIds: ['run-1'],
      apiBehaviourBaselineIds: undefined,
    });
  });

  it('returns 400 when currentArchitectureId is missing', async () => {
    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/migration-books-of-work/generate')
      .send({ targetArchitectureId: 'arch-target' });
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('maps TokenBudgetOverflowError to 422 with overflow detail', async () => {
    mockGenerate.mockRejectedValueOnce(
      new TokenBudgetOverflowError(['always-retained-x'], 999_999),
    );
    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/migration-books-of-work/generate')
      .send({
        currentArchitectureId: 'arch-current',
        targetArchitectureId: 'arch-target',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.overflowingItems).toEqual(['always-retained-x']);
    expect(res.body.error.finalTokenCount).toBe(999_999);
  });

  it('maps MigrationBookOfWorkSchemaError to 502 with the validator errors', async () => {
    mockGenerate.mockRejectedValueOnce(
      new MigrationBookOfWorkSchemaError(['items[0].title missing']),
    );
    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/migration-books-of-work/generate')
      .send({
        currentArchitectureId: 'arch-current',
        targetArchitectureId: 'arch-target',
      });
    expect(res.status).toBe(502);
    expect(res.body.error.errors).toEqual(['items[0].title missing']);
  });
});

describe('GET /api/v1/projects/:projectId/migration-books-of-work/:bookId', () => {
  it('proxies the AMS response byte-for-byte', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify({ id: 'd-1', title: 'fake draft' }),
    });
    const res = await request(createTestApp()).get(
      '/api/v1/projects/p-1/migration-books-of-work/d-1',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'd-1', title: 'fake draft' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/p-1/migration-books-of-work/d-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns 503 when upstream fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(createTestApp()).get(
      '/api/v1/projects/p-1/migration-books-of-work/d-1',
    );
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Phase-2 expansion routes (Spec 2026-06-11 Two-Phase generation, 4.8)
// ---------------------------------------------------------------------------

describe('POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/epics/:epicId/expand', () => {
  it('returns the per-epic expansion state from the handler (200 for both expanded AND failed outcomes) and maps precondition errors to their status', async () => {
    // Success outcome — the response carries the resulting state so the
    // frontend can update without an immediate re-poll.
    mockExpandEpic.mockResolvedValueOnce({
      epicId: 'stream:E1',
      expansionState: 'expanded',
      storiesAppended: 7,
    });
    const ok = await request(createTestApp()).post(
      '/api/v1/projects/p-1/migration-books-of-work/b-1/epics/stream:E1/expand',
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      epicId: 'stream:E1',
      expansionState: 'expanded',
      storiesAppended: 7,
    });
    expect(mockExpandEpic).toHaveBeenCalledWith({
      projectId: 'p-1',
      bookId: 'b-1',
      epicId: 'stream:E1',
    });

    // Precondition error (already expanded) → its own status code.
    mockExpandEpic.mockRejectedValueOnce(
      new ExpansionPreconditionError(409, 'Epic "stream:E1" is already expanded'),
    );
    const conflict = await request(createTestApp()).post(
      '/api/v1/projects/p-1/migration-books-of-work/b-1/epics/stream:E1/expand',
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.message).toContain('already expanded');
  });
});

describe('POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/expand-all', () => {
  // Task Group 6 gap fill: the expand-all route previously had no coverage.
  it('forwards the fan-out outcome (per-epic results + skipped) and round-trips AMS errors', async () => {
    mockExpandAll.mockResolvedValueOnce({
      results: [
        { epicId: 's:E1', expansionState: 'expanded', storiesAppended: 4 },
        { epicId: 's:E2', expansionState: 'failed', storiesAppended: 0, error: 'judge failed' },
      ],
      skipped: [
        { epicId: 's:E3', expansionState: 'expanded', reason: 'already expanded (terminal)' },
      ],
    });
    const res = await request(createTestApp()).post(
      '/api/v1/projects/p-1/migration-books-of-work/b-1/expand-all',
    );
    expect(res.status).toBe(200);
    // Per-epic results forwarded verbatim (mixed expanded/failed is a 200 —
    // failure is a persisted retryable state, not a transport error).
    expect(res.body.results).toEqual([
      expect.objectContaining({ epicId: 's:E1', expansionState: 'expanded' }),
      expect.objectContaining({ epicId: 's:E2', expansionState: 'failed', error: 'judge failed' }),
    ]);
    expect(res.body.skipped[0].reason).toContain('already expanded');
    // No body → "Expand remaining" (includeExpanded false).
    expect(mockExpandAll).toHaveBeenCalledWith({
      projectId: 'p-1',
      bookId: 'b-1',
      includeExpanded: false,
    });

    // `include_expanded: true` → "Expand all" (re-expands terminal epics).
    mockExpandAll.mockResolvedValueOnce({ results: [], skipped: [] });
    await request(createTestApp())
      .post('/api/v1/projects/p-1/migration-books-of-work/b-1/expand-all')
      .send({ include_expanded: true });
    expect(mockExpandAll).toHaveBeenLastCalledWith({
      projectId: 'p-1',
      bookId: 'b-1',
      includeExpanded: true,
    });

    // An AMS failure round-trips its status + body byte-for-byte.
    mockExpandAll.mockRejectedValueOnce(
      new AmsRoundTripError(400, JSON.stringify({ error: 'Append is only allowed on a draft book' })),
    );
    const err = await request(createTestApp()).post(
      '/api/v1/projects/p-1/migration-books-of-work/b-1/expand-all',
    );
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ error: 'Append is only allowed on a draft book' });
  });
});

describe('POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/items/append (proxy)', () => {
  it('round-trips the AMS status + body byte-for-byte', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify({ error: 'Unknown epic id stream:E9' }),
    });
    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/migration-books-of-work/b-1/items/append')
      .send({ epic_id: 'stream:E9', items: [], expansion_state: 'expanding' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown epic id stream:E9' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/p-1/migration-books-of-work/b-1/items/append',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ epic_id: 'stream:E9', items: [], expansion_state: 'expanding' }),
      }),
    );
  });
});
