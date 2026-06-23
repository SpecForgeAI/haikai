/**
 * Tests for the Postman-import discovery-candidate staging client.
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A4 -- Task
 * Group 5. `stageImportedDiscoveryCandidate` is the client side of "Add to
 * architecture": it POSTs the imported endpoint (snake_case, R8) to the AMS
 * stage-imported-candidate path and parses the staged un-approved
 * `DiscoveryCandidateDto`. Task Group 8 binds it to the
 * `onStageDiscoveryCandidate` seam.
 *
 * Focused on the critical behaviours: the request maps method/path (and optional
 * source/summary) onto the snake_case body at the architecture-scoped URL, and
 * the snake_case response (review_status='pending_review') is returned verbatim.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  stageImportedDiscoveryCandidate,
  type DiscoveryCandidateDto,
} from './discoveryApi';

describe('stageImportedDiscoveryCandidate', () => {
  const originalFetch = global.fetch;
  const ARCH_ID = 'arch-uuid-default';

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('POSTs the snake_case body to the architecture-scoped URL and returns the staged un-approved candidate', async () => {
    const staged: DiscoveryCandidateDto = {
      id: 'cand-900',
      run_id: 'imported-run-1',
      candidate_type: 'interface',
      name: 'GET /orders/42',
      confidence: 0,
      status: 'proposed',
      source_cluster_ids: [],
      data: { method: 'GET', path: '/orders/42', source: 'postman-import' },
      synthesized_at: '2026-06-23T10:00:00Z',
      parent_candidate_id: null,
      review_status: 'pending_review',
      reviewed_by: null,
      reviewed_at: null,
      previous_review_status: null,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(staged),
    });

    const result = await stageImportedDiscoveryCandidate('proj-abc-123', ARCH_ID, {
      method: 'GET',
      path: '/orders/42',
      sourceItemName: 'Get order by id',
    });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      `/api/v1/discovery/projects/proj-abc-123/architectures/${ARCH_ID}/stage-imported-candidate`,
    );
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    // snake_case wire (R8); only the provided optional field is included.
    expect(body).toEqual({
      method: 'GET',
      path: '/orders/42',
      source_item_name: 'Get order by id',
    });

    // Response returned verbatim, staged un-approved.
    expect(result.review_status).toBe('pending_review');
    expect(result.status).toBe('proposed');
    expect(result.run_id).toBe('imported-run-1');
  });

  it('throws on a non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(
      stageImportedDiscoveryCandidate('proj-abc-123', ARCH_ID, {
        method: '',
        path: '/orders',
      }),
    ).rejects.toThrow('Stage imported candidate request failed: 400');
  });
});
