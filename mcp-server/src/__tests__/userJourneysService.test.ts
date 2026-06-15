/**
 * Unit tests for userJourneysService.ts
 *
 * Tests cover: parseAndValidate, name-to-ID resolution,
 * upsert with CREATED/UPDATED status, and the full orchestrator.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock the archModelClient
jest.mock('../services/archModelClient');

// We also need to mock generateId for deterministic IDs in tests
jest.mock('../utils/generateId');

import { parseAndValidate, saveUserJourneys } from '../services/userJourneysService';
import { archModelClient } from '../services/archModelClient';
import { generateId } from '../utils/generateId';

const mockedArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockedGenerateId = generateId as jest.MockedFunction<typeof generateId>;

// ============================================================================
// Helper: create a model with standard reference entities
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
        ],
        process_activities: [
          { id: 'pa-1', name: 'Review Order' },
          { id: 'pa-2', name: 'Submit Order' },
        ],
        applications: [
          { id: 'app-1', name: 'Web Portal', abbreviation: 'WP' },
          { id: 'app-2', name: 'Mobile App', abbreviation: 'MA' },
        ],
        user_journeys: [],
        activity_steps: [],
        services: [],
        interfaces: [],
        ...overrides?.entities,
      },
      relationships: {},
    },
    diagrams: [],
  };
}

// ============================================================================
// Test 1: parseAndValidate accepts valid input
// ============================================================================

describe('parseAndValidate', () => {
  it('accepts valid input with user_journeys and activity_steps', () => {
    const json = JSON.stringify({
      user_journeys: [
        { name: 'Order Journey', description: 'A journey for orders', primary_business_user_abbreviation: 'A' },
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
      ],
    });

    const { input, errors } = parseAndValidate(json);

    expect(errors).toHaveLength(0);
    expect(input.user_journeys).toHaveLength(1);
    expect(input.activity_steps).toHaveLength(1);
  });

  // ============================================================================
  // Test 2: rejects empty user_journeys array
  // ============================================================================

  it('rejects empty user_journeys array', () => {
    const json = JSON.stringify({ user_journeys: [] });
    const { errors } = parseAndValidate(json);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('must not be empty');
  });

  // ============================================================================
  // Test 3: rejects activity_step with missing required fields
  // ============================================================================

  it('rejects activity_step with missing required fields', () => {
    const json = JSON.stringify({
      user_journeys: [{ name: 'Journey A' }],
      activity_steps: [
        {
          user_journey_name: 'Journey A',
          process_activity_name: '',
          business_user_abbreviation: '',
          application_abbreviation: '',
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    // Should have errors for process_activity_name, business_user_abbreviation, application_abbreviation, activity_step_name, diagram_label
    expect(errors.length).toBeGreaterThanOrEqual(5);
    const contexts = errors.map(e => e.context);
    expect(contexts).toContain('activity_steps[0].process_activity_name');
    expect(contexts).toContain('activity_steps[0].business_user_abbreviation');
    expect(contexts).toContain('activity_steps[0].application_abbreviation');
    expect(contexts).toContain('activity_steps[0].activity_step_name');
    expect(contexts).toContain('activity_steps[0].diagram_label');
  });

  // ============================================================================
  // Test 4: rejects duplicate sequence_order within same user_journey_name
  // ============================================================================

  it('rejects duplicate sequence_order within same user_journey_name', () => {
    const json = JSON.stringify({
      user_journeys: [{ name: 'Journey A' }],
      activity_steps: [
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'Step 1',
          business_user_abbreviation: 'Admin',
          application_abbreviation: 'App',
          activity_step_name: 'Step 1 for Admin in App',
          diagram_label: 'Step 1',
          sequence_order: 1,
        },
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'Step 2',
          business_user_abbreviation: 'Admin',
          application_abbreviation: 'App',
          activity_step_name: 'Step 2 for Admin in App',
          diagram_label: 'Step 2',
          sequence_order: 1,
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    const duplicateError = errors.find(e => e.message.includes('Duplicate sequence_order'));
    expect(duplicateError).toBeDefined();
    expect(duplicateError!.message).toContain("Journey A");
  });
});

// ============================================================================
// Test 5: Name-to-ID resolution succeeds when all references exist
// ============================================================================

describe('saveUserJourneys - name resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup axios mock for archModelClient constructor
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('resolves all FK references when they exist in the model', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue({});

    const json = JSON.stringify({
      user_journeys: [
        {
          name: 'Order Journey',
          primary_business_user_abbreviation: 'A',
          parent_business_process_name: 'Order Management',
        },
      ],
      activity_steps: [
        {
          user_journey_name: 'Order Journey',
          process_activity_name: 'Review Order',
          business_user_abbreviation: 'CU',
          application_abbreviation: 'WP',
          activity_step_name: 'Review Order for CU in WP',
          diagram_label: 'Review Order',
          sequence_order: 1,
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.entities.userJourneys).toHaveLength(1);
    expect(result.entities.userJourneys[0].status).toBe('CREATED');
    expect(result.entities.activitySteps).toHaveLength(1);
    expect(result.entities.activitySteps[0].status).toBe('CREATED');

    // Verify the model was PUT with resolved IDs
    const putCall = mockedArchModelClient.putModel.mock.calls[0];
    const putModel = putCall[3];
    const savedJourney = putModel.metaModel.entities.user_journeys[0];
    expect(savedJourney.primary_business_user_id).toBe('bu-1'); // Admin's ID
    expect(savedJourney.parent_business_process_id).toBe('bp-1'); // Order Management's ID

    const savedStep = putModel.metaModel.entities.activity_steps[0];
    expect(savedStep.process_activity_id).toBe('pa-1'); // Review Order's ID
    expect(savedStep.business_user_id).toBe('bu-2'); // Customer's ID
    expect(savedStep.application_id).toBe('app-1'); // Web Portal's ID
  });

  // ============================================================================
  // Test 6: Rejects unknown business user abbreviation
  // ============================================================================

  it('rejects unknown business user abbreviation with descriptive error', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Order Journey' },
      ],
      activity_steps: [
        {
          user_journey_name: 'Order Journey',
          process_activity_name: 'Review Order',
          business_user_abbreviation: 'XX',
          application_abbreviation: 'WP',
          activity_step_name: 'Review Order for XX in WP',
          diagram_label: 'Review Order',
          sequence_order: 1,
        },
      ],
    });

    try {
      await saveUserJourneys('proj-1', json);
      fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("abbreviation 'XX' not found");
      expect(err.message).toContain('Business user');
    }

    expect(mockedArchModelClient.putModel).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Test 6b: Rejects unknown application abbreviation
  // ============================================================================

  it('rejects unknown application abbreviation with descriptive error', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Order Journey' },
      ],
      activity_steps: [
        {
          user_journey_name: 'Order Journey',
          process_activity_name: 'Review Order',
          business_user_abbreviation: 'A',
          application_abbreviation: 'ZZ',
          activity_step_name: 'Review Order for A in ZZ',
          diagram_label: 'Review Order',
          sequence_order: 1,
        },
      ],
    });

    try {
      await saveUserJourneys('proj-1', json);
      fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("abbreviation 'ZZ' not found");
      expect(err.message).toContain('Application');
    }

    expect(mockedArchModelClient.putModel).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Test 7: Upsert -- new journey gets CREATED, existing gets UPDATED
// ============================================================================

describe('saveUserJourneys - upsert logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('new journey gets CREATED status; existing journey gets UPDATED status with preserved ID', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    // Model already has one user_journey
    const model = createModelWithEntities({
      entities: {
        user_journeys: [
          { id: 'uj-existing-1', name: 'Existing Journey', description: 'Old description', tags: null },
        ],
        activity_steps: [],
      },
    });
    mockedArchModelClient.getModel.mockResolvedValue(model);
    mockedArchModelClient.putModel.mockResolvedValue({});

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Existing Journey', description: 'Updated description' },
        { name: 'New Journey', description: 'Brand new' },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);

    // Existing journey should be UPDATED with preserved ID
    const existingResult = result.entities.userJourneys.find(j => j.name === 'Existing Journey');
    expect(existingResult).toBeDefined();
    expect(existingResult!.status).toBe('UPDATED');
    expect(existingResult!.id).toBe('uj-existing-1');

    // New journey should be CREATED with generated ID
    const newResult = result.entities.userJourneys.find(j => j.name === 'New Journey');
    expect(newResult).toBeDefined();
    expect(newResult!.status).toBe('CREATED');
    expect(newResult!.id).toMatch(/^uj-/);
    expect(newResult!.id).not.toBe('uj-existing-1');

    // Verify the PUT model has updated description for existing journey
    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const existingJourneyInModel = putModel.metaModel.entities.user_journeys.find(
      (j: any) => j.name === 'Existing Journey'
    );
    expect(existingJourneyInModel.description).toBe('Updated description');
  });

  // ============================================================================
  // Test 8: Idempotent re-run produces all UPDATED statuses with no new IDs
  // ============================================================================

  it('idempotent re-run produces all UPDATED statuses with no new IDs', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    // Model already has the same journey and step
    const model = createModelWithEntities({
      entities: {
        user_journeys: [
          { id: 'uj-existing-1', name: 'Order Journey', description: 'desc', tags: null,
            primary_business_user_id: 'bu-1', parent_business_process_id: null },
        ],
        activity_steps: [
          { id: 'as-existing-1', name: 'Review Order', user_journey_id: 'uj-existing-1',
            process_activity_id: 'pa-1', business_user_id: 'bu-1', application_id: 'app-1',
            sequence_order: 1, description: null, tags: null },
        ],
      },
    });
    mockedArchModelClient.getModel.mockResolvedValue(model);
    mockedArchModelClient.putModel.mockResolvedValue({});

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Order Journey', description: 'desc', primary_business_user_abbreviation: 'A' },
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
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);

    // All UPDATED, no CREATED
    expect(result.summary.userJourneys.created).toBe(0);
    expect(result.summary.userJourneys.updated).toBe(1);
    expect(result.summary.activitySteps.created).toBe(0);
    expect(result.summary.activitySteps.updated).toBe(1);

    // IDs should be the existing ones (no generateId should have been used for these)
    expect(result.entities.userJourneys[0].id).toBe('uj-existing-1');
    expect(result.entities.activitySteps[0].id).toBe('as-existing-1');
  });
});
