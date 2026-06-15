/**
 * contextLabelResolver.ts
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 5: Label resolution utilities for context rehydration
 *
 * Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
 * - Updated rehydrateContextLabels() to check if label equals ID and re-resolve
 * - Labels matching IDs are now treated as "needs hydration"
 *
 * This module provides:
 * - resolveEntityLabel(): Look up entity name by ID from metaModelEntities
 * - resolveDiagramLabel(): Look up diagram name by ID from diagrams array
 * - resolveRelationshipLabel(): Compute relationship label from participant entities
 * - rehydrateContextLabels(): Resolve all labels in a ContextState
 *
 * Key behaviors:
 * - Returns "Loading..." when architecture data is not yet loaded
 * - Returns "Unknown Entity/Diagram/Relationship" when item not found
 * - NEVER permanently displays raw IDs
 */

import type { ContextState, EntityRef, DiagramRef, RelationshipRef } from './contextStorage';
import type { MetaModelEntities, MetaModelRelationships, Diagram } from '../types/model';
import { computeRelationshipLabel } from './contextRelationshipLabelUtils';
import { createEntityLookupFromMetaModel } from './contextPickListBuilders';

// ============================================================================
// Entity Label Resolution
// ============================================================================

/**
 * Resolve an entity's display label by looking up its name in metaModelEntities.
 *
 * @param entityId - The entity ID to look up
 * @param entityType - The entity collection key (e.g., "applications")
 * @param metaModelEntities - The entities object from architecture state (or undefined if not loaded)
 * @returns The entity name, "Loading...", or "Unknown Entity"
 */
export function resolveEntityLabel(
  entityId: string,
  entityType: string,
  metaModelEntities: MetaModelEntities | undefined
): string {
  // If entities not loaded yet, return loading placeholder
  if (!metaModelEntities) {
    return 'Loading...';
  }

  // Look up the collection by entity type
  const collection = metaModelEntities[entityType as keyof MetaModelEntities];

  if (!Array.isArray(collection)) {
    return 'Unknown Entity';
  }

  // Find the entity by ID
  const entity = collection.find((e) => {
    const record = e as unknown as Record<string, unknown>;
    return record.id === entityId;
  });

  if (!entity) {
    return 'Unknown Entity';
  }

  const entityRecord = entity as unknown as Record<string, unknown>;
  const name = entityRecord.name as string | undefined;

  return name && name.trim() ? name.trim() : 'Unknown Entity';
}

// ============================================================================
// Diagram Label Resolution
// ============================================================================

/**
 * Resolve a diagram's display label by looking up its name in the diagrams array.
 *
 * @param diagramId - The diagram ID to look up
 * @param diagrams - The diagrams array from architecture state (or undefined if not loaded)
 * @returns The diagram name, "Loading...", or "Unknown Diagram"
 */
export function resolveDiagramLabel(
  diagramId: string,
  diagrams: Diagram[] | undefined
): string {
  // If diagrams not loaded yet, return loading placeholder
  if (!diagrams) {
    return 'Loading...';
  }

  // Find the diagram by ID
  const diagram = diagrams.find((d) => d.id === diagramId);

  if (!diagram) {
    return 'Unknown Diagram';
  }

  return diagram.name && diagram.name.trim() ? diagram.name.trim() : 'Unknown Diagram';
}

// ============================================================================
// Relationship Label Resolution
// ============================================================================

/**
 * Resolve a relationship's display label by computing it from participant entities.
 *
 * @param relationshipId - The relationship ID to look up
 * @param relationshipType - The relationship collection key
 * @param metaModelRelationships - The relationships object from architecture state
 * @param metaModelEntities - The entities object for name lookup
 * @returns The computed label, "Loading...", or "Unknown Relationship"
 */
export function resolveRelationshipLabel(
  relationshipId: string,
  relationshipType: string,
  metaModelRelationships: MetaModelRelationships | undefined,
  metaModelEntities: MetaModelEntities | undefined
): string {
  // If relationships not loaded yet, return loading placeholder
  if (!metaModelRelationships) {
    return 'Loading...';
  }

  // Look up the collection by relationship type
  const collection = metaModelRelationships[relationshipType as keyof MetaModelRelationships];

  if (!Array.isArray(collection)) {
    return 'Unknown Relationship';
  }

  // Find the relationship by ID
  const relationship = collection.find((r) => {
    const record = r as unknown as Record<string, unknown>;
    return record.id === relationshipId;
  });

  if (!relationship) {
    return 'Unknown Relationship';
  }

  // If entities not loaded, we can't compute the label properly
  if (!metaModelEntities) {
    return 'Loading...';
  }

  // Create entity lookup and compute label
  const relationshipRecord = relationship as unknown as Record<string, unknown>;
  const entityLookup = createEntityLookupFromMetaModel(metaModelEntities);

  return computeRelationshipLabel(relationshipRecord, relationshipType, entityLookup);
}

// ============================================================================
// Label Validity Check Helpers
// ============================================================================

/**
 * Check if an entity label needs hydration.
 * A label needs hydration if:
 * - It's falsy (undefined, null, empty)
 * - It's whitespace only
 * - It equals "Loading..."
 * - It equals the entity_id (raw ID displayed as label)
 *
 * Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
 *
 * @param label - The current label value
 * @param entityId - The entity ID to check against
 * @returns true if the label needs hydration
 */
function needsEntityLabelHydration(label: string | undefined, entityId: string): boolean {
  if (!label || !label.trim()) {
    return true;
  }
  if (label === 'Loading...') {
    return true;
  }
  // If label equals the entity_id, it's a raw ID that needs resolution
  if (label === entityId) {
    return true;
  }
  return false;
}

/**
 * Check if a diagram label needs hydration.
 *
 * @param label - The current label value
 * @param diagramId - The diagram ID to check against
 * @returns true if the label needs hydration
 */
function needsDiagramLabelHydration(label: string | undefined, diagramId: string): boolean {
  if (!label || !label.trim()) {
    return true;
  }
  if (label === 'Loading...') {
    return true;
  }
  // If label equals the diagram_id, it's a raw ID that needs resolution
  if (label === diagramId) {
    return true;
  }
  return false;
}

/**
 * Check if a relationship label needs hydration.
 *
 * @param label - The current label value
 * @param relationshipId - The relationship ID to check against
 * @returns true if the label needs hydration
 */
function needsRelationshipLabelHydration(label: string | undefined, relationshipId: string): boolean {
  if (!label || !label.trim()) {
    return true;
  }
  if (label === 'Loading...') {
    return true;
  }
  // If label equals the relationship_id, it's a raw ID that needs resolution
  if (label === relationshipId) {
    return true;
  }
  return false;
}

// ============================================================================
// Full Context Rehydration
// ============================================================================

/**
 * Rehydrate all labels in a ContextState by resolving them from architecture data.
 *
 * This function is called when loading persisted context to ensure all labels
 * are up-to-date with the current architecture model.
 *
 * Behavior:
 * - If a ref has a valid label (not empty, not "Loading...", not equal to ID), it is preserved
 * - If label equals the entity/diagram/relationship ID, it is re-resolved (Spec 2026-01-17 fix)
 * - If architecture data is not loaded, labels are set to "Loading..."
 * - If item not found, labels are set to "Unknown Entity/Diagram/Relationship"
 * - NEVER displays raw IDs in labels
 *
 * Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
 * - Updated to check if label equals ID and re-resolve in that case
 *
 * @param contextState - The context state to rehydrate
 * @param metaModelEntities - The entities object (or undefined if not loaded)
 * @param diagrams - The diagrams array (or undefined if not loaded)
 * @param metaModelRelationships - The relationships object (or undefined if not loaded)
 * @returns A new ContextState with resolved labels
 */
export function rehydrateContextLabels(
  contextState: ContextState,
  metaModelEntities: MetaModelEntities | undefined,
  diagrams: Diagram[] | undefined,
  metaModelRelationships: MetaModelRelationships | undefined
): ContextState {
  // Resolve entity labels
  const entityRefs: EntityRef[] = contextState.entity_refs.map((ref) => {
    // Check if label needs hydration (empty, Loading..., or equals entity_id)
    if (!needsEntityLabelHydration(ref.label, ref.entity_id)) {
      return ref;
    }

    return {
      ...ref,
      label: resolveEntityLabel(ref.entity_id, ref.entity_type, metaModelEntities),
    };
  });

  // Resolve diagram labels
  const diagramRefs: DiagramRef[] = contextState.diagram_refs.map((ref) => {
    // Check if label needs hydration (empty, Loading..., or equals diagram_id)
    if (!needsDiagramLabelHydration(ref.label, ref.diagram_id)) {
      return ref;
    }

    return {
      ...ref,
      label: resolveDiagramLabel(ref.diagram_id, diagrams),
    };
  });

  // Resolve relationship labels
  const relationshipRefs: RelationshipRef[] = (contextState.relationship_refs || []).map((ref) => {
    // Check if label needs hydration (empty, Loading..., or equals relationship_id)
    if (!needsRelationshipLabelHydration(ref.label, ref.relationship_id)) {
      return ref;
    }

    return {
      ...ref,
      label: resolveRelationshipLabel(
        ref.relationship_id,
        ref.relationship_type,
        metaModelRelationships,
        metaModelEntities
      ),
    };
  });

  return {
    ...contextState,
    entity_refs: entityRefs,
    diagram_refs: diagramRefs,
    relationship_refs: relationshipRefs,
  };
}
