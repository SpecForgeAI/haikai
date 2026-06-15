/**
 * Tests for SyncStatusBanner component and auto-check behavior.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 4: Sync Status Banner and Auto-Check
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusBanner } from '../components/DiagramsView/SyncStatusBanner';

// ============================================================================
// Test 1: Renders "In Sync" badge with green styling
// ============================================================================

describe('SyncStatusBanner', () => {
  it('renders "In Sync" badge with green styling when syncStatus is IN_SYNC', () => {
    const { getByTestId } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: 'IN_SYNC',
        staleReason: null,
        isLoading: false,
        onRefresh: vi.fn(),
      })
    );

    const banner = getByTestId('sync-status-banner');
    expect(banner).toBeDefined();

    const badge = getByTestId('sync-status-badge');
    expect(badge.textContent).toBe('In Sync');
    expect(badge.style.background).toBe('rgb(232, 245, 233)'); // #E8F5E9
    expect(badge.style.color).toBe('rgb(46, 125, 50)'); // #2E7D32

    // No refresh button for IN_SYNC
    expect(() => getByTestId('sync-refresh-button')).toThrow();
  });

  // ============================================================================
  // Test 2: Renders "Stale" badge with amber styling and shows refresh button
  // ============================================================================

  it('renders "Stale" badge with amber styling and shows "Refresh from Model" button', () => {
    const { getByTestId } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: 'STALE',
        staleReason: 'Meta-model data has changed since last sync',
        isLoading: false,
        onRefresh: vi.fn(),
      })
    );

    const badge = getByTestId('sync-status-badge');
    expect(badge.textContent).toBe('Stale');
    expect(badge.style.background).toBe('rgb(255, 243, 224)'); // #FFF3E0
    expect(badge.style.color).toBe('rgb(230, 81, 0)'); // #E65100

    const reason = getByTestId('sync-stale-reason');
    expect(reason.textContent).toBe('Meta-model data has changed since last sync');

    const refreshButton = getByTestId('sync-refresh-button');
    expect(refreshButton.textContent).toBe('Refresh from Model');
  });

  // ============================================================================
  // Test 3: Renders "Broken Source" badge with red styling
  // ============================================================================

  it('renders "Broken Source" badge with red styling when syncStatus is BROKEN_SOURCE', () => {
    const { getByTestId } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: 'BROKEN_SOURCE',
        staleReason: null,
        isLoading: false,
        onRefresh: vi.fn(),
      })
    );

    const badge = getByTestId('sync-status-badge');
    expect(badge.textContent).toBe('Broken Source');
    expect(badge.style.background).toBe('rgb(255, 235, 238)'); // #FFEBEE
    expect(badge.style.color).toBe('rgb(198, 40, 40)'); // #C62828

    // No refresh button for BROKEN_SOURCE
    expect(() => getByTestId('sync-refresh-button')).toThrow();

    // Shows broken reason text
    const brokenReason = getByTestId('sync-broken-reason');
    expect(brokenReason.textContent).toBe('Source journey unavailable');
  });

  // ============================================================================
  // Test 4: Renders loading state when isLoading is true
  // ============================================================================

  it('renders loading indicator when isLoading is true', () => {
    const { getByTestId } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: 'LOADING',
        staleReason: null,
        isLoading: true,
        onRefresh: vi.fn(),
      })
    );

    const banner = getByTestId('sync-status-banner');
    expect(banner).toBeDefined();

    const loading = getByTestId('sync-status-loading');
    expect(loading.textContent).toBe('Checking sync status...');
  });

  // ============================================================================
  // Test 5: Not rendered for v1 diagrams (null syncStatus)
  // ============================================================================

  it('is not rendered when syncStatus is null (v1 diagram)', () => {
    const { container } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: null,
        staleReason: null,
        isLoading: false,
        onRefresh: vi.fn(),
      })
    );

    // Should render nothing
    expect(container.innerHTML).toBe('');
  });

  // ============================================================================
  // Test 6: "Refresh from Model" button click calls onRefresh callback
  // ============================================================================

  it('"Refresh from Model" button click calls onRefresh callback', () => {
    const onRefresh = vi.fn();

    const { getByTestId } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: 'STALE',
        staleReason: 'Data changed',
        isLoading: false,
        onRefresh,
      })
    );

    const refreshButton = getByTestId('sync-refresh-button');
    fireEvent.click(refreshButton);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
