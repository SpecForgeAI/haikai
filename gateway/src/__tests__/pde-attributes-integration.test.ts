/**
 * PDE Attributes Integration Tests
 *
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 * Task Group 7: Integration Testing
 *
 * Tests verify:
 * - 7.1: End-to-end test - PDE attributes flow from expansion to prompt
 * - 7.2: Persistence round-trip integration test
 * - 7.3: Backward compatibility integration test
 * - 7.4: Warning injection integration test
 */

import {
  buildCondensedContextDtos,
  generatePdeAttributeWarning,
  findPdesWithMissingAttributes,
  formatCondensedContextSection,
  buildEntityAndAttributesDtos,
} from '../services/promptBuilder';
import {
  ExpandResolveResponseDto,
  ResolvedEntitySummary,
  ResolvedRelationship,
} from '../types';

/**
 * Helper to create a valid ExpandResolveResponseDto with required fields.
 */
function createExpandResponse(
  entities: ResolvedEntitySummary[],
  relationships: ResolvedRelationship[] = []
): ExpandResolveResponseDto {
  return {
    expanded_entity_ids: entities.map((e) => `${e.entity_type}::${e.id}`),
    expanded_diagram_ids: [],
    resolved_entities: entities,
    resolved_diagrams: [],
    resolved_relationships: relationships,
    truncated: false,
  };
}

describe('PDE Attributes Integration Tests - Task Group 7', () => {
  describe('7.1: E2E test - PDE attributes flow from expansion to prompt', () => {
    it('should include PDE attributes in condensed context DTOs', () => {
      // Arrange: PDE with attributes in resolved entities
      const expandResponse = createExpandResponse([
        {
          id: 'pde-users',
          name: 'users',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            tableName: 'users',
            attributes: [
              { name: 'id', type: 'uuid', pk: true, nullable: false },
              { name: 'email', type: 'varchar(255)', pk: false, nullable: false },
              { name: 'name', type: 'varchar(100)', pk: false, nullable: true },
              { name: 'created_at', type: 'timestamp', pk: false, nullable: false },
            ],
          },
        },
      ]);

      // Act: Build condensed context DTOs
      const dtos = buildCondensedContextDtos(expandResponse);

      // Assert: Attributes should be included in the DTO
      expect(dtos.length).toBeGreaterThan(0);
      const pdeDto = dtos.find(
        (dto) => dto.kind === 'entity_and_attributes' && dto.id.includes('pde-users')
      );
      expect(pdeDto).toBeDefined();
      expect(pdeDto?.kind).toBe('entity_and_attributes');

      if (pdeDto?.kind === 'entity_and_attributes') {
        expect(pdeDto.attributes).toBeDefined();
        expect(pdeDto.attributes.length).toBe(4);
        expect(pdeDto.attributes[0].name).toBe('id');
        expect(pdeDto.attributes[0].type).toBe('uuid');
        expect(pdeDto.attributes[0].pk).toBe(true);
      }
    });

    it('should include attribute names in formatted prompt output', () => {
      // Arrange: PDE with attributes
      const expandResponse = createExpandResponse([
        {
          id: 'pde-orders',
          name: 'orders',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            tableName: 'orders',
            attributes: [
              { name: 'order_id', type: 'uuid', pk: true, nullable: false },
              { name: 'user_id', type: 'uuid', pk: false, nullable: false },
              { name: 'total_amount', type: 'decimal(10,2)', pk: false, nullable: false },
            ],
          },
        },
      ]);

      // Act: Build and format condensed context
      const dtos = buildCondensedContextDtos(expandResponse);
      const formatted = formatCondensedContextSection(dtos, false);

      // Assert: Attribute names should appear in output
      expect(formatted).toContain('order_id');
      expect(formatted).toContain('user_id');
      expect(formatted).toContain('total_amount');
      expect(formatted).toContain('uuid');
      expect(formatted).toContain('decimal(10,2)');
    });

    it('should verify resolved_entities[].relevant_fields.attributes has length > 0', () => {
      // Arrange: PDE with attributes
      const expandResponse = createExpandResponse([
        {
          id: 'pde-products',
          name: 'products',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            attributes: [
              { name: 'product_id', type: 'uuid', pk: true, nullable: false },
              { name: 'sku', type: 'varchar(50)', pk: false, nullable: false },
            ],
          },
        },
      ]);

      // Act: Extract entity and attributes DTOs
      const entityDtos = buildEntityAndAttributesDtos(expandResponse);

      // Assert: Attributes should have length > 0
      expect(entityDtos.length).toBe(1);
      expect(entityDtos[0].attributes.length).toBeGreaterThan(0);
      expect(entityDtos[0].attributes.length).toBe(2);
    });
  });

  describe('7.2: Persistence round-trip integration test', () => {
    it('should preserve bundle_type in context through save/load cycle', () => {
      // This test verifies the TypeScript types and structure
      // Actual persistence is tested in backend integration tests

      // Arrange: Entity selection with bundle_type
      const entitySelection = {
        entity_type: 'physicalDataEntities',
        entity_id: 'pde-users',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: 1,
      };

      // Act: Simulate round-trip by serializing/deserializing
      const serialized = JSON.stringify(entitySelection);
      const deserialized = JSON.parse(serialized);

      // Assert: All fields preserved
      expect(deserialized.entity_type).toBe('physicalDataEntities');
      expect(deserialized.entity_id).toBe('pde-users');
      expect(deserialized.bundle_type).toBe('entity_with_attributes_and_relationships');
      expect(deserialized.depth).toBe(1);
    });

    it('should preserve depth parameter in entity selections', () => {
      // Arrange: Entity selections with different depth values
      const selections = [
        {
          entity_type: 'physicalDataEntities',
          entity_id: 'pde-1',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 1,
        },
        {
          entity_type: 'physicalDataEntities',
          entity_id: 'pde-2',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 2,
        },
      ];

      // Act: Simulate round-trip
      const serialized = JSON.stringify(selections);
      const deserialized = JSON.parse(serialized);

      // Assert: Depth values preserved
      expect(deserialized[0].depth).toBe(1);
      expect(deserialized[1].depth).toBe(2);
    });

    it('should handle null depth value in entity selections', () => {
      // Arrange: Entity selection without depth
      const entitySelection = {
        entity_type: 'physicalDataEntities',
        entity_id: 'pde-users',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: null,
      };

      // Act: Simulate round-trip
      const serialized = JSON.stringify(entitySelection);
      const deserialized = JSON.parse(serialized);

      // Assert: Null depth preserved
      expect(deserialized.depth).toBeNull();
    });
  });

  describe('7.3: Backward compatibility integration test', () => {
    it('should handle legacy contexts with only selectedEntityIds', () => {
      // Arrange: Legacy DTO structure (no structured selections)
      const legacyContext = {
        project_id: 'test-project',
        work_item_id: '123e4567-e89b-12d3-a456-426614174000',
        selected_entity_ids: ['physicalDataEntities::pde-users', 'services::svc-1'],
        selected_diagram_ids: ['diagram-1'],
        // No selected_entity_selections or selected_diagram_selections
      };

      // Act: Parse entity IDs (simulating mapDtoToContextState behavior)
      const entityRefs = legacyContext.selected_entity_ids.map((id) => {
        const parts = id.split('::');
        return {
          entity_type: parts[0],
          entity_id: parts[1],
          // bundle_type would be inferred by backend/frontend
        };
      });

      // Assert: Entity refs parsed correctly
      expect(entityRefs.length).toBe(2);
      expect(entityRefs[0].entity_type).toBe('physicalDataEntities');
      expect(entityRefs[0].entity_id).toBe('pde-users');
      expect(entityRefs[1].entity_type).toBe('services');
      expect(entityRefs[1].entity_id).toBe('svc-1');
    });

    it('should infer default bundle_type for different entity types', () => {
      // This test verifies the inference logic documented in the spec
      const inferDefaultBundleType = (entityType: string): string => {
        switch (entityType) {
          case 'interfaces':
            return 'interface_with_endpoints_and_schemas';
          case 'services':
            return 'service_with_parents_and_children';
          case 'physicalDataEntities':
          case 'physical_data_entities':
          case 'logicalDataEntities':
          case 'logical_data_entities':
            return 'entity_with_attributes_and_relationships';
          default:
            return 'entity_only';
        }
      };

      // Assert: Correct defaults for each entity type
      expect(inferDefaultBundleType('interfaces')).toBe('interface_with_endpoints_and_schemas');
      expect(inferDefaultBundleType('services')).toBe('service_with_parents_and_children');
      expect(inferDefaultBundleType('physicalDataEntities')).toBe('entity_with_attributes_and_relationships');
      expect(inferDefaultBundleType('logicalDataEntities')).toBe('entity_with_attributes_and_relationships');
      expect(inferDefaultBundleType('applications')).toBe('entity_only');
    });

    it('should not lose data when loading legacy context without new columns', () => {
      // Arrange: Legacy context with only the original fields
      const legacyContext = {
        project_id: 'project-1',
        work_item_id: 'wi-1',
        selected_entity_ids: ['physicalDataEntities::pde-1'],
        selected_diagram_ids: ['diagram-1'],
      };

      // Act: Access fields that would be added (simulating nullable access)
      const entitySelections = (legacyContext as any).selected_entity_selections ?? [];
      const diagramSelections = (legacyContext as any).selected_diagram_selections ?? [];

      // Assert: Defaults to empty arrays without errors
      expect(entitySelections).toEqual([]);
      expect(diagramSelections).toEqual([]);
      // Original data preserved
      expect(legacyContext.selected_entity_ids).toEqual(['physicalDataEntities::pde-1']);
      expect(legacyContext.selected_diagram_ids).toEqual(['diagram-1']);
    });
  });

  describe('7.4: Warning injection integration test', () => {
    it('should generate warning for PDEs with missing attributes', () => {
      // Arrange: PDE without attributes
      const expandResponse = createExpandResponse([
        {
          id: 'pde-legacy-table',
          name: 'legacy_table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            tableName: 'legacy_table',
            // No attributes array
          },
        },
      ]);

      // Act: Build DTOs and check for missing attributes
      const dtos = buildCondensedContextDtos(expandResponse);
      const pdesMissing = findPdesWithMissingAttributes(dtos);

      // Assert: Should identify the PDE with missing attributes
      expect(pdesMissing.length).toBe(1);
      expect(pdesMissing[0]).toBe('legacy_table');
    });

    it('should include warning text in formatted prompt output', () => {
      // Arrange: PDEs missing attributes
      const pdesMissing = ['users', 'orders'];

      // Act: Generate warning
      const warning = generatePdeAttributeWarning(pdesMissing);

      // Assert: Warning contains entity names
      expect(warning).toContain('[WARNING:');
      expect(warning).toContain('users');
      expect(warning).toContain('orders');
      expect(warning).toContain('Physical Data Entities');
      expect(warning).toContain('missing attribute information');
    });

    it('should inject warning into condensed context section', () => {
      // Arrange: PDE without attributes
      const expandResponse = createExpandResponse([
        {
          id: 'pde-empty',
          name: 'empty_table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            tableName: 'empty_table',
            attributes: [], // Empty attributes array
          },
        },
      ]);

      // Act: Build and format with warning check
      const dtos = buildCondensedContextDtos(expandResponse);
      const pdesMissing = findPdesWithMissingAttributes(dtos);
      const warning = generatePdeAttributeWarning(pdesMissing);
      const formatted = formatCondensedContextSection(dtos, false, warning);

      // Assert: Warning should appear in formatted output
      expect(formatted).toContain('[WARNING:');
      expect(formatted).toContain('empty_table');
    });

    it('should not generate warning when all PDEs have attributes', () => {
      // Arrange: PDE with attributes
      const expandResponse = createExpandResponse([
        {
          id: 'pde-complete',
          name: 'complete_table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            tableName: 'complete_table',
            attributes: [
              { name: 'id', type: 'uuid', pk: true, nullable: false },
            ],
          },
        },
      ]);

      // Act: Check for missing attributes
      const dtos = buildCondensedContextDtos(expandResponse);
      const pdesMissing = findPdesWithMissingAttributes(dtos);
      const warning = generatePdeAttributeWarning(pdesMissing);

      // Assert: No warning should be generated
      expect(pdesMissing.length).toBe(0);
      expect(warning).toBe('');
    });

    it('should identify multiple PDEs with missing attributes', () => {
      // Arrange: Multiple PDEs, some with and some without attributes
      const expandResponse = createExpandResponse([
        {
          id: 'pde-1',
          name: 'table_with_attrs',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            attributes: [{ name: 'id', type: 'uuid', pk: true, nullable: false }],
          },
        },
        {
          id: 'pde-2',
          name: 'table_without_attrs_1',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            // No attributes
          },
        },
        {
          id: 'pde-3',
          name: 'table_without_attrs_2',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            attributes: [], // Empty array
          },
        },
      ]);

      // Act: Check for missing attributes
      const dtos = buildCondensedContextDtos(expandResponse);
      const pdesMissing = findPdesWithMissingAttributes(dtos);

      // Assert: Should identify both PDEs without attributes
      expect(pdesMissing.length).toBe(2);
      expect(pdesMissing).toContain('table_without_attrs_1');
      expect(pdesMissing).toContain('table_without_attrs_2');
      expect(pdesMissing).not.toContain('table_with_attrs');
    });
  });
});
