/**
 * Tests for ChatContext type extension for implement_feature mode
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 1: ChatContext Type Extension
 */

import { ChatContext } from '../types';

describe('ChatContext implement_feature mode types', () => {
  describe('mode field', () => {
    it('should accept "oas_assistant" mode', () => {
      const context: ChatContext = {
        filename: 'test.json',
        mode: 'oas_assistant',
      };
      expect(context.mode).toBe('oas_assistant');
    });

    it('should accept "implement_feature" mode', () => {
      const context: ChatContext = {
        filename: 'test.json',
        mode: 'implement_feature',
      };
      expect(context.mode).toBe('implement_feature');
    });

    it('should accept undefined mode (defaults to oas_assistant behavior)', () => {
      const context: ChatContext = {
        filename: 'test.json',
      };
      expect(context.mode).toBeUndefined();
    });
  });

  describe('workItem field', () => {
    it('should accept workItem object with id, title, type, description', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        workItem: {
          id: 'WI-001',
          title: 'Add user authentication',
          type: 'Feature',
          description: 'Implement OAuth2 authentication flow',
        },
      };
      expect(context.workItem).toBeDefined();
      expect(context.workItem?.id).toBe('WI-001');
      expect(context.workItem?.title).toBe('Add user authentication');
      expect(context.workItem?.type).toBe('Feature');
      expect(context.workItem?.description).toBe('Implement OAuth2 authentication flow');
    });

    it('should accept undefined workItem', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
      };
      expect(context.workItem).toBeUndefined();
    });
  });

  describe('architectureContext field', () => {
    it('should accept architectureContext with entityIds and diagramIds arrays', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        architectureContext: {
          entityIds: ['ENT-001', 'ENT-002'],
          diagramIds: ['DIA-001'],
        },
      };
      expect(context.architectureContext).toBeDefined();
      expect(context.architectureContext?.entityIds).toEqual(['ENT-001', 'ENT-002']);
      expect(context.architectureContext?.diagramIds).toEqual(['DIA-001']);
    });

    it('should accept empty entityIds and diagramIds arrays', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };
      expect(context.architectureContext?.entityIds).toEqual([]);
      expect(context.architectureContext?.diagramIds).toEqual([]);
    });
  });

  describe('intent field', () => {
    it('should accept "normal_chat" intent', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
      };
      expect(context.intent).toBe('normal_chat');
    });

    it('should accept undefined intent', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
      };
      expect(context.intent).toBeUndefined();
    });
  });

  describe('full implement_feature context', () => {
    it('should accept complete implement_feature context object', () => {
      const context: ChatContext = {
        filename: 'architecture-model.json',
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-123',
          title: 'Implement login page',
          type: 'Feature',
          description: 'Create a login page with email/password authentication',
        },
        architectureContext: {
          entityIds: ['SVC-AUTH', 'APP-WEB'],
          diagramIds: ['DIA-ARCH-001'],
        },
      };

      expect(context.filename).toBe('architecture-model.json');
      expect(context.mode).toBe('implement_feature');
      expect(context.intent).toBe('normal_chat');
      expect(context.workItem?.id).toBe('FEAT-123');
      expect(context.architectureContext?.entityIds).toHaveLength(2);
      expect(context.architectureContext?.diagramIds).toHaveLength(1);
    });
  });
});
