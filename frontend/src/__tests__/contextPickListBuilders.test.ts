/**
 * contextPickListBuilders.test.ts
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 2: Tests for pick list builder utilities
 *
 * Tests:
 * - buildArchitecturePickList groups entities by collection key
 * - buildArchitecturePickList resolves labels from name or title with fallback
 * - buildDiagramPickList uses diagram name or generates fallback from type/id
 * - Empty model returns empty pick lists without errors
 */

import { describe, it, expect } from 'vitest';
import {
  buildArchitecturePickList,
  buildDiagramPickList,
  type PickOption,
} from '../utils/contextPickListBuilders';
import type { MetaModelEntities, Diagram } from '../types/model';

// Helper to create minimal entity collections for testing
function createMinimalEntities(overrides: Partial<MetaModelEntities> = {}): MetaModelEntities {
  return {
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
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
    ...overrides,
  };
}

describe('contextPickListBuilders', () => {
  describe('buildArchitecturePickList', () => {
    it('groups entities by collection key', () => {
      // Arrange
      const entities = createMinimalEntities({
        applications: [
          { id: 'app-1', name: 'Core App', description: '', app_type: 'web', status: 'active', tags: '' },
          { id: 'app-2', name: 'Mobile App', description: '', app_type: 'mobile', status: 'active', tags: '' },
        ],
        services: [
          { id: 'svc-1', name: 'Auth Service', description: '', application_id: 'app-1', service_type: 'api', tags: '' },
        ],
      });

      // Act
      const result = buildArchitecturePickList(entities);

      // Assert
      expect(result.applications).toBeDefined();
      expect(result.applications).toHaveLength(2);
      expect(result.services).toBeDefined();
      expect(result.services).toHaveLength(1);

      // Verify structure of options
      expect(result.applications[0]).toEqual({
        value: 'app-1',
        label: 'Core App',
        entity_type: 'applications',
      });
    });

    it('resolves labels from name or title with fallback to id', () => {
      // Arrange
      const entities = createMinimalEntities({
        applications: [
          { id: 'app-1', name: 'Named App', description: '', app_type: 'web', status: 'active', tags: '' },
        ],
        logical_data_entities: [
          { id: 'lde-1', name: 'Customer', description: '', tags: '' },
          { id: 'lde-2', name: '', description: '', tags: '' }, // Empty name - should fallback
        ],
      });

      // Act
      const result = buildArchitecturePickList(entities);

      // Assert
      expect(result.applications[0].label).toBe('Named App');
      expect(result.logical_data_entities[0].label).toBe('Customer');
      // Fallback for empty name
      expect(result.logical_data_entities[1].label).toBe('logical_data_entities lde-2');
    });

    it('returns empty object for empty entities', () => {
      // Arrange
      const entities = createMinimalEntities();

      // Act
      const result = buildArchitecturePickList(entities);

      // Assert
      // All collections should be empty arrays
      expect(result.applications).toEqual([]);
      expect(result.services).toEqual([]);
      expect(result.logical_data_entities).toEqual([]);
    });
  });

  describe('buildDiagramPickList', () => {
    it('uses diagram name when available', () => {
      // Arrange
      const diagrams: Diagram[] = [
        {
          id: 'diag-1',
          name: 'System Overview',
          description: 'Main system diagram',
          diagram_type: 'General',
          diagram_nodes: [],
          diagram_edges: [],
        },
        {
          id: 'diag-2',
          name: 'Data Flow',
          description: '',
          diagram_type: 'DataMovement',
          diagram_nodes: [],
          diagram_edges: [],
        },
      ];

      // Act
      const result = buildDiagramPickList(diagrams);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        value: 'diag-1',
        label: 'System Overview',
      });
      expect(result[1]).toEqual({
        value: 'diag-2',
        label: 'Data Flow',
      });
    });

    it('generates fallback label from diagram_type and id when name is missing', () => {
      // Arrange
      const diagrams: Diagram[] = [
        {
          id: 'abc123def456',
          name: '', // Empty name
          description: '',
          diagram_type: 'Sequence',
          diagram_nodes: [],
          diagram_edges: [],
        },
        {
          id: 'xyz789uvw',
          name: '', // Empty name, no diagram_type
          description: '',
          diagram_nodes: [],
          diagram_edges: [],
        },
      ];

      // Act
      const result = buildDiagramPickList(diagrams);

      // Assert
      expect(result[0].label).toBe('Sequence (abc123de)');
      expect(result[1].label).toBe('Diagram (xyz789uv)');
    });

    it('returns empty array for empty diagrams list', () => {
      // Arrange
      const diagrams: Diagram[] = [];

      // Act
      const result = buildDiagramPickList(diagrams);

      // Assert
      expect(result).toEqual([]);
    });
  });
});
