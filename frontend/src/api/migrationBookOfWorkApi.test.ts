/**
 * Migration Book of Work API Client -- wire-format tests.
 *
 * These tests exist specifically to guard the AMS snake_case <-> frontend
 * camelCase boundary on the save-to-backlog call. The component-level tests
 * mock `saveMigrationBookOfWorkToBacklog` itself, so they assert on the
 * camelCase request ARG and never exercise the real `fetch` body or the
 * response mapping -- the exact gap that let two wire-case regressions ship:
 *
 *   1. Request body sent camelCase (`saveMode`) to an AMS-direct route whose
 *      DTO binds snake_case (`save_mode`) -> every field null -> 400.
 *   2. Response read as camelCase (`bookOfWork`) when AMS returns
 *      `book_of_work_json` -> `undefined` -> the post-save view wiped the
 *      draft's items ("No items in this book of work").
 *
 * Mocks `global.fetch`, mirroring the `findingsApi.test.ts` style.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveMigrationBookOfWorkToBacklog } from './migrationBookOfWorkApi';

const PROJECT_ID = 'proj-uuid-1';
const BOOK_ID = 'book-uuid-1';

describe('migrationBookOfWorkApi -- save-to-backlog wire format', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  function mockAmsResponse(body: unknown) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'application/json' : null),
      },
      json: () => Promise.resolve(body),
    });
  }

  it('serialises the request body in snake_case for AMS', async () => {
    mockAmsResponse({
      draft_id: BOOK_ID,
      draft_status: 'saved',
      counts: { saved: 2, failed: 0, skipped_already_saved: 0 },
      book_of_work_json: { items: [] },
      failed_items: [],
    });

    await saveMigrationBookOfWorkToBacklog(PROJECT_ID, BOOK_ID, {
      saveMode: 'selected',
      selectedItemIds: ['a', 'b'],
      excludedItemIds: ['c'],
      tagPrefix: 'pref',
      includeTraceabilityInDescription: true,
      includeReadinessInDescription: false,
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({
      save_mode: 'selected',
      selected_item_ids: ['a', 'b'],
      excluded_item_ids: ['c'],
      tag_prefix: 'pref',
      include_traceability_in_description: true,
      include_readiness_in_description: false,
    });
    // No camelCase keys must leak onto the wire.
    expect(sent.saveMode).toBeUndefined();
    expect(sent.selectedItemIds).toBeUndefined();
  });

  it('maps the snake_case AMS response (book_of_work_json + counts) to camelCase', async () => {
    mockAmsResponse({
      draft_id: BOOK_ID,
      draft_status: 'partially_saved',
      counts: {
        saved: 3,
        failed: 1,
        skipped_already_saved: 2,
        skipped_not_admitted: 5,
        admitted: 4,
      },
      book_of_work_json: {
        items: [
          { id: 'a', type: 'story', saveState: 'saved', workItemId: 'wi-1' },
          { id: 'b', type: 'story', saveState: 'failed' },
        ],
      },
      failed_items: [{ itemId: 'b', errorMessage: 'boom' }],
    });

    const result = await saveMigrationBookOfWorkToBacklog(PROJECT_ID, BOOK_ID, {
      saveMode: 'all',
    });

    expect(result.draftId).toBe(BOOK_ID);
    expect(result.status).toBe('partially_saved');
    expect(result.savedCount).toBe(3);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    // The whole hierarchy must survive -- not just the saved subset.
    expect(result.bookOfWork.items).toHaveLength(2);
    expect(result.bookOfWork.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('never yields an undefined bookOfWork even if AMS omits the blob', async () => {
    mockAmsResponse({
      draft_id: BOOK_ID,
      draft_status: 'saved',
      counts: {},
      book_of_work_json: null,
      failed_items: [],
    });

    const result = await saveMigrationBookOfWorkToBacklog(PROJECT_ID, BOOK_ID, {
      saveMode: 'all',
    });

    expect(result.bookOfWork).toEqual({ items: [] });
    expect(result.savedCount).toBe(0);
  });
});
