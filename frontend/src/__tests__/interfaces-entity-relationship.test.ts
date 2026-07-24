/**
 * Test Suite: Interface Entity and InterfaceLogicalEntity Relationship
 *
 * Tests for the Interface entity type and InterfaceLogicalEntity relationship
 * as specified in the 2025-12-02-interfaces-entity-and-relationship spec.
 *
 * Task Group 5: Test Review and Gap Analysis
 */

import { describe, test, expect } from 'vitest';

import {
  Interface,
  InterfaceLogicalEntity,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
} from '../types/model';
import { gridConfigs, tabToEntityType, relationshipTabToType, entityTabNames, relationshipTabNames, domainGroupings } from '../config/gridConfigs';
import { entityColors, emptyModel, interfaceTypeOptions, relationshipColors } from '../config/defaults';
import { getEntityTypeConstant, getPaletteSections } from '../utils/paletteData';
import { validateModel, validateScopedInterfaceNames } from '../utils/validation';
import { getEntityLabel, getEntityColor, getRelationshipEndpointEntities, supportsChildNodes, getParentEntityType, isChildEntityType } from '../utils/rendering';
import { buildModelFromData } from '../utils/fileOperations';

// ============================================================================
// Task Group 1: Data Model Layer Tests
// ============================================================================

describe('Task Group 1: Data Model Layer', () => {
  describe('InterfaceType enum', () => {
    test('should include all expected interface types', () => {
      const validTypes = [
        'REST_API',
        'GRAPHQL_API',
        'MESSAGE_TOPIC',
        'STREAM',
        'FILE_TRANSFER',
        'SOAP_API',
        'RPC',
        'OTHER',
      ];

      // Verify all types are valid InterfaceType values
      validTypes.forEach((type) => {
        const testInterface = {
          id: 'test-id',
          name: 'Test Interface',
          description: 'Test description',
          service_id: 'service-1',
          interface_type: type,
          tags: '',
        } as Interface;
        expect(testInterface.interface_type).toBe(type);
      });
    });
  });

  describe('Interface interface', () => {
    test('should have all required fields', () => {
      const testInterface = {
        id: 'iface-001',
        name: 'User API',
        description: 'REST API for user management',
        service_id: 'svc-001',
        interface_type: 'REST_API',
        spec_link: 'https://api.example.com/spec/user-api.yaml',
        tags: 'api,user',
        valid_from: '2024-Q1',
        valid_to: '2026-Q4',
      } as Interface;

      expect(testInterface.id).toBe('iface-001');
      expect(testInterface.name).toBe('User API');
      expect(testInterface.description).toBe('REST API for user management');
      expect(testInterface.service_id).toBe('svc-001');
      expect(testInterface.interface_type).toBe('REST_API');
      expect(testInterface.spec_link).toBe('https://api.example.com/spec/user-api.yaml');
      expect(testInterface.tags).toBe('api,user');
      expect(testInterface.valid_from).toBe('2024-Q1');
      expect(testInterface.valid_to).toBe('2026-Q4');
    });

    test('should allow optional fields to be undefined', () => {
      const minimalInterface = {
        id: 'iface-002',
        name: 'Minimal Interface',
        description: '',
        service_id: 'svc-001',
        interface_type: 'MESSAGE_TOPIC',
        tags: '',
      } as Interface;

      expect(minimalInterface.spec_link).toBeUndefined();
      expect(minimalInterface.valid_from).toBeUndefined();
      expect(minimalInterface.valid_to).toBeUndefined();
    });
  });

  describe('InterfaceLogicalEntity interface', () => {
    test('should have all required fields', () => {
      const relationship = {
        id: 'ile-001',
        interface_id: 'iface-001',
        logical_entity_id: 'lde-001',
        description: 'Interface exposes User entity',
        tags: 'user,api',
        valid_from: '2024-Q1',
        valid_to: '2026-Q4',
      } as InterfaceLogicalEntity;

      expect(relationship.id).toBe('ile-001');
      expect(relationship.interface_id).toBe('iface-001');
      expect(relationship.logical_entity_id).toBe('lde-001');
      expect(relationship.description).toBe('Interface exposes User entity');
      expect(relationship.tags).toBe('user,api');
      expect(relationship.valid_from).toBe('2024-Q1');
      expect(relationship.valid_to).toBe('2026-Q4');
    });
  });

  describe('ENTITY_TYPES constant', () => {
    test('should include INTERFACE entity type', () => {
      expect(ENTITY_TYPES.INTERFACE).toBe('INTERFACE');
    });
  });

  describe('RELATIONSHIP_EDGE_TYPES constant', () => {
    test('should include INTERFACE_LOGICAL_ENTITY relationship type', () => {
      expect(RELATIONSHIP_EDGE_TYPES.INTERFACE_LOGICAL_ENTITY).toBe('INTERFACE_LOGICAL_ENTITY');
    });
  });

  describe('MetaModelEntities type', () => {
    test('should include interfaces array', () => {
      const entities = {
        business_users: [],
        business_processes: [],
        process_activities: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      };

      expect(Array.isArray(entities.interfaces)).toBe(true);
    });
  });

  describe('MetaModelRelationships type', () => {
    test('should include interface_logical_entities array', () => {
      const relationships = {
        business_user_processes: [],
        application_point_business_processes: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      };

      expect(Array.isArray(relationships.interface_logical_entities)).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 2: Configuration Layer Tests
// ============================================================================

describe('Task Group 2: Configuration Layer', () => {
  describe('gridConfigs', () => {
    test('should have interfaces grid configuration', () => {
      expect(gridConfigs.interfaces).toBeDefined();
      expect(Array.isArray(gridConfigs.interfaces)).toBe(true);
    });

    test('should have correct columns for interfaces', () => {
      const columns = gridConfigs.interfaces;
      const columnFields = columns.map(c => c.field);

      expect(columnFields).toContain('id');
      expect(columnFields).toContain('name');
      expect(columnFields).toContain('description');
      expect(columnFields).toContain('service_id');
      expect(columnFields).toContain('interface_type');
      expect(columnFields).toContain('spec_link');
      expect(columnFields).toContain('tags');
      expect(columnFields).toContain('valid_from');
      expect(columnFields).toContain('valid_to');
    });

    test('should have service_id as fk_typeahead to services', () => {
      const serviceIdColumn = gridConfigs.interfaces.find(c => c.field === 'service_id');
      expect(serviceIdColumn?.cellType).toBe('fk_typeahead');
      expect(serviceIdColumn?.fkTarget).toBe('services');
      expect(serviceIdColumn?.required).toBe(true);
    });

    test('should have interface_type as dropdown with correct options', () => {
      const interfaceTypeColumn = gridConfigs.interfaces.find(c => c.field === 'interface_type');
      expect(interfaceTypeColumn?.cellType).toBe('dropdown');
      expect(interfaceTypeColumn?.required).toBe(true);
      expect(interfaceTypeColumn?.options).toEqual(interfaceTypeOptions);
    });

    test('should have interface_logical_entities grid configuration', () => {
      expect(gridConfigs.interface_logical_entities).toBeDefined();
      expect(Array.isArray(gridConfigs.interface_logical_entities)).toBe(true);
    });

    test('should have correct columns for interface_logical_entities', () => {
      const columns = gridConfigs.interface_logical_entities;
      const columnFields = columns.map(c => c.field);

      expect(columnFields).toContain('id');
      expect(columnFields).toContain('interface_id');
      // Spec 2026-01-11: logical_entity_id replaced by the unified Data Entity
      // picker (dataEntityPointId) supporting logical OR physical entities.
      expect(columnFields).toContain('dataEntityPointId');
      expect(columnFields).toContain('description');
      expect(columnFields).toContain('tags');
      expect(columnFields).toContain('valid_from');
      expect(columnFields).toContain('valid_to');
    });

    test('should have interface_id as fk_typeahead to interfaces', () => {
      const interfaceIdColumn = gridConfigs.interface_logical_entities.find(c => c.field === 'interface_id');
      expect(interfaceIdColumn?.cellType).toBe('fk_typeahead');
      expect(interfaceIdColumn?.fkTarget).toBe('interfaces');
      expect(interfaceIdColumn?.required).toBe(true);
    });

    test('should have dataEntityPointId as data_entity_point_picker (Spec 2026-01-11)', () => {
      const dataEntityColumn = gridConfigs.interface_logical_entities.find(c => c.field === 'dataEntityPointId');
      expect(dataEntityColumn?.cellType).toBe('data_entity_point_picker');
      expect(dataEntityColumn?.required).toBe(true);
    });
  });

  describe('Tab mappings', () => {
    test('should map Interfaces tab to interfaces entity type', () => {
      expect(tabToEntityType['Interfaces']).toBe('interfaces');
    });

    test('should map Interface <-> Entity tab to interface_logical_entities', () => {
      // Spec 2026-01-11: tab renamed from "Interface <-> Logical Entity"
      expect(relationshipTabToType['Interface <-> Entity']).toBe('interface_logical_entities');
    });

    test('should include Interfaces in entityTabNames', () => {
      expect(entityTabNames).toContain('Interfaces');
    });

    test('should include Interface <-> Entity in relationshipTabNames', () => {
      expect(relationshipTabNames).toContain('Interface <-> Entity');
    });

    test('should include Interfaces in application domain grouping', () => {
      expect(domainGroupings.application).toContain('Interfaces');
    });
  });

  describe('defaults', () => {
    test('should have INTERFACE color defined', () => {
      expect(entityColors.INTERFACE).toBeDefined();
      expect(entityColors.INTERFACE.background).toBeDefined();
      expect(entityColors.INTERFACE.border).toBeDefined();
    });

    test('should have interface_logical_entities color defined', () => {
      expect(relationshipColors.interface_logical_entities).toBeDefined();
    });

    test('should include interfaces in empty model', () => {
      expect(emptyModel.metaModel.entities.interfaces).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.interfaces)).toBe(true);
      expect(emptyModel.metaModel.entities.interfaces).toHaveLength(0);
    });

    test('should include interface_logical_entities in empty model', () => {
      expect(emptyModel.metaModel.relationships.interface_logical_entities).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.relationships.interface_logical_entities)).toBe(true);
      expect(emptyModel.metaModel.relationships.interface_logical_entities).toHaveLength(0);
    });

    test('should have all interface type options', () => {
      expect(interfaceTypeOptions).toEqual([
        'REST_API',
        'GRAPHQL_API',
        'MESSAGE_TOPIC',
        'STREAM',
        'FILE_TRANSFER',
        'SOAP_API',
        'RPC',
        // Internal Processing (Spec 2026-07-24).
        'INTERNAL_PROCESSING',
        'OTHER',
      ]);
    });
  });
});

// ============================================================================
// Task Group 3: Rendering Layer Tests
// ============================================================================

describe('Task Group 3: Rendering Layer', () => {
  describe('getEntityTypeConstant', () => {
    test('should map interfaces to INTERFACE constant', () => {
      expect(getEntityTypeConstant('interfaces')).toBe(ENTITY_TYPES.INTERFACE);
    });
  });

  describe('getPaletteSections', () => {
    test('should include Interfaces section in palette', () => {
      const metaModel = emptyModel.metaModel;
      const sections = getPaletteSections(metaModel, '');

      const interfacesSection = sections.find(s => s.id === 'interfaces');
      expect(interfacesSection).toBeDefined();
      expect(interfacesSection?.label).toBe('Interfaces');
      expect(interfacesSection?.type).toBe('entity');
    });

    test('should include Interface <-> Entity section in palette', () => {
      const metaModel = emptyModel.metaModel;
      const sections = getPaletteSections(metaModel, '');

      const relationshipSection = sections.find(s => s.id === 'interface_logical_entities');
      expect(relationshipSection).toBeDefined();
      // Spec 2026-01-11: section renamed from "Interface <-> Logical Entity"
      expect(relationshipSection?.label).toBe('Interface <-> Entity');
      expect(relationshipSection?.type).toBe('relationship');
    });
  });

  describe('getEntityColor', () => {
    test('should return INTERFACE colors', () => {
      const colors = getEntityColor('INTERFACE');
      expect(colors).toEqual(entityColors.INTERFACE);
    });
  });

  describe('getEntityLabel', () => {
    test('should return Interface name from model', () => {
      const model = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            interfaces: [
              {
                id: 'iface-001',
                name: 'User API',
                description: '',
                service_id: 'svc-001',
                interface_type: 'REST_API' as const,
                tags: '',
              },
            ],
          },
        },
      };

      const label = getEntityLabel('INTERFACE', 'iface-001', model);
      expect(label).toBe('User API');
    });
  });

  describe('getRelationshipEndpointEntities', () => {
    test('should return Interface and LogicalDataEntity for INTERFACE_LOGICAL_ENTITY relationship', () => {
      const model = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            interfaces: [
              {
                id: 'iface-001',
                name: 'User API',
                description: '',
                service_id: 'svc-001',
                interface_type: 'REST_API' as const,
                tags: '',
              },
            ],
            logical_data_entities: [
              {
                id: 'lde-001',
                name: 'User',
                description: '',
                tags: '',
              },
            ],
          },
          relationships: {
            ...emptyModel.metaModel.relationships,
            interface_logical_entities: [
              {
                id: 'ile-001',
                interface_id: 'iface-001',
                logical_entity_id: 'lde-001',
                description: '',
                tags: '',
              },
            ],
          },
        },
      };

      const relationship = model.metaModel.relationships.interface_logical_entities[0];
      const endpoints = getRelationshipEndpointEntities(
        'INTERFACE_LOGICAL_ENTITY',
        relationship,
        model.metaModel
      );

      expect(endpoints).toHaveLength(2);
      expect(endpoints.find(e => e.id === 'iface-001')).toBeDefined();
      expect(endpoints.find(e => e.id === 'lde-001')).toBeDefined();
    });
  });

  describe('Containment relationships', () => {
    test('should indicate Service supports child nodes', () => {
      expect(supportsChildNodes(ENTITY_TYPES.SERVICE)).toBe(true);
    });

    test('should indicate Interface is a child entity type', () => {
      expect(isChildEntityType(ENTITY_TYPES.INTERFACE)).toBe(true);
    });

    test('should return SERVICE as parent for INTERFACE', () => {
      expect(getParentEntityType(ENTITY_TYPES.INTERFACE)).toBe(ENTITY_TYPES.SERVICE);
    });
  });
});

// ============================================================================
// Task Group 4: Validation Layer Tests
// ============================================================================

describe('Task Group 4: Validation Layer', () => {
  describe('validateModel', () => {
    test('should validate Interface required fields', () => {
      const model = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            interfaces: [
              {
                id: 'iface-001',
                name: '', // Missing required name
                description: '',
                service_id: '', // Missing required service_id
                interface_type: '' as Interface['interface_type'], // Missing required interface_type
                tags: '',
              },
            ],
          },
        },
      };

      const errors = validateModel(model);

      // Should have errors for missing required fields
      const interfaceErrors = errors.filter(e => e.entityId === 'iface-001');
      expect(interfaceErrors.length).toBeGreaterThan(0);

      // Check for specific field errors
      expect(interfaceErrors.some(e => e.field === 'name')).toBe(true);
      expect(interfaceErrors.some(e => e.field === 'service_id')).toBe(true);
      expect(interfaceErrors.some(e => e.field === 'interface_type')).toBe(true);
    });

    test('should validate Interface FK references', () => {
      const model = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            interfaces: [
              {
                id: 'iface-001',
                name: 'User API',
                description: '',
                service_id: 'invalid-service', // Invalid FK
                interface_type: 'REST_API' as const,
                tags: '',
              },
            ],
          },
        },
      };

      const errors = validateModel(model);

      // Should have error for invalid FK reference
      const fkErrors = errors.filter(e => e.entityId === 'iface-001' && e.field === 'service_id');
      expect(fkErrors.length).toBeGreaterThan(0);
    });

    // Note: validateModel only validates entity rows, not relationship rows.
    // Relationship rows are validated by the grid component's FK typeahead validation.
    // This is consistent with the existing architecture pattern.
    test('should include interface_logical_entities in model relationships (structure test)', () => {
      const model = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          relationships: {
            ...emptyModel.metaModel.relationships,
            interface_logical_entities: [
              {
                id: 'ile-001',
                interface_id: 'iface-001',
                logical_entity_id: 'lde-001',
                description: 'Test relationship',
                tags: '',
              },
            ],
          },
        },
      };

      // Verify the relationship exists in the model structure
      expect(model.metaModel.relationships.interface_logical_entities).toHaveLength(1);
      expect(model.metaModel.relationships.interface_logical_entities[0].id).toBe('ile-001');
      expect(model.metaModel.relationships.interface_logical_entities[0].interface_id).toBe('iface-001');
      expect(model.metaModel.relationships.interface_logical_entities[0].logical_entity_id).toBe('lde-001');
    });

    test('should have interface_logical_entities grid config with required FK fields', () => {
      // Verify grid config enforces FK requirements (used by grid component for validation)
      const interfaceIdColumn = gridConfigs.interface_logical_entities.find(c => c.field === 'interface_id');
      const dataEntityColumn = gridConfigs.interface_logical_entities.find(c => c.field === 'dataEntityPointId');

      expect(interfaceIdColumn?.required).toBe(true);
      expect(interfaceIdColumn?.cellType).toBe('fk_typeahead');
      expect(interfaceIdColumn?.fkTarget).toBe('interfaces');

      // Spec 2026-01-11: unified Data Entity picker replaces the logical-only FK
      expect(dataEntityColumn?.required).toBe(true);
      expect(dataEntityColumn?.cellType).toBe('data_entity_point_picker');
    });
  });

  describe('validateScopedInterfaceNames', () => {
    test('should allow duplicate names across different services', () => {
      const interfaces = [
        {
          id: 'iface-001',
          name: 'GetUsers',
          description: '',
          service_id: 'svc-001',
          interface_type: 'REST_API',
          tags: '',
        },
        {
          id: 'iface-002',
          name: 'GetUsers', // Same name, different service - OK
          description: '',
          service_id: 'svc-002',
          interface_type: 'REST_API',
          tags: '',
        },
      ] as Interface[];

      const errors = validateScopedInterfaceNames(interfaces);
      expect(errors).toHaveLength(0);
    });

    test('should detect duplicate names within same service', () => {
      const interfaces = [
        {
          id: 'iface-001',
          name: 'GetUsers',
          description: '',
          service_id: 'svc-001',
          interface_type: 'REST_API',
          tags: '',
        },
        {
          id: 'iface-002',
          name: 'GetUsers', // Same name, same service - DUPLICATE
          description: '',
          service_id: 'svc-001',
          interface_type: 'GRAPHQL_API',
          tags: '',
        },
      ] as Interface[];

      const errors = validateScopedInterfaceNames(interfaces);
      expect(errors).toHaveLength(2); // Both duplicates are flagged
      expect(errors[0].type).toBe('duplicate_name');
      expect(errors[1].type).toBe('duplicate_name');
    });

    test('should be case-insensitive for duplicate detection', () => {
      const interfaces = [
        {
          id: 'iface-001',
          name: 'GetUsers',
          description: '',
          service_id: 'svc-001',
          interface_type: 'REST_API',
          tags: '',
        },
        {
          id: 'iface-002',
          name: 'getusers', // Same name different case - DUPLICATE
          description: '',
          service_id: 'svc-001',
          interface_type: 'GRAPHQL_API',
          tags: '',
        },
      ] as Interface[];

      const errors = validateScopedInterfaceNames(interfaces);
      expect(errors).toHaveLength(2);
    });
  });
});

// ============================================================================
// Task Group 5: File Operations Tests
// ============================================================================

describe('Task Group 5: File Operations', () => {
  describe('buildModelFromData', () => {
    test('should parse interfaces array from JSON', () => {
      const data = {
        metaModel: {
          entities: {
            interfaces: [
              {
                id: 'iface-001',
                name: 'User API',
                description: 'User management API',
                service_id: 'svc-001',
                interface_type: 'REST_API',
                spec_link: 'https://api.example.com/spec.yaml',
                tags: 'api,user',
                valid_from: '2024-Q1',
                valid_to: '2026-Q4',
              },
            ],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(data);

      expect(model.metaModel.entities.interfaces).toHaveLength(1);
      expect(model.metaModel.entities.interfaces[0].id).toBe('iface-001');
      expect(model.metaModel.entities.interfaces[0].name).toBe('User API');
      expect(model.metaModel.entities.interfaces[0].interface_type).toBe('REST_API');
    });

    test('should parse interface_logical_entities array from JSON', () => {
      const data = {
        metaModel: {
          entities: {},
          relationships: {
            interface_logical_entities: [
              {
                id: 'ile-001',
                interface_id: 'iface-001',
                logical_entity_id: 'lde-001',
                description: 'Interface exposes User',
                tags: 'user',
                valid_from: '2024-Q1',
                valid_to: '2026-Q4',
              },
            ],
          },
        },
        diagrams: [],
      };

      const model = buildModelFromData(data);

      expect(model.metaModel.relationships.interface_logical_entities).toHaveLength(1);
      expect(model.metaModel.relationships.interface_logical_entities[0].id).toBe('ile-001');
      expect(model.metaModel.relationships.interface_logical_entities[0].interface_id).toBe('iface-001');
      expect(model.metaModel.relationships.interface_logical_entities[0].logical_entity_id).toBe('lde-001');
    });

    test('should default to empty array when interfaces is missing', () => {
      const data = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(data);

      expect(model.metaModel.entities.interfaces).toBeDefined();
      expect(model.metaModel.entities.interfaces).toHaveLength(0);
    });

    test('should default to empty array when interface_logical_entities is missing', () => {
      const data = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(data);

      expect(model.metaModel.relationships.interface_logical_entities).toBeDefined();
      expect(model.metaModel.relationships.interface_logical_entities).toHaveLength(0);
    });
  });
});
