/**
 * epicCapturedDecisionsApi tests
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Follow-up #3.
 *
 * Focused tests for the bulk per-epic summary endpoint added by Follow-up #3
 * (replaces the dashboard route's O(epic-count) per-epic GETs).
 *
 * Wire-shape note: the AMS application.yml registers SNAKE_CASE Jackson naming
 * (`epic_work_item_id`, `draft_count`, ...). The client maps both shapes at
 * the boundary; the tests exercise the snake_case path because that's what
 * production emits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getCapturedDecisionsSummary,
  type EpicCapturedDecisionsCountByEpicDto,
} from '../epicCapturedDecisionsApi';

const PROJECT_ID = 'proj-uuid-zzz';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCapturedDecisionsSummary', () => {
  it('calls the project-scoped summary URL with GET', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    await getCapturedDecisionsSummary(PROJECT_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/api/projects/${PROJECT_ID}/captured-decisions/summary`);
    expect((init as RequestInit).method).toBe('GET');
  });

  it('maps snake_case wire fields to camelCase summary rows', async () => {
    const wire = [
      {
        epic_work_item_id: 'epic-uuid-1',
        draft_count: 3,
        confirmed_count: 2,
        superseded_count: 0,
      },
      {
        epic_work_item_id: 'epic-uuid-2',
        draft_count: 0,
        confirmed_count: 5,
        superseded_count: 1,
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => wire,
    } as unknown as Response);

    const summary = await getCapturedDecisionsSummary(PROJECT_ID);

    const expected: EpicCapturedDecisionsCountByEpicDto[] = [
      {
        epicWorkItemId: 'epic-uuid-1',
        draftCount: 3,
        confirmedCount: 2,
        supersededCount: 0,
      },
      {
        epicWorkItemId: 'epic-uuid-2',
        draftCount: 0,
        confirmedCount: 5,
        supersededCount: 1,
      },
    ];
    expect(summary).toEqual(expected);
  });

  it('rejects when the gateway returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
    } as unknown as Response);

    await expect(getCapturedDecisionsSummary(PROJECT_ID)).rejects.toThrow(
      /Failed to load captured-decisions summary/,
    );
  });
});
