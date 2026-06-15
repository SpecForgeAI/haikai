/**
 * Import Integration Tests
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 7: Cleanup and Test Review
 *
 * Additional integration tests to fill critical coverage gaps across the
 * import redesign feature. These tests cover end-to-end workflows and
 * edge cases not covered by individual Task Group tests.
 *
 * Tests:
 * 1. resolveIdConflicts with diagram ID collision
 * 2. extractCherryPickData excludes work_items/artifacts and filters empty collections
 * 3. buildMergeSummary includes relationship counts
 * 4. convertXlsxResultToCherryPickData with empty ImportResult
 * 5. validateSnapshotSchema rejects string input as non-object
 * 6. Diagram auto-selection with multiple diagrams sharing entity references
 * 7. CherryPickMergeModal: Select All then Merge produces correct MergeableData
 * 8. CherryPickMergeModal does not render when isOpen is false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  type MergeableData,
  type CherryPickData,
} from '../utils/importMergeUtils';
import type { ArchitectureModel } from '../types/model';
import type { ProjectSnapshotDto } from '../api/projectSnapshotApi';
import type { ImportResult } from '../utils/excelOperations';
import { emptyModel } from '../config/defaults';
import { CherryPickMergeModal } from '../components/Import/CherryPickMergeModal';

// Mock resolveIdConflicts and buildMergeSummary for component tests
vi.mock('../utils/importMergeUtils', async () => {
  const actual = await vi.importActual('../utils/importMergeUtils');
  return {
    ...actual,
    resolveIdConflicts: vi.fn((data: MergeableData) => data),
    buildMergeSummary: vi.fn(() => 'Merged 3 Applications'),
  };
});

// ============================================================================
// Helper: create a model with existing IDs for conflict testing
// ============================================================================

function createModelWithData(
  entityIds: string[] = [],
  relIds: string[] = [],
  diagramIds: string[] = []
): ArchitectureModel {
  const model: ArchitectureModel = JSON.parse(JSON.stringify(emptyModel));
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
// Tests
// ============================================================================

describe('Import Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: resolveIdConflicts with diagram ID collision
  // --------------------------------------------------------------------------
  it('resolveIdConflicts remaps diagram IDs that collide with existing model diagrams', async () => {
    // Use the real resolveIdConflicts (not mocked)
    const { resolveIdConflicts: realResolve } = await vi.importActual<
      typeof import('../utils/importMergeUtils')
    >('../utils/importMergeUtils');

    const conflictingDiagramId = 'diagram-existing';
    const currentModel = createModelWithData([], [], [conflictingDiagramId]);

    const selectedData: MergeableData = {
      entities: {},
      relationships: {},
      diagrams: [
        {
          id: conflictingDiagramId,
          name: 'Imported Diagram',
          description: '',
          diagram_nodes: [],
          diagram_edges: [],
        },
      ],
    };

    const result = realResolve(selectedData, currentModel);

    // The diagram ID should have been remapped
    expect(result.diagrams[0].id).not.toBe(conflictingDiagramId);
    expect(result.diagrams[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // Name should be preserved
    expect(result.diagrams[0].name).toBe('Imported Diagram');
  });

  // --------------------------------------------------------------------------
  // Test 2: extractCherryPickData excludes work_items/artifacts and empty collections
  // --------------------------------------------------------------------------
  it('extractCherryPickData excludes work_items, artifacts, and empty entity collections', async () => {
    const { extractCherryPickData: realExtract } = await vi.importActual<
      typeof import('../utils/importMergeUtils')
    >('../utils/importMergeUtils');

    const snapshot: ProjectSnapshotDto = {
      project: {
        id: 'p1',
        name: 'Test',
        projectParentFolder: '',
        projectHierarchy: null,
        organisationId: null,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
      meta: { snapshot_version: 1, exported_at: '', export_kind: 'full' },
      model: {
        metaModel: {
          entities: {
            applications: [{ id: 'a1', name: 'App 1' }],
            services: [], // empty - should be filtered out
            business_users: [], // empty
          },
          relationships: {
            data_movements: [{ id: 'dm1', description: 'DM 1' }],
            logical_data_entity_relationships: [], // empty
          },
        },
        diagrams: [
          { id: 'd1', name: 'Diagram 1', description: '', diagram_nodes: [], diagram_edges: [] },
        ],
      },
      work_items: [{ id: 'wi1' }],
      artifacts: [{ id: 'art1' }],
    };

    const result = realExtract(snapshot);

    // Entities: only non-empty collections
    expect(result.entities.applications).toHaveLength(1);
    expect(result.entities.services).toBeUndefined();
    expect(result.entities.business_users).toBeUndefined();

    // Relationships: only non-empty collections
    expect(result.relationships.data_movements).toHaveLength(1);
    expect(result.relationships.logical_data_entity_relationships).toBeUndefined();

    // Diagrams included
    expect(result.diagrams).toHaveLength(1);

    // work_items and artifacts are excluded
    expect((result as Record<string, unknown>).work_items).toBeUndefined();
    expect((result as Record<string, unknown>).artifacts).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test 3: buildMergeSummary includes relationship counts
  // --------------------------------------------------------------------------
  it('buildMergeSummary includes relationship type counts in summary', async () => {
    const { buildMergeSummary: realSummary } = await vi.importActual<
      typeof import('../utils/importMergeUtils')
    >('../utils/importMergeUtils');

    const data: MergeableData = {
      entities: {
        applications: [
          { id: 'a1', name: 'App 1', description: '', app_type: '', status: '', tags: '' },
        ],
      },
      relationships: {
        data_movements: [
          {
            id: 'dm1',
            source_application_point_id: 'ap-1',
            target_application_point_id: 'ap-2',
            movement_type: 'API',
            description: '',
            tags: '',
          },
          {
            id: 'dm2',
            source_application_point_id: 'ap-3',
            target_application_point_id: 'ap-4',
            movement_type: 'FILE',
            description: '',
            tags: '',
          },
        ],
      },
      diagrams: [],
    };

    const summary = realSummary(data);
    expect(summary).toContain('1 Application');
    expect(summary).toContain('2 Data Movements');
    expect(summary).toMatch(/^Merged /);
  });

  // --------------------------------------------------------------------------
  // Test 4: convertXlsxResultToCherryPickData with empty ImportResult
  // --------------------------------------------------------------------------
  it('convertXlsxResultToCherryPickData handles empty import result gracefully', async () => {
    const { convertXlsxResultToCherryPickData: realConvert } = await vi.importActual<
      typeof import('../utils/importMergeUtils')
    >('../utils/importMergeUtils');

    const emptyResult: ImportResult = {
      success: true,
      worksheetResults: [],
      newEntities: {},
      newRelationships: {},
      updatedEntities: {},
      updatedRelationships: {},
      ignoredWorksheets: [],
    };

    const result = realConvert(emptyResult);

    // All collections should be empty
    expect(Object.keys(result.entities)).toHaveLength(0);
    expect(Object.keys(result.relationships)).toHaveLength(0);
    expect(result.diagrams).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test 5: validateSnapshotSchema rejects non-object (string) input
  // --------------------------------------------------------------------------
  it('validateSnapshotSchema rejects string input as invalid non-object', async () => {
    const { validateSnapshotSchema: realValidate } = await vi.importActual<
      typeof import('../utils/importMergeUtils')
    >('../utils/importMergeUtils');

    const result = realValidate('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('File does not contain a valid JSON object');
    expect(result.snapshot).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 6: Diagram auto-selection with multiple diagrams sharing entity references
  // --------------------------------------------------------------------------
  it('auto-selects shared entities when multiple diagrams reference them, keeps them when one diagram is unchecked', () => {
    const sharedEntityId = 'shared-app';
    const exclusiveEntityId = 'only-diag2';

    const cherryPickData: CherryPickData = {
      entities: {
        applications: [
          { id: sharedEntityId, name: 'Shared App' },
          { id: exclusiveEntityId, name: 'Only Diag2 App' },
        ],
      },
      relationships: {},
      diagrams: [
        {
          id: 'diag-1',
          name: 'Diagram 1',
          diagram_nodes: [
            { id: 'n1', entity_id: sharedEntityId, entity_type: 'Application' },
          ],
          diagram_edges: [],
          description: '',
        } as unknown as import('../utils/importMergeUtils').NamedItem,
        {
          id: 'diag-2',
          name: 'Diagram 2',
          diagram_nodes: [
            { id: 'n2', entity_id: sharedEntityId, entity_type: 'Application' },
            { id: 'n3', entity_id: exclusiveEntityId, entity_type: 'Application' },
          ],
          diagram_edges: [],
          description: '',
        } as unknown as import('../utils/importMergeUtils').NamedItem,
      ],
    };

    render(
      <CherryPickMergeModal
        isOpen={true}
        onClose={vi.fn()}
        cherryPickData={cherryPickData}
        currentModel={JSON.parse(JSON.stringify(emptyModel))}
        onMergeComplete={vi.fn()}
        includeDatabase={false}
      />
    );

    // Check both diagrams
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-1'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-2'));

    // Switch to Application tab and verify both entities are auto-selected
    fireEvent.click(screen.getByTestId('domain-tab-application'));
    expect((screen.getByTestId(`checkbox-${sharedEntityId}`) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId(`checkbox-${exclusiveEntityId}`) as HTMLInputElement).checked).toBe(true);

    // Uncheck diagram 1 -- shared entity should remain because diag-2 still references it
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-1'));

    // Verify shared entity is still selected (referenced by diag-2)
    fireEvent.click(screen.getByTestId('domain-tab-application'));
    expect((screen.getByTestId(`checkbox-${sharedEntityId}`) as HTMLInputElement).checked).toBe(true);
    // Exclusive entity should also still be selected (referenced by diag-2)
    expect((screen.getByTestId(`checkbox-${exclusiveEntityId}`) as HTMLInputElement).checked).toBe(true);

    // Now uncheck diagram 2 -- both entities should be unchecked (no diagrams reference them)
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-2'));

    fireEvent.click(screen.getByTestId('domain-tab-application'));
    expect((screen.getByTestId(`checkbox-${sharedEntityId}`) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId(`checkbox-${exclusiveEntityId}`) as HTMLInputElement).checked).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 7: CherryPickMergeModal: Select All then Merge produces correct MergeableData
  // --------------------------------------------------------------------------
  it('Select All for a category then Merge includes all items from that category', () => {
    const cherryPickData: CherryPickData = {
      entities: {
        applications: [
          { id: 'app-1', name: 'App One' },
          { id: 'app-2', name: 'App Two' },
          { id: 'app-3', name: 'App Three' },
        ],
      },
      relationships: {},
      diagrams: [],
    };

    const onMergeComplete = vi.fn();

    render(
      <CherryPickMergeModal
        isOpen={true}
        onClose={vi.fn()}
        cherryPickData={cherryPickData}
        currentModel={JSON.parse(JSON.stringify(emptyModel))}
        onMergeComplete={onMergeComplete}
        includeDatabase={false}
      />
    );

    // Navigate to Application tab
    fireEvent.click(screen.getByTestId('domain-tab-application'));

    // Click Select All for applications
    fireEvent.click(screen.getByTestId('select-all-applications'));

    // Verify all three are checked
    expect((screen.getByTestId('checkbox-app-1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('checkbox-app-2') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('checkbox-app-3') as HTMLInputElement).checked).toBe(true);

    // Click Merge Selected
    fireEvent.click(screen.getByTestId('merge-selected-button'));

    // Verify onMergeComplete was called
    expect(onMergeComplete).toHaveBeenCalledTimes(1);

    const [resolvedData] = onMergeComplete.mock.calls[0];
    expect(resolvedData.entities.applications).toHaveLength(3);
    expect(resolvedData.diagrams).toHaveLength(0);
    expect(Object.keys(resolvedData.relationships)).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test 8: CherryPickMergeModal does not render when isOpen is false
  // --------------------------------------------------------------------------
  it('does not render modal content when isOpen is false', () => {
    const cherryPickData: CherryPickData = {
      entities: {
        applications: [{ id: 'app-1', name: 'App One' }],
      },
      relationships: {},
      diagrams: [],
    };

    render(
      <CherryPickMergeModal
        isOpen={false}
        onClose={vi.fn()}
        cherryPickData={cherryPickData}
        currentModel={JSON.parse(JSON.stringify(emptyModel))}
        onMergeComplete={vi.fn()}
        includeDatabase={false}
      />
    );

    // Modal should not be rendered
    expect(screen.queryByTestId('cherry-pick-merge-modal')).toBeNull();
    expect(screen.queryByTestId('merge-selected-button')).toBeNull();
  });
});
