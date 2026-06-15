/**
 * SequenceNodeRow Component
 * Task Group 4: Component for rendering individual sequence nodes in the Flow tab
 * Task Group 5: Integrated with @dnd-kit/sortable for drag-and-drop reorder
 *
 * This component renders either a message node or a fragment node with appropriate
 * styling and action buttons.
 *
 * Features:
 * - Render message node: from/to participant labels, message content (refKind/refId label OR labelText)
 * - Render fragment node: fragmentKind badge (Loop/Optional/Alternative)
 * - Move up/down action buttons (lucide-react icons)
 * - Edit action button (Pencil icon)
 * - Delete action button (X icon)
 * - GripVertical drag handle with @dnd-kit/sortable integration for functional drag-and-drop
 * - Nested children rendered recursively
 */

import { useMemo } from 'react';
import { Pencil, X, GripVertical } from 'lucide-react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  FragmentKind,
} from '../../../types/sequenceDiagram';
import { MetaModel } from '../../../types/model';
import { TreeNode } from './FlowTab';
import styles from '../SequenceEditorPanel.module.css';

// ============================================================================
// Types
// ============================================================================

export interface SequenceNodeRowProps {
  /** The tree node to render */
  treeNode: TreeNode;
  /** The full sequence diagram (for lookups) */
  sequenceDiagram: SequenceDiagram;
  /** Optional meta model for entity lookups */
  metaModel?: MetaModel | null;
  /** Callback for move up action */
  onMoveUp: (nodeId: string) => void;
  /** Callback for move down action */
  onMoveDown: (nodeId: string) => void;
  /** Callback for edit action */
  onEdit: (nodeId: string) => void;
  /** Callback for delete action */
  onDelete: (nodeId: string) => void;
  /** Callback for "Add inside fragment" action */
  onAddInside: (fragmentNodeId: string, operandId: string, type: 'message' | 'fragment') => void;
  /** Sortable ID for @dnd-kit integration */
  sortableId?: string;
  /** Whether drag-and-drop is enabled for this row */
  isDndEnabled?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get participant label by resolving ref_kind/ref_id to entity name
 */
function getParticipantLabel(
  participantId: string,
  participants: SequenceParticipant[],
  metaModel?: MetaModel | null
): string {
  const participant = participants.find(p => p.id === participantId);
  if (!participant) return 'Unknown';

  if (!metaModel) {
    return `${participant.ref_kind}`;
  }

  // Look up entity name based on ref_kind
  const refKind = participant.ref_kind;
  const refId = participant.ref_id;

  switch (refKind) {
    case 'BusinessUser':
      return metaModel.entities.business_users.find(e => e.id === refId)?.name || refKind;
    case 'Application':
      return metaModel.entities.applications.find(e => e.id === refId)?.name || refKind;
    case 'ApplicationComponent':
      return metaModel.entities.app_components.find(e => e.id === refId)?.name || refKind;
    case 'Service':
      return metaModel.entities.services.find(e => e.id === refId)?.name || refKind;
    case 'Interface':
      return metaModel.entities.interfaces.find(e => e.id === refId)?.name || refKind;
    case 'InterfaceEndpoint':
      return metaModel.entities.endpoints.find(e => e.id === refId)?.name || refKind;
    case 'Class':
      return metaModel.entities.classes?.find(e => e.id === refId)?.name || refKind;
    default:
      return refKind;
  }
}

/**
 * Get message content label (either from reference or label_text)
 */
function getMessageContentLabel(
  message: SequenceMessage,
  metaModel?: MetaModel | null
): string {
  if (message.label_text) {
    return message.label_text;
  }

  if (message.ref_kind && message.ref_id) {
    if (!metaModel) {
      return `${message.ref_kind}`;
    }

    const refKind = message.ref_kind;
    const refId = message.ref_id;

    switch (refKind) {
      case 'Method':
        return metaModel.entities.methods?.find(m => m.id === refId)?.name || refKind;
      case 'LogicalEntity':
        return metaModel.entities.logical_data_entities.find(e => e.id === refId)?.name || refKind;
      case 'PhysicalEntity':
        return metaModel.entities.physical_data_entities.find(e => e.id === refId)?.name || refKind;
      case 'Class':
        return metaModel.entities.classes?.find(e => e.id === refId)?.name || refKind;
      case 'Event':
        return metaModel.entities.events?.find(e => e.id === refId)?.name || refKind;
      case 'Interface':
        return metaModel.entities.interfaces?.find(i => i.id === refId)?.name || refKind;
      case 'InterfaceEndpoint':
        return metaModel.entities.endpoints?.find(e => e.id === refId)?.name || refKind;
      default:
        return refKind;
    }
  }

  return 'No content';
}

/**
 * Get CSS class for nesting depth
 */
function getDepthClass(depth: number): string {
  switch (depth) {
    case 1:
      return styles.nestedLevel1;
    case 2:
      return styles.nestedLevel2;
    case 3:
    default:
      return depth >= 3 ? styles.nestedLevel3 : '';
  }
}

/**
 * Get badge class for fragment kind
 */
function getFragmentBadgeClass(fragmentKind: FragmentKind): string {
  switch (fragmentKind) {
    case 'Loop':
      return `${styles.badge} ${styles.badgeLoop}`;
    case 'Optional':
      return `${styles.badge} ${styles.badgeOptional}`;
    case 'Alternative':
      return `${styles.badge} ${styles.badgeAlternative}`;
    default:
      return styles.badge;
  }
}

// ============================================================================
// SequenceNodeRow Component
// ============================================================================

export function SequenceNodeRow({
  treeNode,
  sequenceDiagram,
  metaModel,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  onAddInside,
  sortableId,
  isDndEnabled = false,
}: SequenceNodeRowProps) {
  const { node, children, depth } = treeNode;
  const depthClass = getDepthClass(depth);

  // DnD sortable hook - only active when isDndEnabled and sortableId are provided
  const sortable = useSortable({
    id: isDndEnabled && sortableId ? sortableId : node.id,
    disabled: !isDndEnabled,
  });

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  // Compute DnD styles for the row when enabled
  const dndStyle = isDndEnabled ? {
    transform: CSS.Transform.toString(transform),
    transition,
  } : undefined;

  // Compute row class name with drag active state
  const dragActiveClass = isDragging ? ` ${styles.dragActive}` : '';

  // Get message or fragment data
  const message = useMemo(() => {
    if (node.node_kind === 'Message' && node.message_id) {
      return (sequenceDiagram.messages || []).find(m => m.id === node.message_id);
    }
    return null;
  }, [node, sequenceDiagram.messages]);

  const fragment = useMemo(() => {
    if (node.node_kind === 'Fragment' && node.fragment_id) {
      return (sequenceDiagram.fragments || []).find(f => f.id === node.fragment_id);
    }
    return null;
  }, [node, sequenceDiagram.fragments]);

  const fragmentOperands = useMemo(() => {
    if (fragment) {
      return (sequenceDiagram.operands || [])
        .filter(op => op.fragment_id === fragment.id)
        .sort((a, b) => a.operand_index - b.operand_index);
    }
    return [];
  }, [fragment, sequenceDiagram.operands]);

  // Render message node
  if (node.node_kind === 'Message' && message) {
    const fromLabel = getParticipantLabel(
      message.from_participant_id,
      sequenceDiagram.participants || [],
      metaModel
    );
    const toLabel = getParticipantLabel(
      message.to_participant_id,
      sequenceDiagram.participants || [],
      metaModel
    );
    const contentLabel = getMessageContentLabel(message, metaModel);
    const roleIcon = message.exchange_role === 'Request' ? '->' : '<-';

    return (
      <div
        ref={isDndEnabled ? setNodeRef : undefined}
        className={`${styles.listItem} ${depthClass}${dragActiveClass}`}
        data-testid={`sequence-node-${node.id}`}
        style={dndStyle}
      >
        {/* Drag handle - receives sortable attributes and listeners when DnD is enabled */}
        <span
          ref={isDndEnabled ? setActivatorNodeRef : undefined}
          className={styles.dragHandle}
          title="Drag to reorder"
          data-testid={`drag-handle-${node.id}`}
          {...(isDndEnabled ? { ...attributes, ...listeners } : {})}
        >
          <GripVertical size={14} />
        </span>

        <span className={styles.itemLabel}>
          <span style={{ fontWeight: 500 }}>{fromLabel}</span>
          <span style={{ color: '#666', margin: '0 4px' }}>{roleIcon}</span>
          <span style={{ fontWeight: 500 }}>{toLabel}</span>
          <span style={{ color: '#999', marginLeft: '8px' }}>{contentLabel}</span>
        </span>
        {/* Action buttons: [Edit] [Delete] */}
        <div className={styles.itemActions}>
          <button
            className={styles.actionButton}
            onClick={() => onEdit(node.id)}
            title="Edit"
            data-testid={`edit-${node.id}`}
          >
            <Pencil size={14} />
          </button>
          <button
            className={`${styles.actionButton} ${styles.actionButtonDanger}`}
            onClick={() => onDelete(node.id)}
            title="Delete"
            data-testid={`delete-${node.id}`}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Render fragment node
  if (node.node_kind === 'Fragment' && fragment) {
    const badgeClass = getFragmentBadgeClass(fragment.fragment_kind);

    return (
      <>
        <div
          ref={isDndEnabled ? setNodeRef : undefined}
          className={`${styles.listItem} ${depthClass}${dragActiveClass}`}
          data-testid={`sequence-node-${node.id}`}
          style={{ background: '#f8f9fa', ...dndStyle }}
        >
          {/* Drag handle - receives sortable attributes and listeners when DnD is enabled */}
          <span
            ref={isDndEnabled ? setActivatorNodeRef : undefined}
            className={styles.dragHandle}
            title="Drag to reorder"
            data-testid={`drag-handle-${node.id}`}
            {...(isDndEnabled ? { ...attributes, ...listeners } : {})}
          >
            <GripVertical size={14} />
          </span>

          <span className={styles.itemLabel}>
            <span className={badgeClass}>{fragment.fragment_kind}</span>
            {fragment.label_text && (
              <span style={{ marginLeft: '8px', color: '#666' }}>
                {fragment.label_text}
              </span>
            )}
          </span>
          {/* Action buttons: [Edit] [Delete] */}
          <div className={styles.itemActions}>
            <button
              className={styles.actionButton}
              onClick={() => onEdit(node.id)}
              title="Edit"
              data-testid={`edit-${node.id}`}
            >
              <Pencil size={14} />
            </button>
            <button
              className={`${styles.actionButton} ${styles.actionButtonDanger}`}
              onClick={() => onDelete(node.id)}
              title="Delete"
              data-testid={`delete-${node.id}`}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Render operands for Alternative/Loop/Optional */}
        {fragmentOperands.map((operand, index) => {
          const operandChildren = children
            .filter(child => child.node.parent_operand_id === operand.id);
          const operandSortableIds = operandChildren.map(child => child.node.id);
          return (
            <div key={operand.id}>
              {/* Operand header */}
              <div
                className={`${styles.listItem} ${getDepthClass(depth + 1)}`}
                style={{ background: '#f0f4ff', borderLeft: '3px solid #1976D2' }}
                data-testid={`operand-${operand.id}`}
              >
                <span className={styles.itemLabel} style={{ fontStyle: 'italic', color: '#666' }}>
                  [{fragment.fragment_kind === 'Alternative' ? `Branch ${index + 1}` : 'Body'}]
                  {operand.guard_expression && (
                    <span style={{ marginLeft: '8px', color: '#1565C0' }}>
                      [{operand.guard_expression}]
                    </span>
                  )}
                </span>
                <div className={styles.itemActions}>
                  <button
                    className={styles.actionButton}
                    onClick={() => onAddInside(node.id, operand.id, 'message')}
                    title="Add message inside"
                    data-testid={`add-message-inside-${operand.id}`}
                    style={{ fontSize: '10px' }}
                  >
                    +M
                  </button>
                  <button
                    className={styles.actionButton}
                    onClick={() => onAddInside(node.id, operand.id, 'fragment')}
                    title="Add fragment inside"
                    data-testid={`add-fragment-inside-${operand.id}`}
                    style={{ fontSize: '10px' }}
                  >
                    +F
                  </button>
                </div>
              </div>

              {/* Render nodes nested inside this operand */}
              <SortableContext items={operandSortableIds} strategy={verticalListSortingStrategy}>
                {operandChildren.map(child => (
                  <SequenceNodeRow
                    key={child.node.id}
                    treeNode={{ ...child, depth: depth + 2 }}
                    sequenceDiagram={sequenceDiagram}
                    metaModel={metaModel}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onAddInside={onAddInside}
                    sortableId={child.node.id}
                    isDndEnabled={true}
                  />
                ))}
              </SortableContext>
            </div>
          );
        })}

        {/* Render direct children (not in operand) */}
        {(() => {
          const directChildren = children.filter(child => !child.node.parent_operand_id);
          const directSortableIds = directChildren.map(child => child.node.id);
          return (
            <SortableContext items={directSortableIds} strategy={verticalListSortingStrategy}>
              {directChildren.map(child => (
                <SequenceNodeRow
                  key={child.node.id}
                  treeNode={child}
                  sequenceDiagram={sequenceDiagram}
                  metaModel={metaModel}
                  onMoveUp={onMoveUp}
                  onMoveDown={onMoveDown}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onAddInside={onAddInside}
                  sortableId={child.node.id}
                  isDndEnabled={true}
                />
              ))}
            </SortableContext>
          );
        })()}
      </>
    );
  }

  // Fallback for unknown node kind
  return (
    <div
      className={`${styles.listItem} ${depthClass}`}
      data-testid={`sequence-node-${node.id}`}
    >
      <span className={styles.itemLabel} style={{ color: '#999' }}>
        Unknown node type: {node.node_kind}
      </span>
    </div>
  );
}

export default SequenceNodeRow;
