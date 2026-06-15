/**
 * Integration tests for Implement Chat - Planner Conversation Loop
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 7: Integration Verification
 *
 * These tests verify the end-to-end integration of the implement_feature mode:
 * - Context flows from request to prompt builder
 * - Tool execution is bypassed for implement_feature mode
 * - OAS assistant mode continues to work unchanged
 */

import { buildSystemPrompt, buildContextSummary } from '../services/promptBuilder';
import { ChatContext } from '../types/chat';
import { GatewaySession } from '../types/session';

describe('Implement Chat Integration Tests', () => {
  const baseSession: GatewaySession = {
    sessionId: 'integration-test-session',
    mcpSessionId: 'mcp-integration-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('End-to-end workflow: context to prompt', () => {
    it('should flow workItem context through to system prompt', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-E2E-001',
          title: 'End-to-end test feature',
          type: 'Feature',
          description: 'This tests the full context flow',
        },
        architectureContext: {
          entityIds: ['SVC-E2E-001'],
          diagramIds: ['DIA-E2E-001'],
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);
      const summary = buildContextSummary(context);

      // Verify prompt contains injected values
      expect(prompt).toContain('End-to-end test feature');
      expect(prompt).toContain('Feature');
      expect(prompt).toContain('This tests the full context flow');
      expect(prompt).toContain('SVC-E2E-001');
      expect(prompt).toContain('DIA-E2E-001');

      // Verify context summary captures the right metadata
      expect(summary.mode).toBe('implement_feature');
      expect(summary.intent).toBe('normal_chat');
      expect(summary.hasWorkItem).toBe(true);
      expect(summary.workItemId).toBe('FEAT-E2E-001');
      expect(summary.workItemType).toBe('Feature');
      expect(summary.hasArchitectureContext).toBe(true);
      expect(summary.entityIdsCount).toBe(1);
      expect(summary.diagramIdsCount).toBe(1);
    });
  });

  describe('OAS ChatPanel isolation', () => {
    it('should use OAS prompt when mode is undefined (backward compatible)', () => {
      const context: ChatContext = {
        filename: 'architecture.json',
        interfaceId: 'INT-001',
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Should use OAS assistant prompt
      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).toContain('save_oas_spec');
      expect(prompt).toContain('architecture.json');
      expect(prompt).toContain('INT-001');

      // Should NOT contain implement_feature markers
      expect(prompt).not.toContain('Implementation Planner');
      expect(prompt).not.toContain('work item');
    });

    it('should use OAS prompt when mode is explicitly "oas_assistant"', () => {
      const context: ChatContext = {
        mode: 'oas_assistant',
        filename: 'test-model.json',
      };

      const prompt = buildSystemPrompt(baseSession, context);

      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).not.toContain('Implementation Planner');
    });
  });

  describe('Session isolation verification', () => {
    it('should generate different prompts for different contexts in same session', () => {
      // Simulate OAS assistant context
      const oasContext: ChatContext = {
        mode: 'oas_assistant',
        filename: 'architecture.json',
      };

      // Simulate implement_feature context
      const implementContext: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'WI-001',
          title: 'Test Work Item',
          type: 'Story',
          description: 'Test description',
        },
      };

      const oasPrompt = buildSystemPrompt(baseSession, oasContext);
      const implementPrompt = buildSystemPrompt(baseSession, implementContext);

      // Prompts should be completely different
      expect(oasPrompt).toContain('OpenAPI specification assistant');
      expect(implementPrompt).toContain('Implementation Planner');

      // They should not share characteristics
      expect(oasPrompt).not.toContain('Implementation Planner');
      expect(implementPrompt).not.toContain('save_oas_spec');
    });
  });

  describe('Context summary for logging', () => {
    it('should capture all relevant fields for implement_feature mode logging', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'LOG-001',
          title: 'Logging Test',
          type: 'Bug',
          description: 'Test logging fields',
        },
        architectureContext: {
          entityIds: ['E1', 'E2', 'E3'],
          diagramIds: ['D1'],
        },
      };

      const summary = buildContextSummary(context);

      // All implement_feature specific fields should be present
      expect(summary.mode).toBe('implement_feature');
      expect(summary.intent).toBe('normal_chat');
      expect(summary.hasWorkItem).toBe(true);
      expect(summary.workItemId).toBe('LOG-001');
      expect(summary.workItemType).toBe('Bug');
      expect(summary.hasArchitectureContext).toBe(true);
      expect(summary.entityIdsCount).toBe(3);
      expect(summary.diagramIdsCount).toBe(1);
    });

    it('should capture OAS context fields when mode is undefined', () => {
      const context: ChatContext = {
        filename: 'model.json',
        interfaceId: 'interface-123',
        preferredFormat: 'yaml',
        draftOas: 'openapi: 3.0.0\ninfo:\n  title: Test',
      };

      const summary = buildContextSummary(context);

      expect(summary.hasFilename).toBe(true);
      expect(summary.hasInterfaceId).toBe(true);
      expect(summary.preferredFormat).toBe('yaml');
      expect(summary.hasDraftOas).toBe(true);
      expect(summary.draftOasLength).toBeGreaterThan(0);
      expect(summary.mode).toBeUndefined();
    });
  });

  describe('Error handling in context', () => {
    it('should handle missing workItem gracefully in implement_feature mode', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        // workItem intentionally missing
      };

      const prompt = buildSystemPrompt(baseSession, context);
      const summary = buildContextSummary(context);

      // Should still generate valid prompt with "not provided" placeholders
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).toContain('not provided');

      // Summary should indicate no workItem
      expect(summary.hasWorkItem).toBe(false);
    });

    it('should handle empty architectureContext arrays', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'WI-001',
          title: 'Test',
          type: 'Feature',
          description: 'Test',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);
      const summary = buildContextSummary(context);

      expect(prompt).toContain('none'); // Should indicate no linked entities/diagrams
      expect(summary.hasArchitectureContext).toBe(true);
      expect(summary.entityIdsCount).toBe(0);
      expect(summary.diagramIdsCount).toBe(0);
    });
  });
});
