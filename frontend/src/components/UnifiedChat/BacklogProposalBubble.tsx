/**
 * BacklogProposalBubble Component
 *
 * Renders a backlog proposal (phase="ready" structuredResponse) as a formatted
 * display with feature/story cards, selected epic, assumptions, open items,
 * and 3 action buttons: Cancel | Discuss More | Confirm and Update.
 *
 * Modeled on RoadmapProposalBubble.
 */

import styles from './BacklogProposalBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface BacklogStory {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
}

interface BacklogFeature {
  title: string;
  description?: string;
  stories: BacklogStory[];
}

interface SelectedEpic {
  id: string;
  title: string;
  initiativeTitle?: string;
}

// ============================================================================
// Props Interface
// ============================================================================

export interface BacklogProposalBubbleProps {
  /** The selected epic for this backlog */
  selectedEpic: SelectedEpic;
  /** Array of proposed features with their stories */
  proposedFeatures: BacklogFeature[];
  /** Summary of the backlog proposal */
  summary?: string;
  /** Assumptions made during discovery */
  assumptions?: string[];
  /** Open items deferred during discovery */
  openItems?: string[];
  /** Epic priority updates discussed during selection */
  epicPriorityUpdates?: Array<{ id: string; title: string; priority: number }>;
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

export function BacklogProposalBubble({
  selectedEpic,
  proposedFeatures,
  summary,
  assumptions,
  openItems,
  epicPriorityUpdates,
  onConfirm,
  onDiscussMore,
  onCancel,
  isConfirming = false,
  disabled = false,
}: BacklogProposalBubbleProps) {
  const buttonsDisabled = disabled || isConfirming;

  // Count features and stories
  const featureCount = proposedFeatures.length;
  const storyCount = proposedFeatures.reduce(
    (sum, feat) => sum + (Array.isArray(feat.stories) ? feat.stories.length : 0),
    0
  );

  return (
    <div className={styles.container} data-testid="backlog-proposal-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Proposed Backlog
        <span className={styles.headerCounts} data-testid="proposal-counts">
          {featureCount} feature{featureCount !== 1 ? 's' : ''}, {storyCount} stor{storyCount !== 1 ? 'ies' : 'y'}
        </span>
      </div>

      {/* Selected epic */}
      <div className={styles.epicBadge} data-testid="proposal-epic">
        Epic: {selectedEpic.title}
        {selectedEpic.initiativeTitle && (
          <span className={styles.epicInitiative}> ({selectedEpic.initiativeTitle})</span>
        )}
      </div>

      {/* Summary paragraph */}
      {summary && (
        <div className={styles.summary} data-testid="proposal-summary">
          {summary}
        </div>
      )}

      {/* Feature/story list */}
      <div className={styles.content} data-testid="proposal-features">
        {proposedFeatures.map((feature, featIdx) => (
          <div key={`feat-${featIdx}`} className={styles.featureItem}>
            <div className={styles.featureTitle}>{feature.title}</div>
            {feature.description && (
              <div className={styles.featureDescription}>{feature.description}</div>
            )}
            {Array.isArray(feature.stories) && feature.stories.length > 0 && (
              <ul className={styles.storyList}>
                {feature.stories.map((story, storyIdx) => (
                  <li key={`story-${featIdx}-${storyIdx}`} className={styles.storyItem}>
                    <span className={styles.storyTitle}>{story.title}</span>
                    {story.description && (
                      <span className={styles.storyDescription}> - {story.description}</span>
                    )}
                    {Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0 && (
                      <ul className={styles.acList}>
                        {story.acceptanceCriteria.map((ac, acIdx) => (
                          <li key={`ac-${featIdx}-${storyIdx}-${acIdx}`} className={styles.acItem}>
                            {ac}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Epic priority updates */}
      {epicPriorityUpdates && epicPriorityUpdates.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Priority Updates</div>
          <ul className={styles.bulletList} data-testid="proposal-priority-updates">
            {epicPriorityUpdates.map((update, idx) => (
              <li key={`priority-${idx}`} className={styles.bulletItem}>
                {update.title} → Priority {update.priority}
              </li>
            ))}
          </ul>
        </>
      )}

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
