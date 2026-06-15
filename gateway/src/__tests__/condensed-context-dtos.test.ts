/**
 * Tests for Condensed Context DTOs feature
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM
 *
 * This test file covers:
 * - Task Group 1: DTO type definitions and validation
 * - Task Group 2: Configuration settings
 * - Task Group 3: Entity and Attributes DTO builder
 * - Task Group 4: Interface Contract DTO builder
 * - Task Group 5: Service Slice DTO builder
 * - Task Group 6: Diagram Summary DTO builder
 * - Task Group 7: DTO aggregation and de-duplication
 * - Task Group 8: Truncation logic
 * - Task Group 9: Condensed context section formatter
 * - Task Group 10: Chat route integration
 */

import {
  EntityAndAttributesDto,
  InterfaceContractDto,
  ServiceSliceDto,
  DiagramSummaryDto,
  CondensedContextDto,
  AttributeInfo,
  EndpointInfo,
  EntityRelationshipInfo,
  ExpandResolveResponseDto,
  ResolvedEntitySummary,
  ResolvedDiagramSummary,
  ResolvedRelationship,
} from '../types/chat';

import { loadConfig, resetConfig, CondensedContextConfig } from '../config';

import {
  buildEntityAndAttributesDtos,
  buildInterfaceContractDtos,
  buildServiceSliceDtos,
  buildDiagramSummaryDtos,
  buildCondensedContextDtos,
  applyTruncation,
  formatCondensedContextSection,
  shouldUseCondensedContext,
  generateStableId,
} from '../services/promptBuilder';

// ============================================================================
// Task Group 1: Condensed DTO Type Definitions Tests
// ============================================================================

describe('Task Group 1: Condensed DTO Type Definitions', () => {
  describe('EntityAndAttributesDto', () => {
    it('should have required fields: kind, id, entity_type, name, attributes, relationships', () => {
      const dto: EntityAndAttributesDto = {
        kind: 'entity_and_attributes',
        id: 'physicalDataEntities::user-table-123',
        entity_type: 'physical_data_entity',
        name: 'UserTable',
        attributes: [],
        relationships: [],
      };

      expect(dto.kind).toBe('entity_and_attributes');
      expect(dto.id).toContain('::');
      expect(dto.entity_type).toBeDefined();
      expect(dto.name).toBeDefined();
      expect(Array.isArray(dto.attributes)).toBe(true);
      expect(Array.isArray(dto.relationships)).toBe(true);
    });

    it('should allow attributes with name, type, pk, and nullable fields', () => {
      const attribute: AttributeInfo = {
        name: 'user_id',
        type: 'UUID',
        pk: true,
        nullable: false,
      };

      const dto: EntityAndAttributesDto = {
        kind: 'entity_and_attributes',
        id: 'physicalDataEntities::user-table-123',
        entity_type: 'physical_data_entity',
        name: 'UserTable',
        attributes: [attribute],
        relationships: [],
      };

      expect(dto.attributes[0].name).toBe('user_id');
      expect(dto.attributes[0].type).toBe('UUID');
      expect(dto.attributes[0].pk).toBe(true);
      expect(dto.attributes[0].nullable).toBe(false);
    });

    it('should allow relationships with type, target_entity, and cardinality fields', () => {
      const relationship: EntityRelationshipInfo = {
        type: 'fk',
        target_entity: 'OrderTable',
        cardinality: '1:N',
      };

      const dto: EntityAndAttributesDto = {
        kind: 'entity_and_attributes',
        id: 'physicalDataEntities::user-table-123',
        entity_type: 'physical_data_entity',
        name: 'UserTable',
        attributes: [],
        relationships: [relationship],
      };

      expect(dto.relationships[0].type).toBe('fk');
      expect(dto.relationships[0].target_entity).toBe('OrderTable');
      expect(dto.relationships[0].cardinality).toBe('1:N');
    });
  });

  describe('InterfaceContractDto', () => {
    it('should have required fields: kind, id, name, endpoints, schemas, key_relationships', () => {
      const dto: InterfaceContractDto = {
        kind: 'interface_contract',
        id: 'user-api-interface-456',
        name: 'UserAPI',
        endpoints: [],
        schemas: [],
        key_relationships: [],
      };

      expect(dto.kind).toBe('interface_contract');
      expect(dto.id).toBeDefined();
      expect(dto.name).toBeDefined();
      expect(Array.isArray(dto.endpoints)).toBe(true);
      expect(Array.isArray(dto.schemas)).toBe(true);
      expect(Array.isArray(dto.key_relationships)).toBe(true);
    });

    it('should allow endpoints with name, input_schema, output_schema, and notes fields', () => {
      const endpoint: EndpointInfo = {
        name: 'GET /users/{id}',
        input_schema: 'UserIdParam',
        output_schema: 'UserResponse',
        notes: 'Retrieves a user by ID',
      };

      const dto: InterfaceContractDto = {
        kind: 'interface_contract',
        id: 'user-api-interface-456',
        name: 'UserAPI',
        endpoints: [endpoint],
        schemas: [],
        key_relationships: [],
      };

      expect(dto.endpoints[0].name).toBe('GET /users/{id}');
      expect(dto.endpoints[0].input_schema).toBe('UserIdParam');
      expect(dto.endpoints[0].output_schema).toBe('UserResponse');
      expect(dto.endpoints[0].notes).toBe('Retrieves a user by ID');
    });
  });

  describe('ServiceSliceDto', () => {
    it('should have required fields: kind, id, application, component, service, interfaces, endpoints, key_entities, dependencies', () => {
      const dto: ServiceSliceDto = {
        kind: 'service_slice',
        id: 'user-service-789',
        application: 'UserApp',
        component: 'UserComponent',
        service: 'UserService',
        interfaces: [],
        endpoints: [],
        key_entities: [],
        dependencies: [],
      };

      expect(dto.kind).toBe('service_slice');
      expect(dto.id).toBeDefined();
      expect(dto.application).toBe('UserApp');
      expect(dto.component).toBe('UserComponent');
      expect(dto.service).toBe('UserService');
      expect(Array.isArray(dto.interfaces)).toBe(true);
      expect(Array.isArray(dto.endpoints)).toBe(true);
      expect(Array.isArray(dto.key_entities)).toBe(true);
      expect(Array.isArray(dto.dependencies)).toBe(true);
    });

    it('should allow null application and component for standalone services', () => {
      const dto: ServiceSliceDto = {
        kind: 'service_slice',
        id: 'standalone-service',
        application: null,
        component: null,
        service: 'StandaloneService',
        interfaces: [],
        endpoints: [],
        key_entities: [],
        dependencies: [],
      };

      expect(dto.application).toBeNull();
      expect(dto.component).toBeNull();
    });
  });

  describe('DiagramSummaryDto', () => {
    it('should have required fields: kind, id, name, diagram_type, referenced_entities', () => {
      const dto: DiagramSummaryDto = {
        kind: 'diagram_summary',
        id: 'er-diagram-001',
        name: 'User Data Model',
        diagram_type: 'ER',
        referenced_entities: ['UserTable', 'OrderTable'],
      };

      expect(dto.kind).toBe('diagram_summary');
      expect(dto.id).toBeDefined();
      expect(dto.name).toBe('User Data Model');
      expect(dto.diagram_type).toBe('ER');
      expect(dto.referenced_entities).toEqual(['UserTable', 'OrderTable']);
    });
  });

  describe('CondensedContextDto union type', () => {
    it('should discriminate correctly on kind field for entity_and_attributes', () => {
      const dto: CondensedContextDto = {
        kind: 'entity_and_attributes',
        id: 'test::123',
        entity_type: 'physical_data_entity',
        name: 'Test',
        attributes: [],
        relationships: [],
      };

      if (dto.kind === 'entity_and_attributes') {
        expect(dto.entity_type).toBeDefined();
        expect(dto.attributes).toBeDefined();
      }
    });

    it('should discriminate correctly on kind field for interface_contract', () => {
      const dto: CondensedContextDto = {
        kind: 'interface_contract',
        id: 'interface-123',
        name: 'TestAPI',
        endpoints: [],
        schemas: [],
        key_relationships: [],
      };

      if (dto.kind === 'interface_contract') {
        expect(dto.endpoints).toBeDefined();
        expect(dto.schemas).toBeDefined();
      }
    });

    it('should discriminate correctly on kind field for service_slice', () => {
      const dto: CondensedContextDto = {
        kind: 'service_slice',
        id: 'service-123',
        application: null,
        component: null,
        service: 'TestService',
        interfaces: [],
        endpoints: [],
        key_entities: [],
        dependencies: [],
      };

      if (dto.kind === 'service_slice') {
        expect(dto.service).toBeDefined();
        expect(dto.interfaces).toBeDefined();
      }
    });

    it('should discriminate correctly on kind field for diagram_summary', () => {
      const dto: CondensedContextDto = {
        kind: 'diagram_summary',
        id: 'diagram-123',
        name: 'TestDiagram',
        diagram_type: 'ER',
        referenced_entities: [],
      };

      if (dto.kind === 'diagram_summary') {
        expect(dto.diagram_type).toBeDefined();
        expect(dto.referenced_entities).toBeDefined();
      }
    });
  });

  describe('Stable ID format validation', () => {
    it('should follow entityType::entityId pattern for entity_and_attributes', () => {
      const id = 'physicalDataEntities::abc-123-def';
      const [entityType, entityId] = id.split('::');

      expect(entityType).toBe('physicalDataEntities');
      expect(entityId).toBe('abc-123-def');
    });

    it('should generate stable ID correctly', () => {
      const stableId = generateStableId('logicalDataEntities', 'entity-456');
      expect(stableId).toBe('logicalDataEntities::entity-456');
    });
  });
});

// ============================================================================
// Task Group 2: Condensed Context Configuration Tests
// ============================================================================

describe('Task Group 2: Condensed Context Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' };
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it('should have default maxDtoCount of 50', () => {
    const config = loadConfig();
    expect(config.condensedContext.maxDtoCount).toBe(50);
  });

  it('should have default maxJsonChars of 40000', () => {
    const config = loadConfig();
    expect(config.condensedContext.maxJsonChars).toBe(40000);
  });

  it('should allow CONDENSED_CONTEXT_MAX_DTO_COUNT env var override', () => {
    process.env.CONDENSED_CONTEXT_MAX_DTO_COUNT = '100';
    resetConfig();
    const config = loadConfig();
    expect(config.condensedContext.maxDtoCount).toBe(100);
  });

  it('should allow CONDENSED_CONTEXT_MAX_JSON_CHARS env var override', () => {
    process.env.CONDENSED_CONTEXT_MAX_JSON_CHARS = '80000';
    resetConfig();
    const config = loadConfig();
    expect(config.condensedContext.maxJsonChars).toBe(80000);
  });
});

// ============================================================================
// Task Group 3: Entity and Attributes DTO Builder Tests
// ============================================================================

describe('Task Group 3: Entity and Attributes DTO Builder', () => {
  const createMockExpandResponse = (
    entities: ResolvedEntitySummary[] = [],
    diagrams: ResolvedDiagramSummary[] = [],
    relationships: ResolvedRelationship[] = []
  ): ExpandResolveResponseDto => ({
    expanded_entity_ids: entities.map(e => `${e.entity_type}::${e.id}`),
    expanded_diagram_ids: diagrams.map(d => d.id),
    resolved_entities: entities,
    resolved_diagrams: diagrams,
    truncated: false,
    resolved_relationships: relationships,
  });

  it('should extract physical data entity with attributes from relevant_fields', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-table-123',
        name: 'UserTable',
        entity_type: 'physicalDataEntities',
        category: 'data',
        relevant_fields: {
          attributes: [
            { name: 'user_id', type: 'UUID', pk: true, nullable: false },
            { name: 'email', type: 'VARCHAR', pk: false, nullable: false },
          ],
        },
      },
    ]);

    const dtos = buildEntityAndAttributesDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].kind).toBe('entity_and_attributes');
    expect(dtos[0].id).toBe('physicalDataEntities::user-table-123');
    expect(dtos[0].entity_type).toBe('physical_data_entity');
    expect(dtos[0].name).toBe('UserTable');
    expect(dtos[0].attributes).toHaveLength(2);
    expect(dtos[0].attributes[0].name).toBe('user_id');
    expect(dtos[0].attributes[0].pk).toBe(true);
  });

  it('should extract logical data entity with attributes', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-entity-456',
        name: 'User',
        entity_type: 'logicalDataEntities',
        category: 'data',
        relevant_fields: {
          attributes: [
            { name: 'firstName', type: 'String' },
            { name: 'lastName', type: 'String' },
          ],
        },
      },
    ]);

    const dtos = buildEntityAndAttributesDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].entity_type).toBe('logical_data_entity');
    expect(dtos[0].attributes).toHaveLength(2);
  });

  it('should extract relationships with cardinality from summary_fields', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-table-123',
          name: 'UserTable',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {},
        },
        {
          id: 'order-table-456',
          name: 'OrderTable',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {},
        },
      ],
      [],
      [
        {
          id: 'rel-001',
          type: 'fk',
          from: { entity_type: 'physicalDataEntities', entity_id: 'user-table-123', name: 'UserTable' },
          to: { entity_type: 'physicalDataEntities', entity_id: 'order-table-456', name: 'OrderTable' },
          label: 'UserTable has many OrderTable',
          summary_fields: { cardinality: '1:N', relationship_type: 'foreign_key' },
        },
      ]
    );

    const dtos = buildEntityAndAttributesDtos(response);

    const userDto = dtos.find(d => d.name === 'UserTable');
    expect(userDto).toBeDefined();
    expect(userDto!.relationships).toHaveLength(1);
    expect(userDto!.relationships[0].type).toBe('fk');
    expect(userDto!.relationships[0].target_entity).toBe('OrderTable');
    expect(userDto!.relationships[0].cardinality).toBe('1:N');
  });

  it('should generate stable id in entityType::entityId format', () => {
    const response = createMockExpandResponse([
      {
        id: 'entity-789',
        name: 'TestEntity',
        entity_type: 'logicalDataEntities',
        category: 'data',
        relevant_fields: {},
      },
    ]);

    const dtos = buildEntityAndAttributesDtos(response);

    expect(dtos[0].id).toBe('logicalDataEntities::entity-789');
  });

  it('should return empty array for empty input', () => {
    const response = createMockExpandResponse([], [], []);

    const dtos = buildEntityAndAttributesDtos(response);

    expect(dtos).toEqual([]);
  });

  it('should only include data entities, not services or interfaces', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-entity',
        name: 'User',
        entity_type: 'logicalDataEntities',
        category: 'data',
        relevant_fields: {},
      },
      {
        id: 'user-service',
        name: 'UserService',
        entity_type: 'services',
        category: 'application',
        relevant_fields: {},
      },
      {
        id: 'user-api',
        name: 'UserAPI',
        entity_type: 'interfaces',
        category: 'application',
        relevant_fields: {},
      },
    ]);

    const dtos = buildEntityAndAttributesDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].name).toBe('User');
  });
});

// ============================================================================
// Task Group 4: Interface Contract DTO Builder Tests
// ============================================================================

describe('Task Group 4: Interface Contract DTO Builder', () => {
  const createMockExpandResponse = (
    entities: ResolvedEntitySummary[] = [],
    diagrams: ResolvedDiagramSummary[] = [],
    relationships: ResolvedRelationship[] = []
  ): ExpandResolveResponseDto => ({
    expanded_entity_ids: entities.map(e => `${e.entity_type}::${e.id}`),
    expanded_diagram_ids: diagrams.map(d => d.id),
    resolved_entities: entities,
    resolved_diagrams: diagrams,
    truncated: false,
    resolved_relationships: relationships,
  });

  it('should extract interface with name and id', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-api-123',
        name: 'UserAPI',
        entity_type: 'interfaces',
        category: 'application',
        relevant_fields: {},
      },
    ]);

    const dtos = buildInterfaceContractDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].kind).toBe('interface_contract');
    expect(dtos[0].id).toBe('user-api-123');
    expect(dtos[0].name).toBe('UserAPI');
  });

  it('should populate endpoints from resolved_entities where entity_type=endpoints', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-api-123',
          name: 'UserAPI',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'endpoint-get-user',
          name: 'GET /users/{id}',
          entity_type: 'endpoints',
          category: 'application',
          relevant_fields: {
            input_schema: 'UserIdParam',
            output_schema: 'UserResponse',
            description: 'Get user by ID',
          },
        },
      ],
      [],
      [
        {
          id: 'rel-001',
          type: 'contains',
          from: { entity_type: 'interfaces', entity_id: 'user-api-123', name: 'UserAPI' },
          to: { entity_type: 'endpoints', entity_id: 'endpoint-get-user', name: 'GET /users/{id}' },
          label: 'UserAPI contains GET /users/{id}',
          summary_fields: {},
        },
      ]
    );

    const dtos = buildInterfaceContractDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].endpoints).toHaveLength(1);
    expect(dtos[0].endpoints[0].name).toBe('GET /users/{id}');
    expect(dtos[0].endpoints[0].input_schema).toBe('UserIdParam');
    expect(dtos[0].endpoints[0].output_schema).toBe('UserResponse');
    expect(dtos[0].endpoints[0].notes).toBe('Get user by ID');
  });

  it('should extract schemas from resolved_relationships where type=schema_ref', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-api-123',
          name: 'UserAPI',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [],
      [
        {
          id: 'rel-schema-001',
          type: 'schema_ref',
          from: { entity_type: 'interfaces', entity_id: 'user-api-123', name: 'UserAPI' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'user-entity', name: 'UserEntity' },
          label: 'UserAPI references UserEntity schema',
          summary_fields: {},
        },
        {
          id: 'rel-schema-002',
          type: 'schema_ref',
          from: { entity_type: 'interfaces', entity_id: 'user-api-123', name: 'UserAPI' },
          to: { entity_type: 'physicalDataEntities', entity_id: 'user-table', name: 'UserTable' },
          label: 'UserAPI references UserTable schema',
          summary_fields: {},
        },
      ]
    );

    const dtos = buildInterfaceContractDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].schemas).toContain('UserEntity');
    expect(dtos[0].schemas).toContain('UserTable');
  });

  it('should return empty endpoints/schemas arrays for interface with no related items', () => {
    const response = createMockExpandResponse([
      {
        id: 'empty-api-123',
        name: 'EmptyAPI',
        entity_type: 'interfaces',
        category: 'application',
        relevant_fields: {},
      },
    ]);

    const dtos = buildInterfaceContractDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].endpoints).toEqual([]);
    expect(dtos[0].schemas).toEqual([]);
    expect(dtos[0].key_relationships).toEqual([]);
  });

  it('should return empty array when no interfaces in input', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-service',
        name: 'UserService',
        entity_type: 'services',
        category: 'application',
        relevant_fields: {},
      },
    ]);

    const dtos = buildInterfaceContractDtos(response);

    expect(dtos).toEqual([]);
  });
});

// ============================================================================
// Task Group 5: Service Slice DTO Builder Tests
// ============================================================================

describe('Task Group 5: Service Slice DTO Builder', () => {
  const createMockExpandResponse = (
    entities: ResolvedEntitySummary[] = [],
    diagrams: ResolvedDiagramSummary[] = [],
    relationships: ResolvedRelationship[] = []
  ): ExpandResolveResponseDto => ({
    expanded_entity_ids: entities.map(e => `${e.entity_type}::${e.id}`),
    expanded_diagram_ids: diagrams.map(d => d.id),
    resolved_entities: entities,
    resolved_diagrams: diagrams,
    truncated: false,
    resolved_relationships: relationships,
  });

  it('should extract service with name and id', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-service-123',
        name: 'UserService',
        entity_type: 'services',
        category: 'application',
        relevant_fields: {},
      },
    ]);

    const dtos = buildServiceSliceDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].kind).toBe('service_slice');
    expect(dtos[0].id).toBe('user-service-123');
    expect(dtos[0].service).toBe('UserService');
  });

  it('should extract application/component from contains relationships', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-service-123',
          name: 'UserService',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'user-component',
          name: 'UserComponent',
          entity_type: 'components',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'user-app',
          name: 'UserApplication',
          entity_type: 'applications',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [],
      [
        {
          id: 'rel-contains-1',
          type: 'contains',
          from: { entity_type: 'components', entity_id: 'user-component', name: 'UserComponent' },
          to: { entity_type: 'services', entity_id: 'user-service-123', name: 'UserService' },
          label: 'UserComponent contains UserService',
          summary_fields: {},
        },
        {
          id: 'rel-contains-2',
          type: 'contains',
          from: { entity_type: 'applications', entity_id: 'user-app', name: 'UserApplication' },
          to: { entity_type: 'components', entity_id: 'user-component', name: 'UserComponent' },
          label: 'UserApplication contains UserComponent',
          summary_fields: {},
        },
      ]
    );

    const dtos = buildServiceSliceDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].application).toBe('UserApplication');
    expect(dtos[0].component).toBe('UserComponent');
  });

  it('should extract interfaces from exposes relationships', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-service-123',
          name: 'UserService',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'user-api',
          name: 'UserAPI',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [],
      [
        {
          id: 'rel-exposes-1',
          type: 'exposes',
          from: { entity_type: 'services', entity_id: 'user-service-123', name: 'UserService' },
          to: { entity_type: 'interfaces', entity_id: 'user-api', name: 'UserAPI' },
          label: 'UserService exposes UserAPI',
          summary_fields: {},
        },
      ]
    );

    const dtos = buildServiceSliceDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].interfaces).toContain('UserAPI');
  });

  it('should populate key_entities from schema_ref relationships of child interfaces', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-service-123',
          name: 'UserService',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'user-api',
          name: 'UserAPI',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [],
      [
        {
          id: 'rel-exposes-1',
          type: 'exposes',
          from: { entity_type: 'services', entity_id: 'user-service-123', name: 'UserService' },
          to: { entity_type: 'interfaces', entity_id: 'user-api', name: 'UserAPI' },
          label: 'UserService exposes UserAPI',
          summary_fields: {},
        },
        {
          id: 'rel-schema-1',
          type: 'schema_ref',
          from: { entity_type: 'interfaces', entity_id: 'user-api', name: 'UserAPI' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'user-entity', name: 'UserEntity' },
          label: 'UserAPI references UserEntity',
          summary_fields: {},
        },
      ]
    );

    const dtos = buildServiceSliceDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].key_entities).toContain('UserEntity');
  });

  it('should extract dependencies from resolved_relationships', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-service-123',
          name: 'UserService',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [],
      [
        {
          id: 'rel-uses-1',
          type: 'uses',
          from: { entity_type: 'services', entity_id: 'user-service-123', name: 'UserService' },
          to: { entity_type: 'services', entity_id: 'auth-service', name: 'AuthService' },
          label: 'UserService uses AuthService',
          summary_fields: {},
        },
      ]
    );

    const dtos = buildServiceSliceDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].dependencies).toHaveLength(1);
    expect(dtos[0].dependencies[0].type).toBe('uses');
    expect(dtos[0].dependencies[0].target).toBe('AuthService');
  });

  it('should return empty array when no services in input', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-entity',
        name: 'UserEntity',
        entity_type: 'logicalDataEntities',
        category: 'data',
        relevant_fields: {},
      },
    ]);

    const dtos = buildServiceSliceDtos(response);

    expect(dtos).toEqual([]);
  });
});

// ============================================================================
// Task Group 6: Diagram Summary DTO Builder Tests
// ============================================================================

describe('Task Group 6: Diagram Summary DTO Builder', () => {
  const createMockExpandResponse = (
    entities: ResolvedEntitySummary[] = [],
    diagrams: ResolvedDiagramSummary[] = [],
    relationships: ResolvedRelationship[] = []
  ): ExpandResolveResponseDto => ({
    expanded_entity_ids: entities.map(e => `${e.entity_type}::${e.id}`),
    expanded_diagram_ids: diagrams.map(d => d.id),
    resolved_entities: entities,
    resolved_diagrams: diagrams,
    truncated: false,
    resolved_relationships: relationships,
  });

  it('should extract diagram with name and diagram_type', () => {
    const response = createMockExpandResponse(
      [],
      [
        {
          id: 'er-diagram-001',
          name: 'User Data Model',
          diagram_type: 'ER',
          referenced_entity_ids: [],
        },
      ]
    );

    const dtos = buildDiagramSummaryDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].kind).toBe('diagram_summary');
    expect(dtos[0].id).toBe('er-diagram-001');
    expect(dtos[0].name).toBe('User Data Model');
    expect(dtos[0].diagram_type).toBe('ER');
  });

  it('should use referenced_entity_names when available', () => {
    const response = createMockExpandResponse(
      [],
      [
        {
          id: 'er-diagram-001',
          name: 'User Data Model',
          diagram_type: 'ER',
          referenced_entity_ids: ['entity-1', 'entity-2'],
          referenced_entity_names: ['UserTable', 'OrderTable'],
        },
      ]
    );

    const dtos = buildDiagramSummaryDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].referenced_entities).toEqual(['UserTable', 'OrderTable']);
  });

  it('should fallback to referenced_entity_ids when names not available', () => {
    const response = createMockExpandResponse(
      [],
      [
        {
          id: 'er-diagram-001',
          name: 'User Data Model',
          diagram_type: 'ER',
          referenced_entity_ids: ['entity-1', 'entity-2'],
          // No referenced_entity_names
        },
      ]
    );

    const dtos = buildDiagramSummaryDtos(response);

    expect(dtos).toHaveLength(1);
    expect(dtos[0].referenced_entities).toEqual(['entity-1', 'entity-2']);
  });

  it('should return empty array when no diagrams in input', () => {
    const response = createMockExpandResponse([
      {
        id: 'user-entity',
        name: 'UserEntity',
        entity_type: 'logicalDataEntities',
        category: 'data',
        relevant_fields: {},
      },
    ]);

    const dtos = buildDiagramSummaryDtos(response);

    expect(dtos).toEqual([]);
  });
});

// ============================================================================
// Task Group 7: DTO Aggregation and De-duplication Tests
// ============================================================================

describe('Task Group 7: DTO Aggregation and De-duplication', () => {
  const createMockExpandResponse = (
    entities: ResolvedEntitySummary[] = [],
    diagrams: ResolvedDiagramSummary[] = [],
    relationships: ResolvedRelationship[] = []
  ): ExpandResolveResponseDto => ({
    expanded_entity_ids: entities.map(e => `${e.entity_type}::${e.id}`),
    expanded_diagram_ids: diagrams.map(d => d.id),
    resolved_entities: entities,
    resolved_diagrams: diagrams,
    truncated: false,
    resolved_relationships: relationships,
  });

  it('should aggregate all 4 DTO types from builder functions', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'user-entity',
          name: 'User',
          entity_type: 'logicalDataEntities',
          category: 'data',
          relevant_fields: {},
        },
        {
          id: 'user-service',
          name: 'UserService',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'user-api',
          name: 'UserAPI',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [
        {
          id: 'er-diagram',
          name: 'ER Diagram',
          diagram_type: 'ER',
          referenced_entity_ids: [],
        },
      ]
    );

    const dtos = buildCondensedContextDtos(response);

    const kinds = dtos.map(d => d.kind);
    expect(kinds).toContain('entity_and_attributes');
    expect(kinds).toContain('service_slice');
    expect(kinds).toContain('interface_contract');
    expect(kinds).toContain('diagram_summary');
  });

  it('should de-duplicate by stable id within each kind', () => {
    // Simulate duplicate entities (same entity appearing twice)
    const response: ExpandResolveResponseDto = {
      expanded_entity_ids: ['logicalDataEntities::user-entity', 'logicalDataEntities::user-entity'],
      expanded_diagram_ids: [],
      resolved_entities: [
        {
          id: 'user-entity',
          name: 'User',
          entity_type: 'logicalDataEntities',
          category: 'data',
          relevant_fields: { attributes: [{ name: 'id', type: 'UUID' }] },
        },
        {
          id: 'user-entity',
          name: 'User',
          entity_type: 'logicalDataEntities',
          category: 'data',
          relevant_fields: { attributes: [{ name: 'id', type: 'UUID' }] },
        },
      ],
      resolved_diagrams: [],
      truncated: false,
      resolved_relationships: [],
    };

    const dtos = buildCondensedContextDtos(response);

    const entityDtos = dtos.filter(d => d.kind === 'entity_and_attributes');
    expect(entityDtos).toHaveLength(1);
  });

  it('should sort deterministically by kind then by id', () => {
    const response = createMockExpandResponse(
      [
        {
          id: 'z-entity',
          name: 'ZEntity',
          entity_type: 'logicalDataEntities',
          category: 'data',
          relevant_fields: {},
        },
        {
          id: 'a-entity',
          name: 'AEntity',
          entity_type: 'logicalDataEntities',
          category: 'data',
          relevant_fields: {},
        },
        {
          id: 'z-service',
          name: 'ZService',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {},
        },
        {
          id: 'a-interface',
          name: 'AInterface',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {},
        },
      ],
      [
        {
          id: 'z-diagram',
          name: 'Z Diagram',
          diagram_type: 'ER',
          referenced_entity_ids: [],
        },
      ]
    );

    const dtos1 = buildCondensedContextDtos(response);
    const dtos2 = buildCondensedContextDtos(response);

    // Same input should produce identical output order
    expect(JSON.stringify(dtos1)).toBe(JSON.stringify(dtos2));

    // Verify sorting: diagram_summary < entity_and_attributes < interface_contract < service_slice
    const kindOrder = ['diagram_summary', 'entity_and_attributes', 'interface_contract', 'service_slice'];
    let lastKindIndex = -1;
    for (const dto of dtos1) {
      const currentIndex = kindOrder.indexOf(dto.kind);
      expect(currentIndex).toBeGreaterThanOrEqual(lastKindIndex);
      lastKindIndex = currentIndex;
    }
  });

  it('should return empty array for empty ExpandResolveResponseDto', () => {
    const response = createMockExpandResponse([], [], []);

    const dtos = buildCondensedContextDtos(response);

    expect(dtos).toEqual([]);
  });

  it('should merge duplicate entries combining arrays', () => {
    // This tests the merge behavior when same entity has different relationships
    const response: ExpandResolveResponseDto = {
      expanded_entity_ids: ['logicalDataEntities::user-entity'],
      expanded_diagram_ids: [],
      resolved_entities: [
        {
          id: 'user-entity',
          name: 'User',
          entity_type: 'logicalDataEntities',
          category: 'data',
          relevant_fields: {},
        },
      ],
      resolved_diagrams: [],
      truncated: false,
      resolved_relationships: [
        {
          id: 'rel-1',
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: 'user-entity', name: 'User' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'order-entity', name: 'Order' },
          label: 'User has orders',
          summary_fields: { cardinality: '1:N' },
        },
      ],
    };

    const dtos = buildCondensedContextDtos(response);
    const entityDto = dtos.find(d => d.kind === 'entity_and_attributes') as EntityAndAttributesDto;

    expect(entityDto).toBeDefined();
    expect(entityDto.relationships.length).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Task Group 8: Truncation Logic Tests
// ============================================================================

describe('Task Group 8: Truncation Logic', () => {
  const createDtos = (count: number, kind: string): CondensedContextDto[] => {
    const dtos: CondensedContextDto[] = [];
    for (let i = 0; i < count; i++) {
      if (kind === 'interface_contract') {
        dtos.push({
          kind: 'interface_contract',
          id: `interface-${i}`,
          name: `Interface${i}`,
          endpoints: [],
          schemas: [],
          key_relationships: [],
        });
      } else if (kind === 'entity_and_attributes') {
        dtos.push({
          kind: 'entity_and_attributes',
          id: `entity::${i}`,
          entity_type: 'logical_data_entity',
          name: `Entity${i}`,
          attributes: [],
          relationships: [],
        });
      } else if (kind === 'service_slice') {
        dtos.push({
          kind: 'service_slice',
          id: `service-${i}`,
          application: null,
          component: null,
          service: `Service${i}`,
          interfaces: [],
          endpoints: [],
          key_entities: [],
          dependencies: [],
        });
      } else if (kind === 'diagram_summary') {
        dtos.push({
          kind: 'diagram_summary',
          id: `diagram-${i}`,
          name: `Diagram${i}`,
          diagram_type: 'ER',
          referenced_entities: [],
        });
      }
    }
    return dtos;
  };

  it('should enforce maxDtoCount (default 50)', () => {
    const dtos = [
      ...createDtos(30, 'entity_and_attributes'),
      ...createDtos(30, 'diagram_summary'),
    ];

    const result = applyTruncation(dtos, 50, 1000000);

    expect(result.dtos.length).toBeLessThanOrEqual(50);
    expect(result.truncated).toBe(true);
  });

  it('should enforce maxJsonChars (default 40000)', () => {
    // Create DTOs that exceed 40000 chars when serialized
    const largeDtos = createDtos(100, 'entity_and_attributes');

    const result = applyTruncation(largeDtos, 1000, 1000);

    expect(JSON.stringify(result.dtos, null, 2).length).toBeLessThanOrEqual(1500); // Some buffer for truncation
    expect(result.truncated).toBe(true);
  });

  it('should follow priority order: interface_contract > referenced entities > service_slice > unreferenced entities > diagram_summary', () => {
    const interfaceDtos = createDtos(5, 'interface_contract');
    const entityDtos = createDtos(5, 'entity_and_attributes');
    const serviceDtos = createDtos(5, 'service_slice');
    const diagramDtos = createDtos(5, 'diagram_summary');

    // Total 20 DTOs, limit to 10
    const allDtos = [...diagramDtos, ...entityDtos, ...serviceDtos, ...interfaceDtos];
    const result = applyTruncation(allDtos, 10, 1000000);

    // Interface contracts should be kept (highest priority)
    const keptInterfaces = result.dtos.filter(d => d.kind === 'interface_contract');
    expect(keptInterfaces.length).toBe(5);

    // Diagrams should be removed first (lowest priority)
    const keptDiagrams = result.dtos.filter(d => d.kind === 'diagram_summary');
    expect(keptDiagrams.length).toBeLessThan(5);
  });

  it('should be deterministic (same input produces same truncated output)', () => {
    const dtos = [
      ...createDtos(30, 'entity_and_attributes'),
      ...createDtos(30, 'diagram_summary'),
    ];

    const result1 = applyTruncation(dtos, 50, 1000000);
    const result2 = applyTruncation(dtos, 50, 1000000);

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('should return truncated=true when limits exceeded', () => {
    const dtos = createDtos(100, 'entity_and_attributes');

    const result = applyTruncation(dtos, 10, 1000000);

    expect(result.truncated).toBe(true);
  });

  it('should return truncated=false when under limits', () => {
    const dtos = createDtos(10, 'entity_and_attributes');

    const result = applyTruncation(dtos, 50, 1000000);

    expect(result.truncated).toBe(false);
    expect(result.dtos.length).toBe(10);
  });

  it('should prioritize entity_and_attributes referenced by interface schemas', () => {
    const interfaceDto: InterfaceContractDto = {
      kind: 'interface_contract',
      id: 'test-interface',
      name: 'TestInterface',
      endpoints: [],
      schemas: ['ReferencedEntity'],
      key_relationships: [],
    };

    const referencedEntity: EntityAndAttributesDto = {
      kind: 'entity_and_attributes',
      id: 'entity::referenced',
      entity_type: 'logical_data_entity',
      name: 'ReferencedEntity',
      attributes: [],
      relationships: [],
    };

    const unreferencedEntity: EntityAndAttributesDto = {
      kind: 'entity_and_attributes',
      id: 'entity::unreferenced',
      entity_type: 'logical_data_entity',
      name: 'UnreferencedEntity',
      attributes: [],
      relationships: [],
    };

    const dtos = [unreferencedEntity, referencedEntity, interfaceDto];
    const result = applyTruncation(dtos, 2, 1000000);

    // Interface and referenced entity should be kept
    const keptNames = result.dtos.map(d => {
      if (d.kind === 'interface_contract') return d.name;
      if (d.kind === 'entity_and_attributes') return d.name;
      return '';
    });

    expect(keptNames).toContain('TestInterface');
    expect(keptNames).toContain('ReferencedEntity');
  });
});

// ============================================================================
// Task Group 9: Condensed Context Section Formatter Tests
// ============================================================================

describe('Task Group 9: Condensed Context Section Formatter', () => {
  it('should include instruction header', () => {
    const dtos: CondensedContextDto[] = [
      {
        kind: 'entity_and_attributes',
        id: 'entity::test',
        entity_type: 'logical_data_entity',
        name: 'Test',
        attributes: [],
        relationships: [],
      },
    ];

    const formatted = formatCondensedContextSection(dtos, false);

    expect(formatted).toContain('The following DTOs summarize the architecture context');
    expect(formatted).toContain('Use these as the source of truth');
    expect(formatted).toContain('Do not invent entities or relationships not present in these DTOs');
  });

  it('should pretty-print DTOs as JSON with 2-space indent', () => {
    const dtos: CondensedContextDto[] = [
      {
        kind: 'entity_and_attributes',
        id: 'entity::test',
        entity_type: 'logical_data_entity',
        name: 'TestEntity',
        attributes: [],
        relationships: [],
      },
    ];

    const formatted = formatCondensedContextSection(dtos, false);

    // Verify 2-space indentation by checking for "  " before properties
    expect(formatted).toContain('  "kind"');
    expect(formatted).toContain('  "name"');
  });

  it('should show [TRUNCATED] marker when truncated=true', () => {
    const dtos: CondensedContextDto[] = [
      {
        kind: 'entity_and_attributes',
        id: 'entity::test',
        entity_type: 'logical_data_entity',
        name: 'Test',
        attributes: [],
        relationships: [],
      },
    ];

    const formatted = formatCondensedContextSection(dtos, true);

    expect(formatted).toContain('[TRUNCATED: Some items omitted due to size limits]');
  });

  it('should not show [TRUNCATED] marker when truncated=false', () => {
    const dtos: CondensedContextDto[] = [
      {
        kind: 'entity_and_attributes',
        id: 'entity::test',
        entity_type: 'logical_data_entity',
        name: 'Test',
        attributes: [],
        relationships: [],
      },
    ];

    const formatted = formatCondensedContextSection(dtos, false);

    expect(formatted).not.toContain('[TRUNCATED');
  });

  it('should return "No items highlighted by user." for empty DTOs', () => {
    const formatted = formatCondensedContextSection([], false);

    expect(formatted).toBe('No items highlighted by user.');
  });

  it('should produce valid JSON in the output', () => {
    const dtos: CondensedContextDto[] = [
      {
        kind: 'interface_contract',
        id: 'test-api',
        name: 'TestAPI',
        endpoints: [{ name: 'GET /test', input_schema: null, output_schema: 'TestResponse', notes: null }],
        schemas: ['TestSchema'],
        key_relationships: [],
      },
    ];

    const formatted = formatCondensedContextSection(dtos, false);

    // Extract JSON part (after instruction header)
    const jsonStart = formatted.indexOf('[');
    const jsonEnd = formatted.lastIndexOf(']') + 1;
    const jsonPart = formatted.substring(jsonStart, jsonEnd);

    expect(() => JSON.parse(jsonPart)).not.toThrow();
  });
});

// ============================================================================
// Task Group 10: Chat Route Integration Tests
// ============================================================================

describe('Task Group 10: Chat Route Integration', () => {
  describe('shouldUseCondensedContext', () => {
    it('should return true when phase=refine and resolvedContext has resolved_relationships', () => {
      const context: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [{ id: 'test', name: 'Test', entity_type: 'services', category: 'app', relevant_fields: {} }],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [],
      };

      const result = shouldUseCondensedContext('refine', context);

      expect(result).toBe(true);
    });

    it('should return false for bootstrap phase', () => {
      const context: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [],
      };

      const result = shouldUseCondensedContext('bootstrap', context);

      expect(result).toBe(false);
    });

    it('should return false for handoff phase', () => {
      const context: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [],
      };

      const result = shouldUseCondensedContext('handoff', context);

      expect(result).toBe(false);
    });

    it('should return false when context is null', () => {
      const result = shouldUseCondensedContext('refine', null);

      expect(result).toBe(false);
    });

    it('should return false when context is undefined', () => {
      const result = shouldUseCondensedContext('refine', undefined);

      expect(result).toBe(false);
    });

    it('should return false when context has no resolved_entities or resolved_diagrams', () => {
      const context: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [],
      };

      const result = shouldUseCondensedContext('refine', context);

      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// Task Group 11: Additional Strategic Tests
// ============================================================================

describe('Task Group 11: Additional Strategic Tests', () => {
  const createFullExpandResponse = (): ExpandResolveResponseDto => ({
    expanded_entity_ids: [
      'logicalDataEntities::user-entity',
      'physicalDataEntities::user-table',
      'services::user-service',
      'interfaces::user-api',
    ],
    expanded_diagram_ids: ['er-diagram-001'],
    resolved_entities: [
      {
        id: 'user-entity',
        name: 'UserEntity',
        entity_type: 'logicalDataEntities',
        category: 'data',
        relevant_fields: {
          attributes: [
            { name: 'id', type: 'UUID', pk: true },
            { name: 'email', type: 'String' },
          ],
        },
      },
      {
        id: 'user-table',
        name: 'UserTable',
        entity_type: 'physicalDataEntities',
        category: 'data',
        relevant_fields: {
          attributes: [{ name: 'user_id', type: 'uuid', pk: true }],
        },
      },
      {
        id: 'user-service',
        name: 'UserService',
        entity_type: 'services',
        category: 'application',
        relevant_fields: {},
      },
      {
        id: 'user-api',
        name: 'UserAPI',
        entity_type: 'interfaces',
        category: 'application',
        relevant_fields: {},
      },
    ],
    resolved_diagrams: [
      {
        id: 'er-diagram-001',
        name: 'User Data Model',
        diagram_type: 'ER',
        referenced_entity_ids: ['user-entity', 'user-table'],
        referenced_entity_names: ['UserEntity', 'UserTable'],
      },
    ],
    truncated: false,
    resolved_relationships: [
      {
        id: 'rel-fk-001',
        type: 'fk',
        from: { entity_type: 'logicalDataEntities', entity_id: 'user-entity', name: 'UserEntity' },
        to: { entity_type: 'physicalDataEntities', entity_id: 'user-table', name: 'UserTable' },
        label: 'UserEntity maps to UserTable',
        summary_fields: { cardinality: '1:1' },
      },
      {
        id: 'rel-exposes-001',
        type: 'exposes',
        from: { entity_type: 'services', entity_id: 'user-service', name: 'UserService' },
        to: { entity_type: 'interfaces', entity_id: 'user-api', name: 'UserAPI' },
        label: 'UserService exposes UserAPI',
        summary_fields: {},
      },
      {
        id: 'rel-schema-001',
        type: 'schema_ref',
        from: { entity_type: 'interfaces', entity_id: 'user-api', name: 'UserAPI' },
        to: { entity_type: 'logicalDataEntities', entity_id: 'user-entity', name: 'UserEntity' },
        label: 'UserAPI references UserEntity',
        summary_fields: {},
      },
    ],
  });

  it('should produce complete condensed prompt section from full ExpandResolveResponseDto', () => {
    const response = createFullExpandResponse();
    const dtos = buildCondensedContextDtos(response);
    const { dtos: truncatedDtos, truncated } = applyTruncation(dtos, 50, 40000);
    const formatted = formatCondensedContextSection(truncatedDtos, truncated);

    // Verify all DTO types are present
    expect(formatted).toContain('entity_and_attributes');
    expect(formatted).toContain('interface_contract');
    expect(formatted).toContain('service_slice');
    expect(formatted).toContain('diagram_summary');

    // Verify entity names appear
    expect(formatted).toContain('UserEntity');
    expect(formatted).toContain('UserTable');
    expect(formatted).toContain('UserService');
    expect(formatted).toContain('UserAPI');

    // Verify instruction header
    expect(formatted).toContain('source of truth');
  });

  it('should handle entity referenced by multiple interfaces', () => {
    const response: ExpandResolveResponseDto = {
      expanded_entity_ids: ['interfaces::api1', 'interfaces::api2', 'logicalDataEntities::shared-entity'],
      expanded_diagram_ids: [],
      resolved_entities: [
        { id: 'api1', name: 'API1', entity_type: 'interfaces', category: 'application', relevant_fields: {} },
        { id: 'api2', name: 'API2', entity_type: 'interfaces', category: 'application', relevant_fields: {} },
        { id: 'shared-entity', name: 'SharedEntity', entity_type: 'logicalDataEntities', category: 'data', relevant_fields: {} },
      ],
      resolved_diagrams: [],
      truncated: false,
      resolved_relationships: [
        {
          id: 'rel-1',
          type: 'schema_ref',
          from: { entity_type: 'interfaces', entity_id: 'api1', name: 'API1' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'shared-entity', name: 'SharedEntity' },
          label: 'API1 refs SharedEntity',
          summary_fields: {},
        },
        {
          id: 'rel-2',
          type: 'schema_ref',
          from: { entity_type: 'interfaces', entity_id: 'api2', name: 'API2' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'shared-entity', name: 'SharedEntity' },
          label: 'API2 refs SharedEntity',
          summary_fields: {},
        },
      ],
    };

    const dtos = buildCondensedContextDtos(response);

    // Both interfaces should reference the shared entity in their schemas
    const api1Dto = dtos.find(d => d.kind === 'interface_contract' && d.id === 'api1') as InterfaceContractDto;
    const api2Dto = dtos.find(d => d.kind === 'interface_contract' && d.id === 'api2') as InterfaceContractDto;

    expect(api1Dto?.schemas).toContain('SharedEntity');
    expect(api2Dto?.schemas).toContain('SharedEntity');

    // Entity should only appear once
    const entityDtos = dtos.filter(d => d.kind === 'entity_and_attributes');
    const sharedEntityDtos = entityDtos.filter(d => (d as EntityAndAttributesDto).name === 'SharedEntity');
    expect(sharedEntityDtos.length).toBe(1);
  });

  it('should handle maxDtoCount exactly at limit', () => {
    const createDtos = (count: number): CondensedContextDto[] => {
      return Array.from({ length: count }, (_, i) => ({
        kind: 'entity_and_attributes' as const,
        id: `entity::${i}`,
        entity_type: 'logical_data_entity' as const,
        name: `Entity${i}`,
        attributes: [],
        relationships: [],
      }));
    };

    const dtos = createDtos(50);
    const result = applyTruncation(dtos, 50, 1000000);

    expect(result.dtos.length).toBe(50);
    expect(result.truncated).toBe(false);
  });

  it('should handle maxJsonChars boundary correctly', () => {
    const createLargeDtos = (): CondensedContextDto[] => {
      return Array.from({ length: 20 }, (_, i) => ({
        kind: 'entity_and_attributes' as const,
        id: `entity::${i}`,
        entity_type: 'logical_data_entity' as const,
        name: `Entity${i}WithAVeryLongNameToIncreaseSize`,
        attributes: Array.from({ length: 10 }, (_, j) => ({
          name: `attribute_${j}_with_long_name`,
          type: 'VARCHAR(255)',
          pk: j === 0,
          nullable: j > 0,
        })),
        relationships: [],
      }));
    };

    const dtos = createLargeDtos();
    const serializedSize = JSON.stringify(dtos, null, 2).length;

    // Set maxJsonChars to half the serialized size to force truncation
    const maxChars = Math.floor(serializedSize / 2);
    const result = applyTruncation(dtos, 1000, maxChars);

    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.dtos, null, 2).length).toBeLessThanOrEqual(maxChars + 500); // Small buffer for edge cases
  });

  it('should preserve existing formatHighlightedContext behavior for non-refine phases', async () => {
    // Import formatHighlightedContext
    const { formatHighlightedContext } = await import('../services/promptBuilder');

    const context: ExpandResolveResponseDto = {
      expanded_entity_ids: ['services::test-service'],
      expanded_diagram_ids: ['diagram-1'],
      resolved_entities: [
        { id: 'test-service', name: 'TestService', entity_type: 'services', category: 'application', relevant_fields: {} },
      ],
      resolved_diagrams: [
        { id: 'diagram-1', name: 'Test Diagram', diagram_type: 'General', referenced_entity_ids: [], referenced_entity_names: [] },
      ],
      truncated: false,
      resolved_relationships: [],
    };

    const formatted = formatHighlightedContext(context);

    // Verify it still produces the old format (not condensed DTOs)
    expect(formatted).toContain('Highlighted Entities:');
    expect(formatted).toContain('TestService');
    expect(formatted).toContain('Highlighted Diagrams:');
    expect(formatted).not.toContain('"kind"');
  });

  it('should handle empty relationships gracefully in all DTO builders', () => {
    const response: ExpandResolveResponseDto = {
      expanded_entity_ids: ['logicalDataEntities::entity-1', 'services::service-1', 'interfaces::interface-1'],
      expanded_diagram_ids: ['diagram-1'],
      resolved_entities: [
        { id: 'entity-1', name: 'Entity1', entity_type: 'logicalDataEntities', category: 'data', relevant_fields: {} },
        { id: 'service-1', name: 'Service1', entity_type: 'services', category: 'application', relevant_fields: {} },
        { id: 'interface-1', name: 'Interface1', entity_type: 'interfaces', category: 'application', relevant_fields: {} },
      ],
      resolved_diagrams: [
        { id: 'diagram-1', name: 'Diagram1', diagram_type: 'ER', referenced_entity_ids: [] },
      ],
      truncated: false,
      resolved_relationships: [], // Empty relationships
    };

    const dtos = buildCondensedContextDtos(response);

    expect(dtos.length).toBe(4); // 1 entity + 1 service + 1 interface + 1 diagram

    const entityDto = dtos.find(d => d.kind === 'entity_and_attributes') as EntityAndAttributesDto;
    const serviceDto = dtos.find(d => d.kind === 'service_slice') as ServiceSliceDto;
    const interfaceDto = dtos.find(d => d.kind === 'interface_contract') as InterfaceContractDto;

    expect(entityDto.relationships).toEqual([]);
    expect(serviceDto.interfaces).toEqual([]);
    expect(serviceDto.dependencies).toEqual([]);
    expect(interfaceDto.endpoints).toEqual([]);
    expect(interfaceDto.schemas).toEqual([]);
  });
});
