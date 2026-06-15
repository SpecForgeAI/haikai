/**
 * contextBundleIntegration.test.ts
 *
 * Spec 2026-01-16: Context Picker Bundles - UI and Selection Contract
 * Task Group 5: Strategic integration tests for bundle feature
 *
 * Tests:
 * - Full modal flow: open modal -> select entity -> choose bundle -> apply -> verify context saved
 * - Backward compatibility: loading context without bundle_type shows defaults
 * - Changing bundle selection and applying preserves new value
 * - Re-opening modal preserves previously saved bundle selections
 * - Mixed selection scenario: entities with and without bundle support
 * - Edge case: empty selection produces empty context state
 *
 * Note: Following the existing test patterns in this project which test logic
 * rather than DOM interaction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadContext,
  saveContext,
  createEmptyContextState,
} from '../utils/contextStorage';
import type { ContextState, EntityRef, DiagramRef } from '../utils/contextStorage';
import type { PickOption } from '../utils/contextPickListBuilders';
import { getDefaultBundleType } from '../utils/contextBundleTypes';

// ============================================================================
// Mock localStorage
// ============================================================================

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// ============================================================================
// Test utility functions that mirror ContextPickerModal logic
// ============================================================================

/**
 * Simulates opening the modal and initializing state from saved context
 * Mirrors the useEffect initialization logic
 */
function initializeModalState(initialSelected: ContextState): {
  selectedEntityIds: Set<string>;
  selectedDiagramIds: Set<string>;
  entityBundleSelections: Record<string, string>;
} {
  const selectedEntityIds = new Set<string>();
  const selectedDiagramIds = new Set<string>();
  const entityBundleSelections: Record<string, string> = {};

  // Initialize entity selections and bundle state
  for (const entityRef of initialSelected.entity_refs) {
    selectedEntityIds.add(entityRef.entity_id);
    if (entityRef.bundle_type) {
      entityBundleSelections[entityRef.entity_id] = entityRef.bundle_type;
    } else {
      // Apply default bundle type for entities without saved bundle_type
      const defaultBundle = getDefaultBundleType(entityRef.entity_type);
      if (defaultBundle) {
        entityBundleSelections[entityRef.entity_id] = defaultBundle;
      }
    }
  }

  // Initialize diagram selections
  for (const diagramRef of initialSelected.diagram_refs) {
    selectedDiagramIds.add(diagramRef.diagram_id);
  }

  return { selectedEntityIds, selectedDiagramIds, entityBundleSelections };
}

/**
 * Simulates entity toggle on (selection)
 * Mirrors handleEntityToggle when isSelected becomes true
 */
function toggleEntityOn(
  selectedEntityIds: Set<string>,
  entityBundleSelections: Record<string, string>,
  entityId: string,
  entityType: string
): { selectedEntityIds: Set<string>; entityBundleSelections: Record<string, string> } {
  const newSelectedIds = new Set(selectedEntityIds);
  newSelectedIds.add(entityId);

  const newBundleSelections = { ...entityBundleSelections };
  const defaultBundle = getDefaultBundleType(entityType);
  if (defaultBundle) {
    newBundleSelections[entityId] = defaultBundle;
  }

  return {
    selectedEntityIds: newSelectedIds,
    entityBundleSelections: newBundleSelections,
  };
}

/**
 * Simulates entity toggle off (deselection)
 * Mirrors handleEntityToggle when isSelected becomes false
 */
function toggleEntityOff(
  selectedEntityIds: Set<string>,
  entityBundleSelections: Record<string, string>,
  entityId: string
): { selectedEntityIds: Set<string>; entityBundleSelections: Record<string, string> } {
  const newSelectedIds = new Set(selectedEntityIds);
  newSelectedIds.delete(entityId);

  const { [entityId]: _, ...newBundleSelections } = entityBundleSelections;

  return {
    selectedEntityIds: newSelectedIds,
    entityBundleSelections: newBundleSelections,
  };
}

/**
 * Simulates bundle dropdown change
 * Mirrors handleBundleChange callback
 */
function changeBundleSelection(
  entityBundleSelections: Record<string, string>,
  entityId: string,
  newBundleType: string
): Record<string, string> {
  return {
    ...entityBundleSelections,
    [entityId]: newBundleType,
  };
}

/**
 * Simulates the Apply button click
 * Mirrors handleApply logic to build ContextState
 */
function buildApplyResult(
  selectedEntityIds: Set<string>,
  selectedDiagramIds: Set<string>,
  entityOptionMap: Map<string, PickOption>,
  diagramOptionMap: Map<string, PickOption>,
  entityBundleSelections: Record<string, string>
): ContextState {
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
];

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

const entityMap = buildEntityOptionMap(mockArchitectureOptions);
const diagramMap = buildDiagramOptionMap(mockDiagramOptions);

// ============================================================================
// Integration Tests
// ============================================================================

describe('Context Bundle Integration Tests', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  describe('Full modal flow: open -> select -> choose bundle -> apply -> verify', () => {
    it('completes full workflow: select entity, choose bundle, apply, save, and reload', () => {
      // Arrange - start with empty context
      const projectId = 'integration-test-project';
      const workItemId = 'feature-123';

      // Step 1: Open modal with empty initial context
      const emptyContext = createEmptyContextState();
      let modalState = initializeModalState(emptyContext);

      // Step 2: Select an interface entity
      modalState = {
        ...modalState,
        ...toggleEntityOn(
          modalState.selectedEntityIds,
          modalState.entityBundleSelections,
          'int-1',
          'interfaces'
        ),
      };

      // Assert: default bundle should be applied
      expect(modalState.entityBundleSelections['int-1']).toBe('interface_with_endpoints_and_schemas');

      // Step 3: Change bundle selection to a different value
      modalState.entityBundleSelections = changeBundleSelection(
        modalState.entityBundleSelections,
        'int-1',
        'interface_with_endpoints'
      );

      // Assert: bundle should be updated
      expect(modalState.entityBundleSelections['int-1']).toBe('interface_with_endpoints');

      // Step 4: Click Apply to build the context state
      const contextToSave = buildApplyResult(
        modalState.selectedEntityIds,
        modalState.selectedDiagramIds,
        entityMap,
        diagramMap,
        modalState.entityBundleSelections
      );

      // Step 5: Save context to localStorage
      saveContext(projectId, workItemId, contextToSave);

      // Step 6: Load context and verify
      const loadedContext = loadContext(projectId, workItemId);

      // Assert: loaded context should have the interface with changed bundle
      expect(loadedContext.entity_refs).toHaveLength(1);
      expect(loadedContext.entity_refs[0].entity_id).toBe('int-1');
      expect(loadedContext.entity_refs[0].bundle_type).toBe('interface_with_endpoints');
    });
  });

  describe('Backward compatibility: loading context without bundle_type shows defaults', () => {
    it('applies default bundle types when loading legacy context without bundle_type', () => {
      // Arrange - simulate legacy stored data without bundle_type
      const projectId = 'legacy-compat-project';
      const workItemId = 'old-work-item';
      const key = `product_context::${projectId}::${workItemId}`;

      const legacyData = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'interfaces', entity_id: 'int-1', label: 'Legacy Interface' },
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Legacy Service' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'Legacy Diagram' },
        ],
      };

      mockLocalStorage.setItem(key, JSON.stringify(legacyData));

      // Act - load context and initialize modal state
      const loadedContext = loadContext(projectId, workItemId);
      const modalState = initializeModalState(loadedContext);

      // Assert - defaults should be applied for entities with bundle support
      expect(modalState.entityBundleSelections['int-1']).toBe('interface_with_endpoints_and_schemas');
      expect(modalState.entityBundleSelections['svc-1']).toBe('service_with_parents_and_children');

      // Assert - entity IDs should be selected
      expect(modalState.selectedEntityIds.has('int-1')).toBe(true);
      expect(modalState.selectedEntityIds.has('svc-1')).toBe(true);

      // Assert - diagram should be selected
      expect(modalState.selectedDiagramIds.has('diag-1')).toBe(true);
    });
  });

  describe('Changing bundle selection and applying preserves new value', () => {
    it('preserves changed bundle value through save/load cycle', () => {
      // Arrange
      const projectId = 'bundle-change-project';
      const workItemId = 'feature-456';

      // Step 1: Start with context that has default bundle
      const initialContext: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physical_data_entities',
            entity_id: 'pde-1',
            label: 'Customer Table',
            bundle_type: 'entity_with_attributes_and_relationships', // default
          },
        ],
        diagram_refs: [],
      };

      saveContext(projectId, workItemId, initialContext);

      // Step 2: Load and open modal
      const loadedContext = loadContext(projectId, workItemId);
      let modalState = initializeModalState(loadedContext);

      // Assert: initial bundle should be loaded
      expect(modalState.entityBundleSelections['pde-1']).toBe('entity_with_attributes_and_relationships');

      // Step 3: Change to entity_only bundle
      modalState.entityBundleSelections = changeBundleSelection(
        modalState.entityBundleSelections,
        'pde-1',
        'entity_only'
      );

      // Step 4: Apply and save
      const updatedContext = buildApplyResult(
        modalState.selectedEntityIds,
        modalState.selectedDiagramIds,
        entityMap,
        diagramMap,
        modalState.entityBundleSelections
      );
      saveContext(projectId, workItemId, updatedContext);

      // Step 5: Reload and verify change was persisted
      const reloadedContext = loadContext(projectId, workItemId);

      // Assert
      expect(reloadedContext.entity_refs[0].bundle_type).toBe('entity_only');
    });
  });

  describe('Re-opening modal preserves previously saved bundle selections', () => {
    it('preserves custom bundle selections when modal is closed and re-opened', () => {
      // Arrange
      const projectId = 'reopen-modal-project';
      const workItemId = 'feature-789';

      // Step 1: Save context with non-default bundles
      const savedContext: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'interfaces',
            entity_id: 'int-1',
            label: 'Payment API',
            bundle_type: 'interface_only', // Not the default
          },
          {
            kind: 'ENTITY',
            entity_type: 'services',
            entity_id: 'svc-1',
            label: 'Auth Service',
            bundle_type: 'service_only', // Not the default
          },
        ],
        diagram_refs: [
          {
            kind: 'DIAGRAM',
            diagram_id: 'diag-1',
            label: 'Overview',
            bundle_type: 'diagram_only',
          },
        ],
      };

      saveContext(projectId, workItemId, savedContext);

      // Step 2: Simulate re-opening modal (load and initialize state)
      const loadedContext = loadContext(projectId, workItemId);
      const modalState = initializeModalState(loadedContext);

      // Assert: custom bundle selections should be preserved, not replaced with defaults
      expect(modalState.entityBundleSelections['int-1']).toBe('interface_only');
      expect(modalState.entityBundleSelections['svc-1']).toBe('service_only');

      // Assert: entities and diagrams should be selected
      expect(modalState.selectedEntityIds.size).toBe(2);
      expect(modalState.selectedDiagramIds.size).toBe(1);
    });
  });

  describe('Mixed selection scenario: entities with and without bundle support', () => {
    it('handles mixed selection of entities with and without bundle support', () => {
      // Arrange
      const projectId = 'mixed-selection-project';
      const workItemId = 'mixed-feature';

      // Start with empty context
      let modalState = initializeModalState(createEmptyContextState());

      // Step 1: Select interface (has bundle support)
      modalState = {
        ...modalState,
        ...toggleEntityOn(
          modalState.selectedEntityIds,
          modalState.entityBundleSelections,
          'int-1',
          'interfaces'
        ),
      };

      // Step 2: Select application (NO bundle support)
      modalState = {
        ...modalState,
        ...toggleEntityOn(
          modalState.selectedEntityIds,
          modalState.entityBundleSelections,
          'app-1',
          'applications'
        ),
      };

      // Assert: interface should have bundle, application should not
      expect(modalState.entityBundleSelections['int-1']).toBe('interface_with_endpoints_and_schemas');
      expect(modalState.entityBundleSelections['app-1']).toBeUndefined();

      // Step 3: Build and save context
      const contextToSave = buildApplyResult(
        modalState.selectedEntityIds,
        modalState.selectedDiagramIds,
        entityMap,
        diagramMap,
        modalState.entityBundleSelections
      );

      saveContext(projectId, workItemId, contextToSave);

      // Step 4: Reload and verify
      const loadedContext = loadContext(projectId, workItemId);

      // Assert
      expect(loadedContext.entity_refs).toHaveLength(2);

      const intRef = loadedContext.entity_refs.find(r => r.entity_id === 'int-1');
      const appRef = loadedContext.entity_refs.find(r => r.entity_id === 'app-1');

      expect(intRef?.bundle_type).toBe('interface_with_endpoints_and_schemas');
      expect(appRef?.bundle_type).toBeUndefined();
    });
  });

  describe('Edge case: empty selection produces empty context state', () => {
    it('produces empty context when no entities or diagrams are selected', () => {
      // Arrange
      const modalState = initializeModalState(createEmptyContextState());

      // Act - Apply with no selections
      const result = buildApplyResult(
        modalState.selectedEntityIds,
        modalState.selectedDiagramIds,
        entityMap,
        diagramMap,
        modalState.entityBundleSelections
      );

      // Assert
      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(0);
      expect(result.diagram_refs).toHaveLength(0);
    });
  });
});
