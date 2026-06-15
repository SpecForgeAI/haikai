/**
 * IncrementCard Component
 *
 * Spec 2026-02-11: Compact Single-Row Increment Display
 * - Redesigned from multi-line card to single-row: INC-X — Title... [Badge]
 * - Title truncates with ellipsis when too long
 * - Reduced padding and font sizes for vertical compactness
 *
 * Spec 2026-03-15: Right-click context menu with "See Spec" action
 * - Right-click opens a context menu on the increment row
 * - If status is NOT_STARTED, shows disabled "Spec not ready"
 * - Otherwise shows "See Spec" which opens a modal with the composed spec intent
 *
 * Badge states:
 * - NOT_STARTED: gray
 * - SPEC_READY: teal
 * - IN_CLARIFICATION: purple
 * - READY_TO_EXECUTE: blue
 * - EXECUTING: amber
 * - COMPLETED: green
 * - FAILED: red
 */

import { useState, useCallback } from 'react';
import type { Increment } from '../../api/chatApi';
import type { IncrementStatus } from './ImplementationAssistantPanel';
import { IncrementContextMenu } from './IncrementContextMenu';
import styles from './IncrementCard.module.css';

/**
 * Props interface for IncrementCard
 */
export interface IncrementCardProps {
  /** Increment data to display */
  increment: Increment;
  /** Whether this increment is currently active/selected */
  isActive: boolean;
  /** Click handler for selecting this increment */
  onClick: () => void;
  /** Increment status for pipeline execution workflow */
  status?: IncrementStatus;
  /** Callback to open the spec viewer modal for this increment */
  onSeeSpec?: (incrementId: string) => void;
  /** Callback to mark this increment as complete */
  onMarkComplete?: (incrementId: string) => void;
}

/**
 * Maps IncrementStatus to badge text and CSS class.
 */
function getBadgeConfig(status: IncrementStatus | undefined): {
  text: string;
  className: string;
} {
  switch (status) {
    case 'NOT_STARTED':
      return {
        text: 'Not Started',
        className: `${styles.statusBadge} ${styles.statusNotStarted}`,
      };
    case 'SPEC_READY':
      return {
        text: 'Spec Ready',
        className: `${styles.statusBadge} ${styles.statusSpecReady}`,
      };
    case 'IN_CLARIFICATION':
      return {
        text: 'In Clarification',
        className: `${styles.statusBadge} ${styles.statusInClarification}`,
      };
    case 'READY_TO_EXECUTE':
      return {
        text: 'Ready',
        className: `${styles.statusBadge} ${styles.statusReadyToExecute}`,
      };
    case 'EXECUTING':
      return {
        text: 'Executing',
        className: `${styles.statusBadge} ${styles.statusExecuting}`,
      };
    case 'COMPLETED':
      return {
        text: 'Completed',
        className: `${styles.statusBadge} ${styles.statusCompleted}`,
      };
    case 'FAILED':
      return {
        text: 'Failed',
        className: `${styles.statusBadge} ${styles.statusFailed}`,
      };
    default:
      return {
        text: 'Not Started',
        className: `${styles.statusBadge} ${styles.statusNotStarted}`,
      };
  }
}

/**
 * IncrementCard Component
 *
 * Renders a compact single-row for an increment in the implementation plan.
 * Layout: INC-X — Title (truncated)... [Status Badge]
 * Right-click opens a context menu with "See Spec" action.
 */
export function IncrementCard({
  increment,
  isActive,
  onClick,
  status,
  onSeeSpec,
  onMarkComplete,
}: IncrementCardProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const rowClassName = isActive
    ? `${styles.row} ${styles.rowActive}`
    : styles.row;

  const badgeConfig = getBadgeConfig(status);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleSeeSpec = useCallback(() => {
    onSeeSpec?.(increment.id);
  }, [onSeeSpec, increment.id]);

  const handleMarkComplete = useCallback(() => {
    onMarkComplete?.(increment.id);
  }, [onMarkComplete, increment.id]);

  return (
    <>
      <div
        className={rowClassName}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        data-testid="increment-card"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <span className={styles.rowId}>{increment.id}</span>
        <span className={styles.rowSeparator}>—</span>
        <span className={styles.rowTitle}>{increment.title}</span>
        <span
          className={badgeConfig.className}
          data-testid="increment-status-badge"
        >
          {badgeConfig.text}
        </span>
      </div>
      <IncrementContextMenu
        isOpen={contextMenu !== null}
        position={contextMenu ?? { x: 0, y: 0 }}
        status={status}
        onClose={handleCloseContextMenu}
        onSeeSpec={handleSeeSpec}
        onMarkComplete={handleMarkComplete}
      />
    </>
  );
}
