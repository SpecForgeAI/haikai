/**
 * Tests for candidateSaveBackService orchestration function: saveDiscoveryCandidatesToModel.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 6: Save-Back Orchestration Service
 *
 * 7 focused tests covering:
 * 1. Happy path: 3 eligible candidates in hierarchy -> merged into model, statuses updated, mappings persisted
 * 2. Eligibility filtering: confidence < 0.75 excluded, rejected/merged/committed excluded
 * 3. Idempotent matching: existing entity skipped, ID recorded for downstream parent resolution
 * 4. Topological ordering: parents processed before children
 * 5. Early return: no eligible candidates -> zero counts, no getModel/putModel
 * 6. Fail-fast: getModel throws -> putModel never called
 * 7. Status update resilience: updateCandidate failure after putModel does not throw
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios at the module level so archModelClient uses our mock
jest.mock('axios');

// Mock generateId to produce deterministic IDs
let generateIdCounter = 0;
jest.mock('../utils/generateId', () => ({
  generateId: (prefix: string) => {
    generateIdCounter++;
    return `${prefix}test-${String(generateIdCounter).padStart(3, '0')}`;
  },
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';

// ============================================================================
// Helper: create a mock DiscoveryCandidateDto
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'application',
    name: 'DefaultApp',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-04-05T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

// ============================================================================
// Helper: create an empty model shell for mock returns
// ============================================================================

function makeEmptyModel(): any {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        data_entity_points: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
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

// ============================================================================
// Test suite
// ============================================================================

describe('candidateSaveBackService - orchestration (saveDiscoveryCandidatesToModel)', () => {
  // Reset modules and mocks before each test so that each test gets a fresh
  // archModelClient singleton backed by a fresh axios mock.
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // Test 1: Happy path -- 3 eligible candidates (app -> service -> interface)
  // ==========================================================================
  describe('happy path', () => {
    it('merges 3 hierarchical candidates into empty model, updates statuses, and persists mappings', async () => {
      const axios = require('axios');

      const appCandidate = makeCandidate({
        id: 'cand-app-1',
        name: 'OrderApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Manages orders' },
      });
      const svcCandidate = makeCandidate({
        id: 'cand-svc-1',
        name: 'OrderService',
        candidate_type: 'service',
        confidence: 0.85,
        status: 'accepted',
        data: { description: 'Processes orders', service_type: 'microservice', core_tech: 'Node.js' },
        parent_candidate_id: 'cand-app-1',
      });
      const ifcCandidate = makeCandidate({
        id: 'cand-ifc-1',
        name: 'OrderAPI',
        candidate_type: 'interfaces',
        confidence: 0.8,
        status: 'proposed',
        data: { description: 'REST API', interface_type: 'REST' },
        parent_candidate_id: 'cand-svc-1',
      });

      const emptyModel = makeEmptyModel();

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({
              data: [appCandidate, svcCandidate, ifcCandidate],
            });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.resolve({ data: emptyModel });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn().mockResolvedValue({ data: [] }),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      // Verify result counts
      expect(result.projectId).toBe('proj-001');
      expect(result.runId).toBe('run-001');
      expect(result.entitiesCreated).toBe(3);
      expect(result.entitiesSkipped).toBe(0);
      expect(result.candidatesCommitted).toBe(3);

      // Verify putModel was called once
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);

      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('OrderApp');
      expect(savedModel.metaModel.entities.services).toHaveLength(1);
      expect(savedModel.metaModel.entities.services[0].name).toBe('OrderService');
      expect(savedModel.metaModel.entities.interfaces).toHaveLength(1);
      expect(savedModel.metaModel.entities.interfaces[0].name).toBe('OrderAPI');

      // Verify service has application_id pointing to the app entity
      const appEntityId = savedModel.metaModel.entities.applications[0].id;
      expect(savedModel.metaModel.entities.services[0].application_id).toBe(appEntityId);

      // Verify interface has service_id pointing to the service entity
      const svcEntityId = savedModel.metaModel.entities.services[0].id;
      expect(savedModel.metaModel.entities.interfaces[0].service_id).toBe(svcEntityId);

      // Verify updateCandidate was called 3 times (PUT to candidate URLs)
      const candidateUpdateCalls = mockClient.put.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/candidates/')
      );
      expect(candidateUpdateCalls).toHaveLength(3);

      // Verify each update has status 'committed' and committedEntityId
      for (const call of candidateUpdateCalls) {
        const body = call[1];
        expect(body.status).toBe('committed');
        expect(body.data.committedEntityId).toBeDefined();
        expect(body.data.committedEntityType).toBeDefined();
      }

      // Verify bulkCreateCandidateEntityMappings was called (POST to mappings URL)
      const mappingPostCalls = mockClient.post.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/candidate-entity-mappings')
      );
      expect(mappingPostCalls).toHaveLength(1);
      const mappings = mappingPostCalls[0][1];
      expect(mappings).toHaveLength(3);
      for (const mapping of mappings) {
        expect(mapping.action).toBe('created');
        expect(mapping.run_id).toBe('run-001');
      }
    });
  });

  // ==========================================================================
  // Test 2: Eligibility filtering
  // ==========================================================================
  describe('eligibility filtering', () => {
    it('excludes candidates with low confidence or excluded statuses', async () => {
      const axios = require('axios');

      const eligibleCandidate = makeCandidate({
        id: 'cand-1',
        name: 'GoodApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Eligible' },
      });
      const lowConfidence = makeCandidate({
        id: 'cand-2',
        name: 'WeakApp',
        candidate_type: 'application',
        confidence: 0.5,
        status: 'proposed',
      });
      const rejectedCandidate = makeCandidate({
        id: 'cand-3',
        name: 'RejectedApp',
        candidate_type: 'application',
        confidence: 0.95,
        status: 'rejected',
      });
      const mergedCandidate = makeCandidate({
        id: 'cand-4',
        name: 'MergedApp',
        candidate_type: 'application',
        confidence: 0.88,
        status: 'merged',
      });
      const committedCandidate = makeCandidate({
        id: 'cand-5',
        name: 'CommittedApp',
        candidate_type: 'application',
        confidence: 0.92,
        status: 'committed',
      });
      const acceptedEligible = makeCandidate({
        id: 'cand-6',
        name: 'AcceptedApp',
        candidate_type: 'application',
        confidence: 0.85,
        status: 'accepted',
        data: { description: 'Also eligible' },
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({
              data: [
                eligibleCandidate,
                lowConfidence,
                rejectedCandidate,
                mergedCandidate,
                committedCandidate,
                acceptedEligible,
              ],
            });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.resolve({ data: makeEmptyModel() });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn().mockResolvedValue({ data: [] }),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      // Only cand-1 (proposed, 0.9) and cand-6 (accepted, 0.85) should pass
      expect(result.entitiesCreated).toBe(2);
      expect(result.candidatesCommitted).toBe(2);

      // Verify putModel model only has 2 applications
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(2);
      const names = savedModel.metaModel.entities.applications.map((a: any) => a.name);
      expect(names).toContain('GoodApp');
      expect(names).toContain('AcceptedApp');
    });
  });

  // ==========================================================================
  // Test 3: Idempotent matching
  // ==========================================================================
  describe('idempotent matching', () => {
    it('suppresses existing entity by name, records its ID for downstream parent resolution, increments entitiesSuppressed', async () => {
      const axios = require('axios');

      const appCandidate = makeCandidate({
        id: 'cand-app-1',
        name: 'OrderApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Manages orders' },
      });
      const svcCandidate = makeCandidate({
        id: 'cand-svc-1',
        name: 'OrderService',
        candidate_type: 'service',
        confidence: 0.85,
        status: 'proposed',
        data: { description: 'Processes orders', service_type: 'microservice' },
        parent_candidate_id: 'cand-app-1',
      });

      // Model already has OrderApp
      const existingModel = makeEmptyModel();
      existingModel.metaModel.entities.applications.push({
        id: 'app-existing-999',
        name: 'OrderApp',
        description: 'Existing app',
        model_file_id: 'TestProject',
        app_type: '',
        status: '',
        tags: '',
        valid_from: null,
        valid_to: null,
        is_internal: null,
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({ data: [appCandidate, svcCandidate] });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.resolve({ data: existingModel });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn().mockResolvedValue({ data: [] }),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      // OrderApp exact-matches a PRE-EXISTING model entity, so the model-aware
      // dedup pass SUPPRESSES it (counted as suppressed, not skipped, not
      // committed). Its candidate ID still resolves to the existing entity ID
      // so the child OrderService is created and attached to the existing app.
      expect(result.entitiesSuppressed).toBe(1);
      expect(result.suppressedDuplicates).toHaveLength(1);
      expect(result.suppressedDuplicates[0]).toMatchObject({
        candidateId: 'cand-app-1',
        existingEntityId: 'app-existing-999',
      });
      expect(result.entitiesSkipped).toBe(0);
      expect(result.entitiesCreated).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Verify the service's application_id points to the EXISTING app entity ID
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1); // no duplicate
      expect(savedModel.metaModel.entities.applications[0].id).toBe('app-existing-999');
      expect(savedModel.metaModel.entities.services).toHaveLength(1);
      expect(savedModel.metaModel.entities.services[0].application_id).toBe('app-existing-999');

      // Verify provenance mappings: only the created service is mapped; the
      // suppressed app candidate gets NO mapping (it is not committed).
      const mappingPostCalls = mockClient.post.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/candidate-entity-mappings')
      );
      expect(mappingPostCalls).toHaveLength(1);
      const mappings = mappingPostCalls[0][1];
      expect(mappings).toHaveLength(1);
      const svcMapping = mappings.find((m: any) => m.candidate_id === 'cand-svc-1');
      expect(svcMapping.action).toBe('created');
    });
  });

  // ==========================================================================
  // Test 4: Topological ordering
  // ==========================================================================
  describe('topological ordering', () => {
    it('processes parent application before child service and grandchild interface', async () => {
      const axios = require('axios');

      // Provide candidates in REVERSE order to prove sorting works
      const ifcCandidate = makeCandidate({
        id: 'cand-ifc-1',
        name: 'OrderAPI',
        candidate_type: 'interfaces',
        confidence: 0.85,
        status: 'proposed',
        data: { description: 'REST API', interface_type: 'REST' },
        parent_candidate_id: 'cand-svc-1',
      });
      const svcCandidate = makeCandidate({
        id: 'cand-svc-1',
        name: 'OrderService',
        candidate_type: 'service',
        confidence: 0.85,
        status: 'proposed',
        data: { description: 'Processes orders' },
        parent_candidate_id: 'cand-app-1',
      });
      const appCandidate = makeCandidate({
        id: 'cand-app-1',
        name: 'OrderApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Manages orders' },
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            // Return in REVERSE order (interface first, then service, then app)
            return Promise.resolve({
              data: [ifcCandidate, svcCandidate, appCandidate],
            });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.resolve({ data: makeEmptyModel() });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn().mockResolvedValue({ data: [] }),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      expect(result.entitiesCreated).toBe(3);

      // Verify parent references are correctly resolved (proves ordering worked)
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      const savedModel = putModelCalls[0][1];

      const app = savedModel.metaModel.entities.applications[0];
      const svc = savedModel.metaModel.entities.services[0];
      const ifc = savedModel.metaModel.entities.interfaces[0];

      expect(svc.application_id).toBe(app.id);
      expect(ifc.service_id).toBe(svc.id);
    });
  });

  // ==========================================================================
  // Test 5: Early return -- no eligible candidates
  // ==========================================================================
  describe('early return', () => {
    it('returns zero counts without calling getModel or putModel when no candidates are eligible', async () => {
      const axios = require('axios');

      const lowConfidence = makeCandidate({
        id: 'cand-1',
        name: 'WeakApp',
        confidence: 0.5,
        status: 'proposed',
      });
      const rejectedHigh = makeCandidate({
        id: 'cand-2',
        name: 'RejectedApp',
        confidence: 0.95,
        status: 'rejected',
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({ data: [lowConfidence, rejectedHigh] });
          }
          // getModel should NOT be called
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            throw new Error('getModel should not be called when no eligible candidates');
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockImplementation(() => {
          throw new Error('putModel should not be called when no eligible candidates');
        }),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      expect(result.entitiesCreated).toBe(0);
      expect(result.entitiesSkipped).toBe(0);
      expect(result.candidatesCommitted).toBe(0);

      // Verify getModel was never called (only /api/projects and /candidates were called)
      const getModelCalls = mockClient.get.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001')
      );
      expect(getModelCalls).toHaveLength(0);

      // Verify putModel was never called
      expect(mockClient.put).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Test 6: Fail-fast -- getModel throws
  // ==========================================================================
  describe('fail-fast on getModel error', () => {
    it('propagates error from getModel and never calls putModel', async () => {
      const axios = require('axios');

      const candidate = makeCandidate({
        id: 'cand-1',
        name: 'GoodApp',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Test' },
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({ data: [candidate] });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.reject(new Error('Backend service unavailable'));
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn(),
        post: jest.fn(),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');

      await expect(saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001'))
        .rejects.toThrow('Backend service unavailable');

      // putModel should never have been called
      expect(mockClient.put).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Test 7: Status update resilience
  // ==========================================================================
  describe('status update resilience', () => {
    it('logs warning but does not throw when updateCandidate fails after successful putModel', async () => {
      const axios = require('axios');

      // Suppress console.warn for cleaner test output
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const appCandidate = makeCandidate({
        id: 'cand-app-1',
        name: 'OrderApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Manages orders' },
      });
      const svcCandidate = makeCandidate({
        id: 'cand-svc-1',
        name: 'OrderService',
        candidate_type: 'service',
        confidence: 0.85,
        status: 'proposed',
        data: { description: 'Processes orders' },
        parent_candidate_id: 'cand-app-1',
      });

      let putModelCallCount = 0;
      let candidateUpdateCallCount = 0;

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({ data: [appCandidate, svcCandidate] });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.resolve({ data: makeEmptyModel() });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockImplementation((url: string) => {
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            putModelCallCount++;
            return Promise.resolve({ data: {} });
          }
          // updateCandidate calls -- fail the first one
          candidateUpdateCallCount++;
          if (candidateUpdateCallCount === 1) {
            return Promise.reject(new Error('Status update failed for candidate'));
          }
          return Promise.resolve({ data: {} });
        }),
        post: jest.fn().mockResolvedValue({ data: [] }),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');

      // Should NOT throw even though first updateCandidate failed
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      // putModel was called successfully
      expect(putModelCallCount).toBe(1);

      // Both candidates still contributed entities
      expect(result.entitiesCreated).toBe(2);

      // candidatesCommitted reflects all candidates that were processed
      // (model was written, so they are effectively committed even if status update failed)
      expect(result.candidatesCommitted).toBe(2);

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalled();
      const warningMessage = warnSpy.mock.calls.find(
        (call) => String(call[0]).includes('Status update failed')
      );
      expect(warningMessage).toBeDefined();

      warnSpy.mockRestore();
    });
  });
});
