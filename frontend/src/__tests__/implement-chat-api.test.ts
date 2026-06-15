/**
 * Tests for Frontend Chat API Extension
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 4: Frontend Chat API Extension
 *
 * Updated for Spec 2026-01-13: Fix Implement Context Resolution Plumbing
 * - Added filename field to mock contexts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChatRequest,
  ImplementChatContext,
  ChatResponse,
  postChatMessage,
} from '../api/chatApi';

describe('Frontend Chat API Extension', () => {
  describe('ChatRequest interface', () => {
    it('should accept ChatRequest with optional context field', () => {
      const request: ChatRequest = {
        sessionId: 'test-session',
        message: 'Hello',
        context: {
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
            entityIds: ['ENT-001'],
            diagramIds: ['DIA-001'],
          },
        },
      };

      expect(request.context).toBeDefined();
      expect(request.context?.mode).toBe('implement_feature');
      expect(request.context?.filename).toBe('test-project.json');
    });

    it('should accept ChatRequest without context (backward compatible)', () => {
      const request: ChatRequest = {
        sessionId: 'test-session',
        message: 'Hello',
      };

      expect(request.context).toBeUndefined();
    });
  });

  describe('ImplementChatContext interface', () => {
    it('should have all required fields for implement_feature mode', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        filename: 'my-architecture.json',
        workItem: {
          id: 'FEAT-123',
          title: 'Add user authentication',
          type: 'Feature',
          description: 'Implement OAuth2 authentication flow',
        },
        architectureContext: {
          entityIds: ['SVC-AUTH', 'APP-WEB'],
          diagramIds: ['DIA-001'],
        },
      };

      // Verify mode
      expect(context.mode).toBe('implement_feature');

      // Verify intent
      expect(context.intent).toBe('normal_chat');

      // Verify filename
      expect(context.filename).toBe('my-architecture.json');

      // Verify workItem fields
      expect(context.workItem.id).toBe('FEAT-123');
      expect(context.workItem.title).toBe('Add user authentication');
      expect(context.workItem.type).toBe('Feature');
      expect(context.workItem.description).toBe('Implement OAuth2 authentication flow');

      // Verify architectureContext
      expect(context.architectureContext.entityIds).toEqual(['SVC-AUTH', 'APP-WEB']);
      expect(context.architectureContext.diagramIds).toEqual(['DIA-001']);
    });

    it('should accept empty arrays for architectureContext', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        filename: 'test.json',
        workItem: {
          id: 'FEAT-001',
          title: 'Test',
          type: 'Feature',
          description: 'Test',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.architectureContext.entityIds).toHaveLength(0);
      expect(context.architectureContext.diagramIds).toHaveLength(0);
    });

    it('should accept context without filename (backwards compatible)', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-001',
          title: 'Test',
          type: 'Feature',
          description: 'Test',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.filename).toBeUndefined();
    });
  });

  describe('postChatMessage serialization', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should serialize context object correctly in request body', async () => {
      let capturedBody: string | null = null;

      global.fetch = vi.fn().mockImplementation((url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'test-session',
              assistant: { message: 'Response' },
            }),
        } as Response);
      });

      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        filename: 'my-project.json',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: ['ENT-001'],
          diagramIds: ['DIA-001'],
        },
      };

      await postChatMessage({
        message: 'Hello',
        context,
      });

      expect(capturedBody).not.toBeNull();
      const parsedBody = JSON.parse(capturedBody!);

      expect(parsedBody.message).toBe('Hello');
      expect(parsedBody.context).toBeDefined();
      expect(parsedBody.context.mode).toBe('implement_feature');
      expect(parsedBody.context.intent).toBe('normal_chat');
      expect(parsedBody.context.filename).toBe('my-project.json');
      expect(parsedBody.context.workItem.id).toBe('FEAT-001');
      expect(parsedBody.context.architectureContext.entityIds).toEqual(['ENT-001']);
    });

    it('should work without context (backward compatible)', async () => {
      let capturedBody: string | null = null;

      global.fetch = vi.fn().mockImplementation((url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'test-session',
              assistant: { message: 'Response' },
            }),
        } as Response);
      });

      await postChatMessage({
        message: 'Hello',
      });

      expect(capturedBody).not.toBeNull();
      const parsedBody = JSON.parse(capturedBody!);

      expect(parsedBody.message).toBe('Hello');
      expect(parsedBody.context).toBeUndefined();
    });
  });
});
