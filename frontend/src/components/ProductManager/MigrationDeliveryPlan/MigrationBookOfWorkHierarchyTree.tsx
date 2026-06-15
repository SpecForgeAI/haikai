/**
 * MigrationBookOfWorkHierarchyTree
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 11.
 *
 * Renders the `book_of_work_json` items in Initiative -> Epic -> Feature
 * -> Story hierarchy with per-item badges:
 *   - Confidence (high / medium / low) -- colour-coded
 *   - Readiness (4 values per spec.md) -- colour-coded
 *   - Workstream (14-value chip incl. `unknown` highlighted per Q-7)
 *   - Saved / excluded / failed state (from frontend-state `saveState`
 *     per Q-16)
 *   - Gap count (length of `missingInputs[]` or `readinessReasons[]`)
 *
 * Clicking a node calls `onSelectItem(item.id)` so the parent can open
 * the item detail drawer. Subtree expand/collapse is local state.
 */

import React, { useMemo, useState, useCallback } from 'react';
import type {
  MigrationBookOfWorkItem,
  MigrationBookOfWorkConfidence,
  MigrationBookOfWorkReadiness,
  MigrationBookOfWorkSaveState,
  MigrationBookOfWorkExpansionState,
} from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

// ============================================================================
// Helpers
// ============================================================================

function confidenceBadgeClass(c: MigrationBookOfWorkConfidence): string {
  switch (c) {
    case 'high':
      return styles.badgeConfidenceHigh;
    case 'medium':
      return styles.badgeConfidenceMedium;
    case 'low':
      return styles.badgeConfidenceLow;
    default:
      return '';
  }
}

function readinessBadgeClass(r: MigrationBookOfWorkReadiness): string {
  switch (r) {
    case 'ready_for_spec':
      return styles.badgeReadinessReady;
    case 'needs_focused_context':
      return styles.badgeReadinessNeedsContext;
    case 'needs_user_decision':
      return styles.badgeReadinessNeedsDecision;
    case 'blocked':
      return styles.badgeReadinessBlocked;
    default:
      return '';
  }
}

function gapCount(item: MigrationBookOfWorkItem): number {
  return (
    (item.missingInputs?.length ?? 0) + (item.readinessReasons?.length ?? 0)
  );
}

function saveStateBadge(
  state: MigrationBookOfWorkSaveState | undefined,
): { label: string; className: string } | null {
  if (!state || state === 'draft') return null;
  switch (state) {
    case 'saved':
      return { label: 'saved', className: styles.badgeSaved };
    case 'excluded':
      return { label: 'excluded', className: styles.badgeExcluded };
    case 'failed':
      return { label: 'failed', className: styles.badgeFailed };
    case 'selected':
      return { label: 'selected', className: styles.badge };
    default:
      return null;
  }
}

/**
 * Per-epic expansion badge (Spec 2026-06-11 Two-Phase generation, Task
 * Group 5.4). Renders one of the four expansion states; a persisted
 * `expanding` with NO live request (e.g. page reload mid-expansion, or a
 * gateway restart) is stale and labelled as such -- it presents as
 * retryable alongside `failed`.
 */
function expansionBadge(
  state: MigrationBookOfWorkExpansionState,
  stale: boolean,
): { label: string; className: string } {
  switch (state) {
    case 'not_expanded':
      return { label: 'not expanded', className: styles.badgeExpansionNotExpanded };
    case 'expanding':
      return {
        label: stale ? 'expanding (stale)' : 'expanding…',
        className: styles.badgeExpansionExpanding,
      };
    case 'expanded':
      return { label: 'expanded', className: styles.badgeExpansionExpanded };
    case 'failed':
      return { label: 'expansion failed', className: styles.badgeExpansionFailed };
    default:
      return { label: String(state), className: '' };
  }
}

/**
 * Build the parent-child adjacency from the flat item list. Item order
 * within a parent's child array is sorted by `sequenceOrder` to honour
 * the LLM's intended delivery sequence.
 */
function buildAdjacency(items: MigrationBookOfWorkItem[]): {
  roots: MigrationBookOfWorkItem[];
  childrenOf: Map<string, MigrationBookOfWorkItem[]>;
} {
  const childrenOf = new Map<string, MigrationBookOfWorkItem[]>();
  const roots: MigrationBookOfWorkItem[] = [];
  for (const item of items) {
    if (item.parentId === null || item.parentId === undefined) {
      roots.push(item);
    } else {
      const arr = childrenOf.get(item.parentId) ?? [];
      arr.push(item);
      childrenOf.set(item.parentId, arr);
    }
  }
  const sortFn = (a: MigrationBookOfWorkItem, b: MigrationBookOfWorkItem) =>
    (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0);
  roots.sort(sortFn);
  for (const arr of childrenOf.values()) arr.sort(sortFn);
  return { roots, childrenOf };
}

// ============================================================================
// Props + Component
// ============================================================================

export interface MigrationBookOfWorkHierarchyTreeProps {
  items: MigrationBookOfWorkItem[];
  selectedItemId: string | null;
  /**
   * Frontend-state save-state map keyed by item.id. Per Q-16 this lives in
   * the parent (review workspace) so the tree stays a pure presentational
   * component.
   */
  saveStateById: Record<string, MigrationBookOfWorkSaveState>;
  onSelectItem: (itemId: string) => void;
  /**
   * Per-epic phase-2 expansion state keyed by epic item id (Spec
   * 2026-06-11). Lives in the parent (review workspace) -- seeded from the
   * persisted `book_of_work_json` and updated live from expand-response
   * payloads -- so the tree stays a pure presentational component. Epics
   * absent from this map (legacy full-plan drafts) get no expansion UI.
   */
  expansionStateById?: Record<string, MigrationBookOfWorkExpansionState>;
  /**
   * Epic ids with an expand request currently in flight in THIS session.
   * A persisted `expanding` state NOT in this set is stale -> retryable.
   */
  liveExpandingEpicIds?: ReadonlySet<string>;
  /** "Expand epic" / retry action per epic row. Omit for read-only views. */
  onExpandEpic?: (epicId: string) => void;
}

export const MigrationBookOfWorkHierarchyTree: React.FC<
  MigrationBookOfWorkHierarchyTreeProps
> = ({
  items,
  selectedItemId,
  saveStateById,
  onSelectItem,
  expansionStateById,
  liveExpandingEpicIds,
  onExpandEpic,
}) => {
  const { roots, childrenOf } = useMemo(() => buildAdjacency(items), [items]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (items.length === 0) {
    return (
      <div className={styles.treeEmpty} data-testid="hierarchy-tree-empty">
        No items in this book of work.
      </div>
    );
  }

  const renderNode = (
    item: MigrationBookOfWorkItem,
  ): React.ReactElement => {
    const children = childrenOf.get(item.id) ?? [];
    const isCollapsed = collapsed.has(item.id);
    const state = saveStateById[item.id];
    const stateBadge = saveStateBadge(state);
    const expansionState =
      item.type === 'epic' ? expansionStateById?.[item.id] : undefined;
    const isLiveExpanding = liveExpandingEpicIds?.has(item.id) ?? false;
    const isStaleExpanding = expansionState === 'expanding' && !isLiveExpanding;
    const expBadge = expansionState
      ? expansionBadge(expansionState, isStaleExpanding)
      : null;
    // `expanded` is terminal (no re-expansion in this spec); `not_expanded`,
    // `failed`, and stale `expanding` are all actionable.
    const showExpandAction =
      onExpandEpic !== undefined &&
      expansionState !== undefined &&
      (expansionState === 'not_expanded' ||
        expansionState === 'failed' ||
        isStaleExpanding);
    const gaps = gapCount(item);
    const isSelected = selectedItemId === item.id;
    const rowClass = [
      styles.nodeRow,
      isSelected ? styles.nodeRowSelected : '',
      state === 'saved' ? styles.nodeRowSaved : '',
      state === 'excluded' ? styles.nodeRowExcluded : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        key={item.id}
        className={styles.treeNode}
        data-testid={`hierarchy-node-${item.id}`}
      >
        <div
          className={rowClass}
          data-testid={`hierarchy-node-row-${item.id}`}
          onClick={() => onSelectItem(item.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectItem(item.id);
            }
          }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className={styles.nodeToggle}
              onClick={(e) => {
                e.stopPropagation();
                toggle(item.id);
              }}
              data-testid={`hierarchy-node-toggle-${item.id}`}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '+' : '-'}
            </button>
          ) : (
            <span className={styles.nodeToggle} />
          )}
          <span
            className={styles.nodeType}
            data-testid={`hierarchy-node-type-${item.id}`}
          >
            {item.type}
          </span>
          <span
            className={styles.nodeTitle}
            data-testid={`hierarchy-node-title-${item.id}`}
            title={item.title}
          >
            {item.title}
          </span>
          <span className={styles.badgeRow}>
            <span
              className={`${styles.badge} ${confidenceBadgeClass(
                item.confidence,
              )}`}
              data-testid={`badge-confidence-${item.id}`}
            >
              {item.confidence}
            </span>
            <span
              className={`${styles.badge} ${readinessBadgeClass(
                item.readiness,
              )}`}
              data-testid={`badge-readiness-${item.id}`}
            >
              {item.readiness}
            </span>
            <span
              className={`${styles.badge} ${
                item.workstream === 'unknown'
                  ? styles.badgeWorkstreamUnknown
                  : ''
              }`}
              data-testid={`badge-workstream-${item.id}`}
            >
              {item.workstream}
            </span>
            {gaps > 0 && (
              <span
                className={styles.badge}
                data-testid={`badge-gap-${item.id}`}
                title="missingInputs + readinessReasons"
              >
                {gaps} gap{gaps === 1 ? '' : 's'}
              </span>
            )}
            {stateBadge && (
              <span
                className={`${styles.badge} ${stateBadge.className}`}
                data-testid={`badge-savestate-${item.id}`}
              >
                {stateBadge.label}
              </span>
            )}
            {expBadge && (
              <span
                className={`${styles.badge} ${expBadge.className}`}
                data-testid={`badge-expansion-${item.id}`}
                data-expansion-state={expansionState}
                data-stale={isStaleExpanding ? 'true' : undefined}
              >
                {expBadge.label}
              </span>
            )}
            {showExpandAction && (
              <button
                type="button"
                className={styles.expandEpicButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandEpic!(item.id);
                }}
                data-testid={`expand-epic-button-${item.id}`}
              >
                {expansionState === 'not_expanded' ? 'Expand epic' : 'Retry expansion'}
              </button>
            )}
          </span>
        </div>
        {children.length > 0 && !isCollapsed && (
          <div className={styles.treeChildren}>
            {children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.treeContainer} data-testid="hierarchy-tree">
      {roots.map(renderNode)}
    </div>
  );
};

export default MigrationBookOfWorkHierarchyTree;
