/**
 * Diagram Type Normalization Integration Tests
 *
 * Task Group 5: Integration tests for diagram type normalization feature.
 * These tests verify end-to-end behavior of diagram type handling,
 * ensuring that the normalization implemented in Task Groups 1-4 works
 * correctly across the application.
 *
 * Spec: Fix Diagram Type Normalization (2025-12-30)
 *
 * Test Coverage:
 * - Test 1: DiagramsView shows SequenceEditorPanel for diagram with diagram_type='SEQUENCE'
 * - Test 2: Activity diagrams work correctly with normalized type
 * - Test 3: State diagrams work correctly with normalized type
 * - Test 4: ER diagrams work correctly with normalized type
 */

import { describe, it, expect } from 'vitest';
import { getDiagramType, normalizeDiagramType, DiagramType } from '../types/diagramType';
import { Diagram } from '../types/model';

/**
 * Helper function that simulates the panel selection logic used by DiagramsView/PalettePanel.
 * This mirrors the actual decision logic for which panel to render:
 * - Sequence diagrams get SequenceEditorPanel
 * - Activity diagrams get Activity-specific palette sections
 * - State diagrams get State-specific palette sections
 * - ER diagrams get ER-specific palette sections
 * - General diagrams get the standard palette
 */
function determinePanelType(diagram: Diagram | null | undefined): 'SequenceEditor' | 'Palette' {
  const diagramType = getDiagramType(diagram);
  return diagramType === 'Sequence' ? 'SequenceEditor' : 'Palette';
}

/**
 * Helper function that simulates palette section filtering based on diagram type.
 * This mirrors the logic in PalettePanel that filters sections based on getDiagramType().
 */
function getPaletteSectionsForDiagramType(diagram: Diagram | null | undefined): string[] {
  const diagramType = getDiagramType(diagram);

  switch (diagramType) {
    case 'ER':
      return ['Logical Data Entities', 'Physical Data Entities', 'ER Relationships'];
    case 'Activity':
      return ['Activities', 'Activity Partitions', 'Activity Flows'];
    case 'State':
      return ['States', 'State Transitions'];
    case 'Sequence':
      return ['Participants', 'Messages']; // Handled by SequenceEditorPanel, not Palette
    case 'General':
    default:
      return ['Applications', 'Business Processes', 'Data Entities', 'Relationships'];
  }
}

/**
 * Create a test diagram with specified diagram_type value.
 * Used to simulate diagrams that may have non-canonical diagram_type values
 * from the database or older clients.
 */
function createTestDiagram(
  id: string,
  name: string,
  diagramType: string | undefined
): Diagram {
  return {
    id,
    name,
    description: `Test ${diagramType || 'unknown'} diagram`,
    diagram_type: diagramType,
    diagram_nodes: [],
    diagram_edges: [],
  };
}

describe('Diagram Type Normalization Integration Tests', () => {
  /**
   * Test 1: DiagramsView shows SequenceEditorPanel for diagram with diagram_type='SEQUENCE'
   *
   * Verifies that a Sequence diagram stored with uppercase 'SEQUENCE' in the database
   * will correctly show the SequenceEditorPanel (not the standard Palette).
   * This is the critical user-facing fix for the reported bug.
   */
  describe('Test 1: Sequence diagram with uppercase SEQUENCE shows SequenceEditorPanel', () => {
    it('should select SequenceEditorPanel for diagram_type="SEQUENCE" (uppercase)', () => {
      const diagram = createTestDiagram('seq-1', 'My Sequence Diagram', 'SEQUENCE');

      const panelType = determinePanelType(diagram);

      expect(panelType).toBe('SequenceEditor');
      expect(getDiagramType(diagram)).toBe('Sequence');
    });

    it('should select SequenceEditorPanel for diagram_type=" sequence " (lowercase with spaces)', () => {
      const diagram = createTestDiagram('seq-2', 'Another Sequence Diagram', ' sequence ');

      const panelType = determinePanelType(diagram);

      expect(panelType).toBe('SequenceEditor');
      expect(getDiagramType(diagram)).toBe('Sequence');
    });

    it('should select SequenceEditorPanel for diagram_type="Sequence" (canonical)', () => {
      const diagram = createTestDiagram('seq-3', 'Canonical Sequence Diagram', 'Sequence');

      const panelType = determinePanelType(diagram);

      expect(panelType).toBe('SequenceEditor');
      expect(getDiagramType(diagram)).toBe('Sequence');
    });

    it('should handle mixed case variations of Sequence', () => {
      const variations = ['SEQUENCE', 'sequence', 'SeQuEnCe', ' SEQUENCE ', ' sequence '];

      for (const variant of variations) {
        const diagram = createTestDiagram(`seq-${variant.trim().toLowerCase()}`, 'Test', variant);
        expect(determinePanelType(diagram)).toBe('SequenceEditor');
        expect(getDiagramType(diagram)).toBe('Sequence');
      }
    });
  });

  /**
   * Test 2: Activity diagrams work correctly with normalized type
   *
   * Verifies that Activity diagrams with any casing of "Activity" are
   * correctly normalized and receive the appropriate palette sections.
   */
  describe('Test 2: Activity diagrams work correctly with normalized type', () => {
    it('should normalize "ACTIVITY" to "Activity" and show correct palette sections', () => {
      const diagram = createTestDiagram('act-1', 'My Activity Diagram', 'ACTIVITY');

      const diagramType = getDiagramType(diagram);
      const sections = getPaletteSectionsForDiagramType(diagram);

      expect(diagramType).toBe('Activity');
      expect(determinePanelType(diagram)).toBe('Palette');
      expect(sections).toContain('Activities');
      expect(sections).toContain('Activity Partitions');
      expect(sections).toContain('Activity Flows');
    });

    it('should normalize " activity " to "Activity"', () => {
      const diagram = createTestDiagram('act-2', 'Another Activity Diagram', ' activity ');

      expect(getDiagramType(diagram)).toBe('Activity');
    });

    it('should show Palette panel (not SequenceEditor) for Activity diagrams', () => {
      const diagram = createTestDiagram('act-3', 'Test Activity', 'Activity');

      expect(determinePanelType(diagram)).toBe('Palette');
    });
  });

  /**
   * Test 3: State diagrams work correctly with normalized type
   *
   * Verifies that State diagrams with any casing of "State" are
   * correctly normalized and receive the appropriate palette sections.
   */
  describe('Test 3: State diagrams work correctly with normalized type', () => {
    it('should normalize "STATE" to "State" and show correct palette sections', () => {
      const diagram = createTestDiagram('state-1', 'My State Diagram', 'STATE');

      const diagramType = getDiagramType(diagram);
      const sections = getPaletteSectionsForDiagramType(diagram);

      expect(diagramType).toBe('State');
      expect(determinePanelType(diagram)).toBe('Palette');
      expect(sections).toContain('States');
      expect(sections).toContain('State Transitions');
    });

    it('should normalize " state " to "State"', () => {
      const diagram = createTestDiagram('state-2', 'Another State Diagram', ' state ');

      expect(getDiagramType(diagram)).toBe('State');
    });

    it('should show Palette panel (not SequenceEditor) for State diagrams', () => {
      const diagram = createTestDiagram('state-3', 'Test State', 'State');

      expect(determinePanelType(diagram)).toBe('Palette');
    });
  });

  /**
   * Test 4: ER diagrams work correctly with normalized type
   *
   * Verifies that ER diagrams with any casing of "ER" are
   * correctly normalized and receive the appropriate palette sections.
   */
  describe('Test 4: ER diagrams work correctly with normalized type', () => {
    it('should normalize "er" to "ER" and show correct palette sections', () => {
      const diagram = createTestDiagram('er-1', 'My ER Diagram', 'er');

      const diagramType = getDiagramType(diagram);
      const sections = getPaletteSectionsForDiagramType(diagram);

      expect(diagramType).toBe('ER');
      expect(determinePanelType(diagram)).toBe('Palette');
      expect(sections).toContain('Logical Data Entities');
      expect(sections).toContain('Physical Data Entities');
      expect(sections).toContain('ER Relationships');
    });

    it('should normalize " ER " (with spaces) to "ER"', () => {
      const diagram = createTestDiagram('er-2', 'Another ER Diagram', ' ER ');

      expect(getDiagramType(diagram)).toBe('ER');
    });

    it('should show Palette panel (not SequenceEditor) for ER diagrams', () => {
      const diagram = createTestDiagram('er-3', 'Test ER', 'ER');

      expect(determinePanelType(diagram)).toBe('Palette');
    });

    it('should handle mixed case "Er" correctly', () => {
      const diagram = createTestDiagram('er-4', 'Mixed Case ER', 'Er');

      expect(getDiagramType(diagram)).toBe('ER');
    });
  });

  /**
   * Additional coverage: General diagram type and edge cases
   */
  describe('Additional Coverage: General diagrams and edge cases', () => {
    it('should normalize "GENERAL" to "General"', () => {
      const diagram = createTestDiagram('gen-1', 'My General Diagram', 'GENERAL');

      expect(getDiagramType(diagram)).toBe('General');
      expect(determinePanelType(diagram)).toBe('Palette');
    });

    it('should default to "General" for invalid diagram type', () => {
      const diagram = createTestDiagram('invalid-1', 'Invalid Type', 'InvalidType');

      expect(getDiagramType(diagram)).toBe('General');
      expect(determinePanelType(diagram)).toBe('Palette');
    });

    it('should default to "General" for null diagram', () => {
      expect(getDiagramType(null)).toBe('General');
      expect(determinePanelType(null)).toBe('Palette');
    });

    it('should default to "General" for undefined diagram', () => {
      expect(getDiagramType(undefined)).toBe('General');
      expect(determinePanelType(undefined)).toBe('Palette');
    });

    it('should default to "General" for diagram with missing diagram_type', () => {
      const diagram: Diagram = {
        id: 'no-type',
        name: 'No Type Diagram',
        description: '',
        diagram_nodes: [],
        diagram_edges: [],
        // diagram_type is intentionally missing
      };

      expect(getDiagramType(diagram)).toBe('General');
      expect(determinePanelType(diagram)).toBe('Palette');
    });
  });
});
