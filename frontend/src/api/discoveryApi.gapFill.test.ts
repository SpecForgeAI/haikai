/**
 * Gap-Fill Tests for Discovery API Client
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 7: Test Review and Gap Analysis (Task 7.3)
 *
 * These tests fill coverage gaps identified in the Task Group 7 review:
 * - getDiscoveryRun (single run fetch) was not tested in the original API test suite
 * - getDiscoveryCandidateCount was not tested in the original API test suite
 *
 * Updated for Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
 *   Both `getDiscoveryRun` and `getDiscoveryCandidateCount` now take
 *   `architectureId` as a positional argument and embed it in the URL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDiscoveryRun,
  getDiscoveryCandidateCount,
  type DiscoveryRunDto,
} from './discoveryApi';

describe('discoveryApi gap-fill tests (Task Group 7)', () => {
  const originalFetch = global.fetch;
  const ARCH_ID = 'arch-uuid-default';

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  /**
   * Gap 1: getDiscoveryRun was not tested in the original API client tests.
   * Verifies URL construction and typed response for single run fetch.
   */
  describe('getDiscoveryRun', () => {
    it('fetches a single run from the correct architecture-scoped URL and returns typed response', async () => {
      // Given
      const projectId = 'proj-gap-001';
      const runId = 'run-gap-abc';
      const mockRun: DiscoveryRunDto = {
        id: runId,
        project_id: projectId,
        status: 'FAILED',
        current_step: 'phase_1b',
        config_snapshot: null,
        steps_payload: { phase_1a: 'completed', phase_1b: 'failed' },
        error_message: 'Clustering timed out after 30s',
        created_at: '2026-04-05T08:00:00Z',
        updated_at: '2026-04-05T08:10:00Z',
        architecture_id: ARCH_ID,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRun),
      });

      // When
      const result = await getDiscoveryRun(projectId, ARCH_ID, runId);

      // Then
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`/api/v1/discovery/projects/proj-gap-001/architectures/${ARCH_ID}/runs/run-gap-abc`);
      expect(options.method).toBe('GET');
      expect(result.id).toBe(runId);
      expect(result.status).toBe('FAILED');
      expect(result.error_message).toBe('Clustering timed out after 30s');
    });

    it('throws error when getDiscoveryRun receives non-ok response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(getDiscoveryRun('proj-1', ARCH_ID, 'run-missing')).rejects.toThrow(
        'Discovery run request failed: 404'
      );
    });
  });

  /**
   * Gap 2: getDiscoveryCandidateCount was not tested in the original API client tests.
   * Verifies URL construction and typed response for candidate count fetch.
   */
  describe('getDiscoveryCandidateCount', () => {
    it('fetches candidate count from the correct architecture-scoped URL and returns count object', async () => {
      // Given
      const projectId = 'proj-gap-002';
      const runId = 'run-gap-def';
      const mockCount = { count: 42 };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCount),
      });

      // When
      const result = await getDiscoveryCandidateCount(projectId, ARCH_ID, runId);

      // Then
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`/api/v1/discovery/projects/proj-gap-002/architectures/${ARCH_ID}/runs/run-gap-def/candidates/count`);
      expect(result.count).toBe(42);
    });

    it('throws error when getDiscoveryCandidateCount receives non-ok response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(getDiscoveryCandidateCount('proj-1', ARCH_ID, 'run-1')).rejects.toThrow(
        'Discovery candidate count request failed: 500'
      );
    });
  });
});
