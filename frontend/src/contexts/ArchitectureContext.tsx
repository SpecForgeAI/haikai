import React, { createContext, useContext, useReducer, useCallback, useRef, useState, useEffect, ReactNode } from 'react';
import { ArchitectureModel, EntityType, RelationshipType, AnyEntity, AnyRelationship, DiagramNode, DiagramEdge, EdgePoint, Diagram, Decoration, MetaModelEntities, LabelDecoration } from '../types/model';
import { ValidationError } from '../types/config';
import { emptyModel } from '../config/defaults';
import { getDescendantNodes, isPointAttachedToNode } from '../utils/rendering';
import { nodeExistsForEntity } from '../utils/nodeCreation';
import { getDefaultViewQuarter } from '../utils/quarterUtils';
import {
  createApplicationPointFromEntity,
  cascadeDeleteForSourceEntity,
  cascadeDeleteBusinessUser,
  cascadeDeleteLogicalDataEntity,
  cascadeDeletePhysicalDataEntity,
  cascadeDeleteLogicalDataAttribute,
  cascadeDeletePhysicalDataAttribute,
  cascadeDeleteInterface,
  reconcileApplicationPoints,
  syncApplicationPointNameForEntity,
  SourceEntityType,
  MinimalSourceEntity,
} from '../utils/applicationPointSync';
import {
  createBusinessPointFromEntity,
  cascadeDeleteForBusinessSourceEntity,
  reconcileBusinessPoints,
  syncBusinessPointNameForEntity,
  BusinessSourceEntityType,
  MinimalBusinessSourceEntity,
} from '../utils/businessPointSync';
import {
  createAppBusinessPointFromEntity,
  cascadeDeleteForABPSourceEntity,
  reconcileAppBusinessPoints,
  syncAppBusinessPointNameForEntity,
  isABPSourceEntityType,
  ABPSourceEntityType,
  MinimalABPSourceEntity,
} from '../utils/appBusinessPointSync';
import { migrateLogicalAttributes } from '../utils/dataTypeMigration';
import { Z_INDEX_DEFAULTS, isShapeDecoration } from '../utils/zIndexUtils';
// Canonical view-segment set shared with ProjectLayout's legacy-URL redirect,
// so architecture switches and redirects agree on which views exist.
import { KNOWN_VIEW_SEGMENTS } from '../components/Layout/ProjectLayout';
// Task Group 4: Import temporal splitting utilities for diagram-level temporality
import {
  shouldTriggerSplit,
  splitDiagramNode,
  splitDiagramEdge,
  splitDecoration,
} from '../utils/temporalSplitting';
// Task Group 5: Import cascade deletion utility for User Interaction edges
import { shouldCascadeDeleteUserLink } from '../utils/userInteractionUtils';
// Spec 2025-12-24: Import ArchitectureDomain and isArchitectureDomain for selectedDomain state
import { ArchitectureDomain, isArchitectureDomain } from '../types/architectureDomain';
import { domainGroupings } from '../config/gridConfigs';
// Spec 2026-01-08: Import relationship label resolver utilities
import {
  buildCacheKeyForCell,
  resolveRelationshipCellLabel,
  RELATIONSHIP_FK_COLUMNS,
} from '../utils/relationshipLabelResolver';
// Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
// Imports for resolving the project's Default architecture at project-load time.
// ArchitectureProvider is mounted INSIDE ProjectProvider in App.tsx, so useProject
// is safe to call here. listArchitectures hits GET /api/projects/{id}/architectures.
import { useProject } from './ProjectContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
// Import the Architecture type so the context can expose the full list
// for the new selector dropdown (consumed in Task Group 3).
import { listArchitectures, type Architecture } from '../api/architecturesApi';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
// Routing hooks: `:architectureId` is now read from useParams (URL is the
// source of truth); setActiveArchitecture navigates via useNavigate.
import { useNavigate, useParams, useLocation } from 'react-router-dom';
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
// URL-derived parser for the architecture id. Used in place of
// useParams().architectureId so the value resolves even when this
// provider is mounted above the <Routes> tree (the bug fixed by
// spec 2026-05-04). useParams remains in scope for params.projectId
// which other call sites in this provider continue to rely on.
import { parseArchitectureIdFromPathname } from '../hooks/useCurrentView';
// Spec 2026-03-05: Import MergeableData type for MERGE_IMPORT action
import type { MergeableData } from '../utils/importMergeUtils';


// ============================================================================
// Spec: Fix Interface Composite Rendering (Task Group 3)
// Legacy Normalization for Interface Logical Entities
// ============================================================================

/**
 * Normalize interface_logical_entities relationships for backward compatibility.
 *
 * This function migrates legacy data that used separate logical_entity_id or
 * physical_entity_id fields to the new unified dataEntityPointId format.
 *
 * Migration rules:
 * - If dataEntityPointId is missing/empty AND logical_entity_id exists:
 *   Set dataEntityPointId = "dep_log_" + logical_entity_id
 * - If dataEntityPointId is missing/empty AND physical_entity_id exists:
 *   Set dataEntityPointId = "dep_phy_" + physical_entity_id
 * - If dataEntityPointId already has a value, preserve it (no overwrite)
 *
 * @param interfaceLogicalEntities - Array of interface_logical_entity relationships
 * @returns Normalized array with dataEntityPointId populated
 */
export function normalizeInterfaceLogicalEntities<
  T extends { dataEntityPointId?: string; logical_entity_id?: string; physical_entity_id?: string }
>(interfaceLogicalEntities: T[]): T[] {
  return interfaceLogicalEntities.map(rel => {
    // If dataEntityPointId already has a value, preserve it
    if (rel.dataEntityPointId && rel.dataEntityPointId.length > 0) {
      return rel;
    }

    // Check for legacy logical_entity_id field
    const legacyLogicalId = (rel as any).logical_entity_id;
    if (legacyLogicalId && typeof legacyLogicalId === 'string' && legacyLogicalId.length > 0) {
      return {
        ...rel,
        dataEntityPointId: `dep_log_${legacyLogicalId}`,
      };
    }

    // Check for legacy physical_entity_id field
    const legacyPhysicalId = (rel as any).physical_entity_id;
    if (legacyPhysicalId && typeof legacyPhysicalId === 'string' && legacyPhysicalId.length > 0) {
      return {
        ...rel,
        dataEntityPointId: `dep_phy_${legacyPhysicalId}`,
      };
    }

    // No legacy fields to migrate, return as-is
    return rel;
  });
}

// State interface
// Spec 2026-01-08: Added relationshipCellLabels for relationship dropdown label cache
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
//   The `currentView` field has been removed. View selection is now
//   URL-driven; consumers read it via the `useCurrentView()` hook in
//   `frontend/src/hooks/useCurrentView.ts`.
export interface AppState {
  model: ArchitectureModel;
  selectedTab: string;
  selectedDiagramId: string | null;
  loadedFileName: string | null;
  validationErrors: ValidationError[];
  // Palette panel state
  isPalettePanelCollapsed: boolean;
  sectionExpandStates: Record<string, boolean>;
  paletteSearchQuery: string;
  // Inspector panel state
  isInspectorPanelCollapsed: boolean;
  // Spec 2025-12-24: Selected architecture domain for Meta-Model View filtering
  selectedDomain: ArchitectureDomain;
  // Spec 2026-01-08: Relationship cell label cache
  // Key format: `${relationshipKey}:${rowId}:${columnKey}`
  // Value: Display label string (e.g., "Customer [LOGICAL_DATA_ENTITY]")
  // This cache is UI-only and must never be serialized to backend or snapshot exports
  relationshipCellLabels: Record<string, string>;
}

// Action types
// Spec 2026-01-08: Added relationship cell label cache actions
// Spec 2026-01-19: Added SET_PROJECT_NAME action for export project name prompt
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
//   `SET_VIEW` removed. View selection is URL-driven; navigate to a
//   canonical architecture-scoped URL with `useNavigate` instead of
//   dispatching this action.
export type AppAction =
  | { type: 'LOAD_MODEL'; payload: ArchitectureModel; fileName: string }
  | { type: 'SELECT_TAB'; payload: string }
  | { type: 'SELECT_DIAGRAM'; payload: string | null }
  | { type: 'UPDATE_ENTITY'; entityType: EntityType; entity: AnyEntity }
  | { type: 'ADD_ENTITY'; entityType: EntityType; entity: AnyEntity }
  | { type: 'DELETE_ENTITY'; entityType: EntityType; id: string }
  | { type: 'UPDATE_RELATIONSHIP'; relationshipType: RelationshipType; relationship: AnyRelationship }
  | { type: 'ADD_RELATIONSHIP'; relationshipType: RelationshipType; relationship: AnyRelationship }
  | { type: 'DELETE_RELATIONSHIP'; relationshipType: RelationshipType; id: string }
  | { type: 'SET_VALIDATION_ERRORS'; payload: ValidationError[] }
  | { type: 'RESET_MODEL' }
  | { type: 'UPDATE_DIAGRAM_NODE'; diagramId: string; nodeId: string; updates: Partial<DiagramNode> }
  | { type: 'UPDATE_DIAGRAM_EDGE'; diagramId: string; edgeId: string; updates: Partial<DiagramEdge> }
  | { type: 'UPDATE_DIAGRAM_NODES'; diagramId: string; nodeIds: string[]; updates: Partial<DiagramNode> }
  | { type: 'UPDATE_DIAGRAM_EDGES'; diagramId: string; edgeIds: string[]; updates: Partial<DiagramEdge> }
  | { type: 'UPDATE_DIAGRAM_EDGE_POINTS'; diagramId: string; edgeId: string; edgePoints: EdgePoint[] }
  | { type: 'MOVE_NODE_WITH_CASCADE'; diagramId: string; nodeId: string; dx: number; dy: number }
  | { type: 'MOVE_NODES_WITH_CASCADE'; diagramId: string; nodeIds: string[]; dx: number; dy: number }
  | { type: 'DELETE_DIAGRAM_ELEMENTS'; diagramId: string; nodeIds: string[]; edgeIds: string[]; decorationIds?: string[]; labelDecorationIds?: string[] }
  | {
      type: 'UPDATE_EDGE_POINT';
      diagramId: string;
      edgeId: string;
      pointIndex: number;
      pos_x: number;
      pos_y: number;
      adjustLabel?: boolean;
    }
  | {
      type: 'UPDATE_EDGE_LABEL_POSITION';
      diagramId: string;
      edgeId: string;
      label_pos_x: number;
      label_pos_y: number;
    }
  // Task Group 3: Insert a new edge point (bend point) at a specific segment
  | {
      type: 'INSERT_EDGE_POINT';
      diagramId: string;
      edgeId: string;
      segmentIndex: number;
      pos_x: number;
      pos_y: number;
    }
  | { type: 'ADD_DIAGRAM'; payload: Diagram }
  // Spec 2026-03-05: DELETE_DIAGRAM action for removing a diagram and applying fallback selection
  | { type: 'DELETE_DIAGRAM'; payload: string }
  // Task Group 7: UPDATE_DIAGRAM action for updating diagram-level properties including typedContent
  | { type: 'UPDATE_DIAGRAM'; diagramId: string; updates: Partial<Diagram> }
  | { type: 'UPDATE_DIAGRAM_VIEW_QUARTER'; diagramId: string; view_quarter: string }
  | { type: 'TOGGLE_PALETTE_PANEL' }
  | { type: 'TOGGLE_INSPECTOR_PANEL' }
  | { type: 'TOGGLE_PALETTE_SECTION'; payload: { sectionId: string } }
  | { type: 'SET_PALETTE_SEARCH'; payload: string }
  | { type: 'ADD_DIAGRAM_NODE'; payload: { diagramId: string; node: DiagramNode } }
  | { type: 'ADD_DIAGRAM_NODES'; payload: { diagramId: string; nodes: DiagramNode[] } }
  // Data Movement Add Fix: ADD_DIAGRAM_EDGE action for adding relationship edges to diagrams
  | { type: 'ADD_DIAGRAM_EDGE'; payload: { diagramId: string; edge: DiagramEdge } }
  | { type: 'ADD_DIAGRAM_EDGES'; payload: { diagramId: string; edges: DiagramEdge[] } }
  // Decoration actions
  | { type: 'ADD_DECORATION'; diagramId: string; decoration: Decoration }
  | { type: 'ADD_DECORATIONS'; diagramId: string; decorations: Decoration[] }
  | { type: 'UPDATE_DECORATION'; diagramId: string; decorationId: string; updates: Partial<Decoration> }
  | { type: 'DELETE_DECORATION'; diagramId: string; decorationId: string }
  | { type: 'UPDATE_DECORATIONS'; diagramId: string; decorationIds: string[]; updates: Partial<Decoration> }
  // Spec 2025-12-31 (A5): Label Decoration actions for Activity diagram labels
  | { type: 'ADD_LABEL_DECORATION'; diagramId: string; labelDecoration: LabelDecoration }
  | { type: 'UPDATE_LABEL_DECORATION'; diagramId: string; labelDecorationId: string; updates: Partial<LabelDecoration> }
  | { type: 'DELETE_LABEL_DECORATION'; diagramId: string; labelDecorationId: string }
  // Excel Import action
  // Spec 2026-01-11: Extended IMPORT_META_MODEL to support Append/Overwrite mode
  | {
      type: 'IMPORT_META_MODEL';
      payload: {
        entities: Record<string, unknown[]>;
        relationships: Record<string, unknown[]>;
        updatedEntities?: Record<string, unknown[]>;
        updatedRelationships?: Record<string, unknown[]>;
        mode?: 'append' | 'overwrite';
      };
    }
  // Spec 2026-03-05: MERGE_IMPORT action for cherry-pick merge flow
  // Purely additive: appends imported entities, relationships, and diagrams to existing model
  | { type: 'MERGE_IMPORT'; payload: MergeableData }
  // Spec 2025-12-24: SET_DOMAIN action for architecture domain selection
  | { type: 'SET_DOMAIN'; payload: ArchitectureDomain }
  // ============================================================================
  // Spec 2026-01-08: Relationship Cell Label Cache Actions
  // ============================================================================
  | {
      type: 'SET_RELATIONSHIP_CELL_LABEL';
      payload: { relationshipKey: string; rowId: string; columnKey: string; label: string };
    }
  | {
      type: 'CLEAR_RELATIONSHIP_CELL_LABELS_FOR_RELATIONSHIP';
      payload: { relationshipKey: string };
    }
  | { type: 'REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL' }
  // ============================================================================
  // Spec 2026-01-19: SET_PROJECT_NAME action for export project name prompt
  // Updates only loadedFileName, does not affect model or other state
  // ============================================================================
  | { type: 'SET_PROJECT_NAME'; fileName: string }
  | { type: 'REORDER_ENTITIES'; entityType: EntityType; entities: AnyEntity[] }
  | { type: 'REORDER_RELATIONSHIPS'; relationshipType: RelationshipType; relationships: AnyRelationship[] }
  // Undo: Restore a diagram's mutable arrays to a previous snapshot
  | { type: 'RESTORE_DIAGRAM_STATE'; diagramId: string; snapshot: DiagramSnapshot };

// Undo: Snapshot of a diagram's mutable arrays
export interface DiagramSnapshot {
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
  decorations: Decoration[];
  label_decorations: LabelDecoration[];
}

// Action types that modify diagram content and should be undoable
const UNDOABLE_ACTION_TYPES: ReadonlySet<string> = new Set([
  'UPDATE_DIAGRAM_NODE', 'UPDATE_DIAGRAM_NODES',
  'ADD_DIAGRAM_NODE', 'ADD_DIAGRAM_NODES',
  'MOVE_NODE_WITH_CASCADE', 'MOVE_NODES_WITH_CASCADE',
  'ADD_DIAGRAM_EDGE', 'ADD_DIAGRAM_EDGES',
  'UPDATE_DIAGRAM_EDGE', 'UPDATE_DIAGRAM_EDGES',
  'UPDATE_DIAGRAM_EDGE_POINTS', 'UPDATE_EDGE_POINT',
  'INSERT_EDGE_POINT', 'UPDATE_EDGE_LABEL_POSITION',
  'ADD_DECORATION', 'ADD_DECORATIONS',
  'UPDATE_DECORATION', 'UPDATE_DECORATIONS', 'DELETE_DECORATION',
  'ADD_LABEL_DECORATION', 'UPDATE_LABEL_DECORATION', 'DELETE_LABEL_DECORATION',
  'DELETE_DIAGRAM_ELEMENTS',
]);

const MAX_UNDO_HISTORY = 50;

// Initial state
// Spec 2026-01-08: Added empty relationshipCellLabels cache
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
//   `currentView` removed -- view is URL-driven now.
const initialState: AppState = {
  model: { ...emptyModel },
  selectedTab: 'Users',
  selectedDiagramId: null,
  loadedFileName: null,
  validationErrors: [],
  isPalettePanelCollapsed: false,
  sectionExpandStates: {},
  paletteSearchQuery: '',
  isInspectorPanelCollapsed: false,
  // Spec 2025-12-24: Default to 'business' domain
  selectedDomain: 'business',
  // Spec 2026-01-08: Empty relationship cell labels cache
  relationshipCellLabels: {},
};

// Entity types that require Application Point synchronization
const SYNC_ENTITY_TYPES: SourceEntityType[] = ['applications', 'app_components', 'services'];

/**
 * Check if an entity type requires Application Point synchronization
 */
function isSyncEntityType(entityType: EntityType): entityType is SourceEntityType {
  return SYNC_ENTITY_TYPES.includes(entityType as SourceEntityType);
}

// Entity types that require Business Point synchronization
const BP_SYNC_ENTITY_TYPES: BusinessSourceEntityType[] = ['business_processes', 'process_activities'];

/**
 * Check if an entity type requires Business Point synchronization
 */
function isBPSyncEntityType(entityType: EntityType): entityType is BusinessSourceEntityType {
  return BP_SYNC_ENTITY_TYPES.includes(entityType as BusinessSourceEntityType);
}

/**
 * Entity types that require cascade delete of relationships
 * These are entity types OTHER than Application Point sync types and Business Point sync types
 * that have dedicated cascade delete functions
 */
type CascadeDeleteEntityType =
  | 'business_users'
  | 'interfaces'
  | 'logical_data_entities'
  | 'physical_data_entities'
  | 'logical_data_attributes'
  | 'physical_data_attributes';

const CASCADE_DELETE_ENTITY_TYPES: CascadeDeleteEntityType[] = [
  'business_users',
  'interfaces',
  'logical_data_entities',
  'physical_data_entities',
  'logical_data_attributes',
  'physical_data_attributes',
];

/**
 * Check if an entity type requires cascade delete of relationships
 */
function isCascadeDeleteEntityType(entityType: EntityType): entityType is CascadeDeleteEntityType {
  return CASCADE_DELETE_ENTITY_TYPES.includes(entityType as CascadeDeleteEntityType);
}

// Counter for generating unique edge point IDs
let edgePointIdCounter = 0;

/**
 * Generate a unique ID for an edge point
 * Task Group 3: Bend Point Insertion
 */
function generateEdgePointId(): string {
  edgePointIdCounter++;
  const timestamp = Date.now();
  return `ep_${timestamp}_${edgePointIdCounter}`;
}

/**
 * Task Group 4: Check if updates contain splittable changes
 * Position changes (pos_x, pos_y), dimension changes (width, height),
 * and style changes should trigger splitting.
 * Selection/z_index changes should NOT trigger splitting.
 */
function hasSplittableChanges(updates: Partial<DiagramNode | DiagramEdge | Decoration>): boolean {
  const nonSplittableKeys = ['z_index', 'selected'];
  const updateKeys = Object.keys(updates);

  // If any key is NOT in the non-splittable list, we have splittable changes
  return updateKeys.some(key => !nonSplittableKeys.includes(key));
}

/**
 * Spec 2026-01-08: Build relationship cell labels from model data.
 * Iterates all relationship types and resolves labels for FK columns.
 *
 * @param metaModel - The meta model containing entities and relationships
 * @returns Record of cache keys to labels
 */
function buildRelationshipCellLabelsFromModel(
  metaModel: ArchitectureModel['metaModel']
): Record<string, string> {
  const labels: Record<string, string> = {};
  const { entities, relationships } = metaModel;

  // Iterate each relationship type that has FK columns defined
  for (const [relationshipKey, fkColumns] of Object.entries(RELATIONSHIP_FK_COLUMNS)) {
    // Get the relationship array - check both entities and relationships objects
    // Some "relationships" like interactions are stored in entities
    let relationshipArray: unknown[] | undefined;

    if (relationshipKey === 'interactions') {
      relationshipArray = entities.interactions;
    } else {
      relationshipArray = (relationships as unknown as Record<string, unknown[]>)[relationshipKey];
    }

    if (!relationshipArray || !Array.isArray(relationshipArray)) continue;

    // Iterate each row in the relationship array
    for (const row of relationshipArray) {
      const rowObj = row as Record<string, unknown>;
      const rowId = rowObj.id as string;
      if (!rowId) continue;

      // Resolve label for each FK column
      for (const columnKey of fkColumns) {
        const fkValue = rowObj[columnKey];
        if (typeof fkValue === 'string' && fkValue) {
          const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);
          const label = resolveRelationshipCellLabel(columnKey, fkValue, entities);
          if (label) {
            labels[cacheKey] = label;
          }
        }
      }
    }
  }

  return labels;
}

// Reducer function
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LOAD_MODEL': {
      // Ensure all diagrams have view_quarter set and decorations array initialized
      // Z-Index Legacy Support: Assign default z_index values to elements that don't have them
      const diagramsWithDefaults = action.payload.diagrams.map(diagram => {
        // Ensure all nodes have z_index (use array index offset for deterministic ordering)
        const nodesWithZIndex = (diagram.diagram_nodes || []).map((node, index) => ({
          ...node,
          z_index: node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE + index,
        }));

        // Ensure all edges have z_index
        const edgesWithZIndex = (diagram.diagram_edges || []).map((edge, index) => ({
          ...edge,
          z_index: edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE + index,
        }));

        // Ensure all decorations have z_index (shape decorations get 50, line decorations get 120)
        const decorationsWithZIndex = (diagram.decorations || []).map((dec, index) => {
          const defaultZ = isShapeDecoration(dec)
            ? Z_INDEX_DEFAULTS.BOX_DECORATION
            : Z_INDEX_DEFAULTS.LINE_DECORATION;
          return {
            ...dec,
            z_index: dec.z_index ?? defaultZ + index,
          };
        });

        return {
          ...diagram,
          view_quarter: diagram.view_quarter || getDefaultViewQuarter(),
          diagram_nodes: nodesWithZIndex,
          diagram_edges: edgesWithZIndex,
          decorations: decorationsWithZIndex,
          // Spec 2025-12-31 (A5): Ensure label_decorations array is initialized
          label_decorations: diagram.label_decorations || [],
        };
      })

      // Migrate Logical Attribute data types from SQL to OAS format
      // This ensures backward compatibility when loading diagrams with old SQL-style types
      const migratedLogicalAttributes = migrateLogicalAttributes(
        action.payload.metaModel.entities.logical_data_attributes
      );

      // Ensure endpoints array exists (backward compatibility for old files)
      // Also ensure app_business_points array exists
      const entitiesWithDefaults = {
        ...action.payload.metaModel.entities,
        logical_data_attributes: migratedLogicalAttributes,
        endpoints: action.payload.metaModel.entities.endpoints || [],
        app_business_points: action.payload.metaModel.entities.app_business_points || [],
      };

      // Spec: Fix Interface Composite Rendering (Task Group 3.3)
      // Normalize interface_logical_entities before reconcileApplicationPoints
      // This ensures legacy data with logical_entity_id or physical_entity_id fields
      // is migrated to the new dataEntityPointId format
      const normalizedInterfaceLogicalEntities = normalizeInterfaceLogicalEntities(
        action.payload.metaModel.relationships.interface_logical_entities || []
      );
      const relationshipsWithNormalization = {
        ...action.payload.metaModel.relationships,
        interface_logical_entities: normalizedInterfaceLogicalEntities,
      };

      // Create a metaModel with migrated logical attributes, endpoints, and normalized relationships
      const metaModelWithMigratedTypes = {
        ...action.payload.metaModel,
        entities: entitiesWithDefaults,
        relationships: relationshipsWithNormalization,
      };

      // Reconcile Application Points, Business Points, and App Business Points after loading
      const apReconciledMetaModel = reconcileApplicationPoints(metaModelWithMigratedTypes);
      const bpReconciledMetaModel = reconcileBusinessPoints(apReconciledMetaModel);
      const reconciledMetaModel = reconcileAppBusinessPoints(bpReconciledMetaModel);

      // Spec 2026-01-08: Build relationship cell labels from loaded model
      const relationshipCellLabels = buildRelationshipCellLabelsFromModel(reconciledMetaModel);

      return {
        ...state,
        model: {
          metaModel: reconciledMetaModel,
          diagrams: diagramsWithDefaults,
        },
        loadedFileName: action.fileName,
        selectedDiagramId: action.payload.diagrams.length > 0 ? action.payload.diagrams[0].id : null,
        validationErrors: [],
        relationshipCellLabels,
      };
    }

    case 'SELECT_TAB':
      return {
        ...state,
        selectedTab: action.payload,
      };

    case 'SELECT_DIAGRAM':
      return {
        ...state,
        selectedDiagramId: action.payload,
      };

    // Spec 2025-12-24: SET_DOMAIN action handler
    case 'SET_DOMAIN': {
      // Validate domain using isArchitectureDomain type guard
      if (!isArchitectureDomain(action.payload)) {
        return state; // Ignore invalid domain, don't crash
      }

      // Get the tabs for the new domain
      const newDomainTabs = domainGroupings[action.payload] || [];

      // Check if current selectedTab is valid for the new domain
      const currentTabIsValid = newDomainTabs.includes(state.selectedTab);

      // If current tab is not valid for new domain, auto-select first tab of new domain
      const newSelectedTab = currentTabIsValid
        ? state.selectedTab
        : (newDomainTabs[0] || state.selectedTab);

      return {
        ...state,
        selectedDomain: action.payload,
        selectedTab: newSelectedTab,
      };
    }

    // ============================================================================
    // Spec 2026-01-19: SET_PROJECT_NAME action handler
    // Updates only loadedFileName, does not modify model or other state
    // ============================================================================
    case 'SET_PROJECT_NAME':
      return {
        ...state,
        loadedFileName: action.fileName,
      };

    case 'UPDATE_ENTITY': {
      const entityArray = state.model.metaModel.entities[action.entityType] as AnyEntity[];
      const updatedArray = entityArray.map((item) =>
        item.id === action.entity.id ? action.entity : item
      );

      // Find the old entity to check if name changed
      const oldEntity = entityArray.find((item) => item.id === action.entity.id);
      const newName = (action.entity as { name?: string }).name || '';
      const oldName = oldEntity ? (oldEntity as { name?: string }).name || '' : '';
      const nameChanged = oldName !== newName;

      // Check if this entity type requires AP synchronization and if name changed
      if (isSyncEntityType(action.entityType) && nameChanged) {
        // Sync the Application Point name (or create AP if missing)
        const updatedApplicationPoints = syncApplicationPointNameForEntity(
          state.model.metaModel.entities,
          action.entityType,
          action.entity.id,
          newName
        );

        // Also sync the App Business Point name
        const updatedAppBusinessPoints = syncAppBusinessPointNameForEntity(
          state.model.metaModel.entities,
          action.entityType as ABPSourceEntityType,
          action.entity.id,
          newName
        );

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: {
                ...state.model.metaModel.entities,
                [action.entityType]: updatedArray,
                application_points: updatedApplicationPoints,
                app_business_points: updatedAppBusinessPoints,
              },
            },
          },
        };
      }

      // Check if this entity type requires BP synchronization and if name changed
      if (isBPSyncEntityType(action.entityType) && nameChanged) {
        // Sync the Business Point name (or create BP if missing)
        const updatedBusinessPoints = syncBusinessPointNameForEntity(
          {
            ...state.model.metaModel.entities,
            [action.entityType]: updatedArray,
          },
          action.entityType,
          action.entity.id,
          newName
        );

        // Also sync the App Business Point name
        const updatedAppBusinessPoints = syncAppBusinessPointNameForEntity(
          state.model.metaModel.entities,
          action.entityType as ABPSourceEntityType,
          action.entity.id,
          newName
        );

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: {
                ...state.model.metaModel.entities,
                [action.entityType]: updatedArray,
                business_points: updatedBusinessPoints,
                app_business_points: updatedAppBusinessPoints,
              },
            },
          },
        };
      }

      // Check if this entity type requires ABP-only synchronization (interfaces)
      // Interfaces are ABP source types but not AP or BP sync types
      if (isABPSourceEntityType(action.entityType) && nameChanged && action.entityType === 'interfaces') {
        const updatedAppBusinessPoints = syncAppBusinessPointNameForEntity(
          state.model.metaModel.entities,
          action.entityType,
          action.entity.id,
          newName
        );

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: {
                ...state.model.metaModel.entities,
                [action.entityType]: updatedArray,
                app_business_points: updatedAppBusinessPoints,
              } as MetaModelEntities,
            },
          },
        };
      }

      // Standard entity update (no AP/BP/ABP sync needed)
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            entities: {
              ...state.model.metaModel.entities,
              [action.entityType]: updatedArray,
            },
          },
        },
      };
    }

    case 'ADD_ENTITY': {
      const entityArray = state.model.metaModel.entities[action.entityType] as AnyEntity[];

      // Check if this entity type requires AP synchronization
      if (isSyncEntityType(action.entityType)) {
        // Create corresponding Application Point
        // Cast to MinimalSourceEntity which has id, name, and optional application_id
        const minimalEntity = action.entity as unknown as MinimalSourceEntity;
        const newAP = createApplicationPointFromEntity(minimalEntity, action.entityType);

        // Also create corresponding App Business Point
        const minimalABPEntity = action.entity as unknown as MinimalABPSourceEntity;
        const newABP = createAppBusinessPointFromEntity(minimalABPEntity, action.entityType as ABPSourceEntityType);

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: {
                ...state.model.metaModel.entities,
                [action.entityType]: [...entityArray, action.entity],
                application_points: [...state.model.metaModel.entities.application_points, newAP],
                app_business_points: [...(state.model.metaModel.entities.app_business_points || []), newABP],
              },
            },
          },
        };
      }

      // Check if this entity type requires BP synchronization
      if (isBPSyncEntityType(action.entityType)) {
        // Create corresponding Business Point
        const minimalEntity = action.entity as unknown as MinimalBusinessSourceEntity;
        const newBP = createBusinessPointFromEntity(minimalEntity, action.entityType);

        // Also create corresponding App Business Point
        const minimalABPEntity = action.entity as unknown as MinimalABPSourceEntity;
        const newABP = createAppBusinessPointFromEntity(minimalABPEntity, action.entityType as ABPSourceEntityType);

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: {
                ...state.model.metaModel.entities,
                [action.entityType]: [...entityArray, action.entity],
                business_points: [...state.model.metaModel.entities.business_points, newBP],
                app_business_points: [...(state.model.metaModel.entities.app_business_points || []), newABP],
              },
            },
          },
        };
      }

      // Check if this entity type requires ABP-only synchronization (interfaces)
      if (isABPSourceEntityType(action.entityType) && action.entityType === 'interfaces') {
        const minimalABPEntity = action.entity as unknown as MinimalABPSourceEntity;
        const newABP = createAppBusinessPointFromEntity(minimalABPEntity, action.entityType);

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: {
                ...state.model.metaModel.entities,
                [action.entityType]: [...entityArray, action.entity],
                app_business_points: [...(state.model.metaModel.entities.app_business_points || []), newABP],
              } as MetaModelEntities,
            },
          },
        };
      }

      // Standard entity add (no AP/BP/ABP sync needed)
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            entities: {
              ...state.model.metaModel.entities,
              [action.entityType]: [...entityArray, action.entity],
            },
          },
        },
      };
    }

    case 'DELETE_ENTITY': {
      const entityArray = state.model.metaModel.entities[action.entityType] as AnyEntity[];
      const filteredArray = entityArray.filter((item) => item.id !== action.id);

      // Check if this entity type requires AP synchronization (Application, AppComponent, Service)
      if (isSyncEntityType(action.entityType)) {
        // Cascade delete Application Point and related records
        const { entities: apUpdatedEntities, relationships: apUpdatedRelationships } =
          cascadeDeleteForSourceEntity(
            action.id,
            action.entityType,
            {
              ...state.model.metaModel.entities,
              [action.entityType]: filteredArray,
            },
            state.model.metaModel.relationships
          );

        // Also cascade delete App Business Point
        const { entities: abpUpdatedEntities, relationships: abpUpdatedRelationships } =
          cascadeDeleteForABPSourceEntity(
            action.id,
            action.entityType as ABPSourceEntityType,
            apUpdatedEntities,
            apUpdatedRelationships
          );

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              entities: abpUpdatedEntities,
              relationships: abpUpdatedRelationships,
            },
          },
        };
      }

      // Check if this entity type requires BP synchronization (BusinessProcess, ProcessActivity)
      if (isBPSyncEntityType(action.entityType)) {
        // Cascade delete Business Point and related records
        // This handles deletion of business_user_business_points and application_point_business_points
        // via the corresponding Business Point
        const { entities: bpUpdatedEntities, relationships: bpUpdatedRelationships } =
          cascadeDeleteForBusinessSourceEntity(
            action.id,
            action.entityType,
            {
              ...state.model.metaModel.entities,
              [action.entityType]: filteredArray,
            },
            state.model.metaModel.relationships
          );

        // Also cascade delete App Business Point
        const { entities: abpUpdatedEntities, relationships: abpUpdatedRelationships } =
          cascadeDeleteForABPSourceEntity(
            action.id,
            action.entityType as ABPSourceEntityType,
            bpUpdatedEntities,
            bpUpdatedRelationships
          );

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              entities: abpUpdatedEntities,
              relationships: abpUpdatedRelationships,
            },
          },
        };
      }

      // Check if this entity type requires cascade delete of relationships
      if (isCascadeDeleteEntityType(action.entityType)) {
        let updatedRelationships = state.model.metaModel.relationships;
        let updatedEntities: MetaModelEntities = {
          ...state.model.metaModel.entities,
          [action.entityType]: filteredArray,
        } as MetaModelEntities;

        switch (action.entityType) {
          case 'business_users':
            updatedRelationships = cascadeDeleteBusinessUser(action.id, updatedRelationships);
            break;
          // Interface cascade delete - removes child endpoints and interface_logical_entities
          case 'interfaces': {
            const result = cascadeDeleteInterface(
              action.id,
              updatedEntities,
              updatedRelationships
            );
            updatedEntities = result.entities;
            updatedRelationships = result.relationships;

            // Also cascade delete App Business Point for interfaces
            const { entities: abpUpdatedEntities, relationships: abpUpdatedRelationships } =
              cascadeDeleteForABPSourceEntity(
                action.id,
                'interfaces',
                updatedEntities,
                updatedRelationships
              );
            updatedEntities = abpUpdatedEntities;
            updatedRelationships = abpUpdatedRelationships;
            break;
          }
          case 'logical_data_entities':
            updatedRelationships = cascadeDeleteLogicalDataEntity(action.id, updatedRelationships);
            break;
          case 'physical_data_entities':
            updatedRelationships = cascadeDeletePhysicalDataEntity(action.id, updatedRelationships);
            break;
          case 'logical_data_attributes':
            updatedRelationships = cascadeDeleteLogicalDataAttribute(action.id, updatedRelationships);
            break;
          case 'physical_data_attributes':
            updatedRelationships = cascadeDeletePhysicalDataAttribute(action.id, updatedRelationships);
            break;
        }

        return {
          ...state,
          model: {
            ...state.model,
            metaModel: {
              ...state.model.metaModel,
              entities: updatedEntities,
              relationships: updatedRelationships,
            },
          },
        };
      }

      // Standard entity delete (no cascade needed)
      // Build updated entities with type assertion to handle computed property
      const updatedEntities: MetaModelEntities = {
        ...state.model.metaModel.entities,
        [action.entityType]: filteredArray,
      } as MetaModelEntities;

      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            entities: updatedEntities,
          },
        },
      };
    }

    case 'UPDATE_RELATIONSHIP': {
      const relationshipArray = state.model.metaModel.relationships[action.relationshipType] as AnyRelationship[];
      const updatedArray = relationshipArray.map((item) =>
        item.id === action.relationship.id ? action.relationship : item
      );
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            relationships: {
              ...state.model.metaModel.relationships,
              [action.relationshipType]: updatedArray,
            },
          },
        },
      };
    }

    case 'ADD_RELATIONSHIP': {
      const relationshipArray = state.model.metaModel.relationships[action.relationshipType] as AnyRelationship[];
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            relationships: {
              ...state.model.metaModel.relationships,
              [action.relationshipType]: [...relationshipArray, action.relationship],
            },
          },
        },
      };
    }

    case 'DELETE_RELATIONSHIP': {
      const relationshipArray = state.model.metaModel.relationships[action.relationshipType] as AnyRelationship[];
      const filteredArray = relationshipArray.filter((item) => item.id !== action.id);
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            relationships: {
              ...state.model.metaModel.relationships,
              [action.relationshipType]: filteredArray,
            },
          },
        },
      };
    }

    case 'SET_VALIDATION_ERRORS':
      return {
        ...state,
        validationErrors: action.payload,
      };

    case 'RESET_MODEL':
      return {
        ...initialState,
      };

    // ============================================================================
    // Spec 2026-01-08: Relationship Cell Label Cache Actions
    // ============================================================================

    case 'SET_RELATIONSHIP_CELL_LABEL': {
      const { relationshipKey, rowId, columnKey, label } = action.payload;
      const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);

      return {
        ...state,
        relationshipCellLabels: {
          ...state.relationshipCellLabels,
          [cacheKey]: label,
        },
      };
    }

    case 'CLEAR_RELATIONSHIP_CELL_LABELS_FOR_RELATIONSHIP': {
      const { relationshipKey } = action.payload;
      const prefix = `${relationshipKey}:`;

      // Filter out all cache entries whose key starts with the relationshipKey prefix
      const filteredLabels: Record<string, string> = {};
      for (const [key, value] of Object.entries(state.relationshipCellLabels)) {
        if (!key.startsWith(prefix)) {
          filteredLabels[key] = value;
        }
      }

      return {
        ...state,
        relationshipCellLabels: filteredLabels,
      };
    }

    case 'REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL': {
      // Clear existing cache and rebuild from model data
      const relationshipCellLabels = buildRelationshipCellLabelsFromModel(state.model.metaModel);

      return {
        ...state,
        relationshipCellLabels,
      };
    }

    // ============================================================================
    // IMPORT_META_MODEL: Append/Overwrite imported entities and relationships
    // Spec 2026-01-11: Redesign Import as XLSX - supports both Append and Overwrite modes
    // ============================================================================
    case 'IMPORT_META_MODEL': {
      const {
        entities: newEntities,
        relationships: newRelationships,
        updatedEntities: updatedEntityRows,
        updatedRelationships: updatedRelationshipRows,
        // mode is passed but currently unused - kept for future use
      } = action.payload;

      // Build updated entities - combine existing with new and updated rows
      const finalEntities: Record<string, unknown[]> = { ...state.model.metaModel.entities };

      // Add new entities
      for (const [entityType, newRows] of Object.entries(newEntities)) {
        if (newRows.length > 0 && entityType in finalEntities) {
          const existing = (finalEntities[entityType] as unknown[]) || [];
          finalEntities[entityType] = [...existing, ...newRows];
        }
      }

      // Apply updated entities (Overwrite mode) - replace existing rows by ID
      if (updatedEntityRows) {
        for (const [entityType, updatedRows] of Object.entries(updatedEntityRows)) {
          if (updatedRows.length > 0 && entityType in finalEntities) {
            const existingArray = finalEntities[entityType] as Record<string, unknown>[];
            const updatedById = new Map(
              updatedRows.map((row) => [(row as Record<string, unknown>).id as string, row])
            );
            // Replace existing rows with updated ones
            finalEntities[entityType] = existingArray.map((row) => {
              const rowId = row.id as string;
              return updatedById.has(rowId) ? updatedById.get(rowId) : row;
            });
          }
        }
      }

      // Build updated relationships - combine existing with new and updated rows
      const finalRelationships: Record<string, unknown[]> = { ...state.model.metaModel.relationships };

      // Add new relationships
      for (const [relType, newRows] of Object.entries(newRelationships)) {
        if (newRows.length > 0 && relType in finalRelationships) {
          const existing = (finalRelationships[relType] as unknown[]) || [];
          finalRelationships[relType] = [...existing, ...newRows];
        }
      }

      // Apply updated relationships (Overwrite mode) - replace existing rows by ID
      if (updatedRelationshipRows) {
        for (const [relType, updatedRows] of Object.entries(updatedRelationshipRows)) {
          if (updatedRows.length > 0 && relType in finalRelationships) {
            const existingArray = finalRelationships[relType] as Record<string, unknown>[];
            const updatedById = new Map(
              updatedRows.map((row) => [(row as Record<string, unknown>).id as string, row])
            );
            // Replace existing rows with updated ones
            finalRelationships[relType] = existingArray.map((row) => {
              const rowId = row.id as string;
              return updatedById.has(rowId) ? updatedById.get(rowId) : row;
            });
          }
        }
      }

      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            entities: finalEntities as unknown as MetaModelEntities,
            relationships: finalRelationships as unknown as ArchitectureModel['metaModel']['relationships'],
          },
        },
      };
    }

    // ============================================================================
    // Spec 2026-03-05: MERGE_IMPORT - Additive merge of imported entities,
    // relationships, and diagrams into the current model.
    // Used by the cherry-pick merge flow (Flow B Option 2 / Flow C).
    // This is purely additive: no existing data is deleted or overwritten.
    // ============================================================================
    case 'MERGE_IMPORT': {
      const mergePayload = action.payload;

      // Build updated entities - spread existing and append new items
      const mergeEntities: Record<string, unknown[]> = { ...state.model.metaModel.entities };
      for (const [entityType, newItems] of Object.entries(mergePayload.entities)) {
        if (Array.isArray(newItems) && newItems.length > 0) {
          const existing = (mergeEntities[entityType] as unknown[]) || [];
          mergeEntities[entityType] = [...existing, ...newItems];
        }
      }

      // Build updated relationships - spread existing and append new items
      const mergeRelationships: Record<string, unknown[]> = { ...state.model.metaModel.relationships };
      for (const [relType, newItems] of Object.entries(mergePayload.relationships)) {
        if (Array.isArray(newItems) && newItems.length > 0) {
          const existing = (mergeRelationships[relType] as unknown[]) || [];
          mergeRelationships[relType] = [...existing, ...newItems];
        }
      }

      // Append diagrams (purely additive)
      const mergeDiagrams = mergePayload.diagrams.length > 0
        ? [...state.model.diagrams, ...mergePayload.diagrams]
        : state.model.diagrams;

      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            entities: mergeEntities as unknown as MetaModelEntities,
            relationships: mergeRelationships as unknown as ArchitectureModel['metaModel']['relationships'],
          },
          diagrams: mergeDiagrams,
        },
      };
    }

    // ============================================================================
    // Task Group 4: UPDATE_DIAGRAM_NODE with temporal splitting support
    // ============================================================================
    case 'UPDATE_DIAGRAM_NODE': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const nodeIndex = diagram.diagram_nodes.findIndex(n => n.id === action.nodeId);
      if (nodeIndex === -1) return state;

      const node = diagram.diagram_nodes[nodeIndex];
      const viewQuarter = diagram.view_quarter || getDefaultViewQuarter();

      // Check if we need to trigger temporal splitting
      // Only split if: (1) node has temporal fields, (2) editing outside validity, (3) changes are splittable
      if (shouldTriggerSplit(node, viewQuarter) && hasSplittableChanges(action.updates)) {
        // Split the node into old and new versions
        const { originalNode, newVersion } = splitDiagramNode(node, viewQuarter, action.updates);

        // Replace old node with modified original, add new version
        const updatedNodes = [
          ...diagram.diagram_nodes.filter(n => n.id !== action.nodeId),
          originalNode,
          newVersion,
        ];

        const updatedDiagrams = [...state.model.diagrams];
        updatedDiagrams[diagramIndex] = {
          ...diagram,
          diagram_nodes: updatedNodes,
        };

        return {
          ...state,
          model: {
            ...state.model,
            diagrams: updatedDiagrams,
          },
        };
      }

      // Normal update (no split needed) - existing behavior
      const updatedNodes = [...diagram.diagram_nodes];
      updatedNodes[nodeIndex] = {
        ...updatedNodes[nodeIndex],
        ...action.updates,
      };

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Task Group 4: UPDATE_DIAGRAM_EDGE with temporal splitting support
    // ============================================================================
    case 'UPDATE_DIAGRAM_EDGE': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const edgeIndex = diagram.diagram_edges.findIndex(e => e.id === action.edgeId);
      if (edgeIndex === -1) return state;

      const edge = diagram.diagram_edges[edgeIndex];
      const viewQuarter = diagram.view_quarter || getDefaultViewQuarter();

      // Check if we need to trigger temporal splitting
      if (shouldTriggerSplit(edge, viewQuarter) && hasSplittableChanges(action.updates)) {
        // Split the edge into old and new versions
        const { originalEdge, newVersion } = splitDiagramEdge(edge, viewQuarter, action.updates);

        // Replace old edge with modified original, add new version
        const updatedEdges = [
          ...diagram.diagram_edges.filter(e => e.id !== action.edgeId),
          originalEdge,
          newVersion,
        ];

        const updatedDiagrams = [...state.model.diagrams];
        updatedDiagrams[diagramIndex] = {
          ...diagram,
          diagram_edges: updatedEdges,
        };

        return {
          ...state,
          model: {
            ...state.model,
            diagrams: updatedDiagrams,
          },
        };
      }

      // Normal update (no split needed) - existing behavior
      const updatedEdges = [...diagram.diagram_edges];
      updatedEdges[edgeIndex] = {
        ...updatedEdges[edgeIndex],
        ...action.updates,
      };

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_DIAGRAM_NODES': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const nodeIdSet = new Set(action.nodeIds);

      const updatedNodes = diagram.diagram_nodes.map(node => {
        if (nodeIdSet.has(node.id)) {
          return {
            ...node,
            ...action.updates,
          };
        }
        return node;
      });

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_DIAGRAM_EDGES': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const edgeIdSet = new Set(action.edgeIds);

      const updatedEdges = diagram.diagram_edges.map(edge => {
        if (edgeIdSet.has(edge.id)) {
          return {
            ...edge,
            ...action.updates,
          };
        }
        return edge;
      });

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_DIAGRAM_EDGE_POINTS': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const edgeIndex = diagram.diagram_edges.findIndex(e => e.id === action.edgeId);
      if (edgeIndex === -1) return state;

      const updatedEdges = [...diagram.diagram_edges];
      updatedEdges[edgeIndex] = {
        ...updatedEdges[edgeIndex],
        edge_points: action.edgePoints,
      };

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Task Group 4: MOVE_NODE_WITH_CASCADE with temporal splitting support
    // ============================================================================
    case 'MOVE_NODE_WITH_CASCADE': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const nodeIndex = diagram.diagram_nodes.findIndex(n => n.id === action.nodeId);
      if (nodeIndex === -1) return state;

      const targetNode = diagram.diagram_nodes[nodeIndex];
      const { dx, dy } = action;
      const viewQuarter = diagram.view_quarter || getDefaultViewQuarter();

      // Check if target node needs temporal splitting
      // Position changes (dx, dy) are splittable changes
      const needsSplit = shouldTriggerSplit(targetNode, viewQuarter);

      // IMPORTANT: Check attachment BEFORE moving the node (use original position)
      // Collect all edge points that are attached to the target node or its descendants
      const attachedPointsMap = new Map<string, Set<string>>(); // edgeId -> Set of pointIds

      // Check attachment for the main node
      for (const edge of diagram.diagram_edges) {
        for (const point of edge.edge_points || []) {
          if (isPointAttachedToNode(point, targetNode)) {
            if (!attachedPointsMap.has(edge.id)) {
              attachedPointsMap.set(edge.id, new Set());
            }
            attachedPointsMap.get(edge.id)!.add(point.id);
          }
        }
      }

      // Get all descendant nodes
      const descendants = getDescendantNodes(action.nodeId, diagram.diagram_nodes);

      // Check attachment for descendant nodes
      for (const descendant of descendants) {
        for (const edge of diagram.diagram_edges) {
          for (const point of edge.edge_points || []) {
            if (isPointAttachedToNode(point, descendant)) {
              if (!attachedPointsMap.has(edge.id)) {
                attachedPointsMap.set(edge.id, new Set());
              }
              attachedPointsMap.get(edge.id)!.add(point.id);
            }
          }
        }
      }

      // Handle node updates (with potential splitting)
      let updatedNodes: DiagramNode[];

      if (needsSplit) {
        // Split the target node
        const { originalNode, newVersion } = splitDiagramNode(targetNode, viewQuarter, {
          pos_x: targetNode.pos_x + dx,
          pos_y: targetNode.pos_y + dy,
        });

        // Start with nodes excluding the target
        updatedNodes = diagram.diagram_nodes.filter(n => n.id !== action.nodeId);

        // Add the split versions
        updatedNodes.push(originalNode, newVersion);

        // Update descendants (move them without splitting for simplicity)
        updatedNodes = updatedNodes.map(node => {
          if (descendants.some(d => d.id === node.id)) {
            return {
              ...node,
              pos_x: node.pos_x + dx,
              pos_y: node.pos_y + dy,
            };
          }
          return node;
        });
      } else {
        // Normal update without splitting
        updatedNodes = diagram.diagram_nodes.map(node => {
          // Update target node
          if (node.id === action.nodeId) {
            return {
              ...node,
              pos_x: node.pos_x + dx,
              pos_y: node.pos_y + dy,
            };
          }

          // Update descendants
          if (descendants.some(d => d.id === node.id)) {
            return {
              ...node,
              pos_x: node.pos_x + dx,
              pos_y: node.pos_y + dy,
            };
          }

          return node;
        });
      }

      // Update all attached edge points with label adjustment
      const updatedEdges = diagram.diagram_edges.map(edge => {
        const attachedPointIds = attachedPointsMap.get(edge.id);
        if (!attachedPointIds || attachedPointIds.size === 0) {
          return edge;
        }

        // Track which point indices are moving for this edge
        const edgePoints = edge.edge_points || [];
        const movingPointIndices: number[] = [];

        const updatedEdgePoints = edgePoints.map((point, index) => {
          if (attachedPointIds.has(point.id)) {
            movingPointIndices.push(index);
            return {
              ...point,
              pos_x: point.pos_x + dx,
              pos_y: point.pos_y + dy,
            };
          }
          return point;
        });

        // Calculate label adjustment for 2-point edges
        let updatedLabelPosX = edge.label_pos_x;
        let updatedLabelPosY = edge.label_pos_y;

        if (edgePoints.length === 2 && edge.label_pos_x !== undefined && edge.label_pos_y !== undefined) {
          if (movingPointIndices.length === 1) {
            // One endpoint moved - half adjustment
            updatedLabelPosX = edge.label_pos_x + dx / 2;
            updatedLabelPosY = edge.label_pos_y + dy / 2;
          } else if (movingPointIndices.length === 2) {
            // Both endpoints moved by same delta - full translation
            updatedLabelPosX = edge.label_pos_x + dx;
            updatedLabelPosY = edge.label_pos_y + dy;
          }
        }
        // For 3+ point edges, label position is not auto-adjusted

        return {
          ...edge,
          edge_points: updatedEdgePoints,
          label_pos_x: updatedLabelPosX,
          label_pos_y: updatedLabelPosY,
        };
      });

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'MOVE_NODES_WITH_CASCADE': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const { nodeIds, dx, dy } = action;

      // Collect all nodes to move: selected nodes + all their descendants
      const allNodesToMove = new Set<string>(nodeIds);

      // Add descendants of each selected node
      for (const nodeId of nodeIds) {
        const descendants = getDescendantNodes(nodeId, diagram.diagram_nodes);
        for (const descendant of descendants) {
          allNodesToMove.add(descendant.id);
        }
      }

      // IMPORTANT: Check attachment BEFORE moving nodes (use original positions)
      // Collect all edge points that are attached to ANY node being moved
      const attachedPointsMap = new Map<string, Set<string>>(); // edgeId -> Set of pointIds

      for (const nodeId of allNodesToMove) {
        const node = diagram.diagram_nodes.find(n => n.id === nodeId);
        if (!node) continue;

        for (const edge of diagram.diagram_edges) {
          for (const point of edge.edge_points || []) {
            if (isPointAttachedToNode(point, node)) {
              if (!attachedPointsMap.has(edge.id)) {
                attachedPointsMap.set(edge.id, new Set());
              }
              attachedPointsMap.get(edge.id)!.add(point.id);
            }
          }
        }
      }

      // Now update all nodes that should move
      const updatedNodes = diagram.diagram_nodes.map(node => {
        if (allNodesToMove.has(node.id)) {
          return {
            ...node,
            pos_x: node.pos_x + dx,
            pos_y: node.pos_y + dy,
          };
        }
        return node;
      });

      // Update all attached edge points with label adjustment
      const updatedEdges = diagram.diagram_edges.map(edge => {
        const attachedPointIds = attachedPointsMap.get(edge.id);
        if (!attachedPointIds || attachedPointIds.size === 0) {
          return edge;
        }

        // Track which point indices are moving for this edge
        const edgePoints = edge.edge_points || [];
        const movingPointIndices: number[] = [];

        const updatedEdgePoints = edgePoints.map((point, index) => {
          if (attachedPointIds.has(point.id)) {
            movingPointIndices.push(index);
            return {
              ...point,
              pos_x: point.pos_x + dx,
              pos_y: point.pos_y + dy,
            };
          }
          return point;
        });

        // Calculate label adjustment for 2-point edges
        let updatedLabelPosX = edge.label_pos_x;
        let updatedLabelPosY = edge.label_pos_y;

        if (edgePoints.length === 2 && edge.label_pos_x !== undefined && edge.label_pos_y !== undefined) {
          if (movingPointIndices.length === 1) {
            // One endpoint moved - half adjustment
            updatedLabelPosX = edge.label_pos_x + dx / 2;
            updatedLabelPosY = edge.label_pos_y + dy / 2;
          } else if (movingPointIndices.length === 2) {
            // Both endpoints moved by same delta - full translation
            updatedLabelPosX = edge.label_pos_x + dx;
            updatedLabelPosY = edge.label_pos_y + dy;
          }
        }
        // For 3+ point edges, label position is not auto-adjusted

        return {
          ...edge,
          edge_points: updatedEdgePoints,
          label_pos_x: updatedLabelPosX,
          label_pos_y: updatedLabelPosY,
        };
      });

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Task Group 5: DELETE_DIAGRAM_ELEMENTS with User Interaction cascade logic
    // Spec 2025-12-31 (A5): Added labelDecorationIds for label decoration deletion
    // ============================================================================
    case 'DELETE_DIAGRAM_ELEMENTS': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const { nodeIds, edgeIds, decorationIds = [], labelDecorationIds = [] } = action;

      // Create sets for efficient lookup
      const nodeIdsToDelete = new Set(nodeIds);
      const edgeIdsToDelete = new Set(edgeIds);
      const decorationIdsToDelete = new Set(decorationIds);
      const labelDecorationIdsToDelete = new Set(labelDecorationIds);

      // Find edges that reference deleted nodes (cascade deletion)
      // These edges should be deleted even if not explicitly selected
      for (const edge of diagram.diagram_edges) {
        if (nodeIdsToDelete.has(edge.source_node_id) || nodeIdsToDelete.has(edge.target_node_id)) {
          edgeIdsToDelete.add(edge.id);
        }
      }

      // Task Group 5: Cascade delete USER_LINK when MAIN edge is deleted
      // For each explicitly selected edge, check if it's a MAIN USER_INTERACTION edge
      // If so, cascade delete any orphaned USER_LINK with the same interaction_id
      for (const edgeId of edgeIds) {
        const edge = diagram.diagram_edges.find(e => e.id === edgeId);
        if (edge) {
          const cascadeEdge = shouldCascadeDeleteUserLink(edge, diagram.diagram_edges);
          if (cascadeEdge) {
            edgeIdsToDelete.add(cascadeEdge.id);
          }
        }
      }

      // Spec 2025-12-31 (A5): Also delete label decorations attached to deleted nodes/edges
      const labelDecorations = diagram.label_decorations || [];
      for (const labelDec of labelDecorations) {
        if (labelDec.targetKind === 'NODE' && nodeIdsToDelete.has(labelDec.targetId)) {
          labelDecorationIdsToDelete.add(labelDec.id);
        } else if (labelDec.targetKind === 'EDGE' && edgeIdsToDelete.has(labelDec.targetId)) {
          labelDecorationIdsToDelete.add(labelDec.id);
        }
      }

      // Remove nodes
      const updatedNodes = diagram.diagram_nodes.filter(
        node => !nodeIdsToDelete.has(node.id)
      );

      // Remove edges (including cascaded ones)
      const updatedEdges = diagram.diagram_edges.filter(
        edge => !edgeIdsToDelete.has(edge.id)
      );

      // Remove decorations
      const updatedDecorations = (diagram.decorations || []).filter(
        decoration => !decorationIdsToDelete.has(decoration.id)
      );

      // Remove label decorations
      const updatedLabelDecorations = labelDecorations.filter(
        labelDec => !labelDecorationIdsToDelete.has(labelDec.id)
      );

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
        diagram_edges: updatedEdges,
        decorations: updatedDecorations,
        label_decorations: updatedLabelDecorations,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_EDGE_POINT': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const edgeIndex = diagram.diagram_edges.findIndex(e => e.id === action.edgeId);
      if (edgeIndex === -1) return state;

      const edge = diagram.diagram_edges[edgeIndex];
      const edgePoints = edge.edge_points || [];

      // Validate pointIndex
      if (action.pointIndex < 0 || action.pointIndex >= edgePoints.length) {
        return state;
      }

      // Get old position to calculate delta for label adjustment
      const oldPoint = edgePoints[action.pointIndex];
      const dx = action.pos_x - oldPoint.pos_x;
      const dy = action.pos_y - oldPoint.pos_y;

      // Update the specific edge point
      const updatedEdgePoints = edgePoints.map((point, index) => {
        if (index === action.pointIndex) {
          return {
            ...point,
            pos_x: action.pos_x,
            pos_y: action.pos_y,
          };
        }
        return point;
      });

      // Prepare updated edge
      let updatedEdge = {
        ...edge,
        edge_points: updatedEdgePoints,
      };

      // Auto-adjust label for straight-line edges (exactly 2 points)
      if (action.adjustLabel && edgePoints.length === 2 && edge.label_pos_x !== undefined && edge.label_pos_y !== undefined) {
        updatedEdge = {
          ...updatedEdge,
          label_pos_x: edge.label_pos_x + dx / 2,
          label_pos_y: edge.label_pos_y + dy / 2,
        };
      }

      const updatedEdges = [...diagram.diagram_edges];
      updatedEdges[edgeIndex] = updatedEdge;

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_EDGE_LABEL_POSITION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const edgeIndex = diagram.diagram_edges.findIndex(e => e.id === action.edgeId);
      if (edgeIndex === -1) return state;

      const updatedEdges = [...diagram.diagram_edges];
      updatedEdges[edgeIndex] = {
        ...updatedEdges[edgeIndex],
        label_pos_x: action.label_pos_x,
        label_pos_y: action.label_pos_y,
      };

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Task Group 3: Insert Edge Point (Bend Point Insertion)
    // ============================================================================
    case 'INSERT_EDGE_POINT': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const edgeIndex = diagram.diagram_edges.findIndex(e => e.id === action.edgeId);
      if (edgeIndex === -1) return state;

      const edge = diagram.diagram_edges[edgeIndex];
      const edgePoints = edge.edge_points || [];

      // Validate segmentIndex (must be a valid segment between 0 and points.length - 2)
      if (action.segmentIndex < 0 || action.segmentIndex >= edgePoints.length - 1) {
        return state;
      }

      // Create the new edge point
      const newPoint: EdgePoint = {
        id: generateEdgePointId(),
        sequence_order: action.segmentIndex + 1,
        pos_x: action.pos_x,
        pos_y: action.pos_y,
      };

      // Build the new edge_points array:
      // 1. Points before and including the insert position (index 0 to segmentIndex)
      // 2. The new point
      // 3. Points after the insert position with updated sequence_order
      const pointsBefore = edgePoints.slice(0, action.segmentIndex + 1);
      const pointsAfter = edgePoints.slice(action.segmentIndex + 1).map(p => ({
        ...p,
        sequence_order: p.sequence_order + 1,
      }));

      const newEdgePoints = [...pointsBefore, newPoint, ...pointsAfter];

      const updatedEdges = [...diagram.diagram_edges];
      updatedEdges[edgeIndex] = {
        ...edge,
        edge_points: newEdgePoints,
      };

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'ADD_DIAGRAM': {
      // Ensure new diagram has view_quarter set and decorations array
      const newDiagram: Diagram = {
        ...action.payload,
        view_quarter: action.payload.view_quarter || getDefaultViewQuarter(),
        decorations: action.payload.decorations || [],
        label_decorations: action.payload.label_decorations || [],
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: [...state.model.diagrams, newDiagram],
        },
        selectedDiagramId: newDiagram.id,
      };
    }

    // ============================================================================
    // Spec 2026-03-05: DELETE_DIAGRAM - Remove a diagram and apply fallback selection
    // ============================================================================
    case 'DELETE_DIAGRAM': {
      const deletedIndex = state.model.diagrams.findIndex(d => d.id === action.payload);
      if (deletedIndex === -1) return state;

      const remainingDiagrams = state.model.diagrams.filter(d => d.id !== action.payload);

      // Fallback selection: pick the diagram at the same index, or last remaining, or null
      const newSelectedDiagramId =
        remainingDiagrams[Math.min(deletedIndex, remainingDiagrams.length - 1)]?.id ?? null;

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: remainingDiagrams,
        },
        selectedDiagramId: newSelectedDiagramId,
      };
    }

    // ============================================================================
    // Task Group 7: UPDATE_DIAGRAM - Update diagram-level properties including typedContent
    // ============================================================================
    case 'UPDATE_DIAGRAM': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        ...action.updates,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_DIAGRAM_VIEW_QUARTER': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        view_quarter: action.view_quarter,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'TOGGLE_PALETTE_PANEL': {
      return {
        ...state,
        isPalettePanelCollapsed: !state.isPalettePanelCollapsed,
      };
    }

    case 'TOGGLE_INSPECTOR_PANEL': {
      return {
        ...state,
        isInspectorPanelCollapsed: !state.isInspectorPanelCollapsed,
      };
    }

    case 'TOGGLE_PALETTE_SECTION': {
      const { sectionId } = action.payload;
      return {
        ...state,
        sectionExpandStates: {
          ...state.sectionExpandStates,
          [sectionId]: !state.sectionExpandStates[sectionId],
        },
      };
    }

    case 'SET_PALETTE_SEARCH': {
      return {
        ...state,
        paletteSearchQuery: action.payload,
      };
    }

    case 'ADD_DIAGRAM_NODE': {
      const { diagramId, node } = action.payload;
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];

      // Check for duplicate
      if (nodeExistsForEntity(diagram.diagram_nodes, node.entity_type, node.entity_id)) {
        console.warn(`Node already exists for entity ${node.entity_type}:${node.entity_id}`);
        return state;
      }

      const updatedNodes = [...diagram.diagram_nodes, node];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'ADD_DIAGRAM_NODES': {
      const { diagramId, nodes } = action.payload;
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];

      // Filter out duplicates - only add nodes that don't already exist
      const nodesToAdd = nodes.filter(node =>
        !nodeExistsForEntity(diagram.diagram_nodes, node.entity_type, node.entity_id)
      );

      if (nodesToAdd.length === 0) {
        console.warn('All nodes already exist on diagram, nothing to add');
        return state;
      }

      const updatedNodes = [...diagram.diagram_nodes, ...nodesToAdd];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_nodes: updatedNodes,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Data Movement Add Fix: ADD_DIAGRAM_EDGE Action
    // Append edge to diagram's diagram_edges array
    // Follows same pattern as ADD_DIAGRAM_NODE
    // ============================================================================
    case 'ADD_DIAGRAM_EDGE': {
      const { diagramId, edge } = action.payload;
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];

      // Append edge to diagram_edges array (immutable update)
      const updatedEdges = [...diagram.diagram_edges, edge];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: updatedEdges,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'ADD_DIAGRAM_EDGES': {
      const { diagramId, edges } = action.payload;
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        diagram_edges: [...diagram.diagram_edges, ...edges],
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Decoration Actions
    // ============================================================================

    case 'ADD_DECORATIONS': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const currentDecorations = diagram.decorations || [];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        decorations: [...currentDecorations, ...action.decorations],
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'ADD_DECORATION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const currentDecorations = diagram.decorations || [];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        decorations: [...currentDecorations, action.decoration],
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Task Group 4: UPDATE_DECORATION with temporal splitting support
    // ============================================================================
    case 'UPDATE_DECORATION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const decorations = diagram.decorations || [];
      const decorationIndex = decorations.findIndex(d => d.id === action.decorationId);
      if (decorationIndex === -1) return state;

      const decoration = decorations[decorationIndex];
      const viewQuarter = diagram.view_quarter || getDefaultViewQuarter();

      // Check if we need to trigger temporal splitting
      if (shouldTriggerSplit(decoration, viewQuarter) && hasSplittableChanges(action.updates)) {
        // Split the decoration into old and new versions
        const { originalDecoration, newVersion } = splitDecoration(decoration, viewQuarter, action.updates);

        // Replace old decoration with modified original, add new version
        const updatedDecorations = [
          ...decorations.filter(d => d.id !== action.decorationId),
          originalDecoration,
          newVersion,
        ];

        const updatedDiagrams = [...state.model.diagrams];
        updatedDiagrams[diagramIndex] = {
          ...diagram,
          decorations: updatedDecorations,
        };

        return {
          ...state,
          model: {
            ...state.model,
            diagrams: updatedDiagrams,
          },
        };
      }

      // Normal update (no split needed) - existing behavior
      const existingDecoration = decorations[decorationIndex];
      const updatedDecorations = [...decorations];

      // Merge updates while preserving the type discriminator
      updatedDecorations[decorationIndex] = {
        ...existingDecoration,
        ...action.updates,
        // Ensure type is preserved from the original decoration
        type: existingDecoration.type,
      } as Decoration;

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        decorations: updatedDecorations,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'DELETE_DECORATION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const decorations = diagram.decorations || [];

      const updatedDecorations = decorations.filter(d => d.id !== action.decorationId);

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        decorations: updatedDecorations,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_DECORATIONS': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const decorations = diagram.decorations || [];
      const decorationIdSet = new Set(action.decorationIds);

      const updatedDecorations = decorations.map(decoration => {
        if (decorationIdSet.has(decoration.id)) {
          return {
            ...decoration,
            ...action.updates,
            // Ensure type is preserved from the original decoration
            type: decoration.type,
          } as Decoration;
        }
        return decoration;
      });

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        decorations: updatedDecorations,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    // ============================================================================
    // Spec 2025-12-31 (A5): Label Decoration Actions
    // ============================================================================

    case 'ADD_LABEL_DECORATION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const currentLabelDecorations = diagram.label_decorations || [];

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        label_decorations: [...currentLabelDecorations, action.labelDecoration],
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'UPDATE_LABEL_DECORATION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const labelDecorations = diagram.label_decorations || [];
      const labelDecIndex = labelDecorations.findIndex(d => d.id === action.labelDecorationId);
      if (labelDecIndex === -1) return state;

      const updatedLabelDecorations = [...labelDecorations];
      updatedLabelDecorations[labelDecIndex] = {
        ...updatedLabelDecorations[labelDecIndex],
        ...action.updates,
      };

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        label_decorations: updatedLabelDecorations,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'DELETE_LABEL_DECORATION': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const diagram = state.model.diagrams[diagramIndex];
      const labelDecorations = diagram.label_decorations || [];

      const updatedLabelDecorations = labelDecorations.filter(d => d.id !== action.labelDecorationId);

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...diagram,
        label_decorations: updatedLabelDecorations,
      };

      return {
        ...state,
        model: {
          ...state.model,
          diagrams: updatedDiagrams,
        },
      };
    }

    case 'REORDER_ENTITIES': {
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            entities: {
              ...state.model.metaModel.entities,
              [action.entityType]: action.entities,
            },
          },
        },
      };
    }

    case 'REORDER_RELATIONSHIPS': {
      return {
        ...state,
        model: {
          ...state.model,
          metaModel: {
            ...state.model.metaModel,
            relationships: {
              ...state.model.metaModel.relationships,
              [action.relationshipType]: action.relationships,
            },
          },
        },
      };
    }

    case 'RESTORE_DIAGRAM_STATE': {
      const diagramIndex = state.model.diagrams.findIndex(d => d.id === action.diagramId);
      if (diagramIndex === -1) return state;

      const updatedDiagrams = [...state.model.diagrams];
      updatedDiagrams[diagramIndex] = {
        ...updatedDiagrams[diagramIndex],
        diagram_nodes: action.snapshot.diagram_nodes,
        diagram_edges: action.snapshot.diagram_edges,
        decorations: action.snapshot.decorations,
        label_decorations: action.snapshot.label_decorations,
      };

      return {
        ...state,
        model: { ...state.model, diagrams: updatedDiagrams },
      };
    }

    default:
      return state;
  }
}

// Context types
interface ArchitectureContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  undo: () => void;
  canUndo: boolean;
  /**
   * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
   *
   * The currently active architecture id, derived from the URL path
   * segment `:architectureId` via `useParams`. Returns null when the
   * URL has no `:architectureId` segment (e.g. legacy / shortcut URLs
   * being redirected by `<ProjectLayout>`, or non-project URLs).
   *
   * The hook signature `useActiveArchitectureId(): string | null` is
   * unchanged from spec #1 -- only the resolution mechanism switched
   * from useState/useEffect-based API resolution to a useParams read.
   * Existing Bucket A consumers continue to work without modification.
   */
  activeArchitectureId: string | null;
  /**
   * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
   *
   * The full list of Architecture DTOs for the active project, fetched
   * via a single `listArchitectures(projectId)` call when the active
   * project changes. Empty array while loading or when no project is
   * active. The Group 3 architecture selector dropdown consumes this
   * list (filtered to non-archived, ordered oldest-first by the backend
   * contract).
   */
  architectures: Architecture[];
  /**
   * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
   *
   * Switch the active architecture by navigating to the canonical URL
   * with the new `:architectureId` segment substituted in. Preserves
   * `:projectId` and the trailing view segment so the user stays on
   * the same view across the switch (per spec section
   * `Stay-on-view-with-empty-toast on architecture switch`).
   */
  setActiveArchitecture: (id: string) => void;
  /**
   * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
   *
   * Re-fetch the architectures list for the active project and update
   * the in-memory `architectures` array. Every CRUD modal
   * (Create / Edit / Archive) calls this on success so the dropdown,
   * Manage modal, and any other consumers re-render against fresh data.
   *
   * No-op when there is no active project. Memoised with `useCallback`
   * so consumers can put it in `useEffect` deps without infinite loops.
   * Mutations are server-confirm: callers `await refreshArchitectures()`
   * before navigating or closing their modal so post-refresh state is
   * always observable.
   */
  refreshArchitectures: () => Promise<void>;
  /**
   * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 7
   *
   * Invalidate the AppShell per-(project, architecture) in-memory model
   * cache entry for `architectureId`. The next time the user navigates to
   * that architecture, AppShell's effect will fall through the cache miss
   * path and fetch a fresh model from AMS.
   *
   * Required for backend writes that bypass the frontend dispatch path
   * (per `project_appshell_model_cache.md`): selective-copy + auto-map
   * commits write target rows directly to AMS, so the cached model for
   * the target architecture is stale. The wizard MUST call this for the
   * cross-arch case (target != active); the same-arch case dispatches
   * `LOAD_MODEL` directly because the active model is what the user is
   * currently viewing.
   *
   * No-op when the cache invalidation callback has not been registered
   * yet (i.e. AppShell has not mounted), so callers can fire-and-forget
   * without guards.
   */
  invalidateArchitectureModelCache: (architectureId: string) => void;
  /**
   * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 7
   *
   * Internal helper used by `AppShell` to register its cache-invalidation
   * function with the provider. The provider holds the registered callback
   * in a ref and dispatches via `invalidateArchitectureModelCache`. Called
   * with `null` on AppShell unmount to clear the registration.
   *
   * Not part of the public API; only `AppShell` should call this.
   */
  setArchitectureModelCacheInvalidator: (
    callback: ((architectureId: string) => void) | null
  ) => void;
}

// Create contexts
const ArchitectureContext = createContext<ArchitectureContextType | undefined>(undefined);

// Provider component
interface ArchitectureProviderProps {
  children: ReactNode;
}

function snapshotDiagram(diagram: Diagram): DiagramSnapshot {
  return {
    diagram_nodes: diagram.diagram_nodes,
    diagram_edges: diagram.diagram_edges,
    decorations: diagram.decorations ?? [],
    label_decorations: diagram.label_decorations ?? [],
  };
}

function getDiagramIdFromAction(action: AppAction): string | null {
  if ('diagramId' in action && typeof action.diagramId === 'string') return action.diagramId;
  if ('payload' in action && action.payload && typeof action.payload === 'object' && 'diagramId' in action.payload) {
    return (action.payload as { diagramId: string }).diagramId;
  }
  return null;
}

export function ArchitectureProvider({ children }: ArchitectureProviderProps) {
  const [state, rawDispatch] = useReducer(appReducer, initialState);

  // Ref to current state so dispatch/undo callbacks stay stable across renders
  const stateRef = useRef(state);
  stateRef.current = state;

  // Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 7
  //
  // Holds a callback registered by `AppShell` that deletes a single
  // architectureId entry from AppShell's per-(project, architecture)
  // in-memory model `cacheRef`. The provider exposes the registration
  // setter on the context value so AppShell can wire its real
  // implementation in on mount; the public `invalidateArchitectureModelCache`
  // dispatches through this ref. While the ref is null (AppShell not yet
  // mounted) the public API is a defensive no-op so callers do not need
  // to guard.
  const cacheInvalidatorRef = useRef<((architectureId: string) => void) | null>(null);

  const setArchitectureModelCacheInvalidator = useCallback(
    (callback: ((architectureId: string) => void) | null) => {
      cacheInvalidatorRef.current = callback;
    },
    []
  );

  const invalidateArchitectureModelCache = useCallback((architectureId: string) => {
    const cb = cacheInvalidatorRef.current;
    if (cb) cb(architectureId);
  }, []);

  // ============================================================================
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2
  // Active architecture id is now URL-driven.
  //
  // The resolver useState/useEffect block from spec #1 is gone.
  // `activeArchitectureId` reads directly from useParams().architectureId so
  // the URL is the single source of truth. When the URL has no
  // `:architectureId` segment (e.g. a legacy URL still being redirected by
  // <ProjectLayout>, or non-project URLs), the value is null and existing
  // Bucket A call sites continue to guard for it as before.
  //
  // The architectures list is still fetched once per active project so the
  // Group 3 selector dropdown has data to render. <ProjectLayout> performs
  // its own listArchitectures call for the redirect resolver -- the two are
  // intentionally not shared so the redirect path stays decoupled from
  // provider state.
  // ============================================================================
  const activeProject = useProject();
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
  // URL-derived: the architecture id is whatever the route currently has.
  // We parse it from `location.pathname` (NOT `useParams()`) because this
  // provider is mounted ABOVE the <Routes> tree in App.tsx, which means a
  // useParams() read here returns `{}` and `params.architectureId` is
  // permanently undefined. `useLocation()` works at any nesting depth as
  // long as it sits inside <BrowserRouter> -- which the provider already
  // does. The pure helper `parseArchitectureIdFromPathname` mirrors
  // `parseViewFromPathname` and is exported from `useCurrentView.ts`.
  const activeArchitectureId = parseArchitectureIdFromPathname(location.pathname);

  // Architecture list for the active project (selector dropdown data).
  const [architectures, setArchitectures] = useState<Architecture[]>([]);

  // Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
  //
  // Memoised refetch callable. Exposed on the context as
  // `refreshArchitectures` so CRUD modals (Create / Edit / Archive) can
  // call it on success and have the dropdown + Manage modal re-render
  // against the fresh server-confirmed list. The same callable is also
  // invoked once per active-project change in the useEffect below, so
  // the initial-load behaviour from spec #2 is preserved.
  //
  // No-op when there is no active project. Errors are logged and
  // swallowed (mirroring the spec #2 behaviour) so a failed refresh
  // never throws into a modal's submit-success path.
  const refreshArchitectures = useCallback(async (): Promise<void> => {
    if (!activeProject) {
      return;
    }
    const projectId = activeProject.id;
    try {
      const list = await listArchitectures(projectId);
      if (!Array.isArray(list)) {
        console.warn(
          `[ArchitectureContext] listArchitectures("${projectId}") returned a non-array; treating as empty.`
        );
        setArchitectures([]);
        return;
      }
      setArchitectures(list);
    } catch (err) {
      console.warn(
        `[ArchitectureContext] Failed to load architectures for project "${projectId}":`,
        err
      );
      setArchitectures([]);
    }
  }, [activeProject]);

  useEffect(() => {
    // Reset on project change (including project clear -> null) so a
    // stale list from a previous project never flashes during the
    // refetch.
    setArchitectures([]);

    if (!activeProject) {
      return;
    }

    // Cancellation token: if the active project changes again before
    // this fetch resolves, we discard the result rather than
    // overwriting state for the new project.
    let cancelled = false;
    const projectId = activeProject.id;

    listArchitectures(projectId)
      .then(list => {
        if (cancelled) return;
        if (!Array.isArray(list)) {
          console.warn(
            `[ArchitectureContext] listArchitectures("${projectId}") returned a non-array; treating as empty.`
          );
          setArchitectures([]);
          return;
        }
        setArchitectures(list);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn(
          `[ArchitectureContext] Failed to load architectures for project "${projectId}":`,
          err
        );
        setArchitectures([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  /**
   * Switch active architecture by navigating to the same view URL with
   * only the `:architectureId` segment swapped. The trailing view segment
   * (if any) is preserved verbatim so the user stays on, e.g., diagrams
   * across the switch. If the current URL is not on the canonical
   * `/projects/:projectId/architectures/:architectureId/<view>` shape, we
   * still navigate to a canonical URL using the active project id and
   * default the view to `dashboard`.
   */
  const setActiveArchitecture = useCallback((id: string, options?: { replace?: boolean }) => {
    const projectIdFromUrl = params.projectId;
    const projectId = projectIdFromUrl ?? activeProject?.id;
    if (!projectId) {
      console.warn(
        '[ArchitectureContext] setActiveArchitecture called with no active project; ignoring.'
      );
      return;
    }

    // Parse the trailing view segment from the current pathname so the
    // user stays on the same view across the switch.
    // Canonical shape: /projects/:projectId/architectures/:architectureId/<view>
    // Legacy shape:    /projects/:projectId/<view>?
    // KNOWN_VIEW_SEGMENTS is ProjectLayout's canonical set — a private copy
    // here went stale (missing discovery/target-architecture) and bounced
    // those deep links to /dashboard.
    let view = 'dashboard';
    const segments = location.pathname.split('/').filter(Boolean);
    // Look for the segment after `architectures/:architectureId/`.
    const archSegmentIdx = segments.findIndex(s => s === 'architectures');
    if (archSegmentIdx >= 0 && segments.length > archSegmentIdx + 2) {
      const candidate = segments[archSegmentIdx + 2];
      if (KNOWN_VIEW_SEGMENTS.has(candidate)) view = candidate;
    } else {
      // Legacy shape -- view is the first segment after the projectId.
      const projIdx = segments.findIndex(s => s === 'projects');
      if (projIdx >= 0 && segments.length > projIdx + 2) {
        const candidate = segments[projIdx + 2];
        if (KNOWN_VIEW_SEGMENTS.has(candidate)) view = candidate;
      }
    }

    const target = `/projects/${projectId}/architectures/${id}/${view}`;
    navigate(target, { replace: options?.replace ?? false });
  }, [params.projectId, activeProject, location.pathname, navigate]);

  // Spec 2026-06-06: Guarantee an active architecture is ALWAYS selected. The
  // active architecture is derived purely from the URL's :architectureId
  // segment, so after creating or switching projects the URL can carry NO
  // segment, or the PREVIOUS project's (now-stale) architecture id -- in either
  // case nothing valid is selected (the top selector shows "..."/"-") yet
  // architecture-scoped actions can still run. Whenever a project's
  // architectures have loaded and the active id is missing or not one of the
  // project's non-archived architectures, select the project's default (oldest
  // non-archived) architecture. `replace` keeps the invalid URL out of history
  // (no Back-button bounce). Idempotent -- once a valid architecture is active
  // this is a no-op, so it cannot loop.
  useEffect(() => {
    if (!activeProject || architectures.length === 0) return;
    // Only auto-select on project-scoped URLs. Without this gate the effect
    // fires on ANY URL lacking a valid :architectureId — including bogus
    // paths — replacing the 404 page with a dashboard bounce (safety
    // property g of the 2026-05-04 routing spec). The spec scenarios this
    // effect exists for (project create/switch leaving no or a stale
    // architecture id) all occur on /projects/... URLs.
    if (!location.pathname.startsWith('/projects/')) return;
    const nonArchived = architectures.filter(a => !a.archived);
    if (nonArchived.length === 0) return;
    const hasValidActive =
      activeArchitectureId !== null &&
      nonArchived.some(a => a.id === activeArchitectureId);
    if (!hasValidActive) {
      setActiveArchitecture(nonArchived[0].id, { replace: true });
    }
  }, [activeProject, architectures, activeArchitectureId, setActiveArchitecture, location.pathname]);

  // Per-diagram undo history: diagramId -> stack of snapshots
  const undoHistoryRef = useRef<Map<string, DiagramSnapshot[]>>(new Map());
  // Track the currently selected diagram for canUndo
  const [canUndo, setCanUndo] = React.useState(false);

  const updateCanUndo = useCallback((diagramId: string | null) => {
    if (!diagramId) { setCanUndo(false); return; }
    const stack = undoHistoryRef.current.get(diagramId);
    setCanUndo(!!stack && stack.length > 0);
  }, []);

  // Stable dispatch wrapper — reads state from ref, never depends on state directly
  const dispatch = useCallback((action: AppAction) => {
    if (UNDOABLE_ACTION_TYPES.has(action.type)) {
      const diagramId = getDiagramIdFromAction(action);
      if (diagramId) {
        const diagram = stateRef.current.model.diagrams.find(d => d.id === diagramId);
        if (diagram) {
          const stack = undoHistoryRef.current.get(diagramId) ?? [];
          stack.push(snapshotDiagram(diagram));
          if (stack.length > MAX_UNDO_HISTORY) stack.shift();
          undoHistoryRef.current.set(diagramId, stack);
        }
      }
    }
    rawDispatch(action);
    const diagramId = getDiagramIdFromAction(action) ?? stateRef.current.selectedDiagramId;
    updateCanUndo(diagramId);
  }, [rawDispatch, updateCanUndo]);

  // Stable undo — reads state from ref
  const undo = useCallback(() => {
    const diagramId = stateRef.current.selectedDiagramId;
    if (!diagramId) return;
    const stack = undoHistoryRef.current.get(diagramId);
    if (!stack || stack.length === 0) return;
    const snapshot = stack.pop()!;
    rawDispatch({ type: 'RESTORE_DIAGRAM_STATE', diagramId, snapshot });
    updateCanUndo(diagramId);
  }, [rawDispatch, updateCanUndo]);

  // Keep canUndo in sync when selected diagram changes
  React.useEffect(() => {
    updateCanUndo(state.selectedDiagramId);
  }, [state.selectedDiagramId, updateCanUndo]);

  return (
    <ArchitectureContext.Provider value={{ state, dispatch, undo, canUndo, activeArchitectureId, architectures, setActiveArchitecture, refreshArchitectures, invalidateArchitectureModelCache, setArchitectureModelCacheInvalidator }}>
      {children}
    </ArchitectureContext.Provider>
  );
}

// Custom hooks
export function useArchitecture(): AppState {
  const context = useContext(ArchitectureContext);
  if (context === undefined) {
    throw new Error('useArchitecture must be used within an ArchitectureProvider');
  }
  return context.state;
}

export function useArchitectureDispatch(): React.Dispatch<AppAction> {
  const context = useContext(ArchitectureContext);
  if (context === undefined) {
    throw new Error('useArchitectureDispatch must be used within an ArchitectureProvider');
  }
  return context.dispatch;
}

export function useUndo(): { undo: () => void; canUndo: boolean } {
  const context = useContext(ArchitectureContext);
  if (context === undefined) {
    throw new Error('useUndo must be used within an ArchitectureProvider');
  }
  return { undo: context.undo, canUndo: context.canUndo };
}

/**
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *
 * Hook to get the active architecture id from context.
 *
 * Returns the id of the project's currently active architecture (resolved as
 * the oldest non-archived architecture for the active project, i.e. the
 * migrated `Default`). Returns null while the project / architecture list is
 * still loading, or if no project is active.
 *
 * Every Bucket A frontend API call must read this value via this hook and
 * pass it through. Guard for null at the call site -- skip the call, show a
 * loading state, or return early. Do NOT default to a hardcoded value.
 *
 * @returns The active architecture id, or null
 * @throws Error if used outside ArchitectureProvider
 */
export function useActiveArchitectureId(): string | null {
  const context = useContext(ArchitectureContext);
  if (context === undefined) {
    throw new Error('useActiveArchitectureId must be used within an ArchitectureProvider');
  }
  return context.activeArchitectureId;
}

// Combined hook for convenience
export function useArchitectureContext(): ArchitectureContextType {
  const context = useContext(ArchitectureContext);
  if (context === undefined) {
    throw new Error('useArchitectureContext must be used within an ArchitectureProvider');
  }
  return context;
}
