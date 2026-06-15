/**
 * Tests for Context Bundle + Depth Wiring - Frontend Type Extensions
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
 * Task Group 1: Frontend Type Extensions
 *
 * Tests that:
 * 1. EntityBundleSelection interface has entity_type, entity_id, bundle_type, depth fields
 * 2. DiagramBundleSelection interface has diagram_id, bundle_type fields
 * 3. ArchitectureContextPayload includes optional entities[] and diagrams[] arrays
 * 4. Backward compatibility with legacy entityIds/diagramIds arrays
 */

import {
  EntityBundleSelection,
  DiagramBundleSelection,
  ArchitectureContextPayload,
} from '../api/chatApi';

describe('Context Bundle Depth Wiring - Frontend Type Extensions', () => {
  describe('Task 1.1 - EntityBundleSelection interface', () => {
    it('should have entity_type, entity_id, bundle_type, depth fields', () => {
      // Create an EntityBundleSelection with all fields
      const selection: EntityBundleSelection = {
        entity_type: 'physicalDataEntities',
        entity_id: 'pde-123',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: 2,
      };

      // Verify all fields are accessible
      expect(selection.entity_type).toBe('physicalDataEntities');
      expect(selection.entity_id).toBe('pde-123');
      expect(selection.bundle_type).toBe('entity_with_attributes_and_relationships');
      expect(selection.depth).toBe(2);
    });

    it('should allow depth to be optional (undefined)', () => {
      // Create an EntityBundleSelection without depth
      const selection: EntityBundleSelection = {
        entity_type: 'logicalDataEntities',
        entity_id: 'lde-456',
        bundle_type: 'entity_only',
      };

      // Verify depth is undefined
      expect(selection.depth).toBeUndefined();
    });
  });

  describe('Task 1.1 - DiagramBundleSelection interface', () => {
    it('should have diagram_id, bundle_type fields', () => {
      // Create a DiagramBundleSelection with all fields
      const selection: DiagramBundleSelection = {
        diagram_id: 'diag-789',
        bundle_type: 'diagram_only',
      };

      // Verify all fields are accessible
      expect(selection.diagram_id).toBe('diag-789');
      expect(selection.bundle_type).toBe('diagram_only');
    });
  });

  describe('Task 1.1 - ArchitectureContextPayload with entities and diagrams arrays', () => {
    it('should include optional entities[] and diagrams[] arrays', () => {
      // Create a full payload with new structured arrays
      const payload: ArchitectureContextPayload = {
        entityIds: ['physicalDataEntities::pde-123'],
        diagramIds: ['diag-789'],
        entities: [
          {
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-123',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 1,
          },
        ],
        diagrams: [
          {
            diagram_id: 'diag-789',
            bundle_type: 'diagram_only',
          },
        ],
      };

      // Verify entities array
      expect(payload.entities).toBeDefined();
      expect(payload.entities).toHaveLength(1);
      expect(payload.entities![0].entity_type).toBe('physicalDataEntities');
      expect(payload.entities![0].depth).toBe(1);

      // Verify diagrams array
      expect(payload.diagrams).toBeDefined();
      expect(payload.diagrams).toHaveLength(1);
      expect(payload.diagrams![0].diagram_id).toBe('diag-789');
    });

    it('should maintain backward compatibility with legacy entityIds/diagramIds arrays', () => {
      // Create a payload with only legacy fields (backward compatibility)
      const legacyPayload: ArchitectureContextPayload = {
        entityIds: ['services::svc-001', 'interfaces::iface-002'],
        diagramIds: ['diag-001', 'diag-002'],
      };

      // Verify legacy fields work
      expect(legacyPayload.entityIds).toHaveLength(2);
      expect(legacyPayload.diagramIds).toHaveLength(2);

      // Verify new fields are undefined (not required)
      expect(legacyPayload.entities).toBeUndefined();
      expect(legacyPayload.diagrams).toBeUndefined();
    });
  });
});
