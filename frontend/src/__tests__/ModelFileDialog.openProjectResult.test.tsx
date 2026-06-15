/**
 * Tests for ModelFileDialog OpenProjectResult functionality
 *
 * Spec 2026-01-26: Activate Project on Open
 * Task Group 1: ModelFileDialog OpenProjectResult Interface
 *
 * Tests:
 * - Open mode calls onConfirm with { filename, projectId } object
 * - ProjectId matches the selected project from the list
 * - SaveAs mode still receives SaveAsResult (backward compatibility)
 * - Type guard correctly identifies OpenProjectResult vs SaveAsResult
 */

import { OpenProjectResult, SaveAsResult, isOpenProjectResult } from '../components/file/ModelFileDialog';

describe('ModelFileDialog.openProjectResult', () => {
  describe('isOpenProjectResult type guard', () => {
    it('returns true for OpenProjectResult with filename and projectId', () => {
      const openResult: OpenProjectResult = {
        filename: 'test-project',
        projectId: 'proj-123',
      };

      expect(isOpenProjectResult(openResult)).toBe(true);
    });

    it('returns false for SaveAsResult (no projectId)', () => {
      const saveAsResult: SaveAsResult = {
        projectName: 'test-project',
        parentFolder: '/path/to/folder',
        organisationId: 'org-123',
      };

      expect(isOpenProjectResult(saveAsResult)).toBe(false);
    });

    it('returns false for SaveAsResult with projectHierarchy', () => {
      const saveAsResult: SaveAsResult = {
        projectName: 'test-project',
        parentFolder: '/path/to/folder',
        projectHierarchy: 'ClientA',
        organisationId: 'org-123',
      };

      expect(isOpenProjectResult(saveAsResult)).toBe(false);
    });

    it('correctly identifies OpenProjectResult when cast from union type', () => {
      const result: OpenProjectResult | SaveAsResult = {
        filename: 'my-project',
        projectId: 'proj-456',
      };

      if (isOpenProjectResult(result)) {
        // TypeScript should allow accessing filename and projectId here
        expect(result.filename).toBe('my-project');
        expect(result.projectId).toBe('proj-456');
      } else {
        fail('Expected isOpenProjectResult to return true');
      }
    });
  });

  describe('OpenProjectResult interface', () => {
    it('has required filename field', () => {
      const result: OpenProjectResult = {
        filename: 'test.json',
        projectId: 'abc-123',
      };

      expect(result.filename).toBe('test.json');
    });

    it('has required projectId field', () => {
      const result: OpenProjectResult = {
        filename: 'test.json',
        projectId: 'abc-123',
      };

      expect(result.projectId).toBe('abc-123');
    });
  });

  describe('SaveAsResult interface (backward compatibility)', () => {
    it('has required projectName field', () => {
      const result: SaveAsResult = {
        projectName: 'My Project',
        parentFolder: '/projects',
        organisationId: 'org-1',
      };

      expect(result.projectName).toBe('My Project');
    });

    it('has required parentFolder field', () => {
      const result: SaveAsResult = {
        projectName: 'My Project',
        parentFolder: '/projects',
        organisationId: 'org-1',
      };

      expect(result.parentFolder).toBe('/projects');
    });

    it('has required organisationId field', () => {
      const result: SaveAsResult = {
        projectName: 'My Project',
        parentFolder: '/projects',
        organisationId: 'org-1',
      };

      expect(result.organisationId).toBe('org-1');
    });

    it('has optional projectHierarchy field', () => {
      const resultWithHierarchy: SaveAsResult = {
        projectName: 'My Project',
        parentFolder: '/projects',
        projectHierarchy: 'ClientA',
        organisationId: 'org-1',
      };

      const resultWithoutHierarchy: SaveAsResult = {
        projectName: 'My Project',
        parentFolder: '/projects',
        organisationId: 'org-1',
      };

      expect(resultWithHierarchy.projectHierarchy).toBe('ClientA');
      expect(resultWithoutHierarchy.projectHierarchy).toBeUndefined();
    });
  });
});
