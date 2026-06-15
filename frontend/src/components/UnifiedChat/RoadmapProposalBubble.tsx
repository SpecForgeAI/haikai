/**
 * RoadmapProposalBubble Component
 *
 * Renders a roadmap proposal (phase="ready" structuredResponse) as a formatted
 * display with initiative/epic cards, assumptions, open items, and 3 action buttons:
 * Cancel | Discuss More | Confirm and Update.
 *
 * This replaces the raw JSON display that previously appeared when the LLM
 * returned a phase="ready" response.
 */

import styles from './RoadmapProposalBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface RoadmapEpic {
  title: string;
  description?: string;
}

interface RoadmapInitiative {
  title: string;
  description?: string;
  epics: RoadmapEpic[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface RoadmapProposalBubbleProps {
  /** Array of proposed initiatives with their epics */
  proposedInitiatives: RoadmapInitiative[];
  /** Summary of the roadmap proposal */
  summary?: string;
  /** Assumptions made during discovery */
  assumptions?: string[];
  /** Open items deferred during discovery */
  openItems?: string[];
  /** Callback when user confirms the proposal */
  onConfirm: () => void;
  /** Callback when user wants to continue refining */
  onDiscussMore: () => void;
  /** Callback when user cancels the proposal */
  onCancel: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming?: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function RoadmapProposalBubble({
  proposedInitiatives,
  summary,
  assumptions,
  openItems,
  onConfirm,
  onDiscussMore,
  onCancel,
  isConfirming = false,
  disabled = false,
}: RoadmapProposalBubbleProps) {
  const buttonsDisabled = disabled || isConfirming;

  // Count initiatives and epics
  const initiativeCount = proposedInitiatives.length;
  const epicCount = proposedInitiatives.reduce(
    (sum, init) => sum + (Array.isArray(init.epics) ? init.epics.length : 0),
    0
  );

  return (
    <div className={styles.container} data-testid="roadmap-proposal-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Proposed Roadmap
        <span className={styles.headerCounts} data-testid="proposal-counts">
          {initiativeCount} initiative{initiativeCount !== 1 ? 's' : ''}, {epicCount} epic{epicCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Summary paragraph */}
      {summary && (
        <div className={styles.summary} data-testid="proposal-summary">
          {summary}
        </div>
      )}

      {/* Initiative/epic list */}
      <div className={styles.content} data-testid="proposal-initiatives">
        {proposedInitiatives.map((initiative, initIdx) => (
          <div key={`init-${initIdx}`} className={styles.initiativeItem}>
            <div className={styles.initiativeTitle}>{initiative.title}</div>
            {initiative.description && (
              <div className={styles.initiativeDescription}>{initiative.description}</div>
            )}
            {Array.isArray(initiative.epics) && initiative.epics.length > 0 && (
              <ul className={styles.epicsList}>
                {initiative.epics.map((epic, epicIdx) => (
                  <li key={`epic-${initIdx}-${epicIdx}`} className={styles.epicItem}>
                    {epic.title}
                    {epic.description && (
                      <span className={styles.epicDescription}> - {epic.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Assumptions section */}
      {assumptions && assumptions.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Assumptions</div>
          <ul className={styles.bulletList} data-testid="proposal-assumptions">
            {assumptions.map((item, idx) => (
              <li key={`assumption-${idx}`} className={styles.bulletItem}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {/* Open Items section */}
      {openItems && openItems.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Open Items</div>
          <ul className={styles.bulletList} data-testid="proposal-open-items">
            {openItems.map((item, idx) => (
              <li key={`open-${idx}`} className={styles.bulletItem}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {/* Action buttons */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.outlinedButton}
          onClick={onCancel}
          disabled={buttonsDisabled}
          data-testid="proposal-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.outlinedButton}
          onClick={onDiscussMore}
          disabled={buttonsDisabled}
          data-testid="proposal-discuss-more"
        >
          Discuss More
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={onConfirm}
          disabled={buttonsDisabled}
          data-testid="proposal-confirm"
        >
          {isConfirming ? 'Saving...' : 'Confirm and Update'}
        </button>
      </div>
    </div>
  );
}
