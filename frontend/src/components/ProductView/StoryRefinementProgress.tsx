/**
 * StoryRefinementProgress Component
 *
 * Displays a progress bar and label for multi-story refinement cycling.
 * Shows "Refining story N of M", "Holistic test review...", or "All stories refined".
 * Renders above the ImplementationAssistantPanel when multi-story cycling is active.
 */

import type { RefinementProgress } from '../../types/featureRefinement';
import styles from './StoryRefinementProgress.module.css';

interface StoryRefinementProgressProps {
  progress: RefinementProgress;
  /** Title of the current work item being processed */
  currentItemTitle?: string;
}

export function StoryRefinementProgress({ progress, currentItemTitle }: StoryRefinementProgressProps) {
  const { current, total, phase, label } = progress;

  if (phase === 'idle') return null;

  // Calculate percentage proportionally. On complete/holistic, 100%.
  let percentage = 0;
  if (phase === 'story_refine' && total > 0) {
    percentage = (current / total) * 100;
  } else if (phase === 'holistic_review' || phase === 'complete') {
    percentage = 100;
  }

  return (
    <div className={styles.container} data-testid="story-refinement-progress">
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {currentItemTitle && phase !== 'complete' && (
          <span className={styles.itemTitle}>{currentItemTitle}</span>
        )}
      </div>
      <div className={styles.trackContainer}>
        <div className={styles.track}>
          <div
            className={`${styles.fill} ${phase === 'complete' ? styles.fillComplete : ''}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {total > 0 && (
          <span className={styles.count}>
            {phase === 'complete' ? `${total}/${total}` : `${current}/${total}`}
          </span>
        )}
      </div>
    </div>
  );
}
