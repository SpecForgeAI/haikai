/**
 * UI Domain Palette Utilities
 * Spec 2026-01-03: Diagram View RHS UI Domain Palette
 * Task Group 2: UI Domain Palette Utilities
 *
 * Helper functions for the RHS palette when working with UI domain entities:
 * - isEntityOnDiagram: Check if an entity has a node on the diagram
 * - formatUIScreenLabel: Format UIScreen entity label
 * - formatUIWorkflowTransitionLabel: Format UIWorkflowTransition entity label
 * - formatUIComponentLabel: Format UIComponent entity label
 * - formatUIActionLabel: Format UIAction entity label
 *
 * These utilities follow the pattern established by:
 * - uiWorkflowDiagramPaletteUtils.ts (for UI_Workflow diagram-specific utilities)
 * - stateDiagramPaletteUtils.ts (for State diagram utilities)
 */

import type { DiagramNode, UIScreen, UIWorkflowTransition, UIComponent, UIAction } from '../types/model';

// ============================================================================
// On-Diagram Detection Helpers
// ============================================================================

/**
 * Check if an entity has a corresponding DiagramNode on the diagram.
 *
 * This is a generic helper that works for any entity type by matching
 * both entity_type and entity_id fields on diagram nodes.
 *
 * @param entityType - The entity type (e.g., 'UI_SCREEN', 'UI_COMPONENT')
 * @param entityId - The ID of the entity
 * @param diagramNodes - Array of DiagramNodes on the current diagram
 * @returns true if the entity has a node on the diagram
 */
export function isEntityOnDiagram(
  entityType: string,
  entityId: string,
  diagramNodes: DiagramNode[]
): boolean {
  return diagramNodes.some(
    (node) => node.entity_type === entityType && node.entity_id === entityId
  );
}

// ============================================================================
// Label Formatting Helpers
// ============================================================================

/**
 * Format a UIScreen entity label for display in the palette.
 *
 * Returns "name (route)" if route is present, otherwise just "name".
 *
 * @param screen - The UIScreen entity
 * @returns Formatted label string
 *
 * @example
 * formatUIScreenLabel({ id: '1', name: 'Dashboard', route: '/dashboard' })
 * // Returns: "Dashboard (/dashboard)"
 */
export function formatUIScreenLabel(screen: UIScreen): string {
  if (screen.route && screen.route.trim() !== '') {
    return `${screen.name} (${screen.route})`;
  }
  return screen.name;
}

/**
 * Format a UIWorkflowTransition entity label for display in the palette.
 *
 * Returns "name (source -> target)" if both source and target screen names
 * can be resolved from the screens array, otherwise just "name".
 *
 * @param transition - The UIWorkflowTransition entity
 * @param screens - Array of UIScreen entities for name resolution
 * @returns Formatted label string
 *
 * @example
 * formatUIWorkflowTransitionLabel(
 *   { id: '1', name: 'Login Flow', source_screen_id: 's1', target_screen_id: 's2' },
 *   [{ id: 's1', name: 'Login', route: '/login' }, { id: 's2', name: 'Home', route: '/home' }]
 * )
 * // Returns: "Login Flow (Login -> Home)"
 */
export function formatUIWorkflowTransitionLabel(
  transition: UIWorkflowTransition,
  screens: UIScreen[]
): string {
  const sourceScreen = screens.find((s) => s.id === transition.source_screen_id);
  const targetScreen = screens.find((s) => s.id === transition.target_screen_id);

  if (sourceScreen && targetScreen) {
    return `${transition.name} (${sourceScreen.name} -> ${targetScreen.name})`;
  }

  return transition.name;
}

/**
 * Format a UIComponent entity label for display in the palette.
 *
 * Returns "name [type]" if component_type is present, otherwise just "name".
 *
 * @param component - The UIComponent entity
 * @returns Formatted label string
 *
 * @example
 * formatUIComponentLabel({ id: '1', name: 'Submit Button', component_type: 'Button' })
 * // Returns: "Submit Button [Button]"
 */
export function formatUIComponentLabel(component: UIComponent): string {
  if (component.component_type && component.component_type.trim() !== '') {
    return `${component.name} [${component.component_type}]`;
  }
  return component.name;
}

/**
 * Format a UIAction entity label for display in the palette.
 *
 * Returns "name [trigger_type/effect_type]" if both are present,
 * "name [trigger_type]" if only trigger_type is present,
 * "name [effect_type]" if only effect_type is present,
 * otherwise just "name".
 *
 * @param action - The UIAction entity
 * @returns Formatted label string
 *
 * @example
 * formatUIActionLabel({ id: '1', name: 'Submit', trigger_type: 'Click', effect_type: 'Navigate', owner_type: 'Component', owner_id: 'c1' })
 * // Returns: "Submit [Click/Navigate]"
 */
export function formatUIActionLabel(action: UIAction): string {
  const hasTrigger = action.trigger_type && action.trigger_type.trim() !== '';
  const hasEffect = action.effect_type && action.effect_type.trim() !== '';

  if (hasTrigger && hasEffect) {
    return `${action.name} [${action.trigger_type}/${action.effect_type}]`;
  }

  if (hasTrigger) {
    return `${action.name} [${action.trigger_type}]`;
  }

  if (hasEffect) {
    return `${action.name} [${action.effect_type}]`;
  }

  return action.name;
}
