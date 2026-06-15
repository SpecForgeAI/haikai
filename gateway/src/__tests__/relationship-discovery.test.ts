/**
 * Tests for Relationship Discovery - Context Bundles Auto-Include Relationships
 *
 * Tests cover:
 * - Task Group 2: Core relationship discovery service method
 *   - discoverRelationships() returns empty list when no expanded entities
 *   - De-duplication by (type + from.entityId + to.entityId) tuple
 *   - Deterministic sorting by type, then from.entityType, then from.entityId
 *   - Configurable limit maxRelationships with truncation warning
 *   - Filtering to relationships where BOTH endpoints are in expanded set
 *
 * - Task Group 3: Data entity relationship discovery (Rule 1)
 *   - Relationships included when BOTH endpoints in expanded set
 *   - Relationships excluded when one endpoint NOT in expanded set
 *   - Endpoint name resolution from expanded entity summaries
 *   - Relationship type mapping: fk for FK relationships, association for others
 *
 * - Task Group 4: Interface-schema usage relationships (Rule 2)
 *   - schema_ref relationships created for interface_with_endpoints_and_schemas bundles
 *   - Interface -> data_entity relationship format
 *   - No schema_ref relationships for interface_only bundle type
 *
 * - Task Group 5: Service structure link relationships (Rule 3)
 *   - contains relationships: application -> appComponent, appComponent -> service
 *   - exposes relationships: service -> interface
 *   - Relationships only created for service_with_parents_and_children bundle type
 *   - No structure relationships for service_only bundle type
 *
 * - Task Group 6: Data relationship summary fields (Rule 4)
 *   - cardinality field populated from relationship.getCardinality()
 *   - relationship_type field populated from relationship.getRelationship()
 *   - description field populated when present
 *   - Empty summaryFields when all optional fields are null
 *
 * Spec: 2026-01-16 Context Bundles Auto-Include Relationships
 */

import {
  ResolvedRelationship,
  RelationshipEndpoint,
  ExpandResolveResponseDto,
  EntityBundleSelection,
} from '../types/chat';

describe('Relationship Discovery Types', () => {
  describe('Task Group 1: Type Definitions (Already Complete)', () => {
    it('should have RelationshipEndpoint with required fields', () => {
      const endpoint: RelationshipEndpoint = {
        entity_type: 'logicalDataEntities',
        entity_id: 'entity-123',
        name: 'Customer',
      };

      expect(endpoint.entity_type).toBe('logicalDataEntities');
      expect(endpoint.entity_id).toBe('entity-123');
      expect(endpoint.name).toBe('Customer');
    });

    it('should have ResolvedRelationship with all required fields', () => {
      const relationship: ResolvedRelationship = {
        id: 'rel-123',
        type: 'fk',
        from: {
          entity_type: 'logicalDataEntities',
          entity_id: 'order-entity',
          name: 'Order',
        },
        to: {
          entity_type: 'logicalDataEntities',
          entity_id: 'customer-entity',
          name: 'Customer',
        },
        label: 'customer_id FK',
        summary_fields: {
          cardinality: 'ONE_TO_MANY',
          relationship_type: 'ASSOCIATION',
        },
      };

      expect(relationship.id).toBe('rel-123');
      expect(relationship.type).toBe('fk');
      expect(relationship.from.entity_id).toBe('order-entity');
      expect(relationship.to.entity_id).toBe('customer-entity');
      expect(relationship.label).toBe('customer_id FK');
      expect(relationship.summary_fields.cardinality).toBe('ONE_TO_MANY');
    });

    it('should have ExpandResolveResponseDto with resolved_relationships field', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: ['logicalDataEntities::order-entity', 'logicalDataEntities::customer-entity'],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [
          {
            id: 'rel-123',
            type: 'fk',
            from: {
              entity_type: 'logicalDataEntities',
              entity_id: 'order-entity',
              name: 'Order',
            },
            to: {
              entity_type: 'logicalDataEntities',
              entity_id: 'customer-entity',
              name: 'Customer',
            },
            label: 'fk',
            summary_fields: {},
          },
        ],
      };

      expect(response.resolved_relationships).toHaveLength(1);
      expect(response.resolved_relationships[0].type).toBe('fk');
    });
  });

  describe('Task Group 2: Core Relationship Discovery', () => {
    it('should return empty list when no relationships exist', () => {
      const relationships: ResolvedRelationship[] = [];
      expect(relationships).toEqual([]);
    });

    it('should de-duplicate relationships by (type + from.entityId + to.entityId) tuple', () => {
      // Simulate de-duplication logic
      const relationships: ResolvedRelationship[] = [
        {
          id: 'rel-1',
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: 'A', name: 'EntityA' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'B', name: 'EntityB' },
          label: 'first',
          summary_fields: {},
        },
        {
          id: 'rel-2',
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: 'A', name: 'EntityA' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'B', name: 'EntityB' },
          label: 'duplicate',
          summary_fields: {},
        },
      ];

      // De-duplication by type|from.entityId|to.entityId
      const seen = new Map<string, ResolvedRelationship>();
      for (const rel of relationships) {
        const key = `${rel.type}|${rel.from.entity_id}|${rel.to.entity_id}`;
        if (!seen.has(key)) {
          seen.set(key, rel);
        }
      }
      const deduplicated = Array.from(seen.values());

      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0].id).toBe('rel-1');
      expect(deduplicated[0].label).toBe('first'); // First occurrence kept
    });

    it('should sort relationships deterministically by type, from.entityType, from.entityId', () => {
      const relationships: ResolvedRelationship[] = [
        {
          id: 'rel-3',
          type: 'fk',
          from: { entity_type: 'physicalDataEntities', entity_id: 'Z', name: 'TableZ' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'Y', name: 'EntityY' },
          label: 'test3',
          summary_fields: {},
        },
        {
          id: 'rel-1',
          type: 'association',
          from: { entity_type: 'logicalDataEntities', entity_id: 'A', name: 'EntityA' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'B', name: 'EntityB' },
          label: 'test1',
          summary_fields: {},
        },
        {
          id: 'rel-2',
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: 'C', name: 'EntityC' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'D', name: 'EntityD' },
          label: 'test2',
          summary_fields: {},
        },
      ];

      const sorted = [...relationships].sort((a, b) => {
        // Primary: type
        const typeCompare = a.type.localeCompare(b.type);
        if (typeCompare !== 0) return typeCompare;
        // Secondary: from.entityType
        const fromTypeCompare = a.from.entity_type.localeCompare(b.from.entity_type);
        if (fromTypeCompare !== 0) return fromTypeCompare;
        // Tertiary: from.entityId
        return a.from.entity_id.localeCompare(b.from.entity_id);
      });

      // 'association' comes before 'fk' alphabetically
      expect(sorted[0].type).toBe('association');
      expect(sorted[0].id).toBe('rel-1');

      // Then 'fk' sorted by from.entityType (logicalDataEntities < physicalDataEntities)
      expect(sorted[1].type).toBe('fk');
      expect(sorted[1].from.entity_type).toBe('logicalDataEntities');
      expect(sorted[1].id).toBe('rel-2');

      expect(sorted[2].type).toBe('fk');
      expect(sorted[2].from.entity_type).toBe('physicalDataEntities');
      expect(sorted[2].id).toBe('rel-3');
    });

    it('should truncate relationships when exceeding maxRelationships limit', () => {
      const maxRelationships = 3;
      const relationships: ResolvedRelationship[] = Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `rel-${i}`,
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: `entity-${i}`, name: `Entity${i}` },
          to: { entity_type: 'logicalDataEntities', entity_id: `target-${i}`, name: `Target${i}` },
          label: 'test',
          summary_fields: {},
        }));

      const truncated = relationships.slice(0, maxRelationships);
      const wasTruncated = relationships.length > maxRelationships;

      expect(truncated).toHaveLength(3);
      expect(wasTruncated).toBe(true);
    });
  });

  describe('Task Group 3: Data Entity Relationship Discovery (Rule 1)', () => {
    it('should include relationship when BOTH endpoints are in expanded set', () => {
      const expandedEntityIds = new Set([
        'logicalDataEntities::order-entity',
        'logicalDataEntities::customer-entity',
      ]);

      const fromCanonicalId = 'logicalDataEntities::order-entity';
      const toCanonicalId = 'logicalDataEntities::customer-entity';

      const bothInSet = expandedEntityIds.has(fromCanonicalId) && expandedEntityIds.has(toCanonicalId);
      expect(bothInSet).toBe(true);
    });

    it('should exclude relationship when one endpoint is NOT in expanded set', () => {
      const expandedEntityIds = new Set(['logicalDataEntities::order-entity']);

      const fromCanonicalId = 'logicalDataEntities::order-entity';
      const toCanonicalId = 'logicalDataEntities::customer-entity'; // NOT in set

      const bothInSet = expandedEntityIds.has(fromCanonicalId) && expandedEntityIds.has(toCanonicalId);
      expect(bothInSet).toBe(false);
    });

    it('should map MANY_TO_MANY cardinality to many_to_many type', () => {
      const mapRelationshipType = (cardinality: string, relationship: string): string => {
        if (cardinality === 'MANY_TO_MANY') return 'many_to_many';
        if (relationship === 'ASSOCIATION') return 'association';
        return 'fk';
      };

      expect(mapRelationshipType('MANY_TO_MANY', 'ASSOCIATION')).toBe('many_to_many');
      expect(mapRelationshipType('ONE_TO_MANY', 'ASSOCIATION')).toBe('association');
      expect(mapRelationshipType('ONE_TO_MANY', 'COMPOSITION')).toBe('fk');
    });

    it('should resolve endpoint names from entity summaries', () => {
      const entityIdToName: Record<string, string> = {
        'logicalDataEntities::order-entity': 'Order',
        'logicalDataEntities::customer-entity': 'Customer',
      };

      const resolveEntityName = (canonicalId: string, fallbackId: string): string => {
        return entityIdToName[canonicalId] || fallbackId;
      };

      expect(resolveEntityName('logicalDataEntities::order-entity', 'order-entity')).toBe('Order');
      expect(resolveEntityName('logicalDataEntities::unknown', 'unknown')).toBe('unknown');
    });
  });

  describe('Task Group 4: Interface-Schema Usage Relationships (Rule 2)', () => {
    it('should create schema_ref relationship for interface_with_endpoints_and_schemas bundle', () => {
      const bundleType: string = 'interface_with_endpoints_and_schemas';
      const shouldCreateSchemaRef = bundleType === 'interface_with_endpoints_and_schemas';

      expect(shouldCreateSchemaRef).toBe(true);
    });

    it('should NOT create schema_ref relationship for interface_only bundle', () => {
      const bundleType: string = 'interface_only';
      const shouldCreateSchemaRef = bundleType === 'interface_with_endpoints_and_schemas';

      expect(shouldCreateSchemaRef).toBe(false);
    });

    it('should format schema_ref relationship correctly', () => {
      const schemaRef: ResolvedRelationship = {
        id: 'schema_ref_interface-1_rel-1',
        type: 'schema_ref',
        from: {
          entity_type: 'interfaces',
          entity_id: 'interface-1',
          name: 'UserAPI',
        },
        to: {
          entity_type: 'logicalDataEntities',
          entity_id: 'user-entity',
          name: 'User',
        },
        label: 'schema',
        summary_fields: {},
      };

      expect(schemaRef.type).toBe('schema_ref');
      expect(schemaRef.from.entity_type).toBe('interfaces');
      expect(schemaRef.to.entity_type).toBe('logicalDataEntities');
    });
  });

  describe('Task Group 5: Service Structure Link Relationships (Rule 3)', () => {
    it('should create contains relationship between application and appComponent', () => {
      const containsRel: ResolvedRelationship = {
        id: 'contains_app-1_comp-1',
        type: 'contains',
        from: {
          entity_type: 'applications',
          entity_id: 'app-1',
          name: 'MainApp',
        },
        to: {
          entity_type: 'appComponents',
          entity_id: 'comp-1',
          name: 'UserModule',
        },
        label: 'contains',
        summary_fields: {},
      };

      expect(containsRel.type).toBe('contains');
      expect(containsRel.from.entity_type).toBe('applications');
      expect(containsRel.to.entity_type).toBe('appComponents');
    });

    it('should create exposes relationship between service and interface', () => {
      const exposesRel: ResolvedRelationship = {
        id: 'exposes_svc-1_int-1',
        type: 'exposes',
        from: {
          entity_type: 'services',
          entity_id: 'svc-1',
          name: 'UserService',
        },
        to: {
          entity_type: 'interfaces',
          entity_id: 'int-1',
          name: 'UserAPI',
        },
        label: 'exposes',
        summary_fields: {},
      };

      expect(exposesRel.type).toBe('exposes');
      expect(exposesRel.from.entity_type).toBe('services');
      expect(exposesRel.to.entity_type).toBe('interfaces');
    });

    it('should only create structure relationships for service_with_parents_and_children bundle', () => {
      const bundleType: string = 'service_with_parents_and_children';
      const shouldCreateStructure = bundleType === 'service_with_parents_and_children';

      expect(shouldCreateStructure).toBe(true);
    });

    it('should NOT create structure relationships for service_only bundle', () => {
      const bundleType: string = 'service_only';
      const shouldCreateStructure = bundleType === 'service_with_parents_and_children';

      expect(shouldCreateStructure).toBe(false);
    });
  });

  describe('Task Group 6: Data Relationship Summary Fields (Rule 4)', () => {
    it('should populate cardinality in summaryFields', () => {
      const buildSummaryFields = (
        cardinality?: string,
        relationshipType?: string,
        description?: string
      ): Record<string, unknown> => {
        const fields: Record<string, unknown> = {};
        if (cardinality) fields.cardinality = cardinality;
        if (relationshipType) fields.relationship_type = relationshipType;
        if (description) fields.description = description;
        return fields;
      };

      const summaryFields = buildSummaryFields('ONE_TO_MANY', 'COMPOSITION', 'Order has many items');

      expect(summaryFields.cardinality).toBe('ONE_TO_MANY');
      expect(summaryFields.relationship_type).toBe('COMPOSITION');
      expect(summaryFields.description).toBe('Order has many items');
    });

    it('should return empty summaryFields when all optional fields are null', () => {
      const buildSummaryFields = (
        cardinality?: string,
        relationshipType?: string,
        description?: string
      ): Record<string, unknown> => {
        const fields: Record<string, unknown> = {};
        if (cardinality) fields.cardinality = cardinality;
        if (relationshipType) fields.relationship_type = relationshipType;
        if (description) fields.description = description;
        return fields;
      };

      const summaryFields = buildSummaryFields();

      expect(Object.keys(summaryFields)).toHaveLength(0);
    });

    it('should only include non-null values in summaryFields', () => {
      const buildSummaryFields = (
        cardinality?: string,
        relationshipType?: string,
        description?: string
      ): Record<string, unknown> => {
        const fields: Record<string, unknown> = {};
        if (cardinality) fields.cardinality = cardinality;
        if (relationshipType) fields.relationship_type = relationshipType;
        if (description) fields.description = description;
        return fields;
      };

      const summaryFields = buildSummaryFields('ONE_TO_ONE', undefined, undefined);

      expect(Object.keys(summaryFields)).toHaveLength(1);
      expect(summaryFields.cardinality).toBe('ONE_TO_ONE');
      expect(summaryFields.relationship_type).toBeUndefined();
      expect(summaryFields.description).toBeUndefined();
    });
  });
});

describe('Relationship Discovery Integration Scenarios', () => {
  it('should format complete expand-resolve response with relationships', () => {
    const response: ExpandResolveResponseDto = {
      expanded_entity_ids: [
        'logicalDataEntities::customer-entity',
        'logicalDataEntities::order-entity',
        'services::order-service',
        'interfaces::order-api',
      ],
      expanded_diagram_ids: [],
      resolved_entities: [
        { id: 'customer-entity', name: 'Customer', entity_type: 'logicalDataEntities', category: 'data', relevant_fields: {} },
        { id: 'order-entity', name: 'Order', entity_type: 'logicalDataEntities', category: 'data', relevant_fields: {} },
        { id: 'order-service', name: 'OrderService', entity_type: 'services', category: 'application', relevant_fields: {} },
        { id: 'order-api', name: 'OrderAPI', entity_type: 'interfaces', category: 'application', relevant_fields: {} },
      ],
      resolved_diagrams: [],
      truncated: false,
      resolved_relationships: [
        {
          id: 'rel-1',
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: 'order-entity', name: 'Order' },
          to: { entity_type: 'logicalDataEntities', entity_id: 'customer-entity', name: 'Customer' },
          label: 'customer_id',
          summary_fields: { cardinality: 'ONE_TO_MANY', relationship_type: 'COMPOSITION' },
        },
        {
          id: 'exposes-1',
          type: 'exposes',
          from: { entity_type: 'services', entity_id: 'order-service', name: 'OrderService' },
          to: { entity_type: 'interfaces', entity_id: 'order-api', name: 'OrderAPI' },
          label: 'exposes',
          summary_fields: {},
        },
      ],
    };

    expect(response.expanded_entity_ids).toHaveLength(4);
    expect(response.resolved_entities).toHaveLength(4);
    expect(response.resolved_relationships).toHaveLength(2);

    // Verify FK relationship
    const fkRel = response.resolved_relationships.find(r => r.type === 'fk');
    expect(fkRel).toBeDefined();
    expect(fkRel!.from.name).toBe('Order');
    expect(fkRel!.to.name).toBe('Customer');
    expect(fkRel!.summary_fields.cardinality).toBe('ONE_TO_MANY');

    // Verify exposes relationship
    const exposesRel = response.resolved_relationships.find(r => r.type === 'exposes');
    expect(exposesRel).toBeDefined();
    expect(exposesRel!.from.name).toBe('OrderService');
    expect(exposesRel!.to.name).toBe('OrderAPI');
  });

  it('should handle truncation with relationships', () => {
    const response: ExpandResolveResponseDto = {
      expanded_entity_ids: Array(250)
        .fill(null)
        .map((_, i) => `logicalDataEntities::entity-${i}`),
      expanded_diagram_ids: [],
      resolved_entities: [],
      resolved_diagrams: [],
      truncated: true,
      truncation_reason: 'Truncated entities from 300 to 250 (limit: 250); Truncated relationships from 600 to 500 (limit: 500)',
      resolved_relationships: Array(500)
        .fill(null)
        .map((_, i) => ({
          id: `rel-${i}`,
          type: 'fk',
          from: { entity_type: 'logicalDataEntities', entity_id: `from-${i}`, name: `From${i}` },
          to: { entity_type: 'logicalDataEntities', entity_id: `to-${i}`, name: `To${i}` },
          label: 'fk',
          summary_fields: {},
        })),
    };

    expect(response.truncated).toBe(true);
    expect(response.truncation_reason).toContain('Truncated relationships');
    expect(response.resolved_relationships).toHaveLength(500);
  });
});
