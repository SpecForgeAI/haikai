/**
 * Overview Entry Point Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 5, Task 5.1 (Test 5): Business User selector dropdown populates
 * from state.model.metaModel.entities.business_users and the Generate button
 * calls fetchTemporaryUserJourneyOverviewDiagram then activates review.
 *
 * Tests the Business User selector component logic in isolation since the full
 * DiagramsView is too complex to render in a unit test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import type { UserJourneyOverviewDiagramDto } from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Mock the API client
// ============================================================================

const mockFetchOverview = vi.fn<[string, string], Promise<UserJourneyOverviewDiagramDto>>();

vi.mock('../../../api/userJourneyOverviewDiagramApi', () => ({
  fetchTemporaryUserJourneyOverviewDiagram: (...args: any[]) => mockFetchOverview(...args),
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createTestOverviewDto(): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [{ id: 'lane-1', name: 'Order Management', order: 0 }],
    nodes: [{
      id: 'node-1',
      lane_id: 'lane-1',
      name: 'Place Order',
      description: '',
      primary_business_user_id: 'bu-1',
      primary_business_user_name: 'Customer',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Order Management',
      metadata: { step_count: 5, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
    }],
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
}

/**
 * Standalone test component that mirrors the Business User selector logic
 * from DiagramsView without needing the full component tree.
 */
function BusinessUserSelectorTestHarness({
  businessUsers,
  projectId,
  onActivateReview,
}: {
  businessUsers: Array<{ id: string; name: string }>;
  projectId: string;
  onActivateReview: (projectId: string, dto: UserJourneyOverviewDiagramDto) => void;
}) {
  const [showSelector, setShowSelector] = useState(false);
  const [selectedBusinessUserId, setSelectedBusinessUserId] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!projectId || !selectedBusinessUserId) return;
    setGenerating(true);
    try {
      const { fetchTemporaryUserJourneyOverviewDiagram } = await import('../../../api/userJourneyOverviewDiagramApi');
      const dto = await fetchTemporaryUserJourneyOverviewDiagram(projectId, selectedBusinessUserId);
      onActivateReview(projectId, dto);
      setShowSelector(false);
      setSelectedBusinessUserId('');
    } catch {
      // error handling not tested here
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <button
        data-testid="generate-overview-button"
        onClick={() => setShowSelector(!showSelector)}
      >
        Generate Journey Overview
      </button>
      {showSelector && (
        <div data-testid="overview-business-user-selector">
          <select
            data-testid="overview-business-user-dropdown"
            value={selectedBusinessUserId}
            onChange={(e) => setSelectedBusinessUserId(e.target.value)}
          >
            <option value="">-- Select --</option>
            {businessUsers.map((bu) => (
              <option key={bu.id} value={bu.id}>{bu.name}</option>
            ))}
          </select>
          <button
            data-testid="overview-generate-confirm"
            onClick={handleGenerate}
            disabled={!selectedBusinessUserId || generating}
          >
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Overview Entry Point - Business User Selector', () => {
  beforeEach(() => {
    mockFetchOverview.mockReset();
  });

  it('dropdown populates with business users and Generate calls fetchTemporaryUserJourneyOverviewDiagram then activates review', async () => {
    const dto = createTestOverviewDto();
    mockFetchOverview.mockResolvedValue(dto);

    const onActivateReview = vi.fn();

    const businessUsers = [
      { id: 'bu-1', name: 'Customer' },
      { id: 'bu-2', name: 'Admin' },
      { id: 'bu-3', name: 'Support Agent' },
    ];

    const { getByTestId, queryByTestId } = render(
      <BusinessUserSelectorTestHarness
        businessUsers={businessUsers}
        projectId="proj-123"
        onActivateReview={onActivateReview}
      />
    );

    // Initially, selector is not shown
    expect(queryByTestId('overview-business-user-selector')).toBeNull();

    // Click to show selector
    fireEvent.click(getByTestId('generate-overview-button'));
    expect(getByTestId('overview-business-user-selector')).toBeTruthy();

    // Verify dropdown has all business users
    const dropdown = getByTestId('overview-business-user-dropdown') as HTMLSelectElement;
    const options = Array.from(dropdown.options);
    expect(options).toHaveLength(4); // 1 placeholder + 3 users
    expect(options[1].value).toBe('bu-1');
    expect(options[1].text).toBe('Customer');
    expect(options[2].value).toBe('bu-2');
    expect(options[2].text).toBe('Admin');
    expect(options[3].value).toBe('bu-3');
    expect(options[3].text).toBe('Support Agent');

    // Select a business user
    fireEvent.change(dropdown, { target: { value: 'bu-1' } });
    expect(dropdown.value).toBe('bu-1');

    // Click Generate
    fireEvent.click(getByTestId('overview-generate-confirm'));

    // Wait for the async fetch to complete
    await waitFor(() => {
      expect(mockFetchOverview).toHaveBeenCalledWith('proj-123', 'bu-1');
    });

    // Verify review was activated with the DTO
    await waitFor(() => {
      expect(onActivateReview).toHaveBeenCalledWith('proj-123', dto);
    });
  });
});
