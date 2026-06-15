/**
 * Tests for Context Bundle + Depth Wiring - buildContext() Enhancement
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
 * Task Group 2: Frontend buildContext() Enhancement
 *
 * Tests that:
 * 1. entities[] array is populated from contextState.entity_refs
 * 2. Each entity includes entity_type, entity_id, bundle_type, depth from EntityRef
 * 3. diagrams[] array is populated from contextState.diagram_refs
 * 4. depth defaults to 1 when undefined in EntityRef
 */

import { ContextState } from '../utils/contextStorage';
import { ImplementChatContext, EntityBundleSelection, DiagramBundleSelection } from '../api/chatApi';

/**
 * Mock buildContext function that mirrors the implementation in ImplementationAssistantPanel.tsx
 * This is extracted here to test the logic in isolation.
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 2
 */
function buildContextFromState(
  contextState: ContextState,
  projectId: string,
  workItemId: string,
  workItemTitle: string,
  workItemType: string,
  workItemDescription: string,
  projectParentFolder?: string
): ImplementChatContext {
  // Spec 2026-01-16: Construct typed entity IDs in format "<entity_type>::<entity_id>"
  const entityIds = contextState.entity_refs.map(
    (ref) => `${ref.entity_type}::${ref.entity_id}`
  );
  // Diagram IDs remain plain (not typed) - they use a different resolution path
  const diagramIds = contextState.diagram_refs.map((ref) => ref.diagram_id);

  // Spec 2026-01-17: Construct entities[] array from entity_refs
  const entities: EntityBundleSelection[] = contextState.entity_refs.map((ref) => ({
    entity_type: ref.entity_type,
    entity_id: ref.entity_id,
    bundle_type: ref.bundle_type || 'entity_only',
    depth: ref.depth ?? 1, // Default to 1 if undefined
  }));

  // Spec 2026-01-17: Construct diagrams[] array from diagram_refs
  const diagrams: DiagramBundleSelection[] = contextState.diagram_refs.map((ref) => ({
    diagram_id: ref.diagram_id,
    bundle_type: ref.bundle_type || 'diagram_only',
  }));

  return {
    mode: 'implement_feature',
    intent: 'normal_chat',
    phase: 'refine',
    filename: projectId,
    projectParentFolder,
    featureId: workItemId,
    featureTitle: workItemTitle,
    workItem: {
      id: workItemId,
      title: workItemTitle,
      type: workItemType,
      description: workItemDescription,
    },
    architectureContext: {
      entityIds,
      diagramIds,
      entities,
      diagrams,
    },
  };
}

describe('Context Bundle Depth Wiring - buildContext() Enhancement', () => {
  describe('Task 2.1 - entities[] array from entity_refs', () => {
    it('should populate entities[] from contextState.entity_refs', () => {
      // Given: context state with entity refs
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-123',
            label: 'Users Table',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 2,
          },
          {
            kind: 'ENTITY',
            entity_type: 'services',
            entity_id: 'svc-456',
            label: 'User Service',
            bundle_type: 'service_with_parents_and_children',
          },
        ],
        diagram_refs: [],
      };

      // When: building context
      const context = buildContextFromState(
        contextState,
        'test-project.json',
        'feat-001',
        'Test Feature',
        'Feature',
        'Test description',
        '/path/to/project'
      );

      // Then: entities[] should contain EntityBundleSelection objects
      expect(context.architectureContext).toBeDefined();
      expect(context.architectureContext!.entities).toBeDefined();
      expect(context.architectureContext!.entities).toHaveLength(2);
    });

    it('should include entity_type, entity_id, bundle_type, depth from EntityRef', () => {
      // Given: context state with specific entity ref values
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-123',
            label: 'Users Table',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 2,
          },
        ],
        diagram_refs: [],
      };

      // When: building context
      const context = buildContextFromState(
        contextState,
        'test-project.json',
        'feat-001',
        'Test Feature',
        'Feature',
        'Test description'
      );

      // Then: entity should have all fields
      const entity = context.architectureContext!.entities![0];
      expect(entity.entity_type).toBe('physicalDataEntities');
      expect(entity.entity_id).toBe('pde-123');
      expect(entity.bundle_type).toBe('entity_with_attributes_and_relationships');
      expect(entity.depth).toBe(2);
    });
  });

  describe('Task 2.1 - diagrams[] array from diagram_refs', () => {
    it('should populate diagrams[] from contextState.diagram_refs', () => {
      // Given: context state with diagram refs
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [
          {
            kind: 'DIAGRAM',
            diagram_id: 'diag-001',
            label: 'ER Diagram',
            bundle_type: 'diagram_only',
          },
          {
            kind: 'DIAGRAM',
            diagram_id: 'diag-002',
            label: 'Sequence Diagram',
          },
        ],
      };

      // When: building context
      const context = buildContextFromState(
        contextState,
        'test-project.json',
        'feat-001',
        'Test Feature',
        'Feature',
        'Test description'
      );

      // Then: diagrams[] should contain DiagramBundleSelection objects
      expect(context.architectureContext).toBeDefined();
      expect(context.architectureContext!.diagrams).toBeDefined();
      expect(context.architectureContext!.diagrams).toHaveLength(2);

      // Verify diagram fields
      const diagram1 = context.architectureContext!.diagrams![0];
      expect(diagram1.diagram_id).toBe('diag-001');
      expect(diagram1.bundle_type).toBe('diagram_only');

      // Verify default bundle_type for diagram without one
      const diagram2 = context.architectureContext!.diagrams![1];
      expect(diagram2.diagram_id).toBe('diag-002');
      expect(diagram2.bundle_type).toBe('diagram_only');
    });
  });

  describe('Task 2.1 - depth defaults to 1 when undefined', () => {
    it('should default depth to 1 when EntityRef.depth is undefined', () => {
      // Given: context state with entity ref without depth
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'logicalDataEntities',
            entity_id: 'lde-789',
            label: 'Order Entity',
            bundle_type: 'entity_with_attributes_and_relationships',
            // depth is intentionally undefined
          },
        ],
        diagram_refs: [],
      };

      // When: building context
      const context = buildContextFromState(
        contextState,
        'test-project.json',
        'feat-001',
        'Test Feature',
        'Feature',
        'Test description'
      );

      // Then: depth should default to 1
      const entity = context.architectureContext!.entities![0];
      expect(entity.depth).toBe(1);
    });

    it('should preserve depth when explicitly set in EntityRef', () => {
      // Given: context state with entity refs with different depths
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-001',
            label: 'Table 1',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 1,
          },
          {
            kind: 'ENTITY',
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-002',
            label: 'Table 2',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 2,
          },
        ],
        diagram_refs: [],
      };

      // When: building context
      const context = buildContextFromState(
        contextState,
        'test-project.json',
        'feat-001',
        'Test Feature',
        'Feature',
        'Test description'
      );

      // Then: depths should be preserved
      expect(context.architectureContext!.entities![0].depth).toBe(1);
      expect(context.architectureContext!.entities![1].depth).toBe(2);
    });
  });

  describe('Task 2.4 - maintain legacy entityIds/diagramIds', () => {
    it('should maintain legacy entityIds and diagramIds for backward compatibility', () => {
      // Given: context state with both entity and diagram refs
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-123',
            label: 'Users Table',
            bundle_type: 'entity_with_attributes_and_relationships',
            depth: 1,
          },
        ],
        diagram_refs: [
          {
            kind: 'DIAGRAM',
            diagram_id: 'diag-001',
            label: 'ER Diagram',
            bundle_type: 'diagram_only',
          },
        ],
      };

      // When: building context
      const context = buildContextFromState(
        contextState,
        'test-project.json',
        'feat-001',
        'Test Feature',
        'Feature',
        'Test description'
      );

      // Then: legacy arrays should be populated
      expect(context.architectureContext!.entityIds).toBeDefined();
      expect(context.architectureContext!.entityIds).toContain('physicalDataEntities::pde-123');

      expect(context.architectureContext!.diagramIds).toBeDefined();
      expect(context.architectureContext!.diagramIds).toContain('diag-001');

      // AND: new structured arrays should also be populated
      expect(context.architectureContext!.entities).toHaveLength(1);
      expect(context.architectureContext!.diagrams).toHaveLength(1);
    });
  });
});
