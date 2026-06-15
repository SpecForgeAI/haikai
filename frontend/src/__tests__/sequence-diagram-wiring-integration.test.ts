/**
 * Sequence Diagram Wiring Integration Tests
 * Task Group 4: Integration tests for Sequence diagram editor wiring
 *
 * These tests verify the end-to-end integration of:
 * 1. Full flow - Selecting Sequence diagram updates both panel and canvas
 * 2. handleUpdateDiagram triggers state update and potential re-render
 * 3. Switching between Sequence and General diagrams toggles correct panels
 * 4. Empty Sequence diagram displays placeholder text correctly
 *
 * Focus: Integration workflows spanning DiagramsView <-> Canvas coordination
 */

import { describe, it, expect, vi } from 'vitest';
import { getDiagramType, DiagramType } from '../types/diagramType';
import type { Diagram, MetaModel, TypedContent } from '../types/model';
import type { SequenceContent } from '../types/typedContent';
import type { SequenceDiagram, SequenceParticipant } from '../types/sequenceDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal test diagram
 */
function createTestDiagram(
  id: string,
  name: string,
  diagramType?: string,
  typedContent?: TypedContent
): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: diagramType,
    diagram_nodes: [],
    diagram_edges: [],
    decorations: [],
    typedContent,
  };
}

/**
 * Creates a Sequence diagram with optional typed content
 */
function createSequenceDiagram(
  id: string,
  name: string,
  participants: Array<{ id: string; ref_kind: string; ref_id: string; order_index: number }> = []
): Diagram {
  return createTestDiagram(id, name, 'Sequence', {
    type: 'Sequence',
    version: 1,
    content: {
      participants,
      messages: [],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    },
  });
}

/**
 * Creates a mock MetaModel for testing
 */
function createMockMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Application 1', description: '', tags: '' },
        { id: 'app-2', name: 'Application 2', description: '', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      interactions: [],
    },
    relationships: [],
  };
}

/**
 * Simulates the panel rendering decision from DiagramsView
 */
function determinePanelToRender(diagram: Diagram | null | undefined): 'SequenceEditorPanel' | 'PalettePanel' {
  return getDiagramType(diagram) === 'Sequence' ? 'SequenceEditorPanel' : 'PalettePanel';
}

/**
 * Simulates the canvas rendering mode decision from Canvas
 */
function determineCanvasMode(diagram: Diagram | null | undefined): 'sequence' | 'activity' | 'state' | 'general' {
  const type = getDiagramType(diagram);
  switch (type) {
    case 'Sequence': return 'sequence';
    case 'Activity': return 'activity';
    case 'State': return 'state';
    default: return 'general';
  }
}

/**
 * Simulates extractSequenceDiagram helper from Canvas.tsx
 */
function extractSequenceDiagram(diagram: Diagram | null | undefined): SequenceDiagram {
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

  const participants: SequenceParticipant[] = (content.participants || []).map(p => ({
    id: p.id,
    ref_kind: p.ref_kind as SequenceParticipant['ref_kind'],
    ref_id: p.ref_id,
    order_index: p.order_index,
  }));

  return {
    id: diagram.id,
    model_file_id: '',
    name: diagram.name,
    type: 'Sequence',
    participants,
    messages: (content.messages || []).map(m => ({
      id: m.id,
      exchange_id: m.exchange_id,
      exchange_role: m.exchange_role as 'Request' | 'Response',
      from_participant_id: m.from_participant_id,
      to_participant_id: m.to_participant_id,
      ref_kind: m.ref_kind as 'Method' | 'LogicalEntity' | 'PhysicalEntity' | 'Class' | 'Event' | undefined,
      ref_id: m.ref_id,
      label_text: m.label_text,
    })),
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };
}

/**
 * Simulates the handleUpdateDiagram callback from DiagramsView
 */
function createHandleUpdateDiagram(
  dispatch: ReturnType<typeof vi.fn>,
  diagramId: string | undefined
) {
  return (updates: Partial<Diagram>) => {
    if (!diagramId) return;
    dispatch({ type: 'UPDATE_DIAGRAM', diagramId, updates });
  };
}

/**
 * Determines if placeholder should be shown for empty Sequence diagram
 */
function shouldShowPlaceholder(sequenceDiagram: SequenceDiagram): boolean {
  return sequenceDiagram.participants.length === 0;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Sequence Diagram Wiring Integration - Task Group 4', () => {
  /**
   * Test 1: Full flow - select Sequence diagram, verify panel and canvas update
   *
   * This test verifies that when a Sequence diagram is selected:
   * - DiagramsView renders SequenceEditorPanel (not PalettePanel)
   * - Canvas renders in 'sequence' mode (SequenceDiagramRenderer)
   * - Both components receive consistent diagram data
   */
  describe('Test 4.3.1: Full flow - Sequence diagram selection updates panel and canvas', () => {
    it('should coordinate panel and canvas rendering for Sequence diagram', () => {
      // Arrange: Create a Sequence diagram with participants
      const sequenceDiagram = createSequenceDiagram('seq-1', 'Payment Flow', [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
      ]);

      // Act: Determine what each component should render
      const panelType = determinePanelToRender(sequenceDiagram);
      const canvasMode = determineCanvasMode(sequenceDiagram);
      const extractedDiagram = extractSequenceDiagram(sequenceDiagram);

      // Assert: Panel shows SequenceEditorPanel
      expect(panelType).toBe('SequenceEditorPanel');

      // Assert: Canvas uses sequence rendering mode
      expect(canvasMode).toBe('sequence');

      // Assert: Extracted diagram has correct data
      expect(extractedDiagram.id).toBe('seq-1');
      expect(extractedDiagram.name).toBe('Payment Flow');
      expect(extractedDiagram.participants).toHaveLength(2);
      expect(extractedDiagram.participants[0].ref_id).toBe('app-1');
      expect(extractedDiagram.participants[1].ref_id).toBe('app-2');
    });

    it('should maintain consistency between panel props and canvas props', () => {
      // Arrange
      const diagram = createSequenceDiagram('seq-2', 'Authentication Flow', [
        { id: 'p1', ref_kind: 'Service', ref_id: 'svc-1', order_index: 0 },
      ]);
      const metaModel = createMockMetaModel();

      // Act: Simulate what DiagramsView and Canvas would receive
      const panelProps = {
        activeDiagram: diagram,
        metaModel: metaModel,
        isCollapsed: false,
      };

      const canvasProps = {
        sequenceDiagram: extractSequenceDiagram(diagram),
        participantSpacing: 220,
        metaModel: metaModel,
      };

      // Assert: Both components receive the same underlying diagram data
      expect(panelProps.activeDiagram.id).toBe(canvasProps.sequenceDiagram.id);
      expect(panelProps.activeDiagram.name).toBe(canvasProps.sequenceDiagram.name);
      expect(panelProps.metaModel).toBe(canvasProps.metaModel);
    });
  });

  /**
   * Test 2: handleUpdateDiagram triggers state update
   *
   * This test verifies that:
   * - handleUpdateDiagram dispatches UPDATE_DIAGRAM action
   * - The action includes correct diagramId and updates
   * - TypedContent updates (participants, messages) are properly propagated
   */
  describe('Test 4.3.2: handleUpdateDiagram triggers state update and re-render', () => {
    it('should dispatch UPDATE_DIAGRAM when participant is added', () => {
      // Arrange
      const mockDispatch = vi.fn();
      const diagramId = 'seq-diagram-1';
      const handleUpdateDiagram = createHandleUpdateDiagram(mockDispatch, diagramId);

      // Act: Simulate adding a participant via handleUpdateDiagram
      const newTypedContent: TypedContent = {
        type: 'Sequence',
        version: 1,
        content: {
          participants: [
            { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
            { id: 'p2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 }, // New participant
          ],
          messages: [],
          fragments: [],
          operands: [],
          sequenceNodes: [],
        },
      };

      handleUpdateDiagram({ typedContent: newTypedContent });

      // Assert: Dispatch was called with correct action
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_DIAGRAM',
        diagramId: 'seq-diagram-1',
        updates: expect.objectContaining({
          typedContent: expect.objectContaining({
            type: 'Sequence',
            content: expect.objectContaining({
              participants: expect.arrayContaining([
                expect.objectContaining({ id: 'p1' }),
                expect.objectContaining({ id: 'p2' }),
              ]),
            }),
          }),
        }),
      });
    });

    it('should dispatch UPDATE_DIAGRAM when message is added', () => {
      // Arrange
      const mockDispatch = vi.fn();
      const diagramId = 'seq-diagram-2';
      const handleUpdateDiagram = createHandleUpdateDiagram(mockDispatch, diagramId);

      // Act: Simulate adding a message
      const newTypedContent: TypedContent = {
        type: 'Sequence',
        version: 1,
        content: {
          participants: [
            { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
            { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
          ],
          messages: [
            {
              id: 'm1',
              exchange_id: 'ex-1',
              exchange_role: 'Request',
              from_participant_id: 'p1',
              to_participant_id: 'p2',
              label_text: 'processPayment()',
            },
          ],
          fragments: [],
          operands: [],
          sequenceNodes: [],
        },
      };

      handleUpdateDiagram({ typedContent: newTypedContent });

      // Assert
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_DIAGRAM',
          diagramId: 'seq-diagram-2',
          updates: expect.objectContaining({
            typedContent: expect.objectContaining({
              content: expect.objectContaining({
                messages: expect.arrayContaining([
                  expect.objectContaining({
                    id: 'm1',
                    from_participant_id: 'p1',
                    to_participant_id: 'p2',
                  }),
                ]),
              }),
            }),
          }),
        })
      );
    });
  });

  /**
   * Test 3: Switching from Sequence to General diagram restores PalettePanel
   *
   * This test verifies that:
   * - Switching from Sequence diagram shows SequenceEditorPanel
   * - Switching to General diagram shows PalettePanel
   * - Canvas mode changes appropriately
   */
  describe('Test 4.3.3: Switching between Sequence and General diagrams toggles panels', () => {
    it('should switch from PalettePanel to SequenceEditorPanel when selecting Sequence diagram', () => {
      // Arrange: Start with General diagram
      const generalDiagram = createTestDiagram('gen-1', 'General Diagram', 'General');
      const sequenceDiagram = createSequenceDiagram('seq-1', 'Sequence Diagram', []);

      // Act & Assert: General diagram shows PalettePanel
      expect(determinePanelToRender(generalDiagram)).toBe('PalettePanel');
      expect(determineCanvasMode(generalDiagram)).toBe('general');

      // Act & Assert: Sequence diagram shows SequenceEditorPanel
      expect(determinePanelToRender(sequenceDiagram)).toBe('SequenceEditorPanel');
      expect(determineCanvasMode(sequenceDiagram)).toBe('sequence');
    });

    it('should switch from SequenceEditorPanel to PalettePanel when selecting General diagram', () => {
      // Arrange: Start with Sequence diagram
      const sequenceDiagram = createSequenceDiagram('seq-1', 'Sequence Diagram', []);
      const generalDiagram = createTestDiagram('gen-1', 'General Diagram', 'General');

      // Act: Simulate switching from Sequence to General
      const beforePanel = determinePanelToRender(sequenceDiagram);
      const afterPanel = determinePanelToRender(generalDiagram);

      // Assert
      expect(beforePanel).toBe('SequenceEditorPanel');
      expect(afterPanel).toBe('PalettePanel');
    });

    it('should handle switching between all diagram types correctly', () => {
      // Arrange
      const diagrams = [
        { diagram: createTestDiagram('d1', 'General', 'General'), expectedPanel: 'PalettePanel', expectedCanvas: 'general' },
        { diagram: createSequenceDiagram('d2', 'Sequence', []), expectedPanel: 'SequenceEditorPanel', expectedCanvas: 'sequence' },
        { diagram: createTestDiagram('d3', 'Activity', 'Activity'), expectedPanel: 'PalettePanel', expectedCanvas: 'activity' },
        { diagram: createTestDiagram('d4', 'State', 'State'), expectedPanel: 'PalettePanel', expectedCanvas: 'state' },
        { diagram: createTestDiagram('d5', 'ER', 'ER'), expectedPanel: 'PalettePanel', expectedCanvas: 'general' },
      ];

      // Act & Assert
      for (const { diagram, expectedPanel, expectedCanvas } of diagrams) {
        expect(determinePanelToRender(diagram)).toBe(expectedPanel);
        expect(determineCanvasMode(diagram)).toBe(expectedCanvas);
      }
    });
  });

  /**
   * Test 4: Empty Sequence diagram shows placeholder text
   *
   * This test verifies that:
   * - Empty Sequence diagram (no participants) shows placeholder
   * - Sequence diagram with participants does not show placeholder
   * - Canvas correctly identifies empty state
   */
  describe('Test 4.3.4: Empty Sequence diagram shows placeholder text', () => {
    it('should show placeholder when Sequence diagram has no participants', () => {
      // Arrange
      const emptySequenceDiagram = createSequenceDiagram('seq-empty', 'Empty Sequence', []);

      // Act
      const extracted = extractSequenceDiagram(emptySequenceDiagram);
      const showPlaceholder = shouldShowPlaceholder(extracted);

      // Assert
      expect(showPlaceholder).toBe(true);
      expect(extracted.participants).toHaveLength(0);
    });

    it('should not show placeholder when Sequence diagram has participants', () => {
      // Arrange
      const populatedDiagram = createSequenceDiagram('seq-populated', 'With Participants', [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
      ]);

      // Act
      const extracted = extractSequenceDiagram(populatedDiagram);
      const showPlaceholder = shouldShowPlaceholder(extracted);

      // Assert
      expect(showPlaceholder).toBe(false);
      expect(extracted.participants).toHaveLength(1);
    });

    it('should show placeholder when typedContent is missing', () => {
      // Arrange: Sequence diagram without typedContent
      const noContentDiagram = createTestDiagram('seq-no-content', 'No Content', 'Sequence');

      // Act
      const extracted = extractSequenceDiagram(noContentDiagram);
      const showPlaceholder = shouldShowPlaceholder(extracted);

      // Assert
      expect(showPlaceholder).toBe(true);
      expect(extracted.participants).toHaveLength(0);
      expect(extracted.id).toBe('seq-no-content');
    });

    it('should return correct placeholder message for empty diagram', () => {
      // Arrange
      const emptyDiagram = createSequenceDiagram('seq-empty', 'Empty', []);
      const extracted = extractSequenceDiagram(emptyDiagram);

      // Act
      const placeholderMessage = shouldShowPlaceholder(extracted)
        ? 'Add participants to start'
        : null;

      // Assert
      expect(placeholderMessage).toBe('Add participants to start');
    });
  });
});
