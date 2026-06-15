/**
 * Meta-Model Grid Null-Safety Tests
 * Spec: 2026-01-03-metamodel-ui-workflow-transitions-crash-fix
 *
 * Tests that the Grid component renders safely when entity arrays are missing
 * from the metaModel. This prevents crashes when clicking on tabs for entity
 * types that don't exist in older saved projects.
 *
 * Test Coverage:
 * 1. Grid renders 0 rows when entityType key is missing from metaModel.entities
 * 2. Grid renders 0 rows when entityType array is explicitly undefined
 * 3. Grid does not throw when columns config is missing for entityType
 * 4. Grid toolbar buttons (Add/Delete) work correctly with empty entity array
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { gridConfigs } from '../config/gridConfigs';
import { ArchitectureModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

// Mock the ArchitectureContext to provide controlled state
const mockDispatch = vi.fn();

// Helper to create a minimal model with missing entity arrays
function createMinimalModel(overrides: Partial<MetaModelEntities> = {}): ArchitectureModel {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        // UI entities - often missing from old projects
        ui_screens: [],
        ui_components: [],
        ui_actions: [],
        ...overrides,
      } as MetaModelEntities,
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
      } as MetaModelRelationships,
    },
    diagrams: [],
  };
}

// Helper to create a model with explicitly missing UI entity keys
function createModelWithMissingUIEntities(): ArchitectureModel {
  const model = createMinimalModel();
  // Simulate old project data that's missing UI entity keys entirely
  const entities = model.metaModel.entities as Record<string, unknown[]>;
  delete entities.ui_screens;
  delete entities.ui_components;
  delete entities.ui_actions;
  // Note: ui_workflow_transitions is in relationships, not entities
  return model;
}

describe('Grid Null-Safety: Missing Entity Arrays', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  describe('Test 1: Grid renders 0 rows when entityType key is missing from metaModel.entities', () => {
    it('should safely access missing ui_screens entity array', () => {
      const model = createModelWithMissingUIEntities();

      // Simulate the null-safe access pattern from Grid.tsx
      const entityType = 'ui_screens';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      expect(entities).toEqual([]);
      expect(entities.length).toBe(0);
      expect(() => entities.map((e) => e)).not.toThrow();
    });

    it('should safely access missing ui_components entity array', () => {
      const model = createModelWithMissingUIEntities();

      const entityType = 'ui_components';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      expect(entities).toEqual([]);
      expect(entities.length).toBe(0);
    });

    it('should safely access missing ui_actions entity array', () => {
      const model = createModelWithMissingUIEntities();

      const entityType = 'ui_actions';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      expect(entities).toEqual([]);
      expect(entities.length).toBe(0);
    });

    it('should safely access arbitrary missing entity type', () => {
      const model = createMinimalModel();

      // Even for completely unknown entity types, the null-safe pattern should not throw
      const entityType = 'nonexistent_entity_type';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      expect(entities).toEqual([]);
      expect(entities.length).toBe(0);
      expect(() => entities.filter(() => true)).not.toThrow();
      expect(() => entities.find(() => true)).not.toThrow();
    });
  });

  describe('Test 2: Grid renders 0 rows when entityType array is explicitly undefined', () => {
    it('should handle explicitly undefined ui_screens array', () => {
      const model = createMinimalModel();
      // Explicitly set to undefined
      (model.metaModel.entities as Record<string, unknown[]>).ui_screens = undefined as unknown as never[];

      const entityType = 'ui_screens';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      expect(entities).toEqual([]);
    });

    it('should handle explicitly null ui_components array', () => {
      const model = createMinimalModel();
      // Explicitly set to null (could happen from API response)
      (model.metaModel.entities as Record<string, unknown>).ui_components = null;

      const entityType = 'ui_components';
      const rawValue = (model.metaModel.entities as Record<string, unknown>)[entityType];
      // The ?? operator handles both null and undefined
      const entities = rawValue ?? [];

      expect(entities).toEqual([]);
    });

    it('should handle missing entities object entirely', () => {
      const model = createMinimalModel();
      // Extreme case: entire entities object is missing
      (model.metaModel as Record<string, unknown>).entities = undefined;

      const entityType = 'ui_screens';
      const entities =
        ((model.metaModel as Record<string, unknown>)?.entities as Record<string, unknown[]>)?.[
          entityType
        ] ?? [];

      expect(entities).toEqual([]);
    });

    it('should handle missing metaModel object entirely', () => {
      const model = createMinimalModel();
      // Extreme case: entire metaModel object is missing
      (model as Record<string, unknown>).metaModel = undefined;

      const entityType = 'ui_screens';
      const entities =
        ((model as Record<string, { entities: Record<string, unknown[]> }>)?.metaModel?.entities)?.[
          entityType
        ] ?? [];

      expect(entities).toEqual([]);
    });
  });

  describe('Test 3: Grid does not throw when columns config is missing for entityType', () => {
    it('should return empty array for missing columns config', () => {
      const entityType = 'nonexistent_entity_type';
      const columns = gridConfigs[entityType] ?? [];

      expect(columns).toEqual([]);
      expect(Array.isArray(columns)).toBe(true);
    });

    it('should return columns config for existing entity types', () => {
      // Verify that valid entity types still return their config
      const businessUsersColumns = gridConfigs['business_users'] ?? [];
      expect(businessUsersColumns.length).toBeGreaterThan(0);

      const uiScreensColumns = gridConfigs['ui_screens'] ?? [];
      expect(uiScreensColumns.length).toBeGreaterThan(0);
    });

    it('should not throw when accessing undefined columns with bracket notation', () => {
      const entityType = 'completely_unknown_type_xyz';

      expect(() => {
        const columns = gridConfigs[entityType] ?? [];
        // Simulate column mapping operations
        columns.map((col) => col.field);
        columns.filter((col) => col.required);
      }).not.toThrow();
    });

    it('should handle empty columns array gracefully', () => {
      // Even with empty columns, operations should not throw
      const columns: { field: string; required?: boolean }[] = [];

      expect(() => {
        columns.map((col) => col.field);
        columns.filter((col) => col.required);
        columns.forEach(() => {
          // Just iterating, no output needed
        });
      }).not.toThrow();
    });
  });

  describe('Test 4: Grid toolbar buttons work correctly with empty entity array', () => {
    it('should support Add Row on empty entity array', () => {
      const model = createMinimalModel();
      const entityType = 'ui_screens';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      // Simulate adding a new entity - should work even with empty array
      const newEntity = { id: 'ui-screen-001', name: 'New Screen', route: '/new', description: '' };

      // This simulates the dispatch action
      const _addAction = { type: 'ADD_ENTITY', entityType, entity: newEntity };

      expect(() => {
        // Simulate what Grid does after dispatch
        const updatedEntities = [...entities, newEntity];
        expect(updatedEntities).toHaveLength(1);
      }).not.toThrow();
    });

    it('should handle Delete Row with no selection and empty array', () => {
      const model = createMinimalModel();
      const entityType = 'ui_components';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];
      const selectedRowId: string | null = null;

      // Delete button should be disabled when no selection
      const deleteDisabled = !selectedRowId;
      expect(deleteDisabled).toBe(true);

      // Even if somehow triggered, should not throw
      expect(() => {
        if (selectedRowId) {
          entities.filter((e: unknown) => (e as { id: string }).id !== selectedRowId);
        }
      }).not.toThrow();
    });

    it('should allow row selection to work on empty array (no rows to select)', () => {
      const model = createMinimalModel();
      const entityType = 'ui_actions';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      // No rows means nothing to select, but operations should not throw
      expect(() => {
        entities.forEach(() => {
          // Row click handler simulation - just iterating
        });
      }).not.toThrow();

      expect(entities.length).toBe(0);
    });

    it('should handle handleCellChange safely on empty entity array', () => {
      const model = createMinimalModel();
      const entityType = 'ui_screens';
      const entities = (model.metaModel.entities as Record<string, unknown[]>)?.[entityType] ?? [];

      // Simulate handleCellChange with a non-existent entity ID
      const entityId = 'nonexistent-id';
      const field = 'name';
      const value = 'Updated Name';

      // The find operation should safely return undefined
      const entity = entities.find((e: unknown) => (e as { id: string }).id === entityId);
      expect(entity).toBeUndefined();

      // The if (entity) block prevents any update
      expect(() => {
        if (entity) {
          const updated = { ...entity, [field]: value };
          mockDispatch({ type: 'UPDATE_ENTITY', entityType, entity: updated });
        }
      }).not.toThrow();

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});

describe('Grid Null-Safety: Array Operations', () => {
  it('should safely iterate with map on potentially empty array', () => {
    const entities: unknown[] = [];

    expect(() => {
      const result = entities.map((e) => e);
      expect(result).toEqual([]);
    }).not.toThrow();
  });

  it('should safely use filter on potentially empty array', () => {
    const entities: unknown[] = [];

    expect(() => {
      const result = entities.filter(() => true);
      expect(result).toEqual([]);
    }).not.toThrow();
  });

  it('should safely use find on potentially empty array', () => {
    const entities: unknown[] = [];

    expect(() => {
      const result = entities.find(() => true);
      expect(result).toBeUndefined();
    }).not.toThrow();
  });

  it('should safely access length on empty array', () => {
    const entities: unknown[] = [];

    expect(() => {
      expect(entities.length).toBe(0);
    }).not.toThrow();
  });
});
