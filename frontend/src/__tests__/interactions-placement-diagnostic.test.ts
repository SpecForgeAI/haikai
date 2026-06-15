/**
 * Diagnostic Tests: Interactions Tab Placement and Case A Enable Logic
 *
 * Task Group 1: Root Cause Analysis and Fix Verification
 *
 * These tests verify the FIXED behavior after spec implementation:
 * 1. "Interactions" now appears in the Relationships row (not Entities row)
 * 2. Routing correctly sends Interactions to RelationshipGrid
 * 3. getAppBusinessPointNodeId correctly resolves ABP IDs
 * 4. isUserInteractionRowEnabled correctly handles Case A (without User node)
 *
 * ORIGINAL ROOT CAUSES (now fixed):
 * - ROOT CAUSE 1: Interactions WAS in domainGroupings.business and entityTabNames -> FIXED
 * - ROOT CAUSE 2: Interactions WAS NOT in relationshipTabNames or relationshipTabToType -> FIXED
 * - ROOT CAUSE 3: Case A logic is CORRECT (verified), works if app_business_points populated
 */

import { describe, it, expect } from 'vitest';
import {
  gridConfigs,
  tabToEntityType,
  relationshipTabToType,
  entityTabNames,
  relationshipTabNames,
  domainGroupings,
} from '../config/gridConfigs';
import {
  isUserInteractionRowEnabled,
  getAppBusinessPointNodeId,
  isUserInteractionCase,
} from '../utils/userInteractionUtils';
import {
  MetaModel,
  Diagram,
  DiagramNode,
  ENTITY_TYPES,
  AppBusinessPoint,
  Application,
  BusinessUser,
} from '../types/model';

// ============================================================================
// Task 1.1: Diagnostic Tests for Current Tab Placement Configuration
// ============================================================================

describe('Diagnostic Test 1: Current Tab Placement Configuration in gridConfigs.ts', () => {
  /**
   * VERIFIED (FIXED): Interactions is NOT in domainGroupings.business
   * Previously it was incorrectly included, causing it to appear in Entities row
   */
  it('verifies Interactions is NOT in domainGroupings.business (FIXED)', () => {
    const businessDomain = domainGroupings.business;

    // Fixed state: Interactions is NOT in business domain
    expect(businessDomain).not.toContain('Interactions');

    // Document the correct contents
    console.log('Current domainGroupings.business:', businessDomain);
    // Spec 2026-04-01 added User Journeys and Activity Steps
    expect(businessDomain).toEqual(['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']);
  });

  /**
   * VERIFIED (FIXED): Interactions is NOT in entityTabNames
   * Previously it was incorrectly included
   */
  it('verifies Interactions is NOT in entityTabNames (FIXED)', () => {
    // Fixed state: Interactions is NOT in entityTabNames
    expect(entityTabNames).not.toContain('Interactions');

    // Verify the corrected array
    console.log('Current entityTabNames:', entityTabNames);
  });

  /**
   * VERIFIED (FIXED): Interactions IS in relationshipTabNames
   * Previously it was missing - now added
   */
  it('verifies Interactions IS in relationshipTabNames (FIXED)', () => {
    // Fixed state: Interactions IS in relationshipTabNames
    expect(relationshipTabNames).toContain('Interactions');

    // Document correct contents
    console.log('Current relationshipTabNames:', relationshipTabNames);

    // Verify position: after "App Point <-> Business Point", before "Logical ER"
    const appPointIndex = relationshipTabNames.indexOf('App Point <-> Business Point');
    const interactionsIndex = relationshipTabNames.indexOf('Interactions');
    const logicalERIndex = relationshipTabNames.indexOf('Logical / Physical ER');

    expect(interactionsIndex).toBe(appPointIndex + 1);
    expect(interactionsIndex).toBe(logicalERIndex - 1);
  });

  /**
   * VERIFIED (FIXED): Interactions is NOT in tabToEntityType
   * Removing it prevents double-rendering (spec: 2025-12-09-fix-interactions-double-rendering)
   * gridConfigs.interactions still exists for column configuration
   */
  it('verifies Interactions is NOT in tabToEntityType (prevents double-rendering)', () => {
    // tabToEntityType must NOT have Interactions to prevent double-rendering
    expect(tabToEntityType['Interactions']).toBeUndefined();

    console.log('tabToEntityType["Interactions"]:', tabToEntityType['Interactions']);
  });

  /**
   * VERIFIED (FIXED): Interactions IS in relationshipTabToType
   * Previously it was missing - now added for proper routing
   */
  it('verifies Interactions IS in relationshipTabToType (FIXED)', () => {
    // Fixed state: relationshipTabToType DOES have Interactions
    expect(relationshipTabToType['Interactions']).toBe('interactions');

    // Document current mappings
    console.log('Current relationshipTabToType keys:', Object.keys(relationshipTabToType));
  });
});

// ============================================================================
// Task 1.2: Diagnostic Tests for Current Routing Behavior
// ============================================================================

describe('Diagnostic Test 2: Current Routing Behavior for Interactions Tab', () => {
  /**
   * VERIFIED (FIXED): When "Interactions" tab is clicked, MetaModelView routes to RelationshipGrid ONLY
   *
   * In MetaModelView.tsx:
   * - isEntityTab = state.selectedTab in tabToEntityType -> FALSE for "Interactions" (REMOVED to fix double-rendering)
   * - isRelationshipTab = state.selectedTab in relationshipTabToType -> TRUE for "Interactions"
   *
   * Result: Only RelationshipGrid is rendered (not Grid + RelationshipGrid)
   * (spec: 2025-12-09-fix-interactions-double-rendering)
   */
  it('verifies Interactions now routes to RelationshipGrid ONLY (FIXED)', () => {
    const selectedTab = 'Interactions';

    // Current routing logic
    const isEntityTab = selectedTab in tabToEntityType;
    const isRelationshipTab = selectedTab in relationshipTabToType;

    // Document current state
    console.log('isEntityTab for Interactions:', isEntityTab);
    console.log('isRelationshipTab for Interactions:', isRelationshipTab);

    // Fixed behavior: isEntityTab is FALSE, isRelationshipTab is TRUE
    // This ensures ONLY RelationshipGrid is rendered (no double-rendering)
    expect(isEntityTab).toBe(false);  // REMOVED to prevent double-rendering
    expect(isRelationshipTab).toBe(true);  // Routes to RelationshipGrid
  });

  /**
   * FINDING: gridConfigs.interactions exists and is correct
   * The grid configuration is already properly defined
   *
   * EXPECTED: This is correct and should be reused by RelationshipGrid
   */
  it('documents that gridConfigs.interactions exists (CORRECT)', () => {
    const config = gridConfigs['interactions'];

    expect(config).toBeDefined();
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(0);

    // Document the columns
    const fields = config.map(c => c.field);
    console.log('gridConfigs.interactions fields:', fields);
    // Expected: ['id', 'name', 'description', 'user_id', 'primary_app_business_point_id', ...]
  });
});

// ============================================================================
// Task 1.3: Diagnostic Tests for getAppBusinessPointNodeId Resolution
// ============================================================================

describe('Diagnostic Test 3: getAppBusinessPointNodeId with Various ABP Data Scenarios', () => {
  // Helper to create test data
  function createMinimalMetaModel(appBusinessPoints: AppBusinessPoint[]): MetaModel {
    return {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
        app_business_points: appBusinessPoints,
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    };
  }

  function createTestNode(entityType: string, entityId: string): DiagramNode {
    return {
      id: `node-${entityId}`,
      entity_type: entityType,
      entity_id: entityId,
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      z_index: 100,
      parent_node_id: null,
    };
  }

  /**
   * FINDING: getAppBusinessPointNodeId correctly resolves ABP when:
   * - ABP exists in metaModel.entities.app_business_points
   * - ABP.source_entity_id matches a node's entity_id on the diagram
   * - ABP.kind maps to the correct entity type
   */
  it('resolves ABP to node ID when ABP exists and node is on diagram', () => {
    const abp: AppBusinessPoint = {
      id: 'abp_app-1',
      name: 'App 1',
      kind: 'APPLICATION',
      source_entity_id: 'app-1',
    };

    const metaModel = createMinimalMetaModel([abp]);
    const nodes = [createTestNode(ENTITY_TYPES.APPLICATION, 'app-1')];

    const result = getAppBusinessPointNodeId('abp_app-1', nodes, metaModel);

    expect(result).toBe('node-app-1');
    console.log('ABP resolved correctly:', result);
  });

  /**
   * FINDING: getAppBusinessPointNodeId returns null when ABP exists but node NOT on diagram
   * This is CORRECT behavior - the row should be disabled
   */
  it('returns null when ABP exists but node is NOT on diagram', () => {
    const abp: AppBusinessPoint = {
      id: 'abp_app-1',
      name: 'App 1',
      kind: 'APPLICATION',
      source_entity_id: 'app-1',
    };

    const metaModel = createMinimalMetaModel([abp]);
    const nodes: DiagramNode[] = []; // Empty - no nodes on diagram

    const result = getAppBusinessPointNodeId('abp_app-1', nodes, metaModel);

    expect(result).toBeNull();
    console.log('ABP not on diagram - returns null (correct)');
  });

  /**
   * FINDING: getAppBusinessPointNodeId returns null when ABP does NOT exist in meta-model
   * This could be a ROOT CAUSE if app_business_points array is not populated
   */
  it('returns null when ABP does NOT exist in meta-model', () => {
    const metaModel = createMinimalMetaModel([]); // Empty app_business_points
    const nodes = [createTestNode(ENTITY_TYPES.APPLICATION, 'app-1')];

    const result = getAppBusinessPointNodeId('abp_app-1', nodes, metaModel);

    expect(result).toBeNull();
    console.log('ABP not in meta-model - returns null');

    // POTENTIAL ROOT CAUSE: If app_business_points is not populated,
    // Case A interactions will always be disabled
  });

  /**
   * FINDING: getAppBusinessPointNodeId returns null when app_business_points is undefined
   */
  it('returns null when app_business_points array is undefined', () => {
    const metaModel = createMinimalMetaModel([]);
    // Simulate undefined app_business_points
    (metaModel.entities as Record<string, unknown>).app_business_points = undefined;

    const nodes = [createTestNode(ENTITY_TYPES.APPLICATION, 'app-1')];

    const result = getAppBusinessPointNodeId('abp_app-1', nodes, metaModel);

    expect(result).toBeNull();
    console.log('app_business_points undefined - returns null');
  });
});

// ============================================================================
// Task 1.4: Diagnostic Tests for Case A Enable Logic (without User node)
// ============================================================================

describe('Diagnostic Test 4: isUserInteractionRowEnabled Case A (without User node)', () => {
  function createFullMetaModel(
    apps: Application[],
    abps: AppBusinessPoint[],
    users: BusinessUser[]
  ): MetaModel {
    return {
      entities: {
        business_users: users,
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: apps,
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
        app_business_points: abps,
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    };
  }

  function createTestNode(entityType: string, entityId: string): DiagramNode {
    return {
      id: `node-${entityId}`,
      entity_type: entityType,
      entity_id: entityId,
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      z_index: 100,
      parent_node_id: null,
    };
  }

  function createTestDiagram(nodes: DiagramNode[]): Diagram {
    return {
      id: 'diag-1',
      name: 'Test Diagram',
      description: '',
      diagram_nodes: nodes,
      diagram_edges: [],
      view_quarter: '2024-Q4',
    };
  }

  /**
   * FINDING: Case A correctly identifies interactions with both primary AND secondary ABP
   */
  it('identifies Case A when both primary and secondary ABP are set', () => {
    const interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      secondary_app_business_point_id: 'abp_app-2',
    };

    const caseType = isUserInteractionCase(interaction);
    expect(caseType).toBe('A');
    console.log('Case A correctly identified');
  });

  /**
   * FINDING: Case A is ENABLED when P and S nodes on diagram, User NOT required
   * This test verifies the Case A branch at line 284 does NOT check for User node
   */
  it('Case A ENABLED: P and S on diagram, User NOT on diagram (User NOT required)', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP: AppBusinessPoint = { id: 'abp_app-1', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app-1' };
    const abpS: AppBusinessPoint = { id: 'abp_app-2', name: 'App 2', kind: 'APPLICATION', source_entity_id: 'app-2' };

    const metaModel = createFullMetaModel([app1, app2], [abpP, abpS], [user1]);

    const diagram = createTestDiagram([
      createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'),  // P node
      createTestNode(ENTITY_TYPES.APPLICATION, 'app-2'),  // S node
      // NO User node - deliberately omitted
    ]);

    const interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      secondary_app_business_point_id: 'abp_app-2',
    };

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

    // CRITICAL FINDING: Case A should be ENABLED without User node
    expect(result).toBe(true);
    console.log('Case A enabled without User node:', result);
  });

  /**
   * FINDING: Case A is DISABLED when P on diagram but S is missing
   */
  it('Case A DISABLED: P on diagram but S missing', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP: AppBusinessPoint = { id: 'abp_app-1', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app-1' };
    const abpS: AppBusinessPoint = { id: 'abp_app-2', name: 'App 2', kind: 'APPLICATION', source_entity_id: 'app-2' };

    const metaModel = createFullMetaModel([app1, app2], [abpP, abpS], [user1]);

    const diagram = createTestDiagram([
      createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'),  // P node only
      // S node missing
    ]);

    const interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      secondary_app_business_point_id: 'abp_app-2',
    };

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

    expect(result).toBe(false);
    console.log('Case A disabled when S missing:', result);
  });

  /**
   * FINDING: Case A fails when ABP does not exist in app_business_points array
   * This is the POTENTIAL ROOT CAUSE for Case A enablement failure
   */
  it('Case A DISABLED: ABP not in app_business_points (potential root cause)', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    // ABPs NOT in app_business_points array - simulating missing sync
    const metaModel = createFullMetaModel([app1, app2], [], [user1]);

    const diagram = createTestDiagram([
      createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'),
      createTestNode(ENTITY_TYPES.APPLICATION, 'app-2'),
    ]);

    const interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',  // ABP ID doesn't exist
      secondary_app_business_point_id: 'abp_app-2', // ABP ID doesn't exist
    };

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

    // Row will be DISABLED because ABP lookup fails
    expect(result).toBe(false);
    console.log('Case A disabled when ABP not in app_business_points:', result);

    // ROOT CAUSE DOCUMENTATION:
    // If app_business_points array is not populated when entities are created,
    // getAppBusinessPointNodeId returns null, and Case A rows are always disabled
  });
});

// ============================================================================
// Task 1.5: Diagnostic Tests for RelationshipGrid Data Access Pattern
// ============================================================================

describe('Diagnostic Test 5: RelationshipGrid Data Access Pattern', () => {
  /**
   * FINDING: RelationshipGrid accesses data via state.model.metaModel.relationships[relationshipType]
   *
   * Current code (RelationshipGrid.tsx line 19):
   *   const relationships = state.model.metaModel.relationships[relationshipType];
   *
   * PROBLEM: Interactions data is stored in metaModel.entities.interactions,
   * NOT in metaModel.relationships.interactions
   *
   * REQUIRED CHANGE: Add fallback to entities for Interactions:
   *   const relationships = state.model.metaModel.relationships[relationshipType]
   *     || state.model.metaModel.entities[relationshipType];
   */
  it('documents RelationshipGrid data access pattern', () => {
    // Document the expected data locations
    const dataLocations = {
      // Regular relationships - in relationships object
      'business_user_business_points': 'metaModel.relationships.business_user_business_points',
      'application_point_business_points': 'metaModel.relationships.application_point_business_points',
      'logical_data_entity_relationships': 'metaModel.relationships.logical_data_entity_relationships',
      'data_movements': 'metaModel.relationships.data_movements',

      // SPECIAL CASE: Interactions - in entities object
      'interactions': 'metaModel.entities.interactions',
    };

    console.log('Data locations for RelationshipGrid:', dataLocations);

    // Verify Interactions has grid config
    expect(gridConfigs['interactions']).toBeDefined();

    // Document the issue
    console.log('FINDING: Interactions is in entities, not relationships');
    console.log('RelationshipGrid needs fallback for entities.interactions');
  });

  /**
   * FINDING: RelationshipGrid.createEmptyRelationship needs a case for 'interactions'
   *
   * Current switch statement does not have a case for 'interactions'
   *
   * REQUIRED CHANGE: Add case 'interactions' to createEmptyRelationship
   */
  it('documents createEmptyRelationship needs interactions case', () => {
    // Expected empty Interaction shape (from gridConfigs.interactions columns)
    const expectedEmptyInteraction = {
      id: 'int-xxx',
      name: '',
      description: '',
      user_id: '',
      primary_app_business_point_id: '',
      secondary_app_business_point_id: '',
      tags: '',
    };

    console.log('Expected empty Interaction shape:', expectedEmptyInteraction);

    // FINDING: createEmptyRelationship function needs case for 'interactions'
  });
});

// ============================================================================
// Task 1.6: Summary of Required Changes
// ============================================================================

describe('Summary: Root Causes and Required Changes', () => {
  it('documents all root causes and required changes', () => {
    const findings = {
      rootCause1: {
        description: 'Interactions appears in wrong row (Entities instead of Relationships)',
        cause: 'Interactions is in domainGroupings.business and entityTabNames',
        file: 'frontend/src/config/gridConfigs.ts',
        changes: [
          'Line 286: Remove "Interactions" from entityTabNames array',
          'Line 300: Remove "Interactions" from domainGroupings.business array',
          'Line 309: Add "Interactions" to relationshipTabNames after "App Point <-> Business Point"',
          'After line 272: Add "Interactions": "interactions" to relationshipTabToType',
        ],
      },
      rootCause2: {
        description: 'Clicking Interactions routes to Grid (EntityGrid) not RelationshipGrid',
        cause: 'Interactions not in relationshipTabToType, so isRelationshipTab is false',
        file: 'frontend/src/components/MetaModelView/MetaModelView.tsx',
        changes: [
          'After gridConfigs.ts changes, routing will automatically work',
          'No code changes needed in MetaModelView.tsx',
        ],
      },
      rootCause3: {
        description: 'RelationshipGrid cannot access interactions data',
        cause: 'Interactions data is in entities.interactions, not relationships.interactions',
        file: 'frontend/src/components/Grid/RelationshipGrid.tsx',
        changes: [
          'Line 19: Add fallback || state.model.metaModel.entities[relationshipType]',
          'createEmptyRelationship: Add case "interactions" with correct shape',
        ],
      },
      potentialRootCause4: {
        description: 'Case A enablement may fail if ABP array not populated',
        cause: 'getAppBusinessPointNodeId returns null when ABP not in app_business_points',
        file: 'frontend/src/utils/userInteractionUtils.ts',
        changes: [
          'Verify ABP sync is creating entries when entities are created',
          'Check if ABP auto-creation triggers are working',
        ],
      },
    };

    console.log('ROOT CAUSE ANALYSIS COMPLETE:', JSON.stringify(findings, null, 2));

    // Test passes to document findings
    expect(findings.rootCause1.file).toBe('frontend/src/config/gridConfigs.ts');
    expect(findings.rootCause2.file).toBe('frontend/src/components/MetaModelView/MetaModelView.tsx');
    expect(findings.rootCause3.file).toBe('frontend/src/components/Grid/RelationshipGrid.tsx');
  });
});
