import { DiagramNode, DiagramEdge, MetaModel, AnyRelationship, Diagram, RELATIONSHIP_EDGE_TYPES } from '../../types/model';
import {
  getEntitiesOnDiagram,
  getRelationshipEligibility,
  DisabledReason,
  isLogicalEREdgeOnDiagram,
} from '../../utils/relationshipUtils';
// User Interaction Palette Fix: Import isUserInteractionRowEnabled for interactions section
import { isUserInteractionRowEnabled } from '../../utils/userInteractionUtils';
// Spec 2026-01-02: Import State diagram palette utilities
import {
  stateOnDiagram,
  transitionOnDiagram,
  canAddStateTransition,
} from '../../utils/stateDiagramPaletteUtils';
// Spec 2026-01-02 Task Group 9: Import UI Workflow diagram palette utilities
import {
  uiScreenOnDiagram,
  uiWorkflowTransitionOnDiagram,
  canAddUIWorkflowTransition,
} from '../../utils/uiWorkflowDiagramPaletteUtils';
// Spec 2026-01-03: Import UI Domain palette utilities for UI entity on-diagram detection
import { isEntityOnDiagram } from '../../utils/uiDomainPaletteUtils';
import { PaletteItem } from './PaletteItem';
import styles from './PaletteSection.module.css';

// ============================================================================
// Task Group 2: RelationshipInfo with Action Type
// ============================================================================

/**
 * Action type for relationship rows.
 * - 'add': Show add action (edges don't exist, can be added)
 * - 'delete': Show delete action (edges already exist, can be deleted)
 */
export type RelationshipAction = 'add' | 'delete';

/**
 * Information about a relationship row's state in the palette.
 * Includes enabled state, disabled reason, and action type for interactions.
 */
export interface RelationshipInfo {
  enabled: boolean;
  disabledReason: DisabledReason;
  action: RelationshipAction;
}

interface PaletteSectionProps {
  sectionId: string;
  label: string;
  items: Array<{ id: string; name: string }>;
  isExpanded: boolean;
  onToggle: () => void;
  onItemClick: (item: { id: string; name: string }) => void;
  onItemContextMenu?: (e: React.MouseEvent, item: { id: string; name: string }) => void;
  itemType: 'entity' | 'relationship';
  // User Interaction Palette Fix: Include diagram_edges for interaction eligibility checks
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges?: DiagramEdge[] } | undefined;
  // New prop for relationship enable state computation
  metaModel?: MetaModel;
  // Relationships from metaModel for enable state check
  relationships?: AnyRelationship[];
}

export function PaletteSection({
  sectionId,
  label,
  items,
  isExpanded,
  onToggle,
  onItemClick,
  onItemContextMenu,
  itemType,
  diagram,
  metaModel,
  relationships,
}: PaletteSectionProps) {
  // Pre-compute EntitiesOnDiagram once for all items in this section
  // This is recomputed on every render, which React ensures happens when:
  // - diagram prop changes (SELECT_DIAGRAM, ADD_DIAGRAM)
  // - diagram.diagram_nodes changes (ADD_DIAGRAM_NODE, DELETE_DIAGRAM_ELEMENTS)
  const entitiesOnDiagram = metaModel && diagram
    ? getEntitiesOnDiagram(metaModel, diagram)
    : null;

  // =========================================================================
  // Spec 2026-01-02: Get info for State entity rows
  // States are entity sections but need on-diagram styling like relationships
  // =========================================================================
  const getStateEntityInfo = (item: { id: string; name: string }): RelationshipInfo => {
    if (!diagram) {
      return { enabled: true, disabledReason: null, action: 'add' };
    }

    const isOnDiagram = stateOnDiagram(item.id, diagram.diagram_nodes);

    if (isOnDiagram) {
      // State is on diagram - show greyed out style, Delete action
      return { enabled: false, disabledReason: 'already_visualised', action: 'delete' };
    }

    // State not on diagram - show Add action
    return { enabled: true, disabledReason: null, action: 'add' };
  };

  // =========================================================================
  // Spec 2026-01-02: Get info for StateTransition entity rows
  // StateTransitions are entity sections but behave like relationships
  // Need on-diagram styling and Add validation
  // =========================================================================
  const getStateTransitionInfo = (item: { id: string; name: string }): RelationshipInfo => {
    if (!diagram || !metaModel) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // Check if transition edge already exists on diagram
    const isOnDiagram = transitionOnDiagram(item.id, diagram.diagram_edges || []);

    if (isOnDiagram) {
      // Transition is on diagram - show greyed out style, Delete action
      return { enabled: false, disabledReason: 'already_visualised', action: 'delete' };
    }

    // Find the StateTransition entity
    const transition = metaModel.entities.state_transitions?.find(t => t.id === item.id);
    if (!transition) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // Check if both endpoints are on diagram
    const validation = canAddStateTransition(transition, diagram.diagram_nodes);

    if (validation.canAdd) {
      // Can add - show enabled Add action
      return { enabled: true, disabledReason: null, action: 'add' };
    }

    // Cannot add - endpoints missing
    return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
  };

  // =========================================================================
  // Spec 2026-01-02 Task Group 9: Get info for UIScreen entity rows
  // UIScreens are entity sections but need on-diagram styling like States
  // =========================================================================
  const getUIScreenEntityInfo = (item: { id: string; name: string }): RelationshipInfo => {
    if (!diagram) {
      return { enabled: true, disabledReason: null, action: 'add' };
    }

    const isOnDiagram = uiScreenOnDiagram(item.id, diagram.diagram_nodes);

    if (isOnDiagram) {
      // UIScreen is on diagram - show greyed out style, Delete action
      return { enabled: false, disabledReason: 'already_visualised', action: 'delete' };
    }

    // UIScreen not on diagram - show Add action
    return { enabled: true, disabledReason: null, action: 'add' };
  };

  // =========================================================================
  // Spec 2026-01-03: Get info for UI entity rows (UI_COMPONENT, UI_ACTION,
  // UI_WORKFLOW_TRANSITION when rendered as node)
  // These are entity sections that need on-diagram styling like States
  // =========================================================================
  const getUIEntityInfo = (item: { id: string; name: string }, entityType: string): RelationshipInfo => {
    if (!diagram) {
      return { enabled: true, disabledReason: null, action: 'add' };
    }

    const isOnDiagram = isEntityOnDiagram(entityType, item.id, diagram.diagram_nodes);

    if (isOnDiagram) {
      // Entity is on diagram - show greyed out style, Delete action
      return { enabled: false, disabledReason: 'already_visualised', action: 'delete' };
    }

    // Entity not on diagram - show Add action
    return { enabled: true, disabledReason: null, action: 'add' };
  };

  // =========================================================================
  // Spec 2026-01-02 Task Group 9: Get info for UIWorkflowTransition rows
  // UIWorkflowTransitions are relationship sections with on-diagram styling
  // =========================================================================
  const getUIWorkflowTransitionInfo = (item: { id: string; name: string }): RelationshipInfo => {
    if (!diagram || !metaModel) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // Check if transition edge already exists on diagram
    const isOnDiagram = uiWorkflowTransitionOnDiagram(item.id, diagram.diagram_edges || []);

    if (isOnDiagram) {
      // Transition is on diagram - show greyed out style, Delete action
      return { enabled: false, disabledReason: 'already_visualised', action: 'delete' };
    }

    // Find the UIWorkflowTransition entity
    const transition = metaModel.relationships.ui_workflow_transitions?.find(t => t.id === item.id);
    if (!transition) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // Check if both endpoints are on diagram
    const validation = canAddUIWorkflowTransition(transition, diagram.diagram_nodes);

    if (validation.canAdd) {
      // Can add - show enabled Add action
      return { enabled: true, disabledReason: null, action: 'add' };
    }

    // Cannot add - endpoints missing
    return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
  };

  // Compute relationship eligibility for each item, including disabled reason and action
  const getRelationshipInfo = (item: { id: string; name: string }): RelationshipInfo => {
    if (itemType !== 'relationship' || !metaModel || !diagram || !entitiesOnDiagram) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // =========================================================================
    // Spec 2026-01-02 Task Group 9: Special handling for ui_workflow_transitions
    // =========================================================================
    if (sectionId === 'ui_workflow_transitions') {
      return getUIWorkflowTransitionInfo(item);
    }

    // =========================================================================
    // User Interaction Palette Fix: Special handling for 'interactions' section
    // The interactions section uses Interaction entities (not AnyRelationship),
    // and requires isUserInteractionRowEnabled() for proper eligibility checking.
    //
    // Task Group 2: Add action='delete' when edges exist for interaction
    // =========================================================================
    if (sectionId === 'interactions') {
      // Find the interaction in metaModel.entities.interactions
      const interaction = metaModel.entities.interactions?.find(i => i.id === item.id);
      if (!interaction) {
        return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
      }

      // Create a full Diagram object for isUserInteractionRowEnabled
      // This function requires diagram_edges to check if edges already exist
      const fullDiagram: Diagram = {
        id: 'current', // ID not used by isUserInteractionRowEnabled
        name: 'Current Diagram',
        description: '',
        diagram_nodes: diagram.diagram_nodes,
        diagram_edges: diagram.diagram_edges || [],
      };

      // Task Group 2: Check for existing USER_INTERACTION edges FIRST
      // If edges exist, return delete action (enabled)
      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === item.id
      );

      if (existingEdges.length > 0) {
        // Edges exist - show Delete action (enabled)
        return { enabled: true, disabledReason: null, action: 'delete' };
      }

      // Check if the interaction row is enabled for adding
      const canAdd = isUserInteractionRowEnabled(interaction, fullDiagram, metaModel);

      if (canAdd) {
        // Can add - show Add action (enabled)
        return { enabled: true, disabledReason: null, action: 'add' };
      }

      // Cannot add - show disabled Add action with reason
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }
    // =========================================================================
    // End User Interaction Palette Fix
    // =========================================================================

    // =========================================================================
    // Task Group 3 (ER Diagram UX Enhancements): LogicalER Duplicate Prevention
    // Spec 2025-12-31: Check if LogicalER edge already exists on diagram
    // If edge exists, show disabled state with 'already_visualised' reason
    // and show Delete action in context menu
    // =========================================================================
    if (sectionId === 'logical_data_entity_relationships') {
      // Check if edge already exists on diagram FIRST
      const isOnDiagram = isLogicalEREdgeOnDiagram(item.id, diagram.diagram_edges);

      if (isOnDiagram) {
        // Edge exists - show disabled state with 'already_visualised' reason
        // Context menu will show Delete action based on this state
        return { enabled: false, disabledReason: 'already_visualised', action: 'delete' };
      }

      // Edge doesn't exist - check if endpoints are on diagram for add eligibility
      if (!relationships) {
        return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
      }

      const relationship = relationships.find(r => r.id === item.id);
      if (!relationship) {
        return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
      }

      // Use getRelationshipEligibility for endpoint checking
      const eligibility = getRelationshipEligibility(
        relationship,
        sectionId,
        diagram.diagram_nodes,
        metaModel,
        entitiesOnDiagram
      );

      return { ...eligibility, action: 'add' };
    }
    // =========================================================================
    // End Task Group 3 (ER Diagram UX Enhancements)
    // =========================================================================

    // Standard relationship handling (non-interactions, non-LogicalER)
    if (!relationships) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // Find the relationship object
    const relationship = relationships.find(r => r.id === item.id);
    if (!relationship) {
      return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
    }

    // Use getRelationshipEligibility with pre-computed EntitiesOnDiagram for O(1) lookups
    const eligibility = getRelationshipEligibility(
      relationship,
      sectionId,
      diagram.diagram_nodes,
      metaModel,
      entitiesOnDiagram
    );

    // Standard relationships always use 'add' action (they don't have delete toggle)
    return { ...eligibility, action: 'add' };
  };

  // =========================================================================
  // Spec 2026-01-02: Unified item info getter
  // Routes to appropriate handler based on section type
  // Spec 2026-01-03: Extended for UI domain entity types
  // =========================================================================
  const getItemInfo = (item: { id: string; name: string }): RelationshipInfo => {
    // Special handling for states section (entity type but needs on-diagram styling)
    if (sectionId === 'states') {
      return getStateEntityInfo(item);
    }

    // Special handling for state_transitions section (entity type but behaves like relationship)
    if (sectionId === 'state_transitions') {
      return getStateTransitionInfo(item);
    }

    // Spec 2026-01-02 Task Group 9: Special handling for ui_screens section
    if (sectionId === 'ui_screens') {
      return getUIScreenEntityInfo(item);
    }

    // Spec 2026-01-03: Special handling for ui_components section
    if (sectionId === 'ui_components') {
      return getUIEntityInfo(item, 'UI_COMPONENT');
    }

    // Spec 2026-01-03: Special handling for ui_actions section
    if (sectionId === 'ui_actions') {
      return getUIEntityInfo(item, 'UI_ACTION');
    }

    // Standard entity sections don't need special info
    if (itemType === 'entity') {
      return { enabled: true, disabledReason: null, action: 'add' };
    }

    // Relationship sections
    return getRelationshipInfo(item);
  };

  return (
    <div className={styles.section}>
      <div className={styles.header} onClick={onToggle}>
        <span className={styles.triangle}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className={styles.label}>{label}</span>
      </div>

      {isExpanded && (
        <div className={styles.body}>
          {items.length === 0 ? (
            <div className={styles.emptyState}>No items</div>
          ) : (
            items.map((item) => {
              const itemInfo = getItemInfo(item);
              return (
                <PaletteItem
                  key={item.id}
                  item={item}
                  onClick={() => onItemClick(item)}
                  onContextMenu={onItemContextMenu}
                  itemType={itemType}
                  diagram={diagram}
                  sectionId={sectionId}
                  isRelationshipEnabled={itemInfo.enabled}
                  disabledReason={itemInfo.disabledReason}
                  action={itemInfo.action}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
