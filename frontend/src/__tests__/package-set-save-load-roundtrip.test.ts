/**
 * Package Set Save/Load Round-Trip Verification Tests
 * Spec: Service Package Set Assignment Dropdown - Task Group 5
 */

import { ArchitectureModel, Service, PackageSet, Package } from '../types/model';
import { serializeModel, buildModelFromData } from '../utils/fileOperations';

// Helper to create a minimal test model
function createTestModel(services: Partial<Service>[]): ArchitectureModel {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: services as Service[],
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
        business_logics: [],
        package_sets: [],
        packages: [],
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
        application_point_business_logics: [],
      },
    },
    diagrams: [],
  };
}

describe('Package Set Save/Load Round-Trip', () => {
  // Test 5.1.1: service.package_set_id is included in save serialization
  describe('Save Serialization', () => {
    it('should include service.package_set_id in serialized output', () => {
      const model = createTestModel([
        {
          id: 'svc_001',
          name: 'Test Service',
          description: '',
          application_id: '',
          app_component_id: '',
          service_type: '',
          package_set_id: 'ps_001',
          tags: '',
        },
      ]);

      const json = serializeModel(model);
      const parsed = JSON.parse(json);

      expect(parsed.metaModel.entities.services[0].package_set_id).toBe('ps_001');
    });

    it('should serialize null package_set_id as null', () => {
      const model = createTestModel([
        {
          id: 'svc_002',
          name: 'Test Service 2',
          description: '',
          application_id: '',
          app_component_id: '',
          service_type: '',
          package_set_id: null,
          tags: '',
        },
      ]);

      const json = serializeModel(model);
      const parsed = JSON.parse(json);

      expect(parsed.metaModel.entities.services[0].package_set_id).toBeNull();
    });
  });

  // Test 5.1.2: service.package_set_id loaded correctly from saved file
  describe('Load Deserialization', () => {
    it('should load service.package_set_id from JSON data', () => {
      const jsonData = {
        metaModel: {
          entities: {
            services: [
              {
                id: 'svc_001',
                name: 'Test Service',
                description: '',
                application_id: '',
                app_component_id: '',
                service_type: '',
                package_set_id: 'ps_001',
                tags: '',
              },
            ],
          },
        },
        diagrams: [],
      };

      const model = buildModelFromData(jsonData);
      const service = model.metaModel.entities.services[0];

      expect(service.package_set_id).toBe('ps_001');
    });

    it('should load null package_set_id correctly', () => {
      const jsonData = {
        metaModel: {
          entities: {
            services: [
              {
                id: 'svc_002',
                name: 'Test Service 2',
                description: '',
                application_id: '',
                app_component_id: '',
                service_type: '',
                package_set_id: null,
                tags: '',
              },
            ],
          },
        },
        diagrams: [],
      };

      const model = buildModelFromData(jsonData);
      const service = model.metaModel.entities.services[0];

      expect(service.package_set_id).toBeNull();
    });
  });

  // Test 5.1.3: Round-trip preserves package_set_id values
  describe('Full Round-Trip', () => {
    it('should preserve package_set_id after save and load', () => {
      // Create model with various package_set_id values
      const originalModel = createTestModel([
        {
          id: 'svc_001',
          name: 'Service With PS',
          description: '',
          application_id: '',
          app_component_id: '',
          service_type: '',
          package_set_id: 'ps_001',
          tags: '',
        },
        {
          id: 'svc_002',
          name: 'Service Without PS',
          description: '',
          application_id: '',
          app_component_id: '',
          service_type: '',
          package_set_id: null,
          tags: '',
        },
      ]);

      // Serialize
      const json = serializeModel(originalModel);

      // Deserialize
      const parsedData = JSON.parse(json);
      const loadedModel = buildModelFromData(parsedData);

      // Verify values are preserved
      const svc1 = loadedModel.metaModel.entities.services.find((s) => s.id === 'svc_001');
      const svc2 = loadedModel.metaModel.entities.services.find((s) => s.id === 'svc_002');

      expect(svc1?.package_set_id).toBe('ps_001');
      expect(svc2?.package_set_id).toBeNull();
    });

    it('should handle missing package_set_id field gracefully', () => {
      // Simulate old JSON without package_set_id field
      const jsonData = {
        metaModel: {
          entities: {
            services: [
              {
                id: 'svc_legacy',
                name: 'Legacy Service',
                description: '',
                application_id: '',
                app_component_id: '',
                service_type: '',
                // No package_set_id field
                tags: '',
              },
            ],
          },
        },
        diagrams: [],
      };

      const model = buildModelFromData(jsonData);
      const service = model.metaModel.entities.services[0];

      // Field should be undefined (not null) when missing from source
      expect(service.package_set_id).toBeUndefined();
    });
  });

  // Test 5.1.4: Package Sets and Packages are also preserved
  describe('Package Sets and Packages Round-Trip', () => {
    it('should preserve package_sets array in round-trip', () => {
      const model = createTestModel([]);
      model.metaModel.entities.package_sets = [
        { id: 'ps_001', name: 'Standard Package Set' },
        { id: 'ps_002', name: 'Enterprise Package Set' },
      ];

      const json = serializeModel(model);
      const parsedData = JSON.parse(json);
      const loadedModel = buildModelFromData(parsedData);

      expect(loadedModel.metaModel.entities.package_sets.length).toBe(2);
      expect(loadedModel.metaModel.entities.package_sets[0].name).toBe('Standard Package Set');
    });

    it('should preserve packages array with all fields in round-trip', () => {
      const model = createTestModel([]);
      model.metaModel.entities.packages = [
        { id: 'pkg_001', package_set_id: 'ps_001', name: 'api', purpose: 'REST API', sort_order: 1 },
        { id: 'pkg_002', package_set_id: 'ps_001', name: 'domain', purpose: 'Business logic', sort_order: 2 },
      ];

      const json = serializeModel(model);
      const parsedData = JSON.parse(json);
      const loadedModel = buildModelFromData(parsedData);

      expect(loadedModel.metaModel.entities.packages.length).toBe(2);
      expect(loadedModel.metaModel.entities.packages[0].purpose).toBe('REST API');
      expect(loadedModel.metaModel.entities.packages[1].sort_order).toBe(2);
    });
  });
});
