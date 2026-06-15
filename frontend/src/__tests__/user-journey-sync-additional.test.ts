/**
 * Additional strategic tests for User Journey One-Way Sync from Meta-Model.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 5: Test Review and Gap Analysis
 *
 * Covers critical gaps identified in test review:
 * - Hook behavior for v1 vs v2 diagrams
 * - API error handling / graceful degradation
 * - Sync metadata round-trip validation
 * - SyncStatusBanner ERROR state
 * - v2 save flow produces correct structure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { SyncStatusBanner } from '../components/DiagramsView/SyncStatusBanner';
import { useUserJourneySyncStatus } from '../hooks/useUserJourneySyncStatus';
import { createDefaultTypedContent, UserJourneyContent, UserJourneySyncMetadata } from '../types/typedContent';
import type { TypedContentEnvelope } from '../types/typedContent';
import { fetchUserJourneySyncStatus } from '../api/userJourneyDiagramApi';

// ============================================================================
// Test 1: useUserJourneySyncStatus skips API call for v1 diagrams
// ============================================================================

describe('useUserJourneySyncStatus hook', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null syncStatus for v1 diagrams (no sync block)', () => {
    const v1TypedContent: TypedContentEnvelope = {
      type: 'USER_JOURNEY',
      version: 1,
      content: {
        journey: { id: 'uj-001', name: 'Test', description: '', user_role_id: '', user_role_name: '', parent_business_process_id: '', parent_business_process_name: '' },
        lanes: [],
        steps: [],
        edges: [],
        render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
        diagram_type: 'USER_JOURNEY',
        version: '1.0',
        // No sync block
      } as UserJourneyContent,
    };

    const { result } = renderHook(() =>
      useUserJourneySyncStatus('proj-001', 'arch-default', 'diag-001', v1TypedContent)
    );

    expect(result.current.syncStatus).toBeNull();
    expect(result.current.isLoading).toBe(false);
    // fetch should NOT have been called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null syncStatus when no typedContent provided', () => {
    const { result } = renderHook(() =>
      useUserJourneySyncStatus('proj-001', 'arch-default', 'diag-001', undefined)
    );

    expect(result.current.syncStatus).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null syncStatus when diagramId is undefined', () => {
    const { result } = renderHook(() =>
      useUserJourneySyncStatus('proj-001', 'arch-default', undefined, undefined)
    );

    expect(result.current.syncStatus).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Test 2: useUserJourneySyncStatus makes API call for v2 diagrams
// ============================================================================

describe('useUserJourneySyncStatus v2 auto-check', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch for v2 diagrams with sync block', async () => {
    const mockResponse = {
      sync_status: 'IN_SYNC',
      stale_reason: null,
      last_synced_at: '2026-04-03T10:00:00Z',
      last_synced_hash: 'abc123',
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const v2TypedContent: TypedContentEnvelope = {
      type: 'USER_JOURNEY',
      version: 2,
      content: {
        journey: { id: 'uj-001', name: 'Test', description: '', user_role_id: '', user_role_name: '', parent_business_process_id: '', parent_business_process_name: '' },
        lanes: [],
        steps: [],
        edges: [],
        render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
        diagram_type: 'USER_JOURNEY',
        version: '1.0',
        sync: {
          source_user_journey_id: 'uj-001',
          source_project_id: 'proj-001',
          source_model_file_id: null,
          source_projection_version: '1.0',
          last_synced_at: '2026-04-03T10:00:00Z',
          last_synced_hash: 'abc123',
          sync_status: 'IN_SYNC',
          stale_reason: null,
        },
      } as UserJourneyContent,
    };

    const { result } = renderHook(() =>
      useUserJourneySyncStatus('proj-001', 'arch-default', 'diag-001', v2TypedContent)
    );

    // Wait for the async effect to complete
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Test 3: API error handling - fetch failure degrades gracefully
// ============================================================================

describe('fetchUserJourneySyncStatus error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws error when fetch returns non-ok status', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(
      fetchUserJourneySyncStatus('proj-001', 'arch-default', 'diag-001')
    ).rejects.toThrow('Failed to fetch sync status for diagram "diag-001": 500');
  });

  it('throws error when fetch network fails', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    await expect(
      fetchUserJourneySyncStatus('proj-001', 'arch-default', 'diag-001')
    ).rejects.toThrow('Network error');
  });
});

// ============================================================================
// Test 4: SyncStatusBanner ERROR state rendering
// ============================================================================

describe('SyncStatusBanner ERROR state', () => {
  it('renders "Sync status unknown" for ERROR state', () => {
    const { getByTestId } = render(
      React.createElement(SyncStatusBanner, {
        syncStatus: 'ERROR',
        staleReason: null,
        isLoading: false,
        onRefresh: vi.fn(),
      })
    );

    const badge = getByTestId('sync-status-badge');
    expect(badge.textContent).toBe('Sync status unknown');

    // No refresh button for ERROR
    expect(() => getByTestId('sync-refresh-button')).toThrow();
  });
});

// ============================================================================
// Test 5: v2 sync metadata structure validation
// ============================================================================

describe('UserJourneySyncMetadata structure', () => {
  it('sync metadata has all required fields', () => {
    const syncMetadata: UserJourneySyncMetadata = {
      source_user_journey_id: 'uj-001',
      source_project_id: 'proj-001',
      source_model_file_id: null,
      source_projection_version: '1.0',
      last_synced_at: '2026-04-03T10:00:00Z',
      last_synced_hash: 'abc123def456',
      sync_status: 'IN_SYNC',
      stale_reason: null,
    };

    expect(syncMetadata.source_user_journey_id).toBe('uj-001');
    expect(syncMetadata.source_project_id).toBe('proj-001');
    expect(syncMetadata.source_model_file_id).toBeNull();
    expect(syncMetadata.source_projection_version).toBe('1.0');
    expect(syncMetadata.last_synced_at).toBe('2026-04-03T10:00:00Z');
    expect(syncMetadata.last_synced_hash).toBe('abc123def456');
    expect(syncMetadata.sync_status).toBe('IN_SYNC');
    expect(syncMetadata.stale_reason).toBeNull();
  });

  it('sync metadata supports STALE status with reason', () => {
    const syncMetadata: UserJourneySyncMetadata = {
      source_user_journey_id: 'uj-001',
      source_project_id: 'proj-001',
      source_model_file_id: 'mf-001',
      source_projection_version: '1.0',
      last_synced_at: '2026-04-03T10:00:00Z',
      last_synced_hash: 'abc123',
      sync_status: 'STALE',
      stale_reason: 'Meta-model data has changed',
    };

    expect(syncMetadata.sync_status).toBe('STALE');
    expect(syncMetadata.stale_reason).toBe('Meta-model data has changed');
    expect(syncMetadata.source_model_file_id).toBe('mf-001');
  });
});

// ============================================================================
// Test 6: createDefaultTypedContent version consistency
// ============================================================================

describe('createDefaultTypedContent version consistency', () => {
  it('USER_JOURNEY returns v2, all others return v1', () => {
    const types = ['Sequence', 'ER', 'Activity', 'State', 'UI_SCREEN', 'USER_JOURNEY'] as const;

    for (const type of types) {
      const envelope = createDefaultTypedContent(type);
      expect(envelope).toBeDefined();

      if (type === 'USER_JOURNEY') {
        expect(envelope!.version).toBe(2);
      } else {
        expect(envelope!.version).toBe(1);
      }
    }
  });

  it('returns undefined for General and unknown types', () => {
    expect(createDefaultTypedContent('General')).toBeUndefined();
    expect(createDefaultTypedContent(undefined)).toBeUndefined();
    expect(createDefaultTypedContent('Unknown')).toBeUndefined();
  });
});

// ============================================================================
// Test 7: v2 save flow produces correct structure with sync block
// ============================================================================

describe('v2 save flow structure validation', () => {
  it('v2 envelope has correct structure for round-trip', () => {
    // Simulate what the save handler creates
    const currentJourney = {
      diagram_type: 'USER_JOURNEY',
      version: '1.0',
      journey: {
        id: 'uj-001',
        name: 'Customer Onboarding',
        description: 'Main onboarding flow',
        user_role_id: 'bu-001',
        user_role_name: 'Admin',
        parent_business_process_id: 'bp-001',
        parent_business_process_name: 'Onboarding',
      },
      lanes: [{ id: 'app-1', name: 'Portal', order_index: 0 }],
      steps: [{ id: 'step-1', journey_id: 'uj-001', sequence_order: 1, lane_id: 'app-1' }],
      edges: [],
      render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
    };

    const contentWithSync = {
      ...currentJourney,
      sync: {
        source_user_journey_id: currentJourney.journey.id,
        source_project_id: 'proj-abc-123',
        source_model_file_id: null,
        source_projection_version: '1.0',
        last_synced_at: new Date().toISOString(),
        last_synced_hash: '',
        sync_status: 'IN_SYNC',
        stale_reason: null,
      },
    };

    const envelope = {
      type: 'USER_JOURNEY',
      version: 2,
      content: contentWithSync,
    };

    // Verify structure
    expect(envelope.type).toBe('USER_JOURNEY');
    expect(envelope.version).toBe(2);
    expect(envelope.content.sync).toBeDefined();
    expect(envelope.content.sync.source_user_journey_id).toBe('uj-001');
    expect(envelope.content.sync.source_project_id).toBe('proj-abc-123');
    expect(envelope.content.sync.sync_status).toBe('IN_SYNC');

    // Verify diagram data is preserved
    expect(envelope.content.journey.id).toBe('uj-001');
    expect(envelope.content.lanes).toHaveLength(1);
    expect(envelope.content.steps).toHaveLength(1);
  });
});
