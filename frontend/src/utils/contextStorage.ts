/**
 * contextStorage.ts
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 1: Types and localStorage utilities for context persistence
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 1: Added optional depth field to EntityRef
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 1: Added RelationshipRef type and relationship_refs to ContextState
 *
 * This module provides:
 * - Context data model types (EntityRef, DiagramRef, RelationshipRef, ContextState)
 * - localStorage utilities for loading and saving context state
 * - Key pattern: product_context::<projectId>::<workItemId>
 */

// ============================================================================
// Context Data Model Types
// ============================================================================

/**
 * EntityRef - reference to an architecture entity linked to a work item
 */
export interface EntityRef {
  /** Discriminator to identify this as an entity reference */
  kind: 'ENTITY';
  /** The entity collection key (e.g., "applications", "services") */
  entity_type: string;
  /** The unique ID of the entity */
  entity_id: string;
  /** Display label for the entity */
  label: string;
  /** Optional bundle scope for context expansion */
  bundle_type?: string;
  /**
   * Optional depth for relationship expansion (only for entity bundles).
   * - 1 (default): Include direct relationships only
   * - 2: Include relationships up to 2 hops (may significantly increase context size)
   * When undefined, defaults to depth 1 for backward compatibility.
   *
   * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
   */
  depth?: 1 | 2;
}

/**
 * DiagramRef - reference to a diagram linked to a work item
 */
export interface DiagramRef {
  /** Discriminator to identify this as a diagram reference */
  kind: 'DIAGRAM';
  /** The unique ID of the diagram */
  diagram_id: string;
  /** Display label for the diagram */
  label: string;
  /** Optional bundle scope for context expansion */
  bundle_type?: string;
}

/**
 * RelationshipRef - reference to a relationship linked to a work item
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 1: New type for relationship context selection
 */
export interface RelationshipRef {
  /** Discriminator to identify this as a relationship reference */
  kind: 'RELATIONSHIP';
  /** The relationship collection key (e.g., "data_movements", "state_transitions") */
  relationship_type: string;
  /** The unique ID of the relationship */
  relationship_id: string;
  /** Display label for the relationship */
  label: string;
}

/**
 * ContextState - the complete context state for a work item
 * Version field included for future migrations
 */
export interface ContextState {
  /** Version number for future migration support */
  version: 1;
  /** Array of linked entity references */
  entity_refs: EntityRef[];
  /** Array of linked diagram references */
  diagram_refs: DiagramRef[];
  /**
   * Array of linked relationship references (optional for backward compatibility)
   *
   * Spec 2026-01-17: Context Picker Modal UI Improvements
   * Task Group 1: Added for relationship context selection
   */
  relationship_refs?: RelationshipRef[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an empty context state with default values
 */
export function createEmptyContextState(): ContextState {
  return {
    version: 1,
    entity_refs: [],
    diagram_refs: [],
  };
}

/**
 * Build the localStorage key for a work item's context
 * Pattern: product_context::<projectId>::<workItemId>
 */
function buildStorageKey(projectId: string, workItemId: string): string {
  return `product_context::${projectId}::${workItemId}`;
}

// ============================================================================
// localStorage Utilities
// ============================================================================

/**
 * Load context state from localStorage for a specific work item
 *
 * @param projectId - The project identifier (typically loadedFileName)
 * @param workItemId - The work item identifier
 * @returns The saved ContextState or an empty state if not found or corrupt
 */
export function loadContext(projectId: string, workItemId: string): ContextState {
  // Handle edge cases
  if (!projectId || !workItemId) {
    return createEmptyContextState();
  }

  const key = buildStorageKey(projectId, workItemId);

  try {
    const stored = localStorage.getItem(key);

    if (!stored) {
      return createEmptyContextState();
    }

    const parsed = JSON.parse(stored);

    // Basic validation: ensure required fields exist
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.version === 'number' &&
      Array.isArray(parsed.entity_refs) &&
      Array.isArray(parsed.diagram_refs)
    ) {
      return parsed as ContextState;
    }

    // Invalid structure, return empty state
    return createEmptyContextState();
  } catch {
    // JSON parse error or other issues - return empty state
    return createEmptyContextState();
  }
}

/**
 * Save context state to localStorage for a specific work item
 *
 * @param projectId - The project identifier (typically loadedFileName)
 * @param workItemId - The work item identifier
 * @param state - The ContextState to save
 */
export function saveContext(
  projectId: string,
  workItemId: string,
  state: ContextState
): void {
  // Handle edge cases
  if (!projectId || !workItemId) {
    console.warn('saveContext: projectId and workItemId are required');
    return;
  }

  const key = buildStorageKey(projectId, workItemId);

  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(key, serialized);
  } catch (error) {
    console.error('saveContext: Failed to save context to localStorage', error);
  }
}
