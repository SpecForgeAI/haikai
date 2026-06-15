/**
 * End-to-End Phase Propagation Tests
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * Task Group 4: Test Review and Gap Analysis
 *
 * Strategic tests to verify phase propagation from frontend to gateway.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ImplementChatContext,
  ImplementChatPhase,
  ChatRequest,
  postChatMessage,
} from '../api/chatApi';

describe('End-to-End Phase Propagation', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Phase serialization in API requests', () => {
    it('should serialize phase: "refine" in request body to gateway', async () => {
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
        phase: 'refine',
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

      expect(parsedBody.context.phase).toBe('refine');
      expect(parsedBody.context.mode).toBe('implement_feature');
      expect(parsedBody.context.intent).toBe('normal_chat');
    });

    it('should serialize phase: "handoff" in request body to gateway', async () => {
      let capturedBody: string | null = null;

      global.fetch = vi.fn().mockImplementation((url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'test-session',
              assistant: { message: 'Response' },
              specs: [],
            }),
        } as Response);
      });

      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        phase: 'handoff',
        workItem: {
          id: 'FEAT-002',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      await postChatMessage({
        sessionId: 'existing-session',
        message: 'Proceed to implementation',
        context,
      });

      expect(capturedBody).not.toBeNull();
      const parsedBody = JSON.parse(capturedBody!);

      expect(parsedBody.context.phase).toBe('handoff');
      expect(parsedBody.context.mode).toBe('implement_feature');
      expect(parsedBody.context.intent).toBe('generate_specs');
    });
  });

  describe('Backward compatibility with missing phase', () => {
    it('should allow context without phase field (backward compatible)', async () => {
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

      // Context without phase (simulating legacy request)
      const context: Omit<ImplementChatContext, 'phase'> = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-003',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      await postChatMessage({
        message: 'Legacy request',
        context: context as ImplementChatContext,
      });

      expect(capturedBody).not.toBeNull();
      const parsedBody = JSON.parse(capturedBody!);

      // Phase should be undefined (not present in serialized JSON)
      expect(parsedBody.context.phase).toBeUndefined();
      // But other fields should be present
      expect(parsedBody.context.mode).toBe('implement_feature');
      expect(parsedBody.context.intent).toBe('normal_chat');
    });
  });

  describe('Phase and intent correlation', () => {
    it('should correlate phase: "refine" with intent: "normal_chat"', () => {
      // This test documents the expected correlation
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        phase: 'refine',
        workItem: {
          id: 'FEAT-004',
          title: 'Test',
          type: 'Feature',
          description: 'Test',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.intent).toBe('normal_chat');
      expect(context.phase).toBe('refine');
    });

    it('should correlate phase: "handoff" with intent: "generate_specs"', () => {
      // This test documents the expected correlation
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        phase: 'handoff',
        workItem: {
          id: 'FEAT-005',
          title: 'Test',
          type: 'Feature',
          description: 'Test',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.intent).toBe('generate_specs');
      expect(context.phase).toBe('handoff');
    });
  });
});
