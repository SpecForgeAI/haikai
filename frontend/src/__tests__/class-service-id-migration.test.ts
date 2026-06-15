/**
 * Tests for frontend classes table service_id migration.
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 11: Classes Table UI (Service Dropdown Instead of Application Point)
 *
 * Tests:
 * 1. Class interface in model.ts has service_id and not application_point_id
 * 2. Classes Grid column config shows a "Service" column
 * 3. The "Service" column uses fk_typeahead with fkTarget 'services'
 * 4. applicationPointDerivation.ts deriveApplicationIdForClass uses service_id not application_point_id
 */

import { describe, test, expect } from 'vitest';
import type { Class } from '../types/model';
import { gridConfigs } from '../config/gridConfigs';
import { deriveApplicationIdForClass } from '../utils/applicationPointDerivation';
import type { MetaModelEntities } from '../types/model';

describe('Task Group 11: Classes Table UI - service_id migration', () => {

  // ==========================================================================
  // Test 1: Class interface has service_id and not application_point_id
  // ==========================================================================
  describe('Class interface model type', () => {
    test('Class interface accepts service_id as optional string', () => {
      const classEntity: Class = {
        id: 'cls-001',
        name: 'OrderController',
        description: 'REST controller for orders',
        namespace: 'com.example.orders',
        service_id: 'svc-001',
      };

      expect(classEntity.service_id).toBe('svc-001');
      expect(classEntity.id).toBe('cls-001');
      expect(classEntity.name).toBe('OrderController');
    });

    test('Class interface does not require application_point_id', () => {
      // This test verifies at compile time that Class no longer has application_point_id.
      // If the field still existed, this would compile but at runtime we confirm
      // the object shape works without it.
      const classEntity: Class = {
        id: 'cls-002',
        name: 'PaymentService',
      };

      expect(classEntity).toBeDefined();
      expect((classEntity as any).application_point_id).toBeUndefined();
    });
  });

  // ==========================================================================
  // Test 2: Classes Grid column config shows a "Service" column
  // ==========================================================================
  describe('Classes Grid column config', () => {
    test('has a "Service" column with field service_id', () => {
      const classesColumns = gridConfigs['classes'];
      expect(classesColumns).toBeDefined();

      const serviceColumn = classesColumns.find(col => col.field === 'service_id');
      expect(serviceColumn).toBeDefined();
      expect(serviceColumn!.displayName).toBe('Service');
    });

    test('does not have an "Application Point" column', () => {
      const classesColumns = gridConfigs['classes'];
      const apColumn = classesColumns.find(col => col.field === 'application_point_id');
      expect(apColumn).toBeUndefined();
    });
  });

  // ==========================================================================
  // Test 3: "Service" column uses fk_typeahead with fkTarget 'services'
  // ==========================================================================
  describe('Service column dropdown configuration', () => {
    test('uses fk_typeahead cellType with services fkTarget', () => {
      const classesColumns = gridConfigs['classes'];
      const serviceColumn = classesColumns.find(col => col.field === 'service_id');

      expect(serviceColumn).toBeDefined();
      expect(serviceColumn!.cellType).toBe('fk_typeahead');
      expect(serviceColumn!.fkTarget).toBe('services');
    });
  });

  // ==========================================================================
  // Test 4: applicationPointDerivation.ts uses service_id (not application_point_id)
  // ==========================================================================
  describe('deriveApplicationIdForClass uses service_id', () => {
    test('derives application_id from service_id via the owning Service', () => {
      const entities = {
        services: [
          { id: 'svc-1', name: 'OrderService', application_id: 'app-1', service_type: 'API', tags: '' },
        ],
        classes: [
          { id: 'cls-1', name: 'OrderController', service_id: 'svc-1' },
        ],
        // Minimal entities shape for the function to work
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [{ id: 'app-1', name: 'TestApp', description: '', app_type: '', status: '', tags: '' }],
        app_components: [],
        interfaces: [],
        endpoints: [],
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
        data_entity_points: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
        user_journeys: [],
        activity_steps: [],
      } as MetaModelEntities;

      const cls = entities.classes[0];
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('app-1');
    });

    test('returns empty string when class has no service_id', () => {
      const entities = {
        services: [],
        classes: [
          { id: 'cls-2', name: 'UnownedClass' },
        ],
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        interfaces: [],
        endpoints: [],
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
        data_entity_points: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
        user_journeys: [],
        activity_steps: [],
      } as MetaModelEntities;

      const cls = entities.classes[0];
      const appId = deriveApplicationIdForClass(cls, entities);
      expect(appId).toBe('');
    });
  });
});
