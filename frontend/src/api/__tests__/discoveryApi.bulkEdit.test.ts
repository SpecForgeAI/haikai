/**
 * Tests for the C1 Discovery API client wrappers (Skipped-candidate visibility +
 * grouped bulk-fill (C1) for discovery save-back, 2026-06-20) -- Task Group 5.
 *
 * Covers:
 * - bulkCandidateEdit posts the curated patches to the gateway bulk-edit URL and
 *   parses the ATOMIC snake_case { applied_count, requested_count, ids, applied[] }
 *   response; a non-2xx is treated as a WHOLE-BATCH failure (rejects).
 * - updateCandidate hits the AMS-backed PUT /{candidateId} URL/shape.
 * - previewSaveApprovedCandidates sends commit=false (dry run) and parses the
 *   would-commit / would-still-block + reason-arm projection.
 * - SaveApprovedResult round-trips the new reasons[] arm + suppressedDuplicates[]
 *   / possibleDuplicates[] arrays that already reach the browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bulkCandidateEdit,
  updateCandidate,
  previewSaveApprovedCandidates,
  saveApprovedCandidates,
  type BulkCandidateEditResponse,
  type SaveApprovedResult,
  type DiscoveryCandidateDto,
} from '../discoveryApi';

describe('discoveryApi C1 bulk-fill wrappers (Task Group 5)', () => {
  const originalFetch = global.fetch;

  const PROJECT_ID = 'proj-abc-123';
  const ARCH_ID = 'arch-uuid-default';
  const RUN_ID = 'run-001';

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  // =========================================================================
  // bulkCandidateEdit
  // =========================================================================
  describe('bulkCandidateEdit', () => {
    it('posts the curated patches to the gateway bulk-edit URL and parses the atomic response', async () => {
      const patches = [
        {
          candidate_id: 'ccc00001-aaaa-bbbb-cccc-111111111111',
          name: 'OrderService.process',
          data: { controllerClassName: 'OrderService' },
        },
        {
          candidate_id: 'ccc00002-aaaa-bbbb-cccc-222222222222',
          data: { interface_type: 'GRAPHQL_API' },
        },
      ];

      const mockApplied: DiscoveryCandidateDto[] = [
        {
          id: 'ccc00001-aaaa-bbbb-cccc-111111111111',
          run_id: RUN_ID,
          candidate_type: 'business_logics',
          name: 'OrderService.process',
          confidence: 0.9,
          status: 'proposed',
          source_cluster_ids: [],
          data: { controllerClassName: 'OrderService' },
          synthesized_at: '2026-06-20T10:00:00Z',
          parent_candidate_id: null,
          review_status: 'approved',
          reviewed_by: null,
          reviewed_at: null,
          previous_review_status: null,
        },
      ];

      const mockResponse: BulkCandidateEditResponse = {
        applied_count: 2,
        requested_count: 2,
        ids: [
          'ccc00001-aaaa-bbbb-cccc-111111111111',
          'ccc00002-aaaa-bbbb-cccc-222222222222',
        ],
        applied: mockApplied,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await bulkCandidateEdit(PROJECT_ID, ARCH_ID, RUN_ID, patches);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/candidates/bulk-edit`
      );
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      // The body is wrapped in { patches }, snake_case, with the data overlays verbatim.
      expect(JSON.parse(options.body)).toEqual({ patches });

      // The atomic response is parsed (applied_count == requested_count on a 2xx).
      expect(result.applied_count).toBe(2);
      expect(result.requested_count).toBe(2);
      expect(result.ids).toHaveLength(2);
      expect(result.applied[0].name).toBe('OrderService.process');
    });

    it('rejects (whole-batch failure) when the bulk-edit endpoint returns a non-2xx', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'candidate not in scope' }),
      });

      await expect(
        bulkCandidateEdit(PROJECT_ID, ARCH_ID, RUN_ID, [
          { candidate_id: 'ccc99999-aaaa-bbbb-cccc-999999999999', name: 'X' },
        ])
      ).rejects.toThrow('Bulk candidate edit request failed: 404');
    });
  });

  // =========================================================================
  // updateCandidate (PUT /{candidateId})
  // =========================================================================
  describe('updateCandidate', () => {
    it('PUTs the full candidate DTO to the per-candidate URL and returns the updated candidate', async () => {
      const candidateId = 'ccc00001-aaaa-bbbb-cccc-111111111111';
      const update: DiscoveryCandidateDto = {
        id: candidateId,
        run_id: RUN_ID,
        candidate_type: 'interfaces',
        name: 'PaymentApi',
        confidence: 0.8,
        status: 'proposed',
        source_cluster_ids: [],
        data: { interface_type: 'GRAPHQL_API' },
        synthesized_at: '2026-06-20T10:00:00Z',
        parent_candidate_id: null,
        review_status: 'approved',
        reviewed_by: null,
        reviewed_at: null,
        previous_review_status: null,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(update),
      });

      const result = await updateCandidate(PROJECT_ID, ARCH_ID, RUN_ID, candidateId, update);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/candidates/${candidateId}`
      );
      expect(options.method).toBe('PUT');
      expect(options.headers['Content-Type']).toBe('application/json');
      // The full candidate DTO is the PUT body (wholesale replace, data blob included).
      expect(JSON.parse(options.body)).toEqual(update);
      expect(result.name).toBe('PaymentApi');
      expect((result.data as Record<string, unknown>).interface_type).toBe('GRAPHQL_API');
    });

    it('throws when the PUT returns a non-ok response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      await expect(
        updateCandidate(PROJECT_ID, ARCH_ID, RUN_ID, 'ccc00001-aaaa-bbbb-cccc-111111111111', {
          id: 'ccc00001-aaaa-bbbb-cccc-111111111111',
        } as DiscoveryCandidateDto)
      ).rejects.toThrow('Update candidate request failed: 400');
    });
  });

  // =========================================================================
  // previewSaveApprovedCandidates (dry run: commit=false)
  // =========================================================================
  describe('previewSaveApprovedCandidates (dry run)', () => {
    it('sends commit=false and parses the would-commit / would-still-block + reason-arm projection', async () => {
      const projection: SaveApprovedResult = {
        entitiesCreated: 1,
        entitiesSkipped: 1,
        candidatesCommitted: 1,
        belowGateCount: 0,
        reasons: [
          {
            candidateId: 'ccc00001-aaaa-bbbb-cccc-111111111111',
            candidateType: 'logical_data_entities',
            name: 'Account',
            class: '',
            reason: 'created',
          },
          {
            candidateId: 'ccc00002-aaaa-bbbb-cccc-222222222222',
            candidateType: 'endpoints',
            name: 'lonelyEndpoint',
            class: 'OrderController',
            reason: 'blocked',
            missingField: 'path_or_address',
          },
        ],
        suppressedDuplicates: [],
        possibleDuplicates: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(projection),
      });

      const result = await previewSaveApprovedCandidates(PROJECT_ID, ARCH_ID, RUN_ID);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      // The dry-run flag rides the query string.
      expect(url).toBe(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}/save-approved?commit=false`
      );
      expect(options.method).toBe('POST');
      // ...and the body for transports that drop the query string.
      expect(JSON.parse(options.body)).toEqual({ commit: false });

      // The projection (would-commit / would-still-block via the reason arm) parses.
      expect(result.reasons).toHaveLength(2);
      expect(result.reasons?.[1].reason).toBe('blocked');
      expect(result.reasons?.[1].missingField).toBe('path_or_address');
    });

    it('throws when the dry-run save returns a non-ok response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 502,
      });

      await expect(previewSaveApprovedCandidates(PROJECT_ID, ARCH_ID, RUN_ID)).rejects.toThrow(
        'Preview save approved candidates request failed: 502'
      );
    });
  });

  // =========================================================================
  // SaveApprovedResult round-trips the new reasons arm + dup arrays
  // =========================================================================
  describe('SaveApprovedResult reason arm + duplicate arrays', () => {
    it('carries reasons[], suppressedDuplicates[] and possibleDuplicates[] through the committing save call', async () => {
      const committed: SaveApprovedResult = {
        entitiesCreated: 2,
        entitiesSkipped: 3,
        candidatesCommitted: 2,
        belowGateCount: 1,
        reasons: [
          {
            candidateId: 'ccc00010-aaaa-bbbb-cccc-000000000010',
            candidateType: 'business_logics',
            name: 'OrderService.process',
            class: 'OrderService',
            reason: 'created',
          },
          {
            candidateId: 'ccc00011-aaaa-bbbb-cccc-000000000011',
            candidateType: 'services',
            name: 'PaymentService',
            class: '',
            reason: 'reused',
            reusedSubclass: 'intra-scan',
          },
          {
            candidateId: 'ccc00012-aaaa-bbbb-cccc-000000000012',
            candidateType: 'logical_data_entities',
            name: 'Customer',
            class: '',
            reason: 'reused',
            reusedSubclass: 'pre-existing',
          },
        ],
        suppressedDuplicates: [
          {
            candidateId: 'ccc00020-aaaa-bbbb-cccc-000000000020',
            candidateName: 'Order',
            entityType: 'logical_data_entities',
            existingEntityId: 'ent-order-1',
          },
        ],
        possibleDuplicates: [
          {
            candidateId: 'ccc00021-aaaa-bbbb-cccc-000000000021',
            candidateName: 'Acct',
            entityType: 'logical_data_entities',
            existingEntityId: 'ent-account-1',
            confidence: 0.7,
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(committed),
      });

      const result = await saveApprovedCandidates(PROJECT_ID, ARCH_ID, RUN_ID);

      // The reason arm distinguishes intra-scan vs pre-existing (never collapsed).
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons?.find((r) => r.candidateId.endsWith('000011'))?.reusedSubclass).toBe(
        'intra-scan'
      );
      expect(result.reasons?.find((r) => r.candidateId.endsWith('000012'))?.reusedSubclass).toBe(
        'pre-existing'
      );

      // The previously-dropped duplicate arrays now survive the type.
      expect(result.suppressedDuplicates).toHaveLength(1);
      expect(result.suppressedDuplicates?.[0].existingEntityId).toBe('ent-order-1');
      expect(result.possibleDuplicates).toHaveLength(1);
      expect(result.possibleDuplicates?.[0].confidence).toBe(0.7);

      // The original counts remain intact.
      expect(result.entitiesCreated).toBe(2);
      expect(result.belowGateCount).toBe(1);
    });
  });
});
