/**
 * Tests for the architecture context builder (reusable package).
 *
 * Tests cover:
 * - Test 1: fetchFullArchitectureContext(projectId) returns parsed model data with diagrams array stripped
 * - Test 2: fetchFullArchitectureContext(projectId) returns null on HTTP error (graceful degradation)
 * - Test 3: loadArchitectureExplainer() returns the static markdown content from disk
 * - Test 4: buildArchitectureContextSection(projectId) combines explainer + JSON-stringified model data into a single string;
 *           returns empty string when model fetch returns null
 *
 * buildDataModelContextSection tests (Spec: 2026-03-26 Architecture Diagram Generation Task Framework, Task Group 2):
 * - Test 5: Verify correct filtering -- returned context includes ONLY the 6 data-related keys
 * - Test 6: Verify irrelevant model keys are excluded from filtered output
 * - Test 7: Verify architecture explainer markdown content is included
 * - Test 8: Verify empty string returned when fetch returns null
 *
 * Gap-fill test (Spec: 2026-03-26, Task Group 5):
 * - Test 9: Verify buildDataModelContextSection returns explainer + empty data when model has no data-related keys
 *
 * Spec: 2026-03-14 Detailed Data Model Task -- End-to-End Fix
 * Task Group 2: Architecture Context Builder
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing -- Task 6.3
 *   The "fall back to projectId-based lookup" branch was changed by Task Group 3
 *   to use the new path-segment Bucket A endpoint
 *   (`/api/model/projects/{projectId}/architectures/{architectureId}`). The old
 *   query-param form (`/api/model?projectId=...`) was removed. The fallback
 *   now requires resolving the project's Default architecture via the new
 *   list endpoint before constructing the model URL.
 */

// Mock the config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// Mock fetch for client tests
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

/** Helper: mock a successful project name lookup followed by a model response */
function mockProjectThenModel(modelData: object) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ name: 'TestProject', project_parent_folder: '/tmp/test' }),
  });
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ...JSON.parse(JSON.stringify(modelData)) }),
  });
}

describe('architectureContextBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchFullArchitectureContext', () => {
    it('should resolve project name then fetch model by filename with diagrams stripped', async () => {
      const mockModelData = {
        entities: {
          applications: [{ id: 'app-1', name: 'MyApp' }],
          services: [{ id: 'svc-1', name: 'UserService' }],
        },
        relationships: {
          data_movements: [],
        },
        diagrams: [
          { id: 'diagram-1', name: 'System Overview', type: 'component' },
          { id: 'diagram-2', name: 'Data Flow', type: 'sequence' },
        ],
      };

      // First call: project lookup returns name
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'TestProject', project_parent_folder: '/tmp/test' }),
      });
      // Second call: model fetch by filename
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockModelData }),
      });

      const { fetchFullArchitectureContext } = require('../services/architectureContextBuilder');

      const result = await fetchFullArchitectureContext('test-project-id');

      // First call should be the project lookup
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8080/api/projects/test-project-id',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );

      // Second call should use filename-based model lookup
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8080/api/model?filename=TestProject',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );

      // Should return the data without diagrams
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result.entities).toBeDefined();
      expect(result.entities.applications).toHaveLength(1);
      expect(result.entities.services).toHaveLength(1);
      expect(result.relationships).toBeDefined();

      // Diagrams must be stripped
      expect(result.diagrams).toBeUndefined();
    });

    it('should fall back to architecture-scoped path-segment lookup when project name fetch fails', async () => {
      // First call: project name lookup fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      // Second call: list architectures (resolveDefaultArchitectureId)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'default-arch-id',
            projectId: 'test-project-id',
            name: 'Default',
            description: null,
            tags: [],
            archived: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      // Third call: fallback model fetch by (projectId, architectureId) path
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entities: { applications: [] }, relationships: {} }),
      });

      const { fetchFullArchitectureContext } = require('../services/architectureContextBuilder');

      const result = await fetchFullArchitectureContext('test-project-id');

      // Second call should be the new list-architectures endpoint
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8080/api/projects/test-project-id/architectures',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );

      // Third call should hit the new path-segment Bucket A endpoint (no
      // query param, no /api/model?projectId=...).
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:8080/api/model/projects/test-project-id/architectures/default-arch-id',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );

      expect(result).not.toBeNull();
    });

    it('should return null on HTTP error (graceful degradation)', async () => {
      // Project lookup succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'TestProject' }),
      });
      // Model fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const { fetchFullArchitectureContext } = require('../services/architectureContextBuilder');

      const result = await fetchFullArchitectureContext('test-project-id');

      expect(result).toBeNull();

      // Also test network error
      jest.resetModules();

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { fetchFullArchitectureContext: fetchFn2 } = require('../services/architectureContextBuilder');

      const result2 = await fetchFn2('test-project-id');

      expect(result2).toBeNull();
    });
  });

  describe('loadArchitectureExplainer', () => {
    it('should return the static markdown content from disk', async () => {
      const { loadArchitectureExplainer } = require('../services/architectureContextBuilder');

      const content = await loadArchitectureExplainer();

      // Should be a non-empty string
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      // Should contain key sections from the explainer file
      expect(content).toContain('# Architecture Meta-Model Reference');
      expect(content).toContain('## Entity Types');
      expect(content).toContain('## Relationship Types');

      // Should contain entity type descriptions
      expect(content).toContain('`applications`');
      expect(content).toContain('`app_components`');
      expect(content).toContain('`services`');
      expect(content).toContain('`interfaces`');
      expect(content).toContain('`endpoints`');
      expect(content).toContain('`classes`');
      expect(content).toContain('`methods`');
      expect(content).toContain('`application_points`');
      expect(content).toContain('`logical_data_entities`');
      expect(content).toContain('`logical_data_attributes`');
      expect(content).toContain('`physical_data_entities`');
      expect(content).toContain('`physical_data_attributes`');
      expect(content).toContain('`data_entity_points`');
      expect(content).toContain('`business_users`');
      expect(content).toContain('`business_processes`');
      expect(content).toContain('`process_activities`');
      expect(content).toContain('`business_points`');
      expect(content).toContain('`app_business_points`');
      expect(content).toContain('`interactions`');
      expect(content).toContain('`events`');
      expect(content).toContain('`states`');
      expect(content).toContain('`state_transitions`');
      expect(content).toContain('`activities`');
      expect(content).toContain('`activity_flows`');
      expect(content).toContain('`activity_partitions`');
      expect(content).toContain('`ui_screens`');
      expect(content).toContain('`ui_components`');
      expect(content).toContain('`ui_actions`');
      expect(content).toContain('`ui_characteristics`');
      expect(content).toContain('`business_logics`');
      expect(content).toContain('`package_sets`');
      expect(content).toContain('`packages`');
      expect(content).toContain('`package_set_default_rules`');

      // Should contain relationship type descriptions
      expect(content).toContain('`business_user_business_points`');
      expect(content).toContain('`application_point_business_points`');
      expect(content).toContain('`logical_data_entity_relationships`');
      expect(content).toContain('`logical_data_entity_physical_data_entities`');
      expect(content).toContain('`logical_data_attribute_physical_data_attributes`');
      expect(content).toContain('`data_movements`');
      expect(content).toContain('`interface_logical_entities`');
      expect(content).toContain('`ui_workflow_transitions`');
      expect(content).toContain('`application_point_business_logics`');

      // Should mark polymorphic wrappers as auto-managed
      expect(content).toContain('AUTO-MANAGED');
      expect(content).toContain('LLM must NEVER create');

      // Should exclude ui_contracts (deprecated)
      expect(content).toContain('ui_contracts');
      expect(content).toContain('deprecated');
    });
  });

  describe('buildArchitectureContextSection', () => {
    it('should combine explainer + JSON-stringified model data into a single string', async () => {
      const mockModelData = {
        entities: {
          applications: [{ id: 'app-1', name: 'TestApp' }],
        },
        relationships: {},
      };

      mockProjectThenModel(mockModelData);

      const { buildArchitectureContextSection } = require('../services/architectureContextBuilder');

      const result = await buildArchitectureContextSection('test-project-id');

      // Should be a non-empty string
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);

      // Should contain the explainer content
      expect(result).toContain('# Architecture Meta-Model Reference');
      expect(result).toContain('## Entity Types');

      // Should contain the model data header
      expect(result).toContain('## Current Architecture Model Data');

      // Should contain the JSON-stringified model data
      expect(result).toContain('"applications"');
      expect(result).toContain('"TestApp"');

      // Should NOT contain diagrams (stripped by fetchFullArchitectureContext)
      expect(result).not.toContain('"diagrams"');
    });

    it('should return empty string when model fetch returns null', async () => {
      // Project lookup succeeds but model fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'TestProject' }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const { buildArchitectureContextSection } = require('../services/architectureContextBuilder');

      const result = await buildArchitectureContextSection('unreachable-project');

      expect(result).toBe('');
    });
  });

  describe('buildDataModelContextSection', () => {
    it('should return context including ONLY the 6 data-related keys from the full model', async () => {
      // Real API structure: metaModel wraps entities + relationships
      const mockModelData = {
        metaModel: {
          entities: {
            applications: [{ id: 'app-1', name: 'MyApp' }],
            services: [{ id: 'svc-1', name: 'UserService' }],
            logical_data_entities: [{ id: 'lde-1', name: 'Customer' }],
            logical_data_attributes: [{ id: 'lda-1', name: 'customerId', isPrimaryKey: true }],
            physical_data_entities: [{ id: 'pde-1', name: 'customers_table' }],
            physical_data_attributes: [{ id: 'pda-1', name: 'customer_id', isPrimaryKey: true }],
            interfaces: [{ id: 'iface-1', name: 'CustomerAPI' }],
            business_processes: [{ id: 'bp-1', name: 'Onboarding' }],
            ui_screens: [{ id: 'ui-1', name: 'Dashboard' }],
          },
          relationships: {
            data_movements: [{ id: 'dm-1', name: 'CustomerFlow' }],
            logical_data_entity_relationships: [{ id: 'lder-1', sourceId: 'lde-1', targetId: 'lde-2' }],
            logical_data_entity_physical_data_entities: [{ id: 'ldepde-1', logicalId: 'lde-1', physicalId: 'pde-1' }],
            business_user_business_points: [{ id: 'bubp-1' }],
          },
        },
      };

      mockProjectThenModel(mockModelData);

      const { buildDataModelContextSection } = require('../services/architectureContextBuilder');

      const result = await buildDataModelContextSection('test-project-id');

      // Parse out the JSON portion after the "## Current Data Model" header
      const jsonMatch = result.match(/## Current Data Model\s*\n\n([\s\S]+)$/);
      expect(jsonMatch).not.toBeNull();
      const parsedData = JSON.parse(jsonMatch![1]);

      // Should include the 4 data entity keys under entities
      expect(parsedData.entities.logical_data_entities).toEqual([{ id: 'lde-1', name: 'Customer' }]);
      expect(parsedData.entities.logical_data_attributes).toEqual([{ id: 'lda-1', name: 'customerId', isPrimaryKey: true }]);
      expect(parsedData.entities.physical_data_entities).toEqual([{ id: 'pde-1', name: 'customers_table' }]);
      expect(parsedData.entities.physical_data_attributes).toEqual([{ id: 'pda-1', name: 'customer_id', isPrimaryKey: true }]);

      // Should include the 2 data relationship keys under relationships
      expect(parsedData.relationships.logical_data_entity_relationships).toEqual([{ id: 'lder-1', sourceId: 'lde-1', targetId: 'lde-2' }]);
      expect(parsedData.relationships.logical_data_entity_physical_data_entities).toEqual([{ id: 'ldepde-1', logicalId: 'lde-1', physicalId: 'pde-1' }]);
    });

    it('should exclude irrelevant model keys like applications, services, interfaces, business_processes, ui_screens', async () => {
      const mockModelData = {
        metaModel: {
          entities: {
            applications: [{ id: 'app-1', name: 'MyApp' }],
            services: [{ id: 'svc-1', name: 'UserService' }],
            interfaces: [{ id: 'iface-1', name: 'CustomerAPI' }],
            business_processes: [{ id: 'bp-1', name: 'Onboarding' }],
            ui_screens: [{ id: 'ui-1', name: 'Dashboard' }],
            logical_data_entities: [{ id: 'lde-1', name: 'Customer' }],
          },
          relationships: {
            data_movements: [{ id: 'dm-1', name: 'CustomerFlow' }],
            business_user_business_points: [{ id: 'bubp-1' }],
            logical_data_entity_relationships: [{ id: 'lder-1' }],
          },
        },
      };

      mockProjectThenModel(mockModelData);

      const { buildDataModelContextSection } = require('../services/architectureContextBuilder');

      const result = await buildDataModelContextSection('test-project-id');

      // Parse the JSON portion
      const jsonMatch = result.match(/## Current Data Model\s*\n\n([\s\S]+)$/);
      expect(jsonMatch).not.toBeNull();
      const parsedData = JSON.parse(jsonMatch![1]);

      // Irrelevant entity keys must NOT be present
      expect(parsedData.entities.applications).toBeUndefined();
      expect(parsedData.entities.services).toBeUndefined();
      expect(parsedData.entities.interfaces).toBeUndefined();
      expect(parsedData.entities.business_processes).toBeUndefined();
      expect(parsedData.entities.ui_screens).toBeUndefined();

      // Irrelevant relationship keys must NOT be present
      expect(parsedData.relationships.data_movements).toBeUndefined();
      expect(parsedData.relationships.business_user_business_points).toBeUndefined();

      // Data-related keys SHOULD be present
      expect(parsedData.entities.logical_data_entities).toBeDefined();
      expect(parsedData.relationships.logical_data_entity_relationships).toBeDefined();
    });

    it('should include architecture explainer markdown content in the returned section', async () => {
      const mockModelData = {
        metaModel: {
          entities: {
            logical_data_entities: [{ id: 'lde-1', name: 'Order' }],
          },
          relationships: {},
        },
      };

      mockProjectThenModel(mockModelData);

      const { buildDataModelContextSection } = require('../services/architectureContextBuilder');

      const result = await buildDataModelContextSection('test-project-id');

      // Should be a non-empty string
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);

      // Should contain the explainer content (same as buildArchitectureContextSection pattern)
      expect(result).toContain('# Architecture Meta-Model Reference');
      expect(result).toContain('## Entity Types');
      expect(result).toContain('## Relationship Types');

      // Should contain the filtered data model header
      expect(result).toContain('## Current Data Model');

      // Should contain the data entity from the filtered model
      expect(result).toContain('"Order"');
    });

    it('should return empty string when fetchFullArchitectureContext returns null', async () => {
      // Project lookup succeeds but model fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'TestProject' }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const { buildDataModelContextSection } = require('../services/architectureContextBuilder');

      const result = await buildDataModelContextSection('unreachable-project');

      expect(result).toBe('');
    });

    // ========================================================================
    // Gap-fill test (Task Group 5): Model has no data-related keys
    // ========================================================================
    it('should return explainer with empty filtered data when model has no data-related keys', async () => {
      // Model with only non-data keys (applications, services, etc.) and no data entity/attribute/relationship keys
      const mockModelData = {
        metaModel: {
          entities: {
            applications: [{ id: 'app-1', name: 'MyApp' }],
            services: [{ id: 'svc-1', name: 'UserService' }],
            interfaces: [{ id: 'iface-1', name: 'CustomerAPI' }],
            business_processes: [{ id: 'bp-1', name: 'Onboarding' }],
          },
          relationships: {
            data_movements: [{ id: 'dm-1', name: 'CustomerFlow' }],
            business_user_business_points: [{ id: 'bubp-1' }],
          },
        },
      };

      mockProjectThenModel(mockModelData);

      const { buildDataModelContextSection } = require('../services/architectureContextBuilder');

      const result = await buildDataModelContextSection('test-project-id');

      // Should still return a non-empty string (explainer + header + empty JSON)
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);

      // Should contain the explainer
      expect(result).toContain('# Architecture Meta-Model Reference');

      // Should contain the data model header
      expect(result).toContain('## Current Data Model');

      // Parse the JSON portion -- should be an empty object since all keys were filtered out
      const jsonMatch = result.match(/## Current Data Model\s*\n\n([\s\S]+)$/);
      expect(jsonMatch).not.toBeNull();
      const parsedData = JSON.parse(jsonMatch![1]);
      expect(parsedData).toEqual({});

      // Verify none of the non-data keys leaked through
      expect(parsedData.entities).toBeUndefined();
      expect(parsedData.relationships).toBeUndefined();
    });
  });
});

// Make this file a module so top-level declarations (mockFetch) do not
// collide with other global-script test files (TS2451).
export {};
