/**
 * PartsListSection Component
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 5: Frontend API Functions and Parts List UI
 * Task 5.4: Create PartsListSection component
 *
 * Displays a list of implementation parts with status indicators.
 * Renders in FeatureDefinitionPanel after Implementation Plan section when isSplit=true.
 *
 * Features:
 * - Vertical stack of part cards with index badge, title, and status chip
 * - Status chip colors: PENDING (gray), QA_IN_PROGRESS (blue), READY_TO_RUN (green),
 *   ORCHESTRATING (amber), COMPLETED (green with check), FAILED (red)
 * - Active part highlighted with left border accent
 * - Click handler for part selection
 * - Manual intervention buttons ("Retry orchestration", "Resume Q&A") for FAILED parts
 */

import type { Part, PartStatus } from '../../types/part';
import styles from './PartsListSection.module.css';

/**
 * Props interface for PartsListSection
 */
export interface PartsListSectionProps {
  /** Array of parts to display */
  parts: Part[];
  /** Map of part index to status */
  partStatuses: Map<number, PartStatus>;
  /** Currently active/selected part index (null = none selected) */
  activePartIndex: number | null;
  /** Callback when a part is clicked */
  onPartClick: (partIndex: number) => void;
  /** Callback when "Retry orchestration" button is clicked for a FAILED part */
  onRetryOrchestration?: (partIndex: number) => void;
  /** Callback when "Resume Q&A" button is clicked for a FAILED part */
  onResumeQA?: (partIndex: number) => void;
}

/**
 * Maps PartStatus to display text and CSS class.
 * Spec 2026-02-06: Task 5.5 - Implement part card styling with status chip colors
 */
function getStatusChipConfig(status: PartStatus | undefined): {
  text: string;
  className: string;
} {
  switch (status) {
    case 'PENDING':
      return {
        text: 'Pending',
        className: `${styles.statusChip} ${styles.statusPending}`,
      };
    case 'QA_IN_PROGRESS':
      return {
        text: 'Q&A In Progress',
        className: `${styles.statusChip} ${styles.statusQaInProgress}`,
      };
    case 'READY_TO_RUN':
      return {
        text: 'Ready to Run',
        className: `${styles.statusChip} ${styles.statusReadyToRun}`,
      };
    case 'ORCHESTRATING':
      return {
        text: 'Orchestrating...',
        className: `${styles.statusChip} ${styles.statusOrchestrating}`,
      };
    case 'COMPLETED':
      return {
        text: 'Completed',
        className: `${styles.statusChip} ${styles.statusCompleted}`,
      };
    case 'FAILED':
      return {
        text: 'Failed',
        className: `${styles.statusChip} ${styles.statusFailed}`,
      };
    default:
      // Fallback for undefined status - treat as PENDING
      return {
        text: 'Pending',
        className: `${styles.statusChip} ${styles.statusPending}`,
      };
  }
}

/**
 * PartsListSection Component
 *
 * Renders the Parts List section within the Feature Definition panel.
 * Returns null when no parts exist, making visibility automatic.
 *
 * Layout:
 * - Section title: "Implementation Parts"
 * - Vertical list of PartCards with consistent spacing
 * - Manual intervention buttons for FAILED parts
 */
export function PartsListSection({
  parts,
  partStatuses,
  activePartIndex,
  onPartClick,
  onRetryOrchestration,
  onResumeQA,
}: PartsListSectionProps) {
  // Return null when no parts exist (hidden state)
  if (!parts || parts.length === 0) {
    return null;
  }

  return (
    <div className={styles.section} data-testid="parts-list-section">
      <h3 className={styles.sectionTitle}>Implementation Parts</h3>
      <p className={styles.subtitle}>{parts.length} parts to implement sequentially</p>
      <div className={styles.partsList}>
        {parts.map((part) => {
          const isActive = part.partIndex === activePartIndex;
          const status = partStatuses.get(part.partIndex);
          const chipConfig = getStatusChipConfig(status);
          const cardClassName = isActive
            ? `${styles.partCard} ${styles.partCardActive}`
            : styles.partCard;
          const isFailed = status === 'FAILED';

          return (
            <div
              key={part.partIndex}
              className={cardClassName}
              onClick={() => onPartClick(part.partIndex)}
              data-testid={`part-card-${part.partIndex}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPartClick(part.partIndex);
                }
              }}
            >
              <div className={styles.cardHeader}>
                <span className={styles.partIndex}>Part {part.partIndex}</span>
                <span
                  className={chipConfig.className}
                  data-testid={`part-status-chip-${part.partIndex}`}
                >
                  {chipConfig.text}
                </span>
              </div>
              <h4 className={styles.partTitle}>{part.title}</h4>

              {/* Manual intervention buttons for FAILED parts */}
              {isFailed && (
                <div className={styles.interventionButtons}>
                  {onRetryOrchestration && (
                    <button
                      className={styles.retryButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRetryOrchestration(part.partIndex);
                      }}
                      data-testid={`retry-orchestration-${part.partIndex}`}
                    >
                      Retry orchestration
                    </button>
                  )}
                  {onResumeQA && (
                    <button
                      className={styles.resumeButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onResumeQA(part.partIndex);
                      }}
                      data-testid={`resume-qa-${part.partIndex}`}
                    >
                      Resume Q&A
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
