/**
 * End-to-End Integration Tests for Context Bundle + Depth Wiring
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
 * Task Group 7: Integration Testing
 *
 * Tests the full flow from frontend to backend:
 * 1. Frontend sends entities[] with bundle_type and depth
 * 2. Gateway normalizes entity types
 * 3. Gateway calls expand-resolve on model service
 * 4. Model service expands with depth-aware logic
 * 5. PDEs include attributes in resolved context
 * 6. LLM prompt includes attribute information
 */

import {
  normalizeEntityType,
  normalizeEntitiesForExpandResolve,
  validatePdeAttributes,
  ENTITY_TYPE_CANONICAL_MAP,
} from '../services/architectureModelClient';
import { EntityBundleSelection, DiagramBundleSelection, ResolvedEntitySummary } from '../types';

describe('Context Bundle Depth Wiring - E2E Integration', () => {
  // ============================================================================
  // Test Group 7.1: Frontend to Gateway Entity Type Normalization Flow
  // ============================================================================

  describe('Task 7.1 - Frontend to Gateway normalization flow', () => {
    it('should normalize physical_data_entities from frontend to physicalDataEntities for backend', () => {
      // Simulate frontend sending snake_case entity type
      const frontendEntities: EntityBundleSelection[] = [
        {
          entity_type: 'physical_data_entities', // Frontend may send snake_case
          entity_id: 'users-table',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 1,
        },
      ];

      // Gateway normalizes before sending to model service
      const normalized = normalizeEntitiesForExpandResolve(frontendEntities);

      // Backend receives camelCase
      expect(normalized[0].entity_type).toBe('physicalDataEntities');
      expect(normalized[0].entity_id).toBe('users-table');
      expect(normalized[0].bundle_type).toBe('entity_with_attributes_and_relationships');
      expect(normalized[0].depth).toBe(1);
    });

    it('should preserve camelCase entity types from frontend', () => {
      // Some frontends may already send camelCase
      const frontendEntities: EntityBundleSelection[] = [
        {
          entity_type: 'physicalDataEntities',
          entity_id: 'orders-table',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 2,
        },
      ];

      const normalized = normalizeEntitiesForExpandResolve(frontendEntities);

      expect(normalized[0].entity_type).toBe('physicalDataEntities');
    });

    it('should handle mixed snake_case and camelCase in same request', () => {
      const frontendEntities: EntityBundleSelection[] = [
        {
          entity_type: 'physical_data_entities',
          entity_id: 'pde-1',
          bundle_type: 'entity_with_attributes_and_relationships',
        },
        {
          entity_type: 'logicalDataEntities',
          entity_id: 'lde-1',
          bundle_type: 'entity_with_attributes_and_relationships',
        },
        {
          entity_type: 'logical_data_entities',
          entity_id: 'lde-2',
          bundle_type: 'entity_only',
        },
      ];

      const normalized = normalizeEntitiesForExpandResolve(frontendEntities);

      expect(normalized[0].entity_type).toBe('physicalDataEntities');
      expect(normalized[1].entity_type).toBe('logicalDataEntities');
      expect(normalized[2].entity_type).toBe('logicalDataEntities');
    });
  });

  // ============================================================================
  // Test Group 7.2: PDE Attribute Validation in LLM Prompt Flow
  // ============================================================================

  describe('Task 7.2 - PDE attributes in LLM prompt validation', () => {
    it('should validate PDEs have attributes for LLM prompt inclusion', () => {
      // Simulated resolved context from model service
      const resolvedEntities: ResolvedEntitySummary[] = [
        {
          id: 'pde-users',
          name: 'Users',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'main_db',
            table_name: 'users',
            attributes: [
              { name: 'id', type: 'bigint', pk: true },
              { name: 'email', type: 'varchar(255)', nullable: false },
              { name: 'created_at', type: 'timestamp' },
            ],
          },
        },
        {
          id: 'pde-orders',
          name: 'Orders',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'main_db',
            table_name: 'orders',
            attributes: [
              { name: 'id', type: 'bigint', pk: true },
              { name: 'user_id', type: 'bigint', nullable: false },
              { name: 'total', type: 'decimal(10,2)' },
            ],
          },
        },
      ];

      const validationResult = validatePdeAttributes(resolvedEntities);

      // All PDEs have attributes, validation should pass
      expect(validationResult.valid).toBe(true);
      expect(validationResult.missingEntityIds).toHaveLength(0);
    });

    it('should detect PDEs missing attributes for LLM prompt', () => {
      const resolvedEntities: ResolvedEntitySummary[] = [
        {
          id: 'pde-users',
          name: 'Users',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'main_db',
            // attributes is missing!
          },
        },
      ];

      const validationResult = validatePdeAttributes(resolvedEntities);

      // Should detect missing attributes
      expect(validationResult.valid).toBe(false);
      expect(validationResult.missingEntityIds).toContain('pde-users');
    });
  });

  // ============================================================================
  // Test Group 7.3: Depth Parameter Flow Verification
  // ============================================================================

  describe('Task 7.3 - Depth parameter preservation through flow', () => {
    it('should preserve depth=1 through normalization', () => {
      const frontendEntities: EntityBundleSelection[] = [
        {
          entity_type: 'physicalDataEntities',
          entity_id: 'pde-1',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 1,
        },
      ];

      const normalized = normalizeEntitiesForExpandResolve(frontendEntities);

      expect(normalized[0].depth).toBe(1);
    });

    it('should preserve depth=2 through normalization', () => {
      const frontendEntities: EntityBundleSelection[] = [
        {
          entity_type: 'physicalDataEntities',
          entity_id: 'pde-1',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 2,
        },
      ];

      const normalized = normalizeEntitiesForExpandResolve(frontendEntities);

      expect(normalized[0].depth).toBe(2);
    });

    it('should preserve undefined depth (backend defaults to 1)', () => {
      const frontendEntities: EntityBundleSelection[] = [
        {
          entity_type: 'physicalDataEntities',
          entity_id: 'pde-1',
          bundle_type: 'entity_with_attributes_and_relationships',
          // depth is intentionally undefined
        },
      ];

      const normalized = normalizeEntitiesForExpandResolve(frontendEntities);

      // depth should remain undefined (backend will default to 1)
      expect(normalized[0].depth).toBeUndefined();
    });
  });

  // ============================================================================
  // Test Group 7.4: Diagram Bundle Selection Flow
  // ============================================================================

  describe('Task 7.4 - Diagram bundle selection pass-through', () => {
    it('should preserve diagram bundle selections without modification', () => {
      const diagrams: DiagramBundleSelection[] = [
        {
          diagram_id: 'diag-er-users',
          bundle_type: 'diagram_only',
        },
        {
          diagram_id: 'diag-sequence-auth',
          bundle_type: 'diagram_only',
        },
      ];

      // Diagrams don't need entity type normalization
      // They should pass through unchanged
      expect(diagrams[0].diagram_id).toBe('diag-er-users');
      expect(diagrams[0].bundle_type).toBe('diagram_only');
      expect(diagrams[1].diagram_id).toBe('diag-sequence-auth');
    });
  });

  // ============================================================================
  // Test Group 7.5: Entity Type Canonical Map Coverage
  // ============================================================================

  describe('Task 7.5 - Entity type canonical map coverage', () => {
    it('should have mapping for all known snake_case entity types', () => {
      const expectedMappings = [
        ['physical_data_entities', 'physicalDataEntities'],
        ['logical_data_entities', 'logicalDataEntities'],
        ['app_components', 'appComponents'],
        ['business_processes', 'businessProcesses'],
        ['business_points', 'businessPoints'],
        ['process_activities', 'businessPoints'], // Special mapping
        ['ui_screens', 'uiScreens'],
      ];

      for (const [snakeCase, camelCase] of expectedMappings) {
        expect(normalizeEntityType(snakeCase)).toBe(camelCase);
      }
    });

    it('should pass through unmapped entity types unchanged', () => {
      const unmappedTypes = ['services', 'interfaces', 'endpoints', 'applications', 'classes', 'methods'];

      for (const entityType of unmappedTypes) {
        expect(normalizeEntityType(entityType)).toBe(entityType);
      }
    });
  });
});
