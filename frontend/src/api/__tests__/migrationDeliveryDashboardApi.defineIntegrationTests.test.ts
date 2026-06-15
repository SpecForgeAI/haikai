/**
 * migrationDeliveryDashboardApi -- defineIntegrationTests tests
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4)
 * -- Task Group 4 (Frontend API client for the per-feature/epic node action).
 *
 * Two focused tests:
 *   1. `defineIntegrationTests(projectId, bookId, bookItemId)` POSTs the
 *      node-scoped gateway URL with `Accept: application/json` and returns the
 *      typed body verbatim (the gateway emits camelCase natively, so there is
 *      no wire->camel mapping layer to exercise).
 *   2. A non-2xx response surfaces as a rejected promise carrying the server
 *      error message.
 *
 * Test strategy mirrors `migrationDeliveryDashboardApi.test.ts`: vi.fn()
 * shimming globalThis.fetch, with `vi.resetAllMocks()` in `beforeEach`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  defineIntegrationTests,
  type DefineIntegrationTestsResult,
} from '../migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-uuid-aaa';
const BOOK_ID = 'book-uuid-bbb';
const BOOK_ITEM_ID = 'feature-blob-item-ccc';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('defineIntegrationTests', () => {
  it('POSTs the node-scoped define-integration-tests URL and returns the typed body', async () => {
    const body: DefineIntegrationTestsResult = {
      level: 'feature',
      nodeBookItemId: BOOK_ITEM_ID,
      nodeWorkItemId: 'feature-wi-1',
      testPlan: [
        {
          title: 'Auth -> billing happy path',
          description: 'Exercises the cross-story integration boundary.',
          type: 'integration',
        },
      ],
      skippedChildren: [
        {
          bookItemId: 'story-blob-2',
          workItemId: null,
          title: 'Unscoped story',
          reason: 'not_generated',
        },
      ],
      specCompleteChildCount: 2,
      createdTestItems: [
        {
          workItemId: 'test-wi-1',
          bookItemId: 'test-blob-1',
          title: 'Auth -> billing happy path',
          type: 'integration',
          sequenceOrder: 4,
          specPersisted: true,
          implementStateWritten: true,
        },
      ],
      failedTestItems: [],
      emptyPlan: false,
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
    });

    const result = await defineIntegrationTests(
      PROJECT_ID,
      BOOK_ID,
      BOOK_ITEM_ID,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/migration-books-of-work/${BOOK_ID}` +
        `/items/${BOOK_ITEM_ID}/define-integration-tests`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ Accept: 'application/json' });

    // Body returned verbatim (already camelCase from the gateway).
    expect(result.level).toBe('feature');
    expect(result.createdTestItems).toHaveLength(1);
    expect(result.createdTestItems[0].workItemId).toBe('test-wi-1');
    expect(result.skippedChildren).toHaveLength(1);
    expect(result.skippedChildren[0].reason).toBe('not_generated');
    expect(result.emptyPlan).toBe(false);
  });

  it('rejects with the server error message on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: { message: 'Holistic integration/E2E test definition failed' },
      }),
    });

    await expect(
      defineIntegrationTests(PROJECT_ID, BOOK_ID, BOOK_ITEM_ID),
    ).rejects.toThrow('Holistic integration/E2E test definition failed');
  });
});
