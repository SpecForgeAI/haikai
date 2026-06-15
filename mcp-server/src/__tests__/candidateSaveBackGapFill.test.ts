/**
 * Gap-Fill Tests: Save-Back Integration for New and Existing Candidate Types
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 13: Test Review and Gap Analysis
 *
 * 3 strategic integration tests:
 *
 * 1. Save-back of 'class' candidate creates entity with service_id FK
 * 2. Save-back of 'endpoints' candidate creates entity with interface_id FK
 * 3. Regression: existing candidate types still save-back correctly after CANDIDATE_TYPE_CONFIG additions
 *
 * Updated 2026-04-20: discovery-originated candidate_type keys renamed from
 * singular to plural (e.g. `endpoint` -> `endpoints`, `interface` -> `interfaces`,
 * `logical_entity` -> `logical_data_entities`, `physical_entity` ->
 * `physical_data_entities`). MCP-predates-discovery keys (application,
 * app_component, service, business_process, class, method, data_entity)
 * remain singular.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import {
  CANDIDATE_TYPE_CONFIG,
  convertCandidateToEntity,
  getTargetArrayKey,
} from '../services/candidateSaveBackService';

// ============================================================================
// Helper: create a mock DiscoveryCandidateDto
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-gap-001',
    run_id: 'run-gap-001',
    candidate_type: 'application',
    name: 'DefaultApp',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-04-07T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

describe('candidateSaveBackService - gap-fill integration tests (TG13)', () => {

  // ==========================================================================
  // Test 1: Save-back of 'class' candidate creates entity with service_id FK
  // ==========================================================================
  test('save-back of class candidate creates entity with service_id FK resolved from parent', () => {
    // Scenario: A 'class' candidate whose parent is a 'service' candidate
    // that was previously saved as entity 'svc-order-service-123'
    const classCandidate = makeCandidate({
      id: 'cand-cls-gap-1',
      candidate_type: 'class',
      name: 'OrderProcessor',
      data: { description: 'Processes orders in batch mode' },
      parent_candidate_id: 'cand-svc-parent-1',
    });

    const candidateIdToEntityId: Record<string, string> = {
      'cand-svc-parent-1': 'svc-order-service-123',
    };

    const entity = convertCandidateToEntity(classCandidate, 'MyProject', candidateIdToEntityId);

    // Verify entity ID has the cls- prefix
    expect(entity.id).toMatch(/^cls-/);

    // Verify the service_id FK is populated from the parent mapping
    expect(entity.service_id).toBe('svc-order-service-123');

    // Verify common fields
    expect(entity.name).toBe('OrderProcessor');
    expect(entity.description).toBe('Processes orders in batch mode');
    expect(entity.model_file_id).toBe('MyProject');

    // Verify getTargetArrayKey resolves correctly
    expect(getTargetArrayKey('class')).toBe('classes');
  });

  // ==========================================================================
  // Test 2: Save-back of 'endpoints' candidate creates entity with interface_id FK
  // ==========================================================================
  test('save-back of endpoints candidate creates entity with interface_id FK and metadata fields', () => {
    // Scenario: An 'endpoints' candidate whose parent is an 'interfaces' candidate
    const endpointCandidate = makeCandidate({
      id: 'cand-ep-gap-1',
      candidate_type: 'endpoints',
      name: 'GET /api/users/{id}',
      data: {
        description: 'Retrieves a user by ID',
        http_method: 'GET',
        path: '/api/users/{id}',
      },
      parent_candidate_id: 'cand-ifc-parent-1',
    });

    const candidateIdToEntityId: Record<string, string> = {
      'cand-ifc-parent-1': 'ifc-user-api-456',
    };

    const entity = convertCandidateToEntity(endpointCandidate, 'MyProject', candidateIdToEntityId);

    // Verify entity ID has the ep- prefix
    expect(entity.id).toMatch(/^ep-/);

    // Verify the interface_id FK is populated from the parent mapping
    expect(entity.interface_id).toBe('ifc-user-api-456');

    // Verify endpoint-specific metadata fields (DTO field names: operation_verb, path_or_address)
    expect(entity.operation_verb).toBe('GET');
    expect(entity.path_or_address).toBe('/api/users/{id}');

    // Verify common fields
    expect(entity.name).toBe('GET /api/users/{id}');
    expect(entity.description).toBe('Retrieves a user by ID');
    expect(entity.model_file_id).toBe('MyProject');

    // Verify getTargetArrayKey resolves correctly
    expect(getTargetArrayKey('endpoints')).toBe('endpoints');
  });

  // ==========================================================================
  // Test 3: Regression: existing candidate types still save-back correctly
  //         after CANDIDATE_TYPE_CONFIG additions
  // ==========================================================================
  test('regression: existing candidate types (application, service, interfaces, etc.) still save-back correctly', () => {
    // Verify that all original types still have correct config entries
    // (discovery-originated types are now plural; MCP-predates-discovery
    // types remain singular)
    const existingTypes = [
      { type: 'application', expectedArray: 'applications', expectedPrefix: 'app-', expectedFk: null },
      { type: 'app_component', expectedArray: 'app_components', expectedPrefix: 'comp-', expectedFk: 'application_id' },
      { type: 'service', expectedArray: 'services', expectedPrefix: 'svc-', expectedFk: 'application_id' },
      { type: 'interfaces', expectedArray: 'interfaces', expectedPrefix: 'ifc-', expectedFk: 'service_id' },
      { type: 'logical_data_entities', expectedArray: 'logical_data_entities', expectedPrefix: 'lde-', expectedFk: null },
      { type: 'physical_data_entities', expectedArray: 'physical_data_entities', expectedPrefix: 'pde-', expectedFk: null },
      { type: 'data_entity', expectedArray: 'physical_data_entities', expectedPrefix: 'pde-', expectedFk: null },
      { type: 'business_process', expectedArray: 'business_processes', expectedPrefix: 'bp-', expectedFk: null },
    ];

    for (const { type, expectedArray, expectedPrefix, expectedFk } of existingTypes) {
      const config = CANDIDATE_TYPE_CONFIG[type];
      expect(config).toBeDefined();
      expect(config.targetArrayKey).toBe(expectedArray);
      expect(config.idPrefix).toBe(expectedPrefix);
      expect(config.parentFkField).toBe(expectedFk);
    }

    // Verify total config entry count is 28:
    //   7 MCP-predates-discovery (singular) +
    //  10 discovery-originated plural (interfaces, endpoints,
    //     logical_data_entities, logical_data_attributes,
    //     physical_data_entities, physical_data_attributes,
    //     business_logics, logical_data_entity_relationships,
    //     ui_screens, ui_components) +
    //   1 polymorphic relationship (interface_logical_entities) +
    //   1 endpoint->data-effect edge relationship (endpoint_data_effects,
    //     added 2026-05-29 by Task Group 2) +
    //   1 outbound integration edge relationship (data_movements, added
    //     2026-05-30 by the outbound-integration-graph spec) +
    //   8 backwards-compat singular aliases added 2026-04-21 for
    //     pre-rename discovery runs (interface, endpoint, logical_entity,
    //     logical_data_attribute, physical_entity, physical_attribute,
    //     business_logic, entity_relationship).
    expect(Object.keys(CANDIDATE_TYPE_CONFIG)).toHaveLength(28);

    // Test a top-level existing type converts correctly
    const appCandidate = makeCandidate({
      id: 'cand-app-regression',
      candidate_type: 'application',
      name: 'Legacy CRM',
      data: { description: 'Customer relationship management system', app_type: 'web', status: 'active', tags: 'legacy' },
    });

    const appEntity = convertCandidateToEntity(appCandidate, 'RegressionProject', {});
    expect(appEntity.id).toMatch(/^app-/);
    expect(appEntity.name).toBe('Legacy CRM');
    expect(appEntity.description).toBe('Customer relationship management system');
    expect(appEntity.app_type).toBe('web');
    expect(appEntity.status).toBe('active');
    expect(appEntity.tags).toBe('legacy');
    expect(appEntity.model_file_id).toBe('RegressionProject');

    // Test a child existing type (service with application parent) converts correctly
    const serviceCandidate = makeCandidate({
      id: 'cand-svc-regression',
      candidate_type: 'service',
      name: 'Order API',
      data: { description: 'REST API for order management', service_type: 'REST' },
      parent_candidate_id: 'cand-app-regression',
    });

    const svcEntity = convertCandidateToEntity(serviceCandidate, 'RegressionProject', {
      'cand-app-regression': 'app-legacy-crm-123',
    });
    expect(svcEntity.id).toMatch(/^svc-/);
    expect(svcEntity.name).toBe('Order API');
    expect(svcEntity.application_id).toBe('app-legacy-crm-123');
    expect(svcEntity.service_type).toBe('REST');

    // Test an interfaces candidate with service parent
    const ifcCandidate = makeCandidate({
      id: 'cand-ifc-regression',
      candidate_type: 'interfaces',
      name: 'UserAPI',
      data: { description: 'User management interface', interface_type: 'REST' },
      parent_candidate_id: 'cand-svc-regression',
    });

    const ifcEntity = convertCandidateToEntity(ifcCandidate, 'RegressionProject', {
      'cand-svc-regression': 'svc-order-api-456',
    });
    expect(ifcEntity.id).toMatch(/^ifc-/);
    expect(ifcEntity.name).toBe('UserAPI');
    expect(ifcEntity.service_id).toBe('svc-order-api-456');
    expect(ifcEntity.interface_type).toBe('REST');
  });
});
