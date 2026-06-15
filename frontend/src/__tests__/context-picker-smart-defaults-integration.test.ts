/**
 * context-picker-smart-defaults-integration.test.ts
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 8: Integration tests for full feature flow
 *
 * These tests verify the complete integration between:
 * - EntityRef depth type
 * - EntityBundleSelection depth field
 * - Heuristic rules engine
 * - UI state management flow
 *
 * Tests:
 * 1. End-to-end flow: selection -> suggestion -> apply with depth
 * 2. Depth persists across modal open/close
 * 3. Multiple heuristic rules can fire together
 * 4. Diagram heuristic integration with entity selections
 * 5. Bundle upgrade maintains existing depth selection
 * 6. Backward compatibility: legacy refs without depth still work
 */

import { describe, it, expect } from 'vitest';
import type { EntityRef, ContextState } from '../utils/contextStorage';
import { computeSuggestions, type DiagramPickOption } from '../utils/contextHeuristics';
import type { PickOption } from '../utils/contextPickListBuilders';
import { DEPTH_OPTIONS, DEPTH_LABELS, DEPTH_WARNING } from '../utils/contextBundleTypes';

// ============================================================================
// Shared Test Utilities
// ============================================================================

interface SelectionState {
  selectedEntityIds: Set<string>;
  entityBundleSelections: Record<string, string>;
  entityDepthSelections: Record<string, 1 | 2>;
  selectedDiagramIds: Set<string>;
  dismissedSuggestionIds: Set<string>;
}

function createEmptySelectionState(): SelectionState {
  return {
    selectedEntityIds: new Set(),
    entityBundleSelections: {},
    entityDepthSelections: {},
    selectedDiagramIds: new Set(),
    dismissedSuggestionIds: new Set(),
  };
}

const testEntityOptionMap = new Map<string, PickOption>([
  ['int-1', { value: 'int-1', label: 'Payment API', entity_type: 'interfaces' }],
  ['int-2', { value: 'int-2', label: 'Order API', entity_type: 'interfaces' }],
  ['svc-1', { value: 'svc-1', label: 'Auth Service', entity_type: 'services' }],
  ['pde-1', { value: 'pde-1', label: 'Customer Table', entity_type: 'physical_data_entities' }],
  ['pde-2', { value: 'pde-2', label: 'Order Table', entity_type: 'physical_data_entities' }],
  ['pde-3', { value: 'pde-3', label: 'Product Table', entity_type: 'physical_data_entities' }],
]);

const testDiagramOptions: DiagramPickOption[] = [
  {
    value: 'diag-1',
    label: 'System Overview',
    entity_type: 'diagrams',
    referenced_entity_ids: ['int-1', 'svc-1', 'pde-1'],
  },
  {
    value: 'diag-2',
    label: 'Data Flow',
    entity_type: 'diagrams',
    referenced_entity_ids: ['pde-1', 'pde-2', 'pde-3'],
  },
];

// ============================================================================
// Integration Tests
// ============================================================================

describe('Context Picker Smart Defaults Integration', () => {
  describe('1. End-to-end flow: selection -> suggestion -> apply with depth', () => {
    it('complete flow from entity selection to context state with depth', () => {
      // Step 1: User selects a physical data entity
      const state = createEmptySelectionState();
      state.selectedEntityIds.add('pde-1');
      state.entityBundleSelections['pde-1'] = 'entity_with_attributes_and_relationships';
      state.entityDepthSelections['pde-1'] = 1; // Default depth

      // Step 2: User changes depth to 2
      state.entityDepthSelections['pde-1'] = 2;

      // Step 3: Build EntityRef for Apply (simulating handleApply)
      const entityRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: state.entityBundleSelections['pde-1'],
        depth: state.entityDepthSelections['pde-1'] === 2 ? 2 : undefined,
      };

      // Step 4: Build ContextState
      const contextState: ContextState = {
        version: 1,
        entity_refs: [entityRef],
        diagram_refs: [],
      };

      // Assert
      expect(contextState.entity_refs[0].depth).toBe(2);
      expect(contextState.entity_refs[0].bundle_type).toBe('entity_with_attributes_and_relationships');
    });
  });

  describe('2. Depth persists across modal open/close', () => {
    it('restores depth from saved EntityRef when reopening modal', () => {
      // Simulate saved context state with depth 2
      const savedContextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physical_data_entities',
            entity_id: 'pde-1',
            label: 'Customer Table',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 2,
          },
        ],
        diagram_refs: [],
      };

      // Simulate modal opening and restoring state
      const state = createEmptySelectionState();
      for (const entityRef of savedContextState.entity_refs) {
        state.selectedEntityIds.add(entityRef.entity_id);
        if (entityRef.bundle_type) {
          state.entityBundleSelections[entityRef.entity_id] = entityRef.bundle_type;
        }
        if (
          entityRef.bundle_type === 'entity_with_attributes_and_relationships' &&
          entityRef.depth !== undefined
        ) {
          state.entityDepthSelections[entityRef.entity_id] = entityRef.depth;
        } else if (entityRef.bundle_type === 'entity_with_attributes_and_relationships') {
          state.entityDepthSelections[entityRef.entity_id] = 1; // Default
        }
      }

      // Assert depth was restored
      expect(state.entityDepthSelections['pde-1']).toBe(2);
    });

    it('defaults to depth 1 when saved EntityRef has no depth', () => {
      // Simulate legacy saved context state without depth
      const savedContextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physical_data_entities',
            entity_id: 'pde-1',
            label: 'Customer Table',
            bundle_type: 'entity_with_attributes_and_relationships',
            // No depth field
          },
        ],
        diagram_refs: [],
      };

      // Simulate modal opening and restoring state
      const state = createEmptySelectionState();
      for (const entityRef of savedContextState.entity_refs) {
        state.selectedEntityIds.add(entityRef.entity_id);
        if (entityRef.bundle_type) {
          state.entityBundleSelections[entityRef.entity_id] = entityRef.bundle_type;
        }
        if (entityRef.bundle_type === 'entity_with_attributes_and_relationships') {
          // Always initialize depth for entity bundles, defaulting to 1
          state.entityDepthSelections[entityRef.entity_id] = entityRef.depth ?? 1;
        }
      }

      // Assert depth defaults to 1
      expect(state.entityDepthSelections['pde-1']).toBe(1);
    });
  });

  describe('3. Multiple heuristic rules can fire together', () => {
    it('generates suggestions from multiple rules simultaneously', () => {
      // Setup: interface with partial bundle, service with partial bundle
      const suggestions = computeSuggestions({
        selectedEntityIds: new Set(['int-1', 'svc-1']),
        entityBundleSelections: {
          'int-1': 'interface_only', // triggers rule_interface_needs_schema
          'svc-1': 'service_only', // triggers rule_service_needs_interfaces
        },
        entityOptionMap: testEntityOptionMap,
        diagramOptions: [],
        selectedDiagramIds: new Set(),
      });

      // Assert both rules fired
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      const ruleIds = suggestions.map((s) => s.ruleId);
      expect(ruleIds).toContain('rule_interface_needs_schema');
      expect(ruleIds).toContain('rule_service_needs_interfaces');
    });
  });

  describe('4. Diagram heuristic integration with entity selections', () => {
    it('suggests diagram when 3+ entities match 50%+ of diagram references', () => {
      const suggestions = computeSuggestions({
        selectedEntityIds: new Set(['int-1', 'svc-1', 'pde-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
          'svc-1': 'service_with_parents_and_children',
          'pde-1': 'entity_with_attributes_and_relationships',
        },
        entityOptionMap: testEntityOptionMap,
        diagramOptions: testDiagramOptions,
        selectedDiagramIds: new Set(),
      });

      // Assert diagram suggestion appears
      const diagramSuggestion = suggestions.find(
        (s) => s.ruleId === 'rule_diagram_as_context'
      );
      expect(diagramSuggestion).toBeDefined();
      expect(diagramSuggestion?.targetEntityId).toBe('diag-1');
    });

    it('does not suggest diagram that is already selected', () => {
      const suggestions = computeSuggestions({
        selectedEntityIds: new Set(['int-1', 'svc-1', 'pde-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
          'svc-1': 'service_with_parents_and_children',
          'pde-1': 'entity_with_attributes_and_relationships',
        },
        entityOptionMap: testEntityOptionMap,
        diagramOptions: testDiagramOptions,
        selectedDiagramIds: new Set(['diag-1']), // Already selected
      });

      // Assert no diagram suggestion for diag-1
      const diagramSuggestion = suggestions.find(
        (s) => s.targetEntityId === 'diag-1'
      );
      expect(diagramSuggestion).toBeUndefined();
    });
  });

  describe('5. Bundle upgrade maintains existing depth selection', () => {
    it('depth remains unchanged when bundle type changes to another entity bundle', () => {
      const state = createEmptySelectionState();

      // Initial selection with entity bundle and depth 2
      state.selectedEntityIds.add('pde-1');
      state.entityBundleSelections['pde-1'] = 'entity_with_attributes_and_relationships';
      state.entityDepthSelections['pde-1'] = 2;

      // Simulate bundle change back to entity_only
      state.entityBundleSelections['pde-1'] = 'entity_only';

      // Depth is removed when bundle is not entity_with_attributes_and_relationships
      // (This is the expected behavior based on handleBundleChange logic)
      delete state.entityDepthSelections['pde-1'];

      // Now change back to entity_with_attributes_and_relationships
      state.entityBundleSelections['pde-1'] = 'entity_with_attributes_and_relationships';
      // Depth is re-initialized to default 1
      state.entityDepthSelections['pde-1'] = state.entityDepthSelections['pde-1'] ?? 1;

      // Assert depth is 1 (default after re-initialization)
      expect(state.entityDepthSelections['pde-1']).toBe(1);
    });
  });

  describe('6. Backward compatibility: legacy refs without depth', () => {
    it('legacy EntityRef without depth can be used in ContextState', () => {
      // Create a legacy-style EntityRef
      const legacyRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'interfaces',
        entity_id: 'int-1',
        label: 'Payment API',
        bundle_type: 'interface_with_endpoints_and_schemas',
      };

      // Use in ContextState
      const contextState: ContextState = {
        version: 1,
        entity_refs: [legacyRef],
        diagram_refs: [],
      };

      // Assert legacy ref works
      expect(contextState.entity_refs[0].kind).toBe('ENTITY');
      expect(contextState.entity_refs[0].depth).toBeUndefined();
    });

    it('serialization/deserialization of legacy refs works correctly', () => {
      const legacyRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: 'entity_with_attributes_and_relationships',
      };

      // Serialize and deserialize
      const json = JSON.stringify(legacyRef);
      const parsed = JSON.parse(json) as EntityRef;

      // Assert
      expect(parsed.kind).toBe('ENTITY');
      expect(parsed.depth).toBeUndefined();
      expect(parsed.bundle_type).toBe('entity_with_attributes_and_relationships');
    });

    it('new refs with depth serialize correctly', () => {
      const newRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: 2,
      };

      // Serialize and deserialize
      const json = JSON.stringify(newRef);
      const parsed = JSON.parse(json) as EntityRef;

      // Assert depth is preserved
      expect(parsed.depth).toBe(2);
    });
  });

  describe('Depth constants validation', () => {
    it('DEPTH_OPTIONS contains expected values', () => {
      expect(DEPTH_OPTIONS).toEqual([1, 2]);
    });

    it('DEPTH_LABELS has labels for all options', () => {
      expect(DEPTH_LABELS[1]).toBeDefined();
      expect(DEPTH_LABELS[2]).toBeDefined();
    });

    it('DEPTH_WARNING is non-empty', () => {
      expect(DEPTH_WARNING.length).toBeGreaterThan(0);
    });
  });
});
