/**
 * Tests for Frontend Phase Types
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * Task Group 2: Frontend Types and API Updates
 *
 * Tests the ImplementChatPhase type and phase field on ImplementChatContext.
 */

import { describe, it, expect } from 'vitest';
import {
  ImplementChatPhase,
  ImplementChatContext,
} from '../api/chatApi';

describe('Frontend Phase Types', () => {
  describe('ImplementChatPhase type validation', () => {
    it('should accept "refine" as a valid ImplementChatPhase value', () => {
      const phase: ImplementChatPhase = 'refine';
      expect(phase).toBe('refine');
    });

    it('should accept "handoff" as a valid ImplementChatPhase value', () => {
      const phase: ImplementChatPhase = 'handoff';
      expect(phase).toBe('handoff');
    });
  });

  describe('ImplementChatContext interface with phase field', () => {
    it('should accept context with phase: "refine"', () => {
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

      expect(context.phase).toBe('refine');
      expect(context.mode).toBe('implement_feature');
      expect(context.intent).toBe('normal_chat');
    });

    it('should accept context with phase: "handoff"', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        phase: 'handoff',
        workItem: {
          id: 'FEAT-002',
          title: 'Another Feature',
          type: 'Feature',
          description: 'Another description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.phase).toBe('handoff');
      expect(context.mode).toBe('implement_feature');
      expect(context.intent).toBe('generate_specs');
    });

    it('should accept context without phase (optional field for backward compatibility)', () => {
      const context: ImplementChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        // phase is intentionally omitted
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

      expect(context.phase).toBeUndefined();
      expect(context.mode).toBe('implement_feature');
    });
  });
});
