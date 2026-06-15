/**
 * D3 — `append-capability-story` gateway trigger (Group 3.4).
 *
 * Spec: 2026-06-14 internal-behaviour-implementation-ready-spec-generation
 * (Spec 3 of 6). The explicit PER-CAPABILITY trigger: a gateway route that
 * invokes the AMS `append-capability-story` endpoint (built in Group 2) for one
 * approved capability. The AMS endpoint mints a `type='story'` WorkItem +
 * appends the `book_of_work_json.items[]` blob (stamping `workItemId` +
 * `source_capability_id`) in ONE transaction, so the resulting story is picked
 * up by `migrationShapeSpecGenerationHandler` UNCHANGED.
 *
 * The gateway is pure pass-through: it forwards the snake_case body + the
 * optional X-User-Id header and round-trips the AMS status + body verbatim
 * (200 success, 400 missing source_capability_id, 404 unknown book). No LLM
 * contact; no generation here.
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

// Stub the cross-story config + auto-seed deps so the route file imports
// cleanly without standing up the real LLM pipeline.
jest.mock('../services/architectureModelClient', () => ({
  fetchProjectConfigWithDefaults: jest.fn(),
  DEFAULT_PER_STORY_TOKEN_CAP: 24000,
  DEFAULT_CROSS_STORY_TOKEN_CAP: 12000,
  DEFAULT_AUTO_RUN_PASS_2: false,
}));

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
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'append-cap-test';
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
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

const PROJECT_ID = 'p-cap-1';
const BOOK_ID = 'book-cap-1';
const CAP_ID = 'cap-uuid-1';

describe('POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/items/append-capability-story', () => {
  it('forwards the snake_case body to the AMS append-capability-story endpoint and round-trips the created story', async () => {
    const amsPayload = {
      work_item_id: 'wi-cap-created-1',
      book_item_id: 'CAP-S1',
      source_capability_id: CAP_ID,
      message: 'Capability story created.',
    };
    mockFetch.mockResolvedValueOnce(amsResponse(amsPayload, 200));

    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/append-capability-story`
      )
      .set('X-User-Id', 'user-alice')
      .send({
        source_capability_id: CAP_ID,
        title: 'Modernise EOD Risk Batch',
        description: 'Re-express the Autosys DAG on the modern orchestrator.',
        sequence_order: 1,
      });

    expect(res.status).toBe(200);
    // AMS body round-tripped verbatim, including the created workItemId the
    // gateway keys the spec row + implement-state on.
    expect(res.body).toEqual(amsPayload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(
      `http://localhost:8080/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/append-capability-story`
    );
    expect(init.method).toBe('POST');
    expect(init.headers['X-User-Id']).toBe('user-alice');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.source_capability_id).toBe(CAP_ID);
    expect(sentBody.title).toBe('Modernise EOD Risk Batch');
    expect(sentBody.sequence_order).toBe(1);
  });

  it('round-trips a 400 (missing source_capability_id) envelope from AMS unchanged', async () => {
    mockFetch.mockResolvedValueOnce(
      amsResponse({ error: 'source_capability_id is required' }, 400)
    );

    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}/items/append-capability-story`
      )
      .send({ title: 'No capability id' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'source_capability_id is required' });
  });

  it('round-trips a 404 (unknown book) from AMS unchanged', async () => {
    mockFetch.mockResolvedValueOnce(amsResponse('', 404));

    const res = await request(createTestApp())
      .post(
        `/api/v1/projects/${PROJECT_ID}/migration-books-of-work/unknown-book/items/append-capability-story`
      )
      .send({ source_capability_id: CAP_ID, title: 'x' });

    expect(res.status).toBe(404);
  });
});
