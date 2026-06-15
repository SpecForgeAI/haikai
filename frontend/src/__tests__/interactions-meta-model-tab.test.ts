/**
 * Interactions Meta-Model Tab Tests
 *
 * Tests for the Interactions tab feature in the meta-model view.
 * Covers grid configuration, tab integration, formatter, entity creation, and validation.
 */

import { gridConfigs, tabToEntityType, entityTabNames, domainGroupings, relationshipTabNames, relationshipTabToType } from '../config/gridConfigs';
import { generateEntityId, getEntityPrefix } from '../utils/idGenerator';
import { ENTITY_TYPES, MetaModel, resolveAppBusinessPoint } from '../types/model';
import {
  APP_BUSINESS_POINT_KIND_LABELS,
  formatAppBusinessPointDisplay,
  createAppBusinessPointDisplayFormatter,
} from '../utils/formatters';
import { validateModel } from '../utils/validation';
import { emptyModel } from '../config/defaults';

// ============================================================================
// Task Group 1: Grid Configuration Tests
// ============================================================================

describe('Task Group 1: Grid Configuration for Interactions', () => {
  describe('gridConfigs.interactions', () => {
    it('should have interactions grid configuration defined', () => {
      expect(gridConfigs.interactions).toBeDefined();
      expect(Array.isArray(gridConfigs.interactions)).toBe(true);
      expect(gridConfigs.interactions.length).toBeGreaterThan(0);
    });

    it('should have expected column definitions', () => {
      const columns = gridConfigs.interactions;
      const columnFields = columns.map((c) => c.field);

      expect(columnFields).toContain('id');
      expect(columnFields).toContain('name');
      expect(columnFields).toContain('description');
      expect(columnFields).toContain('user_id');
      expect(columnFields).toContain('primary_app_business_point_id');
      expect(columnFields).toContain('secondary_app_business_point_id');
      expect(columnFields).toContain('tags');
    });

    it('should have required columns marked as required', () => {
      const columns = gridConfigs.interactions;

      const idColumn = columns.find((c) => c.field === 'id');
      const nameColumn = columns.find((c) => c.field === 'name');
      const userIdColumn = columns.find((c) => c.field === 'user_id');
      const primaryPointColumn = columns.find((c) => c.field === 'primary_app_business_point_id');

      expect(idColumn?.required).toBe(true);
      expect(nameColumn?.required).toBe(true);
      expect(userIdColumn?.required).toBe(true);
      expect(primaryPointColumn?.required).toBe(true);
    });

    it('should have optional columns marked as not required', () => {
      const columns = gridConfigs.interactions;

      const descriptionColumn = columns.find((c) => c.field === 'description');
      const secondaryPointColumn = columns.find((c) => c.field === 'secondary_app_business_point_id');
      const tagsColumn = columns.find((c) => c.field === 'tags');

      expect(descriptionColumn?.required).toBe(false);
      expect(secondaryPointColumn?.required).toBe(false);
      expect(tagsColumn?.required).toBe(false);
    });

    it('should have fk_typeahead columns with correct fkTarget values', () => {
      const columns = gridConfigs.interactions;

      const userIdColumn = columns.find((c) => c.field === 'user_id');
      expect(userIdColumn?.cellType).toBe('fk_typeahead');
      expect(userIdColumn?.fkTarget).toBe('business_users');
    });

    it('should have column widths as reasonable positive values', () => {
      const columns = gridConfigs.interactions;

      columns.forEach((column) => {
        expect(column.width).toBeDefined();
        expect(column.width).toBeGreaterThan(0);
      });
    });

    it('should have ID column with autoGenerate true', () => {
      const columns = gridConfigs.interactions;
      const idColumn = columns.find((c) => c.field === 'id');

      expect(idColumn?.autoGenerate).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 2: Tab and Domain Grouping Integration Tests
// ============================================================================

// NOTE: Interactions was reclassified as a RELATIONSHIP tab (spec:
// 2025-12-09-fix-interactions-double-rendering-and-abp-mapping). It now lives
// in relationshipTabNames / relationshipTabToType only, NOT in entityTabNames /
// tabToEntityType / domainGroupings.business. The original entity-tab placement
// assertions here were updated to the current relationship-tab placement; the
// contradicting suites (interactions-tab-routing.test.ts and
// interactions-fix-integration.test.ts) were deleted.
describe('Task Group 2: Tab and Domain Grouping Integration', () => {
  describe('tabToEntityType mapping', () => {
    it('should NOT have Interactions in tabToEntityType (relationship tab now)', () => {
      expect(tabToEntityType['Interactions']).toBeUndefined();
      expect(relationshipTabToType['Interactions']).toBe('interactions');
    });
  });

  describe('entityTabNames array', () => {
    it('should NOT contain Interactions tab (routes via RelationshipGrid)', () => {
      expect(entityTabNames).not.toContain('Interactions');
      expect(relationshipTabNames).toContain('Interactions');
    });

    it('should position Interactions after App Point <-> Business Point in relationshipTabNames', () => {
      const anchorIndex = relationshipTabNames.indexOf('App Point <-> Business Point');
      const interactionsIndex = relationshipTabNames.indexOf('Interactions');

      expect(anchorIndex).toBeGreaterThanOrEqual(0);
      expect(interactionsIndex).toBe(anchorIndex + 1);
    });
  });

  describe('domainGroupings', () => {
    it('should NOT have Interactions in business domain group', () => {
      expect(domainGroupings.business).not.toContain('Interactions');
    });

    it('should have correct business group tab ordering', () => {
      // Spec 2026-04-01 added User Journeys and Activity Steps after Activities
      expect(domainGroupings.business).toEqual(['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']);
    });
  });
});

// ============================================================================
// Task Group 3: App_Business_Point Display Formatter Tests
// ============================================================================

describe('Task Group 3: App_Business_Point Display Formatter', () => {
  // Mock MetaModel for formatter tests
  const mockMetaModel: MetaModel = {
    entities: {
      applications: [
        { id: 'app-001', name: 'Order System', description: '', app_type: 'web', status: 'active', tags: '' },
      ],
      app_components: [
        { id: 'ac-001', name: 'Order UI', description: '', application_id: 'app-001', tags: '' },
      ],
      services: [
        { id: 'svc-001', name: 'Order API', description: '', application_id: 'app-001', service_type: 'api', tags: '' },
      ],
      interfaces: [
        { id: 'ifc-001', name: 'REST Orders', description: '', service_id: 'svc-001', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [
        { id: 'ep-001', name: 'GET /orders', description: '', interface_id: 'ifc-001', endpoint_type: 'HTTP_REST', path_or_address: '/orders', tags: '' },
      ],
      business_processes: [
        { id: 'bp-001', name: 'Order Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-001', name: 'Validate Order', description: '', business_process_id: 'bp-001', actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      ],
      business_users: [],
      business_points: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };

  describe('APP_BUSINESS_POINT_KIND_LABELS', () => {
    it('should have labels for all 7 App_Business_Point entity types', () => {
      expect(APP_BUSINESS_POINT_KIND_LABELS).toBeDefined();

      expect(APP_BUSINESS_POINT_KIND_LABELS['APPLICATION']).toBe('Application');
      expect(APP_BUSINESS_POINT_KIND_LABELS['APP_COMPONENT']).toBe('Application Component');
      expect(APP_BUSINESS_POINT_KIND_LABELS['SERVICE']).toBe('Service');
      expect(APP_BUSINESS_POINT_KIND_LABELS['INTERFACE']).toBe('Interface');
      expect(APP_BUSINESS_POINT_KIND_LABELS['ENDPOINT']).toBe('Endpoint');
      expect(APP_BUSINESS_POINT_KIND_LABELS['BUSINESS_PROCESS']).toBe('Business Process');
      expect(APP_BUSINESS_POINT_KIND_LABELS['PROCESS_ACTIVITY']).toBe('Process Activity');
    });
  });

  describe('formatAppBusinessPointDisplay', () => {
    it('should format APPLICATION entity correctly', () => {
      const resolved = resolveAppBusinessPoint('app-001', mockMetaModel);
      expect(resolved).not.toBeNull();

      const display = formatAppBusinessPointDisplay(resolved!.entity, resolved!.entityType);
      expect(display).toBe('Order System (Application)');
    });

    it('should format SERVICE entity correctly', () => {
      const resolved = resolveAppBusinessPoint('svc-001', mockMetaModel);
      expect(resolved).not.toBeNull();

      const display = formatAppBusinessPointDisplay(resolved!.entity, resolved!.entityType);
      expect(display).toBe('Order API (Service)');
    });

    it('should format BUSINESS_PROCESS entity correctly', () => {
      const resolved = resolveAppBusinessPoint('bp-001', mockMetaModel);
      expect(resolved).not.toBeNull();

      const display = formatAppBusinessPointDisplay(resolved!.entity, resolved!.entityType);
      expect(display).toBe('Order Processing (Business Process)');
    });

    it('should format PROCESS_ACTIVITY entity correctly', () => {
      const resolved = resolveAppBusinessPoint('pa-001', mockMetaModel);
      expect(resolved).not.toBeNull();

      const display = formatAppBusinessPointDisplay(resolved!.entity, resolved!.entityType);
      expect(display).toBe('Validate Order (Process Activity)');
    });

    it('should format INTERFACE entity correctly', () => {
      const resolved = resolveAppBusinessPoint('ifc-001', mockMetaModel);
      expect(resolved).not.toBeNull();

      const display = formatAppBusinessPointDisplay(resolved!.entity, resolved!.entityType);
      expect(display).toBe('REST Orders (Interface)');
    });

    it('should format ENDPOINT entity correctly', () => {
      const resolved = resolveAppBusinessPoint('ep-001', mockMetaModel);
      expect(resolved).not.toBeNull();

      const display = formatAppBusinessPointDisplay(resolved!.entity, resolved!.entityType);
      expect(display).toBe('GET /orders (Endpoint)');
    });
  });

  describe('createAppBusinessPointDisplayFormatter', () => {
    it('should return empty string for empty ID', () => {
      const formatter = createAppBusinessPointDisplayFormatter(mockMetaModel);
      const result = formatter('', []);
      expect(result).toBe('');
    });

    it('should return ID fallback when entity not found', () => {
      const formatter = createAppBusinessPointDisplayFormatter(mockMetaModel);
      const result = formatter('non-existent-id', []);
      expect(result).toBe('non-existent-id');
    });

    it('should format APPLICATION entity when found', () => {
      const formatter = createAppBusinessPointDisplayFormatter(mockMetaModel);
      const result = formatter('app-001', []);
      expect(result).toBe('Order System (Application)');
    });

    it('should format SERVICE entity when found', () => {
      const formatter = createAppBusinessPointDisplayFormatter(mockMetaModel);
      const result = formatter('svc-001', []);
      expect(result).toBe('Order API (Service)');
    });

    it('should search across all 7 App_Business_Point collections', () => {
      const formatter = createAppBusinessPointDisplayFormatter(mockMetaModel);

      // Test each collection type
      expect(formatter('app-001', [])).toBe('Order System (Application)');
      expect(formatter('ac-001', [])).toBe('Order UI (Application Component)');
      expect(formatter('svc-001', [])).toBe('Order API (Service)');
      expect(formatter('ifc-001', [])).toBe('REST Orders (Interface)');
      expect(formatter('ep-001', [])).toBe('GET /orders (Endpoint)');
      expect(formatter('bp-001', [])).toBe('Order Processing (Business Process)');
      expect(formatter('pa-001', [])).toBe('Validate Order (Process Activity)');
    });
  });
});

// ============================================================================
// Task Group 4: Empty Entity Creation and ID Generation Tests
// ============================================================================

describe('Task Group 4: Empty Entity Creation and ID Generation', () => {
  describe('ID generation for interactions', () => {
    it('should have interactions prefix defined in idGenerator', () => {
      const prefix = getEntityPrefix('interactions');
      expect(prefix).toBe('int');
    });

    it('should generate ID with int- prefix', () => {
      const id = generateEntityId('interactions');
      expect(id).toMatch(/^int-/);
    });

    it('should generate ID following pattern: int-<timestamp>-<random>', () => {
      const id = generateEntityId('interactions');
      // Pattern: int-<base36timestamp>-<base36random>
      expect(id).toMatch(/^int-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const id1 = generateEntityId('interactions');
      const id2 = generateEntityId('interactions');
      expect(id1).not.toBe(id2);
    });
  });
});

// ============================================================================
// Task Group 5: Validation Integration Tests
// ============================================================================

describe('Task Group 5: Validation Integration for Interactions', () => {
  describe('validateModel with interactions', () => {
    it('should validate interactions entity type', () => {
      // Create a model with an interaction missing required fields
      const modelWithInvalidInteraction = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            interactions: [
              {
                id: 'int-001',
                name: '', // Missing required name
                user_id: '', // Missing required user_id
                primary_app_business_point_id: '', // Missing required primary point
              },
            ],
          },
        },
      };

      const errors = validateModel(modelWithInvalidInteraction);

      // Should have validation errors for missing fields
      const interactionErrors = errors.filter((e) => e.entityType === 'interactions');
      expect(interactionErrors.length).toBeGreaterThan(0);
    });

    it('should validate missing user_id reference', () => {
      const modelWithMissingUser = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            interactions: [
              {
                id: 'int-001',
                name: 'Test Interaction',
                user_id: '', // Empty user_id
                primary_app_business_point_id: '',
              },
            ],
          },
        },
      };

      const errors = validateModel(modelWithMissingUser);
      const userIdErrors = errors.filter(
        (e) => e.entityType === 'interactions' && e.field === 'user_id'
      );
      expect(userIdErrors.length).toBeGreaterThan(0);
    });

    it('should validate missing primary_app_business_point_id reference', () => {
      const modelWithMissingPrimaryPoint = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            business_users: [
              { id: 'user-001', name: 'Test User', description: '', tags: '' },
            ],
            interactions: [
              {
                id: 'int-001',
                name: 'Test Interaction',
                user_id: 'user-001',
                primary_app_business_point_id: '', // Empty primary point
              },
            ],
          },
        },
      };

      const errors = validateModel(modelWithMissingPrimaryPoint);
      const primaryPointErrors = errors.filter(
        (e) => e.entityType === 'interactions' && e.field === 'primary_app_business_point_id'
      );
      expect(primaryPointErrors.length).toBeGreaterThan(0);
    });

    it('should validate invalid FK references for user_id', () => {
      const modelWithInvalidUserRef = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            applications: [
              { id: 'app-001', name: 'Test App', description: '', app_type: '', status: '', tags: '' },
            ],
            interactions: [
              {
                id: 'int-001',
                name: 'Test Interaction',
                user_id: 'non-existent-user', // Invalid user_id
                primary_app_business_point_id: 'app-001',
              },
            ],
          },
        },
      };

      const errors = validateModel(modelWithInvalidUserRef);
      const userIdErrors = errors.filter(
        (e) => e.entityType === 'interactions' && e.field === 'user_id'
      );
      expect(userIdErrors.length).toBeGreaterThan(0);
    });

    it('should pass validation for valid interaction', () => {
      const validModel = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            business_users: [
              { id: 'user-001', name: 'Test User', description: '', tags: '' },
            ],
            applications: [
              { id: 'app-001', name: 'Test App', description: '', app_type: '', status: '', tags: '' },
            ],
            interactions: [
              {
                id: 'int-001',
                name: 'Valid Interaction',
                description: 'A valid interaction',
                user_id: 'user-001',
                primary_app_business_point_id: 'app-001',
              },
            ],
          },
        },
      };

      const errors = validateModel(validModel);
      const interactionErrors = errors.filter((e) => e.entityType === 'interactions');
      expect(interactionErrors.length).toBe(0);
    });
  });
});

// ============================================================================
// Task Group 6: Integration Tests
// ============================================================================

describe('Task Group 6: Integration Tests', () => {
  describe('End-to-end interaction entity configuration', () => {
    it('should have all configuration pieces in place for interactions tab', () => {
      // Grid config exists
      expect(gridConfigs.interactions).toBeDefined();

      // Tab mapping exists (relationship tab, per the reclassify spec)
      expect(relationshipTabToType['Interactions']).toBe('interactions');

      // Tab name is in the relationship list, not the entity list
      expect(relationshipTabNames).toContain('Interactions');
      expect(entityTabNames).not.toContain('Interactions');

      // Domain grouping does NOT include Interactions (relationship tab)
      expect(domainGroupings.business).not.toContain('Interactions');

      // ID prefix is configured
      expect(getEntityPrefix('interactions')).toBe('int');
    });

    it('should have ENTITY_TYPES.INTERACTION defined', () => {
      expect(ENTITY_TYPES.INTERACTION).toBe('INTERACTION');
    });

    it('should have interactions array in emptyModel', () => {
      expect(emptyModel.metaModel.entities.interactions).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.interactions)).toBe(true);
    });
  });
});
