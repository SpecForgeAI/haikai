/**
 * WorkItemDetailsPanel Component
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 3: Details panel for selected work item.
 *
 * Extended in Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 3: Added action buttons for create/edit/delete operations.
 *
 * Extended in Spec 2026-01-03: Product Implement View (Stage 5 - Increment 4)
 * Task Group 1: Added "Work on this now" button for FEATURE and STORY types.
 *
 * Extended in Spec 2026-01-04: Product Backlog Stage 4 - Roadmap Epic Anchoring
 * Task Group 5: Feature creation gating on archived epics.
 *
 * Features:
 * - Shows title, type badge, status badge
 * - Description (or dash if empty)
 * - Parent chain breadcrumb
 * - Children count
 * - Action buttons based on item type
 * - "Work on this now" button for FEATURE and STORY
 * - Disabled "+ Add Feature" button for archived epics with tooltip
 */

import type { WorkItem } from '../../types/workItems';
import styles from './WorkItemDetailsPanel.module.css';

/**
 * Get the CSS class for a work item type badge
 */
function getTypeBadgeClass(type: string): string {
  switch (type.toUpperCase()) {
    case 'INITIATIVE':
      return styles.typeInitiative;
    case 'EPIC':
      return styles.typeEpic;
    case 'FEATURE':
      return styles.typeFeature;
    case 'STORY':
      return styles.typeStory;
    case 'TEST':
      return styles.typeTest;
    default:
      return styles.typeDefault;
  }
}

/**
 * Props for WorkItemDetailsPanel component
 */
export interface WorkItemDetailsPanelProps {
  /** The selected work item (null if none selected) */
  item: WorkItem | null;
  /** Array of parent items from root to immediate parent */
  parentChain: WorkItem[];
  /** Number of direct children */
  childrenCount: number;
  /** Callback to add an epic (available when INITIATIVE is selected) */
  onAddEpic?: () => void;
  /** Callback to add a feature (available when EPIC is selected) */
  onAddFeature?: () => void;
  /** Callback to add a story (available when FEATURE is selected) */
  onAddStory?: () => void;
  /** Callback to edit the selected item (available for FEATURE and STORY) */
  onEdit?: () => void;
  /** Callback to delete the selected item (available for FEATURE and STORY) */
  onDelete?: () => void;
  /** Callback to work on this item (available for STORY and TEST) */
  onWorkOnThis?: () => void;
  /** Callback to refine a feature (PM + TE loop through stories) */
  onRefine?: () => void;
  /** Callback to refine and implement a feature (PM + TE + SD loop) */
  onRefineAndImplement?: () => void;
  /** Callback to define integration/E2E tests for a feature (standalone holistic TE review) */
  onDefineIntegrationTests?: () => void;
  /** Callback to mark this item as complete */
  onMarkComplete?: () => void;
  /** Callback to open the Tool ↔ Jira sync dialog with this item as root (Phase D) */
  onSync?: () => void;
  /** Callback to open the Link-to-Jira dialog (manually attach an external_key) */
  onLinkToJira?: () => void;
}

/**
 * Renders the parent chain as a breadcrumb
 */
function ParentChainBreadcrumb({ parentChain }: { parentChain: WorkItem[] }) {
  if (parentChain.length === 0) {
    return <span className={styles.emptyValue}>-</span>;
  }

  return (
    <div className={styles.breadcrumb} data-testid="parent-chain-breadcrumb">
      {parentChain.map((parent, index) => (
        <span key={parent.id} className={styles.breadcrumbItem}>
          <span className={styles.breadcrumbText}>{parent.title}</span>
          <span className={styles.breadcrumbType}>({parent.type})</span>
          {index < parentChain.length - 1 && (
            <span className={styles.breadcrumbSeparator}>&gt;</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Renders action buttons based on item type
 * Task Group 5: Extended to gate feature creation on archived epics
 */
function ActionButtons({
  item,
  onAddEpic,
  onAddFeature,
  onAddStory,
  onEdit,
  onDelete,
  onWorkOnThis,
  onRefine,
  onRefineAndImplement,
  onDefineIntegrationTests,
  onMarkComplete,
  onSync,
  onLinkToJira,
}: {
  item: WorkItem;
  onAddEpic?: () => void;
  onAddFeature?: () => void;
  onAddStory?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onWorkOnThis?: () => void;
  onRefine?: () => void;
  onRefineAndImplement?: () => void;
  onDefineIntegrationTests?: () => void;
  onMarkComplete?: () => void;
  onSync?: () => void;
  onLinkToJira?: () => void;
}) {
  const itemType = item.type.toUpperCase();
  const isArchived = item.status === 'ARCHIVED';

  // INITIATIVE: show + Add Epic button and Delete button
  if (itemType === 'INITIATIVE') {
    if (!onAddEpic && !onDelete && !onSync && !onLinkToJira) return null;
    const isInitiativeArchived = isArchived;
    return (
      <div className={styles.actionButtons} data-testid="action-buttons">
        {onAddEpic && (
          <div className={styles.buttonWithTooltip}>
            <button
              className={`${styles.actionButtonPrimary} ${isInitiativeArchived ? styles.actionButtonDisabled : ''}`}
              onClick={isInitiativeArchived ? undefined : onAddEpic}
              disabled={isInitiativeArchived}
              data-testid="add-epic-button"
              aria-disabled={isInitiativeArchived}
            >
              + Add Epic
            </button>
            {isInitiativeArchived && (
              <span className={styles.disabledTooltip} data-testid="add-epic-disabled-tooltip">
                Cannot add epics under an archived initiative.
              </span>
            )}
          </div>
        )}
        {onDelete && (
          <button
            className={styles.actionButtonDanger}
            onClick={onDelete}
            data-testid="delete-button"
          >
            Delete
          </button>
        )}
        {onLinkToJira && (
          <button
            className={styles.actionButtonSecondary}
            onClick={onLinkToJira}
            data-testid="link-to-jira-button"
          >
            {item.externalKey ? 'Edit Jira link' : 'Link to Jira'}
          </button>
        )}
        {onSync && (
          <button
            className={styles.actionButtonSecondary}
            onClick={onSync}
            data-testid="sync-with-jira-button"
          >
            Sync with Jira
          </button>
        )}
      </div>
    );
  }

  // Task Group 5: Determine if Add Feature button should be disabled
  const isEpicArchived = itemType === 'EPIC' && isArchived;

  return (
    <div className={styles.actionButtons} data-testid="action-buttons">
      {/* EPIC: + Add Feature - Task Group 5: disabled for archived epics */}
      {itemType === 'EPIC' && onAddFeature && (
        <div className={styles.buttonWithTooltip}>
          <button
            className={`${styles.actionButtonPrimary} ${isEpicArchived ? styles.actionButtonDisabled : ''}`}
            onClick={isEpicArchived ? undefined : onAddFeature}
            disabled={isEpicArchived}
            data-testid="add-feature-button"
            aria-disabled={isEpicArchived}
          >
            + Add Feature
          </button>
          {isEpicArchived && (
            <span className={styles.disabledTooltip} data-testid="add-feature-disabled-tooltip">
              Cannot add features under an archived epic.
            </span>
          )}
        </div>
      )}
      {itemType === 'EPIC' && onDelete && (
        <button
          className={styles.actionButtonDanger}
          onClick={onDelete}
          data-testid="delete-button"
        >
          Delete
        </button>
      )}

      {/* FEATURE: Refine, Refine and Implement, Mark As Complete, + Add Story, Edit, Delete */}
      {itemType === 'FEATURE' && (
        <>
          {onRefine && (
            <button
              className={styles.actionButtonPrimary}
              onClick={onRefine}
              data-testid="refine-button"
            >
              Refine
            </button>
          )}
          {onRefineAndImplement && (
            <button
              className={styles.actionButtonPrimary}
              onClick={onRefineAndImplement}
              data-testid="refine-and-implement-button"
            >
              Refine and Implement
            </button>
          )}
          {onDefineIntegrationTests && (
            <button
              className={styles.actionButtonSecondary}
              onClick={onDefineIntegrationTests}
              data-testid="define-integration-tests-button"
            >
              Define Integration/E2E
            </button>
          )}
          {onMarkComplete && item.status !== 'COMPLETED' && item.status !== 'DONE' && (
            <button
              className={styles.actionButtonSecondary}
              onClick={onMarkComplete}
              data-testid="mark-complete-button"
            >
              Mark As Complete
            </button>
          )}
          {onAddStory && (
            <button
              className={styles.actionButtonPrimary}
              onClick={onAddStory}
              data-testid="add-story-button"
            >
              + Add Story
            </button>
          )}
          {onEdit && (
            <button
              className={styles.actionButtonSecondary}
              onClick={onEdit}
              data-testid="edit-button"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              className={styles.actionButtonDanger}
              onClick={onDelete}
              data-testid="delete-button"
            >
              Delete
            </button>
          )}
        </>
      )}

      {/* STORY/TEST: Work on this now, Mark As Complete, Edit, Delete */}
      {(itemType === 'STORY' || itemType === 'TEST') && (
        <>
          {onWorkOnThis && (
            <button
              className={styles.actionButtonPrimary}
              onClick={onWorkOnThis}
              data-testid="work-on-this-button"
            >
              Work on this now
            </button>
          )}
          {onMarkComplete && item.status !== 'COMPLETED' && item.status !== 'DONE' && (
            <button
              className={styles.actionButtonSecondary}
              onClick={onMarkComplete}
              data-testid="mark-complete-button"
            >
              Mark As Complete
            </button>
          )}
          {onEdit && (
            <button
              className={styles.actionButtonSecondary}
              onClick={onEdit}
              data-testid="edit-button"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              className={styles.actionButtonDanger}
              onClick={onDelete}
              data-testid="delete-button"
            >
              Delete
            </button>
          )}
        </>
      )}
      {onLinkToJira && (
        <button
          className={styles.actionButtonSecondary}
          onClick={onLinkToJira}
          data-testid="link-to-jira-button"
        >
          {item.externalKey ? 'Edit Jira link' : 'Link to Jira'}
        </button>
      )}
      {onSync && (
        <button
          className={styles.actionButtonSecondary}
          onClick={onSync}
          data-testid="sync-with-jira-button"
        >
          Sync with Jira
        </button>
      )}
    </div>
  );
}

/**
 * WorkItemDetailsPanel Component
 *
 * Displays detailed information about the selected work item.
 * Shows placeholder message when no item is selected.
 */
export function WorkItemDetailsPanel({
  item,
  parentChain,
  childrenCount,
  onAddEpic,
  onAddFeature,
  onAddStory,
  onEdit,
  onDelete,
  onWorkOnThis,
  onRefine,
  onRefineAndImplement,
  onDefineIntegrationTests,
  onMarkComplete,
  onSync,
  onLinkToJira,
}: WorkItemDetailsPanelProps) {
  // Empty state
  if (!item) {
    return (
      <div className={styles.container} data-testid="details-panel">
        <div className={styles.placeholder} data-testid="details-placeholder">
          Select an item to see details.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="details-panel">
      {/* Header: Title and badges */}
      <div className={styles.header}>
        <h2 className={styles.title} data-testid="details-title">
          {item.title}
        </h2>
        <div className={styles.badgeRow}>
          <span
            className={`${styles.badge} ${getTypeBadgeClass(item.type)}`}
            data-testid="details-type-badge"
          >
            {item.type}
          </span>
          <span className={`${styles.badge} ${styles.statusBadge}`} data-testid="details-status-badge">
            {item.status}
          </span>
          {item.externalKey && item.externalUrl && (
            <a
              className={`${styles.badge} ${styles.externalBadge}`}
              href={item.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="details-external-badge"
              title={`Open ${item.externalKey} in ${item.externalSystem ?? 'external system'}`}
            >
              {item.externalKey} &#8599;
            </a>
          )}
          {item.externalKey && !item.externalUrl && (
            <span
              className={`${styles.badge} ${styles.externalBadge}`}
              data-testid="details-external-badge"
            >
              {item.externalKey}
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <ActionButtons
          item={item}
          onAddEpic={onAddEpic}
          onAddFeature={onAddFeature}
          onAddStory={onAddStory}
          onEdit={onEdit}
          onDelete={onDelete}
          onWorkOnThis={onWorkOnThis}
          onRefine={onRefine}
          onRefineAndImplement={onRefineAndImplement}
          onDefineIntegrationTests={onDefineIntegrationTests}
          onMarkComplete={onMarkComplete}
          onSync={onSync}
          onLinkToJira={onLinkToJira}
        />
      </div>

      {/* Content: Description, Parent Chain, Children */}
      <div className={styles.content}>
        {/* Description */}
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Description</span>
          <div className={styles.value} data-testid="details-description">
            {item.description ? (
              item.description
            ) : (
              <span className={styles.emptyValue}>-</span>
            )}
          </div>
        </div>

        {/* Parent Chain */}
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Parent Chain</span>
          <ParentChainBreadcrumb parentChain={parentChain} />
        </div>

        {/* Children Count */}
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Children</span>
          <div className={styles.childrenCount} data-testid="details-children-count">
            <span className={styles.childrenNumber}>{childrenCount}</span>
            <span>{childrenCount === 1 ? 'child item' : 'child items'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
