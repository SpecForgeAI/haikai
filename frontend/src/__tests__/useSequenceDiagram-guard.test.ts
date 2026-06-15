/**
 * useSequenceDiagram Hook Guard Tests
 *
 * Task Group 2: Tests for useSequenceDiagram hook guard behavior.
 * These tests verify that the hook's guard condition correctly handles
 * diagram_type casing variations using getDiagramType().
 *
 * Spec: Fix Diagram Type Normalization (2025-12-30)
 *
 * Critical test cases:
 * - Guard allows diagram when diagram_type='SEQUENCE' (uppercase)
 * - Guard allows diagram when diagram_type=' sequence ' (lowercase with spaces)
 *
 * Note: These tests verify the guard condition logic by testing getDiagramType()
 * integration, which is the fix applied in Task 2.3.
 */

import { describe, it, expect } from 'vitest';
import { getDiagramType } from '../types/diagramType';
import { Diagram } from '../types/model';

/**
 * Helper to simulate the hook's guard condition logic
 * This mirrors the guard in loadDiagram callback:
 *   if (!activeDiagram || getDiagramType(activeDiagram) !== 'Sequence')
 *
 * Returns true if the diagram would be loaded (guard passes)
 * Returns false if the diagram would be skipped (guard fails)
 */
function wouldLoadSequenceDiagram(diagram: Diagram | null): boolean {
  if (!diagram) {
    return false;
  }
  // This is the exact guard condition from useSequenceDiagram hook
  return getDiagramType(diagram) === 'Sequence';
}

describe('useSequenceDiagram hook guard', () => {
  /**
   * Task 2.1 - Test 1: Hook loads diagram when diagram_type='SEQUENCE' (uppercase)
   * Verifies that the guard condition uses normalized comparison
   */
  it('should pass guard when diagram_type is SEQUENCE (uppercase)', () => {
    const diagram: Diagram = {
      id: 'test-sequence-1',
      name: 'Test Sequence Diagram',
      description: 'A test sequence diagram with uppercase type',
      diagram_type: 'SEQUENCE', // Uppercase - should still be recognized
      diagram_nodes: [],
      diagram_edges: [],
    };

    // The guard should pass - getDiagramType normalizes 'SEQUENCE' to 'Sequence'
    const shouldLoad = wouldLoadSequenceDiagram(diagram);

    expect(shouldLoad).toBe(true);
    expect(getDiagramType(diagram)).toBe('Sequence');
  });

  /**
   * Task 2.1 - Test 2: Hook loads diagram when diagram_type=' sequence ' (lowercase with spaces)
   * Verifies that the guard condition handles trimming and case normalization
   */
  it('should pass guard when diagram_type is " sequence " (lowercase with spaces)', () => {
    const diagram: Diagram = {
      id: 'test-sequence-2',
      name: 'Test Sequence Diagram 2',
      description: 'A test sequence diagram with lowercase and spaces',
      diagram_type: ' sequence ', // Lowercase with leading/trailing spaces
      diagram_nodes: [],
      diagram_edges: [],
    };

    // The guard should pass - getDiagramType normalizes ' sequence ' to 'Sequence'
    const shouldLoad = wouldLoadSequenceDiagram(diagram);

    expect(shouldLoad).toBe(true);
    expect(getDiagramType(diagram)).toBe('Sequence');
  });

  /**
   * Additional coverage: Verify non-sequence diagrams are not loaded
   * This ensures the guard correctly rejects non-sequence diagrams
   */
  it('should fail guard when diagram_type is General', () => {
    const diagram: Diagram = {
      id: 'test-general-1',
      name: 'Test General Diagram',
      description: 'A general diagram',
      diagram_type: 'General',
      diagram_nodes: [],
      diagram_edges: [],
    };

    // The guard should fail - 'General' is not 'Sequence'
    const shouldLoad = wouldLoadSequenceDiagram(diagram);

    expect(shouldLoad).toBe(false);
    expect(getDiagramType(diagram)).toBe('General');
  });

  /**
   * Additional coverage: Verify canonical 'Sequence' type still works
   * This ensures we haven't broken the standard case
   */
  it('should pass guard when diagram_type is Sequence (canonical)', () => {
    const diagram: Diagram = {
      id: 'test-sequence-3',
      name: 'Test Canonical Sequence',
      description: 'A sequence diagram with canonical type',
      diagram_type: 'Sequence', // Canonical form
      diagram_nodes: [],
      diagram_edges: [],
    };

    // The guard should pass - canonical 'Sequence' works as expected
    const shouldLoad = wouldLoadSequenceDiagram(diagram);

    expect(shouldLoad).toBe(true);
    expect(getDiagramType(diagram)).toBe('Sequence');
  });

  /**
   * Additional coverage: Verify null diagram is handled
   */
  it('should fail guard when diagram is null', () => {
    const shouldLoad = wouldLoadSequenceDiagram(null);

    expect(shouldLoad).toBe(false);
  });

  /**
   * Additional coverage: Verify mixed case variations
   */
  it('should pass guard for various Sequence casing variations', () => {
    const casings = ['SEQUENCE', 'sequence', 'Sequence', 'SeQuEnCe', '  SEQUENCE  ', '  sequence  '];

    for (const casing of casings) {
      const diagram: Diagram = {
        id: `test-${casing.trim().toLowerCase()}`,
        name: 'Test Diagram',
        description: '',
        diagram_type: casing,
        diagram_nodes: [],
        diagram_edges: [],
      };

      const shouldLoad = wouldLoadSequenceDiagram(diagram);
      expect(shouldLoad).toBe(true);
      expect(getDiagramType(diagram)).toBe('Sequence');
    }
  });

  /**
   * Additional coverage: Verify other diagram types are rejected
   */
  it('should fail guard for non-Sequence diagram types', () => {
    const nonSequenceTypes = ['General', 'ER', 'Activity', 'State', 'GENERAL', 'er', 'activity', 'state'];

    for (const diagramType of nonSequenceTypes) {
      const diagram: Diagram = {
        id: `test-${diagramType.toLowerCase()}`,
        name: 'Test Diagram',
        description: '',
        diagram_type: diagramType,
        diagram_nodes: [],
        diagram_edges: [],
      };

      const shouldLoad = wouldLoadSequenceDiagram(diagram);
      expect(shouldLoad).toBe(false);
    }
  });
});
