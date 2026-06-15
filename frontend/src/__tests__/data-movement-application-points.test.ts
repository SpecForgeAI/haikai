/**
 * Test Suite: Data Movement Application Points Update
 *
 * This comprehensive test suite covers all 7 task groups for updating
 * Data Movement relationships to reference Application Points directly
 * instead of Applications.
 *
 * Field name changes:
 * - OLD: source_application_id, target_application_id (FK to applications)
 * - NEW: source_application_point_id, target_application_point_id (FK to application_points)
 */

import { describe, test, expect } from 'vitest';

import {
  DataMovement,
  MetaModel,
  DiagramNode,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  ApplicationPoint,
} from '../types/model';
import { gridConfigs } from '../config/gridConfigs';
import { applicationPointDisplayFormatter } from '../utils/formatters';
import {
  getEntitiesOnDiagram,
  isRelationshipRowEnabled,
  getDataMovementNodes,
  getDataMovementEntityName,
  createRelationshipEdge,
  EntitiesOnDiagram,
} from '../utils/relationshipUtils';
import { getRelationshipEndpointEntities } from '../utils/rendering';

// ============================================================================
// Task Group 1: Meta-model Schema Layer Tests
// ============================================================================

describe('Task Group 1: Meta-model Schema Layer', () => {
  describe('DataMovement interface', () => {
    test('should have source_application_point_id field', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-source',
        target_application_point_id: 'ap-target',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: 'Test movement',
        tags: '',
      };
      expect(dm.source_application_point_id).toBe('ap-source');
    });

    test('should have target_application_point_id field', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-source',
        target_application_point_id: 'ap-target',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'REALTIME',
        description: 'Test movement',
        tags: '',
      };
      expect(dm.target_application_point_id).toBe('ap-target');
    });

    test('should support temporal fields valid_from and valid_to', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-source',
        target_application_point_id: 'ap-target',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: 'Test movement',
        tags: '',
        valid_from: '2025-Q1',
        valid_to: '2026-Q4',
      };
      expect(dm.valid_from).toBe('2025-Q1');
      expect(dm.valid_to).toBe('2026-Q4');
    });

    test('DataMovement should not have old field names', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-source',
        target_application_point_id: 'ap-target',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: 'Test',
        tags: '',
      };
      // TypeScript ensures these old fields don't exist on the interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((dm as any).source_application_id).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((dm as any).target_application_id).toBeUndefined();
    });
  });
});

// ============================================================================
// Task Group 2: Grid Configuration Layer Tests
// ============================================================================

describe('Task Group 2: Grid Configuration Layer', () => {
  describe('data_movements grid config', () => {
    const dmConfig = gridConfigs['data_movements'];

    test('should have source_application_point_id field', () => {
      const sourceColumn = dmConfig.find(c => c.field === 'source_application_point_id');
      expect(sourceColumn).toBeDefined();
      expect(sourceColumn!.displayName).toBe('Source App Point');
      expect(sourceColumn!.fkTarget).toBe('application_points');
    });

    test('should have target_application_point_id field', () => {
      const targetColumn = dmConfig.find(c => c.field === 'target_application_point_id');
      expect(targetColumn).toBeDefined();
      expect(targetColumn!.displayName).toBe('Target App Point');
      expect(targetColumn!.fkTarget).toBe('application_points');
    });

    test('source column should use applicationPointDisplayFormatter', () => {
      const sourceColumn = dmConfig.find(c => c.field === 'source_application_point_id');
      expect(sourceColumn!.displayFormatter).toBe(applicationPointDisplayFormatter);
    });

    test('target column should use applicationPointDisplayFormatter', () => {
      const targetColumn = dmConfig.find(c => c.field === 'target_application_point_id');
      expect(targetColumn!.displayFormatter).toBe(applicationPointDisplayFormatter);
    });

    test('should not have old field names in config', () => {
      const oldSourceColumn = dmConfig.find(c => c.field === 'source_application_id');
      const oldTargetColumn = dmConfig.find(c => c.field === 'target_application_id');
      expect(oldSourceColumn).toBeUndefined();
      expect(oldTargetColumn).toBeUndefined();
    });
  });

  describe('applicationPointDisplayFormatter', () => {
    test('should format APPLICATION point as "name (Application)"', () => {
      const appPoints: ApplicationPoint[] = [
        {
          id: 'ap-1',
          name: 'OMS System',
          description: '',
          kind: 'APPLICATION',
          application_id: 'app-1',
          point_type: '',
          tags: '',
        },
      ];
      const result = applicationPointDisplayFormatter('ap-1', appPoints);
      expect(result).toBe('OMS System (Application)');
    });

    test('should format APP_COMPONENT point as "name (Application Component)"', () => {
      const appPoints: ApplicationPoint[] = [
        {
          id: 'ap-2',
          name: 'Pricing UI',
          description: '',
          kind: 'APP_COMPONENT',
          application_id: 'app-1',
          application_component_id: 'comp-1',
          point_type: '',
          tags: '',
        },
      ];
      const result = applicationPointDisplayFormatter('ap-2', appPoints);
      expect(result).toBe('Pricing UI (Application Component)');
    });

    test('should format SERVICE point as "name (Service)"', () => {
      const appPoints: ApplicationPoint[] = [
        {
          id: 'ap-3',
          name: 'Order API',
          description: '',
          kind: 'SERVICE',
          application_id: 'app-1',
          service_id: 'svc-1',
          point_type: '',
          tags: '',
        },
      ];
      const result = applicationPointDisplayFormatter('ap-3', appPoints);
      expect(result).toBe('Order API (Service)');
    });

    test('should return empty string for empty ID', () => {
      const appPoints: ApplicationPoint[] = [];
      const result = applicationPointDisplayFormatter('', appPoints);
      expect(result).toBe('');
    });
  });
});

// ============================================================================
// Task Group 3: Validation Layer Tests
// ============================================================================

describe('Task Group 3: Validation Layer', () => {
  describe('FK validation for application_points', () => {
    test('data_movements config should reference application_points for FK validation', () => {
      const dmConfig = gridConfigs['data_movements'];
      const sourceColumn = dmConfig.find(c => c.field === 'source_application_point_id');
      const targetColumn = dmConfig.find(c => c.field === 'target_application_point_id');

      expect(sourceColumn!.fkTarget).toBe('application_points');
      expect(targetColumn!.fkTarget).toBe('application_points');
    });

    test('error messages should say "App Point" not "App"', () => {
      const dmConfig = gridConfigs['data_movements'];
      const sourceColumn = dmConfig.find(c => c.field === 'source_application_point_id');
      const targetColumn = dmConfig.find(c => c.field === 'target_application_point_id');

      expect(sourceColumn!.displayName).toContain('App Point');
      expect(targetColumn!.displayName).toContain('App Point');
    });

    test('both source and target should be required fields', () => {
      const dmConfig = gridConfigs['data_movements'];
      const sourceColumn = dmConfig.find(c => c.field === 'source_application_point_id');
      const targetColumn = dmConfig.find(c => c.field === 'target_application_point_id');

      expect(sourceColumn!.required).toBe(true);
      expect(targetColumn!.required).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 4: Palette Enable/Disable Layer Tests
// ============================================================================

describe('Task Group 4: Palette Enable/Disable Layer', () => {
  const createMetaModel = (): MetaModel => ({
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [{ id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' }],
      app_components: [],
      services: [],
      application_points: [
        { id: 'ap-1', name: 'App 1 Point', description: '', kind: 'APPLICATION', application_id: 'app-1', point_type: '', tags: '' },
        { id: 'ap-2', name: 'App 2 Point', description: '', kind: 'APPLICATION', application_id: 'app-2', point_type: '', tags: '' },
      ],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
    },
  });

  describe('getEntitiesOnDiagram', () => {
    test('should map APPLICATION nodes to application_points via application_id', () => {
      const metaModel = createMetaModel();
      const diagram = {
        diagram_nodes: [
          { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
      };

      const entities = getEntitiesOnDiagram(metaModel, diagram);
      expect(entities.applicationPointsOnDiagram.has('ap-1')).toBe(true);
      expect(entities.applicationPointsOnDiagram.has('ap-2')).toBe(false);
    });

    test('should add direct APPLICATION_POINT nodes to applicationPointsOnDiagram', () => {
      const metaModel = createMetaModel();
      const diagram = {
        diagram_nodes: [
          { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION_POINT, entity_id: 'ap-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
      };

      const entities = getEntitiesOnDiagram(metaModel, diagram);
      expect(entities.applicationPointsOnDiagram.has('ap-1')).toBe(true);
    });
  });

  describe('isDataMovementEnabledWithSets', () => {
    test('should return enabled when both endpoints are on diagram', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      // Both app points are on diagram via APPLICATION nodes
      metaModel.entities.applications.push({ id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' });
      const diagram = {
        diagram_nodes: [
          { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
          { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
      };

      const entities = getEntitiesOnDiagram(metaModel, diagram);
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', diagram.diagram_nodes as DiagramNode[], metaModel, entities);
      expect(enabled).toBe(true);
    });

    test('should return disabled when source endpoint is missing', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      // Only target app is on diagram
      metaModel.entities.applications.push({ id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' });
      const diagram = {
        diagram_nodes: [
          { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
      };

      const entities = getEntitiesOnDiagram(metaModel, diagram);
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', diagram.diagram_nodes as DiagramNode[], metaModel, entities);
      expect(enabled).toBe(false);
    });

    test('should return disabled when target endpoint is missing', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      // Only source app is on diagram
      const diagram = {
        diagram_nodes: [
          { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
      };

      const entities = getEntitiesOnDiagram(metaModel, diagram);
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', diagram.diagram_nodes as DiagramNode[], metaModel, entities);
      expect(enabled).toBe(false);
    });

    test('should return disabled when neither endpoint is on diagram', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const diagram = { diagram_nodes: [] };
      const entities = getEntitiesOnDiagram(metaModel, diagram);
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', [] as DiagramNode[], metaModel, entities);
      expect(enabled).toBe(false);
    });
  });
});

// ============================================================================
// Task Group 5: Edge Creation Layer Tests
// ============================================================================

describe('Task Group 5: Edge Creation Layer', () => {
  const createMetaModel = (): MetaModel => ({
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [
        { id: 'app-1', name: 'Source App', description: '', app_type: '', status: '', tags: '' },
        { id: 'app-2', name: 'Target App', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [
        { id: 'comp-1', name: 'Comp 1', description: '', application_id: 'app-1', tags: '' },
      ],
      services: [
        { id: 'svc-1', name: 'Service 1', description: '', application_id: 'app-2', service_type: '', tags: '' },
      ],
      application_points: [
        { id: 'ap-app-1', name: 'Source App', description: '', kind: 'APPLICATION', application_id: 'app-1', point_type: '', tags: '' },
        { id: 'ap-app-2', name: 'Target App', description: '', kind: 'APPLICATION', application_id: 'app-2', point_type: '', tags: '' },
        { id: 'ap-comp-1', name: 'Comp 1', description: '', kind: 'APP_COMPONENT', application_id: 'app-1', application_component_id: 'comp-1', point_type: '', tags: '' },
        { id: 'ap-svc-1', name: 'Service 1', description: '', kind: 'SERVICE', application_id: 'app-2', service_id: 'svc-1', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
    },
  });

  describe('getDataMovementNodes', () => {
    test('should find APPLICATION nodes for APPLICATION kind app points', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-app-1',
        target_application_point_id: 'ap-app-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const result = getDataMovementNodes(dm, nodes, metaModel);
      expect(result).not.toBeNull();
      expect(result!.sourceNode.id).toBe('n1');
      expect(result!.targetNode.id).toBe('n2');
    });

    test('should find APP_COMPONENT node for APP_COMPONENT kind app point', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-comp-1',
        target_application_point_id: 'ap-app-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APP_COMPONENT, entity_id: 'comp-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const result = getDataMovementNodes(dm, nodes, metaModel);
      expect(result).not.toBeNull();
      expect(result!.sourceNode.id).toBe('n1');
      expect(result!.sourceNode.entity_type).toBe(ENTITY_TYPES.APP_COMPONENT);
    });

    test('should find SERVICE node for SERVICE kind app point', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-app-1',
        target_application_point_id: 'ap-svc-1',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'REALTIME',
        description: '',
        tags: '',
      };

      const nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        { id: 'n2', entity_type: ENTITY_TYPES.SERVICE, entity_id: 'svc-1', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const result = getDataMovementNodes(dm, nodes, metaModel);
      expect(result).not.toBeNull();
      expect(result!.targetNode.id).toBe('n2');
      expect(result!.targetNode.entity_type).toBe(ENTITY_TYPES.SERVICE);
    });

    test('should return null if source node is not found', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-app-1',
        target_application_point_id: 'ap-app-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const nodes: DiagramNode[] = [
        { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const result = getDataMovementNodes(dm, nodes, metaModel);
      expect(result).toBeNull();
    });
  });

  describe('getDataMovementEntityName', () => {
    test('should return logical data entity name', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-app-1',
        target_application_point_id: 'ap-app-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const name = getDataMovementEntityName(dm, metaModel);
      expect(name).toBe('Customer');
    });

    test('should return empty string for unknown entity', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-app-1',
        target_application_point_id: 'ap-app-2',
        dataEntityPointId: 'dep_log_unknown',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const name = getDataMovementEntityName(dm, metaModel);
      expect(name).toBe('');
    });
  });

  describe('createRelationshipEdge for DATA_MOVEMENT', () => {
    test('should create edge with SOLID line type', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const sourceNode: DiagramNode = { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null };
      const targetNode: DiagramNode = { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null };

      const edge = createRelationshipEdge(dm, RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT, sourceNode, targetNode);
      expect(edge.line_type).toBe('SOLID');
    });

    test('should create edge with ARROW at end', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const sourceNode: DiagramNode = { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null };
      const targetNode: DiagramNode = { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null };

      const edge = createRelationshipEdge(dm, RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT, sourceNode, targetNode);
      expect(edge.arrow_end).toBe('ARROW');
    });

    test('should set label text when provided', () => {
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const sourceNode: DiagramNode = { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null };
      const targetNode: DiagramNode = { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null };

      const edge = createRelationshipEdge(dm, RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT, sourceNode, targetNode, { labelText: 'Customer' });
      expect(edge.label_text).toBe('Customer');
    });
  });
});

// ============================================================================
// Task Group 6: Rendering Utilities Layer Tests
// ============================================================================

describe('Task Group 6: Rendering Utilities Layer', () => {
  const createMetaModel = (): MetaModel => ({
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [],
      app_components: [],
      services: [],
      application_points: [
        { id: 'ap-1', name: 'Source Point', description: '', kind: 'APPLICATION', application_id: 'app-1', point_type: '', tags: '', valid_from: '2025-Q1' },
        { id: 'ap-2', name: 'Target Point', description: '', kind: 'APPLICATION', application_id: 'app-2', point_type: '', tags: '', valid_to: '2026-Q4' },
      ],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
    },
  });

  describe('getRelationshipEndpointEntities for DATA_MOVEMENT', () => {
    test('should return source and target application points', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const endpoints = getRelationshipEndpointEntities('DATA_MOVEMENT', dm, metaModel);
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0].id).toBe('ap-1');
      expect(endpoints[1].id).toBe('ap-2');
    });

    test('should return only found endpoints', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-unknown',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const endpoints = getRelationshipEndpointEntities('DATA_MOVEMENT', dm, metaModel);
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].id).toBe('ap-1');
    });

    test('should look up from application_points not applications', () => {
      const metaModel = createMetaModel();
      const dm: DataMovement = {
        id: 'dm-1',
        source_application_point_id: 'ap-1',
        target_application_point_id: 'ap-2',
        dataEntityPointId: 'dep_log_lde-1',
        movement_type: 'BATCH',
        description: '',
        tags: '',
      };

      const endpoints = getRelationshipEndpointEntities('DATA_MOVEMENT', dm, metaModel);

      // Check that we got ApplicationPoint entities, not Application entities
      const sourcePoint = endpoints.find(e => e.id === 'ap-1') as ApplicationPoint;
      expect(sourcePoint).toBeDefined();
      expect(sourcePoint.kind).toBe('APPLICATION');
    });
  });
});

// ============================================================================
// Task Group 7: Integration Testing
// ============================================================================

describe('Task Group 7: Integration Testing', () => {
  const createFullMetaModel = (): MetaModel => ({
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [
        { id: 'app-1', name: 'OMS System', description: '', app_type: '', status: '', tags: '' },
        { id: 'app-2', name: 'CRM System', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [
        { id: 'comp-1', name: 'Order UI', description: '', application_id: 'app-1', tags: '' },
      ],
      services: [
        { id: 'svc-1', name: 'Customer API', description: '', application_id: 'app-2', service_type: '', tags: '' },
      ],
      application_points: [
        { id: 'ap-app-1', name: 'OMS System', description: '', kind: 'APPLICATION', application_id: 'app-1', point_type: '', tags: '' },
        { id: 'ap-app-2', name: 'CRM System', description: '', kind: 'APPLICATION', application_id: 'app-2', point_type: '', tags: '' },
        { id: 'ap-comp-1', name: 'Order UI', description: '', kind: 'APP_COMPONENT', application_id: 'app-1', application_component_id: 'comp-1', point_type: '', tags: '' },
        { id: 'ap-svc-1', name: 'Customer API', description: '', kind: 'SERVICE', application_id: 'app-2', service_id: 'svc-1', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer', description: '', tags: '' },
        { id: 'lde-2', name: 'Order', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [
        {
          id: 'dm-1',
          source_application_point_id: 'ap-app-1',
          target_application_point_id: 'ap-app-2',
          dataEntityPointId: 'dep_log_lde-1',
          movement_type: 'BATCH',
          description: 'Customer sync',
          tags: '',
        },
        {
          id: 'dm-2',
          source_application_point_id: 'ap-comp-1',
          target_application_point_id: 'ap-svc-1',
          data_entity_id: 'lde-2',
          movement_type: 'REALTIME',
          description: 'Order flow',
          tags: '',
        },
      ],
    },
  });

  describe('End-to-end flow: Data Movement between two Applications', () => {
    test('complete flow from enable check to edge creation', () => {
      const metaModel = createFullMetaModel();
      const dm = metaModel.relationships.data_movements[0];

      // Step 1: Create diagram with both APPLICATION nodes
      const nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      // Step 2: Check if relationship is enabled
      const entities = getEntitiesOnDiagram(metaModel, { diagram_nodes: nodes });
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', nodes, metaModel, entities);
      expect(enabled).toBe(true);

      // Step 3: Get nodes for edge creation
      const nodeResult = getDataMovementNodes(dm, nodes, metaModel);
      expect(nodeResult).not.toBeNull();
      expect(nodeResult!.sourceNode.id).toBe('n1');
      expect(nodeResult!.targetNode.id).toBe('n2');

      // Step 4: Get label text
      const labelText = getDataMovementEntityName(dm, metaModel);
      expect(labelText).toBe('Customer');

      // Step 5: Create edge
      const edge = createRelationshipEdge(
        dm,
        RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
        nodeResult!.sourceNode,
        nodeResult!.targetNode,
        { labelText }
      );

      expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT);
      expect(edge.relationship_id).toBe('dm-1');
      expect(edge.line_type).toBe('SOLID');
      expect(edge.arrow_end).toBe('ARROW');
      expect(edge.label_text).toBe('Customer');
    });
  });

  describe('End-to-end flow: Data Movement between App Component and Service', () => {
    test('complete flow from enable check to edge creation', () => {
      const metaModel = createFullMetaModel();
      const dm = metaModel.relationships.data_movements[1];

      // Create diagram with APP_COMPONENT and SERVICE nodes
      const nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APP_COMPONENT, entity_id: 'comp-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        { id: 'n2', entity_type: ENTITY_TYPES.SERVICE, entity_id: 'svc-1', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      // Check enabled
      const entities = getEntitiesOnDiagram(metaModel, { diagram_nodes: nodes });
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', nodes, metaModel, entities);
      expect(enabled).toBe(true);

      // Get nodes and create edge
      const nodeResult = getDataMovementNodes(dm, nodes, metaModel);
      expect(nodeResult).not.toBeNull();
      expect(nodeResult!.sourceNode.entity_type).toBe(ENTITY_TYPES.APP_COMPONENT);
      expect(nodeResult!.targetNode.entity_type).toBe(ENTITY_TYPES.SERVICE);
    });
  });

  describe('Diagram with only one endpoint present', () => {
    test('row should be disabled when only source is present', () => {
      const metaModel = createFullMetaModel();
      const dm = metaModel.relationships.data_movements[0];

      const nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const entities = getEntitiesOnDiagram(metaModel, { diagram_nodes: nodes });
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', nodes, metaModel, entities);
      expect(enabled).toBe(false);
    });

    test('row should be disabled when only target is present', () => {
      const metaModel = createFullMetaModel();
      const dm = metaModel.relationships.data_movements[0];

      const nodes: DiagramNode[] = [
        { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const entities = getEntitiesOnDiagram(metaModel, { diagram_nodes: nodes });
      const enabled = isRelationshipRowEnabled(dm, 'data_movements', nodes, metaModel, entities);
      expect(enabled).toBe(false);
    });
  });

  describe('Diagram switching behaviour', () => {
    test('should recalculate entities on diagram when switching', () => {
      const metaModel = createFullMetaModel();

      // Diagram 1: Has app-1 only
      const diagram1Nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      // Diagram 2: Has both apps
      const diagram2Nodes: DiagramNode[] = [
        { id: 'n1', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        { id: 'n2', entity_type: ENTITY_TYPES.APPLICATION, entity_id: 'app-2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
      ];

      const dm = metaModel.relationships.data_movements[0];

      // On diagram 1: disabled
      const entities1 = getEntitiesOnDiagram(metaModel, { diagram_nodes: diagram1Nodes });
      const enabled1 = isRelationshipRowEnabled(dm, 'data_movements', diagram1Nodes, metaModel, entities1);
      expect(enabled1).toBe(false);

      // On diagram 2: enabled
      const entities2 = getEntitiesOnDiagram(metaModel, { diagram_nodes: diagram2Nodes });
      const enabled2 = isRelationshipRowEnabled(dm, 'data_movements', diagram2Nodes, metaModel, entities2);
      expect(enabled2).toBe(true);
    });
  });
});
