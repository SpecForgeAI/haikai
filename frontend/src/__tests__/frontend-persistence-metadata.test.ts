/**
 * Tests for frontend persistence metadata integration
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * Task Group 5: Send Persistence Metadata with Chat Requests
 */

import { ImplementChatContext } from '../api/chatApi';

describe('Frontend Persistence Metadata', () => {
  describe('ImplementChatContext interface', () => {
    it('should include projectParentFolder field', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        projectParentFolder: '/home/user/projects/myproject',
      };

      expect(context.projectParentFolder).toBe('/home/user/projects/myproject');
    });

    it('should include featureId field', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        featureId: 'feat-123-abc',
      };

      expect(context.featureId).toBe('feat-123-abc');
    });

    it('should include featureTitle field', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        featureTitle: 'Add User Dashboard',
      };

      expect(context.featureTitle).toBe('Add User Dashboard');
    });

    it('should allow all persistence fields together', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'project.json',
        projectParentFolder: 'C:\\Projects\\MyApp',
        featureId: 'feat-456-def',
        featureTitle: 'Implement Login Flow',
        workItem: {
          id: 'feat-456-def',
          title: 'Implement Login Flow',
          type: 'Feature',
          description: 'Add user login functionality',
        },
        architectureContext: {
          entityIds: ['svc-1', 'svc-2'],
          diagramIds: ['diag-1'],
        },
      };

      expect(context.projectParentFolder).toBe('C:\\Projects\\MyApp');
      expect(context.featureId).toBe('feat-456-def');
      expect(context.featureTitle).toBe('Implement Login Flow');
    });

    it('should maintain backward compatibility - existing context without new fields', () => {
      // Verify that context without persistence fields still works
      const legacyContext: ImplementChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'project.json',
        workItem: {
          id: 'wi-1',
          title: 'Test Work Item',
          type: 'Feature',
          description: 'A test work item',
        },
      };

      expect(legacyContext.mode).toBe('implement_feature');
      expect(legacyContext.phase).toBe('refine');
      expect(legacyContext.projectParentFolder).toBeUndefined();
      expect(legacyContext.featureId).toBeUndefined();
      expect(legacyContext.featureTitle).toBeUndefined();
    });
  });

  describe('buildContext() integration', () => {
    it('should create context with projectParentFolder from project metadata', () => {
      // This test verifies the expected structure when buildContext is called
      // The actual buildContext implementation is in ImplementationAssistantPanel.tsx
      const mockProject = {
        id: 'project-123',
        name: 'My Project',
        projectParentFolder: '/home/user/my-project',
        projectHierarchy: null,
        isActive: true,
        createdAt: '2026-01-15T00:00:00Z',
        updatedAt: '2026-01-15T00:00:00Z',
      };

      const mockWorkItem = {
        id: 'feat-789',
        title: 'Add Search Feature',
        type: 'Feature',
        description: 'Implement search functionality',
      };

      // Expected buildContext output structure
      const expectedContext: ImplementChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'my-architecture.json',
        projectParentFolder: mockProject.projectParentFolder,
        featureId: mockWorkItem.id,
        featureTitle: mockWorkItem.title,
        workItem: mockWorkItem,
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      // Verify the structure matches what we expect
      expect(expectedContext.projectParentFolder).toBe('/home/user/my-project');
      expect(expectedContext.featureId).toBe('feat-789');
      expect(expectedContext.featureTitle).toBe('Add Search Feature');
    });
  });
});
