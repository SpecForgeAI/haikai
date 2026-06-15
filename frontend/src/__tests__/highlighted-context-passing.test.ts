/**
 * Tests for Highlighted Context Passing - Stage 4
 *
 * Spec: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 * Task Group 1: Frontend Type Alignment and Verification
 *
 * Tests verify that:
 * - buildContext() includes entityIds from contextState.entity_refs
 * - buildContext() includes diagramIds from contextState.diagram_refs
 * - Cleared selections result in empty arrays [] (not undefined)
 */

import { ContextState } from '../utils/contextStorage';
import { ImplementChatContext, ArchitectureContextPayload } from '../api/chatApi';

/**
 * Simulates the buildContext logic from ImplementationAssistantPanel
 * This is extracted to test the core logic without React component complexity
 */
function buildContext(
  workItemId: string,
  workItemTitle: string,
  workItemType: string,
  workItemDescription: string,
  projectId: string,
  contextState: ContextState,
  intent: 'normal_chat' | 'generate_specs',
  phase: 'bootstrap' | 'refine' | 'handoff'
): ImplementChatContext {
  const entityIds = contextState.entity_refs.map((ref) => ref.entity_id);
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

describe('Highlighted Context Passing - Stage 4', () => {
  describe('buildContext() includes entityIds from contextState.entity_refs', () => {
    it('should map entity_refs to architectureContext.entityIds', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'services::svc-001', label: 'UserService' },
          { kind: 'ENTITY', entity_type: 'classes', entity_id: 'classes::cls-002', label: 'UserController' },
        ],
        diagram_refs: [],
      };

      const result = buildContext(
        'WI-123',
        'Test Feature',
        'Feature',
        'Test description',
        'test-project.json',
        contextState,
        'normal_chat',
        'refine'
      );

      // Verify entityIds are extracted correctly from entity_refs
      expect(result.architectureContext.entityIds).toEqual([
        'services::svc-001',
        'classes::cls-002',
      ]);
      // Verify type is string[] (highlighted entity IDs for Stage 4)
      expect(Array.isArray(result.architectureContext.entityIds)).toBe(true);
      expect(result.architectureContext.entityIds.length).toBe(2);
    });
  });

  describe('buildContext() includes diagramIds from contextState.diagram_refs', () => {
    it('should map diagram_refs to architectureContext.diagramIds', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diagram-001', label: 'System Overview' },
          { kind: 'DIAGRAM', diagram_id: 'diagram-002', label: 'Sequence Diagram' },
          { kind: 'DIAGRAM', diagram_id: 'diagram-003', label: 'ER Diagram' },
        ],
      };

      const result = buildContext(
        'WI-456',
        'Another Feature',
        'Story',
        'Another description',
        'my-project.json',
        contextState,
        'normal_chat',
        'refine'
      );

      // Verify diagramIds are extracted correctly from diagram_refs
      expect(result.architectureContext.diagramIds).toEqual([
        'diagram-001',
        'diagram-002',
        'diagram-003',
      ]);
      // Verify type is string[] (highlighted diagram IDs for Stage 4)
      expect(Array.isArray(result.architectureContext.diagramIds)).toBe(true);
      expect(result.architectureContext.diagramIds.length).toBe(3);
    });
  });

  describe('Cleared selections result in empty arrays [] (not undefined)', () => {
    it('should return empty arrays when no selections exist', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
      };

      const result = buildContext(
        'WI-789',
        'Empty Feature',
        'Feature',
        'No context',
        'empty-project.json',
        contextState,
        'normal_chat',
        'refine'
      );

      // CRITICAL: Verify empty arrays are returned, not undefined/null
      expect(result.architectureContext.entityIds).toEqual([]);
      expect(result.architectureContext.diagramIds).toEqual([]);
      expect(result.architectureContext.entityIds).not.toBeUndefined();
      expect(result.architectureContext.diagramIds).not.toBeUndefined();
      expect(result.architectureContext.entityIds).not.toBeNull();
      expect(result.architectureContext.diagramIds).not.toBeNull();
      // Verify these are actual arrays
      expect(Array.isArray(result.architectureContext.entityIds)).toBe(true);
      expect(Array.isArray(result.architectureContext.diagramIds)).toBe(true);
    });

    it('should handle context with both entities and diagrams', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'services::svc-100', label: 'OrderService' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diagram-100', label: 'Order Flow' },
        ],
      };

      const result = buildContext(
        'WI-999',
        'Mixed Feature',
        'Feature',
        'Mixed context',
        'mixed-project.json',
        contextState,
        'normal_chat',
        'refine'
      );

      // Both should be present as arrays
      expect(result.architectureContext.entityIds).toEqual(['services::svc-100']);
      expect(result.architectureContext.diagramIds).toEqual(['diagram-100']);
    });
  });

  describe('Type alignment verification', () => {
    it('ArchitectureContextPayload structure matches Gateway expectations', () => {
      // This test verifies compile-time type safety for Stage 4
      const payload: ArchitectureContextPayload = {
        entityIds: ['services::svc-001'],
        diagramIds: ['diagram-001'],
      };

      // Verify structure matches what Gateway expects for highlighted context
      expect(payload).toHaveProperty('entityIds');
      expect(payload).toHaveProperty('diagramIds');
      expect(Array.isArray(payload.entityIds)).toBe(true);
      expect(Array.isArray(payload.diagramIds)).toBe(true);
    });
  });
});
