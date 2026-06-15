/**
 * WorkItemSearchResults Tests
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 11: Frontend tests for WorkItemSearchResults component
 *
 * Tests verify:
 * 1. Renders all results as clickable cards with correct titles
 * 2. Shows query text in header
 * 3. onSelect fires with correct ID and title on card click
 * 4. onCancel fires when Cancel button is clicked
 * 5. Shows "In scope" tag only for in-scope items
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkItemSearchResults } from '../WorkItemSearchResults';
import type { WorkItemSearchResult } from '../WorkItemSearchResults';

// ============================================================================
// Test Data
// ============================================================================

const mockResults: WorkItemSearchResult[] = [
  { id: 'feat-1', title: 'Login Page', type: 'FEATURE', status: 'IN_PROGRESS', parentTitle: 'Auth Epic', inScope: true },
  { id: 'story-1', title: 'Login Form Validation', type: 'STORY', status: 'PLANNED', parentTitle: 'Login Page', inScope: false },
  { id: 'feat-2', title: 'User Dashboard', type: 'FEATURE', status: 'ACTIVE', parentTitle: 'Dashboard Epic', inScope: true },
];

// ============================================================================
// Tests
// ============================================================================

describe('WorkItemSearchResults (Spec 2026-03-04, Task Group 11)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Renders all results as clickable cards with correct titles
  // --------------------------------------------------------------------------
  it('renders all results as clickable cards with correct titles', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(
      <WorkItemSearchResults
        results={mockResults}
        query="login"
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );

    // All 3 result cards should be present via data-testid
    const feat1Card = screen.getByTestId('work-item-result-feat-1');
    const story1Card = screen.getByTestId('work-item-result-story-1');
    const feat2Card = screen.getByTestId('work-item-result-feat-2');

    expect(feat1Card).toBeInTheDocument();
    expect(story1Card).toBeInTheDocument();
    expect(feat2Card).toBeInTheDocument();

    // Each card should contain its title text
    // (using toHaveTextContent on the card element to avoid duplicate text issues
    //  since "Login Page" appears both as feat-1's title and story-1's parentTitle)
    expect(feat1Card).toHaveTextContent('Login Page');
    expect(story1Card).toHaveTextContent('Login Form Validation');
    expect(feat2Card).toHaveTextContent('User Dashboard');
  });

  // --------------------------------------------------------------------------
  // Test 2: Shows query text in header
  // --------------------------------------------------------------------------
  it('shows query text in header', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(
      <WorkItemSearchResults
        results={mockResults}
        query="login"
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );

    // The header should include the query string
    expect(screen.getByText("Results for 'login':")).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: onSelect fires with correct ID and title
  // --------------------------------------------------------------------------
  it('onSelect fires with correct ID and title when a result card is clicked', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(
      <WorkItemSearchResults
        results={mockResults}
        query="login"
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );

    // Click the first result card
    fireEvent.click(screen.getByTestId('work-item-result-feat-1'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('feat-1', 'Login Page');
  });

  // --------------------------------------------------------------------------
  // Test 4: onCancel fires when Cancel button is clicked
  // --------------------------------------------------------------------------
  it('onCancel fires when Cancel button is clicked', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(
      <WorkItemSearchResults
        results={mockResults}
        query="login"
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );

    // Click the cancel button
    fireEvent.click(screen.getByTestId('work-item-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 5: Shows "In scope" tag for in-scope items only
  // --------------------------------------------------------------------------
  it('shows "In scope" tag for in-scope items and not for out-of-scope items', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(
      <WorkItemSearchResults
        results={mockResults}
        query="login"
        onSelect={onSelect}
        onCancel={onCancel}
      />
    );

    // In-scope items (feat-1 and feat-2) should have the "In scope" text
    const scopeTags = screen.getAllByText('In scope');
    expect(scopeTags).toHaveLength(2);

    // Verify the "In scope" tag is within the correct cards
    const feat1Card = screen.getByTestId('work-item-result-feat-1');
    const story1Card = screen.getByTestId('work-item-result-story-1');
    const feat2Card = screen.getByTestId('work-item-result-feat-2');

    // feat-1 (inScope: true) should contain "In scope"
    expect(feat1Card).toHaveTextContent('In scope');

    // story-1 (inScope: false) should NOT contain "In scope"
    expect(story1Card).not.toHaveTextContent('In scope');

    // feat-2 (inScope: true) should contain "In scope"
    expect(feat2Card).toHaveTextContent('In scope');
  });
});
