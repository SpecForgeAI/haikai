/**
 * Export JSON Snapshot Tests
 *
 * Spec 2026-01-07: Replace JSON Export with Backend Project Snapshot
 * Task Group 3: Export Flow Testing
 *
 * These tests verify:
 * - exportActiveProjectSnapshot API function behavior
 * - handleExportJsonClick handler logic (via unit test pattern)
 * - Filename sanitization for export
 * - Error handling for 404 (no active project) and other failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportActiveProjectSnapshot,
  ProjectSnapshotDto,
} from '../api/projectSnapshotApi';
import { sanitizeFilename, triggerDownload } from '../utils/fileOperations';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a mock ProjectSnapshotDto for testing.
 */
function createMockSnapshot(projectName: string): ProjectSnapshotDto {
  return {
    meta: {
      snapshot_version: 1,
      exported_at: '2026-01-07T10:00:00Z',
      export_kind: 'full',
    },
    project: {
      id: 'proj-001',
      name: projectName,
      projectParentFolder: '/projects',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-07T10:00:00Z',
    },
    model: {
      metaModel: {
        entities: {},
        relationships: {},
      },
      diagrams: [],
    },
    work_items: [],
    artifacts: [],
  };
}

// ============================================================================
// Section 3.2: Tests for projectSnapshotApi.ts export function
// ============================================================================

describe('projectSnapshotApi: exportActiveProjectSnapshot', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ProjectSnapshotDto on successful 200 response', async () => {
    // Arrange
    const mockSnapshot = createMockSnapshot('Test Project');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSnapshot),
    });

    // Act
    const result = await exportActiveProjectSnapshot();

    // Assert
    expect(result).not.toBeNull();
    expect(result?.project.name).toBe('Test Project');
    expect(result?.meta.snapshot_version).toBe(1);
    expect(result?.model).toBeDefined();
    expect(result?.work_items).toEqual([]);
    expect(result?.artifacts).toEqual([]);

    // Verify fetch was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/active/export',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('returns null on 404 response (no active project)', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // Act
    const result = await exportActiveProjectSnapshot();

    // Assert
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws Error with backend message on 500 response', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Database connection failed' }),
    });

    // Act & Assert
    await expect(exportActiveProjectSnapshot()).rejects.toThrow(
      'Database connection failed'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws Error with status text when backend provides no message', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.reject(new Error('Not JSON')),
    });

    // Act & Assert
    await expect(exportActiveProjectSnapshot()).rejects.toThrow(
      'Failed to export project snapshot: 503 Service Unavailable'
    );
  });
});

// ============================================================================
// Section 3.1: Tests for handleExportJsonClick behavior (unit test approach)
// ============================================================================

describe('handleExportJsonClick behavior', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  // Mock for triggerDownload - we need to track calls
  const mockTriggerDownload = vi.fn();
  const mockSetErrorMessages = vi.fn();
  const mockSetErrorModalOpen = vi.fn();

  /**
   * Simulates the handleExportJsonClick logic from TopBar.tsx
   * This is a unit test approach - testing the logic without rendering React components
   */
  async function simulateHandleExportJsonClick(): Promise<void> {
    try {
      const snapshot = await exportActiveProjectSnapshot();

      if (snapshot === null) {
        // No active project - show error
        mockSetErrorMessages(['No active project to export']);
        mockSetErrorModalOpen(true);
        return;
      }

      // Generate filename from project name
      const projectName = snapshot.project?.name || 'project';
      const sanitizedName = sanitizeFilename(projectName);
      const filename = `${sanitizedName}-snapshot.json`;

      // Trigger download
      const json = JSON.stringify(snapshot, null, 2);
      mockTriggerDownload(json, filename);
    } catch (err) {
      mockSetErrorMessages([
        err instanceof Error ? err.message : 'Failed to export project snapshot',
      ]);
      mockSetErrorModalOpen(true);
    }
  }

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();
    mockTriggerDownload.mockClear();
    mockSetErrorMessages.mockClear();
    mockSetErrorModalOpen.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('triggers download with correct filename on successful export', async () => {
    // Arrange
    const mockSnapshot = createMockSnapshot('My Architecture Project');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSnapshot),
    });

    // Act
    await simulateHandleExportJsonClick();

    // Assert
    expect(mockTriggerDownload).toHaveBeenCalledTimes(1);
    expect(mockTriggerDownload).toHaveBeenCalledWith(
      expect.any(String),
      'My Architecture Project-snapshot.json'
    );

    // Verify no error modal was shown
    expect(mockSetErrorModalOpen).not.toHaveBeenCalled();
    expect(mockSetErrorMessages).not.toHaveBeenCalled();
  });

  it('shows "No active project to export" error on 404 response', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // Act
    await simulateHandleExportJsonClick();

    // Assert
    expect(mockSetErrorMessages).toHaveBeenCalledWith([
      'No active project to export',
    ]);
    expect(mockSetErrorModalOpen).toHaveBeenCalledWith(true);
    expect(mockTriggerDownload).not.toHaveBeenCalled();
  });

  it('shows error modal with backend message on API error', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Export service unavailable' }),
    });

    // Act
    await simulateHandleExportJsonClick();

    // Assert
    expect(mockSetErrorMessages).toHaveBeenCalledWith([
      'Export service unavailable',
    ]);
    expect(mockSetErrorModalOpen).toHaveBeenCalledWith(true);
    expect(mockTriggerDownload).not.toHaveBeenCalled();
  });

  it('sanitizes filename by removing invalid characters', async () => {
    // Arrange - project name with invalid filename characters
    const mockSnapshot = createMockSnapshot('Project: "Test" <v1>/backup?');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSnapshot),
    });

    // Act
    await simulateHandleExportJsonClick();

    // Assert - invalid characters removed: : " < > / ?
    expect(mockTriggerDownload).toHaveBeenCalledTimes(1);
    expect(mockTriggerDownload).toHaveBeenCalledWith(
      expect.any(String),
      'Project Test v1backup-snapshot.json'
    );
  });

  it('uses fallback filename when project name is empty', async () => {
    // Arrange
    const mockSnapshot = createMockSnapshot('');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSnapshot),
    });

    // Act
    await simulateHandleExportJsonClick();

    // Assert
    expect(mockTriggerDownload).toHaveBeenCalledWith(
      expect.any(String),
      'project-snapshot.json'
    );
  });
});

// ============================================================================
// Additional tests for sanitizeFilename utility
// ============================================================================

describe('sanitizeFilename utility', () => {
  it('removes < > : " / \\ | ? * characters', () => {
    const input = 'file<name>:with"bad/chars\\and|more?special*chars';
    const result = sanitizeFilename(input);
    expect(result).toBe('filenamewithbadcharsandmorespecialchars');
  });

  it('preserves valid filename characters', () => {
    const input = 'My Project - v1.0 (final)';
    const result = sanitizeFilename(input);
    expect(result).toBe('My Project - v1.0 (final)');
  });

  it('handles empty string', () => {
    const result = sanitizeFilename('');
    expect(result).toBe('');
  });

  it('handles string with only invalid characters', () => {
    const result = sanitizeFilename('<>:"/\\|?*');
    expect(result).toBe('');
  });
});
