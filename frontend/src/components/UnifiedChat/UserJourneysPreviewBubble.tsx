/**
 * UserJourneysPreviewBubble Component
 *
 * Renders a bordered container with a header label "Generated User Journeys"
 * and subtitle showing entity counts (journeys, activity steps).
 * Parses JSON content into user journeys & activity steps shape.
 *
 * Features:
 * - Readable summary view: expandable/collapsible sections for journeys and steps
 * - "Show JSON" toggle to switch between readable and raw JSON view
 * - Confirm/Reject action buttons (same pattern as other preview bubbles)
 * - Graceful error handling for malformed JSON
 */

import { useState, useMemo } from 'react';
import styles from './ArchitecturePreviewBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface UserJourneyEntry {
  name: string;
  description?: string;
  primary_business_user_name?: string;
  parent_business_process_name?: string;
  [key: string]: unknown;
}

interface ActivityStepEntry {
  user_journey_name: string;
  process_activity_name: string;
  business_user_name: string;
  application_name: string;
  sequence_order?: number;
  description?: string;
  [key: string]: unknown;
}

interface UserJourneyLinkEntry {
  source_user_journey_name: string;
  target_user_journey_name: string;
  relationship_type?: string;
  relationship_label?: string;
  relationship_description?: string;
  [key: string]: unknown;
}

interface UserJourneysData {
  user_journeys: UserJourneyEntry[];
  activity_steps: ActivityStepEntry[];
  user_journey_links: UserJourneyLinkEntry[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface UserJourneysPreviewBubbleProps {
  content: string;
  onConfirm: () => void;
  onReject: () => void;
  isConfirming?: boolean;
  disabled?: boolean;
}

// ============================================================================
// Parse Helper
// ============================================================================

function parseContent(content: string): { data: UserJourneysData | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { data: null, error: 'Invalid user journeys structure: expected a JSON object.' };
    }
    const data: UserJourneysData = {
      user_journeys: Array.isArray(parsed.user_journeys) ? parsed.user_journeys : [],
      activity_steps: Array.isArray(parsed.activity_steps) ? parsed.activity_steps : [],
      user_journey_links: Array.isArray(parsed.user_journey_links) ? parsed.user_journey_links : [],
    };
    return { data, error: null };
  } catch {
    return { data: null, error: 'Failed to parse user journeys JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function UserJourneysPreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: UserJourneysPreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const buttonsDisabled = disabled || isConfirming;

  const { data, error } = useMemo(() => parseContent(content), [content]);

  const journeyCount = data ? data.user_journeys.length : 0;
  const stepCount = data ? data.activity_steps.length : 0;
  const linkCount = data ? data.user_journey_links.length : 0;

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Group activity steps by journey name for the summary view
  const stepsByJourney = useMemo(() => {
    if (!data) return new Map<string, ActivityStepEntry[]>();
    const map = new Map<string, ActivityStepEntry[]>();
    for (const step of data.activity_steps) {
      const key = step.user_journey_name || '(unassigned)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(step);
    }
    // Sort steps within each journey by sequence_order
    for (const steps of map.values()) {
      steps.sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999));
    }
    return map;
  }, [data]);

  return (
    <div className={styles.container} data-testid="user-journeys-preview-bubble">
      <div className={styles.header}>
        Generated User Journeys
        {data && (
          <span className={styles.headerCounts} data-testid="user-journeys-counts">
            {journeyCount} journey{journeyCount !== 1 ? 's' : ''}, {stepCount} step{stepCount !== 1 ? 's' : ''}{linkCount > 0 ? `, ${linkCount} link${linkCount !== 1 ? 's' : ''}` : ''}
          </span>
        )}
      </div>

      {error && (
        <div className={styles.errorMessage} data-testid="user-journeys-error">
          {error}
        </div>
      )}

      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="user-journeys-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {data && !showJson && (
        <div data-testid="user-journeys-summary">
          {data.user_journeys.map((journey, idx) => {
            const sectionKey = `journey-${idx}`;
            const isExpanded = expandedSections.has(sectionKey);
            const journeySteps = stepsByJourney.get(journey.name) || [];
            return (
              <div key={sectionKey} data-testid={`user-journeys-section-${idx}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(sectionKey)}
                  data-testid={`user-journeys-section-header-${idx}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  {journey.name || '(unnamed)'}
                  <span className={styles.sectionCount}>({journeySteps.length} step{journeySteps.length !== 1 ? 's' : ''})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`user-journeys-section-content-${idx}`}>
                    {journey.description && (
                      <div className={styles.entityItem} style={{ fontStyle: 'italic' }}>
                        {journey.description}
                      </div>
                    )}
                    {journey.primary_business_user_name && (
                      <div className={styles.entityItem}>
                        <span className={styles.entityName}>Primary User:</span>{' '}
                        <span className={styles.entityDescription}>{journey.primary_business_user_name}</span>
                      </div>
                    )}
                    {journeySteps.length === 0 ? (
                      <div className={styles.entityItem}>No activity steps</div>
                    ) : (
                      journeySteps.map((step, stepIdx) => (
                        <div key={`step-${stepIdx}`} className={styles.entityItem}>
                          <span className={styles.entityName}>
                            {step.sequence_order ? `${step.sequence_order}. ` : ''}{step.process_activity_name}
                          </span>
                          <span className={styles.entityDescription}>
                            {' '}-- {step.business_user_name} via {step.application_name}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {data.user_journeys.length === 0 && (
            <div className={styles.entityItem}>No user journeys found</div>
          )}

          {data.user_journey_links.length > 0 && (
            <>
              <div
                className={styles.sectionHeader}
                onClick={() => toggleSection('links')}
                data-testid="user-journey-links-section-header"
              >
                <span className={`${styles.sectionChevron} ${expandedSections.has('links') ? styles.sectionChevronOpen : ''}`}>
                  &#9654;
                </span>
                Journey Links
                <span className={styles.sectionCount}>({linkCount} link{linkCount !== 1 ? 's' : ''})</span>
              </div>
              {expandedSections.has('links') && (
                <div className={styles.sectionContent} data-testid="user-journey-links-section-content">
                  {data.user_journey_links.map((link, linkIdx) => (
                    <div key={`link-${linkIdx}`} className={styles.entityItem}>
                      <span className={styles.entityName}>
                        {link.source_user_journey_name}
                      </span>
                      <span className={styles.entityDescription}>
                        {' '}&rarr; {link.relationship_type || 'linked'} &rarr; {link.target_user_journey_name}
                      </span>
                      {link.relationship_label && (
                        <span className={styles.entityDescription}> ({link.relationship_label})</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {data && showJson && (
        <div className={styles.rawJson} data-testid="user-journeys-raw-json">
          {JSON.stringify(data, null, 2)}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.rejectButton}
          onClick={onReject}
          disabled={buttonsDisabled}
        >
          Reject
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={onConfirm}
          disabled={buttonsDisabled}
        >
          {isConfirming ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
