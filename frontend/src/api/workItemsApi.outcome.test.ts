/**
 * Work-item implementation git-outcome wire-seam tests.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 6 (gap analysis).
 *
 * The Implement-flow panel persists the extracted git outcome via
 * `updateWorkItem` with camelCase fields; AMS expects the three snake_case
 * keys (implementation_branch / implementation_pr_url /
 * implementation_logs_url). The panel tests mock `updateWorkItem`, so this
 * camelCase -> snake_case seam was otherwise unpinned:
 *  (a) the mapper carries the three fields snake_case and OMITS them when
 *      undefined (absent on PATCH = unchanged, per the AMS null guards);
 *  (b) `updateWorkItem` sends them on the PUT wire and maps the persisted
 *      response back to camelCase for re-render on revisit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapWorkItemUpdatePayloadToDto, updateWorkItem } from './workItemsApi';

describe('Work-item implementation outcome wire mapping (Spec 2026-06-12)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('maps the three outcome fields to snake_case and omits them entirely when undefined', () => {
    const withOutcome = mapWorkItemUpdatePayloadToDto({
      implementationBranch: 'feature/spec-folder-abc',
      implementationPrUrl: 'https://git.example/pr/42',
      implementationLogsUrl: 'https://logs.example/job-1',
    });
    expect(withOutcome).toEqual({
      implementation_branch: 'feature/spec-folder-abc',
      implementation_pr_url: 'https://git.example/pr/42',
      implementation_logs_url: 'https://logs.example/job-1',
    });

    // An ordinary edit that omits the outcome fields must NOT include the
    // keys at all -- AMS null guards treat absent as "unchanged", so sending
    // explicit nulls/empties would still be safe but absence is the contract.
    const withoutOutcome = mapWorkItemUpdatePayloadToDto({ title: 'Renamed' });
    expect(withoutOutcome).toEqual({ title: 'Renamed' });
    expect(withoutOutcome).not.toHaveProperty('implementation_branch');
    expect(withoutOutcome).not.toHaveProperty('implementation_pr_url');
    expect(withoutOutcome).not.toHaveProperty('implementation_logs_url');
  });

  it('updateWorkItem PUTs the snake_case outcome fields and maps the persisted response back to camelCase', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'wi-1',
          project_id: 'proj-1',
          type: 'STORY',
          parent_id: 'feature-1',
          title: 'Implement spec',
          description: null,
          status: 'DEV_COMPLETE',
          sort_order: 1,
          priority: null,
          target_window: null,
          tags: null,
          external_system: null,
          external_key: null,
          external_url: null,
          created_at: '2026-06-12T00:00:00Z',
          updated_at: '2026-06-12T00:10:00Z',
          implementation_branch: 'feature/spec-folder-abc',
          implementation_pr_url: 'https://git.example/pr/42',
          implementation_logs_url: 'https://logs.example/job-1',
        }),
    });

    const updated = await updateWorkItem('proj-1', 'wi-1', {
      implementationBranch: 'feature/spec-folder-abc',
      implementationPrUrl: 'https://git.example/pr/42',
      implementationLogsUrl: 'https://logs.example/job-1',
    });

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/model/projects/proj-1/work-items/wi-1');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({
      implementation_branch: 'feature/spec-folder-abc',
      implementation_pr_url: 'https://git.example/pr/42',
      implementation_logs_url: 'https://logs.example/job-1',
    });

    // Response maps back to camelCase -- what the revisit render reads.
    expect(updated.implementationBranch).toBe('feature/spec-folder-abc');
    expect(updated.implementationPrUrl).toBe('https://git.example/pr/42');
    expect(updated.implementationLogsUrl).toBe('https://logs.example/job-1');
  });
});
