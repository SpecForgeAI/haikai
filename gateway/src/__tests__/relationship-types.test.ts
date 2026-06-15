/**
 * Tests for relationship types and prompt formatting.
 *
 * Spec 2026-01-16: Context Bundles Auto-Include Relationships
 * - Task Group 7: Gateway Types Extension
 * - Task Group 8: Prompt Builder Enhancement for Relationships
 */

import {
  RelationshipEndpoint,
  ResolvedRelationship,
  ExpandResolveResponseDto,
} from '../types/chat';
import { formatHighlightedContext } from '../services/promptBuilder';

describe('Task Group 7: Gateway Types Extension', () => {
  describe('RelationshipEndpoint interface', () => {
    it('should match backend DTO structure with snake_case fields', () => {
      const endpoint: RelationshipEndpoint = {
        entity_type: 'logicalDataEntities',
        entity_id: 'customer-123',
        name: 'Customer',
      };

      expect(endpoint.entity_type).toBe('logicalDataEntities');
      expect(endpoint.entity_id).toBe('customer-123');
      expect(endpoint.name).toBe('Customer');
    });

    it('should support various entity types', () => {
      const entityTypes = [
        'logicalDataEntities',
        'physicalDataEntities',
        'interfaces',
        'services',
        'applications',
        'appComponents',
      ];

      for (const entityType of entityTypes) {
        const endpoint: RelationshipEndpoint = {
          entity_type: entityType,
          entity_id: 'test-id',
          name: 'Test Entity',
        };
        expect(endpoint.entity_type).toBe(entityType);
      }
    });
  });

  describe('ResolvedRelationship interface', () => {
    it('should match backend DTO structure', () => {
      const from: RelationshipEndpoint = {
        entity_type: 'logicalDataEntities',
        entity_id: 'customer-123',
        name: 'Customer',
      };
      const to: RelationshipEndpoint = {
        entity_type: 'logicalDataEntities',
        entity_id: 'order-456',
        name: 'Order',
      };

      const relationship: ResolvedRelationship = {
        id: 'rel-1',
        type: 'association',
        from,
        to,
        label: 'places',
        summary_fields: {
          cardinality: 'ONE_TO_MANY',
          relationship_type: 'ASSOCIATION',
        },
      };

      expect(relationship.id).toBe('rel-1');
      expect(relationship.type).toBe('association');
      expect(relationship.from.name).toBe('Customer');
      expect(relationship.to.name).toBe('Order');
      expect(relationship.label).toBe('places');
      expect(relationship.summary_fields.cardinality).toBe('ONE_TO_MANY');
    });

    it('should support all documented relationship types', () => {
      const relationshipTypes = [
        'fk',
        'association',
        'many_to_many',
        'uses',
        'exposes',
        'schema_ref',
        'contains',
      ];

      for (const type of relationshipTypes) {
        const relationship: ResolvedRelationship = {
          id: `rel-${type}`,
          type,
          from: { entity_type: 'entities', entity_id: 'e1', name: 'Entity1' },
          to: { entity_type: 'entities', entity_id: 'e2', name: 'Entity2' },
          label: 'test',
          summary_fields: {},
        };
        expect(relationship.type).toBe(type);
      }
    });
  });

  describe('ExpandResolveResponseDto with resolved_relationships', () => {
    it('should include resolved_relationships field', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: ['logicalDataEntities::customer-123'],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [
          {
            id: 'rel-1',
            type: 'association',
            from: { entity_type: 'logicalDataEntities', entity_id: 'customer', name: 'Customer' },
            to: { entity_type: 'logicalDataEntities', entity_id: 'order', name: 'Order' },
            label: 'has',
            summary_fields: { cardinality: 'ONE_TO_MANY' },
          },
        ],
      };

      expect(response.resolved_relationships).toBeDefined();
      expect(response.resolved_relationships.length).toBe(1);
      expect(response.resolved_relationships[0].type).toBe('association');
    });

    it('should support empty resolved_relationships array', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: ['services::svc-1'],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [],
      };

      expect(response.resolved_relationships).toEqual([]);
    });
  });
});

describe('Task Group 8: Prompt Builder Enhancement for Relationships', () => {
  describe('formatHighlightedContext with relationships', () => {
    it('should add RELATIONSHIPS section when relationships present', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: ['logicalDataEntities::customer', 'logicalDataEntities::order'],
        expanded_diagram_ids: [],
        resolved_entities: [
          {
            id: 'customer',
            name: 'Customer',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
          {
            id: 'order',
            name: 'Order',
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
            type: 'association',
            from: { entity_type: 'logicalDataEntities', entity_id: 'customer', name: 'Customer' },
            to: { entity_type: 'logicalDataEntities', entity_id: 'order', name: 'Order' },
            label: 'places',
            summary_fields: { cardinality: 'ONE_TO_MANY', relationship_type: 'ASSOCIATION' },
          },
        ],
      };

      const result = formatHighlightedContext(response);

      expect(result).toContain('Relationships:');
      expect(result).toContain('association: Customer -> Order');
      expect(result).toContain('ONE_TO_MANY');
    });

    it('should format relationship with cardinality and relationship_type', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [
          {
            id: 'rel-fk',
            type: 'fk',
            from: { entity_type: 'physicalDataEntities', entity_id: 'orders', name: 'Orders' },
            to: { entity_type: 'physicalDataEntities', entity_id: 'customers', name: 'Customers' },
            label: 'references',
            summary_fields: { cardinality: 'MANY_TO_ONE', relationship_type: 'DEPENDENCY' },
          },
        ],
      };

      const result = formatHighlightedContext(response);

      expect(result).toContain('fk: Orders -> Customers (MANY_TO_ONE, DEPENDENCY)');
    });

    it('should group relationships by type', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [
          {
            id: 'rel-1',
            type: 'association',
            from: { entity_type: 'entities', entity_id: 'a', name: 'EntityA' },
            to: { entity_type: 'entities', entity_id: 'b', name: 'EntityB' },
            label: 'rel1',
            summary_fields: {},
          },
          {
            id: 'rel-2',
            type: 'fk',
            from: { entity_type: 'entities', entity_id: 'c', name: 'EntityC' },
            to: { entity_type: 'entities', entity_id: 'd', name: 'EntityD' },
            label: 'rel2',
            summary_fields: {},
          },
          {
            id: 'rel-3',
            type: 'association',
            from: { entity_type: 'entities', entity_id: 'e', name: 'EntityE' },
            to: { entity_type: 'entities', entity_id: 'f', name: 'EntityF' },
            label: 'rel3',
            summary_fields: {},
          },
        ],
      };

      const result = formatHighlightedContext(response);

      // Should contain both types
      expect(result).toContain('association:');
      expect(result).toContain('fk:');
    });

    it('should produce no RELATIONSHIPS section when no relationships present', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: ['services::svc-1'],
        expanded_diagram_ids: [],
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [],
      };

      const result = formatHighlightedContext(response);

      expect(result).not.toContain('Relationships:');
    });

    it('should handle relationships without summary_fields values', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        truncated: false,
        resolved_relationships: [
          {
            id: 'rel-empty',
            type: 'contains',
            from: { entity_type: 'applications', entity_id: 'app', name: 'MyApp' },
            to: { entity_type: 'appComponents', entity_id: 'comp', name: 'MyComponent' },
            label: 'contains',
            summary_fields: {},
          },
        ],
      };

      const result = formatHighlightedContext(response);

      // Should contain the relationship without parentheses since no summary fields
      expect(result).toContain('contains: MyApp -> MyComponent');
      expect(result).not.toContain('contains: MyApp -> MyComponent (');
    });

    it('should work with legacy ResolvedImplementContextDto (no relationships)', () => {
      // This tests backward compatibility
      const legacyContext = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      const result = formatHighlightedContext(legacyContext);

      expect(result).toContain('UserService');
      expect(result).not.toContain('Relationships:');
    });
  });
});
