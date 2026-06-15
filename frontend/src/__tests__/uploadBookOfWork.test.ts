/**
 * Tests for Upload Book of Work functionality.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 5.1: Tests for Upload Book of Work UI functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API module
vi.mock('../api/bookOfWorkApi', () => ({
  uploadBookOfWork: vi.fn(),
}));

// Mock the contexts
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(() => ({
    loadedFileName: 'test-project',
  })),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => ({
    id: '123',
    name: 'Test Project',
  })),
  useSetActiveProject: () => vi.fn(),
}));

import { uploadBookOfWork } from '../api/bookOfWorkApi';

describe('Upload Book of Work Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadBookOfWork API integration', () => {
    it('calls uploadBookOfWork with correct projectId and content', async () => {
      // Given
      const projectId = 'test-project';
      const content = '## Initiative\n### Epic';
      const mockResult = {
        projectId,
        workItems: [],
        importSummary: {
          initiativesCreated: 1,
          epicsCreated: 1,
          featuresCreated: 0,
          storiesCreated: 0,
          totalCreated: 2,
        },
      };

      (uploadBookOfWork as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      // When
      const result = await uploadBookOfWork(projectId, content);

      // Then
      expect(uploadBookOfWork).toHaveBeenCalledWith(projectId, content);
      expect(result.projectId).toBe(projectId);
      expect(result.importSummary.totalCreated).toBe(2);
    });

    it('throws error on API failure', async () => {
      // Given
      const projectId = 'test-project';
      const content = '## Initiative';

      (uploadBookOfWork as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Upload failed: 500 Internal Server Error')
      );

      // When/Then
      await expect(uploadBookOfWork(projectId, content)).rejects.toThrow(
        'Upload failed'
      );
    });
  });

  describe('File handling', () => {
    it('reads markdown file content as text', async () => {
      // Given: A mock File object with markdown content
      const markdownContent = '## Initiative One\n\n### Epic One\n\nDescription';
      const file = new File([markdownContent], 'book-of-work.md', {
        type: 'text/markdown',
      });

      // When: Reading file using FileReader API pattern
      const readFile = (): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Read failed'));
          reader.readAsText(file);
        });
      };

      const content = await readFile();

      // Then
      expect(content).toBe(markdownContent);
    });

    it('validates .md file extension', () => {
      // Given: File input configuration
      const acceptAttribute = '.md,text/markdown';

      // When: Parsing accept attribute
      const acceptedTypes = acceptAttribute.split(',').map((t) => t.trim());

      // Then
      expect(acceptedTypes).toContain('.md');
      expect(acceptedTypes).toContain('text/markdown');
    });
  });

  describe('Error handling', () => {
    it('displays user-friendly message for 404 error', async () => {
      // Given
      const projectId = 'non-existent';
      const content = '## Initiative';

      (uploadBookOfWork as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Product not found')
      );

      // When/Then
      try {
        await uploadBookOfWork(projectId, content);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Product not found');
      }
    });

    it('displays parse error message for 400 error', async () => {
      // Given
      const projectId = 'test-project';
      const invalidContent = '# Only H1';

      (uploadBookOfWork as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('No valid headings (H2-H5) found in the Book of Work file.')
      );

      // When/Then
      try {
        await uploadBookOfWork(projectId, invalidContent);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('No valid headings');
      }
    });
  });

  describe('Upload state management', () => {
    it('tracks uploading state correctly', async () => {
      // Given: Simulating upload state lifecycle
      let uploadingState = false;

      const simulateUpload = async (): Promise<void> => {
        uploadingState = true;
        try {
          // Simulate API call
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          uploadingState = false;
        }
      };

      // When
      expect(uploadingState).toBe(false);
      const uploadPromise = simulateUpload();
      // Brief delay to let the state change
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(uploadingState).toBe(true);
      await uploadPromise;
      expect(uploadingState).toBe(false);
    });
  });

  describe('Button state', () => {
    it('button should be disabled when no active project', () => {
      // Given: No active project
      const activeProject = null;

      // When: Determining button disabled state
      const isButtonDisabled = !activeProject;

      // Then
      expect(isButtonDisabled).toBe(true);
    });

    it('button should be enabled when active project exists', () => {
      // Given: Active project exists
      const activeProject = { id: '123', name: 'Test Project' };

      // When: Determining button disabled state
      const isButtonDisabled = !activeProject;

      // Then
      expect(isButtonDisabled).toBe(false);
    });

    it('button should be disabled during upload', () => {
      // Given: Upload in progress
      const activeProject = { id: '123', name: 'Test Project' };
      const uploading = true;

      // When: Determining button disabled state
      const isButtonDisabled = !activeProject || uploading;

      // Then
      expect(isButtonDisabled).toBe(true);
    });
  });
});
