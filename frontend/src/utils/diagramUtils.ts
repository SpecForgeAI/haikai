/**
 * Diagram Utility Functions
 *
 * Helper functions for diagram state management and detection.
 */

import { Diagram } from '../types/model';

/**
 * Determines whether there is an active diagram in the current state.
 *
 * An active diagram requires:
 * 1. At least one diagram exists in the diagrams array
 * 2. A non-null selectedDiagramId
 * 3. The selectedDiagramId points to an existing diagram
 *
 * @param diagrams - Array of diagrams from the model
 * @param selectedDiagramId - Currently selected diagram ID (may be null)
 * @returns true if there is a valid active diagram, false otherwise
 */
export function hasActiveDiagram(
  diagrams: Diagram[],
  selectedDiagramId: string | null
): boolean {
  return (
    diagrams.length > 0 &&
    selectedDiagramId !== null &&
    diagrams.some(d => d.id === selectedDiagramId)
  );
}
