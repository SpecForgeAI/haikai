/**
 * ContextPickerModal.bundle.test.tsx
 *
 * Spec 2026-01-16: Context Picker Bundles - UI and Selection Contract
 * Task Group 3: Tests for bundle selection state in ContextPickerModal
 *
 * Tests:
 * - Bundle state initializes from initialSelected.entity_refs with bundle_type
 * - Bundle state applies default bundle when entity lacks bundle_type
 * - Bundle state updates when user changes dropdown selection
 * - handleApply includes bundle_type in returned EntityRef objects
 * - handleApply sets 'diagram_only' bundle_type on DiagramRef objects
 *
 * Note: Following the existing test patterns in this project which test logic
 * rather than DOM interaction due to lack of @testing-library/react dependency.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ContextState, EntityRef, DiagramRef } from '../utils/contextStorage';
import type { PickOption } from '../utils/contextPickListBuilders';
import { getDefaultBundleType } from '../utils/contextBundleTypes';

// ============================================================================
// Test utility functions that mirror the component's internal logic
// ============================================================================

/**
 * Initializes bundle selections from ContextState
 * Mirrors the useEffect initialization logic for entityBundleSelections
 */
function initializeBundleSelectionsFromContext(
  initialSelected: ContextState
): Record<string, string> {
  const bundleSelections: Record<string, string> = {};

  for (const entityRef of initialSelected.entity_refs) {
    if (entityRef.bundle_type) {
      // Use existing bundle_type from saved context
      bundleSelections[entityRef.entity_id] = entityRef.bundle_type;
    } else {
      // Apply default bundle type based on entity_type
      const defaultBundle = getDefaultBundleType(entityRef.entity_type);
      if (defaultBundle) {
        bundleSelections[entityRef.entity_id] = defaultBundle;
      }
    }
  }

  return bundleSelections;
}

/**
 * Handles bundle change for an entity
 * Mirrors the handleBundleChange callback logic
 */
function handleBundleChange(
  currentSelections: Record<string, string>,
  entityId: string,
  bundleType: string
): Record<string, string> {
  return {
    ...currentSelections,
    [entityId]: bundleType,
  };
}

/**
 * Initializes bundle selection when an entity is toggled on
 * Mirrors the logic in handleEntityToggle for bundle initialization
 */
function initializeBundleOnSelection(
  currentSelections: Record<string, string>,
  entityId: string,
  entityType: string
): Record<string, string> {
  const defaultBundle = getDefaultBundleType(entityType);
  if (defaultBundle) {
    return {
      ...currentSelections,
      [entityId]: defaultBundle,
    };
  }
  return currentSelections;
}

/**
 * Cleans up bundle selection when an entity is toggled off
 * Mirrors the optional cleanup logic in handleEntityToggle
 */
function cleanupBundleOnDeselection(
  currentSelections: Record<string, string>,
  entityId: string
): Record<string, string> {
  const { [entityId]: _, ...rest } = currentSelections;
  return rest;
}

/**
 * Builds ContextState from selections with bundle_type included
 * Mirrors the updated handleApply logic in the component
 */
function buildContextStateWithBundles(
  selectedEntityIds: Set<string>,
  selectedDiagramIds: Set<string>,
  entityOptionMap: Map<string, PickOption>,
  diagramOptionMap: Map<string, PickOption>,
  entityBundleSelections: Record<string, string>
): ContextState {
  // Build entity refs from selections with bundle_type
  const entityRefs: EntityRef[] = [];
  for (const entityId of selectedEntityIds) {
    const option = entityOptionMap.get(entityId);
    if (option && option.entity_type) {
      entityRefs.push({
        kind: 'ENTITY',
        entity_type: option.entity_type,
        entity_id: entityId,
        label: option.label,
        bundle_type: entityBundleSelections[entityId],
      });
    }
  }

  // Build diagram refs from selections with bundle_type always set to 'diagram_only'
  const diagramRefs: DiagramRef[] = [];
  for (const diagramId of selectedDiagramIds) {
    const option = diagramOptionMap.get(diagramId);
    if (option) {
      diagramRefs.push({
        kind: 'DIAGRAM',
        diagram_id: diagramId,
        label: option.label,
        bundle_type: 'diagram_only',
      });
    }
  }

  return {
    version: 1,
    entity_refs: entityRefs,
    diagram_refs: diagramRefs,
  };
}

// ============================================================================
// Test Data
// ============================================================================

const mockArchitectureOptions: Record<string, PickOption[]> = {
  interfaces: [
    { value: 'int-1', label: 'Payment API', entity_type: 'interfaces' },
    { value: 'int-2', label: 'Order API', entity_type: 'interfaces' },
  ],
  services: [
    { value: 'svc-1', label: 'Auth Service', entity_type: 'services' },
    { value: 'svc-2', label: 'Payment Service', entity_type: 'services' },
  ],
  physical_data_entities: [
    { value: 'pde-1', label: 'Customer Table', entity_type: 'physical_data_entities' },
  ],
  applications: [
    { value: 'app-1', label: 'Core Application', entity_type: 'applications' },
  ],
};

const mockDiagramOptions: PickOption[] = [
  { value: 'diag-1', label: 'System Overview' },
  { value: 'diag-2', label: 'Data Flow Diagram' },
];

// Build entity and diagram option maps
function buildEntityOptionMap(options: Record<string, PickOption[]>): Map<string, PickOption> {
  const map = new Map<string, PickOption>();
  for (const opts of Object.values(options)) {
    for (const opt of opts) {
      map.set(opt.value, opt);
    }
  }
  return map;
}

function buildDiagramOptionMap(options: PickOption[]): Map<string, PickOption> {
  const map = new Map<string, PickOption>();
  for (const opt of options) {
    map.set(opt.value, opt);
  }
  return map;
}

// ============================================================================
// Tests
// ============================================================================

describe('ContextPickerModal Bundle State', () => {
  describe('Bundle state initialization from initialSelected', () => {
    it('initializes bundle state from initialSelected.entity_refs with bundle_type', () => {
      // Arrange - context with existing bundle_type values
      const initialSelected: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'interfaces',
            entity_id: 'int-1',
            label: 'Payment API',
            bundle_type: 'interface_with_endpoints',
          },
          {
            kind: 'ENTITY',
            entity_type: 'services',
            entity_id: 'svc-1',
            label: 'Auth Service',
            bundle_type: 'service_only',
          },
        ],
        diagram_refs: [],
      };

      // Act
      const bundleSelections = initializeBundleSelectionsFromContext(initialSelected);

      // Assert - should preserve existing bundle_type values
      expect(bundleSelections['int-1']).toBe('interface_with_endpoints');
      expect(bundleSelections['svc-1']).toBe('service_only');
    });

    it('applies default bundle when entity lacks bundle_type', () => {
      // Arrange - context without bundle_type (legacy data)
      const initialSelected: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'interfaces',
            entity_id: 'int-1',
            label: 'Payment API',
            // No bundle_type - should get default
          },
          {
            kind: 'ENTITY',
            entity_type: 'services',
            entity_id: 'svc-1',
            label: 'Auth Service',
            // No bundle_type - should get default
          },
          {
            kind: 'ENTITY',
            entity_type: 'physical_data_entities',
            entity_id: 'pde-1',
            label: 'Customer Table',
            // No bundle_type - should get default
          },
        ],
        diagram_refs: [],
      };

      // Act
      const bundleSelections = initializeBundleSelectionsFromContext(initialSelected);

      // Assert - should apply default bundle types
      expect(bundleSelections['int-1']).toBe('interface_with_endpoints_and_schemas');
      expect(bundleSelections['svc-1']).toBe('service_with_parents_and_children');
      expect(bundleSelections['pde-1']).toBe('entity_with_attributes_and_relationships');
    });

    it('does not set bundle for entity types without bundle support', () => {
      // Arrange - context with unsupported entity type
      const initialSelected: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'applications', // No bundle support
            entity_id: 'app-1',
            label: 'Core App',
          },
        ],
        diagram_refs: [],
      };

      // Act
      const bundleSelections = initializeBundleSelectionsFromContext(initialSelected);

      // Assert - should not have entry for unsupported entity type
      expect(bundleSelections['app-1']).toBeUndefined();
    });
  });

  describe('Bundle state updates on dropdown change', () => {
    it('updates bundle state when user changes dropdown selection', () => {
      // Arrange - initial state with default bundle
      let bundleSelections: Record<string, string> = {
        'int-1': 'interface_with_endpoints_and_schemas',
      };

      // Act - user changes to 'interface_only'
      bundleSelections = handleBundleChange(bundleSelections, 'int-1', 'interface_only');

      // Assert
      expect(bundleSelections['int-1']).toBe('interface_only');
    });

    it('preserves other bundle selections when updating one entity', () => {
      // Arrange
      let bundleSelections: Record<string, string> = {
        'int-1': 'interface_with_endpoints_and_schemas',
        'svc-1': 'service_with_parents_and_children',
      };

      // Act
      bundleSelections = handleBundleChange(bundleSelections, 'int-1', 'interface_with_endpoints');

      // Assert
      expect(bundleSelections['int-1']).toBe('interface_with_endpoints');
      expect(bundleSelections['svc-1']).toBe('service_with_parents_and_children');
    });
  });

  describe('Bundle initialization on entity selection', () => {
    it('initializes default bundle when entity is selected', () => {
      // Arrange
      let bundleSelections: Record<string, string> = {};

      // Act - user selects an interface
      bundleSelections = initializeBundleOnSelection(bundleSelections, 'int-1', 'interfaces');

      // Assert
      expect(bundleSelections['int-1']).toBe('interface_with_endpoints_and_schemas');
    });

    it('cleans up bundle selection when entity is deselected', () => {
      // Arrange
      let bundleSelections: Record<string, string> = {
        'int-1': 'interface_with_endpoints',
        'svc-1': 'service_only',
      };

      // Act - user deselects int-1
      bundleSelections = cleanupBundleOnDeselection(bundleSelections, 'int-1');

      // Assert
      expect(bundleSelections['int-1']).toBeUndefined();
      expect(bundleSelections['svc-1']).toBe('service_only');
    });
  });

  describe('handleApply includes bundle_type in refs', () => {
    it('includes bundle_type in returned EntityRef objects', () => {
      // Arrange
      const selectedEntityIds = new Set(['int-1', 'svc-1']);
      const selectedDiagramIds = new Set<string>();
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);
      const bundleSelections: Record<string, string> = {
        'int-1': 'interface_with_endpoints',
        'svc-1': 'service_only',
      };

      // Act
      const result = buildContextStateWithBundles(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap,
        bundleSelections
      );

      // Assert
      expect(result.entity_refs).toHaveLength(2);

      const intRef = result.entity_refs.find(r => r.entity_id === 'int-1');
      const svcRef = result.entity_refs.find(r => r.entity_id === 'svc-1');

      expect(intRef?.bundle_type).toBe('interface_with_endpoints');
      expect(svcRef?.bundle_type).toBe('service_only');
    });

    it('sets diagram_only bundle_type on DiagramRef objects', () => {
      // Arrange
      const selectedEntityIds = new Set<string>();
      const selectedDiagramIds = new Set(['diag-1', 'diag-2']);
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);
      const bundleSelections: Record<string, string> = {};

      // Act
      const result = buildContextStateWithBundles(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap,
        bundleSelections
      );

      // Assert
      expect(result.diagram_refs).toHaveLength(2);
      expect(result.diagram_refs[0].bundle_type).toBe('diagram_only');
      expect(result.diagram_refs[1].bundle_type).toBe('diagram_only');
    });

    it('handles mixed selections with entities and diagrams', () => {
      // Arrange
      const selectedEntityIds = new Set(['int-1', 'pde-1']);
      const selectedDiagramIds = new Set(['diag-1']);
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);
      const bundleSelections: Record<string, string> = {
        'int-1': 'interface_with_endpoints_and_schemas',
        'pde-1': 'entity_with_attributes_and_relationships',
      };

      // Act
      const result = buildContextStateWithBundles(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap,
        bundleSelections
      );

      // Assert
      expect(result.entity_refs).toHaveLength(2);
      expect(result.diagram_refs).toHaveLength(1);

      const intRef = result.entity_refs.find(r => r.entity_id === 'int-1');
      const pdeRef = result.entity_refs.find(r => r.entity_id === 'pde-1');

      expect(intRef?.bundle_type).toBe('interface_with_endpoints_and_schemas');
      expect(pdeRef?.bundle_type).toBe('entity_with_attributes_and_relationships');
      expect(result.diagram_refs[0].bundle_type).toBe('diagram_only');
    });

    it('handles entity without bundle selection (undefined bundle_type)', () => {
      // Arrange - entity type without bundle support (applications)
      const selectedEntityIds = new Set(['app-1']);
      const selectedDiagramIds = new Set<string>();
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);
      const bundleSelections: Record<string, string> = {}; // No bundle for app-1

      // Act
      const result = buildContextStateWithBundles(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap,
        bundleSelections
      );

      // Assert
      expect(result.entity_refs).toHaveLength(1);
      expect(result.entity_refs[0].entity_id).toBe('app-1');
      expect(result.entity_refs[0].bundle_type).toBeUndefined();
    });
  });
});
