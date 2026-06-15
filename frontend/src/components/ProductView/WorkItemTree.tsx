/**
 * WorkItemTree Component
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Spec 2026-01-04: Product Roadmap Stage 3 - ARCHIVED Status and Expandable Descriptions
 * Task Group 3: Hierarchical tree view for work items.
 *
 * Features:
 * - Recursive rendering with indentation
 * - Collapsible nodes with chevron toggle
 * - Highlight selected node
 * - Type badges with color coding
 * - ARCHIVED badge and muted row styling (Stage 3)
 * - Epic description preview with expand/collapse (Stage 3)
 * - Empty epic placeholder for initiatives with no children (Stage 3)
 *
 * Spec 2026-06-14: Holistic Integration/E2E TEST Work Items (Spec 2 of 4) --
 * Task Group 4 (D5(a)) adds a distinct TEST type badge so a `TEST` sibling
 * created by the holistic node action is visually distinguishable from
 * stories/features in the flat backlog (it previously fell through to the
 * muted `typeDefault` badge).
 */

import { memo } from 'react';
import type { WorkItemTreeNode } from '../../types/workItems';
import styles from './WorkItemTree.module.css';

/** Indentation per depth level in pixels */
const INDENT_PER_LEVEL = 20;

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
      // Holistic Integration/E2E TEST Work Items (2026-06-14, Task Group 4):
      // distinct chip for integration/E2E TEST siblings.
      return styles.typeTest;
    default:
      return styles.typeDefault;
  }
}

/**
 * Props for WorkItemTree component
 */
export interface WorkItemTreeProps {
  /** Tree nodes to render */
  nodes: WorkItemTreeNode[];
  /** Currently selected item ID (null if none) */
  selectedId: string | null;
  /** Callback when a node is selected */
  onSelect: (id: string) => void;
  /** Callback when a node is expanded/collapsed */
  onToggle: (id: string) => void;
  /** Set of epic IDs with expanded descriptions (Stage 3) */
  expandedDescriptionIds?: Set<string>;
  /** Callback when epic description is toggled (Stage 3) */
  onToggleDescription?: (id: string) => void;
}

/**
 * Props for internal TreeNode component
 */
interface TreeNodeProps {
  /** The tree node to render */
  node: WorkItemTreeNode;
  /** Currently selected item ID */
  selectedId: string | null;
  /** Callback when a node is selected */
  onSelect: (id: string) => void;
  /** Callback when a node is expanded/collapsed */
  onToggle: (id: string) => void;
  /** Set of epic IDs with expanded descriptions (Stage 3) */
  expandedDescriptionIds?: Set<string>;
  /** Callback when epic description is toggled (Stage 3) */
  onToggleDescription?: (id: string) => void;
}

/**
 * TreeNode Component - renders a single node and its children recursively.
 * Wrapped in React.memo to prevent re-renders when props haven't changed.
 */
const TreeNode = memo(function TreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  expandedDescriptionIds,
  onToggleDescription,
}: TreeNodeProps) {
  const { item, children, depth, isExpanded } = node;
  const hasChildren = children.length > 0;
  const isSelected = item.id === selectedId;
  const isArchived = item.status === 'ARCHIVED';
  const isStrikethrough = item.status === 'DONE' || item.status === 'COMPLETED' || item.status === 'CANCELLED';

  // Check if this is an EPIC with a description that can be expanded
  const isEpicWithDescription = item.type === 'EPIC' && item.description !== null && item.description.length > 0;
  const isDescriptionExpanded = expandedDescriptionIds?.has(item.id) ?? false;

  // Calculate indentation based on depth
  const indentStyle = {
    paddingLeft: `${depth * INDENT_PER_LEVEL + 12}px`,
  };

  // Description indentation (aligns with title, accounting for chevron placeholder)
  const descriptionIndentStyle = {
    paddingLeft: `${depth * INDENT_PER_LEVEL + 12 + 20}px`, // +20 for chevron placeholder
    paddingRight: '12px',
  };

  // Row CSS classes - apply archived styling if needed
  const rowClasses = [
    styles.treeRow,
    isSelected ? styles.treeRowSelected : '',
    isArchived ? styles.archivedRow : '',
  ].filter(Boolean).join(' ');

  // Handle row click - select the node (expand/collapse is handled by chevron only)
  const handleRowClick = () => {
    onSelect(item.id);
  };

  // Handle chevron click - toggle expand/collapse
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger row selection
    onToggle(item.id);
  };

  // Handle description toggle click
  const handleDescriptionToggle = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger row selection
    if (onToggleDescription) {
      onToggleDescription(item.id);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item.id);
    }
    if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
      e.preventDefault();
      onToggle(item.id);
    }
    if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
      e.preventDefault();
      onToggle(item.id);
    }
  };

  return (
    <>
      {/* Node row */}
      <div
        className={rowClasses}
        style={indentStyle}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        data-testid={`tree-node-${item.id}`}
      >
        {/* Chevron or placeholder */}
        {hasChildren ? (
          <span
            className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
            onClick={handleChevronClick}
            data-testid={`tree-chevron-${item.id}`}
          >
            &#9654;
          </span>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        {/* Node content */}
        <div className={styles.nodeContent}>
          <span className={styles.title}>{item.title}</span>
          <span
            className={`${styles.typeBadge} ${getTypeBadgeClass(item.type)} ${isStrikethrough ? styles.typeDone : ''}`}
            data-testid={`tree-type-badge-${item.id}`}
          >
            {item.type}
          </span>
          {/* External key (Jira) suffix */}
          {item.externalKey && (
            <span className={styles.externalKey} data-testid={`tree-external-key-${item.id}`}>
              {item.externalKey}
            </span>
          )}
          {/* ARCHIVED badge - Task Group 3 */}
          {isArchived && (
            <span className={styles.archivedBadge} data-testid={`archived-badge-${item.id}`}>
              ARCHIVED
            </span>
          )}
        </div>
      </div>

      {/* Epic description section - Task Group 4 */}
      {isEpicWithDescription && (
        <div
          className={styles.descriptionContainer}
          style={descriptionIndentStyle}
          data-testid={`description-section-${item.id}`}
        >
          <div className={isDescriptionExpanded ? styles.descriptionExpanded : styles.descriptionPreview}>
            {item.description}
          </div>
          {onToggleDescription && (
            <button
              className={styles.showMoreLink}
              onClick={handleDescriptionToggle}
              data-testid={`description-toggle-${item.id}`}
            >
              {isDescriptionExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* Children (only if expanded) */}
      {hasChildren && isExpanded && (
        <div className={styles.childrenContainer} role="group">
          {children.map((child) => (
            <TreeNode
              key={child.item.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              expandedDescriptionIds={expandedDescriptionIds}
              onToggleDescription={onToggleDescription}
            />
          ))}
        </div>
      )}

      {/* Empty children placeholder - Task Group 7 */}
      {/* Show "No epics defined." when INITIATIVE is expanded but has no children */}
      {!hasChildren && isExpanded && item.type === 'INITIATIVE' && (
        <div
          className={styles.emptyChildrenPlaceholder}
          style={descriptionIndentStyle}
          data-testid={`empty-children-${item.id}`}
        >
          No epics defined.
        </div>
      )}
    </>
  );
});

/**
 * WorkItemTree Component
 *
 * Renders a hierarchical tree of work items with:
 * - Collapsible/expandable nodes
 * - Selection highlighting
 * - Type badges
 * - ARCHIVED badge for archived items (Stage 3)
 * - Epic description expand/collapse (Stage 3)
 * - Empty placeholder for initiatives without epics (Stage 3)
 * - Keyboard navigation support
 */
export function WorkItemTree({
  nodes,
  selectedId,
  onSelect,
  onToggle,
  expandedDescriptionIds,
  onToggleDescription,
}: WorkItemTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className={styles.emptyMessage} data-testid="tree-empty">
        No work items yet.
      </div>
    );
  }

  return (
    <div className={styles.container} role="tree" data-testid="work-item-tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.item.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          expandedDescriptionIds={expandedDescriptionIds}
          onToggleDescription={onToggleDescription}
        />
      ))}
    </div>
  );
}
