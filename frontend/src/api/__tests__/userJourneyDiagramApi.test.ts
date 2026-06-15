/**
 * Tests for userJourneyDiagramApi
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 1, Task 1.1: 5 focused tests for the API client function
 *
 * Test 1: Successful fetch returning an array of UserJourneyDiagramDto
 * Test 2: HTTP error response throws with status code in message
 * Test 3: Empty array response returns [] without error
 * Test 4: encodeURIComponent is applied to projectId in the URL
 * Test 5: Throws descriptive error message including project ID and status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';

describe('fetchTemporaryUserJourneyDiagrams', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  /**
   * Helper: create a minimal valid UserJourneyDiagramDto for testing.
   */
  function createTestDiagram(name: string): UserJourneyDiagramDto {
    return {
      diagram_type: 'USER_JOURNEY',
      version: '1',
      journey: {
        id: 'j-1',
        name,
        description: 'Test journey',
        user_role_id: 'ur-1',
        user_role_name: 'End User',
        parent_business_process_id: 'bp-1',
        parent_business_process_name: 'Order Flow',
      },
      lanes: [{ id: 'lane-1', name: 'Web App', order: 0 }],
      steps: [
        {
          id: 'step-1',
          journey_id: 'j-1',
          order: 0,
          lane_id: 'lane-1',
          process_activity_id: 'pa-1',
          process_activity_name: 'Browse',
          name: 'Browse Products',
          description: 'User browses',
          business_user_id: 'bu-1',
          business_user_name: 'Customer',
        },
      ],
      edges: [],
      render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
    };
  }

  it('returns an array of UserJourneyDiagramDto on successful fetch', async () => {
    const diagrams = [createTestDiagram('Journey A'), createTestDiagram('Journey B')];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => diagrams,
    });

    const { fetchTemporaryUserJourneyDiagrams } = await import('../userJourneyDiagramApi');
    const result = await fetchTemporaryUserJourneyDiagrams('project-123');

    expect(result).toEqual(diagrams);
    expect(result).toHaveLength(2);
    expect(result[0].journey.name).toBe('Journey A');
  });

  it('throws an error with status code when HTTP response is not ok', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const { fetchTemporaryUserJourneyDiagrams } = await import('../userJourneyDiagramApi');

    await expect(fetchTemporaryUserJourneyDiagrams('project-123')).rejects.toThrow('404');
  });

  it('returns empty array without error when no journeys exist', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { fetchTemporaryUserJourneyDiagrams } = await import('../userJourneyDiagramApi');
    const result = await fetchTemporaryUserJourneyDiagrams('project-123');

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('applies encodeURIComponent to projectId in the URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { fetchTemporaryUserJourneyDiagrams } = await import('../userJourneyDiagramApi');
    await fetchTemporaryUserJourneyDiagrams('project/with spaces&special');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent('project/with spaces&special'));
    expect(url).not.toContain('project/with spaces&special');
  });

  it('throws a descriptive error message including project ID', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { fetchTemporaryUserJourneyDiagrams } = await import('../userJourneyDiagramApi');

    await expect(fetchTemporaryUserJourneyDiagrams('my-project-id')).rejects.toThrow(
      'Failed to fetch temporary user journey diagrams for project "my-project-id": 500'
    );
  });
});
