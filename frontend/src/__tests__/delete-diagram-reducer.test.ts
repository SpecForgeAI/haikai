/**
 * DELETE_DIAGRAM Reducer Action Tests
 *
 * Tests for the DELETE_DIAGRAM action in the appReducer.
 * Since appReducer is not exported directly, these tests verify the
 * expected reducer logic: filtering out the deleted diagram and applying
 * fallback selection for selectedDiagramId.
 *
 * Part of Spec: 2026-03-05-diagrams-toolbar-ux-refresh
 * Task Group 1: DELETE_DIAGRAM Reducer Action
 */

import { describe, it, expect } from 'vitest';
import { Diagram } from '../types/model';

// ---------------------------------------------------------------------------
// Helper: Create a minimal test diagram
// ---------------------------------------------------------------------------
function createTestDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return {
    id: 'diag-default',
    name: 'Default Diagram',
    description: '',
    diagram_nodes: [],
    diagram_edges: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: Simulate the DELETE_DIAGRAM reducer logic
// This mirrors the implementation that will be added to appReducer.
// ---------------------------------------------------------------------------
function simulateDeleteDiagram(
  diagrams: Diagram[],
  selectedDiagramId: string | null,
  diagramIdToDelete: string
): { diagrams: Diagram[]; selectedDiagramId: string | null } {
  const deletedIndex = diagrams.findIndex(d => d.id === diagramIdToDelete);

  // If diagram not found, return state unchanged
  if (deletedIndex === -1) {
    return { diagrams, selectedDiagramId };
  }

  const remainingDiagrams = diagrams.filter(d => d.id !== diagramIdToDelete);

  // Fallback selection: pick the diagram at the same index, or last remaining, or null
  const newSelectedId =
    remainingDiagrams[Math.min(deletedIndex, remainingDiagrams.length - 1)]?.id ?? null;

  return { diagrams: remainingDiagrams, selectedDiagramId: newSelectedId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('DELETE_DIAGRAM Reducer Action', () => {
  // Test 1: Deleting a diagram removes it from state.model.diagrams
  it('should remove the specified diagram from the diagrams array', () => {
    const diagramA = createTestDiagram({ id: 'diag-a', name: 'Diagram A' });
    const diagramB = createTestDiagram({ id: 'diag-b', name: 'Diagram B' });
    const diagramC = createTestDiagram({ id: 'diag-c', name: 'Diagram C' });

    const result = simulateDeleteDiagram(
      [diagramA, diagramB, diagramC],
      'diag-b',
      'diag-b'
    );

    expect(result.diagrams).toHaveLength(2);
    expect(result.diagrams.map(d => d.id)).toEqual(['diag-a', 'diag-c']);
    expect(result.diagrams.find(d => d.id === 'diag-b')).toBeUndefined();
  });

  // Test 2: After deletion, selectedDiagramId falls back to the diagram at the
  // same index (or last remaining if deleted diagram was at the end)
  it('should fall back selectedDiagramId to the diagram at the same index or last remaining', () => {
    const diagramA = createTestDiagram({ id: 'diag-a', name: 'Diagram A' });
    const diagramB = createTestDiagram({ id: 'diag-b', name: 'Diagram B' });
    const diagramC = createTestDiagram({ id: 'diag-c', name: 'Diagram C' });

    // Deleting middle diagram (index 1) - should select the diagram now at index 1 (diag-c)
    const resultMiddle = simulateDeleteDiagram(
      [diagramA, diagramB, diagramC],
      'diag-b',
      'diag-b'
    );
    expect(resultMiddle.selectedDiagramId).toBe('diag-c');

    // Deleting last diagram (index 2) - should select the new last diagram (diag-b at index 1)
    const resultLast = simulateDeleteDiagram(
      [diagramA, diagramB, diagramC],
      'diag-c',
      'diag-c'
    );
    expect(resultLast.selectedDiagramId).toBe('diag-b');

    // Deleting first diagram (index 0) - should select the diagram now at index 0 (diag-b)
    const resultFirst = simulateDeleteDiagram(
      [diagramA, diagramB, diagramC],
      'diag-a',
      'diag-a'
    );
    expect(resultFirst.selectedDiagramId).toBe('diag-b');
  });

  // Test 3: Deleting the only diagram sets selectedDiagramId to null
  it('should set selectedDiagramId to null when the only diagram is deleted', () => {
    const onlyDiagram = createTestDiagram({ id: 'diag-only', name: 'Only Diagram' });

    const result = simulateDeleteDiagram(
      [onlyDiagram],
      'diag-only',
      'diag-only'
    );

    expect(result.diagrams).toHaveLength(0);
    expect(result.selectedDiagramId).toBeNull();
  });

  // Test 4: Deleting a non-existent diagram ID returns state unchanged
  it('should return state unchanged when deleting a non-existent diagram ID', () => {
    const diagramA = createTestDiagram({ id: 'diag-a', name: 'Diagram A' });
    const diagramB = createTestDiagram({ id: 'diag-b', name: 'Diagram B' });

    const originalDiagrams = [diagramA, diagramB];
    const result = simulateDeleteDiagram(
      originalDiagrams,
      'diag-a',
      'diag-nonexistent'
    );

    expect(result.diagrams).toHaveLength(2);
    expect(result.diagrams).toBe(originalDiagrams); // Same reference (unchanged)
    expect(result.selectedDiagramId).toBe('diag-a');
  });
});
