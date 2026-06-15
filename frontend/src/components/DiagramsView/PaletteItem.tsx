import { DiagramNode, DiagramEdge } from '../../types/model';
import { DisabledReason } from '../../utils/relationshipUtils';
import { RelationshipAction } from './PaletteSection';
import { nodeExistsForEntity } from '../../utils/nodeCreation';
import { getEntityTypeConstant } from '../../utils/paletteData';
import styles from './PaletteItem.module.css';

interface PaletteItemProps {
  item: { id: string; name: string };
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, item: { id: string; name: string }) => void;
  itemType: 'entity' | 'relationship';
  // Spec 2026-01-01 Task Group 3: Extended to include diagram_edges for ActivityFlow detection
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges?: DiagramEdge[] } | undefined;
  sectionId: string;
  // New prop for relationship enable state
  isRelationshipEnabled?: boolean;
  // New prop for disabled reason (for distinct tooltip messages)
  disabledReason?: DisabledReason;
  // Task Group 4: Action prop for add/delete toggle (interactions only)
  action?: RelationshipAction;
}

/**
 * Spec 2026-01-01 Task Group 3: Check if an ActivityFlow edge already exists on diagram
 * ActivityFlows are stored as edges, not nodes, so we need special detection logic
 */
function isActivityFlowOnDiagram(flowId: string, diagramEdges: DiagramEdge[] | undefined): boolean {
  if (!diagramEdges) return false;
  return diagramEdges.some(
    edge => edge.relationship_type === 'ACTIVITY_FLOW' && edge.relationship_id === flowId
  );
}

export function PaletteItem({
  item,
  onClick,
  onContextMenu,
  itemType,
  diagram,
  sectionId,
  isRelationshipEnabled = false,
  disabledReason = null,
  action = 'add',
}: PaletteItemProps) {
  // Check if entity already exists in diagram (for visual feedback)
  // Spec 2026-01-01 Task Group 3: Special handling for activity_flows section
  // ActivityFlows are edges, not nodes, so check diagram_edges instead
  let isDuplicate = false;
  if (itemType === 'entity' && diagram) {
    if (sectionId === 'activity_flows') {
      // ActivityFlows are stored as edges, not nodes
      isDuplicate = isActivityFlowOnDiagram(item.id, diagram.diagram_edges);
    } else {
      // Standard entity types - check diagram_nodes
      isDuplicate = nodeExistsForEntity(
        diagram.diagram_nodes,
        getEntityTypeConstant(sectionId),
        item.id
      );
    }
  }

  // Determine if item is clickable based on type
  const isClickable = itemType === 'entity'
    ? !isDuplicate
    : isRelationshipEnabled;

  // Task Group 4: Determine if this is a delete action (for interactions with existing edges)
  // Note: This is only used for tooltip text now, not for styling
  const isDeleteAction = itemType === 'relationship' && action === 'delete';

  // Build CSS classes
  // Standardise User Interaction Palette UI: Removed special delete-state styling
  // All enabled relationship items now use the same itemRelationshipEnabled class
  let className = styles.item;

  if (itemType === 'entity') {
    if (isDuplicate) {
      className = `${styles.item} ${styles.itemDuplicate}`;
    } else if (!isClickable) {
      className = `${styles.item} ${styles.itemDisabled}`;
    }
  } else if (itemType === 'relationship') {
    className = `${styles.item} ${styles.itemRelationship}`;
    if (isRelationshipEnabled) {
      className = `${className} ${styles.itemRelationshipEnabled}`;
    } else {
      className = `${className} ${styles.itemRelationshipDisabled}`;
    }
  }

  // Build tooltip based on item type and state
  let tooltip = item.name;
  if (itemType === 'entity') {
    if (isDuplicate) {
      tooltip = 'Already in diagram';
    } else {
      tooltip = 'Click to add to diagram';
    }
  } else if (itemType === 'relationship') {
    if (isRelationshipEnabled) {
      if (isDeleteAction) {
        // Standardise User Interaction Palette UI: Changed "remove" to "delete" for consistency
        tooltip = 'Click to delete interaction edges from diagram';
      } else {
        tooltip = 'Click to add relationship to diagram';
      }
    } else {
      // Use disabledReason to show contextually appropriate tooltip
      switch (disabledReason) {
        case 'already_visualised':
          tooltip = 'Already visualised on this diagram.';
          break;
        case 'endpoints_missing':
        default:
          tooltip = 'Both endpoints must be on diagram to add this relationship';
          break;
      }
    }
  }

  // Handle click
  const handleClick = () => {
    if (isClickable) {
      onClick();
    }
  };

  // Handle right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    // Show context menu for both entity and relationship items
    if (onContextMenu) {
      e.preventDefault(); // Suppress browser default context menu
      onContextMenu(e, item);
    }
  };

  return (
    <div
      className={className}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={tooltip}
    >
      <div className={styles.itemContent}>
        <div className={styles.name}>{item.name}</div>
        {/* Standardise User Interaction Palette UI: Action indicator badge removed
            Use context menu for Add/Delete actions instead */}
      </div>
    </div>
  );
}
