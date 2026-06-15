/**
 * Task Group 4 Tests: Integration and Gap-Fill Tests
 * for User Journeys and Activity Steps entity types.
 *
 * Spec: 2026-04-01-user-journey-business-architecture-table-ui
 * These tests fill coverage gaps identified in the review of Task Groups 1-3.
 */

import { gridConfigs, domainGroupings } from '../config/gridConfigs';
import { validateModel } from '../utils/validation';
import { ArchitectureModel } from '../types/model';
import { emptyModel } from '../config/defaults';

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

// Common entity fixtures for validation tests
function validActivityStepFixtures() {
  return {
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
  };
}

describe('Task Group 4: Integration and Gap-Fill Tests', () => {

  // Gap 1: activity_steps sequence_order column has correct config
  it('activity_steps sequence_order column has cellType text and required false', () => {
    const config = gridConfigs.activity_steps;
    const seqCol = config.find((c) => c.field === 'sequence_order');
    expect(seqCol).toBeDefined();
    expect(seqCol!.cellType).toBe('text');
    expect(seqCol!.required).toBe(false);
    expect(seqCol!.width).toBe(100);
  });

  // Gap 2: activity_steps application_id column cross-domain FK verification
  it('activity_steps application_id has fkTarget applications (cross-domain FK)', () => {
    const config = gridConfigs.activity_steps;
    const appCol = config.find((c) => c.field === 'application_id');
    expect(appCol).toBeDefined();
    expect(appCol!.fkTarget).toBe('applications');
    expect(appCol!.cellType).toBe('fk_typeahead');
  });

  // Gap 3: domainGroupings.business has exactly 5 entries in correct order
  it('domainGroupings.business has exactly 5 entries in correct order', () => {
    expect(domainGroupings.business).toHaveLength(5);
    expect(domainGroupings.business).toEqual([
      'Users',
      'Processes',
      'Activities',
      'User Journeys',
      'Activity Steps',
    ]);
  });

  // Gap 4: sequence_order validation with value '0' (zero, not positive) produces error
  it('sequence_order value of 0 (zero) produces a validation error', () => {
    const fixtures = validActivityStepFixtures();
    const model = createTestModel({
      ...fixtures,
      activity_steps: [
        {
          id: 'as-zero',
          user_journey_id: 'uj-1',
          name: 'Step Zero',
          description: '',
          tags: '',
          sequence_order: '0' as any,
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

  // Gap 5: sequence_order validation with value '-1' (negative) produces error
  it('sequence_order value of -1 (negative) produces a validation error', () => {
    const fixtures = validActivityStepFixtures();
    const model = createTestModel({
      ...fixtures,
      activity_steps: [
        {
          id: 'as-neg',
          user_journey_id: 'uj-1',
          name: 'Step Negative',
          description: '',
          tags: '',
          sequence_order: '-1' as any,
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

  // Gap 6: sequence_order validation with value '2.5' (float) produces error
  it('sequence_order value of 2.5 (float) produces a validation error', () => {
    const fixtures = validActivityStepFixtures();
    const model = createTestModel({
      ...fixtures,
      activity_steps: [
        {
          id: 'as-float',
          user_journey_id: 'uj-1',
          name: 'Step Float',
          description: '',
          tags: '',
          sequence_order: '2.5' as any,
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
});
