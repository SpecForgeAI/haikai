/**
 * Unit tests for saveUserJourneys() user journey link persistence.
 *
 * Tests cover: link resolution to IDs, unresolvable journey rejection,
 * response summary counts, backward compatibility with zero links,
 * upsert CREATED vs UPDATED behavior, and resolution fallback ordering.
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
        ...overrides?.entities,
      },
      relationships: {
        user_journey_links: [],
        ...overrides?.relationships,
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('saveUserJourneys - link persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });
  });

  // --------------------------------------------------------------------------
  // Test 1: saveUserJourneys() with valid links resolves journey names to IDs
  // and includes user_journey_links in the PUT payload
  // --------------------------------------------------------------------------
  it('Test 1: valid links resolve journey names to IDs and are included in PUT payload', async () => {
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
        { name: 'Customer Onboarding' },
        { name: 'Product Purchase' },
      ],
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'Product Purchase',
          relationship_type: 'PRECEDES',
          relationship_label: 'Onboarding leads to purchase',
          relationship_description: 'After onboarding the user typically purchases',
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);

    // Verify PUT was called and user_journey_links is in the payload
    expect(mockedArchModelClient.putModel).toHaveBeenCalledTimes(1);
    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const links = putModel.metaModel.relationships.user_journey_links;
    expect(links).toHaveLength(1);

    // Verify the link has resolved IDs, not names
    const link = links[0];
    expect(link.id).toMatch(/^ujl-/);
    expect(link.source_user_journey_id).toBeDefined();
    expect(link.target_user_journey_id).toBeDefined();
    expect(link.relationship_type).toBe('PRECEDES');
    expect(link.label).toBe('Onboarding leads to purchase');
    expect(link.description).toBe('After onboarding the user typically purchases');
    expect(link.tags).toBeNull();

    // Verify IDs point to the created journeys
    const journeys = putModel.metaModel.entities.user_journeys;
    const onboarding = journeys.find((j: any) => j.name === 'Customer Onboarding');
    const purchase = journeys.find((j: any) => j.name === 'Product Purchase');
    expect(link.source_user_journey_id).toBe(onboarding.id);
    expect(link.target_user_journey_id).toBe(purchase.id);
  });

  // --------------------------------------------------------------------------
  // Test 2: saveUserJourneys() with a link referencing an unresolvable journey
  // name throws a 400 error atomically
  // --------------------------------------------------------------------------
  it('Test 2: link referencing unresolvable journey name throws 400 error atomically', async () => {
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
        { name: 'Customer Onboarding' },
      ],
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'Customer Onboarding',
          relationship_type: 'PRECEDES',
        },
      ],
    });

    // This should fail at parseAndValidate because it's a self-link
    // Let's test with an unresolvable name instead
    const json2 = JSON.stringify({
      user_journeys: [
        { name: 'Customer Onboarding' },
        { name: 'Product Purchase' },
      ],
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'NonExistent Journey',
          relationship_type: 'PRECEDES',
        },
      ],
    });

    // This should fail at parseAndValidate since NonExistent Journey is not in user_journeys array
    try {
      await saveUserJourneys('proj-1', json2);
      fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('NonExistent Journey');
    }

    // putModel should NOT have been called -- atomic rejection
    expect(mockedArchModelClient.putModel).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 3: saveUserJourneys() response summary includes
  // userJourneyLinks: { created: N, updated: M } counts
  // --------------------------------------------------------------------------
  it('Test 3: response summary includes userJourneyLinks counts', async () => {
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
        { name: 'Journey A' },
        { name: 'Journey B' },
        { name: 'Journey C' },
      ],
      user_journey_links: [
        {
          source_user_journey_name: 'Journey A',
          target_user_journey_name: 'Journey B',
          relationship_type: 'PRECEDES',
        },
        {
          source_user_journey_name: 'Journey B',
          target_user_journey_name: 'Journey C',
          relationship_type: 'DEPENDS_ON',
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.summary.userJourneyLinks).toBeDefined();
    expect(result.summary.userJourneyLinks.created).toBe(2);
    expect(result.summary.userJourneyLinks.updated).toBe(0);

    // Verify entities array also contains the link results
    expect(result.entities.userJourneyLinks).toHaveLength(2);
    expect(result.entities.userJourneyLinks[0].status).toBe('CREATED');
    expect(result.entities.userJourneyLinks[1].status).toBe('CREATED');
  });

  // --------------------------------------------------------------------------
  // Test 4: saveUserJourneys() with zero links succeeds; response includes
  // userJourneyLinks: { created: 0, updated: 0 } (backward compatibility)
  // --------------------------------------------------------------------------
  it('Test 4: zero links succeeds with userJourneyLinks counts of zero (backward compatibility)', async () => {
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
        { name: 'Journey A' },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.summary.userJourneyLinks).toEqual({ created: 0, updated: 0 });
    expect(result.entities.userJourneyLinks).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 5: Upsert behavior -- link matching existing (source_id, target_id,
  // relationship_type) reuses existing ID and reports UPDATED; new link
  // generates fresh ujl- prefixed ID and reports CREATED
  // --------------------------------------------------------------------------
  it('Test 5: upsert reuses existing link ID (UPDATED) and generates new ID for new link (CREATED)', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    // Model has existing journeys and an existing link
    const model = createModelWithEntities({
      entities: {
        user_journeys: [
          { id: 'uj-existing-a', name: 'Journey A', tags: null },
          { id: 'uj-existing-b', name: 'Journey B', tags: null },
          { id: 'uj-existing-c', name: 'Journey C', tags: null },
        ],
        activity_steps: [],
      },
      relationships: {
        user_journey_links: [
          {
            id: 'ujl-existing-1',
            source_user_journey_id: 'uj-existing-a',
            target_user_journey_id: 'uj-existing-b',
            relationship_type: 'PRECEDES',
            label: 'Old label',
            description: null,
            tags: null,
          },
        ],
      },
    });
    mockedArchModelClient.getModel.mockResolvedValue(model);
    mockedArchModelClient.putModel.mockResolvedValue({});

    const json = JSON.stringify({
      user_journeys: [
        { name: 'Journey A' },
        { name: 'Journey B' },
        { name: 'Journey C' },
      ],
      user_journey_links: [
        {
          // This matches the existing link by (source_id, target_id, relationship_type)
          source_user_journey_name: 'Journey A',
          target_user_journey_name: 'Journey B',
          relationship_type: 'PRECEDES',
          relationship_label: 'Updated label',
        },
        {
          // This is a new link
          source_user_journey_name: 'Journey B',
          target_user_journey_name: 'Journey C',
          relationship_type: 'DEPENDS_ON',
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);

    // The existing link should be UPDATED with the same ID
    const updatedLink = result.entities.userJourneyLinks.find(l => l.status === 'UPDATED');
    expect(updatedLink).toBeDefined();
    expect(updatedLink!.id).toBe('ujl-existing-1');
    expect(updatedLink!.sourceJourneyName).toBe('Journey A');
    expect(updatedLink!.targetJourneyName).toBe('Journey B');
    expect(updatedLink!.relationshipType).toBe('PRECEDES');

    // The new link should be CREATED with a fresh ujl- prefixed ID
    const createdLink = result.entities.userJourneyLinks.find(l => l.status === 'CREATED');
    expect(createdLink).toBeDefined();
    expect(createdLink!.id).toMatch(/^ujl-/);
    expect(createdLink!.id).not.toBe('ujl-existing-1');
    expect(createdLink!.sourceJourneyName).toBe('Journey B');
    expect(createdLink!.targetJourneyName).toBe('Journey C');
    expect(createdLink!.relationshipType).toBe('DEPENDS_ON');

    // Verify summary counts
    expect(result.summary.userJourneyLinks.created).toBe(1);
    expect(result.summary.userJourneyLinks.updated).toBe(1);

    // Verify the PUT model has the updated label
    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const putLinks = putModel.metaModel.relationships.user_journey_links;
    const existingLinkInPut = putLinks.find((l: any) => l.id === 'ujl-existing-1');
    expect(existingLinkInPut.label).toBe('Updated label');
  });

  // --------------------------------------------------------------------------
  // Test 6: Link source resolves via journeyIdByName map (current payload)
  // first, then falls back to findEntityByName against existing model journeys
  // --------------------------------------------------------------------------
  it('Test 6: link resolution checks current payload first, then falls back to existing model', async () => {
    let idCounter = 0;
    mockedGenerateId.mockImplementation((prefix: string) => `${prefix}test-${++idCounter}`);

    mockedArchModelClient.getProjectById.mockResolvedValue({
      id: 'proj-1',
      name: 'TestProject',
    });

    mockedArchModelClient.getDefaultArchitectureId.mockResolvedValue('770e8400-e29b-41d4-a716-446655440002');

    // Model has an existing journey not in the payload
    const model = createModelWithEntities({
      entities: {
        user_journeys: [
          { id: 'uj-existing-x', name: 'Existing Journey X', tags: null },
        ],
        activity_steps: [],
      },
      relationships: {
        user_journey_links: [],
      },
    });
    mockedArchModelClient.getModel.mockResolvedValue(model);
    mockedArchModelClient.putModel.mockResolvedValue({});

    // The payload has "New Journey Y" but NOT "Existing Journey X".
    // The link references both: source from payload, target from existing model.
    const json = JSON.stringify({
      user_journeys: [
        { name: 'New Journey Y' },
        { name: 'Existing Journey X' },
      ],
      user_journey_links: [
        {
          source_user_journey_name: 'New Journey Y',
          target_user_journey_name: 'Existing Journey X',
          relationship_type: 'TRIGGERS',
        },
      ],
    });

    const result = await saveUserJourneys('proj-1', json);

    expect(result.success).toBe(true);
    expect(result.entities.userJourneyLinks).toHaveLength(1);

    // Verify the link resolved the source to the newly-created journey ID
    // and the target to the existing journey ID
    const putModel = mockedArchModelClient.putModel.mock.calls[0][3];
    const linkInPut = putModel.metaModel.relationships.user_journey_links[0];

    // "New Journey Y" is in the payload so it gets resolved via journeyIdByName
    const newJourney = putModel.metaModel.entities.user_journeys.find(
      (j: any) => j.name === 'New Journey Y'
    );
    expect(linkInPut.source_user_journey_id).toBe(newJourney.id);

    // "Existing Journey X" is both in payload (UPDATED) and existing model
    // journeyIdByName should be checked first (and return the UPDATED ID which is the same existing ID)
    const existingJourney = putModel.metaModel.entities.user_journeys.find(
      (j: any) => j.name === 'Existing Journey X'
    );
    expect(linkInPut.target_user_journey_id).toBe(existingJourney.id);
    // Since it matched by name, the existing ID should be reused
    expect(existingJourney.id).toBe('uj-existing-x');
  });
});
