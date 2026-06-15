/**
 * Implement Context API Client
 *
 * Spec 2026-01-09: Persist Implement Context per Work Item in Backend
 * Task Group 3: Frontend API client for implement context persistence.
 *
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 * - Added structured entity/diagram selections with bundle_type and depth
 * - Updated saveImplementContext() to send structured selections
 * - Updated mapDtoToContextState() to populate bundle_type and depth from response
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added relationship selection DTOs and parsing functions
 * - Updated ImplementContextDto with relationship fields
 * - Updated mapDtoToContextState() to include relationship_refs
 * - Updated saveImplementContext() to send relationship selections
 *
 * API client for fetching and saving implement context from the backend.
 * Follows patterns from workItemsApi.ts.
 */

import type { ContextState, EntityRef, DiagramRef, RelationshipRef } from '../utils/contextStorage';
import { createEmptyContextState } from '../utils/contextStorage';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Structured entity selection DTO (matches backend EntitySelection)
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 */
export interface EntitySelectionDto {
  entity_type: string;
  entity_id: string;
  bundle_type: string;
  depth?: number | null;
}

/**
 * Structured diagram selection DTO (matches backend DiagramSelection)
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 */
export interface DiagramSelectionDto {
  diagram_id: string;
  bundle_type: string;
}

/**
 * Structured relationship selection DTO (matches backend RelationshipSelection)
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
export interface RelationshipSelectionDto {
  relationship_type: string;
  relationship_id: string;
  label: string;
}

/**
 * Backend response/request DTO for implement context (snake_case)
 * Extended with structured selections for bundle_type and depth persistence.
 *
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added selected_relationship_ids and selected_relationship_selections fields
 */
interface ImplementContextDto {
  project_id: string;
  work_item_id: string;
  selected_entity_ids: string[];
  selected_diagram_ids: string[];
  selected_entity_selections?: EntitySelectionDto[] | null;
  selected_diagram_selections?: DiagramSelectionDto[] | null;
  /**
   * Legacy field: List of selected relationship IDs.
   * Format: "relationshipType::relationshipId"
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  selected_relationship_ids?: string[] | null;
  /**
   * Structured relationship selections with relationship_type, relationship_id, label.
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  selected_relationship_selections?: RelationshipSelectionDto[] | null;
}

/**
 * Parses entity ID string into EntityRef with minimal info.
 * Format: "entityType::entityId"
 *
 * @param entityIdStr - The entity ID string from backend
 * @param entitySelections - Optional structured selections to extract bundle_type/depth
 * @returns EntityRef with parsed values
 */
function parseEntityRef(
  entityIdStr: string,
  entitySelections?: EntitySelectionDto[] | null
): EntityRef {
  const parts = entityIdStr.split('::');
  if (parts.length >= 2) {
    const entityType = parts[0];
    const entityId = parts[1];

    // Look up bundle_type and depth from structured selections
    let bundleType: string | undefined;
    let depth: 1 | 2 | undefined;

    if (entitySelections && entitySelections.length > 0) {
      const selection = entitySelections.find(
        (s) => s.entity_type === entityType && s.entity_id === entityId
      );
      if (selection) {
        bundleType = selection.bundle_type;
        if (selection.depth === 1 || selection.depth === 2) {
          depth = selection.depth;
        }
      }
    }

    return {
      kind: 'ENTITY',
      entity_type: entityType,
      entity_id: entityId,
      label: entityId, // Use ID as label; will be resolved by UI
      bundle_type: bundleType,
      depth: depth,
    };
  }
  // Fallback for simple ID format
  return {
    kind: 'ENTITY',
    entity_type: 'unknown',
    entity_id: entityIdStr,
    label: entityIdStr,
  };
}

/**
 * Parses diagram ID string into DiagramRef.
 *
 * @param diagramId - The diagram ID from backend
 * @param diagramSelections - Optional structured selections to extract bundle_type
 * @returns DiagramRef with parsed values
 */
function parseDiagramRef(
  diagramId: string,
  diagramSelections?: DiagramSelectionDto[] | null
): DiagramRef {
  let bundleType: string | undefined;

  if (diagramSelections && diagramSelections.length > 0) {
    const selection = diagramSelections.find((s) => s.diagram_id === diagramId);
    if (selection) {
      bundleType = selection.bundle_type;
    }
  }

  return {
    kind: 'DIAGRAM',
    diagram_id: diagramId,
    label: diagramId, // Will be resolved by UI
    bundle_type: bundleType,
  };
}

/**
 * Parses relationship ID string into RelationshipRef.
 * Format: "relationshipType::relationshipId"
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 *
 * @param relationshipIdStr - The relationship ID string from backend
 * @param relationshipSelections - Optional structured selections to extract label
 * @returns RelationshipRef with parsed values
 */
export function parseRelationshipRef(
  relationshipIdStr: string,
  relationshipSelections?: RelationshipSelectionDto[] | null
): RelationshipRef {
  const parts = relationshipIdStr.split('::');
  if (parts.length >= 2) {
    const relationshipType = parts[0];
    const relationshipId = parts[1];

    // Look up label from structured selections
    let label = `${relationshipType} - ${relationshipId}`;

    if (relationshipSelections && relationshipSelections.length > 0) {
      const selection = relationshipSelections.find(
        (s) => s.relationship_type === relationshipType && s.relationship_id === relationshipId
      );
      if (selection && selection.label) {
        label = selection.label;
      }
    }

    return {
      kind: 'RELATIONSHIP',
      relationship_type: relationshipType,
      relationship_id: relationshipId,
      label: label,
    };
  }
  // Fallback for simple ID format
  return {
    kind: 'RELATIONSHIP',
    relationship_type: 'unknown',
    relationship_id: relationshipIdStr,
    label: relationshipIdStr,
  };
}

/**
 * Converts EntityRef to storage string format.
 * Format: "entityType::entityId"
 *
 * @param ref - The EntityRef to convert
 * @returns String representation for backend storage
 */
function entityRefToString(ref: EntityRef): string {
  return `${ref.entity_type}::${ref.entity_id}`;
}

/**
 * Converts RelationshipRef to storage string format.
 * Format: "relationshipType::relationshipId"
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 *
 * @param ref - The RelationshipRef to convert
 * @returns String representation for backend storage
 */
export function relationshipRefToString(ref: RelationshipRef): string {
  return `${ref.relationship_type}::${ref.relationship_id}`;
}

/**
 * Converts EntityRef to EntitySelectionDto for structured selection storage.
 *
 * @param ref - The EntityRef to convert
 * @returns EntitySelectionDto for backend storage
 */
function entityRefToSelection(ref: EntityRef): EntitySelectionDto {
  return {
    entity_type: ref.entity_type,
    entity_id: ref.entity_id,
    bundle_type: ref.bundle_type || inferDefaultBundleType(ref.entity_type),
    depth: ref.depth ?? null,
  };
}

/**
 * Converts DiagramRef to DiagramSelectionDto for structured selection storage.
 *
 * @param ref - The DiagramRef to convert
 * @returns DiagramSelectionDto for backend storage
 */
function diagramRefToSelection(ref: DiagramRef): DiagramSelectionDto {
  return {
    diagram_id: ref.diagram_id,
    bundle_type: ref.bundle_type || 'diagram_only',
  };
}

/**
 * Converts RelationshipRef to RelationshipSelectionDto for structured selection storage.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 *
 * @param ref - The RelationshipRef to convert
 * @returns RelationshipSelectionDto for backend storage
 */
export function relationshipRefToSelection(ref: RelationshipRef): RelationshipSelectionDto {
  return {
    relationship_type: ref.relationship_type,
    relationship_id: ref.relationship_id,
    label: ref.label,
  };
}

/**
 * Infers the default bundle type for an entity based on its entity type.
 * Matches the backend logic in WorkItemImplementContextService.
 *
 * @param entityType - The entity type (e.g., "interfaces", "services", "physicalDataEntities")
 * @returns The default bundle type for the entity
 */
function inferDefaultBundleType(entityType: string): string {
  switch (entityType) {
    case 'interfaces':
      return 'interface_with_endpoints_and_schemas';
    case 'services':
      return 'service_with_parents_and_children';
    case 'physicalDataEntities':
    case 'physical_data_entities':
    case 'logicalDataEntities':
    case 'logical_data_entities':
      return 'entity_with_attributes_and_relationships';
    default:
      return 'entity_only';
  }
}

/**
 * Maps backend DTO to frontend ContextState.
 * Populates bundle_type and depth from structured selections when available.
 * Includes relationship_refs when available.
 *
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 *
 * @param dto - The backend DTO with snake_case fields
 * @returns The frontend ContextState
 */
function mapDtoToContextState(dto: ImplementContextDto): ContextState {
  // Parse relationship refs if available
  const relationshipRefs: RelationshipRef[] = (dto.selected_relationship_ids || []).map((id) =>
    parseRelationshipRef(id, dto.selected_relationship_selections)
  );

  return {
    version: 1,
    entity_refs: (dto.selected_entity_ids || []).map((id) =>
      parseEntityRef(id, dto.selected_entity_selections)
    ),
    diagram_refs: (dto.selected_diagram_ids || []).map((id) =>
      parseDiagramRef(id, dto.selected_diagram_selections)
    ),
    // Only include relationship_refs if there are any
    ...(relationshipRefs.length > 0 ? { relationship_refs: relationshipRefs } : {}),
  };
}

/**
 * Fetches implement context for a work item from the backend.
 *
 * @param projectId - The project identifier (filename)
 * @param workItemId - The work item identifier (UUID)
 * @returns Promise resolving to ContextState
 * @throws Error if the request fails with descriptive message
 */
export async function fetchImplementContext(
  projectId: string,
  workItemId: string
): Promise<ContextState> {
  if (!projectId || !workItemId) {
    return createEmptyContextState();
  }

  const encodedProjectId = encodeURIComponent(projectId);
  const encodedWorkItemId = encodeURIComponent(workItemId);
  const url = `${API_BASE}/api/projects/${encodedProjectId}/work-items/${encodedWorkItemId}/implement-context`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch implement context for work item "${workItemId}" in project "${projectId}": ${response.status} ${response.statusText}`
    );
  }

  const dto: ImplementContextDto = await response.json();
  return mapDtoToContextState(dto);
}

/**
 * Saves implement context for a work item to the backend.
 * Includes structured entity/diagram/relationship selections with bundle_type and depth.
 *
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 *
 * @param projectId - The project identifier (filename)
 * @param workItemId - The work item identifier (UUID)
 * @param state - The ContextState to save
 * @returns Promise resolving to the saved ContextState
 * @throws Error if the request fails with descriptive message
 */
export async function saveImplementContext(
  projectId: string,
  workItemId: string,
  state: ContextState
): Promise<ContextState> {
  if (!projectId || !workItemId) {
    throw new Error('projectId and workItemId are required to save implement context');
  }

  const encodedProjectId = encodeURIComponent(projectId);
  const encodedWorkItemId = encodeURIComponent(workItemId);
  const url = `${API_BASE}/api/projects/${encodedProjectId}/work-items/${encodedWorkItemId}/implement-context`;

  // Get relationship refs, defaulting to empty array
  const relationshipRefs = state.relationship_refs || [];

  // Build request body with legacy IDs and structured selections (including relationships)
  const requestBody = {
    selected_entity_ids: state.entity_refs.map(entityRefToString),
    selected_diagram_ids: state.diagram_refs.map((ref) => ref.diagram_id),
    selected_entity_selections: state.entity_refs.map(entityRefToSelection),
    selected_diagram_selections: state.diagram_refs.map(diagramRefToSelection),
    // Spec: Implement Context Include Relationships and Propagate to Planner Payload
    selected_relationship_ids: relationshipRefs.map(relationshipRefToString),
    selected_relationship_selections: relationshipRefs.map(relationshipRefToSelection),
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to save implement context for work item "${workItemId}" in project "${projectId}": ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  const dto: ImplementContextDto = await response.json();
  return mapDtoToContextState(dto);
}

// ============================================================================
// Expand-Resolve: Entity type normalisation & API function
// Spec: Append Resolved Architecture Context to Shape-Spec Stream Message
// ============================================================================

/**
 * Canonical mapping from snake_case entity types to camelCase.
 * Mirrors gateway's ENTITY_TYPE_CANONICAL_MAP in architectureModelClient.ts.
 */
const ENTITY_TYPE_CANONICAL_MAP: Record<string, string> = {
  physical_data_entities: 'physicalDataEntities',
  logical_data_entities: 'logicalDataEntities',
  app_components: 'appComponents',
  business_processes: 'businessProcesses',
  business_points: 'businessPoints',
  process_activities: 'businessPoints',
  ui_screens: 'uiScreens',
};

export function normalizeEntityType(entityType: string): string {
  return ENTITY_TYPE_CANONICAL_MAP[entityType] || entityType;
}

/** Resolved entity summary returned by expand-resolve. */
export interface ResolvedEntitySummary {
  id: string;
  name: string;
  entity_type: string;
  category: string;
  relevant_fields: Record<string, unknown>;
}

/** Resolved diagram summary returned by expand-resolve. */
export interface ResolvedDiagramSummary {
  id: string;
  name: string;
  diagram_type: string;
  referenced_entity_ids: string[];
  referenced_entity_names?: string[];
}

/** Resolved relationship returned by expand-resolve. */
export interface ResolvedRelationship {
  id: string;
  type: string;
  label: string;
  from: { entity_type: string; entity_id: string; name: string };
  to: { entity_type: string; entity_id: string; name: string };
  summary_fields: Record<string, unknown>;
}

/** Full expand-resolve response DTO. */
export interface ExpandResolveResponseDto {
  resolved_entities: ResolvedEntitySummary[];
  resolved_diagrams: ResolvedDiagramSummary[];
  resolved_relationships: ResolvedRelationship[];
  truncated: boolean;
  truncation_reason?: string;
}

/**
 * Calls the architecture-model-service expand-resolve endpoint.
 * Returns null on any failure (graceful degradation — the shape-spec stream
 * simply proceeds without architecture context).
 */
export async function expandResolveContext(
  projectId: string,
  selectedEntities: EntitySelectionDto[],
  selectedDiagrams: DiagramSelectionDto[]
): Promise<ExpandResolveResponseDto | null> {
  try {
    const encodedProjectId = encodeURIComponent(projectId);
    const url = `${API_BASE}/api/projects/${encodedProjectId}/implement-context/expand-resolve`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_entities: selectedEntities,
        selected_diagrams: selectedDiagrams,
      }),
    });

    if (!response.ok) {
      console.warn(
        `expand-resolve returned ${response.status} for project "${projectId}" — architecture context will be omitted`
      );
      return null;
    }

    return (await response.json()) as ExpandResolveResponseDto;
  } catch (err) {
    console.warn('expand-resolve call failed — architecture context will be omitted:', err);
    return null;
  }
}
