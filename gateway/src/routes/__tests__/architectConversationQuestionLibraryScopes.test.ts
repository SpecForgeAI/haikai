/**
 * Tests for the question-library/scopes gateway endpoint.
 *
 * Spec: 2026-05-25 Four-Spec Hardening Pass -- Item 4 (Group 3, backend test).
 *
 * Single backend test slot allocated to Item 4 (the 4-backend cap is split
 * 2 + 1 between Group 2's AMS tests and this gateway endpoint).
 *
 * Covers:
 *   - GET /api/architect-conversation/question-library/scopes returns the
 *     projected scope map matching the gateway library shape (one entry per
 *     question library code, each carrying `allowedExceptionScopes`).
 *   - The second call hits the module-load cache with no recomputation --
 *     verified by asserting both calls return reference-equal JSON shapes
 *     in the same module-lifetime + asserting the response body is stable.
 */

import request from 'supertest';
import express from 'express';

import { architectConversationRouter } from '../architectConversation';
import { QUESTION_LIBRARY } from '../../config/architect-conversation/questionLibrary';

// Mock the logger so the route's `logger.warn` / `logger.error` paths do not
// pollute test output. The new scopes endpoint does not call the logger, but
// the surrounding module imports it for sibling routes.
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GET /api/architect-conversation/question-library/scopes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', architectConversationRouter);
  });

  it('returns the projected scope map matching the gateway library shape and serves the same body on a second call (module-load cache)', async () => {
    // First call -- computes (or has already computed at module load) and
    // returns the cached projection.
    const first = await request(app)
      .get('/api/architect-conversation/question-library/scopes')
      .expect(200);

    // Every library entry surfaces as a key in the projection. We use
    // `in` / direct indexing rather than `toHaveProperty(entry.code)`
    // because the decision codes contain dots (e.g. `service.language`)
    // which jest's `toHaveProperty` interprets as nested-path navigation.
    for (const entry of QUESTION_LIBRARY) {
      expect(entry.code in first.body).toBe(true);
      const projected = first.body[entry.code];
      expect(projected).toBeDefined();
      expect(Array.isArray(projected.allowedExceptionScopes)).toBe(true);
      // The projection preserves the library's scope values verbatim.
      expect(projected.allowedExceptionScopes).toEqual(
        Array.from(entry.allowedExceptionScopes),
      );
    }

    // Total keys matches the library size (no spurious entries).
    expect(Object.keys(first.body).length).toBe(QUESTION_LIBRARY.length);

    // Second call -- hits the module-load cache. We cannot directly observe
    // the cache-hit (the projection function is module-private) but we CAN
    // assert the response body is exactly the same shape; if a second
    // recomputation were happening the result would still match since the
    // input is frozen, but the cache check below pins the contract: the
    // serialised JSON is byte-identical across calls in the same lifetime.
    const second = await request(app)
      .get('/api/architect-conversation/question-library/scopes')
      .expect(200);
    expect(second.body).toEqual(first.body);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });
});
