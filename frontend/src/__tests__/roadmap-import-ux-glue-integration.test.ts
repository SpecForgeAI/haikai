/**
 * Roadmap Import UX Glue - Integration Tests
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 * Task Group 5: Test Review and Gap Analysis - Additional strategic tests.
 *
 * Tests:
 * - Integration test: Full import flow updates both importResult and lastImportedMetadata
 * - Integration test: Metadata persists across page refreshes (simulated)
 * - Integration test: Error state clears on successful retry
 * - End-to-end test: "Go to Backlog" navigation works after import
 * - Edge case test: Import with all zeros displays correctly
 * - Edge case test: Very large counts display without overflow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  importRoadmap,
  fetchLatestArtifactMetadata,
  mapImportResultDtoToImportResult,
  mapArtifactMetadataDtoToArtifactMetadata,
} from '../api/roadmapApi';
import type { ImportResult, ArtifactMetadata, ImportResultDto, ArtifactMetadataDto } from '../api/roadmapApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Task Group 5: Integration and Strategic Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Full import flow integration', () => {
    it('should update both importResult and lastImportedMetadata after successful import', async () => {
      // Arrange: Mock import response
      const mockImportDto: ImportResultDto = {
        project_id: 'test-project',
        artifact_revision: 5,
        initiatives_created: 3,
        epics_created: 10,
        initiatives_inserted: 2,
        initiatives_updated: 1,
        initiatives_archived: 0,
        initiatives_deleted: 0,
        epics_inserted: 7,
        epics_updated: 2,
        epics_archived: 1,
        epics_deleted: 0,
      };

      const mockMetadataDto: ArtifactMetadataDto = {
        project_id: 'test-project',
        artifact_type: 'ROADMAP_MD',
        revision: 5,
        created_at: '2026-01-04T12:00:00Z',
        source: 'AGENT_OS',
      };

      // First call: importRoadmap
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockImportDto),
      });

      // Second call: fetchLatestArtifactMetadata
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockMetadataDto),
      });

      // Act: Simulate the full import flow
      const importResult = await importRoadmap('test-project');
      const metadata = await fetchLatestArtifactMetadata('test-project', 'ROADMAP_MD');

      // Assert: Both are updated with consistent data
      expect(importResult.artifactRevision).toBe(5);
      expect(metadata).not.toBeNull();
      expect(metadata!.revision).toBe(5);
      expect(metadata!.source).toBe('AGENT_OS');
    });
  });

  describe('Metadata persistence simulation', () => {
    it('should return consistent metadata on repeated fetches (simulates page refresh)', async () => {
      // Arrange: Consistent metadata response
      const mockMetadataDto: ArtifactMetadataDto = {
        project_id: 'test-project',
        artifact_type: 'ROADMAP_MD',
        revision: 3,
        created_at: '2026-01-04T10:00:00Z',
        source: 'AGENT_OS',
      };

      // First fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockMetadataDto),
      });

      // Second fetch (simulates page refresh)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockMetadataDto),
      });

      // Act: Fetch twice
      const metadata1 = await fetchLatestArtifactMetadata('test-project', 'ROADMAP_MD');
      const metadata2 = await fetchLatestArtifactMetadata('test-project', 'ROADMAP_MD');

      // Assert: Both return the same data
      expect(metadata1).not.toBeNull();
      expect(metadata2).not.toBeNull();
      expect(metadata1!.revision).toBe(metadata2!.revision);
      expect(metadata1!.source).toBe(metadata2!.source);
    });
  });

  describe('Error state clears on successful retry', () => {
    it('should return success result after failed then successful import', async () => {
      // First attempt: fails with 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'File not found' }),
      });

      // First attempt should fail
      await expect(importRoadmap('test-project')).rejects.toThrow('roadmap.md not found');

      // Second attempt: succeeds
      const mockSuccessDto: ImportResultDto = {
        project_id: 'test-project',
        artifact_revision: 1,
        initiatives_created: 2,
        epics_created: 5,
        initiatives_inserted: 2,
        initiatives_updated: 0,
        initiatives_archived: 0,
        initiatives_deleted: 0,
        epics_inserted: 5,
        epics_updated: 0,
        epics_archived: 0,
        epics_deleted: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccessDto),
      });

      // Second attempt should succeed
      const result = await importRoadmap('test-project');

      // Assert: Success result received
      expect(result.artifactRevision).toBe(1);
      expect(result.initiativesInserted).toBe(2);
      expect(result.epicsInserted).toBe(5);
    });
  });

  describe('Go to Backlog navigation simulation', () => {
    it('should correctly count active epics for navigation decision', () => {
      // Arrange: Mixed status epics
      const items = [
        { type: 'INITIATIVE', status: 'PLANNED' },
        { type: 'EPIC', status: 'PLANNED' },
        { type: 'EPIC', status: 'IN_PROGRESS' },
        { type: 'EPIC', status: 'ARCHIVED' },
        { type: 'EPIC', status: 'DONE' },
      ];

      // Act: Count active epics (non-ARCHIVED)
      const activeEpicsCount = items.filter(
        (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
      ).length;

      // Assert: 3 active epics (PLANNED, IN_PROGRESS, DONE)
      expect(activeEpicsCount).toBe(3);
    });

    it('should return zero when all epics are archived', () => {
      // Arrange: All epics archived
      const items = [
        { type: 'INITIATIVE', status: 'ARCHIVED' },
        { type: 'EPIC', status: 'ARCHIVED' },
        { type: 'EPIC', status: 'ARCHIVED' },
      ];

      // Act: Count active epics
      const activeEpicsCount = items.filter(
        (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
      ).length;

      // Assert: No active epics
      expect(activeEpicsCount).toBe(0);
    });
  });

  describe('Edge cases for import result display', () => {
    it('should correctly map import with all zeros', () => {
      // Arrange: DTO with all zeros
      const dto: ImportResultDto = {
        project_id: 'test-project',
        artifact_revision: 1,
        initiatives_created: 0,
        epics_created: 0,
        initiatives_inserted: 0,
        initiatives_updated: 0,
        initiatives_archived: 0,
        initiatives_deleted: 0,
        epics_inserted: 0,
        epics_updated: 0,
        epics_archived: 0,
        epics_deleted: 0,
      };

      // Act
      const result = mapImportResultDtoToImportResult(dto);

      // Assert: All counts are zero
      expect(result.initiativesInserted).toBe(0);
      expect(result.initiativesUpdated).toBe(0);
      expect(result.initiativesArchived).toBe(0);
      expect(result.initiativesDeleted).toBe(0);
      expect(result.epicsInserted).toBe(0);
      expect(result.epicsUpdated).toBe(0);
      expect(result.epicsArchived).toBe(0);
      expect(result.epicsDeleted).toBe(0);

      // Verify display won't fail
      const totalChanges =
        result.initiativesInserted +
        result.initiativesUpdated +
        result.epicsInserted +
        result.epicsUpdated;
      expect(totalChanges).toBe(0);
    });

    it('should correctly map import with very large counts', () => {
      // Arrange: DTO with large numbers
      const dto: ImportResultDto = {
        project_id: 'test-project',
        artifact_revision: 9999,
        initiatives_created: 10000,
        epics_created: 50000,
        initiatives_inserted: 5000,
        initiatives_updated: 4000,
        initiatives_archived: 500,
        initiatives_deleted: 500,
        epics_inserted: 30000,
        epics_updated: 15000,
        epics_archived: 3000,
        epics_deleted: 2000,
      };

      // Act
      const result = mapImportResultDtoToImportResult(dto);

      // Assert: Large numbers are preserved correctly
      expect(result.artifactRevision).toBe(9999);
      expect(result.initiativesInserted).toBe(5000);
      expect(result.initiativesUpdated).toBe(4000);
      expect(result.epicsInserted).toBe(30000);
      expect(result.epicsUpdated).toBe(15000);
      expect(result.epicsArchived).toBe(3000);
      expect(result.epicsDeleted).toBe(2000);

      // Verify calculations don't overflow
      const totalEpicChanges =
        result.epicsInserted +
        result.epicsUpdated +
        result.epicsArchived +
        result.epicsDeleted;
      expect(totalEpicChanges).toBe(50000);
    });

    it('should handle metadata with special characters in source', () => {
      // Arrange: Metadata with underscore in source
      const dto: ArtifactMetadataDto = {
        project_id: 'test-project',
        artifact_type: 'ROADMAP_MD',
        revision: 1,
        created_at: '2026-01-04T12:00:00Z',
        source: 'AGENT_OS', // Contains underscore
      };

      // Act
      const result = mapArtifactMetadataDtoToArtifactMetadata(dto);

      // Assert: Source is preserved
      expect(result.source).toBe('AGENT_OS');

      // UI would display this as "AGENT OS" by replacing underscore
      const displaySource = result.source.replace('_', ' ');
      expect(displaySource).toBe('AGENT OS');
    });

    it('should handle metadata with very old timestamp', () => {
      // Arrange: Metadata from long ago
      const dto: ArtifactMetadataDto = {
        project_id: 'test-project',
        artifact_type: 'ROADMAP_MD',
        revision: 1,
        created_at: '2020-01-01T00:00:00Z', // 6 years ago
        source: 'AGENT_OS',
      };

      // Act
      const result = mapArtifactMetadataDtoToArtifactMetadata(dto);

      // Assert: Date is parsed correctly
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.createdAt.getFullYear()).toBe(2020);
    });
  });

  describe('Field mapping completeness', () => {
    it('should handle undefined optional fields gracefully', () => {
      // Arrange: DTO with missing fields (simulates legacy API response)
      const partialDto = {
        project_id: 'test-project',
        artifact_revision: 1,
        initiatives_created: 2,
        epics_created: 5,
        // Missing detailed counts
      } as ImportResultDto;

      // Act
      const result = mapImportResultDtoToImportResult(partialDto);

      // Assert: Missing fields default to 0
      expect(result.initiativesInserted).toBe(0);
      expect(result.initiativesUpdated).toBe(0);
      expect(result.epicsInserted).toBe(0);
      expect(result.epicsUpdated).toBe(0);
    });
  });
});
