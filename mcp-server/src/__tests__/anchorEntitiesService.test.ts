// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('anchorEntitiesService', () => {
  // ============================================================================
  // Test 1: Entities built with generated IDs (app- and comp- prefixes)
  // ============================================================================
  describe('saveProjectAnchorEntities - generated IDs', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('builds entities with generated IDs matching app- and comp- prefixes', async () => {
      // Setup axios mock with getProjectById, getModel, putModel
      const axios = require('axios');
      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({ data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'TestProject' }] });
          }
          if (url.endsWith('/architectures')) {
            return Promise.resolve({ data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }] });
          }
          // getModel (architecture-scoped) -> 404
          return Promise.reject(Object.assign(new Error('Not Found'), {
            response: { status: 404 },
            isAxiosError: true,
          }));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveProjectAnchorEntities } = require('../services/anchorEntitiesService');

      const result = await saveProjectAnchorEntities(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        [{ name: 'OrderApp', description: 'Manages orders' }],
        [{ name: 'OrderAPI', applicationName: 'OrderApp', description: 'REST API' }]
      );

      expect(result.applicationsCreated).toBe(1);
      expect(result.appComponentsCreated).toBe(1);

      // Verify putModel was called with correct entity structure
      // putModel calls this.client.put('/api/model/projects/{p}/architectures/{a}', dto, { params: { filename } })
      // So putCall[0] is URL, putCall[1] is the DTO
      const putCall = mockClient.put.mock.calls[0];
      const savedModel = putCall[1];
      const entities = savedModel.metaModel.entities;

      // Check applications have app- prefix IDs
      const newApp = entities.applications.find((a: any) => a.name === 'OrderApp');
      expect(newApp).toBeDefined();
      expect(newApp.id).toMatch(/^app-/);
      expect(newApp.description).toBe('Manages orders');

      // Check app_components have comp- prefix IDs
      const newComp = entities.app_components.find((c: any) => c.name === 'OrderAPI');
      expect(newComp).toBeDefined();
      expect(newComp.id).toMatch(/^comp-/);
      expect(newComp.description).toBe('REST API');
      expect(newComp.application_id).toBe(newApp.id);
    });
  });

  // ============================================================================
  // Test 2: Name-based deduplication skips existing applications
  // ============================================================================
  describe('saveProjectAnchorEntities - deduplication', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('skips existing applications with the same name (name-based deduplication)', async () => {
      const axios = require('axios');

      const existingModel = {
        metaModel: {
          entities: {
            applications: [
              { id: 'app-existing-123', name: 'MyApp', description: 'Existing app' },
            ],
            app_components: [],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({ data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'TestProject' }] });
          }
          if (url.endsWith('/architectures')) {
            return Promise.resolve({ data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }] });
          }
          return Promise.resolve({ data: existingModel });
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveProjectAnchorEntities } = require('../services/anchorEntitiesService');

      const result = await saveProjectAnchorEntities(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        [
          { name: 'MyApp', description: 'Updated description' },  // duplicate - should be skipped
          { name: 'NewApp', description: 'Brand new app' },        // new - should be created
        ],
        []
      );

      expect(result.applicationsCreated).toBe(1); // Only NewApp created
      expect(result.appComponentsCreated).toBe(0);

      // Verify the model was saved with the existing app unchanged and the new one added
      // putModel calls this.client.put('/api/model/projects/{p}/architectures/{a}', dto, { params: { filename } })
      const putCall = mockClient.put.mock.calls[0];
      const savedModel = putCall[1]; // index 1 is the DTO
      const apps = savedModel.metaModel.entities.applications;

      expect(apps).toHaveLength(2);
      // Existing app should remain unchanged
      expect(apps[0].id).toBe('app-existing-123');
      expect(apps[0].description).toBe('Existing app');
      // New app should be added
      expect(apps[1].name).toBe('NewApp');
      expect(apps[1].id).toMatch(/^app-/);
    });
  });

  // ============================================================================
  // Test 3: Empty/null model (GET 404) creates empty shell and merges
  // ============================================================================
  describe('saveProjectAnchorEntities - empty model handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('creates empty model shell when GET returns 404 and merges entities into it', async () => {
      const axios = require('axios');
      const mockClient = {
        get: jest.fn().mockImplementation((url) => {
          if (url === '/api/projects') {
            return Promise.resolve({ data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'TestProject' }] });
          }
          if (url.endsWith('/architectures')) {
            return Promise.resolve({ data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }] });
          }
          // getModel (architecture-scoped) -> 404
          return Promise.reject(Object.assign(new Error('Not Found'), {
            response: { status: 404 },
            isAxiosError: true,
          }));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveProjectAnchorEntities } = require('../services/anchorEntitiesService');

      const result = await saveProjectAnchorEntities(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        [{ name: 'App1', description: 'First app' }],
        [{ name: 'Comp1', applicationName: 'App1', description: 'First component' }]
      );

      expect(result.applicationsCreated).toBe(1);
      expect(result.appComponentsCreated).toBe(1);

      // Verify putModel was called with a full model structure
      // putModel calls this.client.put('/api/model/projects/{p}/architectures/{a}', dto, { params: { filename } })
      const putCall = mockClient.put.mock.calls[0];
      const savedModel = putCall[1]; // index 1 is the DTO

      // Should have full model shell structure
      expect(savedModel.metaModel).toBeDefined();
      expect(savedModel.metaModel.entities).toBeDefined();
      expect(savedModel.metaModel.entities.services).toEqual([]);
      expect(savedModel.metaModel.entities.interfaces).toEqual([]);
      expect(savedModel.diagrams).toEqual([]);

      // Should have our new entities
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.app_components).toHaveLength(1);
    });
  });

  // ============================================================================
  // Test 4: Calls getProjectById, getModel, putModel in sequence
  // ============================================================================
  describe('saveProjectAnchorEntities - call sequence', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls getProjectById, getModel, and putModel in sequence', async () => {
      const axios = require('axios');
      const callOrder: string[] = [];

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            callOrder.push('getProjectById');
            return Promise.resolve({
              data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'TestProject' }],
            });
          }
          if (url.endsWith('/architectures')) {
            callOrder.push('getDefaultArchitectureId');
            return Promise.resolve({ data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }] });
          }
          if (url.startsWith('/api/model/projects/')) {
            callOrder.push('getModel');
            return Promise.resolve({
              data: {
                metaModel: {
                  entities: { applications: [], app_components: [] },
                  relationships: {},
                },
                diagrams: [],
              },
            });
          }
          return Promise.reject(new Error('Unexpected GET: ' + url));
        }),
        put: jest.fn().mockImplementation(() => {
          callOrder.push('putModel');
          return Promise.resolve({ data: {} });
        }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveProjectAnchorEntities } = require('../services/anchorEntitiesService');

      await saveProjectAnchorEntities(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        [{ name: 'App1', description: 'Test' }],
        []
      );

      expect(callOrder).toEqual(['getProjectById', 'getDefaultArchitectureId', 'getModel', 'putModel']);
    });
  });

  // ============================================================================
  // Test 5 (Gap Fill): Idempotency -- re-running with identical data produces 0 created
  // ============================================================================
  describe('saveProjectAnchorEntities - idempotency', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('produces 0 applicationsCreated and 0 appComponentsCreated when all entities already exist', async () => {
      const axios = require('axios');

      // Model already contains the same applications and app_components
      const existingModel = {
        metaModel: {
          entities: {
            applications: [
              { id: 'app-existing-aaa', name: 'OrderApp', description: 'Manages orders' },
              { id: 'app-existing-bbb', name: 'PaymentApp', description: 'Handles payments' },
            ],
            app_components: [
              { id: 'comp-existing-111', name: 'OrderAPI', description: 'REST API', application_id: 'app-existing-aaa' },
              { id: 'comp-existing-222', name: 'PaymentGateway', description: 'Payment gateway', application_id: 'app-existing-bbb' },
            ],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({ data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'TestProject' }] });
          }
          if (url.endsWith('/architectures')) {
            return Promise.resolve({ data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }] });
          }
          return Promise.resolve({ data: existingModel });
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveProjectAnchorEntities } = require('../services/anchorEntitiesService');

      const result = await saveProjectAnchorEntities(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        [
          { name: 'OrderApp', description: 'Manages orders' },
          { name: 'PaymentApp', description: 'Handles payments' },
        ],
        [
          { name: 'OrderAPI', applicationName: 'OrderApp', description: 'REST API' },
          { name: 'PaymentGateway', applicationName: 'PaymentApp', description: 'Payment gateway' },
        ]
      );

      // Idempotency: nothing new created
      expect(result.applicationsCreated).toBe(0);
      expect(result.appComponentsCreated).toBe(0);

      // Model should still be saved (PUT still called) but with unchanged entity arrays
      const putCall = mockClient.put.mock.calls[0];
      const savedModel = putCall[1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(2);
      expect(savedModel.metaModel.entities.app_components).toHaveLength(2);

      // Existing IDs should be preserved (not regenerated)
      expect(savedModel.metaModel.entities.applications[0].id).toBe('app-existing-aaa');
      expect(savedModel.metaModel.entities.applications[1].id).toBe('app-existing-bbb');
    });
  });

  // ============================================================================
  // Test 6 (Gap Fill): Applications with empty appComponents succeeds
  // ============================================================================
  describe('saveProjectAnchorEntities - applications only, no components', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('succeeds with applications only and an empty appComponents array', async () => {
      const axios = require('axios');
      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({ data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'TestProject' }] });
          }
          if (url.endsWith('/architectures')) {
            return Promise.resolve({ data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }] });
          }
          return Promise.resolve({
            data: {
              metaModel: {
                entities: { applications: [], app_components: [] },
                relationships: {},
              },
              diagrams: [],
            },
          });
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveProjectAnchorEntities } = require('../services/anchorEntitiesService');

      const result = await saveProjectAnchorEntities(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        [
          { name: 'FrontendApp', description: 'React SPA' },
          { name: 'BackendApp', description: 'Node.js API' },
        ],
        [] // empty appComponents
      );

      expect(result.applicationsCreated).toBe(2);
      expect(result.appComponentsCreated).toBe(0);

      // Verify model has the 2 applications and 0 components
      const putCall = mockClient.put.mock.calls[0];
      const savedModel = putCall[1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(2);
      expect(savedModel.metaModel.entities.app_components).toHaveLength(0);
    });
  });
});
