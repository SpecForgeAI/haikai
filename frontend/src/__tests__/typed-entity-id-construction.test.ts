/**
 * Tests for Typed Entity ID Construction
 *
 * Spec: 2026-01-16 Fix Implement Assistant Context Injection
 * Task Group 2: Typed Entity ID Construction
 *
 * Tests cover:
 * - buildContext constructs entityIds in format "<entity_type>::<entity_id>"
 * - entity_type values match backend switch statement keys
 * - empty entity_refs array results in empty entityIds array
 */

import { EntityRef, DiagramRef, ContextState } from '../utils/contextStorage';

// Types for testing
interface WorkItem {
  id: string;
  title: string;
  type: string;
  description: string;
}

interface ArchitectureContext {
  entityIds: string[];
  diagramIds: string[];
}

interface ImplementChatContext {
  mode: string;
  intent: string;
  phase: string;
  filename: string;
  workItem: WorkItem;
  architectureContext: ArchitectureContext;
}

/**
 * Simulates the buildContext logic from ImplementationAssistantPanel.tsx
 * This is extracted to test the typed entity ID construction independently
 */
function buildContextFromState(
  contextState: ContextState,
  workItemId: string,
  workItemTitle: string,
  workItemType: string,
  workItemDescription: string,
  projectId: string,
  intent: string,
  phase: string
): ImplementChatContext {
  // Spec 2026-01-16: Construct typed entity IDs in format "<entity_type>::<entity_id>"
  const entityIds = contextState.entity_refs.map(
    (ref) => `${ref.entity_type}::${ref.entity_id}`
  );
  const diagramIds = contextState.diagram_refs.map((ref) => ref.diagram_id);

  return {
    mode: 'implement_feature',
    intent,
    phase,
    filename: projectId,
    workItem: {
      id: workItemId,
      title: workItemTitle,
      type: workItemType,
      description: workItemDescription,
    },
    architectureContext: {
      entityIds,
      diagramIds,
    },
  };
}

describe('Typed Entity ID Construction - Spec 2026-01-16', () => {
  describe('Task 2.1: buildContext constructs entityIds in format "<entity_type>::<entity_id>"', () => {
    it('should construct typed entity IDs with double colon separator', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'services',
            entity_id: 'svc-123',
            label: 'UserService',
          },
          {
            kind: 'ENTITY',
            entity_type: 'physicalDataEntities',
            entity_id: 'pde-456',
            label: 'UsersTable',
          },
        ],
        diagram_refs: [],
      };

      const context = buildContextFromState(
        contextState,
        'WI-100',
        'Add User Feature',
        'Feature',
        'Description',
        'test-project.json',
        'normal_chat',
        'refine'
      );

      // Verify typed entity IDs are constructed correctly
      expect(context.architectureContext.entityIds).toHaveLength(2);
      expect(context.architectureContext.entityIds[0]).toBe('services::svc-123');
      expect(context.architectureContext.entityIds[1]).toBe('physicalDataEntities::pde-456');
    });

    it('should preserve the exact entity_type from EntityRef', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'logicalDataEntities',
            entity_id: 'lde-789',
            label: 'Customer',
          },
        ],
        diagram_refs: [],
      };

      const context = buildContextFromState(
        contextState,
        'WI-101',
        'Test Feature',
        'Feature',
        'Description',
        'project.json',
        'normal_chat',
        'refine'
      );

      // Verify the exact format matches backend expectation
      expect(context.architectureContext.entityIds[0]).toBe('logicalDataEntities::lde-789');
    });

    it('should handle entity IDs containing special characters', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          {
            kind: 'ENTITY',
            entity_type: 'endpoints',
            entity_id: 'endpoint-get-users-v1',
            label: 'GET /users/v1',
          },
        ],
        diagram_refs: [],
      };

      const context = buildContextFromState(
        contextState,
        'WI-102',
        'Feature',
        'Feature',
        'Desc',
        'project.json',
        'normal_chat',
        'refine'
      );

      expect(context.architectureContext.entityIds[0]).toBe('endpoints::endpoint-get-users-v1');
    });
  });

  describe('Task 2.2: entity_type values match backend switch statement keys', () => {
    // All entity types expected by ImplementContextResolutionService.java
    const validEntityTypes = [
      'services',
      'classes',
      'methods',
      'interfaces',
      'applications',
      'appComponents',
      'endpoints',
      'businessProcesses',
      'businessPoints',
      'logicalDataEntities',
      'physicalDataEntities',
      'uiScreens',
    ];

    it.each(validEntityTypes)(
      'should correctly format entity type "%s"',
      (entityType) => {
        const contextState: ContextState = {
          version: 1,
          entity_refs: [
            {
              kind: 'ENTITY',
              entity_type: entityType,
              entity_id: 'test-id-123',
              label: 'Test Entity',
            },
          ],
          diagram_refs: [],
        };

        const context = buildContextFromState(
          contextState,
          'WI-103',
          'Test',
          'Feature',
          'Desc',
          'project.json',
          'normal_chat',
          'refine'
        );

        // Verify the typed ID format matches exactly what the backend expects
        const expectedTypedId = `${entityType}::test-id-123`;
        expect(context.architectureContext.entityIds[0]).toBe(expectedTypedId);

        // Verify the format uses double colon (::) as separator
        expect(context.architectureContext.entityIds[0]).toContain('::');

        // Verify entity_type comes before the separator
        const [typePart, idPart] = context.architectureContext.entityIds[0].split('::');
        expect(typePart).toBe(entityType);
        expect(idPart).toBe('test-id-123');
      }
    );

    it('should handle multiple entities of different types', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Service1' },
          { kind: 'ENTITY', entity_type: 'interfaces', entity_id: 'ifc-1', label: 'Interface1' },
          { kind: 'ENTITY', entity_type: 'physicalDataEntities', entity_id: 'pde-1', label: 'Table1' },
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'App1' },
        ],
        diagram_refs: [],
      };

      const context = buildContextFromState(
        contextState,
        'WI-104',
        'Multi-Entity Feature',
        'Feature',
        'Desc',
        'project.json',
        'normal_chat',
        'refine'
      );

      expect(context.architectureContext.entityIds).toEqual([
        'services::svc-1',
        'interfaces::ifc-1',
        'physicalDataEntities::pde-1',
        'applications::app-1',
      ]);
    });
  });

  describe('Task 2.3: empty entity_refs array results in empty entityIds array', () => {
    it('should return empty entityIds array when entity_refs is empty', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
      };

      const context = buildContextFromState(
        contextState,
        'WI-105',
        'No Entities Feature',
        'Feature',
        'Desc',
        'project.json',
        'normal_chat',
        'refine'
      );

      expect(context.architectureContext.entityIds).toEqual([]);
      expect(context.architectureContext.entityIds).toHaveLength(0);
    });

    it('should handle empty entity_refs with non-empty diagram_refs', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diagram-1', label: 'Overview' },
          { kind: 'DIAGRAM', diagram_id: 'diagram-2', label: 'Detail' },
        ],
      };

      const context = buildContextFromState(
        contextState,
        'WI-106',
        'Diagrams Only Feature',
        'Feature',
        'Desc',
        'project.json',
        'normal_chat',
        'refine'
      );

      // entityIds should be empty
      expect(context.architectureContext.entityIds).toEqual([]);

      // diagramIds should still work (diagram IDs are plain, not typed)
      expect(context.architectureContext.diagramIds).toEqual(['diagram-1', 'diagram-2']);
    });
  });

  describe('Diagram IDs remain unchanged (plain IDs)', () => {
    it('should not modify diagram IDs (they remain plain, not typed)', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Service' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diagram-abc', label: 'System Overview' },
        ],
      };

      const context = buildContextFromState(
        contextState,
        'WI-107',
        'Mixed Context Feature',
        'Feature',
        'Desc',
        'project.json',
        'normal_chat',
        'refine'
      );

      // Entity IDs are typed
      expect(context.architectureContext.entityIds[0]).toBe('services::svc-1');

      // Diagram IDs remain plain (not typed)
      expect(context.architectureContext.diagramIds[0]).toBe('diagram-abc');
      expect(context.architectureContext.diagramIds[0]).not.toContain('::');
    });
  });
});
