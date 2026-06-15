/**
 * BacklogPreviewBubble Component
 *
 * Renders a backlog artifact preview (after /generate, before save) as a
 * formatted display with feature/story tree and Reject/Confirm buttons.
 *
 * Modeled on RoadmapPreviewBubble.
 */

import { useState, useMemo } from 'react';
import styles from './BacklogPreviewBubble.module.css';

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

interface BacklogData {
  epicId: string;
  epicTitle?: string;
  features: BacklogFeature[];
  epicPriorityUpdates?: Array<{ id: string; title: string; priority: number }>;
}

// ============================================================================
// Props Interface
// ============================================================================

export interface BacklogPreviewBubbleProps {
  /** The JSON string content to parse and preview */
  content: string;
  /** Callback when user confirms the backlog */
  onConfirm: () => void;
  /** Callback when user rejects the backlog */
  onReject: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming?: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled?: boolean;
}

// ============================================================================
// Parse Helper
// ============================================================================

function parseBacklogContent(content: string): { data: BacklogData | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.features)) {
      return { data: null, error: 'Invalid backlog structure: missing features array.' };
    }
    return { data: parsed as BacklogData, error: null };
  } catch {
    return { data: null, error: 'Failed to parse backlog JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function BacklogPreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: BacklogPreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const buttonsDisabled = disabled || isConfirming;

  const { data, error } = useMemo(() => parseBacklogContent(content), [content]);

  const featureCount = data ? data.features.length : 0;
  const storyCount = data
    ? data.features.reduce((sum, feat) => sum + (Array.isArray(feat.stories) ? feat.stories.length : 0), 0)
    : 0;

  return (
    <div className={styles.container} data-testid="backlog-preview-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Generated Backlog
        {data && (
          <span className={styles.headerCounts} data-testid="backlog-counts">
            {featureCount} feature{featureCount !== 1 ? 's' : ''}, {storyCount} stor{storyCount !== 1 ? 'ies' : 'y'}
          </span>
        )}
      </div>

      {/* Epic badge */}
      {data?.epicTitle && (
        <div className={styles.epicBadge} data-testid="backlog-epic">
          Epic: {data.epicTitle}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className={styles.errorMessage} data-testid="backlog-error">
          {error}
        </div>
      )}

      {/* Toggle button */}
      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="backlog-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {/* Summary view */}
      {data && !showJson && (
        <div className={styles.content} data-testid="backlog-summary">
          {data.features.map((feature, featIdx) => (
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

          {/* Priority updates in summary view */}
          {data.epicPriorityUpdates && data.epicPriorityUpdates.length > 0 && (
            <div className={styles.prioritySection}>
              <div className={styles.priorityLabel}>Epic Priority Updates</div>
              <ul className={styles.priorityList}>
                {data.epicPriorityUpdates.map((update, idx) => (
                  <li key={`priority-${idx}`} className={styles.priorityItem}>
                    {update.title} → Priority {update.priority}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* JSON view */}
      {data && showJson && (
        <div className={styles.rawJson} data-testid="backlog-raw-json">
          {JSON.stringify(data, null, 2)}
        </div>
      )}

      {/* Action buttons */}
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
