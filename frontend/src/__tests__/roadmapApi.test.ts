/**
 * Roadmap API Tests
 *
 * Spec 2026-01-04: Product Roadmap Review Page
 * Task Group 1: Tests for roadmapApi functions
 *
 * Spec 2026-01-04: Roadmap Import UX Glue
 * Task Group 3: Extended tests for detailed counts and artifact metadata.
 *
 * Tests:
 * - importRoadmap returns mapped ImportResult on success (with detailed counts)
 * - importRoadmap throws specific error for HTTP 404
 * - importRoadmap throws specific error for HTTP 400
 * - importRoadmap throws specific error for HTTP 409
 * - importRoadmap throws generic error for other HTTP failures
 * - fetchLatestArtifactMetadata returns metadata on success
 * - fetchLatestArtifactMetadata returns null on 404
 * - Error handling for 400/409 errors includes server message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  importRoadmap,
  mapImportResultDtoToImportResult,
  fetchLatestArtifactMetadata,
  mapArtifactMetadataDtoToArtifactMetadata,
} from '../api/roadmapApi';
import type { ImportResultDto, ImportResult, ArtifactMetadataDto } from '../api/roadmapApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Task Group 1: Roadmap API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mapImportResultDtoToImportResult', () => {
    it('should map snake_case DTO to camelCase ImportResult with all detailed counts', () => {
      // Arrange
      const dto: ImportResultDto = {
        project_id: 'my-project',
        artifact_revision: 5,
        initiatives_created: 3,
        epics_created: 8,
        initiatives_inserted: 2,
        initiatives_updated: 1,
        initiatives_archived: 0,
        initiatives_deleted: 0,
        epics_inserted: 5,
        epics_updated: 2,
        epics_archived: 1,
        epics_deleted: 0,
      };

      // Act
      const result = mapImportResultDtoToImportResult(dto);

      // Assert
      expect(result.projectId).toBe('my-project');
      expect(result.artifactRevision).toBe(5);
      expect(result.initiativesCreated).toBe(3);
      expect(result.epicsCreated).toBe(8);
      // Detailed counts
      expect(result.initiativesInserted).toBe(2);
      expect(result.initiativesUpdated).toBe(1);
      expect(result.initiativesArchived).toBe(0);
      expect(result.initiativesDeleted).toBe(0);
      expect(result.epicsInserted).toBe(5);
      expect(result.epicsUpdated).toBe(2);
      expect(result.epicsArchived).toBe(1);
      expect(result.epicsDeleted).toBe(0);
    });
  });

  describe('importRoadmap', () => {
    it('should return mapped ImportResult with all 8 detailed count fields on success', async () => {
      // Arrange
      const mockResponse: ImportResultDto = {
        project_id: 'test-project',
        artifact_revision: 3,
        initiatives_created: 3,
        epics_created: 10,
        initiatives_inserted: 2,
        initiatives_updated: 1,
        initiatives_archived: 0,
        initiatives_deleted: 0,
        epics_inserted: 7,
        epics_updated: 2,
        epics_archived: 0,
        epics_deleted: 1,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Act
      const result = await importRoadmap('test-project');

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/model/projects/test-project/roadmap/import'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.projectId).toBe('test-project');
      expect(result.artifactRevision).toBe(3);
      // Legacy counts
      expect(result.initiativesCreated).toBe(3);
      expect(result.epicsCreated).toBe(10);
      // All 8 detailed counts
      expect(result.initiativesInserted).toBe(2);
      expect(result.initiativesUpdated).toBe(1);
      expect(result.initiativesArchived).toBe(0);
      expect(result.initiativesDeleted).toBe(0);
      expect(result.epicsInserted).toBe(7);
      expect(result.epicsUpdated).toBe(2);
      expect(result.epicsArchived).toBe(0);
      expect(result.epicsDeleted).toBe(1);
    });

    it('should throw specific error for HTTP 404 (roadmap.md not found)', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Roadmap file not found' }),
      });

      // Act & Assert
      await expect(importRoadmap('my-project')).rejects.toThrow(
        'roadmap.md not found. Expected at: agent-os/product/roadmap.md'
      );
    });

    it('should throw specific error for HTTP 400 (parse error)', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Failed to parse roadmap' }),
      });

      // Act & Assert
      await expect(importRoadmap('my-project')).rejects.toThrow('Failed to parse roadmap');
    });

    it('should throw specific error for HTTP 409 (conflict)', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ message: 'Concurrent modification detected' }),
      });

      // Act & Assert
      await expect(importRoadmap('my-project')).rejects.toThrow('Concurrent modification detected');
    });

    it('should throw generic error for other HTTP failures', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('JSON parse failed')), // Server returned non-JSON
      });

      // Act & Assert
      await expect(importRoadmap('my-project')).rejects.toThrow(
        'Import failed: 500 Internal Server Error'
      );
    });

    it('should include server message for 400/409 errors', async () => {
      // Arrange - 409 with server message
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ message: 'Custom server conflict message' }),
      });

      // Act & Assert
      await expect(importRoadmap('my-project')).rejects.toThrow('Custom server conflict message');
    });
  });
});

describe('Task Group 3: Artifact Metadata API', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mapArtifactMetadataDtoToArtifactMetadata', () => {
    it('should map snake_case DTO to camelCase ArtifactMetadata', () => {
      // Arrange
      const dto: ArtifactMetadataDto = {
        project_id: 'test-project',
        artifact_type: 'ROADMAP_MD',
        revision: 5,
        created_at: '2026-01-04T10:30:00Z',
        source: 'AGENT_OS',
      };

      // Act
      const result = mapArtifactMetadataDtoToArtifactMetadata(dto);

      // Assert
      expect(result.projectId).toBe('test-project');
      expect(result.artifactType).toBe('ROADMAP_MD');
      expect(result.revision).toBe(5);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.source).toBe('AGENT_OS');
    });
  });

  describe('fetchLatestArtifactMetadata', () => {
    it('should return metadata on success', async () => {
      // Arrange
      const mockMetadataDto: ArtifactMetadataDto = {
        project_id: 'test-project',
        artifact_type: 'ROADMAP_MD',
        revision: 3,
        created_at: '2026-01-04T12:00:00Z',
        source: 'AGENT_OS',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockMetadataDto),
      });

      // Act
      const result = await fetchLatestArtifactMetadata('test-project', 'ROADMAP_MD');

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/model/projects/test-project/artifacts/ROADMAP_MD/latest-metadata'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).not.toBeNull();
      expect(result!.projectId).toBe('test-project');
      expect(result!.artifactType).toBe('ROADMAP_MD');
      expect(result!.revision).toBe(3);
      expect(result!.source).toBe('AGENT_OS');
    });

    it('should return null on 404 (no artifact found)', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'No artifact found' }),
      });

      // Act
      const result = await fetchLatestArtifactMetadata('test-project', 'ROADMAP_MD');

      // Assert
      expect(result).toBeNull();
    });

    it('should throw on 400 error with server message', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Invalid artifact type' }),
      });

      // Act & Assert
      await expect(fetchLatestArtifactMetadata('test-project', 'INVALID'))
        .rejects.toThrow('Invalid artifact type');
    });

    it('should throw on 500 error', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('JSON error')),
      });

      // Act & Assert
      await expect(fetchLatestArtifactMetadata('test-project', 'ROADMAP_MD'))
        .rejects.toThrow('Failed to fetch artifact metadata: 500 Internal Server Error');
    });
  });
});
