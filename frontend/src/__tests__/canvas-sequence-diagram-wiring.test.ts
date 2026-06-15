/**
 * Canvas Sequence Diagram Wiring Tests
 * Task Group 2: Tests for SequenceDiagramRenderer conditional rendering in Canvas
 *
 * Tests that:
 * 1. Sequence diagram renders SequenceDiagramRenderer
 * 2. Activity diagrams still render ActivityDiagramRenderer
 * 3. State diagrams still render StateDiagramRenderer
 * 4. General diagrams render generic node/edge canvas
 */

import { describe, it, expect } from 'vitest';
import { getDiagramType, DiagramType } from '../types/diagramType';
import { SequenceDiagram, SequenceParticipant } from '../types/sequenceDiagram';
import { SequenceContent } from '../types/typedContent';
import type { Diagram } from '../types/model';

/**
 * Helper to create a minimal diagram for testing
 */
function createTestDiagram(id: string, name: string, diagramType?: string): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: diagramType,
    diagram_nodes: [],
    diagram_edges: [],
    decorations: [],
  };
}

/**
 * Helper to create a test diagram with typedContent for Sequence diagrams
 */
function createSequenceDiagramWithContent(
  id: string,
  name: string,
  participants: Array<{ id: string; ref_kind: string; ref_id: string; order_index: number }> = []
): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: 'Sequence',
    diagram_nodes: [],
    diagram_edges: [],
    decorations: [],
    typedContent: {
      type: 'Sequence',
      version: 1,
      content: {
        participants,
        messages: [],
        fragments: [],
        operands: [],
        sequenceNodes: [],
      },
    },
  };
}

/**
 * Simulates the extractSequenceDiagram helper function from Canvas.tsx
 * Converts Diagram.typedContent to SequenceDiagram format
 */
function extractSequenceDiagram(diagram: Diagram | null | undefined): SequenceDiagram {
  // Default empty sequence diagram structure
  const emptyDiagram: SequenceDiagram = {
    id: diagram?.id || '',
    model_file_id: '',
    name: diagram?.name || '',
    type: 'Sequence',
    participants: [],
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };

  if (!diagram?.typedContent) {
    return emptyDiagram;
  }

  const content = diagram.typedContent.content as SequenceContent | undefined;
  if (!content) {
    return emptyDiagram;
  }

  // Map participants from SequenceParticipantRef to SequenceParticipant
  const participants: SequenceParticipant[] = (content.participants || []).map(p => ({
    id: p.id,
    ref_kind: p.ref_kind as SequenceParticipant['ref_kind'],
    ref_id: p.ref_id,
    order_index: p.order_index,
  }));

  // Map messages
  const messages = (content.messages || []).map(m => ({
    id: m.id,
    exchange_id: m.exchange_id,
    exchange_role: m.exchange_role as 'Request' | 'Response',
    from_participant_id: m.from_participant_id,
    to_participant_id: m.to_participant_id,
    ref_kind: m.ref_kind as 'Method' | 'LogicalEntity' | 'PhysicalEntity' | 'Class' | 'Event' | undefined,
    ref_id: m.ref_id,
    label_text: m.label_text,
  }));

  // Map fragments
  const fragments = (content.fragments || []).map(f => ({
    id: f.id,
    fragment_kind: f.fragment_kind as 'Loop' | 'Optional' | 'Alternative',
    label_text: f.label_text,
  }));

  // Map operands
  const operands = (content.operands || []).map(o => ({
    id: o.id,
    fragment_id: o.fragment_id,
    guard_expression: o.guard_expression,
    operand_index: o.operand_index,
  }));

  // Map sequence nodes
  const sequence_nodes = (content.sequenceNodes || []).map(n => ({
    id: n.id,
    node_kind: n.node_kind as 'Message' | 'Fragment',
    message_id: n.message_id,
    fragment_id: n.fragment_id,
    order_index: n.order_index,
    parent_node_id: n.parent_node_id,
    parent_operand_id: n.parent_operand_id,
  }));

  return {
    id: diagram.id,
    model_file_id: '',
    name: diagram.name,
    type: 'Sequence',
    participants,
    messages,
    fragments,
    operands,
    sequence_nodes,
  };
}

/**
 * Determines rendering mode for a diagram based on diagram type
 * Mirrors the conditional logic in Canvas.tsx
 */
function getCanvasRenderMode(diagram: Diagram | null | undefined): 'sequence' | 'activity' | 'state' | 'general' {
  const diagramType = getDiagramType(diagram);

  if (diagramType === 'Sequence') {
    return 'sequence';
  } else if (diagramType === 'Activity') {
    return 'activity';
  } else if (diagramType === 'State') {
    return 'state';
  }
  return 'general';
}

describe('Canvas Sequence Diagram Wiring', () => {
  describe('Task 2.1: Conditional Canvas Rendering', () => {
    describe('Sequence diagram renders SequenceDiagramRenderer', () => {
      it('should select sequence render mode for diagram_type="Sequence"', () => {
        const diagram = createTestDiagram('diag-1', 'My Sequence Diagram', 'Sequence');

        expect(getCanvasRenderMode(diagram)).toBe('sequence');
      });

      it('should select sequence render mode for case-insensitive "sequence"', () => {
        const diagram = createTestDiagram('diag-2', 'Another Seq', 'sequence');

        expect(getCanvasRenderMode(diagram)).toBe('sequence');
      });

      it('should select sequence render mode for uppercase "SEQUENCE"', () => {
        const diagram = createTestDiagram('diag-3', 'Seq Test', 'SEQUENCE');

        expect(getCanvasRenderMode(diagram)).toBe('sequence');
      });
    });

    describe('Activity diagrams render ActivityDiagramRenderer', () => {
      it('should select activity render mode for diagram_type="Activity"', () => {
        const diagram = createTestDiagram('diag-4', 'Activity Diagram', 'Activity');

        expect(getCanvasRenderMode(diagram)).toBe('activity');
      });

      it('should select activity render mode for case-insensitive "activity"', () => {
        const diagram = createTestDiagram('diag-5', 'Activity Test', 'activity');

        expect(getCanvasRenderMode(diagram)).toBe('activity');
      });
    });

    describe('State diagrams render StateDiagramRenderer', () => {
      it('should select state render mode for diagram_type="State"', () => {
        const diagram = createTestDiagram('diag-6', 'State Diagram', 'State');

        expect(getCanvasRenderMode(diagram)).toBe('state');
      });

      it('should select state render mode for case-insensitive "state"', () => {
        const diagram = createTestDiagram('diag-7', 'State Test', 'state');

        expect(getCanvasRenderMode(diagram)).toBe('state');
      });
    });

    describe('General diagrams render generic node/edge canvas', () => {
      it('should select general render mode for diagram_type="General"', () => {
        const diagram = createTestDiagram('diag-8', 'General Diagram', 'General');

        expect(getCanvasRenderMode(diagram)).toBe('general');
      });

      it('should select general render mode for diagram_type="ER"', () => {
        const diagram = createTestDiagram('diag-9', 'ER Diagram', 'ER');

        expect(getCanvasRenderMode(diagram)).toBe('general');
      });

      it('should select general render mode when diagram_type is undefined', () => {
        const diagram = createTestDiagram('diag-10', 'No Type', undefined);

        expect(getCanvasRenderMode(diagram)).toBe('general');
      });

      it('should select general render mode when diagram is null', () => {
        expect(getCanvasRenderMode(null)).toBe('general');
      });

      it('should select general render mode when diagram is undefined', () => {
        expect(getCanvasRenderMode(undefined)).toBe('general');
      });
    });
  });

  describe('Task 2.4: extractSequenceDiagram helper function', () => {
    describe('Converts typedContent to SequenceDiagram format', () => {
      it('should return empty structure when typedContent is undefined', () => {
        const diagram = createTestDiagram('diag-1', 'No Content', 'Sequence');

        const result = extractSequenceDiagram(diagram);

        expect(result.participants).toEqual([]);
        expect(result.messages).toEqual([]);
        expect(result.fragments).toEqual([]);
        expect(result.operands).toEqual([]);
        expect(result.sequence_nodes).toEqual([]);
        expect(result.id).toBe('diag-1');
        expect(result.name).toBe('No Content');
      });

      it('should return empty structure when diagram is null', () => {
        const result = extractSequenceDiagram(null);

        expect(result.participants).toEqual([]);
        expect(result.messages).toEqual([]);
        expect(result.id).toBe('');
        expect(result.name).toBe('');
      });

      it('should correctly map participants from typedContent', () => {
        const diagram = createSequenceDiagramWithContent('seq-1', 'Test Sequence', [
          { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
          { id: 'p2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
        ]);

        const result = extractSequenceDiagram(diagram);

        expect(result.participants).toHaveLength(2);
        expect(result.participants[0]).toEqual({
          id: 'p1',
          ref_kind: 'Application',
          ref_id: 'app-1',
          order_index: 0,
        });
        expect(result.participants[1]).toEqual({
          id: 'p2',
          ref_kind: 'Service',
          ref_id: 'svc-1',
          order_index: 1,
        });
      });

      it('should preserve diagram id and name', () => {
        const diagram = createSequenceDiagramWithContent('my-diagram-id', 'My Sequence Name', []);

        const result = extractSequenceDiagram(diagram);

        expect(result.id).toBe('my-diagram-id');
        expect(result.name).toBe('My Sequence Name');
        expect(result.type).toBe('Sequence');
      });
    });

    describe('Empty state detection for placeholder rendering', () => {
      it('should show empty participants when none exist', () => {
        const diagram = createSequenceDiagramWithContent('seq-empty', 'Empty Seq', []);

        const result = extractSequenceDiagram(diagram);
        const shouldShowPlaceholder = result.participants.length === 0;

        expect(shouldShowPlaceholder).toBe(true);
      });

      it('should not show placeholder when participants exist', () => {
        const diagram = createSequenceDiagramWithContent('seq-with-p', 'Has Participants', [
          { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        ]);

        const result = extractSequenceDiagram(diagram);
        const shouldShowPlaceholder = result.participants.length === 0;

        expect(shouldShowPlaceholder).toBe(false);
      });
    });
  });
});
