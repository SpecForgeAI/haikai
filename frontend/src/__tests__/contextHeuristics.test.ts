/**
 * contextHeuristics.test.ts
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 2: Tests for heuristic rules engine
 * Task Group 3: Tests for diagram heuristic
 *
 * Tests:
 * - Suggestion interface shape validation
 * - computeSuggestions returns empty array when no rules trigger
 * - rule_interface_needs_schema triggers for interface_only selections
 * - rule_service_needs_interfaces triggers for service_only selections
 * - rule_entity_relationships_depth triggers for entity_only selections
 * - rule_diagram_as_context triggers for 3+ entities with 50%+ diagram overlap
 * - Maximum 3 suggestions enforced
 */

import { describe, it, expect } from 'vitest';
import type { PickOption } from '../utils/contextPickListBuilders';
import {
  computeSuggestions,
  RULE_INTERFACE_NEEDS_SCHEMA,
  RULE_SERVICE_NEEDS_INTERFACES,
  RULE_ENTITY_RELATIONSHIPS_DEPTH,
  RULE_DIAGRAM_AS_CONTEXT,
  type Suggestion,
  type SuggestionAction,
  type ComputeSuggestionsParams,
  type DiagramPickOption,
} from '../utils/contextHeuristics';

// ============================================================================
// Test Data
// ============================================================================

const mockEntityOptionMap = new Map<string, PickOption>([
  ['int-1', { value: 'int-1', label: 'Payment API', entity_type: 'interfaces' }],
  ['int-2', { value: 'int-2', label: 'Order API', entity_type: 'interfaces' }],
  ['svc-1', { value: 'svc-1', label: 'Auth Service', entity_type: 'services' }],
  ['svc-2', { value: 'svc-2', label: 'Payment Service', entity_type: 'services' }],
  ['pde-1', { value: 'pde-1', label: 'Customer Table', entity_type: 'physical_data_entities' }],
  ['pde-2', { value: 'pde-2', label: 'Order Table', entity_type: 'physical_data_entities' }],
  ['pde-3', { value: 'pde-3', label: 'Product Table', entity_type: 'physical_data_entities' }],
  ['app-1', { value: 'app-1', label: 'Core Application', entity_type: 'applications' }],
]);

const mockDiagramOptions: DiagramPickOption[] = [
  { value: 'diag-1', label: 'System Overview', entity_type: 'diagrams', referenced_entity_ids: ['int-1', 'svc-1', 'pde-1'] },
  { value: 'diag-2', label: 'Data Flow', entity_type: 'diagrams', referenced_entity_ids: ['pde-1', 'pde-2', 'pde-3'] },
  { value: 'diag-3', label: 'Service Map', entity_type: 'diagrams', referenced_entity_ids: ['svc-1', 'svc-2'] },
];

// Diagram options without referenced_entity_ids for tests where we don't want diagram suggestions
const emptyDiagramOptions: DiagramPickOption[] = [];

function createParams(overrides: Partial<ComputeSuggestionsParams> = {}): ComputeSuggestionsParams {
  return {
    selectedEntityIds: new Set<string>(),
    entityBundleSelections: {},
    entityOptionMap: mockEntityOptionMap,
    diagramOptions: emptyDiagramOptions, // Default to no diagram options to avoid diagram suggestions
    selectedDiagramIds: new Set<string>(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('contextHeuristics', () => {
  describe('Suggestion interface shape', () => {
    it('should have correct Suggestion interface shape', () => {
      // This test validates that a Suggestion object can be created with expected fields
      const suggestion: Suggestion = {
        id: 'test-suggestion',
        ruleId: RULE_INTERFACE_NEEDS_SCHEMA,
        title: 'Test Suggestion',
        rationale: 'This is a test rationale.',
        action: 'upgrade_bundle',
        targetEntityId: 'int-1',
        targetBundleType: 'interface_with_endpoints_and_schemas',
      };

      expect(suggestion.id).toBeDefined();
      expect(suggestion.ruleId).toBeDefined();
      expect(suggestion.title).toBeDefined();
      expect(suggestion.rationale).toBeDefined();
      expect(suggestion.action).toBeDefined();
      expect(suggestion.targetEntityId).toBeDefined();
    });

    it('should have correct SuggestionAction type values', () => {
      // Validate action types
      const upgradeAction: SuggestionAction = 'upgrade_bundle';
      const addAction: SuggestionAction = 'add_entity';

      expect(upgradeAction).toBe('upgrade_bundle');
      expect(addAction).toBe('add_entity');
    });
  });

  describe('computeSuggestions returns empty array when no rules trigger', () => {
    it('returns empty array when no entities selected', () => {
      const params = createParams();
      const suggestions = computeSuggestions(params);
      expect(suggestions).toEqual([]);
    });

    it('returns empty array when entities have full bundle types and no diagram heuristic triggers', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1', 'svc-1', 'pde-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
          'svc-1': 'service_with_parents_and_children',
          'pde-1': 'entity_with_attributes_and_relationships',
        },
        diagramOptions: emptyDiagramOptions, // No diagrams to suggest
      });
      const suggestions = computeSuggestions(params);
      expect(suggestions).toEqual([]);
    });
  });

  describe('rule_interface_needs_schema', () => {
    it('triggers for interface with interface_only bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1']),
        entityBundleSelections: {
          'int-1': 'interface_only',
        },
      });
      const suggestions = computeSuggestions(params);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].ruleId).toBe(RULE_INTERFACE_NEEDS_SCHEMA);
      expect(suggestions[0].action).toBe('upgrade_bundle');
      expect(suggestions[0].targetEntityId).toBe('int-1');
      expect(suggestions[0].targetBundleType).toBe('interface_with_endpoints_and_schemas');
      expect(suggestions[0].rationale).toBe(
        "Including schemas helps the LLM understand the data contracts for this interface's endpoints."
      );
    });

    it('triggers for interface with interface_with_endpoints bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints',
        },
      });
      const suggestions = computeSuggestions(params);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].ruleId).toBe(RULE_INTERFACE_NEEDS_SCHEMA);
      expect(suggestions[0].targetEntityId).toBe('int-1');
    });

    it('does not trigger for interface with full bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
        },
      });
      const suggestions = computeSuggestions(params);
      expect(suggestions).toEqual([]);
    });

    it('triggers for multiple interfaces missing schemas', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1', 'int-2']),
        entityBundleSelections: {
          'int-1': 'interface_only',
          'int-2': 'interface_with_endpoints',
        },
      });
      const suggestions = computeSuggestions(params);

      // Should have suggestions for both interfaces
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      const ruleIds = suggestions.map(s => s.ruleId);
      expect(ruleIds.filter(id => id === RULE_INTERFACE_NEEDS_SCHEMA)).toHaveLength(2);
    });
  });

  describe('rule_service_needs_interfaces', () => {
    it('triggers for service with service_only bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['svc-1']),
        entityBundleSelections: {
          'svc-1': 'service_only',
        },
      });
      const suggestions = computeSuggestions(params);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].ruleId).toBe(RULE_SERVICE_NEEDS_INTERFACES);
      expect(suggestions[0].action).toBe('upgrade_bundle');
      expect(suggestions[0].targetEntityId).toBe('svc-1');
      expect(suggestions[0].targetBundleType).toBe('service_with_parents_and_children');
      expect(suggestions[0].rationale).toBe(
        'Including parent and child context helps the LLM understand how this service fits in the architecture hierarchy.'
      );
    });

    it('does not trigger for service with full bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['svc-1']),
        entityBundleSelections: {
          'svc-1': 'service_with_parents_and_children',
        },
      });
      const suggestions = computeSuggestions(params);
      expect(suggestions).toEqual([]);
    });
  });

  describe('rule_entity_relationships_depth', () => {
    it('triggers when 2+ data entities selected with entity_only bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['pde-1', 'pde-2']),
        entityBundleSelections: {
          'pde-1': 'entity_only',
          'pde-2': 'entity_only',
        },
      });
      const suggestions = computeSuggestions(params);

      // Should suggest upgrading one or both entities
      const entityRelSuggestions = suggestions.filter(
        s => s.ruleId === RULE_ENTITY_RELATIONSHIPS_DEPTH
      );
      expect(entityRelSuggestions.length).toBeGreaterThanOrEqual(1);
      expect(entityRelSuggestions[0].targetBundleType).toBe('entity_with_attributes_and_relationships');
      expect(entityRelSuggestions[0].rationale).toBe(
        'Including relationships between these entities helps the LLM understand the data model connections.'
      );
    });

    it('does not trigger for single data entity', () => {
      const params = createParams({
        selectedEntityIds: new Set(['pde-1']),
        entityBundleSelections: {
          'pde-1': 'entity_only',
        },
      });
      const suggestions = computeSuggestions(params);

      const entityRelSuggestions = suggestions.filter(
        s => s.ruleId === RULE_ENTITY_RELATIONSHIPS_DEPTH
      );
      expect(entityRelSuggestions).toHaveLength(0);
    });

    it('does not trigger when all entities have full bundle', () => {
      const params = createParams({
        selectedEntityIds: new Set(['pde-1', 'pde-2']),
        entityBundleSelections: {
          'pde-1': 'entity_with_attributes_and_relationships',
          'pde-2': 'entity_with_attributes_and_relationships',
        },
      });
      const suggestions = computeSuggestions(params);

      const entityRelSuggestions = suggestions.filter(
        s => s.ruleId === RULE_ENTITY_RELATIONSHIPS_DEPTH
      );
      expect(entityRelSuggestions).toHaveLength(0);
    });
  });

  describe('rule_diagram_as_context', () => {
    it('does not trigger with fewer than 3 entity selections', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1', 'svc-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
          'svc-1': 'service_with_parents_and_children',
        },
        diagramOptions: mockDiagramOptions,
      });
      const suggestions = computeSuggestions(params);

      const diagramSuggestions = suggestions.filter(
        s => s.ruleId === RULE_DIAGRAM_AS_CONTEXT
      );
      expect(diagramSuggestions).toHaveLength(0);
    });

    it('finds diagram referencing 50%+ of selected entities', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1', 'svc-1', 'pde-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
          'svc-1': 'service_with_parents_and_children',
          'pde-1': 'entity_with_attributes_and_relationships',
        },
        diagramOptions: mockDiagramOptions,
      });
      const suggestions = computeSuggestions(params);

      const diagramSuggestions = suggestions.filter(
        s => s.ruleId === RULE_DIAGRAM_AS_CONTEXT
      );
      expect(diagramSuggestions).toHaveLength(1);
      expect(diagramSuggestions[0].targetEntityId).toBe('diag-1'); // System Overview has all 3
      expect(diagramSuggestions[0].action).toBe('add_entity');
      expect(diagramSuggestions[0].rationale).toBe(
        'This diagram references multiple selected entities and may provide useful visual context.'
      );
    });

    it('limits diagram suggestions to 1 maximum', () => {
      // Select 3 data entities which overlaps with diag-2 (100% overlap)
      const params = createParams({
        selectedEntityIds: new Set(['pde-1', 'pde-2', 'pde-3']),
        entityBundleSelections: {
          'pde-1': 'entity_with_attributes_and_relationships',
          'pde-2': 'entity_with_attributes_and_relationships',
          'pde-3': 'entity_with_attributes_and_relationships',
        },
        diagramOptions: mockDiagramOptions,
      });
      const suggestions = computeSuggestions(params);

      const diagramSuggestions = suggestions.filter(
        s => s.ruleId === RULE_DIAGRAM_AS_CONTEXT
      );
      expect(diagramSuggestions.length).toBeLessThanOrEqual(1);
    });

    it('does not suggest already selected diagrams', () => {
      const params = createParams({
        selectedEntityIds: new Set(['int-1', 'svc-1', 'pde-1']),
        entityBundleSelections: {
          'int-1': 'interface_with_endpoints_and_schemas',
          'svc-1': 'service_with_parents_and_children',
          'pde-1': 'entity_with_attributes_and_relationships',
        },
        diagramOptions: mockDiagramOptions,
        selectedDiagramIds: new Set(['diag-1']), // Already selected
      });
      const suggestions = computeSuggestions(params);

      const diagramSuggestions = suggestions.filter(
        s => s.ruleId === RULE_DIAGRAM_AS_CONTEXT
      );
      expect(diagramSuggestions).toHaveLength(0);
    });
  });

  describe('Maximum 3 suggestions enforced', () => {
    it('limits suggestions to maximum of 3', () => {
      // Create a scenario that would generate many suggestions
      const params = createParams({
        selectedEntityIds: new Set(['int-1', 'int-2', 'svc-1', 'svc-2', 'pde-1', 'pde-2', 'pde-3']),
        entityBundleSelections: {
          'int-1': 'interface_only',
          'int-2': 'interface_only',
          'svc-1': 'service_only',
          'svc-2': 'service_only',
          'pde-1': 'entity_only',
          'pde-2': 'entity_only',
          'pde-3': 'entity_only',
        },
        diagramOptions: mockDiagramOptions,
      });
      const suggestions = computeSuggestions(params);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });
});
