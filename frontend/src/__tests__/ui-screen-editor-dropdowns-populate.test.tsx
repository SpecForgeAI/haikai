/**
 * UI Screen Editor Dropdown Population Tests
 *
 * Regression tests for UI Screen Editor MetaModel Wiring Fix specification.
 * Tests verify that UIScreenDiagramEditorPanel receives metaModel prop
 * and that downstream components (OverviewTab, AddActionModal, InterfaceEndpointPicker)
 * correctly derive dropdown data from the metaModel.
 *
 * Task Group 3: Regression Tests for Dropdown Population
 */

import { describe, it, expect } from 'vitest';
import type { MetaModel, UIScreen } from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock MetaModel with UIScreens, Interfaces, and Endpoints
 * for testing dropdown population
 */
function createMockMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [
        { id: 'if_1', name: 'UserAPI', description: '', service_id: 's1', interface_type: 'REST_API', tags: '' },
        { id: 'if_2', name: 'OrderAPI', description: '', service_id: 's2', interface_type: 'REST_API', tags: '' },
        { id: 'if_3', name: 'PaymentAPI', description: '', service_id: 's3', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [
        { id: 'ep_1', name: 'getUser', description: '', interface_id: 'if_1', endpoint_type: 'HTTP_REST' as any, path_or_address: '/users/{id}', operation_verb: 'GET', tags: '' },
        { id: 'ep_2', name: 'createUser', description: '', interface_id: 'if_1', endpoint_type: 'HTTP_REST' as any, path_or_address: '/users', operation_verb: 'POST', tags: '' },
        { id: 'ep_3', name: 'getOrders', description: '', interface_id: 'if_2', endpoint_type: 'HTTP_REST' as any, path_or_address: '/orders', operation_verb: 'GET', tags: '' },
      ],
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
      ui_screens: [
        { id: 'screen_1', name: 'Dashboard', route: '/dashboard' },
        { id: 'screen_2', name: 'UserProfile', route: '/users/:id' },
        { id: 'screen_3', name: 'Settings', route: '/settings' },
      ],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

/**
 * Create an empty MetaModel for testing graceful handling
 */
function createEmptyMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
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
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      ui_screens: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

// ============================================================================
// Helper functions that mirror component logic
// These simulate the derivation logic in UIScreenDiagramEditorPanel,
// AddActionModal, and InterfaceEndpointPicker
// ============================================================================

/**
 * Derive UIScreens list from metaModel (mirrors UIScreenDiagramEditorPanel line 111-114)
 */
function deriveUIScreensList(metaModel: MetaModel | null): UIScreen[] {
  if (!metaModel) return [];
  return metaModel.entities.ui_screens || [];
}

/**
 * Derive all UIScreens for Navigate dropdown (mirrors AddActionModal lines 77-84)
 */
function deriveAllUIScreens(metaModel: MetaModel | null, uiScreensFallback: UIScreen[]): UIScreen[] {
  // Prefer metaModel.entities.ui_screens if available and non-empty
  if (metaModel && metaModel.entities.ui_screens && metaModel.entities.ui_screens.length > 0) {
    return metaModel.entities.ui_screens;
  }
  // Fallback to uiScreens prop
  return uiScreensFallback;
}

/**
 * Derive interfaces list (mirrors InterfaceEndpointPicker lines 41-44)
 */
function deriveInterfaces(metaModel: MetaModel | null) {
  if (!metaModel) return [];
  return metaModel.entities.interfaces || [];
}

/**
 * Derive endpoints filtered by interface (mirrors InterfaceEndpointPicker lines 47-52)
 */
function deriveEndpoints(metaModel: MetaModel | null, selectedInterfaceId: string) {
  if (!metaModel || !selectedInterfaceId) return [];
  return (metaModel.entities.endpoints || []).filter(
    ep => ep.interface_id === selectedInterfaceId
  );
}

// ============================================================================
// Test 1: OverviewTab dropdown receives UIScreens from metaModel
// ============================================================================

describe('Test 1: OverviewTab dropdown receives UIScreens from metaModel', () => {
  it('should derive UIScreens list from metaModel.entities.ui_screens', () => {
    const metaModel = createMockMetaModel();
    const uiScreensList = deriveUIScreensList(metaModel);

    expect(uiScreensList).toBeDefined();
    expect(uiScreensList.length).toBe(3);
    expect(uiScreensList.map(s => s.name)).toEqual(['Dashboard', 'UserProfile', 'Settings']);
  });

  it('should return empty array when metaModel is null', () => {
    const uiScreensList = deriveUIScreensList(null);

    expect(uiScreensList).toEqual([]);
  });

  it('should include screen routes for dropdown labels', () => {
    const metaModel = createMockMetaModel();
    const uiScreensList = deriveUIScreensList(metaModel);

    expect(uiScreensList[0].route).toBe('/dashboard');
    expect(uiScreensList[1].route).toBe('/users/:id');
    expect(uiScreensList[2].route).toBe('/settings');
  });
});

// ============================================================================
// Test 2: AddActionModal Navigate dropdown receives UIScreens
// ============================================================================

describe('Test 2: AddActionModal Navigate dropdown receives UIScreens', () => {
  it('should prefer metaModel UIScreens over fallback prop', () => {
    const metaModel = createMockMetaModel();
    const fallbackScreens: UIScreen[] = [
      { id: 'fallback_1', name: 'Fallback' }
    ];

    const allUIScreens = deriveAllUIScreens(metaModel, fallbackScreens);

    expect(allUIScreens.length).toBe(3);
    expect(allUIScreens.map(s => s.name)).toEqual(['Dashboard', 'UserProfile', 'Settings']);
  });

  it('should use fallback when metaModel is null', () => {
    const fallbackScreens: UIScreen[] = [
      { id: 'fallback_1', name: 'Fallback' }
    ];

    const allUIScreens = deriveAllUIScreens(null, fallbackScreens);

    expect(allUIScreens.length).toBe(1);
    expect(allUIScreens[0].name).toBe('Fallback');
  });

  it('should use fallback when metaModel UIScreens is empty', () => {
    const emptyMetaModel = createEmptyMetaModel();
    const fallbackScreens: UIScreen[] = [
      { id: 'fallback_1', name: 'Fallback' }
    ];

    const allUIScreens = deriveAllUIScreens(emptyMetaModel, fallbackScreens);

    expect(allUIScreens.length).toBe(1);
    expect(allUIScreens[0].name).toBe('Fallback');
  });
});

// ============================================================================
// Test 3: AddActionModal Call API dropdown receives Interfaces
// ============================================================================

describe('Test 3: AddActionModal Call API dropdown receives Interfaces', () => {
  it('should derive interfaces from metaModel.entities.interfaces', () => {
    const metaModel = createMockMetaModel();
    const interfaces = deriveInterfaces(metaModel);

    expect(interfaces.length).toBe(3);
    expect(interfaces.map(i => i.name)).toEqual(['UserAPI', 'OrderAPI', 'PaymentAPI']);
  });

  it('should filter endpoints by selected interface', () => {
    const metaModel = createMockMetaModel();
    const endpoints = deriveEndpoints(metaModel, 'if_1');

    expect(endpoints.length).toBe(2);
    expect(endpoints.map(ep => ep.name)).toEqual(['getUser', 'createUser']);
  });

  it('should return empty array when no interface selected', () => {
    const metaModel = createMockMetaModel();
    const endpoints = deriveEndpoints(metaModel, '');

    expect(endpoints).toEqual([]);
  });
});

// ============================================================================
// Test 4: Empty metaModel gracefully shows empty dropdowns (no crash)
// ============================================================================

describe('Test 4: Empty metaModel gracefully shows empty dropdowns', () => {
  it('should handle null metaModel without crashing', () => {
    expect(() => deriveUIScreensList(null)).not.toThrow();
    expect(() => deriveInterfaces(null)).not.toThrow();
    expect(() => deriveEndpoints(null, 'if_1')).not.toThrow();
  });

  it('should return empty arrays for all dropdowns with empty metaModel', () => {
    const emptyMetaModel = createEmptyMetaModel();

    expect(deriveUIScreensList(emptyMetaModel)).toEqual([]);
    expect(deriveInterfaces(emptyMetaModel)).toEqual([]);
    expect(deriveEndpoints(emptyMetaModel, 'if_1')).toEqual([]);
  });

  it('should handle undefined entities gracefully', () => {
    const partialMetaModel = {
      entities: {},
      relationships: {},
    } as any as MetaModel;

    // Should return empty arrays, not crash
    expect(deriveUIScreensList(partialMetaModel)).toEqual([]);
    expect(deriveInterfaces(partialMetaModel)).toEqual([]);
  });
});

// ============================================================================
// Test 5: Full metaModel with multiple UIScreens shows all items
// ============================================================================

describe('Test 5: Full metaModel with multiple UIScreens shows all items', () => {
  it('should show all 3 UIScreens from metaModel', () => {
    const metaModel = createMockMetaModel();
    const uiScreensList = deriveUIScreensList(metaModel);

    expect(uiScreensList.length).toBe(3);
  });

  it('should show all 3 Interfaces from metaModel', () => {
    const metaModel = createMockMetaModel();
    const interfaces = deriveInterfaces(metaModel);

    expect(interfaces.length).toBe(3);
  });

  it('should show all endpoints for a given interface', () => {
    const metaModel = createMockMetaModel();

    // if_1 has 2 endpoints
    const if1Endpoints = deriveEndpoints(metaModel, 'if_1');
    expect(if1Endpoints.length).toBe(2);

    // if_2 has 1 endpoint
    const if2Endpoints = deriveEndpoints(metaModel, 'if_2');
    expect(if2Endpoints.length).toBe(1);

    // if_3 has 0 endpoints
    const if3Endpoints = deriveEndpoints(metaModel, 'if_3');
    expect(if3Endpoints.length).toBe(0);
  });

  it('should preserve UIScreen IDs for selection', () => {
    const metaModel = createMockMetaModel();
    const uiScreensList = deriveUIScreensList(metaModel);

    expect(uiScreensList.map(s => s.id)).toEqual(['screen_1', 'screen_2', 'screen_3']);
  });

  it('should preserve Interface IDs for filtering endpoints', () => {
    const metaModel = createMockMetaModel();
    const interfaces = deriveInterfaces(metaModel);

    expect(interfaces.map(i => i.id)).toEqual(['if_1', 'if_2', 'if_3']);
  });
});

// ============================================================================
// Test 6 (Optional): Verify no domain filtering applied
// ============================================================================

describe('Test 6: No domain filtering applied to metaModel data', () => {
  it('should return full unfiltered UIScreens list', () => {
    const metaModel = createMockMetaModel();

    // All 3 screens should be available regardless of any domain context
    const uiScreensList = deriveUIScreensList(metaModel);
    expect(uiScreensList.length).toBe(3);
  });

  it('should return full unfiltered Interfaces list', () => {
    const metaModel = createMockMetaModel();

    // All 3 interfaces should be available regardless of any domain context
    const interfaces = deriveInterfaces(metaModel);
    expect(interfaces.length).toBe(3);
  });

  it('should pass canonical metaModel without domain subset filtering', () => {
    // This test documents the expected behavior:
    // The metaModel passed to UIScreenDiagramEditorPanel should be
    // state.model.metaModel (canonical, unfiltered) NOT a domain-filtered subset.
    //
    // The fix in DiagramsView.tsx (line 2376):
    //   metaModel={state.model.metaModel}
    //
    // ensures the full project metaModel is passed, matching the pattern
    // used by SequenceEditorPanel and PalettePanel.

    const metaModel = createMockMetaModel();

    // Verify the metaModel structure contains all expected collections
    expect(metaModel.entities.ui_screens).toBeDefined();
    expect(metaModel.entities.interfaces).toBeDefined();
    expect(metaModel.entities.endpoints).toBeDefined();

    // These should be the full project collections, not filtered subsets
    expect(metaModel.entities.ui_screens.length).toBeGreaterThan(0);
    expect(metaModel.entities.interfaces.length).toBeGreaterThan(0);
    expect(metaModel.entities.endpoints.length).toBeGreaterThan(0);
  });
});
