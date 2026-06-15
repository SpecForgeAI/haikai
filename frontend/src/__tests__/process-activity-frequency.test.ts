/**
 * Process Activity Frequency Feature Tests
 * Tests for Task Groups 1-4 of the Process Activity Frequency Attribute specification
 *
 * This test file verifies:
 * - ProcessActivityFrequency type definition with 9 enum values
 * - ProcessActivity interface includes optional frequency field
 * - processActivityFrequencyOptions array configuration
 * - Grid configuration for frequency dropdown column
 * - JSON loading/migration preserves frequency field
 * - Backward compatibility for JSON without frequency field
 */

import { ProcessActivity, ProcessActivityFrequency, ENTITY_TYPES } from '../types/model';
import {
  processActivityFrequencyOptions,
  userInteractionLevelOptions,
} from '../config/defaults';
import { gridConfigs } from '../config/gridConfigs';
import { buildModelFromData } from '../utils/fileOperations';

// ===========================================================================
// Task Group 1: TypeScript Type Definitions Tests
// ===========================================================================

describe('Task Group 1: TypeScript Type Definitions', () => {
  describe('ProcessActivityFrequency type', () => {
    test('ProcessActivityFrequency type accepts all 9 valid enum values', () => {
      const validFrequencies: ProcessActivityFrequency[] = [
        'CONTINUOUSLY',
        'DAILY',
        'WEEKLY',
        'MONTHLY',
        'QUARTERLY',
        'SEMI-ANNUALLY',
        'ANNUALLY',
        'ADHOC',
        'OTHER',
      ];

      expect(validFrequencies).toHaveLength(9);
      // Each value should be a valid ProcessActivityFrequency
      validFrequencies.forEach((freq) => {
        const testFreq: ProcessActivityFrequency = freq;
        expect(testFreq).toBeDefined();
      });
    });

    test('ProcessActivity interface accepts optional frequency field', () => {
      // Activity without frequency - should compile and work
      const activityWithoutFrequency: ProcessActivity = {
        id: 'pa-1',
        business_process_id: 'bp-1',
        name: 'Test Activity',
        description: 'A test activity',
        sequence_order: 1,
        actor_hint: 'END_USER',
        user_interaction_level: 'MODERATE',
        tags: 'test',
      };

      expect(activityWithoutFrequency.frequency).toBeUndefined();

      // Activity with frequency - should compile and work
      const activityWithFrequency: ProcessActivity = {
        id: 'pa-2',
        business_process_id: 'bp-1',
        name: 'Test Activity 2',
        description: 'Another test activity',
        sequence_order: 2,
        frequency: 'DAILY',
        actor_hint: 'INTERNAL_SYSTEM',
        user_interaction_level: 'AUTOMATED',
        tags: 'test',
      };

      expect(activityWithFrequency.frequency).toBe('DAILY');
    });

    test('ProcessActivity interface type compatibility with existing patterns', () => {
      // Create a full ProcessActivity with all fields to verify compatibility
      const fullActivity: ProcessActivity = {
        id: 'pa-full',
        business_process_id: 'bp-1',
        name: 'Full Activity',
        description: 'Activity with all fields',
        sequence_order: 1,
        frequency: 'WEEKLY',
        actor_hint: 'END_USER',
        user_interaction_level: 'SIGNIFICANT',
        tags: 'full,test',
        valid_from: '2025-Q1',
        valid_to: '2026-Q4',
      };

      expect(fullActivity.id).toBe('pa-full');
      expect(fullActivity.frequency).toBe('WEEKLY');
      expect(fullActivity.user_interaction_level).toBe('SIGNIFICANT');
      expect(fullActivity.actor_hint).toBe('END_USER');
    });
  });

  describe('ENTITY_TYPES constant', () => {
    test('PROCESS_ACTIVITY is in ENTITY_TYPES', () => {
      expect(ENTITY_TYPES.PROCESS_ACTIVITY).toBe('PROCESS_ACTIVITY');
    });
  });
});

// ===========================================================================
// Task Group 2: Dropdown Options and Grid Configuration Tests
// ===========================================================================

describe('Task Group 2: Dropdown Options and Grid Configuration', () => {
  describe('processActivityFrequencyOptions array', () => {
    test('processActivityFrequencyOptions contains all 9 enum values', () => {
      expect(processActivityFrequencyOptions).toBeDefined();
      expect(processActivityFrequencyOptions).toHaveLength(9);
      expect(processActivityFrequencyOptions).toContain('CONTINUOUSLY');
      expect(processActivityFrequencyOptions).toContain('DAILY');
      expect(processActivityFrequencyOptions).toContain('WEEKLY');
      expect(processActivityFrequencyOptions).toContain('MONTHLY');
      expect(processActivityFrequencyOptions).toContain('QUARTERLY');
      expect(processActivityFrequencyOptions).toContain('SEMI-ANNUALLY');
      expect(processActivityFrequencyOptions).toContain('ANNUALLY');
      expect(processActivityFrequencyOptions).toContain('ADHOC');
      expect(processActivityFrequencyOptions).toContain('OTHER');
    });

    test('processActivityFrequencyOptions array order matches spec', () => {
      const expectedOrder: ProcessActivityFrequency[] = [
        'CONTINUOUSLY',
        'DAILY',
        'WEEKLY',
        'MONTHLY',
        'QUARTERLY',
        'SEMI-ANNUALLY',
        'ANNUALLY',
        'ADHOC',
        'OTHER',
      ];

      expect(processActivityFrequencyOptions).toEqual(expectedOrder);
    });
  });

  describe('process_activities grid config', () => {
    test('process_activities grid config includes frequency column', () => {
      const processActivitiesConfig = gridConfigs.process_activities;
      expect(processActivitiesConfig).toBeDefined();

      const frequencyColumn = processActivitiesConfig.find(
        (col) => col.field === 'frequency'
      );

      expect(frequencyColumn).toBeDefined();
      expect(frequencyColumn?.displayName).toBe('Frequency');
      expect(frequencyColumn?.cellType).toBe('dropdown');
      expect(frequencyColumn?.required).toBe(false);
      expect(frequencyColumn?.width).toBe(120);
      expect(frequencyColumn?.options).toEqual(processActivityFrequencyOptions);
    });

    test('frequency column is at correct index position (between description and sequence_order)', () => {
      const processActivitiesConfig = gridConfigs.process_activities;

      // Find indices of relevant columns
      const descriptionIndex = processActivitiesConfig.findIndex(
        (col) => col.field === 'description'
      );
      const frequencyIndex = processActivitiesConfig.findIndex(
        (col) => col.field === 'frequency'
      );
      const sequenceOrderIndex = processActivitiesConfig.findIndex(
        (col) => col.field === 'sequence_order'
      );

      // Frequency should be after description and before sequence_order
      expect(frequencyIndex).toBeGreaterThan(descriptionIndex);
      expect(frequencyIndex).toBeLessThan(sequenceOrderIndex);

      // Verify specific positions: description=3, frequency=4, sequence_order=5
      expect(descriptionIndex).toBe(3);
      expect(frequencyIndex).toBe(4);
      expect(sequenceOrderIndex).toBe(5);
    });
  });
});

// ===========================================================================
// Task Group 3: JSON Loading and Migration Tests
// ===========================================================================

describe('Task Group 3: JSON Loading and Migration', () => {
  describe('JSON loading with frequency field', () => {
    test('loading JSON with frequency field preserves the value', () => {
      const rawData = {
        metaModel: {
          entities: {
            business_processes: [{ id: 'bp-1', name: 'Test Process', description: '', tags: '' }],
            process_activities: [
              {
                id: 'pa-1',
                business_process_id: 'bp-1',
                name: 'Activity with Frequency',
                description: 'Test activity',
                sequence_order: 1,
                frequency: 'DAILY',
                actor_hint: 'END_USER',
                user_interaction_level: 'MODERATE',
                tags: '',
              },
            ],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(rawData);
      const activity = model.metaModel.entities.process_activities[0];

      expect(activity.frequency).toBe('DAILY');
    });

    test('loading JSON without frequency field results in undefined (backward compatibility)', () => {
      const rawData = {
        metaModel: {
          entities: {
            business_processes: [{ id: 'bp-1', name: 'Test Process', description: '', tags: '' }],
            process_activities: [
              {
                id: 'pa-1',
                business_process_id: 'bp-1',
                name: 'Activity without Frequency',
                description: 'Test activity',
                sequence_order: 1,
                actor_hint: 'END_USER',
                user_interaction_level: 'AUTOMATED',
                tags: '',
              },
            ],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(rawData);
      const activity = model.metaModel.entities.process_activities[0];

      expect(activity.frequency).toBeUndefined();
    });

    test('loading JSON with valid frequency enum value passes through correctly', () => {
      const validFrequencies: ProcessActivityFrequency[] = [
        'CONTINUOUSLY',
        'DAILY',
        'WEEKLY',
        'MONTHLY',
        'QUARTERLY',
        'SEMI-ANNUALLY',
        'ANNUALLY',
        'ADHOC',
        'OTHER',
      ];

      validFrequencies.forEach((freq, index) => {
        const rawData = {
          metaModel: {
            entities: {
              business_processes: [{ id: 'bp-1', name: 'Test Process', description: '', tags: '' }],
              process_activities: [
                {
                  id: `pa-${index}`,
                  business_process_id: 'bp-1',
                  name: `Activity ${freq}`,
                  description: '',
                  sequence_order: index,
                  frequency: freq,
                  actor_hint: 'END_USER',
                  user_interaction_level: 'AUTOMATED',
                  tags: '',
                },
              ],
            },
            relationships: {},
          },
          diagrams: [],
        };

        const model = buildModelFromData(rawData);
        const activity = model.metaModel.entities.process_activities[0];

        expect(activity.frequency).toBe(freq);
      });
    });

    test('migrateProcessActivity function returns object with frequency property', () => {
      const rawData = {
        metaModel: {
          entities: {
            business_processes: [{ id: 'bp-1', name: 'Test Process', description: '', tags: '' }],
            process_activities: [
              {
                id: 'pa-1',
                business_process_id: 'bp-1',
                name: 'Test Activity',
                description: 'Description',
                sequence_order: 1,
                frequency: 'MONTHLY',
                actor_hint: 'INTERNAL_SYSTEM',
                user_interaction_level: 'AUTOMATED',
                tags: 'test',
                valid_from: '2025-Q1',
                valid_to: '2026-Q4',
              },
            ],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(rawData);
      const activity = model.metaModel.entities.process_activities[0];

      // Verify the returned object has the frequency property
      expect('frequency' in activity).toBe(true);
      expect(activity.frequency).toBe('MONTHLY');

      // Also verify other fields are preserved
      expect(activity.id).toBe('pa-1');
      expect(activity.name).toBe('Test Activity');
      expect(activity.user_interaction_level).toBe('AUTOMATED');
    });
  });
});

// ===========================================================================
// Task Group 4: Test Review and Gap Analysis - Additional Strategic Tests
// ===========================================================================

describe('Task Group 4: Additional Strategic Tests', () => {
  describe('Integration: Frequency with other ProcessActivity fields', () => {
    test('ProcessActivity with frequency integrates with existing fields correctly', () => {
      const activity: ProcessActivity = {
        id: 'pa-integration',
        business_process_id: 'bp-1',
        name: 'Integration Test Activity',
        description: 'Testing frequency integration',
        sequence_order: 5,
        frequency: 'QUARTERLY',
        actor_hint: 'HYBRID_USER_SYSTEM',
        user_interaction_level: 'MODERATE',
        tags: 'integration,test',
        valid_from: '2025-Q1',
        valid_to: '2027-Q4',
      };

      // Verify all fields work together
      expect(activity.frequency).toBe('QUARTERLY');
      expect(activity.user_interaction_level).toBe('MODERATE');
      expect(activity.actor_hint).toBe('HYBRID_USER_SYSTEM');
      expect(activity.sequence_order).toBe(5);
      expect(activity.valid_from).toBe('2025-Q1');
    });
  });

  describe('Configuration: Grid column dropdown options', () => {
    test('frequency dropdown column uses correct options array reference', () => {
      const frequencyColumn = gridConfigs.process_activities.find(
        (col) => col.field === 'frequency'
      );

      // Options should be exactly the processActivityFrequencyOptions array
      expect(frequencyColumn?.options).toBe(processActivityFrequencyOptions);
    });

    test('userInteractionLevelOptions array is separate from frequencyOptions', () => {
      // Ensure the two arrays are independent
      expect(processActivityFrequencyOptions).not.toEqual(userInteractionLevelOptions);
      expect(processActivityFrequencyOptions.length).toBe(9);
      expect(userInteractionLevelOptions.length).toBe(4);
    });
  });

  describe('Backward compatibility: Empty model loading', () => {
    test('loading empty model does not break with missing frequency fields', () => {
      const emptyRawData = {
        metaModel: {
          entities: {
            process_activities: [],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(emptyRawData);
      expect(model.metaModel.entities.process_activities).toEqual([]);
    });

    test('loading old format JSON with is_manual/user_input_amount still works with undefined frequency', () => {
      const oldFormatData = {
        metaModel: {
          entities: {
            business_processes: [{ id: 'bp-1', name: 'Old Process', description: '', tags: '' }],
            process_activities: [
              {
                id: 'pa-old',
                business_process_id: 'bp-1',
                name: 'Old Activity',
                description: '',
                sequence_order: 1,
                is_manual: true,
                user_input_amount: 'MODERATE',
                actor_hint: 'END_USER',
                tags: '',
              },
            ],
          },
          relationships: {},
        },
        diagrams: [],
      };

      const model = buildModelFromData(oldFormatData);
      const activity = model.metaModel.entities.process_activities[0];

      // Should have migrated user_interaction_level
      expect(activity.user_interaction_level).toBe('MODERATE');
      // Frequency should be undefined (not in old format)
      expect(activity.frequency).toBeUndefined();
    });
  });

  describe('JSON serialization verification', () => {
    test('ProcessActivity with frequency serializes to JSON correctly', () => {
      const activity: ProcessActivity = {
        id: 'pa-serialize',
        business_process_id: 'bp-1',
        name: 'Serialization Test',
        description: 'Test description',
        sequence_order: 1,
        frequency: 'SEMI-ANNUALLY',
        actor_hint: 'BATCH_JOB',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      };

      const json = JSON.stringify(activity);
      const parsed = JSON.parse(json);

      expect(parsed.frequency).toBe('SEMI-ANNUALLY');
    });

    test('ProcessActivity without frequency omits field in JSON', () => {
      const activity: ProcessActivity = {
        id: 'pa-no-freq',
        business_process_id: 'bp-1',
        name: 'No Frequency Test',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'MINIMAL',
        tags: '',
      };

      const json = JSON.stringify(activity);
      const parsed = JSON.parse(json);

      // undefined values are omitted by JSON.stringify
      expect('frequency' in parsed).toBe(false);
    });
  });
});
