/**
 * Findings API Client Tests
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 6 (Phase 4 / Commit 4).
 * Spec F 2026-06-02 Normalize Findings Review Actions -- disposition field is
 * `review_status` (candidate-parity vocabulary); the GET list filter still
 * rides the literal AMS `status` query param.
 *
 * Verifies URL construction + body shape for the new findings client. Mocks
 * `global.fetch` mirroring the `discoveryApi.test.ts` test style.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listFindings,
  reviewFinding,
  createFindingLink,
  FindingsApiError,
  type DiscoveryFindingDto,
  type DiscoveryFindingSearchResponse,
  type DiscoveryFindingLinkDto,
} from './findingsApi';

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';
const RUN_ID = 'run-uuid-1';
const FINDING_ID = 'finding-uuid-1';

describe('findingsApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  describe('listFindings URL construction', () => {
    it('builds the gateway URL with no query string when no filters supplied', async () => {
      const mockResponse: DiscoveryFindingSearchResponse = {
        items: [],
        total: 0,
        page: 0,
        size: 20,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mockResponse),
      });

      const result = await listFindings(PROJECT_ID, ARCH_ID, RUN_ID);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/findings`,
      );
      expect(init.method).toBe('GET');
      expect(result.total).toBe(0);
    });

    it('builds the gateway URL with the right query string when filters are supplied', async () => {
      const mockResponse: DiscoveryFindingSearchResponse = {
        items: [],
        total: 0,
        page: 0,
        size: 20,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mockResponse),
      });

      await listFindings(PROJECT_ID, ARCH_ID, RUN_ID, {
        review_status: 'deferred',
        severity: 'high',
        category: 'ambiguity',
        finding_type: 'low_confidence_candidate',
        source: 'discoveryV3Pipeline',
        linked_target_type: 'discovery_candidate',
        linked_target_id: 'cand-1',
        q: 'order service',
        page: 0,
        size: 25,
      });

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      // We assert the prefix + that every filter key is present (the
      // URLSearchParams encoder is what determines exact ordering, but
      // these assertions stay decoupled from that). NOTE (Spec F): the
      // disposition filter rides the literal AMS `status` query param even
      // though the client field is `review_status`.
      expect(url).toContain(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/findings?`,
      );
      expect(url).toContain('status=deferred');
      expect(url).toContain('severity=high');
      expect(url).toContain('category=ambiguity');
      expect(url).toContain('findingType=low_confidence_candidate');
      expect(url).toContain('source=discoveryV3Pipeline');
      expect(url).toContain('linkedTargetType=discovery_candidate');
      expect(url).toContain('linkedTargetId=cand-1');
      // Encoded space (URLSearchParams uses '+', not '%20')
      expect(url).toMatch(/q=order(\+|%20)service/);
      expect(url).toContain('page=0');
      expect(url).toContain('size=25');
    });

    it('skips null/undefined/empty filter values when building the URL', async () => {
      const mockResponse: DiscoveryFindingSearchResponse = {
        items: [],
        total: 0,
        page: 0,
        size: 20,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(mockResponse),
      });

      await listFindings(PROJECT_ID, ARCH_ID, RUN_ID, {
        review_status: 'deferred',
        severity: null,
        category: '',
        finding_type: undefined,
      });

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain('status=deferred');
      expect(url).not.toContain('severity=');
      expect(url).not.toContain('category=');
      expect(url).not.toContain('findingType=');
    });
  });

  describe('reviewFinding', () => {
    it('POSTs to the review endpoint with review_status + reviewer_notes', async () => {
      const updated: DiscoveryFindingDto = {
        id: FINDING_ID,
        run_id: RUN_ID,
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        finding_type: 'low_confidence_candidate',
        category: 'ambiguity',
        severity: 'medium',
        confidence: 0.5,
        review_status: 'approved',
        previous_review_status: 'pending_review',
        title: 't',
        summary: 's',
        detail_json: null,
        source: null,
        created_by_stage: null,
        created_at: '2026-05-16T00:00:00Z',
        updated_at: '2026-05-16T00:00:01Z',
        reviewed_at: '2026-05-16T00:00:01Z',
        reviewer_notes: 'looks right',
        links: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'application/json' : null),
        },
        json: () => Promise.resolve(updated),
      });

      const result = await reviewFinding(PROJECT_ID, ARCH_ID, RUN_ID, FINDING_ID, {
        review_status: 'approved',
        reviewer_notes: 'looks right',
      });

      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/findings/${FINDING_ID}/review`,
      );
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        review_status: 'approved',
        reviewer_notes: 'looks right',
      });
      expect(result.review_status).toBe('approved');
      expect(result.previous_review_status).toBe('pending_review');
    });
  });

  describe('FindingsApiError pass-through', () => {
    it('surfaces the AMS structured error body (e.g. invalid_link_target 400)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: (h: string) => (h === 'content-type' ? 'application/json' : null),
        },
        json: () =>
          Promise.resolve({
            code: 'invalid_link_target',
            message: 'target does not exist or belongs to a different run',
          }),
      });

      const linkBody: DiscoveryFindingLinkDto = {
        id: 'unused',
        finding_id: FINDING_ID,
        link_type: 'supports',
        target_type: 'discovery_candidate',
        target_id: 'cand-other-run',
        label: null,
        created_at: '',
      };

      try {
        await createFindingLink(PROJECT_ID, ARCH_ID, RUN_ID, FINDING_ID, {
          link_type: linkBody.link_type,
          target_type: linkBody.target_type,
          target_id: linkBody.target_id,
        });
        // Should not reach
        expect.fail('Expected createFindingLink to throw FindingsApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(FindingsApiError);
        const typed = err as FindingsApiError;
        expect(typed.status).toBe(400);
        expect(typed.body.code).toBe('invalid_link_target');
      }
    });
  });
});
