/**
 * User Journey Overview Diagram Type Registration and API Client Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 4, Task 4.1: 5 focused tests
 *
 * Test 1: USER_JOURNEY_OVERVIEW is in ALL_DIAGRAM_TYPES but NOT in CREATABLE_DIAGRAM_TYPES
 * Test 2: normalizeDiagramType('user_journey_overview') and normalizeDiagramType('user journey overview') both return 'USER_JOURNEY_OVERVIEW'
 * Test 3: DIAGRAM_TYPE_LABELS['USER_JOURNEY_OVERVIEW'] equals 'User Journey Overview'
 * Test 4: USER_JOURNEY_OVERVIEW is in TYPED_DIAGRAM_TYPES and isDiagramTypedContentType returns true
 * Test 5: fetchTemporaryUserJourneyOverviewDiagram calls correct URL with projectId and businessUserId query parameter (mock fetch)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ALL_DIAGRAM_TYPES,
  CREATABLE_DIAGRAM_TYPES,
  DIAGRAM_TYPE_LABELS,
  normalizeDiagramType,
} from '../diagramType';
import {
  TYPED_DIAGRAM_TYPES,
  isDiagramTypedContentType,
} from '../typedContent';

describe('USER_JOURNEY_OVERVIEW diagram type registration', () => {
  it('USER_JOURNEY_OVERVIEW is in ALL_DIAGRAM_TYPES but NOT in CREATABLE_DIAGRAM_TYPES', () => {
    expect(ALL_DIAGRAM_TYPES).toContain('USER_JOURNEY_OVERVIEW');
    expect(CREATABLE_DIAGRAM_TYPES).not.toContain('USER_JOURNEY_OVERVIEW');
  });

  it('normalizeDiagramType resolves "user_journey_overview" and "user journey overview" to "USER_JOURNEY_OVERVIEW"', () => {
    expect(normalizeDiagramType('user_journey_overview')).toBe('USER_JOURNEY_OVERVIEW');
    expect(normalizeDiagramType('user journey overview')).toBe('USER_JOURNEY_OVERVIEW');
    // Also verify case-insensitive behavior
    expect(normalizeDiagramType('USER_JOURNEY_OVERVIEW')).toBe('USER_JOURNEY_OVERVIEW');
    expect(normalizeDiagramType('User_Journey_Overview')).toBe('USER_JOURNEY_OVERVIEW');
  });

  it('DIAGRAM_TYPE_LABELS["USER_JOURNEY_OVERVIEW"] equals "User Journey Overview"', () => {
    expect(DIAGRAM_TYPE_LABELS['USER_JOURNEY_OVERVIEW']).toBe('User Journey Overview');
  });

  it('USER_JOURNEY_OVERVIEW is in TYPED_DIAGRAM_TYPES and isDiagramTypedContentType returns true', () => {
    expect(TYPED_DIAGRAM_TYPES).toContain('USER_JOURNEY_OVERVIEW');
    expect(isDiagramTypedContentType('USER_JOURNEY_OVERVIEW')).toBe(true);
  });
});

describe('fetchTemporaryUserJourneyOverviewDiagram API client', () => {
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

  it('calls correct URL with projectId and businessUserId query parameter', async () => {
    const mockDto = {
      diagram_type: 'USER_JOURNEY_OVERVIEW',
      version: '1.0',
      overview: {
        business_user_id: 'bu-1',
        business_user_name: 'Customer',
        title: 'Customer Journey Overview',
      },
      lanes: [],
      nodes: [],
      edges: [],
      render_hints: {
        lane_axis: 'VERTICAL',
        flow_direction: 'LEFT_TO_RIGHT',
        show_title: true,
        show_lane_headers: true,
        show_node_description: true,
        show_relationship_labels: true,
      },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockDto,
    });

    const { fetchTemporaryUserJourneyOverviewDiagram } = await import(
      '../../api/userJourneyOverviewDiagramApi'
    );
    const result = await fetchTemporaryUserJourneyOverviewDiagram('project-123', 'arch-default', 'bu-1');

    expect(result).toEqual(mockDto);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain('/api/projects/project-123/architectures/arch-default/user-journey-overview-diagrams/temporary');
    expect(calledUrl).toContain('businessUserId=bu-1');
  });
});
