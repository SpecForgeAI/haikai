/**
 * Import Merge Utilities
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 1: Shared Import Utilities and ID Conflict Resolution
 *
 * Pure utility functions for import/merge operations with no React dependencies.
 * These functions support:
 * - ID conflict resolution with FK cascade updates
 * - Snapshot schema validation
 * - Cherry-pick data extraction from JSON snapshots and XLSX results
 * - Merge summary generation
 */

import type {
  MetaModelEntities,
  MetaModelRelationships,
  Diagram,
  ArchitectureModel,
} from '../types/model';

import type { ProjectSnapshotDto } from '../api/projectSnapshotApi';
import type { ImportResult } from './excelOperations';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * NamedItem - a generic item with at least an id and name.
 * Preserves full entity data while exposing id/name for checkbox labels.
 */
export interface NamedItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * MergeableData - the data shape ready for merging into the current model.
 * Used by resolveIdConflicts and the MERGE_IMPORT reducer action.
 */
export interface MergeableData {
  entities: Partial<MetaModelEntities>;
  relationships: Partial<MetaModelRelationships>;
  diagrams: Diagram[];
}

/**
 * CherryPickData - the data shape for the cherry-pick modal UI.
 * Items grouped by collection key with id/name exposed for checkbox labels.
 * Empty collections are filtered out so the UI hides them.
 */
export interface CherryPickData {
  entities: Record<string, NamedItem[]>;
  relationships: Record<string, NamedItem[]>;
  diagrams: NamedItem[];
}

/**
 * Validation result from validateSnapshotSchema.
 */
export interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
  snapshot: ProjectSnapshotDto | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum file size for JSON snapshot import (50 MB) */
export const MAX_SNAPSHOT_FILE_SIZE = 50 * 1024 * 1024;

/**
 * All known FK field names across all relationship types in MetaModelRelationships.
 * These fields reference entity IDs and must be cascade-updated when entity IDs are remapped.
 *
 * Compiled from every interface in MetaModelRelationships:
 * - BusinessUserBusinessPoint: business_user_id, business_point_id
 * - ApplicationPointBusinessPoint: application_point_id, business_point_id
 * - ApplicationPointBusinessLogic: application_point_id, business_logic_id
 * - LogicalDataEntityRelationship: fromDataEntityPointId, toDataEntityPointId
 * - LogicalDataEntityPhysicalDataEntity: logical_entity_id, physical_entity_id
 * - LogicalDataAttributePhysicalDataAttribute: logical_attribute_id, physical_attribute_id
 * - DataMovement: source_application_point_id, target_application_point_id, interfaceWithSchemaId
 * - InterfaceLogicalEntity: interface_id, dataEntityPointId
 * - UIWorkflowTransition: source_screen_id, target_screen_id
 */
const RELATIONSHIP_FK_FIELDS: string[] = [
  // BusinessUserBusinessPoint
  'business_user_id',
  'business_point_id',
  // ApplicationPointBusinessPoint
  'application_point_id',
  // ApplicationPointBusinessLogic
  'business_logic_id',
  // LogicalDataEntityRelationship
  'fromDataEntityPointId',
  'toDataEntityPointId',
  // LogicalDataEntityPhysicalDataEntity
  'logical_entity_id',
  'physical_entity_id',
  // LogicalDataAttributePhysicalDataAttribute
  'logical_attribute_id',
  'physical_attribute_id',
  // DataMovement
  'source_application_point_id',
  'target_application_point_id',
  'interfaceWithSchemaId',
  // InterfaceLogicalEntity
  'interface_id',
  'dataEntityPointId',
  // UIWorkflowTransition
  'source_screen_id',
  'target_screen_id',
];

/**
 * Human-readable labels for entity/relationship collection keys.
 * Used by buildMergeSummary for user-friendly output.
 */
const COLLECTION_LABELS: Record<string, string> = {
  // Entity types
  business_users: 'Business Users',
  business_processes: 'Business Processes',
  process_activities: 'Process Activities',
  business_points: 'Business Points',
  applications: 'Applications',
  app_components: 'Application Components',
  services: 'Services',
  interfaces: 'Interfaces',
  endpoints: 'Endpoints',
  classes: 'Classes',
  methods: 'Methods',
  application_points: 'Application Points',
  logical_data_entities: 'Logical Data Entities',
  logical_data_attributes: 'Logical Data Attributes',
  physical_data_entities: 'Physical Data Entities',
  physical_data_attributes: 'Physical Data Attributes',
  interactions: 'Interactions',
  app_business_points: 'App Business Points',
  events: 'Events',
  states: 'States',
  state_transitions: 'State Transitions',
  activities: 'Activities',
  activity_flows: 'Activity Flows',
  activity_partitions: 'Activity Partitions',
  business_logics: 'Business Logics',
  ui_screens: 'UI Screens',
  ui_components: 'UI Components',
  ui_actions: 'UI Actions',
  ui_characteristics: 'UI Characteristics',
  package_sets: 'Package Sets',
  packages: 'Packages',
  // Relationship types
  business_user_business_points: 'Business User Business Points',
  application_point_business_points: 'Application Point Business Points',
  application_point_business_logics: 'Application Point Business Logics',
  logical_data_entity_relationships: 'Logical Data Entity Relationships',
  logical_data_entity_physical_data_entities: 'Logical-Physical Entity Mappings',
  logical_data_attribute_physical_data_attributes: 'Logical-Physical Attribute Mappings',
  data_movements: 'Data Movements',
  interface_logical_entities: 'Interface Entities',
  ui_workflow_transitions: 'UI Workflow Transitions',
};

// ============================================================================
// resolveIdConflicts
// ============================================================================

/**
 * Resolves ID conflicts between imported data and the current model.
 *
 * For any imported entity, relationship, or diagram whose ID already exists
 * in the current model, a new UUID is generated. All FK references in
 * imported relationships and diagram nodes/edges are cascade-updated.
 *
 * @param selectedData - The selected imported data to merge
 * @param currentModel - The current architecture model to check for ID collisions
 * @returns Conflict-free MergeableData ready to merge
 */
export function resolveIdConflicts(
  selectedData: MergeableData,
  currentModel: ArchitectureModel
): MergeableData {
  // Build a set of all existing IDs in the current model
  const existingIds = new Set<string>();

  // Collect entity IDs
  for (const [, entityArray] of Object.entries(currentModel.metaModel.entities)) {
    if (Array.isArray(entityArray)) {
      for (const entity of entityArray) {
        const e = entity as { id?: string };
        if (e.id) existingIds.add(e.id);
      }
    }
  }

  // Collect relationship IDs
  for (const [, relArray] of Object.entries(currentModel.metaModel.relationships)) {
    if (Array.isArray(relArray)) {
      for (const rel of relArray) {
        const r = rel as { id?: string };
        if (r.id) existingIds.add(r.id);
      }
    }
  }

  // Collect diagram IDs
  for (const diagram of currentModel.diagrams) {
    existingIds.add(diagram.id);
  }

  // Build remap map: oldId -> newId
  const remapMap = new Map<string, string>();

  // Scan imported entities for ID collisions
  for (const [, entityArray] of Object.entries(selectedData.entities)) {
    if (Array.isArray(entityArray)) {
      for (const entity of entityArray) {
        const e = entity as { id?: string };
        if (e.id && existingIds.has(e.id)) {
          remapMap.set(e.id, crypto.randomUUID());
        }
      }
    }
  }

  // Scan imported relationships for ID collisions
  for (const [, relArray] of Object.entries(selectedData.relationships)) {
    if (Array.isArray(relArray)) {
      for (const rel of relArray) {
        const r = rel as { id?: string };
        if (r.id && existingIds.has(r.id)) {
          remapMap.set(r.id, crypto.randomUUID());
        }
      }
    }
  }

  // Scan imported diagrams for ID collisions
  for (const diagram of selectedData.diagrams) {
    if (diagram.id && existingIds.has(diagram.id)) {
      remapMap.set(diagram.id, crypto.randomUUID());
    }
  }

  // If no conflicts found, return data as-is
  if (remapMap.size === 0) {
    return selectedData;
  }

  // Deep clone to avoid mutating the input
  const result: MergeableData = JSON.parse(JSON.stringify(selectedData));

  // Helper to remap a single ID value if it is in the remap map
  function remap(id: string | undefined | null): string | undefined | null {
    if (id == null) return id;
    return remapMap.get(id) ?? id;
  }

  // Apply remaps to entities (their own IDs)
  for (const [, entityArray] of Object.entries(result.entities)) {
    if (Array.isArray(entityArray)) {
      for (const entity of entityArray) {
        const e = entity as Record<string, unknown>;
        if (typeof e.id === 'string') {
          e.id = remap(e.id) as string;
        }
      }
    }
  }

  // Apply remaps to relationships (their own IDs + FK fields)
  for (const [, relArray] of Object.entries(result.relationships)) {
    if (Array.isArray(relArray)) {
      for (const rel of relArray) {
        const r = rel as Record<string, unknown>;
        // Remap the relationship's own ID
        if (typeof r.id === 'string') {
          r.id = remap(r.id) as string;
        }
        // Cascade-update all FK fields
        for (const fkField of RELATIONSHIP_FK_FIELDS) {
          if (typeof r[fkField] === 'string') {
            r[fkField] = remap(r[fkField] as string);
          }
        }
      }
    }
  }

  // Apply remaps to diagrams
  for (const diagram of result.diagrams) {
    // Remap diagram's own ID
    diagram.id = remap(diagram.id) as string;

    // Cascade-update entity_id in diagram_nodes
    if (diagram.diagram_nodes) {
      for (const node of diagram.diagram_nodes) {
        if (typeof node.entity_id === 'string') {
          node.entity_id = remap(node.entity_id) as string;
        }
      }
    }

    // Cascade-update relationship_id in diagram_edges
    if (diagram.diagram_edges) {
      for (const edge of diagram.diagram_edges) {
        if (typeof edge.relationship_id === 'string') {
          edge.relationship_id = remap(edge.relationship_id) as string;
        }
      }
    }
  }

  return result;
}

// ============================================================================
// applyMergeToModel
// ============================================================================

/**
 * Applies merge data to an architecture model, returning a new model.
 *
 * This produces the same result as the MERGE_IMPORT reducer but operates
 * on a model directly rather than on reducer state. Used by handleMergeComplete
 * to build the merged model before passing it to saveModelToBackend, avoiding
 * the stale closure issue where state.model would be the pre-merge value.
 *
 * @param model - The current architecture model
 * @param mergeData - The resolved data to merge in
 * @returns A new ArchitectureModel with the merged data appended
 */
export function applyMergeToModel(
  model: ArchitectureModel,
  mergeData: MergeableData
): ArchitectureModel {
  const mergedEntities: Record<string, unknown[]> = { ...model.metaModel.entities };
  for (const [entityType, newItems] of Object.entries(mergeData.entities)) {
    if (Array.isArray(newItems) && newItems.length > 0) {
      const existing = (mergedEntities[entityType] as unknown[]) || [];
      mergedEntities[entityType] = [...existing, ...newItems];
    }
  }

  const mergedRelationships: Record<string, unknown[]> = { ...model.metaModel.relationships };
  for (const [relType, newItems] of Object.entries(mergeData.relationships)) {
    if (Array.isArray(newItems) && newItems.length > 0) {
      const existing = (mergedRelationships[relType] as unknown[]) || [];
      mergedRelationships[relType] = [...existing, ...newItems];
    }
  }

  const mergedDiagrams = mergeData.diagrams.length > 0
    ? [...model.diagrams, ...mergeData.diagrams]
    : model.diagrams;

  return {
    ...model,
    metaModel: {
      entities: mergedEntities as unknown as MetaModelEntities,
      relationships: mergedRelationships as unknown as ArchitectureModel['metaModel']['relationships'],
    },
    diagrams: mergedDiagrams,
  };
}

// ============================================================================
// applyXlsxImportToModel
// ============================================================================

/**
 * Applies XLSX import results directly to a model.
 *
 * Unlike applyMergeToModel (which only appends), this function:
 * - Replaces existing entities/relationships by ID when the import has updates
 * - Appends genuinely new entities/relationships
 *
 * This bypasses the cherry-pick/resolveIdConflicts pipeline which is designed
 * for snapshot imports where IDs should never collide.
 */
export function applyXlsxImportToModel(
  model: ArchitectureModel,
  result: ImportResult
): ArchitectureModel {
  const mergedEntities: Record<string, unknown[]> = { ...model.metaModel.entities };

  // Build set of updated entity IDs per type for fast lookup
  for (const [typeKey, updatedItems] of Object.entries(result.updatedEntities || {})) {
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) continue;
    const updatedById = new Map<string, unknown>();
    for (const item of updatedItems) {
      const id = (item as Record<string, unknown>).id as string;
      if (id) updatedById.set(id, item);
    }
    // Replace matching existing entities, keep non-matching ones
    const existing = (mergedEntities[typeKey] as unknown[]) || [];
    mergedEntities[typeKey] = existing.map((e) => {
      const id = (e as Record<string, unknown>).id as string;
      return updatedById.has(id) ? updatedById.get(id)! : e;
    });
    // Remove applied updates from the map (remaining ones would be orphans, shouldn't happen)
    for (const e of mergedEntities[typeKey]) {
      updatedById.delete((e as Record<string, unknown>).id as string);
    }
  }

  // Append genuinely new entities
  for (const [typeKey, newItems] of Object.entries(result.newEntities || {})) {
    if (!Array.isArray(newItems) || newItems.length === 0) continue;
    const existing = (mergedEntities[typeKey] as unknown[]) || [];
    mergedEntities[typeKey] = [...existing, ...newItems];
  }

  const mergedRelationships: Record<string, unknown[]> = { ...model.metaModel.relationships };

  // Replace updated relationships by ID
  for (const [typeKey, updatedItems] of Object.entries(result.updatedRelationships || {})) {
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) continue;
    const updatedById = new Map<string, unknown>();
    for (const item of updatedItems) {
      const id = (item as Record<string, unknown>).id as string;
      if (id) updatedById.set(id, item);
    }
    const existing = (mergedRelationships[typeKey] as unknown[]) || [];
    mergedRelationships[typeKey] = existing.map((r) => {
      const id = (r as Record<string, unknown>).id as string;
      return updatedById.has(id) ? updatedById.get(id)! : r;
    });
  }

  // Append genuinely new relationships
  for (const [typeKey, newItems] of Object.entries(result.newRelationships || {})) {
    if (!Array.isArray(newItems) || newItems.length === 0) continue;
    const existing = (mergedRelationships[typeKey] as unknown[]) || [];
    mergedRelationships[typeKey] = [...existing, ...newItems];
  }

  return {
    ...model,
    metaModel: {
      entities: mergedEntities as unknown as MetaModelEntities,
      relationships: mergedRelationships as unknown as ArchitectureModel['metaModel']['relationships'],
    },
    diagrams: model.diagrams,
  };
}

// ============================================================================
// buildMergeSummary
// ============================================================================

/**
 * Builds a human-readable summary string from merge data.
 *
 * @param data - The merged data to summarize
 * @returns Summary string like "Merged 3 Applications, 2 Services, 1 Diagram"
 */
export function buildMergeSummary(data: MergeableData): string {
  const parts: string[] = [];

  // Count entities
  for (const [key, entityArray] of Object.entries(data.entities)) {
    if (Array.isArray(entityArray) && entityArray.length > 0) {
      const label = COLLECTION_LABELS[key] || key;
      parts.push(`${entityArray.length} ${label}`);
    }
  }

  // Count relationships
  for (const [key, relArray] of Object.entries(data.relationships)) {
    if (Array.isArray(relArray) && relArray.length > 0) {
      const label = COLLECTION_LABELS[key] || key;
      parts.push(`${relArray.length} ${label}`);
    }
  }

  // Count diagrams
  if (data.diagrams.length > 0) {
    const diagramLabel = data.diagrams.length === 1 ? 'Diagram' : 'Diagrams';
    parts.push(`${data.diagrams.length} ${diagramLabel}`);
  }

  if (parts.length === 0) {
    return 'No items merged';
  }

  return `Merged ${parts.join(', ')}`;
}

// ============================================================================
// validateSnapshotSchema
// ============================================================================

/**
 * Validates the schema of a parsed JSON snapshot.
 *
 * Extracts the duplicated validation logic from TopBar.handleFileChange and
 * LandingPage.handleFileChange into a single reusable function.
 *
 * Checks:
 * - Parsed value is a non-null object
 * - Has `project` field (object)
 * - Has `project.name` field (non-empty string)
 * - Has `meta` field
 * - Has `model` field
 *
 * @param parsed - The parsed JSON value to validate
 * @returns Validation result with errors and parsed snapshot
 */
export function validateSnapshotSchema(parsed: unknown): SnapshotValidationResult {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      errors: ['File does not contain a valid JSON object'],
      snapshot: null,
    };
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj.project) {
    errors.push('Missing required field: project');
  } else if (
    !(obj.project as Record<string, unknown>).name ||
    typeof (obj.project as Record<string, unknown>).name !== 'string'
  ) {
    errors.push('Missing or invalid field: project.name');
  }

  if (!obj.meta) {
    errors.push('Missing required field: meta');
  }

  if (!obj.model) {
    errors.push('Missing required field: model');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      snapshot: null,
    };
  }

  return {
    valid: true,
    errors: [],
    snapshot: parsed as ProjectSnapshotDto,
  };
}

// ============================================================================
// extractCherryPickData
// ============================================================================

/**
 * Extracts cherry-pickable data from a ProjectSnapshotDto.
 *
 * Converts snapshot model data into the CherryPickData shape for the
 * cherry-pick modal UI. Filters out empty collections and excludes
 * work_items and artifacts (only architecture entities, relationships,
 * and diagrams are mergeable).
 *
 * @param snapshot - The project snapshot to extract data from
 * @returns CherryPickData with entities, relationships, and diagrams
 */
export function extractCherryPickData(snapshot: ProjectSnapshotDto): CherryPickData {
  const entities: Record<string, NamedItem[]> = {};
  const relationships: Record<string, NamedItem[]> = {};
  const diagrams: NamedItem[] = [];

  // Extract entities from snapshot model
  if (snapshot.model?.metaModel?.entities) {
    for (const [key, value] of Object.entries(snapshot.model.metaModel.entities)) {
      if (Array.isArray(value) && value.length > 0) {
        // Cast items to NamedItem (they have at least id and name)
        const items = value.filter(
          (item: unknown) =>
            item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).id === 'string' &&
            typeof (item as Record<string, unknown>).name === 'string'
        ) as NamedItem[];
        if (items.length > 0) {
          entities[key] = items;
        }
      }
    }
  }

  // Extract relationships from snapshot model
  if (snapshot.model?.metaModel?.relationships) {
    for (const [key, value] of Object.entries(snapshot.model.metaModel.relationships)) {
      if (Array.isArray(value) && value.length > 0) {
        // Relationships may not have a 'name' field; use id as fallback
        const items = value
          .filter(
            (item: unknown) =>
              item &&
              typeof item === 'object' &&
              typeof (item as Record<string, unknown>).id === 'string'
          )
          .map((item: unknown) => {
            const obj = item as Record<string, unknown>;
            return {
              ...obj,
              id: obj.id as string,
              name: (obj.name as string) || (obj.description as string) || (obj.id as string),
            } as NamedItem;
          });
        if (items.length > 0) {
          relationships[key] = items;
        }
      }
    }
  }

  // Extract diagrams from snapshot model
  if (snapshot.model?.diagrams && Array.isArray(snapshot.model.diagrams)) {
    for (const diagram of snapshot.model.diagrams) {
      const d = diagram as Record<string, unknown>;
      if (d && typeof d.id === 'string' && typeof d.name === 'string') {
        diagrams.push(d as unknown as NamedItem);
      }
    }
  }

  return { entities, relationships, diagrams };
}

// ============================================================================
// convertXlsxResultToCherryPickData
// ============================================================================

/**
 * Converts an ImportResult from XLSX parsing into CherryPickData shape.
 *
 * Combines new and updated items from the ImportResult into a single set
 * per entity/relationship type.
 *
 * @param result - The ImportResult from importMetaModelFromExcel
 * @returns CherryPickData with entities and relationships (no diagrams)
 */
export function convertXlsxResultToCherryPickData(result: ImportResult): CherryPickData {
  const entities: Record<string, NamedItem[]> = {};
  const relationships: Record<string, NamedItem[]> = {};

  // Combine new + updated entities per type
  const allEntityKeys = new Set<string>([
    ...Object.keys(result.newEntities || {}),
    ...Object.keys(result.updatedEntities || {}),
  ]);

  for (const key of allEntityKeys) {
    const newItems = (result.newEntities?.[key] || []) as Record<string, unknown>[];
    const updatedItems = (result.updatedEntities?.[key] || []) as Record<string, unknown>[];
    const combined = [...newItems, ...updatedItems];

    if (combined.length > 0) {
      const items = combined
        .filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string'
        )
        .map((item) => ({
          ...item,
          id: item.id as string,
          name: (item.name as string) || (item.id as string),
        })) as NamedItem[];

      if (items.length > 0) {
        entities[key] = items;
      }
    }
  }

  // Combine new + updated relationships per type
  const allRelKeys = new Set<string>([
    ...Object.keys(result.newRelationships || {}),
    ...Object.keys(result.updatedRelationships || {}),
  ]);

  for (const key of allRelKeys) {
    const newItems = (result.newRelationships?.[key] || []) as Record<string, unknown>[];
    const updatedItems = (result.updatedRelationships?.[key] || []) as Record<string, unknown>[];
    const combined = [...newItems, ...updatedItems];

    if (combined.length > 0) {
      const items = combined
        .filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string'
        )
        .map((item) => ({
          ...item,
          id: item.id as string,
          name: (item.name as string) || (item.id as string),
        })) as NamedItem[];

      if (items.length > 0) {
        relationships[key] = items;
      }
    }
  }

  return {
    entities,
    relationships,
    diagrams: [],
  };
}
