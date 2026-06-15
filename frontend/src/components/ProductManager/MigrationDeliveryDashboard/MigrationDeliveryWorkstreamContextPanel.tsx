/**
 * MigrationDeliveryWorkstreamContextPanel
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.3
 *
 * Expandable "Workstream context" section rendered above the hierarchy tree
 * on the migration delivery dashboard. Surfaces the deduped API baselines
 * and architecture refs that were aggregated across all stories in the
 * most recent batch, with `referencedByStoryIds[]` per item so the user
 * sees which stories would otherwise have repeated each ref.
 *
 * Per the task-group implementation note: we show workstream context only
 * AFTER a batch has completed, reading the most recent batch's
 * `workstreamContext` block (passed in as a prop). This avoids the
 * complexity of a separate preview call to the AMS context endpoint.
 *
 * Stateless / presentational; the parent dashboard owns the data and the
 * collapsed/expanded state if it chooses to lift that up.
 */

import React, { useState } from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types
// ============================================================================

/**
 * Shape of one deduped reference. Mirrors the AMS
 * `MigrationSpecContextDto.DedupedRef` record (camelCase at this layer).
 */
export interface DedupedWorkstreamRef {
  id: string;
  kind: string | null;
  label: string | null;
  referencedByStoryIds: string[];
}

/**
 * Shape of the workstream-context block as it surfaces on the dashboard
 * after a batch has completed. Lifted from AMS
 * `MigrationSpecContextDto.WorkstreamContext`.
 */
export interface MigrationDeliveryWorkstreamContext {
  apiBaselines: DedupedWorkstreamRef[];
  architectureRefs: DedupedWorkstreamRef[];
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryWorkstreamContextPanelProps {
  /**
   * Workstream context derived from the most recent completed batch. When
   * null/undefined, the panel renders an empty-state hint inviting the
   * user to run a batch.
   */
  workstreamContext?: MigrationDeliveryWorkstreamContext | null;
  /**
   * Optional: start collapsed (default true so the section does not push
   * the hierarchy tree off-screen on first load).
   */
  defaultCollapsed?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryWorkstreamContextPanel: React.FC<
  MigrationDeliveryWorkstreamContextPanelProps
> = ({ workstreamContext, defaultCollapsed = true }) => {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  const apiBaselines = workstreamContext?.apiBaselines ?? [];
  const architectureRefs = workstreamContext?.architectureRefs ?? [];
  const itemCount = apiBaselines.length + architectureRefs.length;

  return (
    <section
      className={styles.workstreamContextSection}
      data-testid="mdd-workstream-context-section"
    >
      <header className={styles.workstreamContextHeader}>
        <h2 className={styles.sectionTitle}>
          Workstream context ({itemCount})
        </h2>
        <button
          type="button"
          className={styles.headerNavLink}
          data-testid="mdd-workstream-context-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </header>

      {!collapsed && (
        <div data-testid="mdd-workstream-context-body">
          {itemCount === 0 ? (
            <p
              className={styles.emptyPanel}
              data-testid="mdd-workstream-context-empty"
            >
              No workstream-deduped references captured yet. Run a batch with
              pass 2 enabled to populate this section.
            </p>
          ) : (
            <>
              {apiBaselines.length > 0 && (
                <div
                  className={styles.workstreamContextGroup}
                  data-testid="mdd-workstream-context-api-baselines"
                >
                  <h3 className={styles.workstreamContextGroupTitle}>
                    API baselines ({apiBaselines.length})
                  </h3>
                  <ul className={styles.workstreamContextList}>
                    {apiBaselines.map((ref) => (
                      <li
                        key={ref.id}
                        className={styles.workstreamContextItem}
                        data-testid={`mdd-workstream-context-api-baseline-${ref.id}`}
                      >
                        <span className={styles.workstreamContextItemLabel}>
                          {ref.label ?? ref.id}
                        </span>
                        <span
                          className={styles.workstreamContextItemRefs}
                          data-testid={`mdd-workstream-context-api-baseline-${ref.id}-refs`}
                        >
                          Referenced by {ref.referencedByStoryIds.length} story
                          {ref.referencedByStoryIds.length === 1 ? '' : 's'}
                          {ref.referencedByStoryIds.length > 0
                            ? `: ${ref.referencedByStoryIds.slice(0, 3).join(', ')}`
                            : ''}
                          {ref.referencedByStoryIds.length > 3
                            ? `, +${ref.referencedByStoryIds.length - 3} more`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {architectureRefs.length > 0 && (
                <div
                  className={styles.workstreamContextGroup}
                  data-testid="mdd-workstream-context-architecture-refs"
                >
                  <h3 className={styles.workstreamContextGroupTitle}>
                    Architecture refs ({architectureRefs.length})
                  </h3>
                  <ul className={styles.workstreamContextList}>
                    {architectureRefs.map((ref) => (
                      <li
                        key={ref.id}
                        className={styles.workstreamContextItem}
                        data-testid={`mdd-workstream-context-architecture-ref-${ref.id}`}
                      >
                        <span className={styles.workstreamContextItemLabel}>
                          {ref.label ?? ref.id}
                        </span>
                        <span
                          className={styles.workstreamContextItemRefs}
                          data-testid={`mdd-workstream-context-architecture-ref-${ref.id}-refs`}
                        >
                          Referenced by {ref.referencedByStoryIds.length} story
                          {ref.referencedByStoryIds.length === 1 ? '' : 's'}
                          {ref.referencedByStoryIds.length > 0
                            ? `: ${ref.referencedByStoryIds.slice(0, 3).join(', ')}`
                            : ''}
                          {ref.referencedByStoryIds.length > 3
                            ? `, +${ref.referencedByStoryIds.length - 3} more`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryWorkstreamContextPanel;
