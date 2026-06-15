/**
 * Task Group 3 Tests: Validation Registration and sequence_order Check
 * for User Journeys and Activity Steps entity types.
 *
 * Spec: 2026-04-01-user-journey-business-architecture-table-ui
 * FR5: Validation Registration
 * FR6: Standard Grid Interactions (validation aspect)
 */

import { validateModel } from '../utils/validation';
import { ArchitectureModel } from '../types/model';
import { emptyModel } from '../config/defaults';

/**
 * Creates a minimal ArchitectureModel with the specified entities merged in.
 * Uses the emptyModel as a base and overrides entity arrays as needed.
 */
function createTestModel(overrides: Record<string, any[]>): ArchitectureModel {
  return {
    ...emptyModel,
    metaModel: {
      ...emptyModel.metaModel,
      entities: {
        ...emptyModel.metaModel.entities,
        ...overrides,
      },
    },
  };
}

describe('Task Group 3: Validation for User Journeys and Activity Steps', () => {

  // Test 1: user_journeys entity with empty name produces a validation error
  it('user_journeys entity with empty name produces a required-field validation error', () => {
    const model = createTestModel({
      user_journeys: [
        {
          id: 'uj-1',
          name: '',
          description: 'A test journey',
          tags: '',
          primary_business_user_id: '',
          parent_business_process_id: '',
        },
      ],
    });

    const errors = validateModel(model);
    const nameErrors = errors.filter(
      (e) => e.entityType === 'user_journeys' && e.field === 'name' && e.type === 'required'
    );
    expect(nameErrors.length).toBeGreaterThanOrEqual(1);
  });

  // Test 2: user_journeys entity with valid name and optional FK fields left empty produces NO validation errors
  it('user_journeys entity with valid name and empty optional FK fields produces no errors', () => {
    const model = createTestModel({
      user_journeys: [
        {
          id: 'uj-2',
          name: 'Checkout Flow',
          description: 'User checkout flow',
          tags: '',
          primary_business_user_id: '',
          parent_business_process_id: '',
        },
      ],
    });

    const errors = validateModel(model);
    const ujErrors = errors.filter((e) => e.entityType === 'user_journeys');
    expect(ujErrors).toHaveLength(0);
  });

  // Test 3: activity_steps entity missing required FK user_journey_id produces a validation error
  it('activity_steps entity missing required FK user_journey_id produces a validation error', () => {
    const model = createTestModel({
      user_journeys: [
        { id: 'uj-1', name: 'Journey', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity', description: '', tags: '', actor_hint: 'END_USER', user_interaction_level: 'MODERATE' },
      ],
      business_users: [
        { id: 'bu-1', name: 'User', description: '', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'App', description: '', app_type: '', status: '', tags: '' },
      ],
      activity_steps: [
        {
          id: 'as-1',
          user_journey_id: '',  // Missing required FK
          name: 'Step 1',
          description: '',
          tags: '',
          sequence_order: undefined,
          process_activity_id: 'pa-1',
          business_user_id: 'bu-1',
          application_id: 'app-1',
        },
      ],
    });

    const errors = validateModel(model);
    const ujIdErrors = errors.filter(
      (e) => e.entityType === 'activity_steps' && e.field === 'user_journey_id' && e.type === 'required'
    );
    expect(ujIdErrors.length).toBeGreaterThanOrEqual(1);
  });

  // Test 4: activity_steps entity missing required FK application_id produces a validation error
  it('activity_steps entity missing required FK application_id produces a validation error', () => {
    const model = createTestModel({
      user_journeys: [
        { id: 'uj-1', name: 'Journey', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity', description: '', tags: '', actor_hint: 'END_USER', user_interaction_level: 'MODERATE' },
      ],
      business_users: [
        { id: 'bu-1', name: 'User', description: '', tags: '' },
      ],
      activity_steps: [
        {
          id: 'as-2',
          user_journey_id: 'uj-1',
          name: 'Step 2',
          description: '',
          tags: '',
          sequence_order: undefined,
          process_activity_id: 'pa-1',
          business_user_id: 'bu-1',
          application_id: '',  // Missing required FK
        },
      ],
    });

    const errors = validateModel(model);
    const appIdErrors = errors.filter(
      (e) => e.entityType === 'activity_steps' && e.field === 'application_id' && e.type === 'required'
    );
    expect(appIdErrors.length).toBeGreaterThanOrEqual(1);
  });

  // Test 5: activity_steps entity with sequence_order set to 'abc' (non-numeric) produces a validation error
  it('activity_steps entity with non-numeric sequence_order produces a validation error', () => {
    const model = createTestModel({
      user_journeys: [
        { id: 'uj-1', name: 'Journey', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity', description: '', tags: '', actor_hint: 'END_USER', user_interaction_level: 'MODERATE' },
      ],
      business_users: [
        { id: 'bu-1', name: 'User', description: '', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'App', description: '', app_type: '', status: '', tags: '' },
      ],
      activity_steps: [
        {
          id: 'as-3',
          user_journey_id: 'uj-1',
          name: 'Step 3',
          description: '',
          tags: '',
          sequence_order: 'abc' as any,  // Invalid non-numeric value
          process_activity_id: 'pa-1',
          business_user_id: 'bu-1',
          application_id: 'app-1',
        },
      ],
    });

    const errors = validateModel(model);
    const seqErrors = errors.filter(
      (e) => e.entityType === 'activity_steps' && e.field === 'sequence_order'
    );
    expect(seqErrors.length).toBeGreaterThanOrEqual(1);
  });

  // Test 6: activity_steps entity with valid positive integer sequence_order produces no sequence_order error
  it('activity_steps entity with valid positive integer sequence_order produces no sequence_order error', () => {
    const model = createTestModel({
      user_journeys: [
        { id: 'uj-1', name: 'Journey', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity', description: '', tags: '', actor_hint: 'END_USER', user_interaction_level: 'MODERATE' },
      ],
      business_users: [
        { id: 'bu-1', name: 'User', description: '', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'App', description: '', app_type: '', status: '', tags: '' },
      ],
      activity_steps: [
        {
          id: 'as-4',
          user_journey_id: 'uj-1',
          name: 'Step 4',
          description: '',
          tags: '',
          sequence_order: '3' as any,  // Valid positive integer as string
          process_activity_id: 'pa-1',
          business_user_id: 'bu-1',
          application_id: 'app-1',
        },
      ],
    });

    const errors = validateModel(model);
    const seqErrors = errors.filter(
      (e) => e.entityType === 'activity_steps' && e.field === 'sequence_order'
    );
    expect(seqErrors).toHaveLength(0);
  });
});
