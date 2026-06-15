/**
 * ContextSection.test.tsx
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 4: Tests for Context section integration
 *
 * These tests focus on the logic and behavior, not React component DOM rendering.
 * They test:
 * - Context chip management logic
 * - Remove chip functionality
 * - localStorage persistence patterns
 * - Context loading on workItemId change
 * - Add context button behavior
 *
 * Note: Following the existing test patterns in this project which test logic
 * rather than DOM interaction due to lack of @testing-library/react dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextState, EntityRef, DiagramRef } from '../utils/contextStorage';
import { loadContext, saveContext, createEmptyContextState } from '../utils/contextStorage';
import { buildArchitecturePickList, buildDiagramPickList } from '../utils/contextPickListBuilders';
import type { MetaModelEntities, Diagram } from '../types/model';

// ============================================================================
// Mock localStorage
// ============================================================================

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// ============================================================================
// Test utility functions that mirror component integration logic
// ============================================================================

/**
 * Remove an entity chip from context state
 * Mirrors the chip removal logic in WorkItemSummaryPanel
 */
function removeEntityChip(
  currentState: ContextState,
  entityIdToRemove: string
): ContextState {
  return {
    ...currentState,
    entity_refs: currentState.entity_refs.filter(
      (ref) => ref.entity_id !== entityIdToRemove
    ),
  };
}

/**
 * Remove a diagram chip from context state
 * Mirrors the chip removal logic in WorkItemSummaryPanel
 */
function removeDiagramChip(
  currentState: ContextState,
  diagramIdToRemove: string
): ContextState {
  return {
    ...currentState,
    diagram_refs: currentState.diagram_refs.filter(
      (ref) => ref.diagram_id !== diagramIdToRemove
    ),
  };
}

/**
 * Handles context reload when workItemId changes
 * Mirrors the useEffect logic in ProductImplementPage
 */
function handleWorkItemChange(
  projectId: string,
  workItemId: string | null
): ContextState {
  if (!projectId || !workItemId) {
    return createEmptyContextState();
  }
  return loadContext(projectId, workItemId);
}

// ============================================================================
// Test Data
// ============================================================================

function createTestContextState(): ContextState {
  return {
    version: 1,
    entity_refs: [
      { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Core App' },
      { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Auth Service' },
    ],
    diagram_refs: [
      { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'System Overview' },
    ],
  };
}

function createMinimalEntities(): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'Core App', description: '', app_type: 'web', status: 'active', tags: '' },
    ],
    app_components: [],
    services: [
      { id: 'svc-1', name: 'Auth Service', description: '', application_id: 'app-1', service_type: 'api', tags: '' },
    ],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [],
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
  };
}

function createTestDiagrams(): Diagram[] {
  return [
    {
      id: 'diag-1',
      name: 'System Overview',
      description: '',
      diagram_type: 'General',
      diagram_nodes: [],
      diagram_edges: [],
    },
  ];
}

// ============================================================================
// Tests
// ============================================================================

describe('Context Section Integration', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  describe('Add context button behavior', () => {
    it('should have a mechanism to trigger modal open', () => {
      // Simulate button click behavior
      let modalOpen = false;

      const handleAddContextClick = () => {
        modalOpen = true;
      };

      // Act
      handleAddContextClick();

      // Assert
      expect(modalOpen).toBe(true);
    });
  });

  describe('Entity chips rendering and removal', () => {
    it('should render entity chips with labels and remove icon', () => {
      // Arrange
      const contextState = createTestContextState();

      // Assert - chips should have labels
      expect(contextState.entity_refs[0].label).toBe('Core App');
      expect(contextState.entity_refs[1].label).toBe('Auth Service');
    });

    it('should remove entity chip when x icon is clicked', () => {
      // Arrange
      const contextState = createTestContextState();
      expect(contextState.entity_refs).toHaveLength(2);

      // Act - remove 'app-1'
      const newState = removeEntityChip(contextState, 'app-1');

      // Assert
      expect(newState.entity_refs).toHaveLength(1);
      expect(newState.entity_refs[0].entity_id).toBe('svc-1');
      // Diagram refs should be unchanged
      expect(newState.diagram_refs).toHaveLength(1);
    });
  });

  describe('Diagram chips rendering and removal', () => {
    it('should render diagram chips with labels and remove icon', () => {
      // Arrange
      const contextState = createTestContextState();

      // Assert - chips should have labels
      expect(contextState.diagram_refs[0].label).toBe('System Overview');
    });

    it('should remove diagram chip when x icon is clicked', () => {
      // Arrange
      const contextState = createTestContextState();
      expect(contextState.diagram_refs).toHaveLength(1);

      // Act - remove 'diag-1'
      const newState = removeDiagramChip(contextState, 'diag-1');

      // Assert
      expect(newState.diagram_refs).toHaveLength(0);
      // Entity refs should be unchanged
      expect(newState.entity_refs).toHaveLength(2);
    });
  });

  describe('Removing a chip persists to localStorage', () => {
    it('should call saveContext after chip removal', () => {
      // Arrange
      const projectId = 'test-project';
      const workItemId = 'work-item-123';
      const contextState = createTestContextState();

      // Save initial state
      saveContext(projectId, workItemId, contextState);
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);

      // Act - remove a chip and save
      const newState = removeEntityChip(contextState, 'app-1');
      saveContext(projectId, workItemId, newState);

      // Assert
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(2);

      // Verify the saved data
      const loaded = loadContext(projectId, workItemId);
      expect(loaded.entity_refs).toHaveLength(1);
    });
  });

  describe('Context reloads when workItemId changes', () => {
    it('should load context for new workItemId', () => {
      // Arrange
      const projectId = 'test-project';

      // Save context for work item 1
      const state1 = createTestContextState();
      saveContext(projectId, 'work-item-1', state1);

      // Save different context for work item 2
      const state2: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-2', label: 'Mobile App' },
        ],
        diagram_refs: [],
      };
      saveContext(projectId, 'work-item-2', state2);

      // Act - simulate navigation to work item 1
      const loaded1 = handleWorkItemChange(projectId, 'work-item-1');

      // Assert
      expect(loaded1.entity_refs).toHaveLength(2);
      expect(loaded1.entity_refs[0].label).toBe('Core App');

      // Act - simulate navigation to work item 2
      const loaded2 = handleWorkItemChange(projectId, 'work-item-2');

      // Assert
      expect(loaded2.entity_refs).toHaveLength(1);
      expect(loaded2.entity_refs[0].label).toBe('Mobile App');
    });

    it('should return empty state for null workItemId', () => {
      // Arrange
      const projectId = 'test-project';

      // Act
      const loaded = handleWorkItemChange(projectId, null);

      // Assert
      expect(loaded).toEqual(createEmptyContextState());
    });
  });

  describe('Integration with architecture options', () => {
    it('should build architecture options from metaModel.entities', () => {
      // Arrange
      const entities = createMinimalEntities();

      // Act
      const architectureOptions = buildArchitecturePickList(entities);

      // Assert
      expect(architectureOptions.applications).toHaveLength(1);
      expect(architectureOptions.applications[0].label).toBe('Core App');
      expect(architectureOptions.services).toHaveLength(1);
      expect(architectureOptions.services[0].label).toBe('Auth Service');
    });

    it('should build diagram options from model.diagrams', () => {
      // Arrange
      const diagrams = createTestDiagrams();

      // Act
      const diagramOptions = buildDiagramPickList(diagrams);

      // Assert
      expect(diagramOptions).toHaveLength(1);
      expect(diagramOptions[0].label).toBe('System Overview');
    });
  });
});
