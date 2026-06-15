/**
 * Tests for AppBusinessPoint Synchronization Utilities
 * Task Group 2: Sync Utilities Layer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateAppBusinessPointId,
  createAppBusinessPointFromEntity,
  findAppBusinessPointForEntity,
  findSourceEntityForAppBusinessPoint,
  syncAppBusinessPointNames,
  syncAppBusinessPointNameForEntity,
  getOrphanedAppBusinessPoints,
  cascadeDeleteAppBusinessPoint,
  cascadeDeleteForABPSourceEntity,
  reconcileAppBusinessPoints,
  isABPSourceEntityType,
  ABPSourceEntityType,
} from '../utils/appBusinessPointSync';
import {
  AppBusinessPoint,
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
  Application,
  ApplicationComponent,
  Service,
  Interface,
  BusinessProcess,
  ProcessActivity,
  Interaction,
} from '../types/model';

// Helper to create empty entities
const createEmptyEntities = (): MetaModelEntities => ({
  business_users: [],
  business_processes: [],
  process_activities: [],
  business_points: [],
  applications: [],
  app_components: [],
  services: [],
  interfaces: [],
  endpoints: [],
  application_points: [],
  logical_data_entities: [],
  logical_data_attributes: [],
  physical_data_entities: [],
  physical_data_attributes: [],
  interactions: [],
  app_business_points: [],
});

// Helper to create empty relationships
const createEmptyRelationships = (): MetaModelRelationships => ({
  business_user_business_points: [],
  application_point_business_points: [],
  logical_data_entity_relationships: [],
  logical_data_entity_physical_data_entities: [],
  logical_data_attribute_physical_data_attributes: [],
  data_movements: [],
  interface_logical_entities: [],
});

describe('AppBusinessPoint Sync Utilities', () => {
  describe('generateAppBusinessPointId', () => {
    it('should generate ID with abp_ prefix', () => {
      const result = generateAppBusinessPointId('app_001');
      expect(result).toBe('abp_app_001');
    });

    it('should be deterministic (same input -> same output)', () => {
      const id1 = generateAppBusinessPointId('test_entity');
      const id2 = generateAppBusinessPointId('test_entity');
      expect(id1).toBe(id2);
    });
  });

  describe('createAppBusinessPointFromEntity', () => {
    it('should create ABP from Application', () => {
      const app: Application = {
        id: 'app_001',
        name: 'Test Application',
        description: 'Test',
        app_type: 'Web',
        status: 'Active',
        tags: '',
      };

      const abp = createAppBusinessPointFromEntity(app, 'applications');

      expect(abp.id).toBe('abp_app_001');
      expect(abp.name).toBe('Test Application');
      expect(abp.kind).toBe('APPLICATION');
      expect(abp.source_entity_id).toBe('app_001');
    });

    it('should create ABP from App Component', () => {
      const comp: ApplicationComponent = {
        id: 'comp_001',
        name: 'Test Component',
        description: 'Test',
        application_id: 'app_001',
        tags: '',
      };

      const abp = createAppBusinessPointFromEntity(comp, 'app_components');

      expect(abp.id).toBe('abp_comp_001');
      expect(abp.name).toBe('Test Component');
      expect(abp.kind).toBe('APP_COMPONENT');
      expect(abp.source_entity_id).toBe('comp_001');
    });

    it('should create ABP from Service', () => {
      const svc: Service = {
        id: 'svc_001',
        name: 'Test Service',
        description: 'Test',
        application_id: 'app_001',
        service_type: 'REST',
        tags: '',
      };

      const abp = createAppBusinessPointFromEntity(svc, 'services');

      expect(abp.id).toBe('abp_svc_001');
      expect(abp.name).toBe('Test Service');
      expect(abp.kind).toBe('SERVICE');
      expect(abp.source_entity_id).toBe('svc_001');
    });

    it('should create ABP from Interface', () => {
      const iface: Interface = {
        id: 'iface_001',
        name: 'Test Interface',
        description: 'Test',
        service_id: 'svc_001',
        interface_type: 'REST_API',
        tags: '',
      };

      const abp = createAppBusinessPointFromEntity(iface, 'interfaces');

      expect(abp.id).toBe('abp_iface_001');
      expect(abp.name).toBe('Test Interface');
      expect(abp.kind).toBe('INTERFACE');
      expect(abp.source_entity_id).toBe('iface_001');
    });

    it('should create ABP from Business Process', () => {
      const proc: BusinessProcess = {
        id: 'proc_001',
        name: 'Test Process',
        description: 'Test',
        tags: '',
      };

      const abp = createAppBusinessPointFromEntity(proc, 'business_processes');

      expect(abp.id).toBe('abp_proc_001');
      expect(abp.name).toBe('Test Process');
      expect(abp.kind).toBe('BUSINESS_PROCESS');
      expect(abp.source_entity_id).toBe('proc_001');
    });

    it('should create ABP from Process Activity', () => {
      const activity: ProcessActivity = {
        id: 'act_001',
        name: 'Test Activity',
        description: 'Test',
        business_process_id: 'proc_001',
        actor_hint: 'END_USER',
        user_interaction_level: 'MODERATE',
        tags: '',
      };

      const abp = createAppBusinessPointFromEntity(activity, 'process_activities');

      expect(abp.id).toBe('abp_act_001');
      expect(abp.name).toBe('Test Activity');
      expect(abp.kind).toBe('PROCESS_ACTIVITY');
      expect(abp.source_entity_id).toBe('act_001');
    });
  });

  describe('findAppBusinessPointForEntity', () => {
    it('should find ABP by source entity ID', () => {
      const abps: AppBusinessPoint[] = [
        { id: 'abp_app_001', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app_001' },
        { id: 'abp_svc_001', name: 'Service 1', kind: 'SERVICE', source_entity_id: 'svc_001' },
      ];

      const result = findAppBusinessPointForEntity('app_001', abps);
      expect(result).toBeDefined();
      expect(result?.id).toBe('abp_app_001');
    });

    it('should return undefined if not found', () => {
      const abps: AppBusinessPoint[] = [
        { id: 'abp_app_001', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];

      const result = findAppBusinessPointForEntity('nonexistent', abps);
      expect(result).toBeUndefined();
    });
  });

  describe('findSourceEntityForAppBusinessPoint', () => {
    it('should find source Application', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: 'Test App', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];

      const abp: AppBusinessPoint = {
        id: 'abp_app_001',
        name: 'Test App',
        kind: 'APPLICATION',
        source_entity_id: 'app_001',
      };

      const result = findSourceEntityForAppBusinessPoint(abp, entities);
      expect(result).toBeDefined();
      expect(result?.id).toBe('app_001');
    });

    it('should find source Business Process', () => {
      const entities = createEmptyEntities();
      entities.business_processes = [
        { id: 'proc_001', name: 'Test Process', description: '', tags: '' },
      ];

      const abp: AppBusinessPoint = {
        id: 'abp_proc_001',
        name: 'Test Process',
        kind: 'BUSINESS_PROCESS',
        source_entity_id: 'proc_001',
      };

      const result = findSourceEntityForAppBusinessPoint(abp, entities);
      expect(result).toBeDefined();
      expect(result?.id).toBe('proc_001');
    });
  });

  describe('syncAppBusinessPointNames', () => {
    it('should update ABP name when source entity name changes', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: 'Updated Name', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];

      const abps: AppBusinessPoint[] = [
        { id: 'abp_app_001', name: 'Old Name', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];

      const result = syncAppBusinessPointNames(abps, entities);

      expect(result[0].name).toBe('Updated Name');
    });

    it('should preserve ABP name if source entity name is empty', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: '', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];

      const abps: AppBusinessPoint[] = [
        { id: 'abp_app_001', name: 'Preserved Name', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];

      const result = syncAppBusinessPointNames(abps, entities);

      expect(result[0].name).toBe('Preserved Name');
    });
  });

  describe('syncAppBusinessPointNameForEntity', () => {
    it('should update existing ABP name', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: 'Old Name', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];
      entities.app_business_points = [
        { id: 'abp_app_001', name: 'Old Name', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];

      const result = syncAppBusinessPointNameForEntity(entities, 'applications', 'app_001', 'New Name');

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('New Name');
    });

    it('should create new ABP if not exists', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: 'Test App', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];
      entities.app_business_points = [];

      const result = syncAppBusinessPointNameForEntity(entities, 'applications', 'app_001', 'New App');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('abp_app_001');
      expect(result[0].name).toBe('New App');
      expect(result[0].kind).toBe('APPLICATION');
    });
  });

  describe('getOrphanedAppBusinessPoints', () => {
    it('should identify orphaned ABPs', () => {
      const entities = createEmptyEntities();
      // No applications, so ABP is orphaned
      entities.applications = [];

      const abps: AppBusinessPoint[] = [
        { id: 'abp_app_001', name: 'Orphan', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];

      const orphans = getOrphanedAppBusinessPoints(abps, entities);

      expect(orphans.length).toBe(1);
      expect(orphans[0].id).toBe('abp_app_001');
    });

    it('should not flag non-orphaned ABPs', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: 'Test', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];

      const abps: AppBusinessPoint[] = [
        { id: 'abp_app_001', name: 'Test', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];

      const orphans = getOrphanedAppBusinessPoints(abps, entities);

      expect(orphans.length).toBe(0);
    });
  });

  describe('cascadeDeleteAppBusinessPoint', () => {
    it('should remove ABP and clear interaction references', () => {
      const entities = createEmptyEntities();
      entities.app_business_points = [
        { id: 'abp_app_001', name: 'Test', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];
      entities.interactions = [
        {
          id: 'int_001',
          name: 'Test Interaction',
          user_id: 'user_001',
          primary_app_business_point_id: 'abp_app_001',
          secondary_app_business_point_id: 'abp_app_002',
        },
        {
          id: 'int_002',
          name: 'Test Interaction 2',
          user_id: 'user_001',
          primary_app_business_point_id: 'abp_app_002',
          secondary_app_business_point_id: 'abp_app_001',
        },
      ];

      const result = cascadeDeleteAppBusinessPoint('abp_app_001', entities);

      // ABP should be removed
      expect(result.app_business_points.length).toBe(0);

      // Interaction primary ref should be cleared
      expect(result.interactions[0].primary_app_business_point_id).toBe('');
      expect(result.interactions[0].secondary_app_business_point_id).toBe('abp_app_002');

      // Interaction secondary ref should be cleared
      expect(result.interactions[1].primary_app_business_point_id).toBe('abp_app_002');
      expect(result.interactions[1].secondary_app_business_point_id).toBeUndefined();
    });
  });

  describe('cascadeDeleteForABPSourceEntity', () => {
    it('should delete ABP when source entity is deleted', () => {
      const entities = createEmptyEntities();
      entities.applications = [
        { id: 'app_001', name: 'Test', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ];
      entities.app_business_points = [
        { id: 'abp_app_001', name: 'Test', kind: 'APPLICATION', source_entity_id: 'app_001' },
      ];
      entities.interactions = [];

      const relationships = createEmptyRelationships();

      const result = cascadeDeleteForABPSourceEntity('app_001', 'applications', entities, relationships);

      expect(result.entities.app_business_points.length).toBe(0);
    });

    it('should return unchanged if no ABP found', () => {
      const entities = createEmptyEntities();
      entities.app_business_points = [];

      const relationships = createEmptyRelationships();

      const result = cascadeDeleteForABPSourceEntity('nonexistent', 'applications', entities, relationships);

      expect(result.entities).toBe(entities);
      expect(result.relationships).toBe(relationships);
    });
  });

  describe('reconcileAppBusinessPoints', () => {
    it('should create missing ABPs for all source entity types', () => {
      const metaModel: MetaModel = {
        entities: {
          ...createEmptyEntities(),
          applications: [
            { id: 'app_001', name: 'App 1', description: '', app_type: 'Web', status: 'Active', tags: '' },
          ],
          app_components: [
            { id: 'comp_001', name: 'Component 1', description: '', application_id: 'app_001', tags: '' },
          ],
          services: [
            { id: 'svc_001', name: 'Service 1', description: '', application_id: 'app_001', service_type: 'REST', tags: '' },
          ],
          interfaces: [
            { id: 'iface_001', name: 'Interface 1', description: '', service_id: 'svc_001', interface_type: 'REST_API', tags: '' },
          ],
          business_processes: [
            { id: 'proc_001', name: 'Process 1', description: '', tags: '' },
          ],
          process_activities: [
            { id: 'act_001', name: 'Activity 1', description: '', business_process_id: 'proc_001', actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
          ],
          app_business_points: [], // No ABPs initially
        },
        relationships: createEmptyRelationships(),
      };

      const result = reconcileAppBusinessPoints(metaModel);

      // Should create 6 ABPs
      expect(result.entities.app_business_points.length).toBe(6);

      // Verify each ABP was created correctly
      const abpIds = result.entities.app_business_points.map(abp => abp.id);
      expect(abpIds).toContain('abp_app_001');
      expect(abpIds).toContain('abp_comp_001');
      expect(abpIds).toContain('abp_svc_001');
      expect(abpIds).toContain('abp_iface_001');
      expect(abpIds).toContain('abp_proc_001');
      expect(abpIds).toContain('abp_act_001');
    });

    it('should update existing ABP names from source entities', () => {
      const metaModel: MetaModel = {
        entities: {
          ...createEmptyEntities(),
          applications: [
            { id: 'app_001', name: 'Updated App Name', description: '', app_type: 'Web', status: 'Active', tags: '' },
          ],
          app_business_points: [
            { id: 'abp_app_001', name: 'Old Name', kind: 'APPLICATION', source_entity_id: 'app_001' },
          ],
        },
        relationships: createEmptyRelationships(),
      };

      const result = reconcileAppBusinessPoints(metaModel);

      const abp = result.entities.app_business_points.find(a => a.id === 'abp_app_001');
      expect(abp?.name).toBe('Updated App Name');
    });

    it('should remove orphaned ABPs', () => {
      const metaModel: MetaModel = {
        entities: {
          ...createEmptyEntities(),
          applications: [], // No applications
          app_business_points: [
            { id: 'abp_app_001', name: 'Orphan', kind: 'APPLICATION', source_entity_id: 'app_001' },
          ],
        },
        relationships: createEmptyRelationships(),
      };

      const result = reconcileAppBusinessPoints(metaModel);

      expect(result.entities.app_business_points.length).toBe(0);
    });
  });

  describe('isABPSourceEntityType', () => {
    it('should return true for valid source entity types', () => {
      expect(isABPSourceEntityType('applications')).toBe(true);
      expect(isABPSourceEntityType('app_components')).toBe(true);
      expect(isABPSourceEntityType('services')).toBe(true);
      expect(isABPSourceEntityType('interfaces')).toBe(true);
      expect(isABPSourceEntityType('business_processes')).toBe(true);
      expect(isABPSourceEntityType('process_activities')).toBe(true);
    });

    it('should return false for invalid entity types', () => {
      expect(isABPSourceEntityType('endpoints')).toBe(false);
      expect(isABPSourceEntityType('business_users')).toBe(false);
      expect(isABPSourceEntityType('logical_data_entities')).toBe(false);
      expect(isABPSourceEntityType('invalid')).toBe(false);
    });
  });
});
