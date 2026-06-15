/**
 * Tests for Frontend types and API extensions for generate_specs intent
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 4: Frontend Types and API Extension
 *
 * Updated for Spec 2026-01-13: Fix Implement Context Resolution Plumbing
 * - Added filename field to mock contexts
 */

import { ImplementChatContext, ChatResponse } from '../api/chatApi';

describe('Frontend generate_specs types', () => {
  describe('ImplementChatContext intent field', () => {
    it('should accept intent "normal_chat"', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        filename: 'test-project.json',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.intent).toBe('normal_chat');
    });

    it('should accept intent "generate_specs"', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        filename: 'test-project.json',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.intent).toBe('generate_specs');
    });
  });

  describe('ChatResponse specs field', () => {
    it('should allow optional specs array', () => {
      const response: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: 'Test message',
        },
        specs: ['/agent-os:write-spec test'],
      };

      expect(response.specs).toBeDefined();
      expect(response.specs).toHaveLength(1);
    });

    it('should allow response without specs field', () => {
      const response: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: 'Test message',
        },
      };

      expect(response.specs).toBeUndefined();
    });

    it('should allow empty specs array', () => {
      const response: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: 'Test message',
        },
        specs: [],
      };

      expect(response.specs).toEqual([]);
    });
  });

  describe('type compatibility', () => {
    it('should allow building context with generate_specs intent and all fields', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        filename: 'my-architecture.json',
        workItem: {
          id: 'WI-123',
          title: 'Add user authentication',
          type: 'Epic',
          description: 'Implement full authentication flow',
        },
        architectureContext: {
          entityIds: ['SVC-AUTH', 'APP-WEB'],
          diagramIds: ['DIA-001'],
        },
      };

      expect(context.mode).toBe('implement_feature');
      expect(context.intent).toBe('generate_specs');
      expect(context.filename).toBe('my-architecture.json');
      expect(context.workItem.id).toBe('WI-123');
      expect(context.architectureContext.entityIds).toHaveLength(2);
    });

    it('should allow context without filename (backwards compatible)', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'WI-123',
          title: 'Test',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.filename).toBeUndefined();
    });
  });
});
