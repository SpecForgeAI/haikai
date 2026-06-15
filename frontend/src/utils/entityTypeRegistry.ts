/**
 * Entity Type Registry Module
 *
 * Single source of truth for SCREAMING_SNAKE_CASE entity type to MetaModelEntities key mappings.
 *
 * Purpose:
 * - Centralizes the mapping of diagram node entity types (e.g., 'APPLICATION')
 *   to their corresponding MetaModelEntities array keys (e.g., 'applications')
 * - Ensures consistency across rendering.ts and validation.ts
 * - Simplifies maintenance when new entity types are added
 *
 * Usage:
 * - rendering.ts: getEntityLabel(), getEntity(), validateDiagramNodes()
 * - validation.ts: validateModel() diagram node validation
 *
 * Format:
 * - Keys are SCREAMING_SNAKE_CASE (e.g., 'APPLICATION', 'CLASS', 'ACTIVITY_PARTITION')
 * - Values are snake_case plural (e.g., 'applications', 'classes', 'activity_partitions')
 *
 * @module entityTypeRegistry
 */

import { MetaModelEntities } from '../types/model';

/**
 * Centralized mapping of diagram node entity types (SCREAMING_SNAKE_CASE)
 * to MetaModelEntities keys (snake_case plural).
 *
 * This is the single source of truth for entity type mappings used by:
 * - rendering.ts: getEntityLabel(), getEntity(), validateDiagramNodes()
 * - validation.ts: validateModel() diagram node validation
 *
 * @constant
 * @type {Record<string, keyof MetaModelEntities>}
 *
 * @example
 * // Get the MetaModelEntities key for an entity type
 * const arrayKey = DIAGRAM_NODE_ENTITY_TYPE_MAP['APPLICATION']; // 'applications'
 * const entities = model.metaModel.entities[arrayKey]; // Application[]
 */
export const DIAGRAM_NODE_ENTITY_TYPE_MAP: Record<string, keyof MetaModelEntities> = {
  // ============================================================================
  // Application Domain (5 types)
  // ============================================================================
  /** APPLICATION -> applications: Core Application entity */
  APPLICATION: 'applications',
  /** APP_COMPONENT -> app_components: Application Component entity */
  APP_COMPONENT: 'app_components',
  /** SERVICE -> services: Service entity within an Application */
  SERVICE: 'services',
  /** INTERFACE -> interfaces: API Interface entity within a Service */
  INTERFACE: 'interfaces',
  /** ENDPOINT -> endpoints: Endpoint entity within an Interface */
  ENDPOINT: 'endpoints',

  // ============================================================================
  // Business Domain (4 types)
  // ============================================================================
  /** BUSINESS_USER -> business_users: Business User (actor) entity */
  BUSINESS_USER: 'business_users',
  /** BUSINESS_PROCESS -> business_processes: Business Process entity */
  BUSINESS_PROCESS: 'business_processes',
  /** PROCESS_ACTIVITY -> process_activities: Activity within a Business Process */
  PROCESS_ACTIVITY: 'process_activities',
  /** BUSINESS_POINT -> business_points: Derived Business Point entity */
  BUSINESS_POINT: 'business_points',

  // ============================================================================
  // Data Domain (2 types)
  // ============================================================================
  /** LOGICAL_DATA_ENTITY -> logical_data_entities: Logical Data Entity */
  LOGICAL_DATA_ENTITY: 'logical_data_entities',
  /** PHYSICAL_DATA_ENTITY -> physical_data_entities: Physical Data Entity */
  PHYSICAL_DATA_ENTITY: 'physical_data_entities',

  // ============================================================================
  // Derived Entities (2 types)
  // ============================================================================
  /** APPLICATION_POINT -> application_points: Derived Application Point entity */
  APPLICATION_POINT: 'application_points',
  /** INTERACTION -> interactions: User Interaction entity */
  INTERACTION: 'interactions',

  // ============================================================================
  // Behavioural Domain (8 types)
  // ============================================================================
  /** CLASS -> classes: Software Class entity */
  CLASS: 'classes',
  /** METHOD -> methods: Method entity within a Class */
  METHOD: 'methods',
  /** EVENT -> events: Business/System Event entity */
  EVENT: 'events',
  /** STATE -> states: State Machine State entity */
  STATE: 'states',
  /** STATE_TRANSITION -> state_transitions: State Machine Transition entity */
  STATE_TRANSITION: 'state_transitions',
  /** ACTIVITY -> activities: Activity Diagram Activity entity */
  ACTIVITY: 'activities',
  /** ACTIVITY_PARTITION -> activity_partitions: Activity Diagram Swimlane Partition */
  ACTIVITY_PARTITION: 'activity_partitions',
  /**
   * ACTIVITY_FLOW -> activity_flows: Activity Diagram Flow entity
   * Spec 2025-12-31: Added for ACTIVITY_FLOW validation fix (A4)
   * This enables proper edge handling when adding existing Activity Flows from RHS list
   */
  ACTIVITY_FLOW: 'activity_flows',

  // ============================================================================
  // UI Architecture Domain (4 types)
  // Spec 2026-01-03: Extended for UI Domain Palette feature
  // ============================================================================
  /**
   * UI_SCREEN -> ui_screens: UIScreen entity for UI_WORKFLOW diagrams
   * Spec 2026-01-02: Added for UI_SCREEN entity type registration bugfix
   * This enables UIScreen nodes to load and validate in UI_WORKFLOW diagrams
   */
  UI_SCREEN: 'ui_screens',
  /**
   * UI_WORKFLOW_TRANSITION -> ui_workflow_transitions: UIWorkflowTransition entity
   * Spec 2026-01-03: Added for UI Domain Palette feature
   * This enables UIWorkflowTransition nodes to load and validate in diagrams
   */
  UI_WORKFLOW_TRANSITION: 'ui_workflow_transitions',
  /**
   * UI_COMPONENT -> ui_components: UIComponent entity
   * Spec 2026-01-03: Added for UI Domain Palette feature
   * This enables UIComponent nodes to load and validate in diagrams
   */
  UI_COMPONENT: 'ui_components',
  /**
   * UI_ACTION -> ui_actions: UIAction entity
   * Spec 2026-01-03: Added for UI Domain Palette feature
   * This enables UIAction nodes to load and validate in diagrams
   */
  UI_ACTION: 'ui_actions',
};

/**
 * Get list of all known entity types for error messages.
 *
 * Returns an array of all SCREAMING_SNAKE_CASE entity type strings
 * that are registered in DIAGRAM_NODE_ENTITY_TYPE_MAP.
 *
 * Used primarily for improving error messages in validateDiagramNodes()
 * when an unknown entity type is encountered.
 *
 * @returns {string[]} Array of SCREAMING_SNAKE_CASE entity type strings
 *
 * @example
 * // Get known types for error message
 * const knownTypes = getKnownEntityTypes();
 * console.log(\`Unknown type. Known types: \${knownTypes.join(', ')}\`);
 * // Output: "Unknown type. Known types: APPLICATION, APP_COMPONENT, SERVICE, ..."
 */
export function getKnownEntityTypes(): string[] {
  return Object.keys(DIAGRAM_NODE_ENTITY_TYPE_MAP);
}
