/**
 * Tests for Interaction Entity + App_Business_Point Super-type
 *
 * Phase 1: Type Definitions (Task Groups 1-3)
 * Tests for Interaction interface, App_Business_Point super-type, and DiagramUserInteraction schema.
 */

import {
  ENTITY_TYPES,
  APP_BUSINESS_POINT_TYPES,
  isAppBusinessPointType,
  resolveAppBusinessPoint,
  MetaModel,
  Interaction,
  DiagramUserInteraction,
  Diagram,
  AnyEntity,
} from '../types/model';

// ============================================================================
// Task Group 1: Core Type Definitions Tests
// ============================================================================

describe('Task Group 1: Core Type Definitions', () => {
  describe('Interaction interface structure', () => {
    it('should have required fields: id, name, user_id, primary_app_business_point_id', () => {
      // Create a valid Interaction object
      const interaction: Interaction = {
        id: 'int-001',
        name: 'Login Interaction',
        user_id: 'user-001',
        primary_app_business_point_id: 'app-001',
      };

      expect(interaction.id).toBe('int-001');
      expect(interaction.name).toBe('Login Interaction');
      expect(interaction.user_id).toBe('user-001');
      expect(interaction.primary_app_business_point_id).toBe('app-001');
    });

    it('should support optional fields: description, secondary_app_business_point_id', () => {
      const interaction: Interaction = {
        id: 'int-002',
        name: 'Data Entry Interaction',
        description: 'User enters data into the form',
        user_id: 'user-002',
        primary_app_business_point_id: 'interface-001',
        secondary_app_business_point_id: 'service-001',
      };

      expect(interaction.description).toBe('User enters data into the form');
      expect(interaction.secondary_app_business_point_id).toBe('service-001');
    });

    it('should work without optional fields', () => {
      const interaction: Interaction = {
        id: 'int-003',
        name: 'Simple Interaction',
        user_id: 'user-003',
        primary_app_business_point_id: 'endpoint-001',
      };

      expect(interaction.description).toBeUndefined();
      expect(interaction.secondary_app_business_point_id).toBeUndefined();
    });
  });

  describe('ENTITY_TYPES.INTERACTION', () => {
    it('should be defined in ENTITY_TYPES constant', () => {
      expect(ENTITY_TYPES.INTERACTION).toBeDefined();
      expect(ENTITY_TYPES.INTERACTION).toBe('INTERACTION');
    });

    it('should be distinct from other entity types', () => {
      const entityTypeValues = Object.values(ENTITY_TYPES);
      const interactionCount = entityTypeValues.filter(v => v === 'INTERACTION').length;
      expect(interactionCount).toBe(1);
    });
  });
});

// ============================================================================
// Task Group 2: App_Business_Point Super-type Tests
// ============================================================================

describe('Task Group 2: App_Business_Point Super-type', () => {
  describe('APP_BUSINESS_POINT_TYPES array', () => {
    it('should contain all 7 valid App_Business_Point entity types', () => {
      expect(APP_BUSINESS_POINT_TYPES).toBeDefined();
      expect(APP_BUSINESS_POINT_TYPES).toHaveLength(7);

      expect(APP_BUSINESS_POINT_TYPES).toContain('APPLICATION');
      expect(APP_BUSINESS_POINT_TYPES).toContain('APP_COMPONENT');
      expect(APP_BUSINESS_POINT_TYPES).toContain('SERVICE');
      expect(APP_BUSINESS_POINT_TYPES).toContain('INTERFACE');
      expect(APP_BUSINESS_POINT_TYPES).toContain('ENDPOINT');
      expect(APP_BUSINESS_POINT_TYPES).toContain('BUSINESS_PROCESS');
      expect(APP_BUSINESS_POINT_TYPES).toContain('PROCESS_ACTIVITY');
    });

    it('should NOT contain non-App_Business_Point types', () => {
      expect(APP_BUSINESS_POINT_TYPES).not.toContain('BUSINESS_USER');
      expect(APP_BUSINESS_POINT_TYPES).not.toContain('LOGICAL_DATA_ENTITY');
      expect(APP_BUSINESS_POINT_TYPES).not.toContain('PHYSICAL_DATA_ENTITY');
      expect(APP_BUSINESS_POINT_TYPES).not.toContain('INTERACTION');
    });
  });

  describe('isAppBusinessPointType() helper', () => {
    it('should return true for valid App_Business_Point types', () => {
      expect(isAppBusinessPointType('APPLICATION')).toBe(true);
      expect(isAppBusinessPointType('APP_COMPONENT')).toBe(true);
      expect(isAppBusinessPointType('SERVICE')).toBe(true);
      expect(isAppBusinessPointType('INTERFACE')).toBe(true);
      expect(isAppBusinessPointType('ENDPOINT')).toBe(true);
      expect(isAppBusinessPointType('BUSINESS_PROCESS')).toBe(true);
      expect(isAppBusinessPointType('PROCESS_ACTIVITY')).toBe(true);
    });

    it('should return false for invalid/non-App_Business_Point types', () => {
      expect(isAppBusinessPointType('BUSINESS_USER')).toBe(false);
      expect(isAppBusinessPointType('LOGICAL_DATA_ENTITY')).toBe(false);
      expect(isAppBusinessPointType('PHYSICAL_DATA_ENTITY')).toBe(false);
      expect(isAppBusinessPointType('INTERACTION')).toBe(false);
      expect(isAppBusinessPointType('UNKNOWN_TYPE')).toBe(false);
      expect(isAppBusinessPointType('')).toBe(false);
    });
  });

  describe('resolveAppBusinessPoint() helper', () => {
    // Create a mock MetaModel with various entities
    const mockMetaModel: MetaModel = {
      entities: {
        applications: [
          { id: 'app-001', name: 'Test Application', description: '', app_type: 'web', status: 'active', tags: '' },
        ],
        app_components: [
          { id: 'ac-001', name: 'Test Component', description: '', application_id: 'app-001', tags: '' },
        ],
        services: [
          { id: 'svc-001', name: 'Test Service', description: '', application_id: 'app-001', service_type: 'api', tags: '' },
        ],
        interfaces: [
          { id: 'int-001', name: 'Test Interface', description: '', service_id: 'svc-001', interface_type: 'REST_API', tags: '' },
        ],
        endpoints: [
          { id: 'ep-001', name: 'GET /users', description: '', interface_id: 'int-001', endpoint_type: 'HTTP_REST', path_or_address: '/users', tags: '' },
        ],
        business_processes: [
          { id: 'bp-001', name: 'Test Process', description: '', tags: '' },
        ],
        process_activities: [
          { id: 'pa-001', name: 'Test Activity', description: '', business_process_id: 'bp-001', actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
        ],
        business_users: [],
        business_points: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    };

    it('should resolve an Application ID correctly', () => {
      const result = resolveAppBusinessPoint('app-001', mockMetaModel);
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('APPLICATION');
      expect(result?.entity.name).toBe('Test Application');
    });

    it('should resolve a Service ID correctly', () => {
      const result = resolveAppBusinessPoint('svc-001', mockMetaModel);
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('SERVICE');
      expect(result?.entity.name).toBe('Test Service');
    });

    it('should resolve an Interface ID correctly', () => {
      const result = resolveAppBusinessPoint('int-001', mockMetaModel);
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('INTERFACE');
      expect(result?.entity.name).toBe('Test Interface');
    });

    it('should resolve an Endpoint ID correctly', () => {
      const result = resolveAppBusinessPoint('ep-001', mockMetaModel);
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('ENDPOINT');
      expect(result?.entity.name).toBe('GET /users');
    });

    it('should resolve a Business Process ID correctly', () => {
      const result = resolveAppBusinessPoint('bp-001', mockMetaModel);
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('BUSINESS_PROCESS');
      expect(result?.entity.name).toBe('Test Process');
    });

    it('should resolve a Process Activity ID correctly', () => {
      const result = resolveAppBusinessPoint('pa-001', mockMetaModel);
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('PROCESS_ACTIVITY');
      expect(result?.entity.name).toBe('Test Activity');
    });

    it('should return null for non-existent ID', () => {
      const result = resolveAppBusinessPoint('non-existent-id', mockMetaModel);
      expect(result).toBeNull();
    });

    it('should return null for empty string ID', () => {
      const result = resolveAppBusinessPoint('', mockMetaModel);
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// Task Group 3: DiagramUserInteraction Schema Tests
// ============================================================================

describe('Task Group 3: DiagramUserInteraction Schema', () => {
  describe('DiagramUserInteraction interface structure', () => {
    it('should have required fields: id, interaction_id, primary_node_id, line_style', () => {
      const userInteraction: DiagramUserInteraction = {
        id: 'dui-001',
        interaction_id: 'int-001',
        primary_node_id: 'node-001',
        line_style: 'dotted',
      };

      expect(userInteraction.id).toBe('dui-001');
      expect(userInteraction.interaction_id).toBe('int-001');
      expect(userInteraction.primary_node_id).toBe('node-001');
      expect(userInteraction.line_style).toBe('dotted');
    });

    it('should support optional fields: secondary_node_id, user_node_id', () => {
      const userInteraction: DiagramUserInteraction = {
        id: 'dui-002',
        interaction_id: 'int-002',
        primary_node_id: 'node-002',
        secondary_node_id: 'node-003',
        user_node_id: 'node-004',
        line_style: 'solid',
      };

      expect(userInteraction.secondary_node_id).toBe('node-003');
      expect(userInteraction.user_node_id).toBe('node-004');
    });

    it('should accept "dotted" and "solid" as valid line_style values', () => {
      const dottedInteraction: DiagramUserInteraction = {
        id: 'dui-003',
        interaction_id: 'int-003',
        primary_node_id: 'node-005',
        line_style: 'dotted',
      };

      const solidInteraction: DiagramUserInteraction = {
        id: 'dui-004',
        interaction_id: 'int-004',
        primary_node_id: 'node-006',
        line_style: 'solid',
      };

      expect(dottedInteraction.line_style).toBe('dotted');
      expect(solidInteraction.line_style).toBe('solid');
    });
  });

  describe('Diagram interface with user_interactions', () => {
    it('should include optional user_interactions array', () => {
      const diagram: Diagram = {
        id: 'diagram-001',
        name: 'Test Diagram',
        description: 'A test diagram',
        diagram_nodes: [],
        diagram_edges: [],
        user_interactions: [
          {
            id: 'dui-001',
            interaction_id: 'int-001',
            primary_node_id: 'node-001',
            line_style: 'dotted',
          },
        ],
      };

      expect(diagram.user_interactions).toBeDefined();
      expect(diagram.user_interactions).toHaveLength(1);
      expect(diagram.user_interactions![0].id).toBe('dui-001');
    });

    it('should work without user_interactions (backward compatibility)', () => {
      const diagram: Diagram = {
        id: 'diagram-002',
        name: 'Legacy Diagram',
        description: 'A diagram without user_interactions',
        diagram_nodes: [],
        diagram_edges: [],
      };

      expect(diagram.user_interactions).toBeUndefined();
    });

    it('should support multiple user_interactions', () => {
      const diagram: Diagram = {
        id: 'diagram-003',
        name: 'Multi-Interaction Diagram',
        description: '',
        diagram_nodes: [],
        diagram_edges: [],
        user_interactions: [
          {
            id: 'dui-001',
            interaction_id: 'int-001',
            primary_node_id: 'node-001',
            line_style: 'dotted',
          },
          {
            id: 'dui-002',
            interaction_id: 'int-002',
            primary_node_id: 'node-002',
            secondary_node_id: 'node-003',
            user_node_id: 'node-004',
            line_style: 'solid',
          },
        ],
      };

      expect(diagram.user_interactions).toHaveLength(2);
    });
  });
});
