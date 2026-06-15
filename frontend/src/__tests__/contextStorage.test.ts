/**
 * contextStorage.test.ts
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 1: Tests for contextStorage functionality
 *
 * Tests:
 * - loadContext returns empty state for non-existent key
 * - saveContext and loadContext round-trip with valid data
 * - loadContext handles corrupt JSON gracefully (returns empty state)
 * - localStorage key pattern is correct
 *
 * Spec 2026-01-16: Context Picker Bundles - UI and Selection Contract
 * Task Group 2: Tests for bundle_type persistence
 *
 * Tests:
 * - saveContext/loadContext round-trip preserves bundle_type on EntityRef
 * - saveContext/loadContext round-trip preserves bundle_type on DiagramRef
 * - loadContext handles legacy data without bundle_type (backward compatibility)
 * - loadContext returns refs with undefined bundle_type when not present in storage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadContext, saveContext, createEmptyContextState } from '../utils/contextStorage';
import type { ContextState, EntityRef, DiagramRef } from '../utils/contextStorage';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('contextStorage', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  describe('loadContext', () => {
    it('returns empty state for non-existent key', () => {
      // Arrange
      const projectId = 'test-project';
      const workItemId = 'work-item-123';

      // Act
      const result = loadContext(projectId, workItemId);

      // Assert
      expect(result).toEqual(createEmptyContextState());
      expect(result.version).toBe(1);
      expect(result.entity_refs).toEqual([]);
      expect(result.diagram_refs).toEqual([]);
    });

    it('handles corrupt JSON gracefully and returns empty state', () => {
      // Arrange
      const projectId = 'test-project';
      const workItemId = 'work-item-456';
      const key = `product_context::${projectId}::${workItemId}`;

      // Store corrupt JSON
      mockLocalStorage.setItem(key, '{invalid json data');

      // Act
      const result = loadContext(projectId, workItemId);

      // Assert
      expect(result).toEqual(createEmptyContextState());
      expect(result.version).toBe(1);
      expect(result.entity_refs).toEqual([]);
      expect(result.diagram_refs).toEqual([]);
    });
  });

  describe('saveContext and loadContext round-trip', () => {
    it('saves and loads context data correctly', () => {
      // Arrange
      const projectId = 'my-architecture-project';
      const workItemId = 'feature-abc';

      const entityRefs: EntityRef[] = [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Core App' },
        { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Auth Service' },
      ];

      const diagramRefs: DiagramRef[] = [
        { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'System Overview' },
      ];

      const contextState: ContextState = {
        version: 1,
        entity_refs: entityRefs,
        diagram_refs: diagramRefs,
      };

      // Act
      saveContext(projectId, workItemId, contextState);
      const result = loadContext(projectId, workItemId);

      // Assert
      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(2);
      expect(result.entity_refs[0]).toEqual(entityRefs[0]);
      expect(result.entity_refs[1]).toEqual(entityRefs[1]);
      expect(result.diagram_refs).toHaveLength(1);
      expect(result.diagram_refs[0]).toEqual(diagramRefs[0]);
    });
  });

  describe('localStorage key pattern', () => {
    it('uses correct key pattern product_context::<projectId>::<workItemId>', () => {
      // Arrange
      const projectId = 'project-xyz';
      const workItemId = 'story-999';
      const expectedKey = 'product_context::project-xyz::story-999';

      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
      };

      // Act
      saveContext(projectId, workItemId, contextState);

      // Assert
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        expectedKey,
        expect.any(String)
      );

      // Also verify load uses the same pattern
      loadContext(projectId, workItemId);
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(expectedKey);
    });
  });

  // ============================================================================
  // Spec 2026-01-16: Context Picker Bundles - bundle_type persistence tests
  // ============================================================================

  describe('bundle_type persistence', () => {
    it('saveContext/loadContext round-trip preserves bundle_type on EntityRef', () => {
      // Arrange
      const projectId = 'bundle-test-project';
      const workItemId = 'feature-with-bundles';

      const entityRefs: EntityRef[] = [
        {
          kind: 'ENTITY',
          entity_type: 'interfaces',
          entity_id: 'int-1',
          label: 'Payment API',
          bundle_type: 'interface_with_endpoints_and_schemas',
        },
        {
          kind: 'ENTITY',
          entity_type: 'services',
          entity_id: 'svc-1',
          label: 'Order Service',
          bundle_type: 'service_with_parents_and_children',
        },
        {
          kind: 'ENTITY',
          entity_type: 'physical_data_entities',
          entity_id: 'pde-1',
          label: 'Customer Table',
          bundle_type: 'entity_with_attributes_and_relationships',
        },
      ];

      const contextState: ContextState = {
        version: 1,
        entity_refs: entityRefs,
        diagram_refs: [],
      };

      // Act
      saveContext(projectId, workItemId, contextState);
      const result = loadContext(projectId, workItemId);

      // Assert
      expect(result.entity_refs).toHaveLength(3);
      expect(result.entity_refs[0].bundle_type).toBe('interface_with_endpoints_and_schemas');
      expect(result.entity_refs[1].bundle_type).toBe('service_with_parents_and_children');
      expect(result.entity_refs[2].bundle_type).toBe('entity_with_attributes_and_relationships');
    });

    it('saveContext/loadContext round-trip preserves bundle_type on DiagramRef', () => {
      // Arrange
      const projectId = 'diagram-bundle-project';
      const workItemId = 'feature-diagrams';

      const diagramRefs: DiagramRef[] = [
        {
          kind: 'DIAGRAM',
          diagram_id: 'diag-1',
          label: 'System Architecture',
          bundle_type: 'diagram_only',
        },
        {
          kind: 'DIAGRAM',
          diagram_id: 'diag-2',
          label: 'Data Flow Diagram',
          bundle_type: 'diagram_only',
        },
      ];

      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: diagramRefs,
      };

      // Act
      saveContext(projectId, workItemId, contextState);
      const result = loadContext(projectId, workItemId);

      // Assert
      expect(result.diagram_refs).toHaveLength(2);
      expect(result.diagram_refs[0].bundle_type).toBe('diagram_only');
      expect(result.diagram_refs[1].bundle_type).toBe('diagram_only');
    });

    it('loadContext handles legacy data without bundle_type (backward compatibility)', () => {
      // Arrange
      const projectId = 'legacy-project';
      const workItemId = 'old-work-item';
      const key = `product_context::${projectId}::${workItemId}`;

      // Simulate legacy data structure without bundle_type field
      const legacyData = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Legacy App' },
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Legacy Service' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'Legacy Diagram' },
        ],
      };

      mockLocalStorage.setItem(key, JSON.stringify(legacyData));

      // Act
      const result = loadContext(projectId, workItemId);

      // Assert - should load successfully without bundle_type
      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(2);
      expect(result.entity_refs[0].entity_id).toBe('app-1');
      expect(result.entity_refs[0].label).toBe('Legacy App');
      expect(result.diagram_refs).toHaveLength(1);
      expect(result.diagram_refs[0].diagram_id).toBe('diag-1');
    });

    it('loadContext returns refs with undefined bundle_type when not present in storage', () => {
      // Arrange
      const projectId = 'undefined-bundle-project';
      const workItemId = 'work-item-no-bundles';
      const key = `product_context::${projectId}::${workItemId}`;

      // Data without bundle_type fields
      const dataWithoutBundles = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'interfaces', entity_id: 'int-1', label: 'API Interface' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'Overview Diagram' },
        ],
      };

      mockLocalStorage.setItem(key, JSON.stringify(dataWithoutBundles));

      // Act
      const result = loadContext(projectId, workItemId);

      // Assert - bundle_type should be undefined (not present)
      expect(result.entity_refs[0].bundle_type).toBeUndefined();
      expect(result.diagram_refs[0].bundle_type).toBeUndefined();
    });
  });
});
