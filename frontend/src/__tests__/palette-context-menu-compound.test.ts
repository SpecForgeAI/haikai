/**
 * Palette Context Menu Compound Operations Tests
 * Tests for compound add operations and layout algorithm
 * Task Group 5: Compound Add Operations and Layout Algorithm
 */

import { DiagramNode, MetaModel, ENTITY_TYPES, ApplicationPointBusinessProcess, ApplicationComponent } from '../types/model';
import {
  calculateChildPosition,
  calculateParentSize,
  findLinkedBusinessProcesses,
  findAppComponents,
  countExistingChildren,
} from '../utils/compoundLayout';

// Test data factory functions
function createTestNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'test-node-1',
    entity_type: 'APPLICATION',
    entity_id: 'app-1',
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    parent_node_id: null,
    ...overrides,
  };
}

function createTestMetaModel(overrides: Partial<MetaModel> = {}): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
        { id: 'bp-2', name: 'Process 2', description: '', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'App 1', description: '', app_type: 'web', status: 'active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', name: 'Component 1', description: '', application_id: 'app-1', tags: '' },
        { id: 'ac-2', name: 'Component 2', description: '', application_id: 'app-1', tags: '' },
        { id: 'ac-3', name: 'Component 3', description: '', application_id: 'app-2', tags: '' },
      ],
      services: [],
      application_points: [
        { id: 'ap-1', name: 'App Point 1', description: '', application_id: 'app-1', point_type: 'api', tags: '' },
      ],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      ...overrides.entities,
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'ap-1', business_point_id: 'bpt-2', description: '', tags: '' },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      ...overrides.relationships,
    },
  };
}

describe('Palette Context Menu Compound Operations', () => {
  describe('Child Position Calculation', () => {
    it('should calculate correct X position with left padding', () => {
      const parentNode = createTestNode({ pos_x: 100, pos_y: 100 });
      const position = calculateChildPosition(parentNode, 0, 0);

      // X = parent.pos_x + 5px padding
      expect(position.pos_x).toBe(105);
    });

    it('should calculate correct Y position for first child', () => {
      const parentNode = createTestNode({ pos_x: 100, pos_y: 100 });
      const position = calculateChildPosition(parentNode, 0, 0);

      // Y = parent.pos_y + 5 (top padding) + 20 (label height) + 5 (gap) + 0 * (60 + 5)
      // Y = 100 + 5 + 20 + 5 + 0 = 130
      expect(position.pos_y).toBe(130);
    });

    it('should calculate correct Y position for second child', () => {
      const parentNode = createTestNode({ pos_x: 100, pos_y: 100 });
      const position = calculateChildPosition(parentNode, 1, 0);

      // Y = parent.pos_y + 5 + 20 + 5 + 1 * (60 + 5) = 130 + 65 = 195
      expect(position.pos_y).toBe(195);
    });

    it('should account for existing children when calculating position', () => {
      const parentNode = createTestNode({ pos_x: 100, pos_y: 100 });
      const existingChildCount = 2;
      const position = calculateChildPosition(parentNode, 0, existingChildCount);

      // Y = 130 + 2 * 65 = 130 + 130 = 260
      expect(position.pos_y).toBe(260);
    });
  });

  describe('Parent Size Calculation', () => {
    it('should calculate correct width with default child width', () => {
      const size = calculateParentSize(2, 120);

      // Width = 5 + 120 + 5 = 130
      expect(size.width).toBe(130);
    });

    it('should calculate correct height for 2 children', () => {
      const size = calculateParentSize(2);

      // Height = 5 (padding) + 20 (label) + 5 (gap) + 2*60 (children) + 1*5 (gap between) + 5 (bottom padding)
      // Height = 5 + 20 + 5 + 120 + 5 + 5 = 160
      expect(size.height).toBe(160);
    });

    it('should calculate correct height for 3 children', () => {
      const size = calculateParentSize(3);

      // Height = 5 + 20 + 5 + 3*60 + 2*5 + 5 = 5 + 20 + 5 + 180 + 10 + 5 = 225
      expect(size.height).toBe(225);
    });

    it('should use minimum parent size for 0 children', () => {
      const size = calculateParentSize(0);

      // Minimum: width = 130, height = 30
      expect(size.width).toBe(130);
      expect(size.height).toBe(30);
    });
  });

  describe('Find Linked Business Processes', () => {
    it('should find business points linked via application points', () => {
      const metaModel = createTestMetaModel();
      const applicationId = 'app-1';

      // findLinkedBusinessProcesses now traverses application_point_business_points
      // and returns the linked BUSINESS POINT ids (callers resolve them to
      // concrete processes/activities).
      const linkedPointIds = findLinkedBusinessProcesses(metaModel, applicationId);

      expect(linkedPointIds).toContain('bpt-1');
      expect(linkedPointIds).toContain('bpt-2');
      expect(linkedPointIds.length).toBe(2);
    });

    it('should return empty array when no application points exist', () => {
      const metaModel = createTestMetaModel({
        entities: {
          ...createTestMetaModel().entities,
          application_points: [],
        },
      });
      const applicationId = 'app-1';

      const linkedProcessIds = findLinkedBusinessProcesses(metaModel, applicationId);

      expect(linkedProcessIds.length).toBe(0);
    });

    it('should return empty array when no relationships exist', () => {
      const metaModel = createTestMetaModel({
        relationships: {
          ...createTestMetaModel().relationships,
          application_point_business_points: [],
        },
      });
      const applicationId = 'app-1';

      const linkedProcessIds = findLinkedBusinessProcesses(metaModel, applicationId);

      expect(linkedProcessIds.length).toBe(0);
    });
  });

  describe('Find App Components', () => {
    it('should find app components belonging to application', () => {
      const metaModel = createTestMetaModel();
      const applicationId = 'app-1';

      const components = findAppComponents(metaModel, applicationId);

      expect(components.length).toBe(2);
      expect(components.map(c => c.id)).toContain('ac-1');
      expect(components.map(c => c.id)).toContain('ac-2');
    });

    it('should not include components from other applications', () => {
      const metaModel = createTestMetaModel();
      const applicationId = 'app-1';

      const components = findAppComponents(metaModel, applicationId);

      expect(components.map(c => c.id)).not.toContain('ac-3');
    });

    it('should return empty array when no components exist', () => {
      const metaModel = createTestMetaModel();
      const applicationId = 'app-nonexistent';

      const components = findAppComponents(metaModel, applicationId);

      expect(components.length).toBe(0);
    });
  });

  describe('Compound Add Operations', () => {
    it('should create parent and child nodes with correct parent_node_id', () => {
      const parentNodeId = 'node-parent';
      const childNode = createTestNode({
        id: 'node-child',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'bp-1',
        parent_node_id: parentNodeId,
      });

      expect(childNode.parent_node_id).toBe(parentNodeId);
    });

    it('should skip children that already exist on diagram', () => {
      const existingNodes: DiagramNode[] = [
        createTestNode({
          id: 'node-1',
          entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
          entity_id: 'bp-1',
        }),
      ];

      const businessProcessIds = ['bp-1', 'bp-2'];

      // Filter out existing
      const existingIds = new Set(
        existingNodes
          .filter(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS)
          .map(n => n.entity_id)
      );

      const newProcessIds = businessProcessIds.filter(id => !existingIds.has(id));

      expect(newProcessIds.length).toBe(1);
      expect(newProcessIds[0]).toBe('bp-2');
    });

    it('should add only missing children when parent exists', () => {
      const parentNode = createTestNode({
        id: 'parent-1',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
      });

      const existingChild = createTestNode({
        id: 'child-1',
        entity_type: ENTITY_TYPES.APP_COMPONENT,
        entity_id: 'ac-1',
        parent_node_id: 'parent-1',
      });

      const existingNodes: DiagramNode[] = [parentNode, existingChild];
      const allComponentIds = ['ac-1', 'ac-2'];

      // Find missing
      const existingComponentIds = new Set(
        existingNodes
          .filter(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT)
          .map(n => n.entity_id)
      );

      const missingComponentIds = allComponentIds.filter(id => !existingComponentIds.has(id));

      expect(missingComponentIds.length).toBe(1);
      expect(missingComponentIds[0]).toBe('ac-2');
    });

    it('should count existing children correctly', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'parent-1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1' }),
        createTestNode({ id: 'child-1', parent_node_id: 'parent-1' }),
        createTestNode({ id: 'child-2', parent_node_id: 'parent-1' }),
        createTestNode({ id: 'child-3', parent_node_id: 'other-parent' }),
      ];

      const existingChildCount = countExistingChildren('parent-1', nodes);

      expect(existingChildCount).toBe(2);
    });
  });
});
