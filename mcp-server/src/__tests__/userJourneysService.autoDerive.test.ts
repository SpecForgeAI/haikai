/**
 * Tests for auto-derivation of BusinessPoints, ApplicationPoints, and
 * their relationships during the save_user_journeys pipeline.
 *
 * Task Group 1, Task 1.1 -- 6 focused tests
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock the archModelClient
jest.mock('../services/archModelClient');

// Mock generateId for deterministic IDs in tests
jest.mock('../utils/generateId');

import { saveUserJourneys } from '../services/userJourneysService';
import { archModelClient } from '../services/archModelClient';
import { generateId } from '../utils/generateId';

const mockedArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockedGenerateId = generateId as jest.MockedFunction<typeof generateId>;

// ============================================================================
// Helper: create a model with standard reference entities including
// business_process_id on process_activities (critical for derivation)
// ============================================================================

function createModelWithEntities(overrides?: any): any {
  return {
    metaModel: {
      entities: {
        business_users: [
          { id: 'bu-1', name: 'Admin', abbreviation: 'A' },
          { id: 'bu-2', name: 'Customer', abbreviation: 'CU' },
        ],
        business_processes: [
          { id: 'bp-1', name: 'Order Management' },
          { id: 'bp-2', name: 'Returns' },
        ],
        process_activities: [
          { id: 'pa-1', name: 'Review Order', business_process_id: 'bp-1' },
          { id: 'pa-2', name: 'Submit Order', business_process_id: 'bp-1' },
          { id: 'pa-3', name: 'Process Return', business_process_id: 'bp-2' },
        ],
        applications: [
          { id: 'app-1', name: 'Web Portal', abbreviation: 'WP' },
          { id: 'app-2', name: 'Mobile App', abbreviation: 'MA' },
        ],
        user_journeys: [],
        activity_steps: [],
        business_points: [],
        application_points: [],
        services: [],
        interfaces: [],
        ...overrides?.entities,
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        user_journey_links: [],
        ...overrides?.relationships,
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// Standard test input: one journey with two activity steps
// ============================================================================

function createStandardInput(): string {
  return JSON.stringify({
    user_journeys: [
      {
        name: 'Order Journey',
        description: 'Admin places and reviews orders',
        primary_business_user_abbreviation: 'A',
        parent_business_process_name: 'Order Management',
      },
    ],
    activity_steps: [
      {
        user_journey_name: 'Order Journey',
        process_activity_name: 'Review Order',
        business_user_abbreviation: 'A',
        application_abbreviation: 'WP',
        activity_step_name: 'Review Order for A in WP',
        diagram_label: 'Review Order',
        sequence_order: 1,
      },
      {
        user_journey_name: 'Order Journey',
        process_activity_name: 'Submit Order',
        business_user_abbreviation: 'A',
        application_abbreviation: 'MA',
        activity_step_name: 'Submit Order for A in MA',
        diagram_label: 'Submit Order',
        sequence_order: 2,
      },
    ],
  });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('userJourneysService - auto-derive BusinessPoints, ApplicationPoints, and relationships', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  // ==========================================================================
  // Test 1: BUSINESS_PROCESS-kind BusinessPoints are created
  // ==========================================================================

  it('Test 1: creates BUSINESS_PROCESS-kind BusinessPoints with bpt_{businessProcessId} IDs', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const businessPoints = putModel.metaModel.entities.business_points;

    // Should have a BUSINESS_PROCESS-kind BusinessPoint for bp-1 (Order Management)
    const bpPoint = businessPoints.find(
      (bp: any) => bp.id === 'bpt_bp-1' && bp.kind === 'BUSINESS_PROCESS'
    );
    expect(bpPoint).toBeDefined();
    expect(bpPoint.business_process_id).toBe('bp-1');
    expect(bpPoint.name).toBe('Order Management');
    expect(bpPoint.process_activity_id).toBeNull();
    expect(bpPoint.description).toBeNull();
    expect(bpPoint.tags).toBeNull();
    expect(bpPoint.valid_from).toBeNull();
    expect(bpPoint.valid_to).toBeNull();
  });

  // ==========================================================================
  // Test 2: PROCESS_ACTIVITY-kind BusinessPoints are created
  // ==========================================================================

  it('Test 2: creates PROCESS_ACTIVITY-kind BusinessPoints with bpt_{processActivityId} IDs', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const businessPoints = putModel.metaModel.entities.business_points;

    // Should have PROCESS_ACTIVITY-kind BusinessPoints for pa-1 and pa-2
    const paPoint1 = businessPoints.find(
      (bp: any) => bp.id === 'bpt_pa-1' && bp.kind === 'PROCESS_ACTIVITY'
    );
    expect(paPoint1).toBeDefined();
    expect(paPoint1.business_process_id).toBe('bp-1');
    expect(paPoint1.process_activity_id).toBe('pa-1');
    expect(paPoint1.name).toBe('Review Order');

    const paPoint2 = businessPoints.find(
      (bp: any) => bp.id === 'bpt_pa-2' && bp.kind === 'PROCESS_ACTIVITY'
    );
    expect(paPoint2).toBeDefined();
    expect(paPoint2.business_process_id).toBe('bp-1');
    expect(paPoint2.process_activity_id).toBe('pa-2');
    expect(paPoint2.name).toBe('Submit Order');
  });

  // ==========================================================================
  // Test 3: APPLICATION-kind ApplicationPoints are auto-created
  // ==========================================================================

  it('Test 3: auto-creates APPLICATION-kind ApplicationPoints for activity steps with no existing ApplicationPoint', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const applicationPoints = putModel.metaModel.entities.application_points;

    // Should have APPLICATION-kind ApplicationPoints for app-1 (Web Portal) and app-2 (Mobile App)
    const aptForWP = applicationPoints.find(
      (ap: any) => ap.application_id === 'app-1' && ap.kind === 'APPLICATION'
    );
    expect(aptForWP).toBeDefined();
    expect(aptForWP.id).toMatch(/^apt-/);
    expect(aptForWP.name).toBe('Web Portal');
    expect(aptForWP.description).toBeNull();
    expect(aptForWP.application_component_id).toBeNull();
    expect(aptForWP.service_id).toBeNull();
    expect(aptForWP.interface_id).toBeNull();
    expect(aptForWP.target_type).toBeNull();
    expect(aptForWP.target_ref_id).toBeNull();
    expect(aptForWP.point_type).toBeNull();

    const aptForMA = applicationPoints.find(
      (ap: any) => ap.application_id === 'app-2' && ap.kind === 'APPLICATION'
    );
    expect(aptForMA).toBeDefined();
    expect(aptForMA.id).toMatch(/^apt-/);
    expect(aptForMA.name).toBe('Mobile App');
  });

  // ==========================================================================
  // Test 4: BusinessUser-to-BusinessPoint relationships are created
  // ==========================================================================

  it('Test 4: creates business_user_business_points relationships linking journey business user to derived BusinessPoints', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const bubpRels = putModel.metaModel.relationships.business_user_business_points;

    // Admin (bu-1) should be linked to:
    // - bpt_bp-1 (BUSINESS_PROCESS for Order Management)
    // - bpt_pa-1 (PROCESS_ACTIVITY for Review Order)
    // - bpt_pa-2 (PROCESS_ACTIVITY for Submit Order)
    expect(bubpRels.length).toBeGreaterThanOrEqual(3);

    const adminToBpBP = bubpRels.find(
      (r: any) => r.business_user_id === 'bu-1' && r.business_point_id === 'bpt_bp-1'
    );
    expect(adminToBpBP).toBeDefined();
    expect(adminToBpBP.id).toMatch(/^bubp-/);
    expect(adminToBpBP.description).toBeNull();
    expect(adminToBpBP.tags).toBeNull();
    expect(adminToBpBP.valid_from).toBeNull();
    expect(adminToBpBP.valid_to).toBeNull();

    const adminToPa1 = bubpRels.find(
      (r: any) => r.business_user_id === 'bu-1' && r.business_point_id === 'bpt_pa-1'
    );
    expect(adminToPa1).toBeDefined();

    const adminToPa2 = bubpRels.find(
      (r: any) => r.business_user_id === 'bu-1' && r.business_point_id === 'bpt_pa-2'
    );
    expect(adminToPa2).toBeDefined();
  });

  // ==========================================================================
  // Test 5: ApplicationPoint-to-BusinessPoint relationships are created
  // ==========================================================================

  it('Test 5: creates application_point_business_points relationships linking ApplicationPoints to BusinessPoints', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const apbpRels = putModel.metaModel.relationships.application_point_business_points;
    const applicationPoints = putModel.metaModel.entities.application_points;

    // Find the ApplicationPoint IDs for app-1 and app-2
    const aptWP = applicationPoints.find(
      (ap: any) => ap.application_id === 'app-1' && ap.kind === 'APPLICATION'
    );
    const aptMA = applicationPoints.find(
      (ap: any) => ap.application_id === 'app-2' && ap.kind === 'APPLICATION'
    );

    expect(aptWP).toBeDefined();
    expect(aptMA).toBeDefined();

    // Web Portal (app-1) is used in step 1 (Review Order, pa-1, bp-1):
    // should link to bpt_pa-1 (PROCESS_ACTIVITY) and bpt_bp-1 (BUSINESS_PROCESS)
    const wpToPa1 = apbpRels.find(
      (r: any) => r.application_point_id === aptWP.id && r.business_point_id === 'bpt_pa-1'
    );
    expect(wpToPa1).toBeDefined();
    expect(wpToPa1.id).toMatch(/^apbp-/);

    const wpToBp1 = apbpRels.find(
      (r: any) => r.application_point_id === aptWP.id && r.business_point_id === 'bpt_bp-1'
    );
    expect(wpToBp1).toBeDefined();

    // Mobile App (app-2) is used in step 2 (Submit Order, pa-2, bp-1):
    // should link to bpt_pa-2 (PROCESS_ACTIVITY) and bpt_bp-1 (BUSINESS_PROCESS)
    const maToPa2 = apbpRels.find(
      (r: any) => r.application_point_id === aptMA.id && r.business_point_id === 'bpt_pa-2'
    );
    expect(maToPa2).toBeDefined();

    const maToBp1 = apbpRels.find(
      (r: any) => r.application_point_id === aptMA.id && r.business_point_id === 'bpt_bp-1'
    );
    expect(maToBp1).toBeDefined();
  });

  // ==========================================================================
  // Test 6: Idempotency -- re-saving does not create duplicates
  // ==========================================================================

  it('Test 6: re-saving the same journeys does not create duplicate entities or relationships', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    // First save: start with a clean model
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    // Capture the model from the first save
    const firstPutModel = JSON.parse(JSON.stringify(mockedArchModelClient.putModel.mock.calls[0][3]));
    const firstBpCount = firstPutModel.metaModel.entities.business_points.length;
    const firstApCount = firstPutModel.metaModel.entities.application_points.length;
    const firstBubpCount = firstPutModel.metaModel.relationships.business_user_business_points.length;
    const firstApbpCount = firstPutModel.metaModel.relationships.application_point_business_points.length;

    expect(firstBpCount).toBeGreaterThan(0);
    expect(firstApCount).toBeGreaterThan(0);
    expect(firstBubpCount).toBeGreaterThan(0);
    expect(firstApbpCount).toBeGreaterThan(0);

    // Second save: use the model output from the first save as the existing model
    jest.clearAllMocks();
    idCounter = 100; // Reset counter to avoid collisions
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);
    mockedArchModelClient.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' });
    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(firstPutModel);
    mockedArchModelClient.putModel.mockResolvedValue({});

    await saveUserJourneys('proj-1', createStandardInput());

    const secondPutModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const secondBpCount = secondPutModel.metaModel.entities.business_points.length;
    const secondApCount = secondPutModel.metaModel.entities.application_points.length;
    const secondBubpCount = secondPutModel.metaModel.relationships.business_user_business_points.length;
    const secondApbpCount = secondPutModel.metaModel.relationships.application_point_business_points.length;

    // Counts should be identical -- no duplicates
    expect(secondBpCount).toBe(firstBpCount);
    expect(secondApCount).toBe(firstApCount);
    expect(secondBubpCount).toBe(firstBubpCount);
    expect(secondApbpCount).toBe(firstApbpCount);
  });
});
