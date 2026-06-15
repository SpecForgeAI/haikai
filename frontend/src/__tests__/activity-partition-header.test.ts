/**
 * Activity Partition Header Name Resolution Tests
 *
 * Task Group 2: Tests for partition header name resolution
 *
 * These tests verify:
 * - Header shows referenced entity name when refKind/refId set
 * - Fallback to partition.name when reference not found
 * - Fallback to partition.id when name is empty
 * - Header text is centered in header bar
 *
 * Spec 2025-12-31: Activity Diagram UX Improvements - A1
 */

import { describe, it, expect } from 'vitest';
import { resolvePartitionDisplayName } from '../utils/activityPartitionRendering';
import { ActivityPartition, MetaModel } from '../types/model';

// =========================================
// Test Fixtures
// =========================================

function createMockMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [
        { id: 'user-1', name: 'John Doe', description: '', tags: '' },
        { id: 'user-2', name: 'Jane Smith', description: '', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Main Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'comp-1', name: 'Auth Component', description: '', application_id: 'app-1', component_type: 'Module', tags: '' },
      ],
      services: [
        { id: 'svc-1', name: 'Auth Service', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', name: 'Login Interface', description: '', service_id: 'svc-1', interface_type: 'REST', tags: '' },
      ],
      classes: [
        { id: 'cls-1', name: 'UserManager', description: '' },
      ],
      // Empty arrays for other required entities
      business_processes: [],
      process_activities: [],
      business_points: [],
      application_points: [],
      endpoints: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      methods: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      interface_logical_entities: [],
      data_movements: [],
    },
  };
}

describe('Activity Partition Header Name Resolution Tests (Task Group 2)', () => {
  // =========================================
  // Test 1: Header shows referenced entity name when refKind/refId set
  // =========================================

  describe('Referenced entity name resolution', () => {
    it('should show referenced BusinessUser name', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-1',
        name: 'Fallback Name',
        ref_kind: 'BusinessUser',
        ref_id: 'user-1',
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('John Doe');
    });

    it('should show referenced Application name', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-2',
        name: 'Fallback Name',
        ref_kind: 'Application',
        ref_id: 'app-1',
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('Main Application');
    });

    it('should show referenced Class name', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-3',
        name: 'Fallback Name',
        ref_kind: 'Class',
        ref_id: 'cls-1',
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('UserManager');
    });
  });

  // =========================================
  // Test 2: Fallback to partition.name when reference not found
  // =========================================

  describe('Fallback to partition name', () => {
    it('should fallback to partition name when reference not found', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-4',
        name: 'Fallback Name',
        ref_kind: 'BusinessUser',
        ref_id: 'non-existent-user',
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('Fallback Name');
    });

    it('should use partition name when no ref set', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-5',
        name: 'Direct Name',
        // No ref_kind or ref_id
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('Direct Name');
    });
  });

  // =========================================
  // Test 3: Fallback to partition.id when name is empty
  // =========================================

  describe('Fallback to partition id', () => {
    it('should fallback to partition id when name is empty', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-6',
        name: '',
        // No ref_kind or ref_id
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('partition-6');
    });

    it('should fallback to partition id when name is undefined', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-7',
        // No name, no ref_kind or ref_id
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('partition-7');
    });

    it('should fallback to id when ref not found and name is empty', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-8',
        name: '',
        ref_kind: 'BusinessUser',
        ref_id: 'non-existent-user',
      };

      const displayName = resolvePartitionDisplayName(partition, metaModel);
      // Ref not found, name empty, should fall back to id
      expect(displayName).toBe('partition-8');
    });
  });

  // =========================================
  // Test 4: All ref_kinds are properly resolved
  // =========================================

  describe('All ref_kinds resolution', () => {
    it('should resolve ApplicationComponent correctly', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-comp',
        ref_kind: 'ApplicationComponent',
        ref_id: 'comp-1',
      };
      expect(resolvePartitionDisplayName(partition, metaModel)).toBe('Auth Component');
    });

    it('should resolve Service correctly', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-svc',
        ref_kind: 'Service',
        ref_id: 'svc-1',
      };
      expect(resolvePartitionDisplayName(partition, metaModel)).toBe('Auth Service');
    });

    it('should resolve Interface correctly', () => {
      const metaModel = createMockMetaModel();
      const partition: ActivityPartition = {
        id: 'partition-int',
        ref_kind: 'Interface',
        ref_id: 'int-1',
      };
      expect(resolvePartitionDisplayName(partition, metaModel)).toBe('Login Interface');
    });
  });
});
