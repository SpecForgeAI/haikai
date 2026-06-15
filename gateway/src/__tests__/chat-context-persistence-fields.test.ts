/**
 * Tests for ChatContext persistence fields
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * Task Group 1: Extend Chat Types with Persistence Metadata
 */

import { ChatContext, ChatRequest } from '../types/chat';

describe('ChatContext Persistence Fields', () => {
  describe('Type compatibility', () => {
    it('should accept projectParentFolder as optional string', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        projectParentFolder: '/home/user/projects/myproject',
      };

      expect(context.projectParentFolder).toBe('/home/user/projects/myproject');
    });

    it('should accept featureId as optional string', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        featureId: 'feat-123-abc',
      };

      expect(context.featureId).toBe('feat-123-abc');
    });

    it('should accept featureTitle as optional string', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        featureTitle: 'Add User Login Feature',
      };

      expect(context.featureTitle).toBe('Add User Login Feature');
    });

    it('should maintain backward compatibility - existing requests without new fields work', () => {
      // This test verifies that existing code using ChatContext without
      // the new persistence fields continues to work
      const legacyContext: ChatContext = {
        filename: 'my-architecture.json',
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'wi-1',
          title: 'Test Work Item',
          type: 'Feature',
          description: 'A test work item',
        },
      };

      // All existing fields should work
      expect(legacyContext.filename).toBe('my-architecture.json');
      expect(legacyContext.mode).toBe('implement_feature');
      expect(legacyContext.phase).toBe('refine');
      expect(legacyContext.workItem?.id).toBe('wi-1');

      // New fields should be undefined (not cause errors)
      expect(legacyContext.projectParentFolder).toBeUndefined();
      expect(legacyContext.featureId).toBeUndefined();
      expect(legacyContext.featureTitle).toBeUndefined();
    });

    it('should allow all persistence fields together', () => {
      const fullContext: ChatContext = {
        filename: 'project.json',
        mode: 'implement_feature',
        phase: 'refine',
        projectParentFolder: 'C:\\Projects\\MyApp',
        featureId: 'feat-456',
        featureTitle: 'Implement User Dashboard',
        workItem: {
          id: 'feat-456',
          title: 'Implement User Dashboard',
          type: 'Feature',
          description: 'Create a user dashboard',
        },
        architectureContext: {
          entityIds: ['svc-1', 'svc-2'],
          diagramIds: ['diag-1'],
        },
      };

      expect(fullContext.projectParentFolder).toBe('C:\\Projects\\MyApp');
      expect(fullContext.featureId).toBe('feat-456');
      expect(fullContext.featureTitle).toBe('Implement User Dashboard');
    });
  });

  describe('ChatRequest with persistence metadata', () => {
    it('should accept ChatRequest with persistence fields in context', () => {
      const request: ChatRequest = {
        sessionId: 'session-123',
        message: 'Hello, assistant',
        context: {
          mode: 'implement_feature',
          phase: 'refine',
          projectParentFolder: '/home/user/project',
          featureId: 'feat-789',
          featureTitle: 'My Feature',
        },
      };

      expect(request.context?.projectParentFolder).toBe('/home/user/project');
      expect(request.context?.featureId).toBe('feat-789');
      expect(request.context?.featureTitle).toBe('My Feature');
    });
  });
});
