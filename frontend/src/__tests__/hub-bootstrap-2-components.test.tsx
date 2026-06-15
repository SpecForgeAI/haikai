/**
 * Hub Bootstrap 2: RoadmapPreviewBubble and ArtifactPreviewBubble Component Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 5, Task 5.1: Write 7 focused tests for the new/updated components
 *
 * Tests verify:
 * 1. RoadmapPreviewBubble renders initiative titles and nested epic titles from valid JSON
 * 2. RoadmapPreviewBubble renders initiative/epic counts in the header
 * 3. RoadmapPreviewBubble "Show JSON" toggle switches between readable summary and raw JSON view
 * 4. RoadmapPreviewBubble calls onConfirm when Confirm button is clicked
 * 5. RoadmapPreviewBubble calls onReject when Reject button is clicked
 * 6. RoadmapPreviewBubble handles malformed JSON gracefully (shows error state)
 * 7. ArtifactPreviewBubble renders custom headerLabel prop when provided
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoadmapPreviewBubble } from '../components/UnifiedChat/RoadmapPreviewBubble';
import { ArtifactPreviewBubble } from '../components/UnifiedChat/ArtifactPreviewBubble';

// Mock CSS modules
vi.mock('../components/UnifiedChat/RoadmapPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/ArtifactPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ============================================================================
// Test Data
// ============================================================================

const validRoadmapJson = JSON.stringify({
  initiatives: [
    {
      title: 'User Onboarding',
      description: 'Improve the first-time user experience',
      epics: [
        { title: 'Sign-up Flow', description: 'Streamline registration' },
        { title: 'Welcome Tutorial', description: 'Interactive walkthrough' },
        { title: 'Profile Setup' },
      ],
    },
    {
      title: 'Analytics Dashboard',
      description: 'Provide actionable insights',
      epics: [
        { title: 'Usage Metrics', description: 'Track key usage patterns' },
        { title: 'Export Reports' },
      ],
    },
  ],
});

// ============================================================================
// RoadmapPreviewBubble Tests
// ============================================================================

describe('Hub Bootstrap 2: RoadmapPreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 1: Renders initiative titles and nested epic titles from valid JSON
  // --------------------------------------------------------------------------
  it('renders initiative titles and nested epic titles from valid JSON', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validRoadmapJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    const container = screen.getByTestId('roadmap-preview-bubble');
    expect(container).toBeInTheDocument();

    // Check initiative titles are rendered
    expect(screen.getByText('User Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();

    // Check epic titles are rendered
    expect(screen.getByText('Sign-up Flow')).toBeInTheDocument();
    expect(screen.getByText('Welcome Tutorial')).toBeInTheDocument();
    expect(screen.getByText('Profile Setup')).toBeInTheDocument();
    expect(screen.getByText('Usage Metrics')).toBeInTheDocument();
    expect(screen.getByText('Export Reports')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: Renders initiative/epic counts in the header
  // --------------------------------------------------------------------------
  it('renders initiative/epic counts in the header (e.g., "2 initiatives, 5 epics")', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validRoadmapJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Header should show "Generated Roadmap"
    expect(screen.getByText('Generated Roadmap')).toBeInTheDocument();

    // Counts should be displayed
    const countsEl = screen.getByTestId('roadmap-counts');
    expect(countsEl).toBeInTheDocument();
    expect(countsEl.textContent).toBe('2 initiatives, 5 epics');
  });

  // --------------------------------------------------------------------------
  // Test 3: "Show JSON" toggle switches between readable summary and raw JSON view
  // --------------------------------------------------------------------------
  it('"Show JSON" toggle switches between readable summary and raw JSON view', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validRoadmapJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Initially should show summary view, not raw JSON
    expect(screen.getByTestId('roadmap-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('roadmap-raw-json')).not.toBeInTheDocument();

    // Toggle button should say "Show JSON"
    const toggleButton = screen.getByTestId('roadmap-toggle-json');
    expect(toggleButton.textContent).toBe('Show JSON');

    // Click toggle to switch to raw JSON view
    fireEvent.click(toggleButton);

    // Now should show raw JSON, not summary
    expect(screen.queryByTestId('roadmap-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('roadmap-raw-json')).toBeInTheDocument();

    // Toggle button should now say "Show Summary"
    expect(toggleButton.textContent).toBe('Show Summary');

    // Click toggle again to go back to summary
    fireEvent.click(toggleButton);
    expect(screen.getByTestId('roadmap-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('roadmap-raw-json')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Calls onConfirm when Confirm button is clicked
  // --------------------------------------------------------------------------
  it('calls onConfirm when Confirm button is clicked', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validRoadmapJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);

    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    expect(mockOnReject).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 5: Calls onReject when Reject button is clicked
  // --------------------------------------------------------------------------
  it('calls onReject when Reject button is clicked', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validRoadmapJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    fireEvent.click(rejectButton);

    expect(mockOnReject).toHaveBeenCalledTimes(1);
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 6: Handles malformed JSON gracefully (shows error state)
  // --------------------------------------------------------------------------
  it('handles malformed JSON gracefully (shows error state)', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content="this is not valid JSON {{{{"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Should show error message
    const errorEl = screen.getByTestId('roadmap-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain('Failed to parse roadmap JSON');

    // Should NOT show summary or toggle
    expect(screen.queryByTestId('roadmap-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('roadmap-toggle-json')).not.toBeInTheDocument();
    expect(screen.queryByTestId('roadmap-counts')).not.toBeInTheDocument();

    // Confirm and Reject buttons should still be present
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

// ============================================================================
// ArtifactPreviewBubble headerLabel Tests
// ============================================================================

describe('Hub Bootstrap 2: ArtifactPreviewBubble headerLabel', () => {
  // --------------------------------------------------------------------------
  // Test 7: Renders custom headerLabel prop when provided
  // --------------------------------------------------------------------------
  it('renders custom headerLabel prop when provided (instead of default "Generated MISSION.MD")', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    // Render with custom headerLabel
    const { rerender } = render(
      <ArtifactPreviewBubble
        markdownContent="# Test"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
        headerLabel="Generated Roadmap"
      />
    );

    // Should render the custom label
    expect(screen.getByText('Generated Roadmap')).toBeInTheDocument();
    expect(screen.queryByText('Generated MISSION.MD')).not.toBeInTheDocument();

    // Re-render without headerLabel to verify default
    rerender(
      <ArtifactPreviewBubble
        markdownContent="# Test"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    // Should fall back to default label
    expect(screen.getByText('Generated MISSION.MD')).toBeInTheDocument();
    expect(screen.queryByText('Generated Roadmap')).not.toBeInTheDocument();
  });
});
