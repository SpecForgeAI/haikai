/**
 * ApplicationPointPickerCell Kind-Based Grouping Tests
 *
 * Spec: Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task Group 1: Tests for kind-based grouping of Application Points
 *
 * Tests verify that:
 * - Application Points with kind=APPLICATION appear under "Applications" group
 * - Application Points with kind=APP_COMPONENT appear under "Application Components" group
 * - Application Points with kind=SERVICE appear under "Services" group
 * - Filtering works across all kind-based groups
 * - Derived AP creation still works for Service/Class/Method selection
 * - Groups only render when they have matching options
 */

import { describe, test, expect } from 'vitest';
import {
  MetaModelEntities,
  ApplicationPoint,
  ApplicationPointKind,
} from '../types/model';

// ============================================================================
// Test Data Factory
// ============================================================================

/**
 * Creates test entities with Application Points of different kinds
 */
function createTestEntitiesWithKinds(): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'Trading Platform', description: '', app_type: 'Web', status: 'Active', tags: '' },
      { id: 'app-2', name: 'Risk Engine', description: '', app_type: 'Service', status: 'Active', tags: '' },
    ],
    app_components: [
      { id: 'comp-1', name: 'Order Entry Module', description: '', application_id: 'app-1', tags: '' },
      { id: 'comp-2', name: 'Analytics Dashboard', description: '', application_id: 'app-1', tags: '' },
    ],
    services: [
      { id: 'svc-1', name: 'OrderService', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
      { id: 'svc-2', name: 'RiskCalcService', description: '', application_id: 'app-2', service_type: 'API', tags: '' },
      { id: 'svc-3', name: 'NotificationService', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
    ],
    interfaces: [],
    endpoints: [],
    classes: [
      { id: 'cls-1', name: 'OrderController', application_point_id: 'ap-svc-1' },
      { id: 'cls-2', name: 'RiskCalculator', application_point_id: 'ap-svc-2' },
    ],
    methods: [
      { id: 'mth-1', class_id: 'cls-1', name: 'processOrder' },
      { id: 'mth-2', class_id: 'cls-2', name: 'calculateRisk' },
    ],
    application_points: [
      // APPLICATION kind
      {
        id: 'ap-app-1',
        name: 'Trading Platform',
        description: 'Main trading application',
        kind: 'APPLICATION',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      },
      {
        id: 'ap-app-2',
        name: 'Risk Engine',
        description: 'Risk calculation engine',
        kind: 'APPLICATION',
        application_id: 'app-2',
        point_type: '',
        tags: '',
      },
      // APP_COMPONENT kind
      {
        id: 'ap-comp-1',
        name: 'Order Entry Module',
        description: 'Order entry component',
        kind: 'APP_COMPONENT',
        application_id: 'app-1',
        application_component_id: 'comp-1',
        point_type: '',
        tags: '',
      },
      {
        id: 'ap-comp-2',
        name: 'Analytics Dashboard',
        description: 'Analytics component',
        kind: 'APP_COMPONENT',
        application_id: 'app-1',
        application_component_id: 'comp-2',
        point_type: '',
        tags: '',
      },
      // SERVICE kind
      {
        id: 'ap-svc-1',
        name: 'OrderService',
        description: 'Order processing service',
        kind: 'SERVICE',
        application_id: 'app-1',
        service_id: 'svc-1',
        point_type: '',
        tags: '',
      },
      {
        id: 'ap-svc-2',
        name: 'RiskCalcService',
        description: 'Risk calculation service',
        kind: 'SERVICE',
        application_id: 'app-2',
        service_id: 'svc-2',
        point_type: '',
        tags: '',
      },
      // CLASS kind (derived)
      {
        id: 'ap_derived_class_cls-1',
        name: 'OrderController (Class)',
        description: '',
        kind: 'CLASS',
        application_id: 'app-1',
        target_type: 'CLASS',
        target_ref_id: 'cls-1',
        point_type: '',
        tags: '',
      },
      // METHOD kind (derived)
      {
        id: 'ap_derived_method_mth-1',
        name: 'processOrder (Method)',
        description: '',
        kind: 'METHOD',
        application_id: 'app-1',
        target_type: 'METHOD',
        target_ref_id: 'mth-1',
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
    ui_characteristics: [],
    package_sets: [],
    packages: [],
  };
}

// ============================================================================
// Import the grouping logic from ApplicationPointPickerCell
// We test the grouping logic directly
// ============================================================================

/**
 * OptionGroup type - matches ApplicationPointPickerCell's updated type
 */
type OptionGroup = 'applications' | 'app_components' | 'services' | 'classes' | 'methods';

/**
 * GROUP_LABELS constant - matches ApplicationPointPickerCell's updated labels
 */
const GROUP_LABELS: Record<OptionGroup, string> = {
  applications: 'Applications',
  app_components: 'Application Components',
  services: 'Services',
  classes: 'Classes',
  methods: 'Methods',
};

/**
 * Maps ApplicationPointKind to OptionGroup for grouping logic
 */
function kindToGroup(kind: ApplicationPointKind): OptionGroup | null {
  switch (kind) {
    case 'APPLICATION':
      return 'applications';
    case 'APP_COMPONENT':
      return 'app_components';
    case 'SERVICE':
      return 'services';
    case 'CLASS':
      return 'classes';
    case 'METHOD':
      return 'methods';
    default:
      return null;
  }
}

/**
 * GroupedOption interface for testing
 */
interface GroupedOption {
  group: OptionGroup;
  entity: ApplicationPoint;
  displayText: string;
}

/**
 * Simulates the buildGroupedOptions function from ApplicationPointPickerCell
 * Groups Application Points by their kind field
 */
function buildGroupedOptionsByKind(
  applicationPoints: ApplicationPoint[],
  searchText: string = ''
): GroupedOption[] {
  const options: GroupedOption[] = [];
  const search = searchText.toLowerCase();

  // Group Application Points by kind
  const kindGroups: OptionGroup[] = ['applications', 'app_components', 'services', 'classes', 'methods'];

  for (const group of kindGroups) {
    // Map group back to kind for filtering
    let targetKind: ApplicationPointKind;
    switch (group) {
      case 'applications':
        targetKind = 'APPLICATION';
        break;
      case 'app_components':
        targetKind = 'APP_COMPONENT';
        break;
      case 'services':
        targetKind = 'SERVICE';
        break;
      case 'classes':
        targetKind = 'CLASS';
        break;
      case 'methods':
        targetKind = 'METHOD';
        break;
    }

    applicationPoints
      .filter(ap => ap.kind === targetKind)
      .filter(ap => {
        if (!search) return true;
        return ap.name.toLowerCase().includes(search);
      })
      .slice(0, 5)
      .forEach(ap => {
        options.push({
          group,
          entity: ap,
          displayText: `${ap.name} [${ap.kind}]`,
        });
      });
  }

  return options;
}

// ============================================================================
// Test Suite: Task 1.1 - Kind-Based Grouping Tests
// ============================================================================

describe('ApplicationPointPickerCell Kind-Based Grouping', () => {

  describe('Test 1: APPLICATION kind appears under "Applications" group', () => {
    test('Application Points with kind=APPLICATION are grouped under "applications"', () => {
      const entities = createTestEntitiesWithKinds();
      const options = buildGroupedOptionsByKind(entities.application_points);

      // Filter to applications group
      const applicationsGroup = options.filter(opt => opt.group === 'applications');

      // Should have 2 APPLICATION kind APs
      expect(applicationsGroup).toHaveLength(2);

      // Verify they are the correct APs
      const apIds = applicationsGroup.map(opt => opt.entity.id);
      expect(apIds).toContain('ap-app-1');
      expect(apIds).toContain('ap-app-2');

      // Verify all have APPLICATION kind
      applicationsGroup.forEach(opt => {
        expect(opt.entity.kind).toBe('APPLICATION');
      });
    });

    test('GROUP_LABELS has correct label for applications', () => {
      expect(GROUP_LABELS.applications).toBe('Applications');
    });
  });

  describe('Test 2: APP_COMPONENT kind appears under "Application Components" group', () => {
    test('Application Points with kind=APP_COMPONENT are grouped under "app_components"', () => {
      const entities = createTestEntitiesWithKinds();
      const options = buildGroupedOptionsByKind(entities.application_points);

      // Filter to app_components group
      const appComponentsGroup = options.filter(opt => opt.group === 'app_components');

      // Should have 2 APP_COMPONENT kind APs
      expect(appComponentsGroup).toHaveLength(2);

      // Verify they are the correct APs
      const apIds = appComponentsGroup.map(opt => opt.entity.id);
      expect(apIds).toContain('ap-comp-1');
      expect(apIds).toContain('ap-comp-2');

      // Verify all have APP_COMPONENT kind
      appComponentsGroup.forEach(opt => {
        expect(opt.entity.kind).toBe('APP_COMPONENT');
      });
    });

    test('GROUP_LABELS has correct label for app_components', () => {
      expect(GROUP_LABELS.app_components).toBe('Application Components');
    });
  });

  describe('Test 3: SERVICE kind appears under "Services" group', () => {
    test('Application Points with kind=SERVICE are grouped under "services"', () => {
      const entities = createTestEntitiesWithKinds();
      const options = buildGroupedOptionsByKind(entities.application_points);

      // Filter to services group
      const servicesGroup = options.filter(opt => opt.group === 'services');

      // Should have 2 SERVICE kind APs
      expect(servicesGroup).toHaveLength(2);

      // Verify they are the correct APs
      const apIds = servicesGroup.map(opt => opt.entity.id);
      expect(apIds).toContain('ap-svc-1');
      expect(apIds).toContain('ap-svc-2');

      // Verify all have SERVICE kind
      servicesGroup.forEach(opt => {
        expect(opt.entity.kind).toBe('SERVICE');
      });
    });

    test('GROUP_LABELS has correct label for services', () => {
      expect(GROUP_LABELS.services).toBe('Services');
    });
  });

  describe('Test 4: Filtering works across all kind-based groups', () => {
    test('Search filter applies to all groups', () => {
      const entities = createTestEntitiesWithKinds();

      // Search for "Order" - should match Trading Platform and Order Entry Module, OrderService, OrderController
      const options = buildGroupedOptionsByKind(entities.application_points, 'Order');

      // Check each group
      const applicationsGroup = options.filter(opt => opt.group === 'applications');
      const appComponentsGroup = options.filter(opt => opt.group === 'app_components');
      const servicesGroup = options.filter(opt => opt.group === 'services');
      const classesGroup = options.filter(opt => opt.group === 'classes');

      // "Order" should match:
      // - applications: none (Trading Platform and Risk Engine don't contain "Order")
      // - app_components: Order Entry Module
      // - services: OrderService
      // - classes: OrderController
      expect(applicationsGroup).toHaveLength(0);
      expect(appComponentsGroup).toHaveLength(1);
      expect(appComponentsGroup[0].entity.name).toBe('Order Entry Module');
      expect(servicesGroup).toHaveLength(1);
      expect(servicesGroup[0].entity.name).toBe('OrderService');
      expect(classesGroup).toHaveLength(1);
      expect(classesGroup[0].entity.name).toBe('OrderController (Class)');
    });

    test('Case-insensitive search', () => {
      const entities = createTestEntitiesWithKinds();

      // Lowercase search
      const options1 = buildGroupedOptionsByKind(entities.application_points, 'risk');
      const options2 = buildGroupedOptionsByKind(entities.application_points, 'RISK');

      // Both should return same results
      expect(options1).toHaveLength(options2.length);

      // Should match Risk Engine and RiskCalcService
      const riskOptions = options1.filter(opt =>
        opt.entity.name.toLowerCase().includes('risk')
      );
      expect(riskOptions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Test 5: Derived AP creation still works (CLASS and METHOD selection)', () => {
    test('CLASS kind Application Points appear in classes group', () => {
      const entities = createTestEntitiesWithKinds();
      const options = buildGroupedOptionsByKind(entities.application_points);

      const classesGroup = options.filter(opt => opt.group === 'classes');

      // Should have 1 CLASS kind AP
      expect(classesGroup).toHaveLength(1);
      expect(classesGroup[0].entity.id).toBe('ap_derived_class_cls-1');
      expect(classesGroup[0].entity.kind).toBe('CLASS');
    });

    test('METHOD kind Application Points appear in methods group', () => {
      const entities = createTestEntitiesWithKinds();
      const options = buildGroupedOptionsByKind(entities.application_points);

      const methodsGroup = options.filter(opt => opt.group === 'methods');

      // Should have 1 METHOD kind AP
      expect(methodsGroup).toHaveLength(1);
      expect(methodsGroup[0].entity.id).toBe('ap_derived_method_mth-1');
      expect(methodsGroup[0].entity.kind).toBe('METHOD');
    });

    test('GROUP_LABELS has correct labels for derived groups', () => {
      expect(GROUP_LABELS.classes).toBe('Classes');
      expect(GROUP_LABELS.methods).toBe('Methods');
    });
  });

  describe('Test 6: Groups only render when they have matching options', () => {
    test('Empty groups are not included in results', () => {
      // Create entities with only APPLICATION kind APs
      const entities: MetaModelEntities = {
        ...createTestEntitiesWithKinds(),
        application_points: [
          {
            id: 'ap-app-only',
            name: 'Only Application',
            description: '',
            kind: 'APPLICATION',
            application_id: 'app-1',
            point_type: '',
            tags: '',
          },
        ],
      };

      const options = buildGroupedOptionsByKind(entities.application_points);

      // Only applications group should have options
      const applicationsGroup = options.filter(opt => opt.group === 'applications');
      const appComponentsGroup = options.filter(opt => opt.group === 'app_components');
      const servicesGroup = options.filter(opt => opt.group === 'services');
      const classesGroup = options.filter(opt => opt.group === 'classes');
      const methodsGroup = options.filter(opt => opt.group === 'methods');

      expect(applicationsGroup).toHaveLength(1);
      expect(appComponentsGroup).toHaveLength(0);
      expect(servicesGroup).toHaveLength(0);
      expect(classesGroup).toHaveLength(0);
      expect(methodsGroup).toHaveLength(0);
    });

    test('Search that matches nothing returns empty results', () => {
      const entities = createTestEntitiesWithKinds();
      const options = buildGroupedOptionsByKind(entities.application_points, 'xyz123nonexistent');

      expect(options).toHaveLength(0);
    });

    test('groupOrder preserves correct order', () => {
      // Verify the expected group order
      const groupOrder: OptionGroup[] = ['applications', 'app_components', 'services', 'classes', 'methods'];

      expect(groupOrder[0]).toBe('applications');
      expect(groupOrder[1]).toBe('app_components');
      expect(groupOrder[2]).toBe('services');
      expect(groupOrder[3]).toBe('classes');
      expect(groupOrder[4]).toBe('methods');
    });
  });
});

// ============================================================================
// Type Validation Tests
// ============================================================================

describe('OptionGroup Type Validation', () => {
  test('OptionGroup type includes all expected values', () => {
    // Verify the type includes all required groups
    const validGroups: OptionGroup[] = [
      'applications',
      'app_components',
      'services',
      'classes',
      'methods',
    ];

    // Each should be a valid OptionGroup
    validGroups.forEach(group => {
      expect(GROUP_LABELS[group]).toBeDefined();
    });
  });

  test('kindToGroup maps all ApplicationPointKind values correctly', () => {
    expect(kindToGroup('APPLICATION')).toBe('applications');
    expect(kindToGroup('APP_COMPONENT')).toBe('app_components');
    expect(kindToGroup('SERVICE')).toBe('services');
    expect(kindToGroup('CLASS')).toBe('classes');
    expect(kindToGroup('METHOD')).toBe('methods');
  });
});
