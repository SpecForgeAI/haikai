/**
 * Hub Bootstrap 1: ArtifactPreviewBubble and CompletionChip Component Tests
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 5, Task 5.1: Write 6 focused tests for the new components
 *
 * Tests verify:
 * - ArtifactPreviewBubble renders markdown content as HTML (heading detection)
 * - ArtifactPreviewBubble renders Confirm and Reject buttons; Confirm shows "Saving..." when isConfirming
 * - ArtifactPreviewBubble calls onConfirm when Confirm is clicked
 * - ArtifactPreviewBubble disables both buttons when disabled is true
 * - CompletionChip renders task label, artifact name, and download transcript button
 * - CompletionChip calls onDownloadTranscript when the download button is clicked
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactPreviewBubble } from '../components/UnifiedChat/ArtifactPreviewBubble';
import { CompletionChip } from '../components/UnifiedChat/CompletionChip';

// Mock CSS modules
vi.mock('../components/UnifiedChat/ArtifactPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/CompletionChip.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// Mock lucide-react Download icon
vi.mock('lucide-react', () => ({
  Download: (props: Record<string, unknown>) => (
    <svg data-testid="download-icon" {...props} />
  ),
}));

// ============================================================================
// ArtifactPreviewBubble Tests
// ============================================================================

describe('Hub Bootstrap 1: ArtifactPreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 1: Renders markdown content as HTML (heading detection)
  // --------------------------------------------------------------------------
  it('renders markdown content as HTML with heading detection (# Heading renders as bold/large text)', () => {
    const markdownContent = '# Product Mission\n\nWe build great software.\n\n## Goals\n\n- Goal one\n- Goal two';
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArtifactPreviewBubble
        markdownContent={markdownContent}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    const container = screen.getByTestId('artifact-preview-bubble');
    expect(container).toBeInTheDocument();

    // Check that the heading is rendered as an h1 element
    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('Product Mission');

    // Check that h2 is rendered
    const h2 = container.querySelector('h2');
    expect(h2).not.toBeNull();
    expect(h2!.textContent).toBe('Goals');

    // Check that list items are rendered
    const listItems = container.querySelectorAll('li');
    expect(listItems.length).toBe(2);
    expect(listItems[0].textContent).toBe('Goal one');
    expect(listItems[1].textContent).toBe('Goal two');
  });

  // --------------------------------------------------------------------------
  // Test 2: Renders Confirm and Reject buttons; Confirm shows "Saving..." when isConfirming
  // --------------------------------------------------------------------------
  it('renders Confirm and Reject buttons; Confirm button shows "Saving..." when isConfirming is true', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    // First render: not confirming
    const { rerender } = render(
      <ArtifactPreviewBubble
        markdownContent="# Test"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    // Both buttons should be present
    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    expect(confirmButton).toBeInTheDocument();
    expect(rejectButton).toBeInTheDocument();
    expect(confirmButton.textContent).toBe('Confirm');

    // Re-render with isConfirming = true
    rerender(
      <ArtifactPreviewBubble
        markdownContent="# Test"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={true}
        disabled={false}
      />
    );

    // Confirm button should now show "Saving..."
    const savingButton = screen.getByRole('button', { name: 'Saving...' });
    expect(savingButton).toBeInTheDocument();
    expect(savingButton.textContent).toBe('Saving...');
  });

  // --------------------------------------------------------------------------
  // Test 3: Calls onConfirm when Confirm is clicked
  // --------------------------------------------------------------------------
  it('calls onConfirm when Confirm button is clicked', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArtifactPreviewBubble
        markdownContent="# Test Content"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);

    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    expect(mockOnReject).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 4: Disables both buttons when disabled is true
  // --------------------------------------------------------------------------
  it('disables both buttons when disabled is true', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArtifactPreviewBubble
        markdownContent="# Test"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={true}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });

    expect(confirmButton).toBeDisabled();
    expect(rejectButton).toBeDisabled();

    // Clicking disabled buttons should not trigger callbacks
    fireEvent.click(confirmButton);
    fireEvent.click(rejectButton);

    expect(mockOnConfirm).not.toHaveBeenCalled();
    expect(mockOnReject).not.toHaveBeenCalled();
  });
});

// ============================================================================
// CompletionChip Tests
// ============================================================================

describe('Hub Bootstrap 1: CompletionChip', () => {
  // --------------------------------------------------------------------------
  // Test 5: Renders task label, artifact name, and download transcript button
  // --------------------------------------------------------------------------
  it('renders task label, artifact name, and download transcript button', () => {
    const mockOnDownload = vi.fn();

    render(
      <CompletionChip
        taskLabel="Product Definition Complete"
        personaColor="#00897B"
        artifactName="MISSION.MD"
        timestamp="2026-02-28T12:00:00.000Z"
        onDownloadTranscript={mockOnDownload}
      />
    );

    const chip = screen.getByTestId('completion-chip');
    expect(chip).toBeInTheDocument();

    // Task label should be displayed
    expect(screen.getByText('Product Definition Complete')).toBeInTheDocument();

    // Artifact name should be displayed
    expect(screen.getByText('MISSION.MD')).toBeInTheDocument();

    // Download button should be present (with the lucide Download icon)
    const downloadButton = screen.getByTestId('download-transcript-button');
    expect(downloadButton).toBeInTheDocument();

    // Persona-colored left border should be set via inline style
    // jsdom normalizes hex colors to rgb(), so use toHaveStyle which handles normalization
    expect(chip).toHaveStyle({ borderLeft: '3px solid #00897B' });
  });

  // --------------------------------------------------------------------------
  // Test 6: Calls onDownloadTranscript when the download button is clicked
  // --------------------------------------------------------------------------
  it('calls onDownloadTranscript when the download button is clicked', () => {
    const mockOnDownload = vi.fn();

    render(
      <CompletionChip
        taskLabel="Product Definition Complete"
        personaColor="#00897B"
        artifactName="MISSION.MD"
        timestamp="2026-02-28T12:00:00.000Z"
        onDownloadTranscript={mockOnDownload}
      />
    );

    const downloadButton = screen.getByTestId('download-transcript-button');
    fireEvent.click(downloadButton);

    expect(mockOnDownload).toHaveBeenCalledTimes(1);
  });
});
