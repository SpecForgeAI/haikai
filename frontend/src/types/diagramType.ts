/**
 * Diagram Type Definition and Constants
 *
 * Defines the diagram types used to filter palette sections in Diagram View.
 * Each diagram type determines which entities and relationships are available
 * in the palette panel.
 *
 * Diagram Types:
 * - General: All entities and relationships (no filtering, default)
 * - ER: Entity-Relationship diagrams (data modeling)
 * - Sequence: Sequence diagrams (interaction modeling)
 * - Activity: Activity diagrams (workflow modeling)
 * - State: State machine diagrams (behavioural modeling)
 * - UI_Workflow: UI workflow diagrams (navigation flow modeling)
 * - UI_SCREEN: UI screen diagrams (screen specification modeling)
 * - USER_JOURNEY: User journey diagrams (generated from meta-model data, not manually creatable)
 * - USER_JOURNEY_OVERVIEW: User journey overview diagrams (generated parent diagram, not manually creatable)
 * - Infrastructure: Infrastructure architecture diagrams (cloud topology, deployment placement)
 */

import { Diagram } from './model';

/**
 * DiagramType union type
 * Represents the allowed diagram type values
 */
export type DiagramType = 'General' | 'ER' | 'Sequence' | 'Activity' | 'State' | 'UI_Workflow' | 'UI_SCREEN' | 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW' | 'Infrastructure' | 'SECURITY_SUMMARY';

/**
 * Array of all diagram types for iteration
 */
export const ALL_DIAGRAM_TYPES: DiagramType[] = ['General', 'ER', 'Sequence', 'Activity', 'State', 'UI_Workflow', 'UI_SCREEN', 'USER_JOURNEY', 'USER_JOURNEY_OVERVIEW', 'Infrastructure', 'SECURITY_SUMMARY'];

/**
 * Array of diagram types that can be manually created via the NewDiagramModal.
 * Excludes types that are generated from meta-model data (e.g., USER_JOURNEY, USER_JOURNEY_OVERVIEW).
 * This is an explicit array (not a filter) for clarity and extensibility.
 */
export const CREATABLE_DIAGRAM_TYPES: DiagramType[] = ['General', 'ER', 'Sequence', 'Activity', 'State', 'UI_Workflow', 'UI_SCREEN', 'Infrastructure'];

/**
 * Display labels for each diagram type
 * Used in diagram type selector UI components
 */
export const DIAGRAM_TYPE_LABELS: Record<DiagramType, string> = {
  General: 'General',
  ER: 'ER',
  Sequence: 'Sequence',
  Activity: 'Activity',
  State: 'State',
  UI_Workflow: 'UI Workflow',
  UI_SCREEN: 'UI Screen',
  USER_JOURNEY: 'User Journey',
  USER_JOURNEY_OVERVIEW: 'User Journey Overview',
  Infrastructure: 'Infrastructure',
  SECURITY_SUMMARY: 'Security Summary',
};

/**
 * Default diagram type constant
 * Used when creating new diagrams or when diagram_type is null/undefined
 */
export const DEFAULT_DIAGRAM_TYPE: DiagramType = 'General';

/**
 * Case-insensitive mapping from input strings to canonical DiagramType values
 * Used internally by normalizeDiagramType
 */
const DIAGRAM_TYPE_MAP: Record<string, DiagramType> = {
  general: 'General',
  er: 'ER',
  sequence: 'Sequence',
  activity: 'Activity',
  state: 'State',
  ui_workflow: 'UI_Workflow',
  'ui workflow': 'UI_Workflow',
  ui_screen: 'UI_SCREEN',
  'ui screen': 'UI_SCREEN',
  user_journey: 'USER_JOURNEY',
  'user journey': 'USER_JOURNEY',
  user_journey_overview: 'USER_JOURNEY_OVERVIEW',
  'user journey overview': 'USER_JOURNEY_OVERVIEW',
  infrastructure: 'Infrastructure',
  // Security health dashboard (2026-07-19, Spec 3 of 3): generated from the
  // Security Overview screen only -- deliberately NOT in
  // CREATABLE_DIAGRAM_TYPES; renders via the General boxes-and-arrows canvas.
  security_summary: 'SECURITY_SUMMARY',
  'security summary': 'SECURITY_SUMMARY',
};

/**
 * Normalize a diagram type string to its canonical DiagramType value.
 *
 * Performs case-insensitive matching and trims whitespace.
 * Returns null for unknown/invalid/null/undefined values.
 *
 * @param value - The string to normalize (can be null or undefined)
 * @returns The canonical DiagramType value, or null if invalid
 *
 * @example
 * normalizeDiagramType('SEQUENCE') // returns 'Sequence'
 * normalizeDiagramType(' sequence ') // returns 'Sequence'
 * normalizeDiagramType('ui_workflow') // returns 'UI_Workflow'
 * normalizeDiagramType('ui_screen') // returns 'UI_SCREEN'
 * normalizeDiagramType('user_journey') // returns 'USER_JOURNEY'
 * normalizeDiagramType('user_journey_overview') // returns 'USER_JOURNEY_OVERVIEW'
 * normalizeDiagramType('INFRASTRUCTURE') // returns 'Infrastructure'
 * normalizeDiagramType('unknown') // returns null
 * normalizeDiagramType(null) // returns null
 */
export function normalizeDiagramType(value?: string | null): DiagramType | null {
  // Handle null/undefined input
  if (value == null) {
    return null;
  }

  // Trim whitespace and convert to lowercase for case-insensitive lookup
  const normalized = value.trim().toLowerCase();

  // Return the canonical value from the map, or null if not found
  return DIAGRAM_TYPE_MAP[normalized] ?? null;
}

/**
 * Check if a string is a valid DiagramType
 *
 * Uses normalizeDiagramType internally, making it tolerant to case variations
 * and whitespace.
 *
 * @param value - The string to check
 * @returns true if the value is a valid DiagramType (after normalization)
 */
export function isDiagramType(value: string): value is DiagramType {
  return normalizeDiagramType(value) !== null;
}

/**
 * Get the diagram type from a Diagram object with safe defaults
 *
 * Handles null/undefined diagram_type for backward compatibility.
 * Normalizes the diagram_type value to ensure consistent canonical values.
 *
 * @param diagram - The Diagram object (or null/undefined)
 * @returns The resolved DiagramType, defaulting to 'General'
 */
export function getDiagramType(diagram: Diagram | null | undefined): DiagramType {
  // Handle null/undefined diagram or missing diagram_type
  if (!diagram || !diagram.diagram_type) {
    return DEFAULT_DIAGRAM_TYPE;
  }

  // Normalize the diagram_type and return default if invalid
  return normalizeDiagramType(diagram.diagram_type) ?? DEFAULT_DIAGRAM_TYPE;
}
