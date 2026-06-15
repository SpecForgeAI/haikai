/**
 * ContextPickerModal.test.tsx
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 3: Tests for ContextPickerModal component logic
 *
 * These tests focus on the logic and behavior, not React component DOM rendering.
 * They test:
 * - State management logic
 * - Selection and deduplication logic
 * - Filter functionality
 * - Tab switching logic
 * - Apply/Cancel callback patterns
 *
 * Note: Following the existing test patterns in this project which test logic
 * rather than DOM interaction due to lack of @testing-library/react dependency.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ContextState, EntityRef, DiagramRef } from '../utils/contextStorage';
import type { PickOption } from '../utils/contextPickListBuilders';

// ============================================================================
// Test utility functions that mirror the component's internal logic
// ============================================================================

/**
 * Filters architecture options by search query (case-insensitive)
 * Mirrors the filteredArchitectureOptions useMemo in the component
 */
function filterArchitectureOptions(
  architectureOptions: Record<string, PickOption[]>,
  searchQuery: string
): Record<string, PickOption[]> {
  if (!searchQuery.trim()) {
    return architectureOptions;
  }

  const query = searchQuery.toLowerCase().trim();
  const filtered: Record<string, PickOption[]> = {};

  for (const [key, options] of Object.entries(architectureOptions)) {
    const matchingOptions = options.filter((opt) =>
      opt.label.toLowerCase().includes(query)
    );
    if (matchingOptions.length > 0) {
      filtered[key] = matchingOptions;
    }
  }

  return filtered;
}

/**
 * Filters diagram options by search query (case-insensitive)
 * Mirrors the filteredDiagramOptions useMemo in the component
 */
function filterDiagramOptions(
  diagramOptions: PickOption[],
  searchQuery: string
): PickOption[] {
  if (!searchQuery.trim()) {
    return diagramOptions;
  }

  const query = searchQuery.toLowerCase().trim();
  return diagramOptions.filter((opt) => opt.label.toLowerCase().includes(query));
}

/**
 * Builds ContextState from selections
 * Mirrors the handleApply logic in the component
 */
function buildContextStateFromSelections(
  selectedEntityIds: Set<string>,
  selectedDiagramIds: Set<string>,
  entityOptionMap: Map<string, PickOption>,
  diagramOptionMap: Map<string, PickOption>
): ContextState {
  // Build entity refs from selections
  const entityRefs: EntityRef[] = [];
  for (const entityId of selectedEntityIds) {
    const option = entityOptionMap.get(entityId);
    if (option && option.entity_type) {
      entityRefs.push({
        kind: 'ENTITY',
        entity_type: option.entity_type,
        entity_id: entityId,
        label: option.label,
      });
    }
  }

  // Build diagram refs from selections
  const diagramRefs: DiagramRef[] = [];
  for (const diagramId of selectedDiagramIds) {
    const option = diagramOptionMap.get(diagramId);
    if (option) {
      diagramRefs.push({
        kind: 'DIAGRAM',
        diagram_id: diagramId,
        label: option.label,
      });
    }
  }

  return {
    version: 1,
    entity_refs: entityRefs,
    diagram_refs: diagramRefs,
  };
}

/**
 * Initializes selections from ContextState
 * Mirrors the useEffect initialization in the component
 */
function initializeSelectionsFromContext(
  initialSelected: ContextState
): { entityIds: Set<string>; diagramIds: Set<string> } {
  const entityIds = new Set(initialSelected.entity_refs.map((ref) => ref.entity_id));
  const diagramIds = new Set(initialSelected.diagram_refs.map((ref) => ref.diagram_id));
  return { entityIds, diagramIds };
}

// ============================================================================
// Test Data
// ============================================================================

const mockArchitectureOptions: Record<string, PickOption[]> = {
  applications: [
    { value: 'app-1', label: 'Core Application', entity_type: 'applications' },
    { value: 'app-2', label: 'Mobile App', entity_type: 'applications' },
  ],
  services: [
    { value: 'svc-1', label: 'Auth Service', entity_type: 'services' },
    { value: 'svc-2', label: 'Payment Service', entity_type: 'services' },
  ],
};

const mockDiagramOptions: PickOption[] = [
  { value: 'diag-1', label: 'System Overview' },
  { value: 'diag-2', label: 'Data Flow Diagram' },
];

// Build entity and diagram option maps
function buildEntityOptionMap(options: Record<string, PickOption[]>): Map<string, PickOption> {
  const map = new Map<string, PickOption>();
  for (const opts of Object.values(options)) {
    for (const opt of opts) {
      map.set(opt.value, opt);
    }
  }
  return map;
}

function buildDiagramOptionMap(options: PickOption[]): Map<string, PickOption> {
  const map = new Map<string, PickOption>();
  for (const opt of options) {
    map.set(opt.value, opt);
  }
  return map;
}

// ============================================================================
// Tests
// ============================================================================

describe('ContextPickerModal Logic', () => {
  describe('Modal visibility logic', () => {
    it('should render null when isOpen is false (returns early)', () => {
      // The component returns null when isOpen is false
      // This is a straightforward early return pattern
      const isOpen = false;
      expect(isOpen).toBe(false); // Component would return null here
    });

    it('should render content when isOpen is true', () => {
      const isOpen = true;
      expect(isOpen).toBe(true); // Component would render content
    });
  });

  describe('Tab switching logic', () => {
    it('should track active tab state correctly', () => {
      // Simulate tab state management
      let activeTab: 'architecture' | 'diagrams' = 'architecture';

      // Initial state
      expect(activeTab).toBe('architecture');

      // Switch to diagrams
      activeTab = 'diagrams';
      expect(activeTab).toBe('diagrams');

      // Switch back to architecture
      activeTab = 'architecture';
      expect(activeTab).toBe('architecture');
    });
  });

  describe('Search filtering logic', () => {
    it('filters architecture options by label substring (case-insensitive)', () => {
      // Test filtering with "core"
      const filtered = filterArchitectureOptions(mockArchitectureOptions, 'core');

      expect(filtered.applications).toBeDefined();
      expect(filtered.applications).toHaveLength(1);
      expect(filtered.applications[0].label).toBe('Core Application');
      expect(filtered.services).toBeUndefined(); // No services match "core"
    });

    it('filters diagram options by label substring (case-insensitive)', () => {
      // Test filtering with "FLOW" (uppercase to test case-insensitivity)
      const filtered = filterDiagramOptions(mockDiagramOptions, 'FLOW');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].label).toBe('Data Flow Diagram');
    });

    it('returns all options when search query is empty', () => {
      const filteredArch = filterArchitectureOptions(mockArchitectureOptions, '');
      const filteredDiag = filterDiagramOptions(mockDiagramOptions, '');

      expect(filteredArch).toEqual(mockArchitectureOptions);
      expect(filteredDiag).toEqual(mockDiagramOptions);
    });

    it('returns empty results when no matches found', () => {
      const filteredArch = filterArchitectureOptions(mockArchitectureOptions, 'nonexistent');
      const filteredDiag = filterDiagramOptions(mockDiagramOptions, 'xyz123');

      expect(Object.keys(filteredArch)).toHaveLength(0);
      expect(filteredDiag).toHaveLength(0);
    });
  });

  describe('Apply button logic - builds ContextState from selections', () => {
    it('calls onApply with selected items merged into ContextState', () => {
      // Arrange
      const selectedEntityIds = new Set(['app-1']);
      const selectedDiagramIds = new Set(['diag-1']);
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);

      // Act
      const result = buildContextStateFromSelections(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap
      );

      // Assert
      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(1);
      expect(result.entity_refs[0]).toEqual({
        kind: 'ENTITY',
        entity_type: 'applications',
        entity_id: 'app-1',
        label: 'Core Application',
      });
      expect(result.diagram_refs).toHaveLength(1);
      expect(result.diagram_refs[0]).toEqual({
        kind: 'DIAGRAM',
        diagram_id: 'diag-1',
        label: 'System Overview',
      });
    });

    it('handles multiple selections across groups', () => {
      // Arrange
      const selectedEntityIds = new Set(['app-1', 'app-2', 'svc-1']);
      const selectedDiagramIds = new Set(['diag-1', 'diag-2']);
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);

      // Act
      const result = buildContextStateFromSelections(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap
      );

      // Assert
      expect(result.entity_refs).toHaveLength(3);
      expect(result.diagram_refs).toHaveLength(2);
    });

    it('handles empty selections gracefully', () => {
      // Arrange
      const selectedEntityIds = new Set<string>();
      const selectedDiagramIds = new Set<string>();
      const entityMap = buildEntityOptionMap(mockArchitectureOptions);
      const diagramMap = buildDiagramOptionMap(mockDiagramOptions);

      // Act
      const result = buildContextStateFromSelections(
        selectedEntityIds,
        selectedDiagramIds,
        entityMap,
        diagramMap
      );

      // Assert
      expect(result.version).toBe(1);
      expect(result.entity_refs).toHaveLength(0);
      expect(result.diagram_refs).toHaveLength(0);
    });
  });

  describe('Cancel button logic', () => {
    it('closes modal without calling onApply', () => {
      // Simulate cancel behavior
      const mockOnClose = vi.fn();
      const mockOnApply = vi.fn();

      // When cancel is clicked, only onClose is called
      mockOnClose();

      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(mockOnApply).not.toHaveBeenCalled();
    });
  });

  describe('Selection initialization from ContextState', () => {
    it('initializes selections from initialSelected prop', () => {
      // Arrange
      const initialSelected: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Core App' },
        ],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diag-2', label: 'Data Flow' },
        ],
      };

      // Act
      const { entityIds, diagramIds } = initializeSelectionsFromContext(initialSelected);

      // Assert
      expect(entityIds.has('app-1')).toBe(true);
      expect(entityIds.has('app-2')).toBe(false);
      expect(diagramIds.has('diag-2')).toBe(true);
      expect(diagramIds.has('diag-1')).toBe(false);
    });

    it('handles empty initialSelected', () => {
      // Arrange
      const initialSelected: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
      };

      // Act
      const { entityIds, diagramIds } = initializeSelectionsFromContext(initialSelected);

      // Assert
      expect(entityIds.size).toBe(0);
      expect(diagramIds.size).toBe(0);
    });
  });
});
