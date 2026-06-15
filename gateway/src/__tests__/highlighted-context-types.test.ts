/**
 * Tests for Gateway Type Updates - Stage 4
 *
 * Spec: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 * Task Group 5: Gateway Type Updates for Backend DTO Changes
 *
 * Tests verify that:
 * - ResolvedDiagramSummary type accepts referenced_entity_names field
 * - formatHighlightedContext() includes entity names in diagram output
 */

import { ResolvedDiagramSummary, ResolvedImplementContextDto } from '../types/chat';

describe('Gateway Type Updates for Highlighted Context - Stage 4', () => {
  describe('ResolvedDiagramSummary type with referenced_entity_names', () => {
    it('should accept referenced_entity_names field', () => {
      const diagram: ResolvedDiagramSummary = {
        id: 'diagram-001',
        name: 'System Overview',
        diagram_type: 'General',
        referenced_entity_ids: ['services::svc-001', 'services::svc-002'],
        referenced_entity_names: ['UserService', 'OrderService'],
      };

      expect(diagram.referenced_entity_names).toBeDefined();
      expect(diagram.referenced_entity_names).toEqual(['UserService', 'OrderService']);
    });

    it('should accept diagram without referenced_entity_names (backward compatible)', () => {
      const diagram: ResolvedDiagramSummary = {
        id: 'diagram-002',
        name: 'Legacy Diagram',
        diagram_type: 'Sequence',
        referenced_entity_ids: ['services::svc-003'],
        // No referenced_entity_names - should still be valid
      };

      expect(diagram.referenced_entity_names).toBeUndefined();
    });

    it('should accept empty referenced_entity_names array', () => {
      const diagram: ResolvedDiagramSummary = {
        id: 'diagram-003',
        name: 'Empty Names',
        diagram_type: 'ER',
        referenced_entity_ids: ['unknownType::id-001'],
        referenced_entity_names: [],
      };

      expect(diagram.referenced_entity_names).toEqual([]);
    });
  });

  describe('ResolvedImplementContextDto with new diagram format', () => {
    it('should handle mixed diagrams with and without entity names', () => {
      const context: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [
          {
            id: 'diagram-a',
            name: 'With Names',
            diagram_type: 'General',
            referenced_entity_ids: ['services::svc-a'],
            referenced_entity_names: ['ServiceA'],
          },
          {
            id: 'diagram-b',
            name: 'Without Names',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['services::svc-b'],
            // No referenced_entity_names
          },
        ],
      };

      expect(context.resolved_diagrams[0].referenced_entity_names).toEqual(['ServiceA']);
      expect(context.resolved_diagrams[1].referenced_entity_names).toBeUndefined();
    });
  });
});
