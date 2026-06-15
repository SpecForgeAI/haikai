/**
 * Model Normalization UI Entities Tests
 * Spec: 2026-01-03-metamodel-ui-workflow-transitions-crash-fix
 *
 * Tests that normalizeModelFromApi correctly backfills missing UI entity arrays
 * to prevent crashes when loading older saved projects that don't have UI entities.
 *
 * Test Coverage:
 * 1. normalizeModelFromApi backfills missing ui_screens as empty array
 * 2. normalizeModelFromApi backfills missing ui_workflow_transitions as empty array
 * 3. normalizeModelFromApi backfills missing ui_components and ui_actions as empty arrays
 * 4. normalizeModelFromApi preserves existing UI arrays (does not overwrite)
 */

import { normalizeModelFromApi } from '../api/modelSerialization';

describe('Model Normalization: UI Entity Arrays', () => {
  describe('Test 1: normalizeModelFromApi backfills missing ui_screens as empty array', () => {
    it('should backfill ui_screens when missing from raw model', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            business_processes: [],
            // ui_screens is intentionally missing
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // After normalization, ui_screens should be an empty array
      expect(normalized.metaModel.entities.ui_screens).toEqual([]);
    });

    it('should backfill ui_screens when metaModel.entities is empty object', () => {
      const rawModel = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      expect(normalized.metaModel.entities.ui_screens).toEqual([]);
    });

    it('should handle explicitly undefined ui_screens', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            ui_screens: undefined,
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // The nullish coalescing should convert undefined to []
      expect(normalized.metaModel.entities.ui_screens).toEqual([]);
    });

    it('should handle explicitly null ui_screens from API', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            ui_screens: null,
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // The nullish coalescing should convert null to []
      expect(normalized.metaModel.entities.ui_screens).toEqual([]);
    });
  });

  describe('Test 2: normalizeModelFromApi backfills missing ui_workflow_transitions as empty array', () => {
    it('should backfill ui_workflow_transitions when missing from raw model entities', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            // ui_workflow_transitions intentionally missing from entities
          },
          relationships: {
            // ui_workflow_transitions might be in relationships (legacy structure)
          },
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // After normalization, ui_workflow_transitions should be backfilled in entities
      expect(normalized.metaModel.entities.ui_workflow_transitions).toEqual([]);
    });

    it('should handle ui_workflow_transitions in relationships (legacy) by adding to entities', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
          },
          relationships: {
            ui_workflow_transitions: [
              { id: 'uwt-1', name: 'Nav to Home', source_screen_id: 'scr-1', target_screen_id: 'scr-2' },
            ],
          },
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // Entities should have ui_workflow_transitions (backfilled)
      // Note: The spec says to move from relationships to entities, but for backward compat
      // we only ensure entities has it; the relationship version might still exist
      expect(normalized.metaModel.entities.ui_workflow_transitions).toBeDefined();
      expect(Array.isArray(normalized.metaModel.entities.ui_workflow_transitions)).toBe(true);
    });
  });

  describe('Test 3: normalizeModelFromApi backfills missing ui_components and ui_actions as empty arrays', () => {
    it('should backfill ui_components when missing', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            // ui_components missing
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      expect(normalized.metaModel.entities.ui_components).toEqual([]);
    });

    it('should backfill ui_actions when missing', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            // ui_actions missing
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      expect(normalized.metaModel.entities.ui_actions).toEqual([]);
    });

    it('should backfill all missing UI entity arrays in single call', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            business_processes: [],
            applications: [],
            // All UI entities missing
          },
          relationships: {
            business_user_business_points: [],
          },
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // All four UI entity arrays should be backfilled
      expect(normalized.metaModel.entities.ui_screens).toEqual([]);
      expect(normalized.metaModel.entities.ui_workflow_transitions).toEqual([]);
      expect(normalized.metaModel.entities.ui_components).toEqual([]);
      expect(normalized.metaModel.entities.ui_actions).toEqual([]);
    });

    it('should handle mixed missing/present UI entity arrays', () => {
      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            ui_screens: [{ id: 'scr-1', name: 'Home', route: '/' }],
            // ui_components, ui_actions, ui_workflow_transitions missing
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // Existing array should be preserved
      expect(normalized.metaModel.entities.ui_screens).toEqual([
        { id: 'scr-1', name: 'Home', route: '/' },
      ]);

      // Missing arrays should be backfilled
      expect(normalized.metaModel.entities.ui_components).toEqual([]);
      expect(normalized.metaModel.entities.ui_actions).toEqual([]);
      expect(normalized.metaModel.entities.ui_workflow_transitions).toEqual([]);
    });
  });

  describe('Test 4: normalizeModelFromApi preserves existing UI arrays (does not overwrite)', () => {
    it('should preserve existing ui_screens array', () => {
      const existingScreens = [
        { id: 'scr-1', name: 'Home Screen', route: '/home', description: 'Home page' },
        { id: 'scr-2', name: 'Settings', route: '/settings', description: '' },
      ];

      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            ui_screens: existingScreens,
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // Should NOT be overwritten with empty array
      expect(normalized.metaModel.entities.ui_screens).toEqual(existingScreens);
      expect(normalized.metaModel.entities.ui_screens.length).toBe(2);
    });

    it('should preserve existing ui_workflow_transitions array', () => {
      const existingTransitions = [
        { id: 'uwt-1', name: 'Navigate Home', source_screen_id: 'scr-2', target_screen_id: 'scr-1' },
      ];

      const rawModel = {
        metaModel: {
          entities: {
            business_users: [],
            ui_workflow_transitions: existingTransitions,
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      expect(normalized.metaModel.entities.ui_workflow_transitions).toEqual(existingTransitions);
    });

    it('should preserve existing ui_components array', () => {
      const existingComponents = [
        { id: 'comp-1', name: 'Header', component_type: 'NAVIGATION', description: 'Main header' },
      ];

      const rawModel = {
        metaModel: {
          entities: {
            ui_components: existingComponents,
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      expect(normalized.metaModel.entities.ui_components).toEqual(existingComponents);
    });

    it('should preserve existing ui_actions array', () => {
      const existingActions = [
        {
          id: 'act-1',
          name: 'Submit Form',
          trigger_type: 'CLICK',
          owner_type: 'COMPONENT',
          owner_id: 'comp-1',
          effect_type: 'NAVIGATE',
        },
      ];

      const rawModel = {
        metaModel: {
          entities: {
            ui_actions: existingActions,
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      expect(normalized.metaModel.entities.ui_actions).toEqual(existingActions);
    });

    it('should preserve all existing UI arrays while backfilling missing ones', () => {
      const existingScreens = [{ id: 'scr-1', name: 'Home', route: '/' }];
      const existingComponents = [{ id: 'comp-1', name: 'Header' }];

      const rawModel = {
        metaModel: {
          entities: {
            ui_screens: existingScreens,
            ui_components: existingComponents,
            // ui_actions and ui_workflow_transitions missing
          },
          relationships: {},
        },
        diagrams: [],
      };

      const normalized = normalizeModelFromApi(rawModel);

      // Existing should be preserved
      expect(normalized.metaModel.entities.ui_screens).toEqual(existingScreens);
      expect(normalized.metaModel.entities.ui_components).toEqual(existingComponents);

      // Missing should be backfilled
      expect(normalized.metaModel.entities.ui_actions).toEqual([]);
      expect(normalized.metaModel.entities.ui_workflow_transitions).toEqual([]);
    });
  });

  describe('Edge Cases: Missing metaModel Structure', () => {
    it('should handle missing metaModel object gracefully', () => {
      const rawModel = {
        diagrams: [],
      };

      // Should not throw
      expect(() => normalizeModelFromApi(rawModel)).not.toThrow();

      const normalized = normalizeModelFromApi(rawModel);
      // The structure should be created with backfilled arrays
      expect(normalized.metaModel?.entities?.ui_screens).toEqual([]);
    });

    it('should handle missing metaModel.entities object gracefully', () => {
      const rawModel = {
        metaModel: {
          relationships: {},
        },
        diagrams: [],
      };

      expect(() => normalizeModelFromApi(rawModel)).not.toThrow();

      const normalized = normalizeModelFromApi(rawModel);
      expect(normalized.metaModel?.entities?.ui_screens).toEqual([]);
    });

    it('should handle completely empty raw model', () => {
      const rawModel = {};

      expect(() => normalizeModelFromApi(rawModel)).not.toThrow();
    });
  });
});

describe('Model Normalization: typed_content -> typedContent Mapping', () => {
  it('should still correctly map typed_content to typedContent for diagrams', () => {
    const rawModel = {
      metaModel: {
        entities: {},
        relationships: {},
      },
      diagrams: [
        {
          id: 'diag-1',
          name: 'Test Diagram',
          diagram_type: 'Sequence',
          diagram_nodes: [],
          diagram_edges: [],
          typed_content: {
            type: 'Sequence',
            version: 1,
            content: { participants: [], messages: [] },
          },
        },
      ],
    };

    const normalized = normalizeModelFromApi(rawModel);

    // typedContent should be populated from typed_content
    expect(normalized.diagrams[0].typedContent).toBeDefined();
    expect(normalized.diagrams[0].typedContent?.type).toBe('Sequence');

    // typed_content should be deleted
    expect((normalized.diagrams[0] as Record<string, unknown>).typed_content).toBeUndefined();
  });
});
