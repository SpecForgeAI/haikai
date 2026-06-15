/**
 * OverviewReviewBanner.tsx
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 5, Task 5.4: Review mode toolbar banner for overview diagrams.
 *
 * Renders in toolbar Row 1 when an overview diagram is being reviewed:
 * - "Preview" badge (matching existing temporary diagram banner styling)
 * - "[Business User Name] Journey Overview" title
 * - Compact summary text (e.g., "12 journeys across 4 business processes")
 * - "Save as Diagram" button (primary action, blue)
 * - "Discard" button
 *
 * Follows styling from JourneyReviewBanner.tsx.
 * Omits Previous/Next/Back to List navigation controls (single diagram, not multi).
 */

import React from 'react';
import type { UserJourneyOverviewDiagramDto } from '../../types/userJourneyOverviewDiagram';

// ============================================================================
// Props Interface
// ============================================================================

export interface OverviewReviewBannerProps {
  /** The overview diagram DTO being reviewed */
  overviewDiagram: UserJourneyOverviewDiagramDto;
  /** Whether the overview has already been saved */
  isSaved: boolean;
  /** Callback to save the overview as a persistent diagram */
  onSaveAsDiagram: () => void;
  /** Callback to discard the review and restore the previous view */
  onDiscard: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const OverviewReviewBanner: React.FC<OverviewReviewBannerProps> = ({
  overviewDiagram,
  isSaved,
  onSaveAsDiagram,
  onDiscard,
}) => {
  // Compute summary text from DTO
  const journeyCount = overviewDiagram.nodes.length;
  const bpCount = overviewDiagram.lanes.length;
  const summaryText = `${journeyCount} journey${journeyCount !== 1 ? 's' : ''} across ${bpCount} business process${bpCount !== 1 ? 'es' : ''}`;

  // Title from overview header
  const title = overviewDiagram.overview?.title || 'Journey Overview';

  return (
    <div
      data-testid="overview-review-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flex: 1,
      }}
    >
      {/* Preview badge -- matches existing temporary diagram banner styling */}
      <span
        data-testid="overview-review-preview-badge"
        style={{
          background: '#E3F2FD',
          color: '#1565C0',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
        }}
      >
        Preview
      </span>

      {/* Overview title */}
      <span
        data-testid="overview-review-title"
        style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}
      >
        {title}
      </span>

      {/* Compact summary */}
      <span
        data-testid="overview-review-summary"
        style={{ fontSize: '12px', color: '#666' }}
      >
        {summaryText}
      </span>

      {/* Save as Diagram button or Saved indicator */}
      {!isSaved ? (
        <button
          data-testid="overview-review-save-as-diagram"
          onClick={onSaveAsDiagram}
          style={{
            padding: '6px 12px',
            border: 'none',
            background: '#1565C0',
            color: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
            marginLeft: '4px',
            fontWeight: 500,
          }}
        >
          Save as Diagram
        </button>
      ) : (
        <span
          data-testid="overview-review-saved-badge"
          style={{
            padding: '4px 10px',
            background: '#C8E6C9',
            color: '#2E7D32',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 600,
            marginLeft: '4px',
          }}
        >
          Saved
        </span>
      )}

      {/* Discard / Close button */}
      <button
        data-testid="overview-review-discard"
        onClick={onDiscard}
        style={{
          padding: '6px 12px',
          border: '1px solid #ddd',
          background: 'white',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
          marginLeft: '4px',
        }}
      >
        Discard
      </button>
    </div>
  );
};
