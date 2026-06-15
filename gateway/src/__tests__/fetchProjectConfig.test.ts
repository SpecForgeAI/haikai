/**
 * Gateway coverage for the Task-Group-9 fetchProjectConfig helper.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 9
 *
 * Task 9.1 calls for one gateway test that "the cost-preview honours the
 * project's auto_run_pass_2 and budget caps". The cost-preview endpoint is
 * scheduled for Task Group 6 and does not exist yet; per the task spec we
 * "stub the lookup function only" -- i.e. test the helper that Group 5/6 will
 * consume rather than the cost-preview itself. The helper is the single
 * canonical surface for reading per-project config on the gateway side, so
 * verifying its defaulting behaviour covers the "honours auto_run_pass_2 and
 * budget caps" requirement for the helper layer.
 *
 * Two focused tests:
 *   1. fetchProjectConfigWithDefaults returns the project's values when AMS
 *      surfaces them in snake_case, including auto_run_pass_2 = false (which
 *      is the case Group 5/6's cost-preview will branch on when deciding
 *      whether to estimate pass-2 cost).
 *   2. fetchProjectConfigWithDefaults falls back to documented defaults
 *      (24000 / 12000 / true) when AMS returns no values for any of the three
 *      Task-Group-9 fields.
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
  fetchProjectConfig,
  fetchProjectConfigWithDefaults,
  DEFAULT_PER_STORY_TOKEN_CAP,
  DEFAULT_CROSS_STORY_TOKEN_CAP,
  DEFAULT_AUTO_RUN_PASS_2,
} from '../services/architectureModelClient';

function jsonResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: async () => body,
  };
}

describe('fetchProjectConfig (Task Group 9)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  test('fetchProjectConfigWithDefaults surfaces project values including auto_run_pass_2 = false', async () => {
    const projectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    // AMS surfaces snake_case fields per the global Jackson snake-case strategy.
    // Note: per the spec, auto_run_pass_2 = false is the case that the
    // cost-preview will branch on when deciding whether to estimate pass-2
    // cost; we explicitly cover it here.
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: projectId,
        name: 'test',
        per_story_context_token_cap: 32000,
        cross_story_context_token_cap: 4000,
        auto_run_pass_2: false,
      })
    );

    const result = await fetchProjectConfigWithDefaults(projectId);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain(`/api/projects/${projectId}`);

    expect(result.perStoryContextTokenCap).toBe(32000);
    expect(result.crossStoryContextTokenCap).toBe(4000);
    expect(result.autoRunPass2).toBe(false);
  });

  test('fetchProjectConfigWithDefaults falls back to defaults when AMS returns no values', async () => {
    const projectId = '11111111-2222-3333-4444-555555555555';

    // AMS row missing the three Task-Group-9 fields (e.g. a row created before
    // the changeset 143 backfill, or an unexpected schema state). The helper
    // must fall back to the documented defaults.
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: projectId,
        name: 'test',
        // intentionally omit per_story_context_token_cap / cross_story_context_token_cap / auto_run_pass_2
      })
    );

    const result = await fetchProjectConfigWithDefaults(projectId);

    expect(result.perStoryContextTokenCap).toBe(DEFAULT_PER_STORY_TOKEN_CAP);
    expect(result.crossStoryContextTokenCap).toBe(DEFAULT_CROSS_STORY_TOKEN_CAP);
    expect(result.autoRunPass2).toBe(DEFAULT_AUTO_RUN_PASS_2);

    // Sanity-check the constants themselves match the documented defaults
    // (24000 / 12000 / true) so the defaults the gateway uses can't silently
    // drift away from the AMS column DEFAULTs in Liquibase changeset 143.
    expect(DEFAULT_PER_STORY_TOKEN_CAP).toBe(24000);
    expect(DEFAULT_CROSS_STORY_TOKEN_CAP).toBe(12000);
    expect(DEFAULT_AUTO_RUN_PASS_2).toBe(true);
  });

  test('fetchProjectConfig (no-defaulting form) returns null on 404 so callers can decide', async () => {
    const projectId = '99999999-9999-9999-9999-999999999999';
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { message: 'Not found' }));

    const result = await fetchProjectConfig(projectId);

    expect(result).toBeNull();
  });
});
