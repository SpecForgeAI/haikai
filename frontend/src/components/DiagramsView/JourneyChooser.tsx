/**
 * JourneyChooser.tsx
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 4: Journey selection list/card component.
 *
 * A lightweight inline component that lives in the diagram workspace area.
 * Displays a list/card view of generated journey diagrams and allows the
 * user to select one for review.
 *
 * Each card shows: journey name, primary user role name, parent business
 * process name, and step count.
 */

import React from 'react';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';
import type { UserJourneyOverviewDiagramDto } from '../../types/userJourneyOverviewDiagram';

// ============================================================================
// Props Interface
// ============================================================================

export interface JourneyChooserProps {
  /** The array of journey diagram DTOs to display */
  journeys: UserJourneyDiagramDto[];
  /** Callback when a journey is selected; receives the array index */
  onSelectJourney: (index: number) => void;
  /** Indices of journeys already saved as persistent diagrams */
  savedIndices?: Set<number>;
  /** Overview diagrams (one per business user role) */
  overviews?: UserJourneyOverviewDiagramDto[];
  /** Callback when an overview is selected; receives the array index */
  onSelectOverview?: (index: number) => void;
  /** Indices of overviews already saved as persistent diagrams */
  savedOverviewIndices?: Set<number>;
  /** Callback to close the review session when the user is done */
  onDone?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const JourneyChooser: React.FC<JourneyChooserProps> = ({
  journeys,
  onSelectJourney,
  savedIndices,
  overviews,
  onSelectOverview,
  savedOverviewIndices,
  onDone,
}) => {
  if (journeys.length === 0) {
    return (
      <div
        data-testid="journey-chooser-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#666',
          fontSize: '14px',
        }}
      >
        No user journey diagrams available for review.
      </div>
    );
  }

  return (
    <div
      data-testid="journey-chooser"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 24px',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <h2
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: '#333',
          marginBottom: '24px',
          marginTop: 0,
        }}
      >
        Select a User Journey to Review
      </h2>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          width: '100%',
          maxWidth: '600px',
        }}
      >
        {journeys.map((diagram, index) => {
          const isSaved = savedIndices?.has(index) ?? false;
          return (
            <button
              key={diagram.journey.id}
              data-testid={`journey-card-${index}`}
              onClick={() => onSelectJourney(index)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '16px 20px',
                border: `1px solid ${isSaved ? '#A5D6A7' : '#D0D5DD'}`,
                borderRadius: '8px',
                background: isSaved ? '#F1F8E9' : '#FFFFFF',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#1565C0';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = isSaved ? '#A5D6A7' : '#D0D5DD';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  data-testid={`journey-card-name-${index}`}
                  style={{ fontSize: '15px', fontWeight: 600, color: '#333' }}
                >
                  {diagram.journey.name}
                </span>
                {isSaved && (
                  <span
                    data-testid={`journey-card-saved-${index}`}
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#2E7D32',
                      background: '#C8E6C9',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Saved
                  </span>
                )}
              </div>
              <span
                data-testid={`journey-card-role-${index}`}
                style={{ fontSize: '13px', color: '#555' }}
              >
                User Role: {diagram.journey.user_role_name}
              </span>
              <span
                data-testid={`journey-card-process-${index}`}
                style={{ fontSize: '13px', color: '#555' }}
              >
                Business Process: {diagram.journey.parent_business_process_name}
              </span>
              <span
                data-testid={`journey-card-steps-${index}`}
                style={{ fontSize: '12px', color: '#888' }}
              >
                {diagram.steps.length} step{diagram.steps.length !== 1 ? 's' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {/* Overview diagram cards */}
      {overviews && overviews.length > 0 && onSelectOverview && (
        <>
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: '#333',
              marginBottom: '16px',
              marginTop: '32px',
            }}
          >
            Journey Overview Diagrams
          </h2>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              width: '100%',
              maxWidth: '600px',
            }}
          >
            {overviews.map((overview, index) => {
              const isSaved = savedOverviewIndices?.has(index) ?? false;
              const roleName = overview.overview?.business_user_name || 'Unknown Role';
              const nodeCount = overview.nodes?.length ?? 0;
              const edgeCount = overview.edges?.length ?? 0;
              return (
                <button
                  key={`overview-${index}`}
                  data-testid={`overview-card-${index}`}
                  onClick={() => onSelectOverview(index)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '16px 20px',
                    border: `1px solid ${isSaved ? '#A5D6A7' : '#B3E5FC'}`,
                    borderRadius: '8px',
                    background: isSaved ? '#F1F8E9' : '#E1F5FE',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#1565C0';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = isSaved ? '#A5D6A7' : '#B3E5FC';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#0277BD',
                        background: '#B3E5FC',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Overview
                    </span>
                    <span
                      data-testid={`overview-card-name-${index}`}
                      style={{ fontSize: '15px', fontWeight: 600, color: '#333' }}
                    >
                      {roleName} — Journey Overview
                    </span>
                    {isSaved && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#2E7D32',
                          background: '#C8E6C9',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        Saved
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '12px', color: '#888' }}>
                    {nodeCount} journey{nodeCount !== 1 ? 's' : ''}, {edgeCount} link{edgeCount !== 1 ? 's' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Done button */}
      {onDone && (
        <button
          data-testid="journey-chooser-done"
          onClick={onDone}
          style={{
            marginTop: '24px',
            padding: '8px 24px',
            border: '1px solid #ddd',
            background: 'white',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Done Reviewing
        </button>
      )}
    </div>
  );
};
