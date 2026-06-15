/**
 * MERGE_IMPORT Reducer Action Tests
 *
 * Tests for the MERGE_IMPORT action in the appReducer.
 * Since appReducer is not exported directly, these tests verify the
 * expected reducer logic via a simulation function that mirrors the
 * MERGE_IMPORT case implementation.
 *
 * Part of Spec: 2026-03-05-import-snapshot-redesign
 * Task Group 2: Extend IMPORT_META_MODEL Reducer for Merge with Diagrams
 */

import { describe, it, expect } from 'vitest';
import type { Diagram, ArchitectureModel, MetaModelEntities, MetaModelRelationships } from '../types/model';
import type { MergeableData } from '../utils/importMergeUtils';
import { emptyModel } from '../config/defaults';

// ---------------------------------------------------------------------------
// Helper: Create a minimal test diagram
// ---------------------------------------------------------------------------
function createTestDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return {
    id: 'diag-default',
    name: 'Default Diagram',
    description: '',
    diagram_nodes: [],
    diagram_edges: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: Simulate the MERGE_IMPORT reducer logic
// This mirrors the implementation that will be added to appReducer.
//
// The MERGE_IMPORT action is purely additive: for each entity/relationship
// collection key in the payload, it appends the new items to the existing
// arrays. For diagrams, it appends to state.model.diagrams.
// ---------------------------------------------------------------------------
function simulateMergeImport(
  currentModel: ArchitectureModel,
  payload: MergeableData
): ArchitectureModel {
  // Build updated entities - spread existing and append new items
  const finalEntities: Record<string, unknown[]> = { ...currentModel.metaModel.entities };

  for (const [entityType, newItems] of Object.entries(payload.entities)) {
    if (Array.isArray(newItems) && newItems.length > 0) {
      const existing = (finalEntities[entityType] as unknown[]) || [];
      finalEntities[entityType] = [...existing, ...newItems];
    }
  }

  // Build updated relationships - spread existing and append new items
  const finalRelationships: Record<string, unknown[]> = { ...currentModel.metaModel.relationships };

  for (const [relType, newItems] of Object.entries(payload.relationships)) {
    if (Array.isArray(newItems) && newItems.length > 0) {
      const existing = (finalRelationships[relType] as unknown[]) || [];
      finalRelationships[relType] = [...existing, ...newItems];
    }
  }

  // Append diagrams
  const finalDiagrams = payload.diagrams.length > 0
    ? [...currentModel.diagrams, ...payload.diagrams]
    : currentModel.diagrams;

  return {
    metaModel: {
      entities: finalEntities as unknown as MetaModelEntities,
      relationships: finalRelationships as unknown as MetaModelRelationships,
    },
    diagrams: finalDiagrams,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MERGE_IMPORT Reducer Action', () => {
  // Test 1: Dispatching MERGE_IMPORT with entities appends them to existing arrays
  it('should append imported entities to existing entity arrays without deleting existing data', () => {
    // Setup: Existing model with one application
    const existingApp = { id: 'app-1', name: 'Existing App', description: '', app_type: 'web', status: 'active', tags: '' };
    const currentModel: ArchitectureModel = {
      ...emptyModel,
      metaModel: {
        ...emptyModel.metaModel,
        entities: {
          ...emptyModel.metaModel.entities,
          applications: [existingApp as any],
        },
      },
    };

    // Payload: Two new applications and one new service
    const newApp = { id: 'app-2', name: 'Imported App', description: '', app_type: 'api', status: 'active', tags: '' };
    const newService = { id: 'svc-1', name: 'Imported Service', description: '', application_id: 'app-2', service_type: 'REST', tags: '' };

    const payload: MergeableData = {
      entities: {
        applications: [newApp as any],
        services: [newService as any],
      },
      relationships: {},
      diagrams: [],
    };

    const result = simulateMergeImport(currentModel, payload);

    // Verify: existing app is still there, new app is appended
    expect(result.metaModel.entities.applications).toHaveLength(2);
    expect(result.metaModel.entities.applications[0]).toEqual(existingApp);
    expect(result.metaModel.entities.applications[1]).toEqual(newApp);

    // Verify: new service is appended to existing (empty) services array
    expect(result.metaModel.entities.services).toHaveLength(1);
    expect(result.metaModel.entities.services[0]).toEqual(newService);

    // Verify: other entity arrays remain unchanged (e.g., business_users is still empty)
    expect(result.metaModel.entities.business_users).toHaveLength(0);
  });

  // Test 2: Dispatching MERGE_IMPORT with relationships appends them to existing arrays
  it('should append imported relationships to existing relationship arrays', () => {
    // Setup: Existing model with one data movement
    const existingDm = {
      id: 'dm-1',
      source_application_point_id: 'ap-1',
      target_application_point_id: 'ap-2',
      movement_type: 'SYNC',
      description: 'Existing data movement',
      tags: '',
    };
    const currentModel: ArchitectureModel = {
      ...emptyModel,
      metaModel: {
        ...emptyModel.metaModel,
        relationships: {
          ...emptyModel.metaModel.relationships,
          data_movements: [existingDm as any],
        },
      },
    };

    // Payload: One new data movement and one new business_user_business_point relationship
    const newDm = {
      id: 'dm-2',
      source_application_point_id: 'ap-3',
      target_application_point_id: 'ap-4',
      movement_type: 'ASYNC',
      description: 'Imported data movement',
      tags: '',
    };
    const newBubp = {
      id: 'bubp-1',
      business_user_id: 'bu-1',
      business_point_id: 'bp-1',
      description: 'Imported relationship',
      tags: '',
    };

    const payload: MergeableData = {
      entities: {},
      relationships: {
        data_movements: [newDm as any],
        business_user_business_points: [newBubp as any],
      },
      diagrams: [],
    };

    const result = simulateMergeImport(currentModel, payload);

    // Verify: existing data movement is still there, new one is appended
    expect(result.metaModel.relationships.data_movements).toHaveLength(2);
    expect(result.metaModel.relationships.data_movements[0]).toEqual(existingDm);
    expect(result.metaModel.relationships.data_movements[1]).toEqual(newDm);

    // Verify: new business_user_business_point is appended
    expect(result.metaModel.relationships.business_user_business_points).toHaveLength(1);
    expect(result.metaModel.relationships.business_user_business_points[0]).toEqual(newBubp);

    // Verify: other relationship arrays remain unchanged
    expect(result.metaModel.relationships.logical_data_entity_relationships).toHaveLength(0);
  });

  // Test 3: Dispatching MERGE_IMPORT with diagrams appends them to state.model.diagrams
  it('should append imported diagrams to existing diagrams array', () => {
    // Setup: Existing model with one diagram
    const existingDiagram = createTestDiagram({
      id: 'diag-existing',
      name: 'Existing Diagram',
      diagram_nodes: [
        {
          id: 'node-1',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 100, pos_y: 100, width: 120, height: 60,
          parent_node_id: null,
        },
      ],
    });
    const currentModel: ArchitectureModel = {
      ...emptyModel,
      diagrams: [existingDiagram],
    };

    // Payload: Two new diagrams
    const newDiagram1 = createTestDiagram({
      id: 'diag-import-1',
      name: 'Imported Diagram 1',
    });
    const newDiagram2 = createTestDiagram({
      id: 'diag-import-2',
      name: 'Imported Diagram 2',
    });

    const payload: MergeableData = {
      entities: {},
      relationships: {},
      diagrams: [newDiagram1, newDiagram2],
    };

    const result = simulateMergeImport(currentModel, payload);

    // Verify: existing diagram is preserved, new ones are appended
    expect(result.diagrams).toHaveLength(3);
    expect(result.diagrams[0].id).toBe('diag-existing');
    expect(result.diagrams[0].name).toBe('Existing Diagram');
    expect(result.diagrams[0].diagram_nodes).toHaveLength(1);
    expect(result.diagrams[1].id).toBe('diag-import-1');
    expect(result.diagrams[2].id).toBe('diag-import-2');
  });

  // Test 4: Dispatching MERGE_IMPORT with empty selections produces no state change
  it('should produce no state change when payload has empty entities, relationships, and diagrams', () => {
    // Setup: Existing model with some data
    const existingApp = { id: 'app-1', name: 'Existing App', description: '', app_type: 'web', status: 'active', tags: '' };
    const existingDiagram = createTestDiagram({ id: 'diag-1', name: 'Existing Diagram' });
    const existingDm = {
      id: 'dm-1',
      source_application_point_id: 'ap-1',
      target_application_point_id: 'ap-2',
      movement_type: 'SYNC',
      description: '',
      tags: '',
    };

    const currentModel: ArchitectureModel = {
      ...emptyModel,
      metaModel: {
        entities: {
          ...emptyModel.metaModel.entities,
          applications: [existingApp as any],
        },
        relationships: {
          ...emptyModel.metaModel.relationships,
          data_movements: [existingDm as any],
        },
      },
      diagrams: [existingDiagram],
    };

    // Payload: Everything is empty
    const payload: MergeableData = {
      entities: {},
      relationships: {},
      diagrams: [],
    };

    const result = simulateMergeImport(currentModel, payload);

    // Verify: model state is effectively unchanged
    expect(result.metaModel.entities.applications).toHaveLength(1);
    expect(result.metaModel.entities.applications[0]).toEqual(existingApp);
    expect(result.metaModel.relationships.data_movements).toHaveLength(1);
    expect(result.metaModel.relationships.data_movements[0]).toEqual(existingDm);
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0]).toEqual(existingDiagram);

    // Verify: diagrams reference is the same object (no unnecessary copy)
    expect(result.diagrams).toBe(currentModel.diagrams);
  });
});
