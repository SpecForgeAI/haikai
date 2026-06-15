/**
 * Tests for phase handling in Gateway
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * Task Group 1: Gateway Types and Prompt Builder
 *
 * Tests the ChatPhase type and phase-based prompt selection logic.
 */

import { buildSystemPrompt, buildContextSummary } from '../services/promptBuilder';
import { GatewaySession } from '../types/session';
import { ChatContext, ChatPhase } from '../types/chat';

// Mock the logger to capture warnings
jest.mock('../services/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../services/logger';

describe('ChatPhase type and phase-based prompt selection', () => {
  const baseSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ChatPhase type validation', () => {
    it('should accept "refine" as a valid ChatPhase value', () => {
      const phase: ChatPhase = 'refine';
      expect(phase).toBe('refine');
    });

    it('should accept "handoff" as a valid ChatPhase value', () => {
      const phase: ChatPhase = 'handoff';
      expect(phase).toBe('handoff');
    });
  });

  describe('buildSystemPrompt phase-based routing', () => {
    it('should return planner prompt when phase is "refine"', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        phase: 'refine',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Planner prompt contains these characteristic strings
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).not.toContain('Specification Generator');
    });

    it('should return generate specs prompt when phase is "handoff"', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        phase: 'handoff',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Generate specs prompt contains these characteristic strings
      expect(prompt).toContain('Specification Generator');
      expect(prompt).not.toContain('Implementation Planner');
    });

    it('should default to planner prompt when phase is undefined', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        // phase is intentionally omitted
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Should default to planner prompt
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).not.toContain('Specification Generator');
    });

    it('should emit warning log for unknown phase values and default to refine', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        phase: 'unknown_phase' as ChatPhase, // Force unknown value
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Should log warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown phase value received: unknown_phase')
      );

      // Should default to planner prompt
      expect(prompt).toContain('Implementation Planner');
    });
  });

  describe('buildContextSummary includes phase', () => {
    it('should include phase in context summary when present', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        phase: 'refine',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const summary = buildContextSummary(context);

      expect(summary.phase).toBe('refine');
    });

    it('should include phase "handoff" in context summary when present', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        phase: 'handoff',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const summary = buildContextSummary(context);

      expect(summary.phase).toBe('handoff');
    });

    it('should not include phase in context summary when not present', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const summary = buildContextSummary(context);

      expect(summary.phase).toBeUndefined();
    });
  });
});
