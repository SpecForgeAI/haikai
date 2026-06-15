/**
 * Process Activities Feature Tests
 * Tests for the Process Activities feature (updated for user_interaction_level)
 *
 * NOTE: This test file has been updated to use the new user_interaction_level
 * field which replaces the old is_manual + user_input_amount approach.
 */

import { ProcessActivity, ActorHint, UserInteractionLevel, ENTITY_TYPES, ArchitectureModel } from '../types/model';
import { emptyModel, actorHintOptions, userInteractionLevelOptions, entityColors, processActivityColors, getProcessActivityDefaultFill } from '../config/defaults';
import { gridConfigs, tabToEntityType, domainGroupings, entityTabNames } from '../config/gridConfigs';
import {
  validateModel,
  validateScopedUniqueNames,
  formatScopedDuplicateNameErrorMessage
} from '../utils/validation';
import { getEntityTypeConstant, getPaletteSections } from '../utils/paletteData';
import { findProcessActivities } from '../utils/compoundLayout';
import { getNodeFillColor, supportsChildNodes, getParentEntityType, isChildEntityType, getEntityLabel } from '../utils/rendering';

// ===========================================================================
// Task Group 1: Meta-model Schema Layer Tests
// ===========================================================================

describe('Task Group 1: Meta-model Schema Layer', () => {
  describe('ProcessActivity interface', () => {
    test('ProcessActivity has all required fields', () => {
      const activity: ProcessActivity = {
        id: 'pa-1',
        business_process_id: 'bp-1',
        name: 'Test Activity',
        description: 'A test activity',
        sequence_order: 1,
        actor_hint: 'END_USER',
        user_interaction_level: 'MODERATE',
        tags: 'test,demo',
        valid_from: '2025-Q1',
        valid_to: '2026-Q4',
      };

      expect(activity.id).toBe('pa-1');
      expect(activity.business_process_id).toBe('bp-1');
      expect(activity.name).toBe('Test Activity');
      expect(activity.actor_hint).toBe('END_USER');
      expect(activity.user_interaction_level).toBe('MODERATE');
    });

    test('ActorHint type includes all expected values', () => {
      const hints: ActorHint[] = [
        'END_USER',
        'EXTERNAL_USER',
        'INTERNAL_SYSTEM',
        'EXTERNAL_SYSTEM',
        'HYBRID_USER_SYSTEM',
        'BATCH_JOB',
        'BOT_OR_RPA',
        'OTHER',
      ];

      expect(hints).toHaveLength(8);
      expect(actorHintOptions).toEqual(hints);
    });

    test('UserInteractionLevel type includes all expected values', () => {
      const levels: UserInteractionLevel[] = ['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT'];

      expect(levels).toHaveLength(4);
      expect(userInteractionLevelOptions).toEqual(levels);
    });
  });

  describe('ENTITY_TYPES enum', () => {
    test('PROCESS_ACTIVITY is in ENTITY_TYPES', () => {
      expect(ENTITY_TYPES.PROCESS_ACTIVITY).toBe('PROCESS_ACTIVITY');
    });
  });

  describe('emptyModel structure', () => {
    test('emptyModel includes process_activities array', () => {
      expect(emptyModel.metaModel.entities.process_activities).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.process_activities)).toBe(true);
      expect(emptyModel.metaModel.entities.process_activities).toHaveLength(0);
    });
  });

  describe('Option arrays', () => {
    test('actorHintOptions is exported and has correct values', () => {
      expect(actorHintOptions).toBeDefined();
      expect(actorHintOptions).toContain('END_USER');
      expect(actorHintOptions).toContain('BOT_OR_RPA');
    });

    test('userInteractionLevelOptions is exported and has correct values', () => {
      expect(userInteractionLevelOptions).toBeDefined();
      expect(userInteractionLevelOptions).toContain('AUTOMATED');
      expect(userInteractionLevelOptions).toContain('SIGNIFICANT');
    });
  });
});

// ===========================================================================
// Task Group 2: Validation Layer Tests
// ===========================================================================

describe('Task Group 2: Validation Layer', () => {
  const createTestModel = (activities: ProcessActivity[]): ArchitectureModel => ({
    ...emptyModel,
    metaModel: {
      ...emptyModel.metaModel,
      entities: {
        ...emptyModel.metaModel.entities,
        business_processes: [
          { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
          { id: 'bp-2', name: 'Process 2', description: '', tags: '' },
        ],
        process_activities: activities,
      },
    },
  });

  describe('FK validation', () => {
    test('validates business_process_id FK exists', () => {
      const model = createTestModel([
        {
          id: 'pa-1',
          business_process_id: 'invalid-bp',
          name: 'Activity 1',
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'MINIMAL',
          tags: '',
        },
      ]);

      const errors = validateModel(model);
      const fkError = errors.find(
        (e) => e.entityId === 'pa-1' && e.field === 'business_process_id'
      );

      expect(fkError).toBeDefined();
      expect(fkError?.type).toBe('invalid_fk');
    });

    test('passes FK validation for valid business_process_id', () => {
      const model = createTestModel([
        {
          id: 'pa-1',
          business_process_id: 'bp-1',
          name: 'Activity 1',
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'MINIMAL',
          tags: '',
        },
      ]);

      const errors = validateModel(model);
      const fkError = errors.find(
        (e) => e.entityId === 'pa-1' && e.field === 'business_process_id'
      );

      expect(fkError).toBeUndefined();
    });
  });

  describe('Name required validation', () => {
    test('validates name is non-empty', () => {
      const model = createTestModel([
        {
          id: 'pa-1',
          business_process_id: 'bp-1',
          name: '',
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'AUTOMATED',
          tags: '',
        },
      ]);

      const errors = validateModel(model);
      const nameError = errors.find((e) => e.entityId === 'pa-1' && e.field === 'name');

      expect(nameError).toBeDefined();
      expect(nameError?.type).toBe('required');
    });
  });

  describe('Scoped name uniqueness validation', () => {
    test('allows same name in different business processes', () => {
      const activities: ProcessActivity[] = [
        {
          id: 'pa-1',
          business_process_id: 'bp-1',
          name: 'Review',
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'MINIMAL',
          tags: '',
        },
        {
          id: 'pa-2',
          business_process_id: 'bp-2',
          name: 'Review', // Same name, different process - allowed
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'MINIMAL',
          tags: '',
        },
      ];

      const errors = validateScopedUniqueNames(activities);
      expect(errors).toHaveLength(0);
    });

    test('rejects duplicate names within same business process', () => {
      const activities: ProcessActivity[] = [
        {
          id: 'pa-1',
          business_process_id: 'bp-1',
          name: 'Review',
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'MINIMAL',
          tags: '',
        },
        {
          id: 'pa-2',
          business_process_id: 'bp-1',
          name: 'Review', // Duplicate in same process - not allowed
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: 'MINIMAL',
          tags: '',
        },
      ];

      const errors = validateScopedUniqueNames(activities);
      expect(errors).toHaveLength(2); // Both activities get flagged
      expect(errors[0].type).toBe('duplicate_name');
    });
  });

  describe('Error message formatting', () => {
    test('formatScopedDuplicateNameErrorMessage', () => {
      const message = formatScopedDuplicateNameErrorMessage('process_activities', 'Duplicate Activity');
      expect(message).toContain("PROCESS_ACTIVITY ['Duplicate Activity']");
      expect(message).toContain('duplicate name within the same Business Process');
    });
  });
});

// ===========================================================================
// Task Group 3: Meta-model UI Layer Tests
// ===========================================================================

describe('Task Group 3: Meta-model UI Layer', () => {
  describe('Header bar domain groupings', () => {
    test('domainGroupings includes Activities in business domain', () => {
      expect(domainGroupings.business).toContain('Activities');
    });

    test('entityTabNames includes Activities', () => {
      expect(entityTabNames).toContain('Activities');
    });

    test('tabToEntityType maps Activities to process_activities', () => {
      expect(tabToEntityType['Activities']).toBe('process_activities');
    });
  });

  describe('Grid configuration', () => {
    test('process_activities grid config exists', () => {
      expect(gridConfigs.process_activities).toBeDefined();
    });

    test('process_activities grid has required columns', () => {
      const columns = gridConfigs.process_activities;
      const fieldNames = columns.map((c) => c.field);

      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('business_process_id');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('description');
      expect(fieldNames).toContain('sequence_order');
      expect(fieldNames).toContain('actor_hint');
      expect(fieldNames).toContain('user_interaction_level');
    });

    test('business_process_id column is FK typeahead to business_processes', () => {
      const columns = gridConfigs.process_activities;
      const bpColumn = columns.find((c) => c.field === 'business_process_id');

      expect(bpColumn?.cellType).toBe('fk_typeahead');
      expect(bpColumn?.fkTarget).toBe('business_processes');
    });

    test('actor_hint column is dropdown with correct options', () => {
      const columns = gridConfigs.process_activities;
      const actorColumn = columns.find((c) => c.field === 'actor_hint');

      expect(actorColumn?.cellType).toBe('dropdown');
      expect(actorColumn?.options).toEqual(actorHintOptions);
    });

    test('user_interaction_level column is dropdown with correct options', () => {
      const columns = gridConfigs.process_activities;
      const inputColumn = columns.find((c) => c.field === 'user_interaction_level');

      expect(inputColumn?.cellType).toBe('dropdown');
      expect(inputColumn?.options).toEqual(userInteractionLevelOptions);
    });
  });
});

// ===========================================================================
// Task Group 4: Diagram Node Type Layer Tests
// ===========================================================================

describe('Task Group 4: Diagram Node Type Layer', () => {
  describe('Entity colors', () => {
    test('PROCESS_ACTIVITY has default entity colors', () => {
      expect(entityColors.PROCESS_ACTIVITY).toBeDefined();
      expect(entityColors.PROCESS_ACTIVITY.background).toBe('#a5d6a7');
      expect(entityColors.PROCESS_ACTIVITY.border).toBe('#616161');
    });
  });

  describe('Process activity colors by user_interaction_level', () => {
    test('processActivityColors has all user_interaction_level values', () => {
      expect(processActivityColors.AUTOMATED).toBe('#a5d6a7');
      expect(processActivityColors.MINIMAL).toBe('#c8e6c9');
      expect(processActivityColors.MODERATE).toBe('#fff9c4');
      expect(processActivityColors.SIGNIFICANT).toBe('#ffcdd2');
    });
  });

  describe('getProcessActivityDefaultFill helper', () => {
    test('returns correct color for AUTOMATED', () => {
      const activity: ProcessActivity = {
        id: 'pa-1',
        business_process_id: 'bp-1',
        name: 'Test',
        description: '',
        actor_hint: 'INTERNAL_SYSTEM',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      };

      expect(getProcessActivityDefaultFill(activity)).toBe('#a5d6a7');
    });

    test('returns correct color for SIGNIFICANT', () => {
      const activity: ProcessActivity = {
        id: 'pa-2',
        business_process_id: 'bp-1',
        name: 'Test',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'SIGNIFICANT',
        tags: '',
      };

      expect(getProcessActivityDefaultFill(activity)).toBe('#ffcdd2');
    });
  });

  describe('Rendering utilities', () => {
    test('supportsChildNodes returns true for BUSINESS_PROCESS', () => {
      expect(supportsChildNodes(ENTITY_TYPES.BUSINESS_PROCESS)).toBe(true);
    });

    test('getParentEntityType returns BUSINESS_PROCESS for PROCESS_ACTIVITY', () => {
      expect(getParentEntityType(ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(ENTITY_TYPES.BUSINESS_PROCESS);
    });

    test('isChildEntityType returns true for PROCESS_ACTIVITY', () => {
      expect(isChildEntityType(ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(true);
    });
  });
});

// ===========================================================================
// Task Group 5: Palette Integration Layer Tests
// ===========================================================================

describe('Task Group 5: Palette Integration Layer', () => {
  describe('Palette sections', () => {
    test('getEntityTypeConstant maps process_activities', () => {
      expect(getEntityTypeConstant('process_activities')).toBe(ENTITY_TYPES.PROCESS_ACTIVITY);
    });

    test('getPaletteSections includes Process Activities section', () => {
      const metaModel = emptyModel.metaModel;
      const sections = getPaletteSections(metaModel, '');
      const paSection = sections.find((s) => s.id === 'process_activities');

      expect(paSection).toBeDefined();
      expect(paSection?.label).toBe('Process Activities');
      expect(paSection?.type).toBe('entity');
    });
  });

  describe('findProcessActivities helper', () => {
    test('finds activities for a given business process', () => {
      const metaModel = {
        ...emptyModel.metaModel,
        entities: {
          ...emptyModel.metaModel.entities,
          process_activities: [
            {
              id: 'pa-1',
              business_process_id: 'bp-1',
              name: 'Activity 1',
              description: '',
              actor_hint: 'END_USER' as ActorHint,
              user_interaction_level: 'MINIMAL' as UserInteractionLevel,
              tags: '',
            },
            {
              id: 'pa-2',
              business_process_id: 'bp-1',
              name: 'Activity 2',
              description: '',
              actor_hint: 'END_USER' as ActorHint,
              user_interaction_level: 'MODERATE' as UserInteractionLevel,
              tags: '',
            },
            {
              id: 'pa-3',
              business_process_id: 'bp-2',
              name: 'Activity 3',
              description: '',
              actor_hint: 'INTERNAL_SYSTEM' as ActorHint,
              user_interaction_level: 'AUTOMATED' as UserInteractionLevel,
              tags: '',
            },
          ],
        },
      };

      const activities = findProcessActivities(metaModel, 'bp-1');
      expect(activities).toHaveLength(2);
      expect(activities[0].id).toBe('pa-1');
      expect(activities[1].id).toBe('pa-2');
    });

    test('returns empty array for process with no activities', () => {
      const metaModel = {
        ...emptyModel.metaModel,
        entities: {
          ...emptyModel.metaModel.entities,
          process_activities: [],
        },
      };

      const activities = findProcessActivities(metaModel, 'bp-1');
      expect(activities).toHaveLength(0);
    });
  });
});

// ===========================================================================
// Task Group 6: Inspector and JSON Layer Tests
// ===========================================================================

describe('Task Group 6: Inspector and JSON Layer', () => {
  describe('Entity label resolution', () => {
    test('getEntityLabel resolves PROCESS_ACTIVITY name', () => {
      const model: ArchitectureModel = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            process_activities: [
              {
                id: 'pa-1',
                business_process_id: 'bp-1',
                name: 'Review Application',
                description: '',
                actor_hint: 'END_USER',
                user_interaction_level: 'MODERATE',
                tags: '',
              },
            ],
          },
        },
      };

      const label = getEntityLabel(ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1', model);
      expect(label).toBe('Review Application');
    });
  });

  describe('JSON structure validation', () => {
    test('validateModel handles process_activities array', () => {
      const model: ArchitectureModel = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            business_processes: [
              { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
            ],
            process_activities: [
              {
                id: 'pa-1',
                business_process_id: 'bp-1',
                name: 'Activity 1',
                description: '',
                actor_hint: 'END_USER',
                user_interaction_level: 'MINIMAL',
                tags: '',
              },
            ],
          },
        },
      };

      const errors = validateModel(model);
      const paErrors = errors.filter((e) => e.entityType === 'process_activities');

      // Should have no errors for valid data
      expect(paErrors.filter(e => e.type !== 'duplicate_name')).toHaveLength(0);
    });
  });
});

// ===========================================================================
// Task Group 7: Integration Tests
// ===========================================================================

describe('Task Group 7: End-to-End Integration', () => {
  test('full workflow: create activity with all fields and validate', () => {
    const model: ArchitectureModel = {
      ...emptyModel,
      metaModel: {
        ...emptyModel.metaModel,
        entities: {
          ...emptyModel.metaModel.entities,
          business_processes: [
            { id: 'bp-onboarding', name: 'Customer Onboarding', description: '', tags: '' },
          ],
          process_activities: [
            {
              id: 'pa-review',
              business_process_id: 'bp-onboarding',
              name: 'Review Application Form',
              description: 'Customer fills out application form and submits',
              sequence_order: 1,
              actor_hint: 'END_USER',
              user_interaction_level: 'SIGNIFICANT',
              tags: 'customer-facing,critical',
              valid_from: '2025-Q1',
            },
            {
              id: 'pa-verify',
              business_process_id: 'bp-onboarding',
              name: 'Verify Identity',
              description: 'System performs automated identity verification',
              sequence_order: 2,
              actor_hint: 'INTERNAL_SYSTEM',
              user_interaction_level: 'AUTOMATED',
              tags: 'automated,compliance',
            },
            {
              id: 'pa-approve',
              business_process_id: 'bp-onboarding',
              name: 'Final Approval',
              description: 'Manager reviews and approves application',
              sequence_order: 3,
              actor_hint: 'END_USER',
              user_interaction_level: 'MINIMAL',
              tags: 'approval,manual-review',
            },
          ],
        },
      },
    };

    // Validate the model
    const errors = validateModel(model);

    // Filter to only process_activities errors that are not expected duplicates
    const criticalErrors = errors.filter(
      (e) => e.entityType === 'process_activities' && e.type !== 'duplicate_name'
    );

    expect(criticalErrors).toHaveLength(0);

    // Verify entity type constant mapping
    expect(getEntityTypeConstant('process_activities')).toBe(ENTITY_TYPES.PROCESS_ACTIVITY);

    // Verify findProcessActivities helper
    const activities = findProcessActivities(model.metaModel, 'bp-onboarding');
    expect(activities).toHaveLength(3);

    // Verify colors based on user_interaction_level
    expect(getProcessActivityDefaultFill(activities[0])).toBe('#ffcdd2'); // SIGNIFICANT
    expect(getProcessActivityDefaultFill(activities[1])).toBe('#a5d6a7'); // AUTOMATED
    expect(getProcessActivityDefaultFill(activities[2])).toBe('#c8e6c9'); // MINIMAL

    // Verify parent-child relationship constants
    expect(supportsChildNodes(ENTITY_TYPES.BUSINESS_PROCESS)).toBe(true);
    expect(getParentEntityType(ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(ENTITY_TYPES.BUSINESS_PROCESS);
  });
});
