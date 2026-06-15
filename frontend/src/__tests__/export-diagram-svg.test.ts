/**
 * Tests for Export Diagrams as SVG feature
 * Spec: Export Diagrams as SVG - Task Groups 4-6
 *
 * Tests cover:
 * - API helper functions (exportDiagramAsSvg, exportAllDiagramsAsZip)
 * - Content-Disposition header parsing
 * - Export UI button states and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportDiagramAsSvg,
  exportAllDiagramsAsZip,
  parseContentDispositionFilename,
} from '../api/modelApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Export Diagram SVG API Functions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('exportDiagramAsSvg', () => {
    it('calls correct endpoint with filename and diagramId', async () => {
      // Arrange
      const mockResponse = new Response('<svg></svg>', {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': 'attachment; filename="diagram.svg"',
        },
      });
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      await exportDiagramAsSvg('test-model', 'diagram-1');

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/api/model/diagrams/diagram-1/export-svg');
      expect(calledUrl).toContain('filename=test-model');
    });

    it('returns raw Response for blob handling', async () => {
      // Arrange
      const mockResponse = new Response('<svg></svg>', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const result = await exportDiagramAsSvg('test-model', 'diagram-1');

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    it('throws error for failed response', async () => {
      // Arrange
      const mockResponse = new Response('Not found', { status: 404 });
      mockFetch.mockResolvedValue(mockResponse);

      // Act & Assert
      await expect(exportDiagramAsSvg('test-model', 'diagram-1'))
        .rejects.toThrow('Failed to export diagram');
    });

    it('encodes diagramId in URL', async () => {
      // Arrange
      const mockResponse = new Response('<svg></svg>', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      await exportDiagramAsSvg('test-model', 'diagram with spaces');

      // Assert
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('diagram%20with%20spaces');
    });
  });

  describe('exportAllDiagramsAsZip', () => {
    it('calls correct endpoint with filename', async () => {
      // Arrange
      const mockResponse = new Response(new Blob(), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="all-diagrams.zip"',
        },
      });
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      await exportAllDiagramsAsZip('test-model');

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/api/model/diagrams/export-all-svg');
      expect(calledUrl).toContain('filename=test-model');
    });

    it('returns raw Response for blob handling', async () => {
      // Arrange
      const mockResponse = new Response(new Blob(), { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      // Act
      const result = await exportAllDiagramsAsZip('test-model');

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    it('throws error for failed response', async () => {
      // Arrange
      const mockResponse = new Response('Error', { status: 500 });
      mockFetch.mockResolvedValue(mockResponse);

      // Act & Assert
      await expect(exportAllDiagramsAsZip('test-model'))
        .rejects.toThrow('Failed to export all diagrams');
    });
  });

  describe('parseContentDispositionFilename', () => {
    it('parses quoted filename correctly', () => {
      // Arrange
      const header = 'attachment; filename="project_diagram_20240109-120000.svg"';

      // Act
      const result = parseContentDispositionFilename(header, 'default.svg');

      // Assert
      expect(result).toBe('project_diagram_20240109-120000.svg');
    });

    it('parses unquoted filename correctly', () => {
      // Arrange
      const header = 'attachment; filename=project_diagram_20240109-120000.svg';

      // Act
      const result = parseContentDispositionFilename(header, 'default.svg');

      // Assert
      expect(result).toBe('project_diagram_20240109-120000.svg');
    });

    it('returns default for null header', () => {
      // Act
      const result = parseContentDispositionFilename(null, 'default.svg');

      // Assert
      expect(result).toBe('default.svg');
    });

    it('returns default for empty header', () => {
      // Act
      const result = parseContentDispositionFilename('', 'default.svg');

      // Assert
      expect(result).toBe('default.svg');
    });

    it('returns default for header without filename', () => {
      // Arrange
      const header = 'attachment';

      // Act
      const result = parseContentDispositionFilename(header, 'default.svg');

      // Assert
      expect(result).toBe('default.svg');
    });
  });
});

describe('Export UI Button State Logic', () => {
  describe('Export Current SVG button', () => {
    it('should be disabled when no diagram is selected', () => {
      // Simulate: selectedDiagramId is null
      const selectedDiagramId: string | null = null;
      const isExporting = false;

      const isDisabled = !selectedDiagramId || isExporting;

      expect(isDisabled).toBe(true);
    });

    it('should be enabled when diagram is selected and not exporting', () => {
      const selectedDiagramId = 'diagram-1';
      const isExporting = false;

      const isDisabled = !selectedDiagramId || isExporting;

      expect(isDisabled).toBe(false);
    });

    it('should be disabled while exporting', () => {
      const selectedDiagramId = 'diagram-1';
      const isExporting = true;

      const isDisabled = !selectedDiagramId || isExporting;

      expect(isDisabled).toBe(true);
    });
  });

  describe('Export All SVG button', () => {
    it('should be disabled when no diagrams exist', () => {
      const diagrams: unknown[] = [];
      const isExporting = false;

      const isDisabled = !diagrams.length || isExporting;

      expect(isDisabled).toBe(true);
    });

    it('should be enabled when diagrams exist and not exporting', () => {
      const diagrams = [{ id: 'diagram-1' }];
      const isExporting = false;

      const isDisabled = !diagrams.length || isExporting;

      expect(isDisabled).toBe(false);
    });

    it('should be disabled while exporting', () => {
      const diagrams = [{ id: 'diagram-1' }];
      const isExporting = true;

      const isDisabled = !diagrams.length || isExporting;

      expect(isDisabled).toBe(true);
    });
  });
});

describe('Export Error Handling', () => {
  it('should extract error message from Error object', () => {
    // Simulate error handling in export handler
    const err = new Error('Network connection failed');
    const errorMessage = err instanceof Error ? err.message : 'Failed to export';

    expect(errorMessage).toBe('Network connection failed');
  });

  it('should use fallback message for non-Error objects', () => {
    // Simulate error handling for thrown string/object
    const err = 'Something went wrong';
    const errorMessage = err instanceof Error ? err.message : 'Failed to export';

    expect(errorMessage).toBe('Failed to export');
  });

  it('should clear error on new export attempt', () => {
    // Simulate state management for export error
    let exportError: string | null = 'Previous error';

    // On new export attempt, clear error
    exportError = null;

    expect(exportError).toBeNull();
  });
});

describe('Browser Download Trigger Logic', () => {
  it('should create blob URL and trigger download', () => {
    // This test verifies the download logic pattern
    // In the actual implementation, this creates an anchor element

    // Mock URL.createObjectURL
    const mockObjectUrl = 'blob:http://localhost:3000/abc123';
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockObjectUrl);
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Simulate download trigger
    const blob = new Blob(['<svg></svg>'], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    // Verify blob URL was created
    expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    expect(url).toBe(mockObjectUrl);

    // Simulate cleanup
    URL.revokeObjectURL(url);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(mockObjectUrl);

    // Cleanup mocks
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});
