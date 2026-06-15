/**
 * TopBar Import/Export Routing Tests
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 5: Import/Export Flow Routing
 *
 * Tests for import/export routing based on includeDatabase mode:
 * - Test 1: In DB mode, JSON export calls exportActiveProjectSnapshot
 * - Test 2: In no-DB mode, JSON export calls exportSessionSnapshot
 * - Test 3: In DB mode, import calls importProjectSnapshot
 * - Test 4: In no-DB mode, import calls importToSession
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies BEFORE importing helpers
vi.mock('../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: vi.fn(),
  importProjectSnapshot: vi.fn(),
  mapImportResultFromSnake: vi.fn((d) => d),
}));

vi.mock('../api/projectSessionApi', () => ({
  exportSessionSnapshot: vi.fn(),
  importToSession: vi.fn(),
  getSessionProject: vi.fn(),
}));

// Import mocked modules
import { exportActiveProjectSnapshot, importProjectSnapshot } from '../api/projectSnapshotApi';
import { exportSessionSnapshot, importToSession } from '../api/projectSessionApi';

// Import the test helpers (they use the mocked APIs)
import { executeJsonExportForTest, executeImportForTest } from './topBarTestHelpers';

describe('Task Group 5: Import/Export Routing Tests', () => {
  const mockProject = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Project',
    projectParentFolder: '/test/folder',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-22T00:00:00Z',
    updatedAt: '2026-01-22T00:00:00Z',
  };

  const mockSnapshot = {
    meta: {
      snapshot_version: 1,
      exported_at: '2026-01-22T00:00:00Z',
      export_kind: 'FULL',
    },
    project: mockProject,
    model: null,
    work_items: [],
    artifacts: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Test 1: In DB mode, JSON export calls exportActiveProjectSnapshot
  // =========================================================================

  describe('Test 5.1: DB mode JSON export', () => {
    it('should call exportActiveProjectSnapshot in DB mode', async () => {
      // Arrange
      vi.mocked(exportActiveProjectSnapshot).mockResolvedValue(mockSnapshot as any);

      // Act
      await executeJsonExportForTest(true, 'Test Project');

      // Assert
      expect(exportActiveProjectSnapshot).toHaveBeenCalled();
      expect(exportSessionSnapshot).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 2: In no-DB mode, JSON export calls exportSessionSnapshot
  // =========================================================================

  describe('Test 5.2: No-DB mode JSON export', () => {
    it('should call exportSessionSnapshot in no-DB mode', async () => {
      // Arrange
      vi.mocked(exportSessionSnapshot).mockResolvedValue(mockSnapshot as any);

      // Act
      await executeJsonExportForTest(false, 'Test Project');

      // Assert
      expect(exportSessionSnapshot).toHaveBeenCalled();
      expect(exportActiveProjectSnapshot).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 3: In DB mode, import calls importProjectSnapshot
  // =========================================================================

  describe('Test 5.3: DB mode import', () => {
    it('should call importProjectSnapshot in DB mode', async () => {
      // Arrange
      vi.mocked(importProjectSnapshot).mockResolvedValue({
        project: mockProject,
        modelSaved: true,
        workItemsInserted: 0,
        artifactsInserted: 0,
        warnings: [],
      });

      // Act
      await executeImportForTest(true, mockSnapshot as any);

      // Assert
      expect(importProjectSnapshot).toHaveBeenCalled();
      expect(importToSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 4: In no-DB mode, import calls importToSession
  // =========================================================================

  describe('Test 5.4: No-DB mode import', () => {
    it('should call importToSession in no-DB mode', async () => {
      // Arrange
      vi.mocked(importToSession).mockResolvedValue({
        project: mockProject,
        modelSaved: false,
        workItemsInserted: 0,
        artifactsInserted: 0,
        warnings: [],
      });

      // Act
      await executeImportForTest(false, mockSnapshot as any);

      // Assert
      expect(importToSession).toHaveBeenCalled();
      expect(importProjectSnapshot).not.toHaveBeenCalled();
    });
  });
});
