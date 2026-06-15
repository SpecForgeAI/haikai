/**
 * Tests for Import Merge Utility Functions
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 1: Shared Import Utilities and ID Conflict Resolution
 *
 * 6 focused tests covering:
 * 1. resolveIdConflicts: no conflicts returns data unchanged
 * 2. resolveIdConflicts: entity ID collision generates new UUID and updates remap map
 * 3. resolveIdConflicts: relationship FK fields cascade-update to new entity IDs
 * 4. resolveIdConflicts: diagram node entity_id fields cascade-update
 * 5. resolveIdConflicts: diagram edge relationship_id fields cascade-update
 * 6. buildMergeSummary: produces correct count strings
 */

import { describe, it, expect } from 'vitest';
import {
  resolveIdConflicts,
  buildMergeSummary,
  validateSnapshotSchema,
  extractCherryPickData,
  convertXlsxResultToCherryPickData,
  type MergeableData,
} from '../utils/importMergeUtils';
import type { ArchitectureModel } from '../types/model';
import { emptyModel } from '../config/defaults';
import type { ProjectSnapshotDto } from '../api/projectSnapshotApi';
import type { ImportResult } from '../utils/excelOperations';

// ============================================================================
// Helper: create a current model with some existing IDs
// ============================================================================

function createModelWithIds(entityIds: string[], relIds: string[], diagramIds: string[]): ArchitectureModel {
  const model: ArchitectureModel = JSON.parse(JSON.stringify(emptyModel));

  // Add entities with given IDs to applications collection
  for (const id of entityIds) {
    model.metaModel.entities.applications.push({
      id,
      name: `App-${id}`,
      description: '',
      app_type: '',
      status: '',
      tags: '',
    });
  }

  // Add relationships with given IDs to data_movements collection
  for (const id of relIds) {
    model.metaModel.relationships.data_movements.push({
      id,
      source_application_point_id: 'ap-1',
      target_application_point_id: 'ap-2',
      movement_type: 'API',
      description: '',
      tags: '',
    });
  }

  // Add diagrams with given IDs
  for (const id of diagramIds) {
    model.diagrams.push({
      id,
      name: `Diagram-${id}`,
      description: '',
      diagram_nodes: [],
      diagram_edges: [],
    });
  }

  return model;
}

// ============================================================================
// Test 1: resolveIdConflicts - no conflicts returns data unchanged
// ============================================================================

describe('resolveIdConflicts', () => {
  it('returns data unchanged when there are no ID conflicts', () => {
    const currentModel = createModelWithIds(['existing-1', 'existing-2'], [], []);

    const selectedData: MergeableData = {
      entities: {
        applications: [
          { id: 'new-app-1', name: 'New App 1', description: '', app_type: '', status: '', tags: '' },
          { id: 'new-app-2', name: 'New App 2', description: '', app_type: '', status: '', tags: '' },
        ],
      },
      relationships: {},
      diagrams: [],
    };

    const result = resolveIdConflicts(selectedData, currentModel);

    // Should return the exact same object (no deep clone needed)
    expect(result).toBe(selectedData);
    expect(result.entities.applications![0].id).toBe('new-app-1');
    expect(result.entities.applications![1].id).toBe('new-app-2');
  });

  // ============================================================================
  // Test 2: resolveIdConflicts - entity ID collision generates new UUID
  // ============================================================================

  it('generates new UUID for entity ID that collides with existing model', () => {
    const conflictingId = 'existing-app-1';
    const currentModel = createModelWithIds([conflictingId], [], []);

    const selectedData: MergeableData = {
      entities: {
        applications: [
          { id: conflictingId, name: 'Imported App', description: '', app_type: '', status: '', tags: '' },
          { id: 'no-conflict', name: 'Safe App', description: '', app_type: '', status: '', tags: '' },
        ],
      },
      relationships: {},
      diagrams: [],
    };

    const result = resolveIdConflicts(selectedData, currentModel);

    // The conflicting ID should have been remapped to a new UUID
    expect(result.entities.applications![0].id).not.toBe(conflictingId);
    // UUID format check: 8-4-4-4-12 hex digits
    expect(result.entities.applications![0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // The non-conflicting ID should remain unchanged
    expect(result.entities.applications![1].id).toBe('no-conflict');
  });

  // ============================================================================
  // Test 3: resolveIdConflicts - relationship FK fields cascade-update
  // ============================================================================

  it('cascade-updates relationship FK fields when entity IDs are remapped', () => {
    const conflictingEntityId = 'entity-conflict';
    const currentModel = createModelWithIds([conflictingEntityId], [], []);

    const selectedData: MergeableData = {
      entities: {
        application_points: [
          {
            id: conflictingEntityId,
            name: 'Conflicting AP',
            description: '',
            kind: 'APPLICATION',
            application_id: 'some-app',
            point_type: '',
            tags: '',
          },
        ],
      },
      relationships: {
        data_movements: [
          {
            id: 'dm-1',
            source_application_point_id: conflictingEntityId,
            target_application_point_id: 'ap-other',
            movement_type: 'API',
            description: '',
            tags: '',
          },
        ],
        business_user_business_points: [
          {
            id: 'bubp-1',
            business_user_id: conflictingEntityId,
            business_point_id: 'bp-other',
            description: '',
            tags: '',
          },
        ],
        application_point_business_points: [
          {
            id: 'apbp-1',
            application_point_id: conflictingEntityId,
            business_point_id: 'bp-other',
            description: '',
            tags: '',
          },
        ],
      },
      diagrams: [],
    };

    const result = resolveIdConflicts(selectedData, currentModel);

    // The entity should have a new ID
    const newEntityId = (result.entities.application_points![0] as Record<string, unknown>).id as string;
    expect(newEntityId).not.toBe(conflictingEntityId);

    // DataMovement source_application_point_id should cascade to the new ID
    const dm = result.relationships.data_movements![0] as Record<string, unknown>;
    expect(dm.source_application_point_id).toBe(newEntityId);
    // target_application_point_id should remain unchanged (no conflict)
    expect(dm.target_application_point_id).toBe('ap-other');

    // BusinessUserBusinessPoint business_user_id should cascade
    const bubp = result.relationships.business_user_business_points![0] as Record<string, unknown>;
    expect(bubp.business_user_id).toBe(newEntityId);

    // ApplicationPointBusinessPoint application_point_id should cascade
    const apbp = result.relationships.application_point_business_points![0] as Record<string, unknown>;
    expect(apbp.application_point_id).toBe(newEntityId);
  });

  // ============================================================================
  // Test 4: resolveIdConflicts - diagram node entity_id cascade-update
  // ============================================================================

  it('cascade-updates diagram node entity_id fields when entity IDs are remapped', () => {
    const conflictingEntityId = 'entity-for-node';
    const currentModel = createModelWithIds([conflictingEntityId], [], []);

    const selectedData: MergeableData = {
      entities: {
        services: [
          {
            id: conflictingEntityId,
            name: 'Conflicting Service',
            description: '',
            application_id: 'app-1',
            service_type: 'API',
            tags: '',
          },
        ],
      },
      relationships: {},
      diagrams: [
        {
          id: 'diagram-1',
          name: 'Test Diagram',
          description: '',
          diagram_nodes: [
            {
              id: 'node-1',
              entity_type: 'SERVICE',
              entity_id: conflictingEntityId,
              pos_x: 0,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
            {
              id: 'node-2',
              entity_type: 'APPLICATION',
              entity_id: 'no-conflict-entity',
              pos_x: 200,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
          ],
          diagram_edges: [],
        },
      ],
    };

    const result = resolveIdConflicts(selectedData, currentModel);

    // The entity should have a new ID
    const newEntityId = (result.entities.services![0] as Record<string, unknown>).id as string;
    expect(newEntityId).not.toBe(conflictingEntityId);

    // The diagram node's entity_id should cascade to the new ID
    expect(result.diagrams[0].diagram_nodes[0].entity_id).toBe(newEntityId);

    // The other node should be unchanged
    expect(result.diagrams[0].diagram_nodes[1].entity_id).toBe('no-conflict-entity');
  });

  // ============================================================================
  // Test 5: resolveIdConflicts - diagram edge relationship_id cascade-update
  // ============================================================================

  it('cascade-updates diagram edge relationship_id fields when relationship IDs are remapped', () => {
    const conflictingRelId = 'rel-conflict';
    const currentModel = createModelWithIds([], [conflictingRelId], []);

    const selectedData: MergeableData = {
      entities: {},
      relationships: {
        data_movements: [
          {
            id: conflictingRelId,
            source_application_point_id: 'ap-1',
            target_application_point_id: 'ap-2',
            movement_type: 'API',
            description: '',
            tags: '',
          },
        ],
      },
      diagrams: [
        {
          id: 'diagram-2',
          name: 'Test Diagram 2',
          description: '',
          diagram_nodes: [],
          diagram_edges: [
            {
              id: 'edge-1',
              relationship_type: 'DATA_MOVEMENT',
              relationship_id: conflictingRelId,
              source_node_id: 'node-a',
              target_node_id: 'node-b',
              edge_points: [],
            },
            {
              id: 'edge-2',
              relationship_type: 'DATA_MOVEMENT',
              relationship_id: 'no-conflict-rel',
              source_node_id: 'node-c',
              target_node_id: 'node-d',
              edge_points: [],
            },
          ],
        },
      ],
    };

    const result = resolveIdConflicts(selectedData, currentModel);

    // The relationship should have a new ID
    const newRelId = (result.relationships.data_movements![0] as Record<string, unknown>).id as string;
    expect(newRelId).not.toBe(conflictingRelId);

    // The diagram edge's relationship_id should cascade to the new ID
    expect(result.diagrams[0].diagram_edges[0].relationship_id).toBe(newRelId);

    // The other edge should be unchanged
    expect(result.diagrams[0].diagram_edges[1].relationship_id).toBe('no-conflict-rel');
  });
});

// ============================================================================
// Test 6: buildMergeSummary - produces correct count strings
// ============================================================================

describe('buildMergeSummary', () => {
  it('produces correct count strings from selected merge data', () => {
    const data: MergeableData = {
      entities: {
        applications: [
          { id: 'a1', name: 'App 1', description: '', app_type: '', status: '', tags: '' },
          { id: 'a2', name: 'App 2', description: '', app_type: '', status: '', tags: '' },
          { id: 'a3', name: 'App 3', description: '', app_type: '', status: '', tags: '' },
        ],
        services: [
          { id: 's1', name: 'Svc 1', description: '', application_id: '', service_type: '', tags: '' },
          { id: 's2', name: 'Svc 2', description: '', application_id: '', service_type: '', tags: '' },
        ],
      },
      relationships: {},
      diagrams: [
        {
          id: 'd1',
          name: 'Diag 1',
          description: '',
          diagram_nodes: [],
          diagram_edges: [],
        },
      ],
    };

    const summary = buildMergeSummary(data);

    expect(summary).toContain('3 Applications');
    expect(summary).toContain('2 Services');
    expect(summary).toContain('1 Diagram');
    expect(summary).toMatch(/^Merged /);
  });

  it('returns "No items merged" when data is empty', () => {
    const data: MergeableData = {
      entities: {},
      relationships: {},
      diagrams: [],
    };

    expect(buildMergeSummary(data)).toBe('No items merged');
  });
});

// ============================================================================
// Additional tests for validateSnapshotSchema
// ============================================================================

describe('validateSnapshotSchema', () => {
  it('returns valid for a well-formed snapshot', () => {
    const snapshot = {
      project: { name: 'Test Project' },
      meta: { snapshot_version: 1, exported_at: '2026-01-01', export_kind: 'full' },
      model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
      work_items: [],
      artifacts: [],
    };

    const result = validateSnapshotSchema(snapshot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.project.name).toBe('Test Project');
  });

  it('returns errors for missing required fields', () => {
    const result = validateSnapshotSchema({ project: { name: 'ok' } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: meta');
    expect(result.errors).toContain('Missing required field: model');
  });

  it('returns error for missing project.name', () => {
    const result = validateSnapshotSchema({
      project: {},
      meta: {},
      model: {},
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid field: project.name');
  });

  it('returns error for non-object input', () => {
    const result = validateSnapshotSchema(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('File does not contain a valid JSON object');
  });
});

// ============================================================================
// Additional tests for extractCherryPickData
// ============================================================================

describe('extractCherryPickData', () => {
  it('extracts entities, relationships, and diagrams from snapshot', () => {
    const snapshot: ProjectSnapshotDto = {
      project: { id: 'p1', name: 'Test', projectParentFolder: '', projectHierarchy: null, organisationId: null, isActive: true, createdAt: '', updatedAt: '' },
      meta: { snapshot_version: 1, exported_at: '', export_kind: 'full' },
      model: {
        metaModel: {
          entities: {
            applications: [
              { id: 'a1', name: 'App 1' },
              { id: 'a2', name: 'App 2' },
            ],
            services: [],
          },
          relationships: {
            data_movements: [
              { id: 'dm1', description: 'Move 1' },
            ],
          },
        },
        diagrams: [
          { id: 'd1', name: 'Diagram 1' },
        ],
      },
      work_items: [{ id: 'wi1' }],
      artifacts: [{ id: 'art1' }],
    };

    const result = extractCherryPickData(snapshot);

    // Entities extracted (non-empty only)
    expect(result.entities.applications).toHaveLength(2);
    expect(result.entities.services).toBeUndefined(); // empty collection filtered out

    // Relationships extracted
    expect(result.relationships.data_movements).toHaveLength(1);

    // Diagrams extracted
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0].name).toBe('Diagram 1');

    // work_items and artifacts are excluded (not in the result shape at all)
    expect((result as Record<string, unknown>).work_items).toBeUndefined();
    expect((result as Record<string, unknown>).artifacts).toBeUndefined();
  });
});

// ============================================================================
// Additional tests for convertXlsxResultToCherryPickData
// ============================================================================

describe('convertXlsxResultToCherryPickData', () => {
  it('converts ImportResult to CherryPickData with combined new + updated entities', () => {
    const importResult: ImportResult = {
      success: true,
      worksheetResults: [],
      newEntities: {
        applications: [
          { id: 'new-1', name: 'New App 1' },
        ],
        services: [
          { id: 'new-svc', name: 'New Service' },
        ],
      },
      newRelationships: {},
      updatedEntities: {
        applications: [
          { id: 'upd-1', name: 'Updated App 1' },
        ],
      },
      updatedRelationships: {},
      ignoredWorksheets: [],
    };

    const result = convertXlsxResultToCherryPickData(importResult);

    // Applications should combine new + updated
    expect(result.entities.applications).toHaveLength(2);
    expect(result.entities.applications[0].name).toBe('New App 1');
    expect(result.entities.applications[1].name).toBe('Updated App 1');

    // Services should have new only
    expect(result.entities.services).toHaveLength(1);

    // Relationships and diagrams should be empty
    expect(Object.keys(result.relationships)).toHaveLength(0);
    expect(result.diagrams).toHaveLength(0);
  });
});
