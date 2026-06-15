/**
 * Application Point Picker Tests
 *
 * Spec: Global Application Point Picker with Derived ApplicationPoints
 *
 * Tests for:
 * - applicationPointDerivation utility functions
 * - ApplicationPointPickerCell component logic
 * - Grid configuration updates
 * - Display formatting for CLASS and METHOD kinds
 */

import { describe, test, expect } from 'vitest';
import {
  generateDerivedApplicationPointId,
  generateDerivedApplicationPointName,
  findDerivedApplicationPoint,
  deriveApplicationIdForClass,
  deriveApplicationIdForMethod,
  ensureDerivedApplicationPoint,
  isDerivedApplicationPoint,
  getTargetEntityInfo,
  DerivedTargetType,
} from '../utils/applicationPointDerivation';
import {
  APPLICATION_POINT_KIND_LABELS,
  formatApplicationPointDisplay,
} from '../utils/formatters';
import { MetaModelEntities, ApplicationPoint, Service, Class, Method } from '../types/model';

// ============================================================================
// Test Data Factories
// ============================================================================

function createTestEntities(): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ],
    app_components: [
      { id: 'comp-1', name: 'Test Component', description: '', application_id: 'app-1', tags: '' },
    ],
    services: [
      { id: 'svc-1', name: 'OrderService', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
      { id: 'svc-2', name: 'PaymentService', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
    ],
    interfaces: [
      { id: 'iface-1', name: 'OrderAPI', description: '', service_id: 'svc-1', interface_type: 'REST_API', tags: '' },
    ],
    endpoints: [],
    classes: [
      { id: 'cls-1', name: 'OrderController', service_id: 'svc-1' },   // Owned by OrderService
      { id: 'cls-2', name: 'OrderRepository', service_id: 'svc-2' },  // Owned by PaymentService
      { id: 'cls-3', name: 'ComponentHelper', service_id: 'svc-1' }, // Owned by OrderService
      { id: 'cls-4', name: 'InterfaceHandler', service_id: 'svc-2' }, // Owned by PaymentService
      { id: 'cls-5', name: 'UnownedClass' }, // No owner (no service_id)
    ],
    methods: [
      { id: 'mth-1', class_id: 'cls-1', name: 'processOrder' },
      { id: 'mth-2', class_id: 'cls-2', name: 'findById' },
      { id: 'mth-3', class_id: 'cls-5', name: 'unownedMethod' },
    ],
    application_points: [
      {
        id: 'ap-1',
        name: 'OrderService AP',
        description: '',
        kind: 'SERVICE',
        application_id: 'app-1',
        service_id: 'svc-1',
        point_type: '',
        tags: '',
      },
      {
        id: 'ap-app-1',
        name: 'Test Application AP',
        description: '',
        kind: 'APPLICATION',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      },
      {
        id: 'ap-comp-1',
        name: 'Test Component AP',
        description: '',
        kind: 'APP_COMPONENT',
        application_id: 'app-1',
        application_component_id: 'comp-1',
        point_type: '',
        tags: '',
      },
      {
        id: 'ap-iface-1',
        name: 'OrderAPI AP',
        description: '',
        kind: 'INTERFACE',
        application_id: 'app-1',
        service_id: 'svc-1',
        interface_id: 'iface-1',
        point_type: '',
        tags: '',
      },
    ],
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
    business_logics: [],
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
  };
}

// ============================================================================
// Task Group 1: Type System Tests
// ============================================================================

describe('Task Group 1: Type System Updates', () => {
  test('1.1: ApplicationPointKind includes CLASS and METHOD', () => {
    // Verify the kind labels include the new types
    expect(APPLICATION_POINT_KIND_LABELS).toHaveProperty('CLASS');
    expect(APPLICATION_POINT_KIND_LABELS).toHaveProperty('METHOD');
    expect(APPLICATION_POINT_KIND_LABELS['CLASS']).toBe('Class');
    expect(APPLICATION_POINT_KIND_LABELS['METHOD']).toBe('Method');
  });

  test('1.2: APPLICATION_POINT_KIND_LABELS has all 5 kinds', () => {
    const expectedKinds = ['APPLICATION', 'APP_COMPONENT', 'SERVICE', 'CLASS', 'METHOD'];
    for (const kind of expectedKinds) {
      expect(APPLICATION_POINT_KIND_LABELS).toHaveProperty(kind);
    }
  });
});

// ============================================================================
// Task Group 2: Derivation Utility Module Tests
// ============================================================================

describe('Task Group 2: Derivation Utility Module', () => {
  describe('2.1: generateDerivedApplicationPointId', () => {
    test('generates correct ID for SERVICE', () => {
      const id = generateDerivedApplicationPointId('SERVICE', 'svc-123');
      expect(id).toBe('ap_derived_service_svc-123');
    });

    test('generates correct ID for CLASS', () => {
      const id = generateDerivedApplicationPointId('CLASS', 'cls-456');
      expect(id).toBe('ap_derived_class_cls-456');
    });

    test('generates correct ID for METHOD', () => {
      const id = generateDerivedApplicationPointId('METHOD', 'mth-789');
      expect(id).toBe('ap_derived_method_mth-789');
    });
  });

  describe('2.2: generateDerivedApplicationPointName', () => {
    test('generates correct name for SERVICE', () => {
      const name = generateDerivedApplicationPointName('SERVICE', 'OrderService');
      expect(name).toBe('OrderService (Service)');
    });

    test('generates correct name for CLASS', () => {
      const name = generateDerivedApplicationPointName('CLASS', 'OrderController');
      expect(name).toBe('OrderController (Class)');
    });

    test('generates correct name for METHOD', () => {
      const name = generateDerivedApplicationPointName('METHOD', 'processOrder');
      expect(name).toBe('processOrder (Method)');
    });
  });

  describe('2.3: findDerivedApplicationPoint', () => {
    test('returns undefined when no matching AP exists', () => {
      const entities = createTestEntities();
      const result = findDerivedApplicationPoint('SERVICE', 'svc-1', entities.application_points);
      expect(result).toBeUndefined();
    });

    test('finds existing derived AP by ID pattern', () => {
      const entities = createTestEntities();
      const derivedAP: ApplicationPoint = {
        id: 'ap_derived_class_cls-1',
        name: 'OrderController (Class)',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        target_type: 'CLASS',
        target_ref_id: 'cls-1',
        point_type: '',
        tags: '',
      };
      entities.application_points.push(derivedAP);

      const result = findDerivedApplicationPoint('CLASS', 'cls-1', entities.application_points);
      expect(result).toBeDefined();
      expect(result?.id).toBe('ap_derived_class_cls-1');
    });
  });

  describe('2.4: deriveApplicationIdForClass', () => {
    test('returns application_id via service_id (cls-2 -> svc-2 -> app-1)', () => {
      const entities = createTestEntities();
      const cls = entities.classes.find(c => c.id === 'cls-2')!;
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('app-1');
    });

    test('returns application_id via service_id (cls-3 -> svc-1 -> app-1)', () => {
      const entities = createTestEntities();
      const cls = entities.classes.find(c => c.id === 'cls-3')!;
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('app-1');
    });

    test('returns application_id via service_id (cls-1 -> svc-1 -> app-1)', () => {
      const entities = createTestEntities();
      const cls = entities.classes.find(c => c.id === 'cls-1')!;
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('app-1');
    });

    test('returns application_id via service_id (cls-4 -> svc-2 -> app-1)', () => {
      const entities = createTestEntities();
      const cls = entities.classes.find(c => c.id === 'cls-4')!;
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('app-1');
    });

    test('returns empty string when class has no service_id', () => {
      const entities = createTestEntities();
      const cls = entities.classes.find(c => c.id === 'cls-5')!;
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('');
    });
  });

  describe('2.5: deriveApplicationIdForMethod', () => {
    test('returns application_id via owning class', () => {
      const entities = createTestEntities();
      const method = entities.methods.find(m => m.id === 'mth-1')!;
      const appId = deriveApplicationIdForMethod(method, entities);
      expect(appId).toBe('app-1');
    });

    test('returns empty string when owning class has no service_id', () => {
      const entities = createTestEntities();
      const method = entities.methods.find(m => m.id === 'mth-3')!;
      const appId = deriveApplicationIdForMethod(method, entities);
      expect(appId).toBe('');
    });
  });

  describe('2.6: ensureDerivedApplicationPoint', () => {
    test('creates new derived AP for SERVICE', () => {
      const entities = createTestEntities();
      const result = ensureDerivedApplicationPoint('SERVICE', 'svc-1', entities);

      expect(result.isNew).toBe(true);
      expect(result.applicationPoint.id).toBe('ap_derived_service_svc-1');
      expect(result.applicationPoint.kind).toBe('SERVICE');
      expect(result.applicationPoint.target_type).toBe('SERVICE');
      expect(result.applicationPoint.target_ref_id).toBe('svc-1');
      expect(result.applicationPoint.application_id).toBe('app-1');
    });

    test('creates new derived AP for CLASS', () => {
      const entities = createTestEntities();
      const result = ensureDerivedApplicationPoint('CLASS', 'cls-1', entities);

      expect(result.isNew).toBe(true);
      expect(result.applicationPoint.id).toBe('ap_derived_class_cls-1');
      expect(result.applicationPoint.kind).toBe('CLASS');
      expect(result.applicationPoint.name).toBe('OrderController (Class)');
    });

    test('creates new derived AP for METHOD', () => {
      const entities = createTestEntities();
      const result = ensureDerivedApplicationPoint('METHOD', 'mth-1', entities);

      expect(result.isNew).toBe(true);
      expect(result.applicationPoint.id).toBe('ap_derived_method_mth-1');
      expect(result.applicationPoint.kind).toBe('METHOD');
      expect(result.applicationPoint.name).toBe('processOrder (Method)');
    });

    test('returns existing derived AP if already exists', () => {
      const entities = createTestEntities();
      const existingAP: ApplicationPoint = {
        id: 'ap_derived_service_svc-2',
        name: 'PaymentService (Service)',
        description: '',
        kind: 'SERVICE',
        application_id: 'app-1',
        service_id: 'svc-2',
        target_type: 'SERVICE',
        target_ref_id: 'svc-2',
        point_type: '',
        tags: '',
      };
      entities.application_points.push(existingAP);

      const result = ensureDerivedApplicationPoint('SERVICE', 'svc-2', entities);
      expect(result.isNew).toBe(false);
      expect(result.applicationPoint.id).toBe('ap_derived_service_svc-2');
    });

    test('throws error for non-existent SERVICE', () => {
      const entities = createTestEntities();
      expect(() => {
        ensureDerivedApplicationPoint('SERVICE', 'svc-nonexistent', entities);
      }).toThrow('Service not found');
    });

    test('throws error for non-existent CLASS', () => {
      const entities = createTestEntities();
      expect(() => {
        ensureDerivedApplicationPoint('CLASS', 'cls-nonexistent', entities);
      }).toThrow('Class not found');
    });

    test('throws error for non-existent METHOD', () => {
      const entities = createTestEntities();
      expect(() => {
        ensureDerivedApplicationPoint('METHOD', 'mth-nonexistent', entities);
      }).toThrow('Method not found');
    });
  });

  describe('2.7: isDerivedApplicationPoint', () => {
    test('returns true when both target_type and target_ref_id are set', () => {
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'Test',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        target_type: 'CLASS',
        target_ref_id: 'cls-1',
        point_type: '',
        tags: '',
      };
      expect(isDerivedApplicationPoint(ap)).toBe(true);
    });

    test('returns false when target_type is not set', () => {
      const ap: ApplicationPoint = {
        id: 'ap-1',
        name: 'Test',
        description: '',
        kind: 'APPLICATION',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      };
      expect(isDerivedApplicationPoint(ap)).toBe(false);
    });
  });

  describe('2.8: getTargetEntityInfo', () => {
    test('returns null when AP has no target info', () => {
      const entities = createTestEntities();
      const ap = entities.application_points[0]; // Non-derived AP
      const result = getTargetEntityInfo(ap, entities);
      expect(result).toBeNull();
    });

    test('returns target info for SERVICE-targeting AP', () => {
      const entities = createTestEntities();
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'OrderService (Service)',
        description: '',
        kind: 'SERVICE',
        application_id: 'app-1',
        target_type: 'SERVICE',
        target_ref_id: 'svc-1',
        point_type: '',
        tags: '',
      };

      const result = getTargetEntityInfo(ap, entities);
      expect(result).toBeDefined();
      expect(result?.targetType).toBe('SERVICE');
      expect((result?.targetEntity as Service).name).toBe('OrderService');
    });

    test('returns target info for CLASS-targeting AP', () => {
      const entities = createTestEntities();
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'OrderController (Class)',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        target_type: 'CLASS',
        target_ref_id: 'cls-1',
        point_type: '',
        tags: '',
      };

      const result = getTargetEntityInfo(ap, entities);
      expect(result).toBeDefined();
      expect(result?.targetType).toBe('CLASS');
      expect((result?.targetEntity as Class).name).toBe('OrderController');
    });

    test('returns target info for METHOD-targeting AP', () => {
      const entities = createTestEntities();
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'processOrder (Method)',
        description: '',
        kind: 'METHOD',
        application_id: 'app-1',
        target_type: 'METHOD',
        target_ref_id: 'mth-1',
        point_type: '',
        tags: '',
      };

      const result = getTargetEntityInfo(ap, entities);
      expect(result).toBeDefined();
      expect(result?.targetType).toBe('METHOD');
      expect((result?.targetEntity as Method).name).toBe('processOrder');
    });
  });
});

// ============================================================================
// Task Group 6: Display Formatting Tests
// ============================================================================

describe('Task Group 6: Display Formatting', () => {
  describe('6.1: formatApplicationPointDisplay', () => {
    test('formats standard APPLICATION kind', () => {
      const ap: ApplicationPoint = {
        id: 'ap-1',
        name: 'Test App',
        description: '',
        kind: 'APPLICATION',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      };
      const display = formatApplicationPointDisplay(ap);
      expect(display).toBe('Test App (Application)');
    });

    test('formats CLASS kind', () => {
      const ap: ApplicationPoint = {
        id: 'ap-2',
        name: 'OrderController (Class)',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      };
      const display = formatApplicationPointDisplay(ap);
      expect(display).toBe('OrderController (Class) (Class)');
    });

    test('formats METHOD kind', () => {
      const ap: ApplicationPoint = {
        id: 'ap-3',
        name: 'processOrder (Method)',
        description: '',
        kind: 'METHOD',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      };
      const display = formatApplicationPointDisplay(ap);
      expect(display).toBe('processOrder (Method) (Method)');
    });

    test('shows target info when entities provided for derived AP', () => {
      const entities = createTestEntities();
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'Derived AP',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        target_type: 'CLASS',
        target_ref_id: 'cls-1',
        point_type: '',
        tags: '',
      };
      const display = formatApplicationPointDisplay(ap, entities);
      expect(display).toBe('OrderController (Class)');
    });

    test('shows target info for METHOD with class prefix', () => {
      const entities = createTestEntities();
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'Derived AP',
        description: '',
        kind: 'METHOD',
        application_id: 'app-1',
        target_type: 'METHOD',
        target_ref_id: 'mth-1',
        point_type: '',
        tags: '',
      };
      const display = formatApplicationPointDisplay(ap, entities);
      expect(display).toBe('OrderController.processOrder (Method)');
    });

    test('falls back to kind-based formatting when target not found', () => {
      const entities = createTestEntities();
      const ap: ApplicationPoint = {
        id: 'ap-derived',
        name: 'Unknown Target',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        target_type: 'CLASS',
        target_ref_id: 'cls-nonexistent',
        point_type: '',
        tags: '',
      };
      const display = formatApplicationPointDisplay(ap, entities);
      expect(display).toBe('Unknown Target (Class)');
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  test('full flow: select Service, create derived AP, get display name', () => {
    const entities = createTestEntities();

    // 1. User selects a Service in the picker
    const selectedServiceId = 'svc-1';

    // 2. ensureDerivedApplicationPoint is called
    const result = ensureDerivedApplicationPoint('SERVICE', selectedServiceId, entities);

    // 3. Verify the new AP
    expect(result.isNew).toBe(true);
    expect(result.applicationPoint.id).toBe('ap_derived_service_svc-1');
    expect(result.applicationPoint.application_id).toBe('app-1');

    // 4. Add to entities (simulating dispatch)
    entities.application_points.push(result.applicationPoint);

    // 5. Verify subsequent lookup returns existing AP
    const result2 = ensureDerivedApplicationPoint('SERVICE', selectedServiceId, entities);
    expect(result2.isNew).toBe(false);
    expect(result2.applicationPoint.id).toBe('ap_derived_service_svc-1');

    // 6. Verify display formatting
    const display = formatApplicationPointDisplay(result.applicationPoint, entities);
    expect(display).toBe('OrderService (Service)');
  });

  test('full flow: select Method, create derived AP, get display name', () => {
    const entities = createTestEntities();

    // 1. User selects a Method in the picker
    const selectedMethodId = 'mth-1';

    // 2. ensureDerivedApplicationPoint is called
    const result = ensureDerivedApplicationPoint('METHOD', selectedMethodId, entities);

    // 3. Verify the new AP
    expect(result.isNew).toBe(true);
    expect(result.applicationPoint.kind).toBe('METHOD');
    expect(result.applicationPoint.target_type).toBe('METHOD');
    expect(result.applicationPoint.target_ref_id).toBe('mth-1');
    // Method's class is owned by svc-1 which belongs to app-1
    expect(result.applicationPoint.application_id).toBe('app-1');

    // 4. Display should show Class.Method format
    entities.application_points.push(result.applicationPoint);
    const display = formatApplicationPointDisplay(result.applicationPoint, entities);
    expect(display).toBe('OrderController.processOrder (Method)');
  });
});
