/**
 * ImplementationPlanSection Component
 *
 * Spec 2026-02-11: Collapsible Implementation Plan Zone
 * - User-collapsible header bar with chevron toggle
 * - Collapsed by default (~28px bar), auto-expands when increments arrive
 * - Compact increment rows via IncrementCard
 * - Removed Start Implementation button (handled elsewhere)
 */

import type { ImplementationPlan } from '../../api/chatApi';
import type { IncrementStatus } from './ImplementationAssistantPanel';
import { IncrementCard } from './IncrementCard';
import styles from './ImplementationPlanSection.module.css';

/**
 * Props interface for ImplementationPlanSection
 */
export interface ImplementationPlanSectionProps {
  /** Implementation plan to display (null = no plan yet) */
  implementationPlan: ImplementationPlan | null;
  /** Currently active/selected increment ID (null = none selected) */
  activeIncrementId: string | null;
  /** Callback when an increment is selected */
  onIncrementSelect: (incrementId: string) => void;
  /** Callback to get status for an increment */
  getIncrementStatus?: (incrementId: string) => IncrementStatus;
  /** Whether the section is collapsed */
  collapsed?: boolean;
  /** Callback when the user toggles collapse/expand */
  onToggleCollapse?: () => void;
  /** Callback to open spec viewer modal for an increment */
  onSeeSpec?: (incrementId: string) => void;
  /** Callback to mark an increment as complete */
  onMarkComplete?: (incrementId: string) => void;
}

/**
 * ImplementationPlanSection Component
 *
 * Renders a collapsible zone for the implementation plan.
 * Header bar is always visible; content (increment rows) toggles on click.
 */
export function ImplementationPlanSection({
  implementationPlan,
  activeIncrementId,
  onIncrementSelect,
  getIncrementStatus,
  collapsed = true,
  onToggleCollapse,
  onSeeSpec,
  onMarkComplete,
}: ImplementationPlanSectionProps) {
  const incrementCount = implementationPlan?.increments?.length ?? 0;

  return (
    <div className={styles.section} data-testid="implementation-plan-section">
      <div
        className={styles.header}
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse?.();
          }
        }}
        data-testid="implementation-plan-header"
      >
        <span className={`${styles.chevron} ${collapsed ? '' : styles.chevronExpanded}`}>
          &#9656;
        </span>
        <span className={styles.headerTitle}>Implementation Plan</span>
        {incrementCount > 0 && (
          <span className={styles.headerCount}>{incrementCount}</span>
        )}
      </div>

      {!collapsed && implementationPlan && (
        <div className={styles.body} data-testid="implementation-plan-body">
          <div className={styles.incrementList}>
            {implementationPlan.increments.map((increment) => (
              <IncrementCard
                key={increment.id}
                increment={increment}
                isActive={increment.id === activeIncrementId}
                onClick={() => onIncrementSelect(increment.id)}
                status={getIncrementStatus ? getIncrementStatus(increment.id) : undefined}
                onSeeSpec={onSeeSpec}
                onMarkComplete={onMarkComplete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
