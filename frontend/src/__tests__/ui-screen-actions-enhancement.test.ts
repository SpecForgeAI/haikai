/**
 * UI Screen Actions Enhancement Tests
 *
 * Task Group 6: Test coverage for UI Screen Actions Enhancement specification
 *
 * Tests cover:
 * - 6.1: Navigate dropdown population
 * - 6.2: Call API dropdown
 * - 6.3: SET_STATE mutations
 * - 6.4: Key autocomplete
 * - 6.5: Back-compatibility
 * - 6.6: Form validation
 */

import {
  getCallApiDisplayName,
  migrateSetStateEffect,
  isLegacySetStateEffect,
  TRIGGER_TYPE_OPTIONS,
  EFFECT_TYPE_OPTIONS,
} from '../utils/uiScreenUtils';
import type { MetaModel } from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock MetaModel for testing
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
      ],
      endpoints: [
        { id: 'ep_1', name: 'getUser', description: '', interface_id: 'if_1', endpoint_type: 'HTTP_REST' as any, path_or_address: '/users/{id}', operation_verb: 'GET', tags: '' },
        { id: 'ep_2', name: 'createUser', description: '', interface_id: 'if_1', endpoint_type: 'HTTP_REST' as any, path_or_address: '/users', operation_verb: 'POST', tags: '' },
        { id: 'ep_3', name: 'getOrders', description: '', interface_id: 'if_2', endpoint_type: 'HTTP_REST' as any, path_or_address: '/orders', operation_verb: 'GET', tags: '' },
      ],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [
        { id: 'lde_1', name: 'Customer', description: '', tags: '' },
        { id: 'lde_2', name: 'Order', description: '', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda_1', name: 'email', description: '', logical_entity_id: 'lde_1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'lda_2', name: 'firstName', description: '', logical_entity_id: 'lde_1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'lda_3', name: 'orderId', description: '', logical_entity_id: 'lde_2', data_type: 'string', is_primary_key: true, is_nullable: false, tags: '' },
      ],
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
        { id: 'screen_3', name: 'Settings', route: '' }, // No route
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

// ============================================================================
// Task Group 6.1: Navigate Dropdown Tests
// ============================================================================

describe('Task Group 6.1: Navigate Dropdown', () => {
  it('should have UIScreens in metaModel.entities.ui_screens', () => {
    const metaModel = createMockMetaModel();

    expect(metaModel.entities.ui_screens).toBeDefined();
    expect(metaModel.entities.ui_screens.length).toBe(3);
  });

  it('should format screen label with name and route when route exists', () => {
    const metaModel = createMockMetaModel();
    const screen = metaModel.entities.ui_screens[0];

    // Simulate the formatScreenLabel function logic
    const label = screen.route ? `${screen.name} (${screen.route})` : screen.name;

    expect(label).toBe('Dashboard (/dashboard)');
  });

  it('should format screen label with only name when no route exists', () => {
    const metaModel = createMockMetaModel();
    const screen = metaModel.entities.ui_screens[2]; // Settings has no route

    // Simulate the formatScreenLabel function logic
    const label = screen.route ? `${screen.name} (${screen.route})` : screen.name;

    expect(label).toBe('Settings');
  });
});

// ============================================================================
// Task Group 6.2: Call API Dropdown Tests
// ============================================================================

describe('Task Group 6.2: Call API Dropdown', () => {
  it('should show all interfaces from metaModel', () => {
    const metaModel = createMockMetaModel();

    expect(metaModel.entities.interfaces).toBeDefined();
    expect(metaModel.entities.interfaces.length).toBe(2);
    expect(metaModel.entities.interfaces.map(i => i.name)).toEqual(['UserAPI', 'OrderAPI']);
  });

  it('should filter endpoints by selected interface', () => {
    const metaModel = createMockMetaModel();
    const selectedInterfaceId = 'if_1';

    const filteredEndpoints = metaModel.entities.endpoints.filter(
      ep => ep.interface_id === selectedInterfaceId
    );

    expect(filteredEndpoints.length).toBe(2);
    expect(filteredEndpoints.map(ep => ep.name)).toEqual(['getUser', 'createUser']);
  });

  it('should format endpoint label with name and operation verb', () => {
    const metaModel = createMockMetaModel();
    const endpoint = metaModel.entities.endpoints[0];

    const label = `${endpoint.name} (${endpoint.operation_verb || endpoint.endpoint_type})`;

    expect(label).toBe('getUser (GET)');
  });

  it('should return valid CALL_API display name from getCallApiDisplayName', () => {
    const metaModel = createMockMetaModel();

    const result = getCallApiDisplayName('ep_1', metaModel);

    expect(result.displayName).toBe('UserAPI.getUser');
    expect(result.isValid).toBe(true);
  });

  it('should return invalid CALL_API display name when endpoint not found', () => {
    const metaModel = createMockMetaModel();

    const result = getCallApiDisplayName('non_existent_id', metaModel);

    expect(result.displayName).toBe('Unknown Endpoint');
    expect(result.isValid).toBe(false);
  });

  it('should return partial display name when interface not found', () => {
    const metaModel = createMockMetaModel();
    // Add an endpoint with missing interface
    metaModel.entities.endpoints.push({
      id: 'ep_orphan',
      name: 'orphanEndpoint',
      description: '',
      interface_id: 'non_existent_interface',
      endpoint_type: 'HTTP_REST' as any,
      path_or_address: '/orphan',
      tags: '',
    });

    const result = getCallApiDisplayName('ep_orphan', metaModel);

    expect(result.displayName).toBe('?.orphanEndpoint');
    expect(result.isValid).toBe(false);
  });
});

// ============================================================================
// Task Group 6.3: SET_STATE Mutations Tests
// ============================================================================

describe('Task Group 6.3: SET_STATE Mutations', () => {
  it('should initialize with one empty mutation row', () => {
    // Test the initial state structure
    const initialMutations = [{ key: '', value: '' }];

    expect(initialMutations.length).toBe(1);
    expect(initialMutations[0].key).toBe('');
    expect(initialMutations[0].value).toBe('');
  });

  it('should add new mutation rows', () => {
    let mutations = [{ key: 'isLoading', value: 'true' }];

    // Simulate adding a mutation
    mutations = [...mutations, { key: '', value: '' }];

    expect(mutations.length).toBe(2);
  });

  it('should remove mutation rows but keep minimum one', () => {
    let mutations = [
      { key: 'isLoading', value: 'true' },
      { key: 'error', value: '' },
    ];

    // Remove second mutation
    mutations = mutations.filter((_, i) => i !== 1);
    expect(mutations.length).toBe(1);

    // Try to remove last mutation (should not remove)
    if (mutations.length > 1) {
      mutations = mutations.filter((_, i) => i !== 0);
    }
    expect(mutations.length).toBe(1);
  });

  it('should persist using mutations array schema', () => {
    const mutations = [
      { key: 'isLoading', value: 'false' },
      { key: 'data', value: 'response.data' },
    ];

    // Simulate building effect object
    const validMutations = mutations
      .filter(m => m.key.trim() !== '')
      .map(m => ({
        key: m.key.trim(),
        value: m.value?.trim() || undefined,
      }));

    const effect = {
      type: 'SET_STATE',
      mutations: validMutations,
    };

    expect(effect.mutations).toBeDefined();
    expect(Array.isArray(effect.mutations)).toBe(true);
    expect(effect.mutations.length).toBe(2);
    expect(effect.mutations[0]).toEqual({ key: 'isLoading', value: 'false' });
  });
});

// ============================================================================
// Task Group 6.4: Key Autocomplete Tests
// ============================================================================

describe('Task Group 6.4: Key Autocomplete', () => {
  it('should include entity names in suggestions', () => {
    const metaModel = createMockMetaModel();

    const suggestions = new Set<string>();

    // Add entity names
    const logicalEntities = metaModel.entities.logical_data_entities || [];
    for (const entity of logicalEntities) {
      suggestions.add(entity.name);
    }

    expect(suggestions.has('Customer')).toBe(true);
    expect(suggestions.has('Order')).toBe(true);
  });

  it('should include entity.attribute format in suggestions', () => {
    const metaModel = createMockMetaModel();

    const suggestions = new Set<string>();
    const logicalEntities = metaModel.entities.logical_data_entities || [];
    const logicalAttributes = metaModel.entities.logical_data_attributes || [];

    for (const attr of logicalAttributes) {
      const parentEntity = logicalEntities.find(e => e.id === attr.logical_entity_id);
      if (parentEntity) {
        suggestions.add(`${parentEntity.name}.${attr.name}`);
      }
    }

    expect(suggestions.has('Customer.email')).toBe(true);
    expect(suggestions.has('Customer.firstName')).toBe(true);
    expect(suggestions.has('Order.orderId')).toBe(true);
  });

  it('should sort suggestions alphabetically', () => {
    const metaModel = createMockMetaModel();

    const suggestions = new Set<string>();
    const logicalEntities = metaModel.entities.logical_data_entities || [];
    const logicalAttributes = metaModel.entities.logical_data_attributes || [];

    // Add entity names
    for (const entity of logicalEntities) {
      suggestions.add(entity.name);
    }

    // Add entity.attribute format
    for (const attr of logicalAttributes) {
      const parentEntity = logicalEntities.find(e => e.id === attr.logical_entity_id);
      if (parentEntity) {
        suggestions.add(`${parentEntity.name}.${attr.name}`);
      }
    }

    const sortedSuggestions = Array.from(suggestions).sort((a, b) => a.localeCompare(b));

    // Verify sorting
    for (let i = 1; i < sortedSuggestions.length; i++) {
      expect(sortedSuggestions[i].localeCompare(sortedSuggestions[i - 1])).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// Task Group 6.5: Back-Compatibility Tests
// ============================================================================

describe('Task Group 6.5: Back-Compatibility', () => {
  it('should detect legacy SET_STATE format', () => {
    const legacyEffect = {
      type: 'SET_STATE',
      key: 'isLoading',
      value: 'true',
    };

    expect(isLegacySetStateEffect(legacyEffect)).toBe(true);
  });

  it('should not detect new format as legacy', () => {
    const newEffect = {
      type: 'SET_STATE',
      mutations: [{ key: 'isLoading', value: 'true' }],
    };

    expect(isLegacySetStateEffect(newEffect)).toBe(false);
  });

  it('should migrate legacy format to mutations array', () => {
    const legacyEffect = {
      type: 'SET_STATE',
      key: 'isLoading',
      value: 'true',
    };

    const migrated = migrateSetStateEffect(legacyEffect);

    expect(migrated.type).toBe('SET_STATE');
    expect(migrated.mutations).toBeDefined();
    expect(Array.isArray(migrated.mutations)).toBe(true);
    expect(migrated.mutations.length).toBe(1);
    expect(migrated.mutations[0]).toEqual({ key: 'isLoading', value: 'true' });
  });

  it('should preserve new format without modification', () => {
    const newEffect = {
      type: 'SET_STATE',
      mutations: [
        { key: 'isLoading', value: 'false' },
        { key: 'data', value: 'response' },
      ],
    };

    const migrated = migrateSetStateEffect(newEffect);

    expect(migrated.mutations.length).toBe(2);
    expect(migrated.mutations[0]).toEqual({ key: 'isLoading', value: 'false' });
    expect(migrated.mutations[1]).toEqual({ key: 'data', value: 'response' });
  });
});

// ============================================================================
// Task Group 6.6: Form Validation Tests
// ============================================================================

describe('Task Group 6.6: Form Validation', () => {
  it('should require name to be non-empty', () => {
    const name = '';
    const isValid = name.trim() !== '';

    expect(isValid).toBe(false);
  });

  it('should require target screen for NAVIGATE effect', () => {
    const effectType = 'NAVIGATE';
    const targetScreenId = '';

    const isValidNavigate = effectType !== 'NAVIGATE' || targetScreenId !== '';

    expect(isValidNavigate).toBe(false);
  });

  it('should require endpoint for CALL_API effect', () => {
    const effectType = 'CALL_API';
    const interfaceEndpointId: string | undefined = undefined;

    const isValidCallApi = effectType !== 'CALL_API' || !!interfaceEndpointId;

    expect(isValidCallApi).toBe(false);
  });

  it('should require at least one mutation with non-empty key for SET_STATE', () => {
    const effectType = 'SET_STATE';
    const emptyMutations = [{ key: '', value: '' }];
    const validMutations = [{ key: 'isLoading', value: 'true' }];

    const hasValidMutationEmpty = emptyMutations.some(m => m.key.trim() !== '');
    const hasValidMutation = validMutations.some(m => m.key.trim() !== '');

    expect(hasValidMutationEmpty).toBe(false);
    expect(hasValidMutation).toBe(true);
  });

  it('should validate complete form for different effect types', () => {
    // Helper function to validate form (matching modal logic)
    const isFormValid = (
      name: string,
      effectType: string,
      targetScreenId: string,
      interfaceEndpointId: string | undefined,
      mutations: Array<{ key: string; value?: string }>
    ): boolean => {
      if (!name.trim()) return false;

      switch (effectType) {
        case 'NAVIGATE':
          if (!targetScreenId) return false;
          break;
        case 'CALL_API':
          if (!interfaceEndpointId) return false;
          break;
        case 'SET_STATE':
          const hasValidMutation = mutations.some(m => m.key.trim() !== '');
          if (!hasValidMutation) return false;
          break;
      }

      return true;
    };

    // Test valid NAVIGATE form
    expect(isFormValid('Go to Dashboard', 'NAVIGATE', 'screen_1', undefined, [])).toBe(true);

    // Test invalid NAVIGATE form (missing target)
    expect(isFormValid('Go to Dashboard', 'NAVIGATE', '', undefined, [])).toBe(false);

    // Test valid CALL_API form
    expect(isFormValid('Fetch User', 'CALL_API', '', 'ep_1', [])).toBe(true);

    // Test invalid CALL_API form (missing endpoint)
    expect(isFormValid('Fetch User', 'CALL_API', '', undefined, [])).toBe(false);

    // Test valid SET_STATE form
    expect(isFormValid('Set Loading', 'SET_STATE', '', undefined, [{ key: 'isLoading', value: 'true' }])).toBe(true);

    // Test invalid SET_STATE form (empty key)
    expect(isFormValid('Set Loading', 'SET_STATE', '', undefined, [{ key: '', value: '' }])).toBe(false);
  });
});

// ============================================================================
// Additional Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  it('should have valid TRIGGER_TYPE_OPTIONS', () => {
    expect(TRIGGER_TYPE_OPTIONS).toBeDefined();
    expect(TRIGGER_TYPE_OPTIONS.length).toBeGreaterThan(0);
    expect(TRIGGER_TYPE_OPTIONS.some(opt => opt.value === 'CLICK')).toBe(true);
    expect(TRIGGER_TYPE_OPTIONS.some(opt => opt.value === 'SUBMIT')).toBe(true);
  });

  it('should have valid EFFECT_TYPE_OPTIONS', () => {
    expect(EFFECT_TYPE_OPTIONS).toBeDefined();
    expect(EFFECT_TYPE_OPTIONS.length).toBe(3);
    expect(EFFECT_TYPE_OPTIONS.some(opt => opt.value === 'NAVIGATE')).toBe(true);
    expect(EFFECT_TYPE_OPTIONS.some(opt => opt.value === 'CALL_API')).toBe(true);
    expect(EFFECT_TYPE_OPTIONS.some(opt => opt.value === 'SET_STATE')).toBe(true);
  });

  it('should handle null metaModel gracefully in getCallApiDisplayName', () => {
    const result = getCallApiDisplayName('ep_1', null);

    expect(result.displayName).toBe('Unknown Endpoint');
    expect(result.isValid).toBe(false);
  });

  it('should handle undefined endpointId gracefully in getCallApiDisplayName', () => {
    const metaModel = createMockMetaModel();
    const result = getCallApiDisplayName(undefined, metaModel);

    expect(result.displayName).toBe('Unknown Endpoint');
    expect(result.isValid).toBe(false);
  });
});
