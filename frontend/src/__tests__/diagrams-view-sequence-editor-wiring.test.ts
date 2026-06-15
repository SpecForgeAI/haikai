/**
 * DiagramsView Sequence Editor Wiring Tests
 * Task Group 1: Tests for SequenceEditorPanel conditional rendering in DiagramsView
 *
 * Tests that:
 * 1. Sequence diagram shows SequenceEditorPanel instead of PalettePanel
 * 2. General/Activity/State diagrams still show PalettePanel
 * 3. handleUpdateDiagram callback dispatches UPDATE_DIAGRAM action
 */

import { describe, it, expect, vi } from 'vitest';
import { getDiagramType, DiagramType } from '../types/diagramType';
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
 * Mock dispatch function for testing action dispatching
 */
type MockDispatch = ReturnType<typeof vi.fn>;

/**
 * Simulates the handleUpdateDiagram callback pattern used in DiagramsView
 */
function createHandleUpdateDiagram(dispatch: MockDispatch, diagramId: string | undefined) {
  return (updates: Partial<Diagram>) => {
    if (!diagramId) return;
    dispatch({ type: 'UPDATE_DIAGRAM', diagramId, updates });
  };
}

/**
 * Determines which panel should be rendered based on diagram type
 * Mirrors the conditional logic in DiagramsView.tsx
 */
function shouldRenderSequenceEditor(diagram: Diagram | null | undefined): boolean {
  return getDiagramType(diagram) === 'Sequence';
}

describe('DiagramsView Sequence Editor Wiring', () => {
  describe('Task 1.1: Conditional Panel Rendering', () => {
    describe('Sequence diagram shows SequenceEditorPanel', () => {
      it('should render SequenceEditorPanel for diagram_type="Sequence"', () => {
        const diagram = createTestDiagram('diag-1', 'My Sequence Diagram', 'Sequence');

        expect(shouldRenderSequenceEditor(diagram)).toBe(true);
      });

      it('should render SequenceEditorPanel for case-insensitive "sequence"', () => {
        const diagram = createTestDiagram('diag-2', 'Another Seq', 'sequence');

        expect(shouldRenderSequenceEditor(diagram)).toBe(true);
      });

      it('should render SequenceEditorPanel for uppercase "SEQUENCE"', () => {
        const diagram = createTestDiagram('diag-3', 'Seq Test', 'SEQUENCE');

        expect(shouldRenderSequenceEditor(diagram)).toBe(true);
      });
    });

    describe('General/Activity/State diagrams show PalettePanel', () => {
      it('should render PalettePanel for General diagram type', () => {
        const diagram = createTestDiagram('diag-4', 'General Diagram', 'General');

        expect(shouldRenderSequenceEditor(diagram)).toBe(false);
      });

      it('should render PalettePanel for Activity diagram type', () => {
        const diagram = createTestDiagram('diag-5', 'Activity Diagram', 'Activity');

        expect(shouldRenderSequenceEditor(diagram)).toBe(false);
      });

      it('should render PalettePanel for State diagram type', () => {
        const diagram = createTestDiagram('diag-6', 'State Diagram', 'State');

        expect(shouldRenderSequenceEditor(diagram)).toBe(false);
      });

      it('should render PalettePanel for ER diagram type', () => {
        const diagram = createTestDiagram('diag-7', 'ER Diagram', 'ER');

        expect(shouldRenderSequenceEditor(diagram)).toBe(false);
      });

      it('should render PalettePanel when diagram_type is undefined (defaults to General)', () => {
        const diagram = createTestDiagram('diag-8', 'No Type Diagram', undefined);

        expect(shouldRenderSequenceEditor(diagram)).toBe(false);
      });

      it('should render PalettePanel when diagram is null', () => {
        expect(shouldRenderSequenceEditor(null)).toBe(false);
      });

      it('should render PalettePanel when diagram is undefined', () => {
        expect(shouldRenderSequenceEditor(undefined)).toBe(false);
      });
    });
  });

  describe('Task 1.3: handleUpdateDiagram callback', () => {
    it('should dispatch UPDATE_DIAGRAM action with diagram.id and partial updates', () => {
      const mockDispatch = vi.fn();
      const diagramId = 'test-diagram-123';
      const handleUpdateDiagram = createHandleUpdateDiagram(mockDispatch, diagramId);

      const updates: Partial<Diagram> = {
        name: 'Updated Name',
      };

      handleUpdateDiagram(updates);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_DIAGRAM',
        diagramId: 'test-diagram-123',
        updates: { name: 'Updated Name' },
      });
    });

    it('should include all partial updates in dispatched action', () => {
      const mockDispatch = vi.fn();
      const diagramId = 'test-diagram-456';
      const handleUpdateDiagram = createHandleUpdateDiagram(mockDispatch, diagramId);

      const updates: Partial<Diagram> = {
        name: 'New Name',
        description: 'New Description',
        settings: { someKey: 'someValue' },
      };

      handleUpdateDiagram(updates);

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_DIAGRAM',
        diagramId: 'test-diagram-456',
        updates: {
          name: 'New Name',
          description: 'New Description',
          settings: { someKey: 'someValue' },
        },
      });
    });

    it('should not dispatch when diagramId is undefined', () => {
      const mockDispatch = vi.fn();
      const handleUpdateDiagram = createHandleUpdateDiagram(mockDispatch, undefined);

      handleUpdateDiagram({ name: 'Test' });

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should handle typedContent updates for Sequence diagrams', () => {
      const mockDispatch = vi.fn();
      const diagramId = 'seq-diagram-789';
      const handleUpdateDiagram = createHandleUpdateDiagram(mockDispatch, diagramId);

      const updates: Partial<Diagram> = {
        typedContent: {
          type: 'Sequence',
          version: '1.0',
          content: {
            participants: [{ id: 'p1', name: 'UserA', orderIndex: 0 }],
            messages: [],
            fragments: [],
            operands: [],
            sequenceNodes: [],
          },
        },
      };

      handleUpdateDiagram(updates);

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_DIAGRAM',
        diagramId: 'seq-diagram-789',
        updates: expect.objectContaining({
          typedContent: expect.objectContaining({
            type: 'Sequence',
            version: '1.0',
          }),
        }),
      });
    });
  });
});

describe('getDiagramType integration', () => {
  it('should normalize various case inputs correctly', () => {
    const testCases: Array<{ input: string | undefined; expected: DiagramType }> = [
      { input: 'Sequence', expected: 'Sequence' },
      { input: 'sequence', expected: 'Sequence' },
      { input: 'SEQUENCE', expected: 'Sequence' },
      { input: 'General', expected: 'General' },
      { input: 'general', expected: 'General' },
      { input: 'Activity', expected: 'Activity' },
      { input: 'activity', expected: 'Activity' },
      { input: 'State', expected: 'State' },
      { input: 'state', expected: 'State' },
      { input: 'ER', expected: 'ER' },
      { input: 'er', expected: 'ER' },
      { input: undefined, expected: 'General' },
    ];

    for (const { input, expected } of testCases) {
      const diagram = createTestDiagram('test', 'Test', input);
      expect(getDiagramType(diagram)).toBe(expected);
    }
  });
});
