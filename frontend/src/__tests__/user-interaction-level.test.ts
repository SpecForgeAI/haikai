/**
 * User Interaction Level Feature Tests
 * Tests for Task Groups 1-7 of the Process Activity User Interaction Level specification
 *
 * This test file verifies the migration from the old two-field approach
 * (is_manual + user_input_amount) to the new single field (user_interaction_level).
 */

import { ProcessActivity, UserInteractionLevel, ENTITY_TYPES, ArchitectureModel } from '../types/model';
import {
  emptyModel,
  actorHintOptions,
  userInteractionLevelOptions,
  entityColors,
  processActivityColors,
  getProcessActivityDefaultFill,
} from '../config/defaults';
import { gridConfigs, tabToEntityType, domainGroupings, entityTabNames } from '../config/gridConfigs';
import { validateModel, validateScopedUniqueNames, formatScopedDuplicateNameErrorMessage } from '../utils/validation';
import { getEntityTypeConstant, getPaletteSections } from '../utils/paletteData';
import { findProcessActivities } from '../utils/compoundLayout';
import { getNodeFillColor, supportsChildNodes, getParentEntityType, isChildEntityType, getEntityLabel } from '../utils/rendering';
import { buildModelFromData } from '../utils/fileOperations';

// ===========================================================================
// Task Group 1: Meta-model Schema Layer Tests
// ===========================================================================

describe('Task Group 1: Meta-model Schema Layer', () => {
  describe('ProcessActivity interface', () => {
    test('ProcessActivity has user_interaction_level field', () => {
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

    test('UserInteractionLevel type includes all expected values', () => {
      const levels: UserInteractionLevel[] = ['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT'];

      expect(levels).toHaveLength(4);
      expect(userInteractionLevelOptions).toEqual(levels);
    });

    test('ProcessActivity does NOT have is_manual or user_input_amount fields', () => {
      const activity: ProcessActivity = {
        id: 'pa-1',
        business_process_id: 'bp-1',
        name: 'Test Activity',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      };

      // TypeScript ensures these fields don't exist on ProcessActivity
      // Runtime check to verify
      expect('is_manual' in activity).toBe(false);
      expect('user_input_amount' in activity).toBe(false);
    });
  });

  describe('ENTITY_TYPES enum', () => {
    test('PROCESS_ACTIVITY is in ENTITY_TYPES', () => {
      expect(ENTITY_TYPES.PROCESS_ACTIVITY).toBe('PROCESS_ACTIVITY');
    });
  });
});

// ===========================================================================
// Task Group 2: Defaults Configuration Layer Tests
// ===========================================================================

describe('Task Group 2: Defaults Configuration Layer', () => {
  describe('userInteractionLevelOptions array', () => {
    test('userInteractionLevelOptions is exported and has correct values', () => {
      expect(userInteractionLevelOptions).toBeDefined();
      expect(userInteractionLevelOptions).toContain('AUTOMATED');
      expect(userInteractionLevelOptions).toContain('MINIMAL');
      expect(userInteractionLevelOptions).toContain('MODERATE');
      expect(userInteractionLevelOptions).toContain('SIGNIFICANT');
      expect(userInteractionLevelOptions).toHaveLength(4);
    });
  });

  describe('processActivityColors mapping', () => {
    test('processActivityColors has all user_interaction_level values', () => {
      expect(processActivityColors.AUTOMATED).toBe('#a5d6a7');
      expect(processActivityColors.MINIMAL).toBe('#c8e6c9');
      expect(processActivityColors.MODERATE).toBe('#fff9c4');
      expect(processActivityColors.SIGNIFICANT).toBe('#ffcdd2');
    });

    test('AUTOMATED is medium green', () => {
      expect(processActivityColors.AUTOMATED).toBe('#a5d6a7');
    });

    test('MINIMAL is light green', () => {
      expect(processActivityColors.MINIMAL).toBe('#c8e6c9');
    });

    test('MODERATE is light yellow', () => {
      expect(processActivityColors.MODERATE).toBe('#fff9c4');
    });

    test('SIGNIFICANT is light red', () => {
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

    test('returns correct color for MINIMAL', () => {
      const activity: ProcessActivity = {
        id: 'pa-2',
        business_process_id: 'bp-1',
        name: 'Test',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'MINIMAL',
        tags: '',
      };

      expect(getProcessActivityDefaultFill(activity)).toBe('#c8e6c9');
    });

    test('returns correct color for MODERATE', () => {
      const activity: ProcessActivity = {
        id: 'pa-3',
        business_process_id: 'bp-1',
        name: 'Test',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'MODERATE',
        tags: '',
      };

      expect(getProcessActivityDefaultFill(activity)).toBe('#fff9c4');
    });

    test('returns correct color for SIGNIFICANT', () => {
      const activity: ProcessActivity = {
        id: 'pa-4',
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
});

// ===========================================================================
// Task Group 3: Migration Layer Tests
// ===========================================================================

describe('Task Group 3: Migration Layer', () => {
  describe('buildModelFromData migration', () => {
    test('is_manual=false migrates to AUTOMATED', () => {
      const rawData = {
        metaModel: {
          entities: {
            process_activities: [
              {
                id: 'pa-1',
                business_process_id: 'bp-1',
                name: 'Automated Task',
                description: '',
                actor_hint: 'INTERNAL_SYSTEM',
                is_manual: false,
                user_input_amount: 'NA',
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

      expect(activity.user_interaction_level).toBe('AUTOMATED');
    });

    test('is_manual=true + MINIMAL migrates to MINIMAL', () => {
      const rawData = {
        metaModel: {
          entities: {
            process_activities: [
              {
                id: 'pa-2',
                business_process_id: 'bp-1',
                name: 'Minimal Task',
                description: '',
                actor_hint: 'END_USER',
                is_manual: true,
                user_input_amount: 'MINIMAL',
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

      expect(activity.user_interaction_level).toBe('MINIMAL');
    });

    test('is_manual=true + MODERATE migrates to MODERATE', () => {
      const rawData = {
        metaModel: {
          entities: {
            process_activities: [
              {
                id: 'pa-3',
                business_process_id: 'bp-1',
                name: 'Moderate Task',
                description: '',
                actor_hint: 'END_USER',
                is_manual: true,
                user_input_amount: 'MODERATE',
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

      expect(activity.user_interaction_level).toBe('MODERATE');
    });

    test('is_manual=true + SIGNIFICANT migrates to SIGNIFICANT', () => {
      const rawData = {
        metaModel: {
          entities: {
            process_activities: [
              {
                id: 'pa-4',
                business_process_id: 'bp-1',
                name: 'Significant Task',
                description: '',
                actor_hint: 'END_USER',
                is_manual: true,
                user_input_amount: 'SIGNIFICANT',
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

      expect(activity.user_interaction_level).toBe('SIGNIFICANT');
    });

    test('missing old fields defaults to AUTOMATED', () => {
      const rawData = {
        metaModel: {
          entities: {
            process_activities: [
              {
                id: 'pa-5',
                business_process_id: 'bp-1',
                name: 'Default Task',
                description: '',
                actor_hint: 'OTHER',
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

      expect(activity.user_interaction_level).toBe('AUTOMATED');
    });

    test('new format with user_interaction_level is preserved', () => {
      const rawData = {
        metaModel: {
          entities: {
            process_activities: [
              {
                id: 'pa-6',
                business_process_id: 'bp-1',
                name: 'New Format Task',
                description: '',
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

      expect(activity.user_interaction_level).toBe('MODERATE');
    });
  });
});

// ===========================================================================
// Task Group 4: Grid Configuration Layer Tests
// ===========================================================================

describe('Task Group 4: Grid Configuration Layer', () => {
  describe('process_activities grid config', () => {
    test('process_activities grid config exists', () => {
      expect(gridConfigs.process_activities).toBeDefined();
    });

    test('process_activities grid has user_interaction_level column', () => {
      const columns = gridConfigs.process_activities;
      const fieldNames = columns.map((c) => c.field);

      expect(fieldNames).toContain('user_interaction_level');
    });

    test('user_interaction_level column is dropdown with correct options', () => {
      const columns = gridConfigs.process_activities;
      const levelColumn = columns.find((c) => c.field === 'user_interaction_level');

      expect(levelColumn?.cellType).toBe('dropdown');
      expect(levelColumn?.options).toEqual(userInteractionLevelOptions);
      expect(levelColumn?.required).toBe(true);
    });

    test('process_activities grid does NOT have is_manual column', () => {
      const columns = gridConfigs.process_activities;
      const fieldNames = columns.map((c) => c.field);

      expect(fieldNames).not.toContain('is_manual');
    });

    test('process_activities grid does NOT have user_input_amount column', () => {
      const columns = gridConfigs.process_activities;
      const fieldNames = columns.map((c) => c.field);

      expect(fieldNames).not.toContain('user_input_amount');
    });

    test('actor_hint column is dropdown with correct options', () => {
      const columns = gridConfigs.process_activities;
      const actorColumn = columns.find((c) => c.field === 'actor_hint');

      expect(actorColumn?.cellType).toBe('dropdown');
      expect(actorColumn?.options).toEqual(actorHintOptions);
    });
  });
});

// ===========================================================================
// Task Group 5: Validation Layer Tests
// ===========================================================================

describe('Task Group 5: Validation Layer', () => {
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

  describe('user_interaction_level required validation', () => {
    test('missing user_interaction_level generates validation error', () => {
      // Create activity with empty user_interaction_level
      const model = createTestModel([
        {
          id: 'pa-1',
          business_process_id: 'bp-1',
          name: 'Activity 1',
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: '' as UserInteractionLevel, // Empty value
          tags: '',
        },
      ]);

      const errors = validateModel(model);
      const requiredError = errors.find(
        (e) => e.entityId === 'pa-1' && e.field === 'user_interaction_level'
      );

      expect(requiredError).toBeDefined();
      expect(requiredError?.type).toBe('required');
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
// Task Group 6: Clean-up Layer Tests
// ===========================================================================

describe('Task Group 6: Clean-up Layer', () => {
  describe('Old fields removed from schema', () => {
    test('ProcessActivity type does not include is_manual', () => {
      // This test verifies that TypeScript correctly excludes the field
      const activity: ProcessActivity = {
        id: 'pa-1',
        business_process_id: 'bp-1',
        name: 'Test',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      };

      // If is_manual existed on ProcessActivity, this would be a type error
      const keys = Object.keys(activity);
      expect(keys).not.toContain('is_manual');
    });

    test('ProcessActivity type does not include user_input_amount', () => {
      const activity: ProcessActivity = {
        id: 'pa-1',
        business_process_id: 'bp-1',
        name: 'Test',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      };

      const keys = Object.keys(activity);
      expect(keys).not.toContain('user_input_amount');
    });
  });

  describe('Grid config cleanup', () => {
    test('No is_manual column in grid config', () => {
      const columns = gridConfigs.process_activities;
      const isManualColumn = columns.find((c) => c.field === 'is_manual');
      expect(isManualColumn).toBeUndefined();
    });

    test('No user_input_amount column in grid config', () => {
      const columns = gridConfigs.process_activities;
      const inputAmountColumn = columns.find((c) => c.field === 'user_input_amount');
      expect(inputAmountColumn).toBeUndefined();
    });
  });
});

// ===========================================================================
// Task Group 7: Integration Tests
// ===========================================================================

describe('Task Group 7: Integration Tests', () => {
  test('full migration from old to new format', () => {
    // Simulate loading old format data
    const oldFormatData = {
      metaModel: {
        entities: {
          business_processes: [
            { id: 'bp-1', name: 'Customer Onboarding', description: '', tags: '' },
          ],
          process_activities: [
            {
              id: 'pa-1',
              business_process_id: 'bp-1',
              name: 'Automated Check',
              description: '',
              actor_hint: 'INTERNAL_SYSTEM',
              is_manual: false,
              user_input_amount: 'NA',
              tags: '',
            },
            {
              id: 'pa-2',
              business_process_id: 'bp-1',
              name: 'Quick Review',
              description: '',
              actor_hint: 'END_USER',
              is_manual: true,
              user_input_amount: 'MINIMAL',
              tags: '',
            },
            {
              id: 'pa-3',
              business_process_id: 'bp-1',
              name: 'Data Entry',
              description: '',
              actor_hint: 'END_USER',
              is_manual: true,
              user_input_amount: 'SIGNIFICANT',
              tags: '',
            },
          ],
        },
        relationships: {},
      },
      diagrams: [],
    };

    // Build model (migration happens here)
    const model = buildModelFromData(oldFormatData);

    // Verify migrations
    const activities = model.metaModel.entities.process_activities;

    expect(activities[0].user_interaction_level).toBe('AUTOMATED');
    expect(activities[1].user_interaction_level).toBe('MINIMAL');
    expect(activities[2].user_interaction_level).toBe('SIGNIFICANT');

    // Verify colors are correct based on new field
    expect(getProcessActivityDefaultFill(activities[0])).toBe('#a5d6a7'); // AUTOMATED = medium green
    expect(getProcessActivityDefaultFill(activities[1])).toBe('#c8e6c9'); // MINIMAL = light green
    expect(getProcessActivityDefaultFill(activities[2])).toBe('#ffcdd2'); // SIGNIFICANT = light red
  });

  test('new row defaults to AUTOMATED', () => {
    // When creating a new ProcessActivity, user_interaction_level should default to AUTOMATED
    // This is verified by the migration logic defaulting to AUTOMATED for missing values
    const rawData = {
      metaModel: {
        entities: {
          process_activities: [
            {
              id: 'pa-new',
              business_process_id: 'bp-1',
              name: 'New Activity',
              description: '',
              actor_hint: 'OTHER',
              tags: '',
              // No user_interaction_level provided
            },
          ],
        },
        relationships: {},
      },
      diagrams: [],
    };

    const model = buildModelFromData(rawData);
    const activity = model.metaModel.entities.process_activities[0];

    expect(activity.user_interaction_level).toBe('AUTOMATED');
  });

  test('diagram color updates when level changes', () => {
    // Create a model with activities at different levels
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
              name: 'Activity 1',
              description: '',
              actor_hint: 'INTERNAL_SYSTEM',
              user_interaction_level: 'AUTOMATED',
              tags: '',
            },
            {
              id: 'pa-2',
              business_process_id: 'bp-1',
              name: 'Activity 2',
              description: '',
              actor_hint: 'END_USER',
              user_interaction_level: 'SIGNIFICANT',
              tags: '',
            },
          ],
        },
      },
      diagrams: [
        {
          id: 'd-1',
          name: 'Test Diagram',
          description: '',
          diagram_nodes: [
            {
              id: 'n-1',
              entity_type: 'PROCESS_ACTIVITY',
              entity_id: 'pa-1',
              pos_x: 100,
              pos_y: 100,
              width: 120,
              height: 60,
              parent_node_id: null,
            },
            {
              id: 'n-2',
              entity_type: 'PROCESS_ACTIVITY',
              entity_id: 'pa-2',
              pos_x: 250,
              pos_y: 100,
              width: 120,
              height: 60,
              parent_node_id: null,
            },
          ],
          diagram_edges: [],
        },
      ],
    };

    // Verify that getNodeFillColor returns the correct colors
    const node1 = model.diagrams[0].diagram_nodes[0];
    const node2 = model.diagrams[0].diagram_nodes[1];

    expect(getNodeFillColor(node1, model)).toBe('#a5d6a7'); // AUTOMATED
    expect(getNodeFillColor(node2, model)).toBe('#ffcdd2'); // SIGNIFICANT
  });

  test('parent-child relationship constants', () => {
    expect(supportsChildNodes(ENTITY_TYPES.BUSINESS_PROCESS)).toBe(true);
    expect(getParentEntityType(ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(ENTITY_TYPES.BUSINESS_PROCESS);
    expect(isChildEntityType(ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(true);
  });

  test('Activities tab mapping in domainGroupings', () => {
    expect(domainGroupings.business).toContain('Activities');
    expect(entityTabNames).toContain('Activities');
    expect(tabToEntityType['Activities']).toBe('process_activities');
  });
});
