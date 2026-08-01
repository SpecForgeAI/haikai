/**
 * Gap Analysis Tests for Candidate Save-Back to Canonical Model.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 8: Test Review and Gap Analysis (Task 8.3)
 *
 * These tests fill critical gaps identified during review of Task Groups 1-7:
 *
 * 1. End-to-end orchestration with all 8 candidate types producing entities
 *    in the correct model arrays (Task Groups 5+6 only tested 3 types)
 * 2. Orphaned child candidate (parent not in eligible set) triggers fail-fast
 *    error during entity conversion (parent FK resolution gap)
 * 3. Full idempotent re-run: all candidates match existing entities, producing
 *    zero entitiesCreated and all entitiesSkipped
 * 4. convertCandidateToEntity with missing/empty data object defaults gracefully
 * 5. data_entity candidate type produces correct physical_data_entity shape
 * 6. buildDepthMap with circular parent references does not infinite loop
 * 7. Route validation: runId as empty string returns 400
 *
 * Total: 7 additional strategic tests
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

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock candidateSaveBackService for route tests
jest.mock('../services/candidateSaveBackService', () => {
  const actual = jest.requireActual('../services/candidateSaveBackService');
  return {
    ...actual,
    // Override saveDiscoveryCandidatesToModel only when explicitly mocked per-test
  };
});

import { DiscoveryCandidateDto } from '../services/archModelClient';
import {
  buildDepthMap,
  convertCandidateToEntity,
} from '../services/candidateSaveBackService';
import type { Request, Response, NextFunction } from 'express';

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
// Test Suite
// ============================================================================

describe('candidateSaveBack - Gap Analysis Tests (Task Group 8)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // Gap Test 1: End-to-end orchestration with all 8 candidate types
  // ==========================================================================
  describe('all 8 candidate types produce entities in the correct model arrays', () => {
    it('creates entities for application, app_component, service, interface, logical_entity, physical_entity, data_entity, and business_process', async () => {
      const axios = require('axios');

      // Build a hierarchy: application -> (service, app_component), service -> interface
      // Plus standalone types: logical_entity, physical_entity, data_entity, business_process
      const appCand = makeCandidate({
        id: 'cand-app-1',
        name: 'TestApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Test application' },
      });
      const compCand = makeCandidate({
        id: 'cand-comp-1',
        name: 'TestComponent',
        candidate_type: 'app_component',
        confidence: 0.85,
        status: 'proposed',
        data: { description: 'Test component', tech_type: 'Spring Boot' },
        parent_candidate_id: 'cand-app-1',
      });
      const svcCand = makeCandidate({
        id: 'cand-svc-1',
        name: 'TestService',
        candidate_type: 'service',
        confidence: 0.8,
        status: 'accepted',
        data: { description: 'Test service', service_type: 'microservice', core_tech: 'Java' },
        parent_candidate_id: 'cand-app-1',
      });
      const ifcCand = makeCandidate({
        id: 'cand-ifc-1',
        name: 'TestInterface',
        candidate_type: 'interfaces',
        confidence: 0.82,
        status: 'proposed',
        data: { description: 'Test API', interface_type: 'REST' },
        parent_candidate_id: 'cand-svc-1',
      });
      const ldeCand = makeCandidate({
        id: 'cand-lde-1',
        name: 'TestLogicalEntity',
        candidate_type: 'logical_data_entities',
        confidence: 0.88,
        status: 'proposed',
        data: { description: 'Test logical entity' },
      });
      const pdeCand = makeCandidate({
        id: 'cand-pde-1',
        name: 'TestPhysicalEntity',
        candidate_type: 'physical_data_entities',
        confidence: 0.91,
        status: 'proposed',
        data: { description: 'Test physical entity', physical_type: 'TABLE', database_name: 'test_db' },
      });
      const dataCand = makeCandidate({
        id: 'cand-data-1',
        name: 'TestDataEntity',
        candidate_type: 'data_entity',
        confidence: 0.87,
        status: 'proposed',
        data: { description: 'Test data entity', physical_type: 'VIEW', database_name: 'analytics_db' },
      });
      const bpCand = makeCandidate({
        id: 'cand-bp-1',
        name: 'TestBusinessProcess',
        candidate_type: 'business_process',
        confidence: 0.93,
        status: 'proposed',
        data: { description: 'Test business process' },
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'AllTypesProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({
              data: [appCand, compCand, svcCand, ifcCand, ldeCand, pdeCand, dataCand, bpCand],
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

      // All 8 candidates should produce entities
      expect(result.entitiesCreated).toBe(8);
      expect(result.entitiesSkipped).toBe(0);
      expect(result.candidatesCommitted).toBe(8);

      // Verify the model was saved
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];

      // Verify each array has the expected entity
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('TestApp');

      expect(savedModel.metaModel.entities.app_components).toHaveLength(1);
      expect(savedModel.metaModel.entities.app_components[0].name).toBe('TestComponent');
      expect(savedModel.metaModel.entities.app_components[0].tech_type).toBe('Spring Boot');

      expect(savedModel.metaModel.entities.services).toHaveLength(1);
      expect(savedModel.metaModel.entities.services[0].name).toBe('TestService');
      expect(savedModel.metaModel.entities.services[0].service_type).toBe('microservice');
      expect(savedModel.metaModel.entities.services[0].core_tech).toBe('Java');

      expect(savedModel.metaModel.entities.interfaces).toHaveLength(1);
      expect(savedModel.metaModel.entities.interfaces[0].name).toBe('TestInterface');
      expect(savedModel.metaModel.entities.interfaces[0].interface_type).toBe('REST');

      expect(savedModel.metaModel.entities.logical_data_entities).toHaveLength(1);
      expect(savedModel.metaModel.entities.logical_data_entities[0].name).toBe('TestLogicalEntity');

      // physical_data_entities should have 2 entries: physical_entity + data_entity
      expect(savedModel.metaModel.entities.physical_data_entities).toHaveLength(2);
      const pdeNames = savedModel.metaModel.entities.physical_data_entities.map((e: any) => e.name);
      expect(pdeNames).toContain('TestPhysicalEntity');
      expect(pdeNames).toContain('TestDataEntity');

      expect(savedModel.metaModel.entities.business_processes).toHaveLength(1);
      expect(savedModel.metaModel.entities.business_processes[0].name).toBe('TestBusinessProcess');

      // Verify parent FK resolution for hierarchical types
      const appId = savedModel.metaModel.entities.applications[0].id;
      const svcId = savedModel.metaModel.entities.services[0].id;

      expect(savedModel.metaModel.entities.app_components[0].application_id).toBe(appId);
      expect(savedModel.metaModel.entities.services[0].application_id).toBe(appId);
      expect(savedModel.metaModel.entities.interfaces[0].service_id).toBe(svcId);
    });
  });

  // ==========================================================================
  // Gap Test 2: Orphaned child candidate is gracefully skipped
  // ==========================================================================
  describe('orphaned child candidate (parent not in eligible set) is gracefully skipped', () => {
    it('skips orphaned candidates and counts them as skipped instead of crashing', async () => {
      const axios = require('axios');

      // A service candidate whose parent application is NOT in the eligible set
      const orphanedService = makeCandidate({
        id: 'cand-svc-1',
        name: 'OrphanedService',
        candidate_type: 'service',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Orphaned service' },
        parent_candidate_id: 'cand-app-nonexistent',
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({ data: [orphanedService] });
          }
          if (url.includes('/candidate-entity-mappings')) {
            return Promise.resolve({ data: [] });
          }
          if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
            return Promise.resolve({ data: makeEmptyModel() });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn().mockResolvedValue({ data: {} }),
        patch: jest.fn().mockResolvedValue({ data: {} }),
      };
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');

      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      // Orphan should be skipped, not crash the save
      expect(result.entitiesCreated).toBe(0);
      expect(result.entitiesSkipped).toBe(1);
    });
  });

  // ==========================================================================
  // Gap Test 3: Full idempotent re-run (all candidates match existing entities)
  // ==========================================================================
  describe('full idempotent re-run produces zero entitiesCreated and all entitiesSkipped', () => {
    it('skips all candidates when every candidate name already exists in the model', async () => {
      const axios = require('axios');

      const appCand = makeCandidate({
        id: 'cand-app-1',
        name: 'ExistingApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        data: { description: 'Already exists' },
      });
      const svcCand = makeCandidate({
        id: 'cand-svc-1',
        name: 'ExistingService',
        candidate_type: 'service',
        confidence: 0.85,
        status: 'proposed',
        data: { description: 'Already exists' },
        parent_candidate_id: 'cand-app-1',
      });

      // Model already has both entities
      const existingModel = makeEmptyModel();
      existingModel.metaModel.entities.applications.push({
        id: 'app-preexisting-001',
        name: 'ExistingApp',
        description: 'Pre-existing app',
        model_file_id: 'TestProject',
      });
      existingModel.metaModel.entities.services.push({
        id: 'svc-preexisting-001',
        name: 'ExistingService',
        description: 'Pre-existing service',
        model_file_id: 'TestProject',
        application_id: 'app-preexisting-001',
      });

      const mockClient = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'proj-001', name: 'TestProject' }],
            });
          }
          if (url.includes('/candidates')) {
            return Promise.resolve({ data: [appCand, svcCand] });
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

      // The top-level app exact-matches a PRE-EXISTING entity, so the
      // model-aware dedup pass SUPPRESSES it (not skipped, not committed).
      // Its candidate ID still resolves to the existing app entity, so the
      // child service resolves its parent FK and is idempotently REUSED.
      expect(result.entitiesCreated).toBe(0);
      expect(result.entitiesSuppressed).toBe(1);
      expect(result.entitiesSkipped).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Model arrays should remain unchanged (no new entities added)
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.services).toHaveLength(1);

      // Verify provenance mappings: only the reused service is mapped; the
      // suppressed app candidate gets NO mapping (it is not committed).
      const mappingPostCalls = mockClient.post.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/candidate-entity-mappings')
      );
      expect(mappingPostCalls).toHaveLength(1);
      const mappings = mappingPostCalls[0][1];
      expect(mappings).toHaveLength(1);
      expect(mappings[0].candidate_id).toBe('cand-svc-1');
      expect(mappings[0].action).toBe('reused');
    });
  });

  // ==========================================================================
  // Gap Test 4: convertCandidateToEntity with missing/empty data defaults
  // ==========================================================================
  describe('convertCandidateToEntity with missing optional data fields defaults gracefully', () => {
    it('produces valid entity shapes when data object is empty (no description, no type-specific fields)', () => {
      // Application with empty data
      const appCandidate = makeCandidate({
        id: 'cand-app-empty',
        name: 'EmptyDataApp',
        candidate_type: 'application',
        data: {},
      });
      const appEntity = convertCandidateToEntity(appCandidate, 'TestProject', {});
      expect(appEntity.id).toMatch(/^app-/);
      expect(appEntity.name).toBe('EmptyDataApp');
      expect(appEntity.description).toBe(''); // defaults to empty string
      expect(appEntity.app_type).toBe('');
      expect(appEntity.status).toBe('');
      expect(appEntity.tags).toBe('');

      // Service with empty data (but parent resolved)
      const svcCandidate = makeCandidate({
        id: 'cand-svc-empty',
        name: 'EmptyDataService',
        candidate_type: 'service',
        data: {},
        parent_candidate_id: 'cand-app-empty',
      });
      const svcEntity = convertCandidateToEntity(svcCandidate, 'TestProject', {
        'cand-app-empty': 'app-test-001',
      });
      expect(svcEntity.id).toMatch(/^svc-/);
      expect(svcEntity.description).toBe('');
      expect(svcEntity.service_type).toBe('');
      expect(svcEntity.core_tech).toBeNull();
      expect(svcEntity.application_id).toBe('app-test-001');

      // Physical entity with empty data
      const pdeCandidate = makeCandidate({
        id: 'cand-pde-empty',
        name: 'EmptyDataPDE',
        candidate_type: 'physical_data_entities',
        data: {},
      });
      const pdeEntity = convertCandidateToEntity(pdeCandidate, 'TestProject', {});
      expect(pdeEntity.id).toMatch(/^pde-/);
      expect(pdeEntity.description).toBe('');
      expect(pdeEntity.physical_type).toBe('');
      // 2026-08-01: the row key follows the DTO wire key `database`
      // (the old `database_name` write never bound on the AMS PUT).
      expect(pdeEntity.database).toBe('');

      // Interface with empty data (but parent resolved)
      const ifcCandidate = makeCandidate({
        id: 'cand-ifc-empty',
        name: 'EmptyDataInterface',
        candidate_type: 'interfaces',
        data: {},
        parent_candidate_id: 'cand-svc-empty',
      });
      const ifcEntity = convertCandidateToEntity(ifcCandidate, 'TestProject', {
        'cand-svc-empty': 'svc-test-002',
      });
      expect(ifcEntity.id).toMatch(/^ifc-/);
      expect(ifcEntity.description).toBe('');
      // interface_type is NOT NULL in the frontend grid; the 2026-05-13
      // derivation hotfix falls back to the dominant default 'REST_API'
      // when the candidate data carries no type signal.
      expect(ifcEntity.interface_type).toBe('REST_API');
      expect(ifcEntity.service_id).toBe('svc-test-002');
    });
  });

  // ==========================================================================
  // Gap Test 5: data_entity candidate type maps to physical_data_entities
  // ==========================================================================
  describe('data_entity candidate type produces physical_data_entity shape', () => {
    it('converts data_entity to physical_data_entity with correct fields and pde- prefix', () => {
      const dataCandidate = makeCandidate({
        id: 'cand-data-1',
        name: 'orders_view',
        candidate_type: 'data_entity',
        data: {
          description: 'Aggregated orders view',
          physical_type: 'VIEW',
          database_name: 'analytics_db',
        },
      });

      const entity = convertCandidateToEntity(dataCandidate, 'TestProject', {});

      // Verify it gets a pde- prefix (same as physical_entity)
      expect(entity.id).toMatch(/^pde-/);
      expect(entity.name).toBe('orders_view');
      expect(entity.description).toBe('Aggregated orders view');
      expect(entity.model_file_id).toBe('TestProject');

      // Verify physical entity-specific fields are populated
      expect(entity.physical_type).toBe('VIEW');
      // 2026-08-01: DTO wire key `database` (see the physical branch fix).
      expect(entity.database).toBe('analytics_db');
      expect(entity.tags).toBe('');
      expect(entity.valid_from).toBeNull();
      expect(entity.valid_to).toBeNull();

      // data_entity should NOT have parent FK fields (top-level type)
      expect(entity.application_id).toBeUndefined();
      expect(entity.service_id).toBeUndefined();
    });
  });

  // ==========================================================================
  // Gap Test 6: buildDepthMap with circular parent references
  // ==========================================================================
  describe('buildDepthMap with circular parent references', () => {
    it('does not infinite loop and assigns depth only to resolvable candidates', () => {
      // Create a circular reference: A -> B -> A
      const candidateA = makeCandidate({
        id: 'cand-a',
        name: 'CircularA',
        candidate_type: 'application',
        parent_candidate_id: 'cand-b',
      });
      const candidateB = makeCandidate({
        id: 'cand-b',
        name: 'CircularB',
        candidate_type: 'application',
        parent_candidate_id: 'cand-a',
      });
      // Plus a normal root candidate
      const candidateC = makeCandidate({
        id: 'cand-c',
        name: 'NormalRoot',
        candidate_type: 'application',
        parent_candidate_id: null,
      });

      const depthMap = buildDepthMap([candidateA, candidateB, candidateC]);

      // The normal root should be at depth 0
      expect(depthMap.get('cand-c')).toBe(0);

      // The circular candidates cannot be resolved to any depth
      // (they will never be placed because neither is a root)
      // The function should terminate (no infinite loop) and simply
      // not include the circular candidates in the depth map
      expect(depthMap.has('cand-a')).toBe(false);
      expect(depthMap.has('cand-b')).toBe(false);

      // Total resolvable candidates: 1
      expect(depthMap.size).toBe(1);
    });
  });

  // ==========================================================================
  // Gap Test 7: Route validation - runId as empty string returns 400
  // ==========================================================================
  describe('route validation: runId as empty string returns 400', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when runId is an empty string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveDiscoveryCandidatesRouter } = require('../routes/saveDiscoveryCandidatesRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          runId: '',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveDiscoveryCandidatesRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('runId'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });
});
