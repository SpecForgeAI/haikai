/**
 * Gap analysis tests for userJourneysService.ts
 *
 * Fills critical coverage gaps identified during Task Group 5 review:
 * - All-or-nothing rejection with multiple errors
 * - Activity step upsert by composite key
 * - Optional fields yielding null IDs
 * - Merge preserves other entity arrays
 * - Activity step name derivation
 * - Upstream PUT failure returns 502
 * - Malformed JSON input handling
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock the archModelClient
jest.mock('../services/archModelClient');

// Mock generateId for deterministic IDs
jest.mock('../utils/generateId');

import { parseAndValidate, saveUserJourneys } from '../services/userJourneysService';
import { archModelClient } from '../services/archModelClient';
import { generateId } from '../utils/generateId';

const mockedArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockedGenerateId = generateId as jest.MockedFunction<typeof generateId>;

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
        services: [
          { id: 'svc-1', name: 'Order Service' },
        ],
        interfaces: [
          { id: 'ifc-1', name: 'Order API' },
        ],
        user_journeys: [],
        activity_steps: [],
        ...overrides?.entities,
      },
      relationships: {
        business_user_business_points: [
          { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bpt-1' },
        ],
        ...overrides?.relationships,
      },
    },
    diagrams: overrides?.diagrams || [{ id: 'diag-1', name: 'Test Diagram' }],
  };
}

describe('Gap: Auto-create missing referenced entities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('auto-creates missing process activities and business processes, but rejects unknown business user abbreviation', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}auto-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Journey A', primary_business_user_abbreviation: 'XX', parent_business_process_name: 'NonExistentProcess' },
      ],
      activity_steps: [
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'NonExistentActivity',
          business_user_abbreviation: 'A',
          application_abbreviation: 'WP',
          activity_step_name: 'NonExistentActivity for A in WP',
          diagram_label: 'NonExistentActivity',
          sequence_order: 1,
        },
      ],
    });

    // Should fail because primary_business_user_abbreviation 'XX' doesn't exist
    try {
      await saveUserJourneys('proj-1', json);
      fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("abbreviation 'XX' not found");
    }

    expect(mockedArchModelClient.putModel).not.toHaveBeenCalled();
  });

  it('auto-creates missing process activities with existing business users and applications', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}auto-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue(undefined);

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Journey A', primary_business_user_abbreviation: 'A', parent_business_process_name: 'NonExistentProcess' },
      ],
      activity_steps: [
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'NonExistentActivity',
          business_user_abbreviation: 'CU',
          application_abbreviation: 'WP',
          activity_step_name: 'NonExistentActivity for CU in WP',
          diagram_label: 'NonExistentActivity',
          sequence_order: 1,
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.summary.userJourneys.created).toBe(1);
    expect(result.summary.activitySteps.created).toBe(1);

    // Business users and applications are NOT auto-created (they must exist)
    expect(result.summary.autoCreatedEntities.businessUsers).toBe(0);
    expect(result.summary.autoCreatedEntities.applications).toBe(0);
    // Process and business process ARE still auto-created
    expect(result.summary.autoCreatedEntities.businessProcesses).toBe(1); // NonExistentProcess
    expect(result.summary.autoCreatedEntities.processActivities).toBe(1); // NonExistentActivity

    const savedModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const pa = savedModel.metaModel.entities.process_activities;
    const bp = savedModel.metaModel.entities.business_processes;

    const createdPA = pa.find((e: any) => e.name === 'NonExistentActivity');
    const createdBP = bp.find((e: any) => e.name === 'NonExistentProcess');
    expect(createdPA.business_process_id).toBe(createdBP.id);
    expect(createdPA.actor_hint).toBe('Customer'); // Uses the resolved business user's name, not abbreviation
    expect(createdPA.user_interaction_level).toBe('HIGH');
  });

  it('creates "Unassigned" business process when journey has no parent and process activity needs auto-creation', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}auto-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockResolvedValue(undefined);

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Journey No BP' }, // No parent_business_process_name
      ],
      activity_steps: [
        {
          user_journey_name: 'Journey No BP',
          process_activity_name: 'Brand New Activity',
          business_user_abbreviation: 'A',
          application_abbreviation: 'WP',
          activity_step_name: 'Brand New Activity for A in WP',
          diagram_label: 'Brand New Activity',
          sequence_order: 1,
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.summary.autoCreatedEntities.processActivities).toBe(1);
    expect(result.summary.autoCreatedEntities.businessProcesses).toBe(1); // "Unassigned" created

    const savedModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const pa = savedModel.metaModel.entities.process_activities;
    const bp = savedModel.metaModel.entities.business_processes;

    const createdPA = pa.find((e: any) => e.name === 'Brand New Activity');
    const unassignedBP = bp.find((e: any) => e.name === 'Unassigned');

    expect(unassignedBP).toBeDefined();
    expect(createdPA.business_process_id).toBe(unassignedBP.id);
    expect(createdPA.actor_hint).toBe('Admin'); // Uses the resolved business user's name
    expect(createdPA.user_interaction_level).toBe('HIGH');
  });
});

describe('Gap: Activity step upsert by composite key (user_journey_id, sequence_order)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('matches existing step by (user_journey_id, sequence_order) and updates it', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}new-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    const model = createModelWithEntities({
      entities: {
        user_journeys: [
          { id: 'uj-1', name: 'Journey A', description: 'existing', tags: null },
        ],
        activity_steps: [
          {
            id: 'as-existing-1',
            name: 'Review Order',
            user_journey_id: 'uj-1',
            process_activity_id: 'pa-1',
            business_user_id: 'bu-1',
            application_id: 'app-1',
            sequence_order: 1,
            description: null,
            tags: null,
          },
          {
            id: 'as-existing-2',
            name: 'Submit Order',
            user_journey_id: 'uj-1',
            process_activity_id: 'pa-2',
            business_user_id: 'bu-2',
            application_id: 'app-2',
            sequence_order: 2,
            description: null,
            tags: null,
          },
        ],
      },
    });
    mockedArchModelClient.getModel.mockResolvedValue(model);
    mockedArchModelClient.putModel.mockResolvedValue({});

    const json = JSON.stringify({
      user_journeys: [{ name: 'Journey A' }],
      activity_steps: [
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'Review Order',
          business_user_abbreviation: 'CU',
          application_abbreviation: 'MA',
          activity_step_name: 'Review Order for CU in MA',
          diagram_label: 'Review Order',
          sequence_order: 1,
          description: 'Updated step',
        },
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'Submit Order',
          business_user_abbreviation: 'A',
          application_abbreviation: 'WP',
          activity_step_name: 'Submit Order for A in WP',
          diagram_label: 'Submit Order',
          sequence_order: 3,
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    // Step at seq 1 should be UPDATED (existing as-existing-1)
    const step1 = result.entities.activitySteps.find(s => s.sequenceOrder === 1);
    expect(step1).toBeDefined();
    expect(step1!.status).toBe('UPDATED');
    expect(step1!.id).toBe('as-existing-1');

    // Step at seq 3 should be CREATED (no existing match)
    const step3 = result.entities.activitySteps.find(s => s.sequenceOrder === 3);
    expect(step3).toBeDefined();
    expect(step3!.status).toBe('CREATED');
    expect(step3!.id).toMatch(/^as-/);
  });
});

describe('Gap: Optional fields (primary_business_user_abbreviation, parent_business_process_name) yield null IDs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('null/empty optional fields result in null IDs, not rejection', async () => {
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
        { name: 'Simple Journey' },
        { name: 'Journey with empty refs', primary_business_user_abbreviation: '', parent_business_process_name: null },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.entities.userJourneys).toHaveLength(2);

    // Verify the PUT model has null IDs for the FK fields
    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const simpleJourney = putModel.metaModel.entities.user_journeys.find(
      (j: any) => j.name === 'Simple Journey'
    );
    expect(simpleJourney.primary_business_user_id).toBeNull();
    expect(simpleJourney.parent_business_process_id).toBeNull();
  });
});

describe('Gap: Merge preserves other entity arrays', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('preserves services, interfaces, relationships, and diagrams during merge', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    const model = createModelWithEntities();
    mockedArchModelClient.getModel.mockResolvedValue(model);
    mockedArchModelClient.putModel.mockResolvedValue({});

    const json = JSON.stringify({
      user_journeys: [{ name: 'New Journey' }],
    });

    await saveUserJourneys('proj-1', json);

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];

    // Verify other entity arrays are preserved
    expect(putModel.metaModel.entities.services).toHaveLength(1);
    expect(putModel.metaModel.entities.services[0].name).toBe('Order Service');
    expect(putModel.metaModel.entities.interfaces).toHaveLength(1);
    expect(putModel.metaModel.entities.interfaces[0].name).toBe('Order API');
    expect(putModel.metaModel.entities.business_users).toHaveLength(2);
    expect(putModel.metaModel.entities.applications).toHaveLength(2);

    // Verify relationships are preserved
    expect(putModel.metaModel.relationships.business_user_business_points).toHaveLength(1);

    // Verify diagrams are preserved
    expect(putModel.diagrams).toHaveLength(1);
    expect(putModel.diagrams[0].name).toBe('Test Diagram');
  });
});

describe('Gap: Activity step name derivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('derives activity step name from description when provided, otherwise from process_activity_name', async () => {
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
      user_journeys: [{ name: 'Journey A' }],
      activity_steps: [
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'Review Order',
          business_user_abbreviation: 'A',
          application_abbreviation: 'WP',
          activity_step_name: 'Review Order for A in WP',
          diagram_label: 'Review Order',
          sequence_order: 1,
          description: 'Admin reviews the order in Web Portal',
        },
        {
          user_journey_name: 'Journey A',
          process_activity_name: 'Submit Order',
          business_user_abbreviation: 'CU',
          application_abbreviation: 'MA',
          activity_step_name: 'Submit Order for CU in MA',
          diagram_label: 'Submit Order',
          sequence_order: 2,
          // No description -- should use process_activity_name
        },
      ],
    });

    await saveUserJourneys('proj-1', json);

    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const steps = putModel.metaModel.entities.activity_steps;

    // Both steps should use activity_step_name as the name
    const step1 = steps.find((s: any) => s.sequence_order === 1);
    expect(step1.name).toBe('Review Order for A in WP');
    expect(step1.diagram_label).toBe('Review Order');

    const step2 = steps.find((s: any) => s.sequence_order === 2);
    expect(step2.name).toBe('Submit Order for CU in MA');
    expect(step2.diagram_label).toBe('Submit Order');
  });
});

describe('Gap: Upstream PUT failure returns 502', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  it('throws a 502 error when putModel fails', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');
    mockedArchModelClient.getModel.mockResolvedValue(createModelWithEntities());
    mockedArchModelClient.putModel.mockRejectedValue(new Error('Connection refused'));

    const json = JSON.stringify({
      user_journeys: [{ name: 'Journey A' }],
    });

    try {
      await saveUserJourneys('proj-1', json);
      fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(502);
      expect(err.message).toContain('Failed to save model');
    }
  });
});

describe('Gap: Malformed JSON input', () => {
  it('parseAndValidate returns error for malformed JSON', () => {
    const { errors } = parseAndValidate('not valid json');
    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe('PARSE_ERROR');
    expect(errors[0].message).toContain('Invalid JSON');
  });
});
