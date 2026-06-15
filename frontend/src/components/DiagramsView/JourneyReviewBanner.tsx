/**
 * JourneyReviewBanner.tsx
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 5: Review mode toolbar banner with navigation controls.
 *
 * Spec 2026-04-03: User Journey Diagram Edit and Save Flow
 * Task Group 4: Added "Save as Diagram" button with onSaveAsDiagram callback.
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 3: Added "Save All as PDF" button with progress indication.
 *
 * Renders in toolbar Row 1 when a journey diagram is being reviewed:
 * - "Preview" badge (matching existing temporary diagram banner styling)
 * - Journey name text
 * - "Previous" button (disabled on first journey)
 * - "Next" button (disabled on last journey)
 * - Position indicator text (e.g., "2 of 5")
 * - "Back to List" button (hidden if only one journey in session)
 * - "Save as Diagram" button (primary action, blue)
 * - "Save All as PDF" button (outlined, with inline progress)
 * - "Close Review" button
 */

import React from 'react';
import type { UserJourneyDiagramJourneyDto } from '../../types/userJourneyDiagram';

// ============================================================================
// Props Interface
// ============================================================================

export interface JourneyReviewBannerProps {
  /** The journey metadata for the currently selected journey */
  journey: UserJourneyDiagramJourneyDto;
  /** 0-based index of the currently selected journey */
  selectedIndex: number;
  /** Total number of journeys in the review session */
  totalJourneys: number;
  /** Callback to navigate to the previous journey */
  onPrevious: () => void;
  /** Callback to navigate to the next journey */
  onNext: () => void;
  /** Callback to return to the journey chooser list */
  onReturnToChooser: () => void;
  /** Callback to close the review session entirely */
  onCloseReview: () => void;
  /** Callback to save the current journey as a persistent diagram */
  onSaveAsDiagram?: () => void;
  /** Callback to save all unsaved diagrams at once and close the review */
  onSaveAllAsDiagrams?: () => void;
  /** Whether this journey has already been saved */
  isSaved?: boolean;
  /** Whether all diagrams have already been saved */
  allSaved?: boolean;
  /** Callback to export all saved diagrams as a PDF document */
  onSaveAllAsPdf?: () => void;
  /** Progress state for PDF generation; drives inline progress text and button disabled state */
  pdfProgress?: { generating: boolean; current: number; total: number };
}

// ============================================================================
// Component
// ============================================================================

export const JourneyReviewBanner: React.FC<JourneyReviewBannerProps> = ({
  journey,
  selectedIndex,
  totalJourneys,
  onPrevious,
  onNext,
  onReturnToChooser,
  onCloseReview,
  onSaveAsDiagram,
  onSaveAllAsDiagrams,
  isSaved = false,
  allSaved = false,
  onSaveAllAsPdf,
  pdfProgress,
}) => {
  const isFirst = selectedIndex === 0;
  const isLast = selectedIndex === totalJourneys - 1;
  const showBackToList = totalJourneys > 1;
  const isPdfGenerating = pdfProgress?.generating ?? false;

  return (
    <div
      data-testid="journey-review-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flex: 1,
      }}
    >
      {/* Preview badge -- matches existing temporary diagram banner styling */}
      <span
        data-testid="journey-review-preview-badge"
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

      {/* Journey name */}
      <span
        data-testid="journey-review-name"
        style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}
      >
        {journey.name}
      </span>

      {/* Navigation controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
        <button
          data-testid="journey-review-previous"
          onClick={onPrevious}
          disabled={isFirst}
          style={{
            padding: '4px 10px',
            border: '1px solid #ddd',
            background: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: isFirst ? 'default' : 'pointer',
            opacity: isFirst ? 0.5 : 1,
          }}
        >
          Previous
        </button>

        {/* Position indicator */}
        <span
          data-testid="journey-review-position"
          style={{ fontSize: '12px', color: '#666', minWidth: '50px', textAlign: 'center' }}
        >
          {selectedIndex + 1} of {totalJourneys}
        </span>

        <button
          data-testid="journey-review-next"
          onClick={onNext}
          disabled={isLast}
          style={{
            padding: '4px 10px',
            border: '1px solid #ddd',
            background: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: isLast ? 'default' : 'pointer',
            opacity: isLast ? 0.5 : 1,
          }}
        >
          Next
        </button>
      </div>

      {/* Back to List button (hidden for single-journey sessions) */}
      {showBackToList && (
        <button
          data-testid="journey-review-back-to-list"
          onClick={onReturnToChooser}
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
          Back to List
        </button>
      )}

      {/* Save as Diagram button (primary action) or Saved indicator */}
      {onSaveAsDiagram && !isSaved && (
        <button
          data-testid="journey-review-save-as-diagram"
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
      )}
      {isSaved && (
        <span
          data-testid="journey-review-saved-badge"
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

      {/* Save All as Diagrams button */}
      {onSaveAllAsDiagrams && !allSaved && (
        <button
          data-testid="journey-review-save-all"
          onClick={onSaveAllAsDiagrams}
          style={{
            padding: '6px 12px',
            border: '1px solid #1565C0',
            background: 'white',
            color: '#1565C0',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
            marginLeft: '4px',
            fontWeight: 500,
          }}
        >
          Save All as Diagrams
        </button>
      )}

      {/* Save All as PDF button */}
      {onSaveAllAsPdf && (
        <button
          data-testid="journey-review-save-all-pdf"
          onClick={onSaveAllAsPdf}
          disabled={isPdfGenerating}
          style={{
            padding: '6px 12px',
            border: '1px solid #1565C0',
            background: 'white',
            color: '#1565C0',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: isPdfGenerating ? 'default' : 'pointer',
            marginLeft: '4px',
            fontWeight: 500,
            opacity: isPdfGenerating ? 0.6 : 1,
          }}
        >
          Save All as Diagrams &amp; PDF
        </button>
      )}

      {/* PDF generation progress text */}
      {pdfProgress?.generating && (
        <span
          data-testid="pdf-progress-text"
          style={{
            fontSize: '12px',
            color: '#666',
            marginLeft: '8px',
          }}
        >
          Generating PDF... {pdfProgress.current} of {pdfProgress.total}
        </span>
      )}

      {/* Close Review button */}
      <button
        data-testid="journey-review-close"
        onClick={onCloseReview}
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
        Close Review
      </button>
    </div>
  );
};
