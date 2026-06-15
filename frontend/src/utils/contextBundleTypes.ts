/**
 * contextBundleTypes.ts
 *
 * Spec 2026-01-16: Context Picker Bundles - UI and Selection Contract
 * Task Group 1: Bundle type constants and helpers
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 1: Added depth-related constants (DEPTH_OPTIONS, DEPTH_LABELS, DEPTH_WARNING)
 *
 * This module provides:
 * - TypeScript union types for bundle scopes
 * - Helper functions to get default bundle types and available options per entity type
 * - Human-readable labels for UI display
 * - Depth control constants for entity relationship expansion
 */

// ============================================================================
// Bundle Type Union Types
// ============================================================================

/**
 * InterfaceBundleType - bundle scope options for interface entities
 */
export type InterfaceBundleType =
  | 'interface_only'
  | 'interface_with_endpoints'
  | 'interface_with_endpoints_and_schemas';

/**
 * ServiceBundleType - bundle scope options for service entities
 */
export type ServiceBundleType =
  | 'service_only'
  | 'service_with_parents_and_children';

/**
 * PhysicalDataEntityBundleType - bundle scope options for physical data entities
 */
export type PhysicalDataEntityBundleType =
  | 'entity_only'
  | 'entity_with_attributes_and_relationships';

/**
 * DiagramBundleType - bundle scope options for diagrams
 */
export type DiagramBundleType = 'diagram_only';

/**
 * BundleType - union of all bundle type options
 */
export type BundleType =
  | InterfaceBundleType
  | ServiceBundleType
  | PhysicalDataEntityBundleType
  | DiagramBundleType;

// ============================================================================
// Bundle Options by Entity Type
// ============================================================================

/**
 * Interface bundle options in order of scope (narrowest to widest)
 */
const INTERFACE_BUNDLE_OPTIONS: InterfaceBundleType[] = [
  'interface_only',
  'interface_with_endpoints',
  'interface_with_endpoints_and_schemas',
];

/**
 * Service bundle options in order of scope (narrowest to widest)
 */
const SERVICE_BUNDLE_OPTIONS: ServiceBundleType[] = [
  'service_only',
  'service_with_parents_and_children',
];

/**
 * Physical data entity bundle options in order of scope (narrowest to widest)
 */
const PHYSICAL_DATA_ENTITY_BUNDLE_OPTIONS: PhysicalDataEntityBundleType[] = [
  'entity_only',
  'entity_with_attributes_and_relationships',
];

/**
 * Diagram bundle options (single option for now)
 */
const DIAGRAM_BUNDLE_OPTIONS: DiagramBundleType[] = ['diagram_only'];

// ============================================================================
// Human-Readable Labels
// ============================================================================

/**
 * BUNDLE_TYPE_LABELS - mapping of bundle type keys to human-readable display labels
 */
export const BUNDLE_TYPE_LABELS: Record<string, string> = {
  // Interface bundle labels
  interface_only: 'Interface Only',
  interface_with_endpoints: 'With Endpoints',
  interface_with_endpoints_and_schemas: 'With Endpoints & Schemas',

  // Service bundle labels
  service_only: 'Service Only',
  service_with_parents_and_children: 'With Parents & Children',

  // Physical data entity bundle labels
  entity_only: 'Entity Only',
  entity_with_attributes_and_relationships: 'With Attributes & Relationships',

  // Diagram bundle labels
  diagram_only: 'Diagram Only',
};

// ============================================================================
// Depth Control Constants
// Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
// ============================================================================

/**
 * DEPTH_OPTIONS - available depth values for entity relationship expansion
 * - 1: Default depth, includes direct relationships only
 * - 2: Extended depth, includes relationships up to 2 hops
 */
export const DEPTH_OPTIONS: Array<1 | 2> = [1, 2];

/**
 * DEPTH_LABELS - human-readable labels for depth selector dropdown
 */
export const DEPTH_LABELS: Record<number, string> = {
  1: 'Depth 1',
  2: 'Depth 2 (Extended)',
};

/**
 * DEPTH_WARNING - warning message displayed when depth 2 is selected
 * Alerts users that extended depth may significantly increase context size
 */
export const DEPTH_WARNING = 'May increase context size significantly';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the default bundle type for a given entity type
 *
 * @param entityType - The entity collection key (e.g., "interfaces", "services")
 * @returns The default bundle type string, or undefined if the entity type has no bundle support
 */
export function getDefaultBundleType(entityType: string): string | undefined {
  switch (entityType) {
    case 'interfaces':
      return 'interface_with_endpoints_and_schemas';
    case 'services':
      return 'service_with_parents_and_children';
    case 'physical_data_entities':
      return 'entity_with_attributes_and_relationships';
    case 'diagrams':
      return 'diagram_only';
    default:
      return undefined;
  }
}

/**
 * Get the available bundle options for a given entity type
 *
 * @param entityType - The entity collection key (e.g., "interfaces", "services")
 * @returns Array of available bundle type strings, or empty array if the entity type has no bundle support
 */
export function getBundleOptionsForEntityType(entityType: string): string[] {
  switch (entityType) {
    case 'interfaces':
      return [...INTERFACE_BUNDLE_OPTIONS];
    case 'services':
      return [...SERVICE_BUNDLE_OPTIONS];
    case 'physical_data_entities':
      return [...PHYSICAL_DATA_ENTITY_BUNDLE_OPTIONS];
    case 'diagrams':
      return [...DIAGRAM_BUNDLE_OPTIONS];
    default:
      return [];
  }
}
