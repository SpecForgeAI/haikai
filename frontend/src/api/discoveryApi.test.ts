/**
 * Tests for Discovery API Client
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 3: Frontend Discovery API Client
 * Task 3.1: Write 3-5 focused tests for the API client functions
 *
 * Tests cover:
 * - getDiscoveryRunSummary fetches from the correct URL and returns typed response
 * - getDiscoveryRuns fetches the runs list for a project
 * - getDiscoveryCandidates fetches candidates with optional type/status params
 * - getDiscoveryOriginEntities fetches entity-origin mappings for a project
 * - fetch failures (non-ok response) throw an appropriate error
 *
 * Updated for Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   Every read function now takes `architectureId` and embeds it in the URL.
 *   The expected URL strings are updated accordingly. Function signatures
 *   shifted from `(projectId, ...)` to `(projectId, architectureId, ...)`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDiscoveryRunSummary,
  getDiscoveryRuns,
  getDiscoveryCandidates,
  getDiscoveryOriginEntities,
  type DiscoveryRunSummaryDto,
  type DiscoveryRunDto,
  type DiscoveryCandidateDto,
  type DiscoveryCandidateEntityMappingDto,
} from './discoveryApi';

describe('discoveryApi', () => {
  const originalFetch = global.fetch;

  // Spec 2026-05-01 Spec #4 Task Group 7: every read function now takes
  // an architectureId. We use a fixed sentinel so the URL assertions are
  // explicit about what the path-segment refactor produces.
  const ARCH_ID = 'arch-uuid-default';

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  /**
   * Test 1: getDiscoveryRunSummary fetches from the correct architecture-scoped URL
   * and returns the typed summary response.
   */
  describe('getDiscoveryRunSummary', () => {
    it('fetches from the correct architecture-scoped URL and returns typed summary response', async () => {
      // Given
      const projectId = 'proj-abc-123';
      const mockSummary: DiscoveryRunSummaryDto = {
        latest_run_id: 'run-001',
        latest_run_status: 'COMPLETED',
        latest_run_created_at: '2026-04-01T10:00:00Z',
        total_candidates: 15,
        candidate_counts_by_status: { proposed: 10, accepted: 5 },
        entities_saved: 5,
        entity_type_coverage: 3,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSummary),
      });

      // When
      const result = await getDiscoveryRunSummary(projectId, ARCH_ID);

      // Then
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`/api/v1/discovery/projects/proj-abc-123/architectures/${ARCH_ID}/summary`);
      expect(options.method).toBe('GET');
      expect(result).toEqual(mockSummary);
      expect(result.latest_run_status).toBe('COMPLETED');
      expect(result.total_candidates).toBe(15);
    });
  });

  /**
   * Test 2: getDiscoveryRuns fetches the runs list for a project + architecture.
   */
  describe('getDiscoveryRuns', () => {
    it('fetches the runs list for a project + architecture and returns typed array', async () => {
      // Given
      const projectId = 'proj-xyz-456';
      const mockRuns: DiscoveryRunDto[] = [
        {
          id: 'run-002',
          project_id: projectId,
          status: 'COMPLETED',
          current_step: null,
          config_snapshot: { repo_url: 'https://github.com/example/repo' },
          steps_payload: { phase_1a: 'completed', phase_1b: 'completed' },
          error_message: null,
          created_at: '2026-04-02T12:00:00Z',
          updated_at: '2026-04-02T12:30:00Z',
          architecture_id: ARCH_ID,
        },
        {
          id: 'run-001',
          project_id: projectId,
          status: 'FAILED',
          current_step: 'phase_1b',
          config_snapshot: null,
          steps_payload: { phase_1a: 'completed', phase_1b: 'failed' },
          error_message: 'Timeout during clustering',
          created_at: '2026-04-01T10:00:00Z',
          updated_at: '2026-04-01T10:15:00Z',
          architecture_id: ARCH_ID,
        },
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRuns),
      });

      // When
      const result = await getDiscoveryRuns(projectId, ARCH_ID);

      // Then
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`/api/v1/discovery/projects/proj-xyz-456/architectures/${ARCH_ID}/runs`);
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('COMPLETED');
      expect(result[1].error_message).toBe('Timeout during clustering');
    });
  });

  /**
   * Test 3: getDiscoveryCandidates fetches candidates for a run
   * with optional type/status query params.
   */
  describe('getDiscoveryCandidates', () => {
    it('fetches candidates without filters from the correct architecture-scoped URL', async () => {
      // Given
      const projectId = 'proj-abc-123';
      const runId = 'run-001';
      const mockCandidates: DiscoveryCandidateDto[] = [
        {
          id: 'cand-001',
          run_id: runId,
          candidate_type: 'application',
          name: 'OrderService',
          confidence: 0.85,
          status: 'proposed',
          source_cluster_ids: ['cluster-1', 'cluster-2'],
          data: { description: 'Handles order processing' },
          synthesized_at: '2026-04-01T10:05:00Z',
          parent_candidate_id: null,
          review_status: 'pending_review',
          reviewed_by: null,
          reviewed_at: null,
          previous_review_status: null,
        },
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCandidates),
      });

      // When
      const result = await getDiscoveryCandidates(projectId, ARCH_ID, runId);

      // Then
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(
        `/api/v1/discovery/projects/proj-abc-123/architectures/${ARCH_ID}/runs/run-001/candidates`
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('OrderService');
      expect(result[0].confidence).toBe(0.85);
    });

    it('appends type and status query params when provided', async () => {
      // Given
      const projectId = 'proj-abc-123';
      const runId = 'run-001';

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // When
      await getDiscoveryCandidates(projectId, ARCH_ID, runId, 'service', 'accepted');

      // Then
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(
        `/api/v1/discovery/projects/proj-abc-123/architectures/${ARCH_ID}/runs/run-001/candidates?type=service&status=accepted`
      );
    });
  });

  /**
   * Test 4: getDiscoveryOriginEntities fetches entity-origin mappings for a
   * project + architecture.
   */
  describe('getDiscoveryOriginEntities', () => {
    it('fetches entity-origin mappings from the correct architecture-scoped URL', async () => {
      // Given
      const projectId = 'proj-abc-123';
      const mockMappings: DiscoveryCandidateEntityMappingDto[] = [
        {
          id: 'map-001',
          candidate_id: 'cand-001',
          run_id: 'run-001',
          entity_type: 'applications',
          entity_id: 'app-order-svc',
          action: 'created',
          created_at: '2026-04-01T10:10:00Z',
        },
        {
          id: 'map-002',
          candidate_id: 'cand-002',
          run_id: 'run-001',
          entity_type: 'services',
          entity_id: 'svc-payment',
          action: 'reused',
          created_at: '2026-04-01T10:10:00Z',
        },
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMappings),
      });

      // When
      const result = await getDiscoveryOriginEntities(projectId, ARCH_ID);

      // Then
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`/api/v1/discovery/projects/proj-abc-123/architectures/${ARCH_ID}/entity-origins`);
      expect(result).toHaveLength(2);
      expect(result[0].entity_type).toBe('applications');
      expect(result[0].entity_id).toBe('app-order-svc');
      expect(result[1].action).toBe('reused');
    });
  });

  /**
   * Test 5: fetch failures (non-ok response) throw an appropriate error.
   */
  describe('error handling', () => {
    it('throws error when getDiscoveryRunSummary receives non-ok response', async () => {
      // Given
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // When/Then
      await expect(getDiscoveryRunSummary('proj-abc', ARCH_ID)).rejects.toThrow(
        'Discovery summary request failed: 500'
      );
    });

    it('throws error when getDiscoveryRuns receives non-ok response', async () => {
      // Given
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // When/Then
      await expect(getDiscoveryRuns('proj-abc', ARCH_ID)).rejects.toThrow(
        'Discovery runs request failed: 404'
      );
    });

    it('throws error when getDiscoveryCandidates receives non-ok response', async () => {
      // Given
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      // When/Then
      await expect(getDiscoveryCandidates('proj-abc', ARCH_ID, 'run-001')).rejects.toThrow(
        'Discovery candidates request failed: 503'
      );
    });

    it('throws error when getDiscoveryOriginEntities receives non-ok response', async () => {
      // Given
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 502,
      });

      // When/Then
      await expect(getDiscoveryOriginEntities('proj-abc', ARCH_ID)).rejects.toThrow(
        'Discovery entity origins request failed: 502'
      );
    });
  });
});
