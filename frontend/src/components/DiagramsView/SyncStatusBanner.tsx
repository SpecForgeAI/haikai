/**
 * SyncStatusBanner.tsx
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 4: Sync Status Banner and Auto-Check
 *
 * Renders in toolbar Row 1 when viewing a saved USER_JOURNEY v2 diagram.
 * Shows the current sync status with appropriate badge color and text,
 * and a "Refresh from Model" button when the diagram is stale.
 *
 * Follows the structural and styling pattern from JourneyReviewBanner.tsx:
 * horizontal flex layout, colored badge, text label, action button.
 */

import React from 'react';

// ============================================================================
// Props Interface
// ============================================================================

export interface SyncStatusBannerProps {
  /** Current sync status or null if not loaded yet */
  syncStatus: 'IN_SYNC' | 'STALE' | 'BROKEN_SOURCE' | 'LOADING' | 'ERROR' | null;
  /** Reason for staleness */
  staleReason: string | null;
  /** Whether a sync check or refresh is in progress */
  isLoading: boolean;
  /** Callback to trigger refresh from model */
  onRefresh: () => void;
}

// ============================================================================
// Badge Style Mappings
// ============================================================================

const BADGE_STYLES: Record<string, { background: string; color: string; text: string }> = {
  IN_SYNC: {
    background: '#E8F5E9',
    color: '#2E7D32',
    text: 'In Sync',
  },
  STALE: {
    background: '#FFF3E0',
    color: '#E65100',
    text: 'Stale',
  },
  BROKEN_SOURCE: {
    background: '#FFEBEE',
    color: '#C62828',
    text: 'Broken Source',
  },
  ERROR: {
    background: '#F5F5F5',
    color: '#757575',
    text: 'Sync status unknown',
  },
};

// ============================================================================
// Component
// ============================================================================

export const SyncStatusBanner: React.FC<SyncStatusBannerProps> = ({
  syncStatus,
  staleReason,
  isLoading,
  onRefresh,
}) => {
  // Don't render if no status (v1 diagram or not yet checked)
  if (syncStatus === null) {
    return null;
  }

  // Loading state
  if (isLoading || syncStatus === 'LOADING') {
    return (
      <div
        data-testid="sync-status-banner"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginLeft: '12px',
        }}
      >
        <span
          data-testid="sync-status-loading"
          style={{
            fontSize: '12px',
            color: '#666',
            fontStyle: 'italic',
          }}
        >
          Checking sync status...
        </span>
      </div>
    );
  }

  const badgeStyle = BADGE_STYLES[syncStatus] || BADGE_STYLES.ERROR;

  return (
    <div
      data-testid="sync-status-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginLeft: '12px',
      }}
    >
      {/* Status badge */}
      <span
        data-testid="sync-status-badge"
        style={{
          background: badgeStyle.background,
          color: badgeStyle.color,
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.5px',
        }}
      >
        {badgeStyle.text}
      </span>

      {/* Stale reason text */}
      {syncStatus === 'STALE' && staleReason && (
        <span
          data-testid="sync-stale-reason"
          style={{
            fontSize: '12px',
            color: '#666',
          }}
        >
          {staleReason}
        </span>
      )}

      {/* Broken source description */}
      {syncStatus === 'BROKEN_SOURCE' && (
        <span
          data-testid="sync-broken-reason"
          style={{
            fontSize: '12px',
            color: '#666',
          }}
        >
          Source journey unavailable
        </span>
      )}

      {/* Refresh from Model button -- only shown for STALE */}
      {syncStatus === 'STALE' && (
        <button
          data-testid="sync-refresh-button"
          onClick={onRefresh}
          style={{
            padding: '4px 10px',
            border: '1px solid #E65100',
            background: 'white',
            color: '#E65100',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Refresh from Model
        </button>
      )}
    </div>
  );
};
