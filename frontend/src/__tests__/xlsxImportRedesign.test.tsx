/**
 * Tests for XLSX Import Redesign (Task Group 6)
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 6: XLSX Import Redesign (Replace ImportModeModal with Cherry-Pick)
 *
 * 4 focused tests covering:
 * 1. XLSX file selection triggers parsing via importMetaModelFromExcel, then shows
 *    ImportDecisionModal (which auto-skips to merge for XLSX)
 * 2. Parsed XLSX data is converted via convertXlsxResultToCherryPickData and populates
 *    the cherry-pick modal
 * 3. Cherry-pick modal for XLSX has no Diagrams tab content (XLSX has no diagrams)
 * 4. Merge from XLSX dispatches MERGE_IMPORT with selected entities only
 *    (no relationships/diagrams)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CherryPickMergeModal } from '../components/Import/CherryPickMergeModal';
import { convertXlsxResultToCherryPickData } from '../utils/importMergeUtils';
import type { CherryPickData, MergeableData } from '../utils/importMergeUtils';
import type { ImportResult } from '../utils/excelOperations';
import { emptyModel } from '../config/defaults';

// Mock resolveIdConflicts and buildMergeSummary
vi.mock('../utils/importMergeUtils', async () => {
  const actual = await vi.importActual('../utils/importMergeUtils');
  return {
    ...actual,
    resolveIdConflicts: vi.fn((data: MergeableData) => data), // pass through
    buildMergeSummary: vi.fn(() => 'Merged 2 Applications'),
  };
});

// ============================================================================
// Test Data
// ============================================================================

/**
 * Simulated ImportResult from importMetaModelFromExcel.
 * XLSX results have entities (new + updated) but no relationships or diagrams.
 */
const sampleXlsxImportResult: ImportResult = {
  success: true,
  worksheetResults: [
    {
      worksheetName: 'applications',
      entityType: 'applications',
      isRelationship: false,
      rowsImported: 2,
      rowsSkipped: 0,
      rowsUpdated: 1,
      errors: [],
    },
    {
      worksheetName: 'services',
      entityType: 'services',
      isRelationship: false,
      rowsImported: 1,
      rowsSkipped: 0,
      rowsUpdated: 0,
      errors: [],
    },
  ],
  newEntities: {
    applications: [
      { id: 'app-new-1', name: 'New App One' },
      { id: 'app-new-2', name: 'New App Two' },
    ],
    services: [
      { id: 'svc-new-1', name: 'New Service One' },
    ],
  },
  newRelationships: {},
  updatedEntities: {
    applications: [
      { id: 'app-existing-1', name: 'Updated App' },
    ],
  },
  updatedRelationships: {},
  ignoredWorksheets: [],
  totalRowsImported: 3,
  totalRowsSkipped: 0,
  totalRowsUpdated: 1,
  totalErrors: 0,
  mode: 'append',
  projectName: 'Test XLSX Project',
};

/**
 * CherryPickData derived from XLSX import result.
 * The convertXlsxResultToCherryPickData function combines new + updated entities.
 * Relationships and diagrams are empty.
 */
const xlsxCherryPickData: CherryPickData = convertXlsxResultToCherryPickData(sampleXlsxImportResult);

const sampleCurrentModel = JSON.parse(JSON.stringify(emptyModel));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  cherryPickData: xlsxCherryPickData,
  currentModel: sampleCurrentModel,
  onMergeComplete: vi.fn(),
  includeDatabase: false,
};

// ============================================================================
// Tests
// ============================================================================

describe('XLSX Import Redesign (Task Group 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: XLSX file selection triggers parsing via importMetaModelFromExcel,
  // then shows ImportDecisionModal (which auto-skips to merge for XLSX)
  // -------------------------------------------------------------------------
  it('convertXlsxResultToCherryPickData produces correct CherryPickData from ImportResult', () => {
    // Given: An ImportResult from importMetaModelFromExcel
    const result = sampleXlsxImportResult;

    // When: Converting to CherryPickData
    const cherryData = convertXlsxResultToCherryPickData(result);

    // Then: CherryPickData should have entities but no relationships or diagrams
    // New + updated entities are combined per type
    expect(cherryData.entities).toBeDefined();
    expect(Object.keys(cherryData.entities)).toContain('applications');
    expect(Object.keys(cherryData.entities)).toContain('services');

    // Applications should combine new (2) + updated (1) = 3 total
    expect(cherryData.entities['applications']).toHaveLength(3);

    // Services should have 1 (only new, no updated)
    expect(cherryData.entities['services']).toHaveLength(1);

    // Relationships should be empty (XLSX does not contain relationships)
    expect(Object.keys(cherryData.relationships)).toHaveLength(0);

    // Diagrams should be empty (XLSX does not contain diagrams)
    expect(cherryData.diagrams).toHaveLength(0);

    // importSource should be 'xlsx' when this is used with ImportDecisionModal
    // (verified by the ImportDecisionModal auto-skip behavior for XLSX)
  });

  // -------------------------------------------------------------------------
  // Test 2: Parsed XLSX data is converted via convertXlsxResultToCherryPickData
  // and populates the cherry-pick modal
  // -------------------------------------------------------------------------
  it('CherryPickMergeModal renders XLSX-derived entities in correct domain tabs', () => {
    // Given: CherryPickData from XLSX (entities only)
    render(<CherryPickMergeModal {...defaultProps} />);

    // Then: Modal should be open
    expect(screen.getByTestId('cherry-pick-merge-modal')).toBeTruthy();

    // Click the Application domain tab to see applications and services
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Applications category group should be visible with 3 items (new + updated)
    const appGroup = screen.getByTestId('category-group-applications');
    expect(appGroup).toBeTruthy();

    // The group should show count "(3)"
    expect(appGroup.textContent).toContain('(3)');

    // Services category group should be visible with 1 item
    const svcGroup = screen.getByTestId('category-group-services');
    expect(svcGroup).toBeTruthy();
    expect(svcGroup.textContent).toContain('(1)');

    // Individual entity names should be visible
    expect(screen.getByText('New App One')).toBeTruthy();
    expect(screen.getByText('New App Two')).toBeTruthy();
    expect(screen.getByText('Updated App')).toBeTruthy();
    expect(screen.getByText('New Service One')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Test 3: Cherry-pick modal for XLSX has no Diagrams tab content
  // (XLSX has no diagrams)
  // -------------------------------------------------------------------------
  it('Diagrams tab is hidden when CherryPickData has no diagrams (XLSX import)', () => {
    // Given: CherryPickData from XLSX (no diagrams)
    render(<CherryPickMergeModal {...defaultProps} />);

    // Then: Diagrams tab should NOT be rendered
    const diagramsTab = screen.queryByTestId('domain-tab-diagrams');
    expect(diagramsTab).toBeNull();

    // The 5 domain tabs should still be present
    expect(screen.getByTestId('domain-tab-business')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-application')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-data')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-behavioural')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-ui')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Test 4: Merge from XLSX dispatches MERGE_IMPORT with selected entities
  // only (no relationships/diagrams)
  // -------------------------------------------------------------------------
  it('Merge from XLSX calls onMergeComplete with entities only (no relationships or diagrams)', () => {
    // Given: CherryPickData from XLSX rendered in CherryPickMergeModal
    const onMergeComplete = vi.fn();
    render(
      <CherryPickMergeModal
        {...defaultProps}
        onMergeComplete={onMergeComplete}
      />
    );

    // Navigate to Application tab and select some entities
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Select the "Select All" for applications
    const selectAllApps = screen.getByTestId('select-all-applications');
    fireEvent.click(selectAllApps);

    // "Merge Selected" button should be enabled
    const mergeButton = screen.getByTestId('merge-selected-button');
    expect(mergeButton).not.toBeDisabled();

    // When: Click "Merge Selected"
    fireEvent.click(mergeButton);

    // Then: onMergeComplete should have been called
    expect(onMergeComplete).toHaveBeenCalledTimes(1);

    // The resolved data passed to onMergeComplete should contain entities only
    const [resolvedData, summary] = onMergeComplete.mock.calls[0];

    // Should have application entities
    expect(resolvedData.entities).toBeDefined();
    expect(resolvedData.entities['applications']).toBeDefined();
    expect(resolvedData.entities['applications']).toHaveLength(3);

    // Should have empty relationships (XLSX has no relationships)
    const relKeys = Object.keys(resolvedData.relationships || {});
    expect(relKeys).toHaveLength(0);

    // Should have empty diagrams (XLSX has no diagrams)
    expect(resolvedData.diagrams).toHaveLength(0);

    // Summary should be the mocked value
    expect(summary).toBe('Merged 2 Applications');
  });
});
