/**
 * Tests for prompt selection and content in implement_feature mode
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 2: Implement Feature System Prompt
 */

import { buildSystemPrompt, buildContextSummary } from '../services/promptBuilder';
import { GatewaySession } from '../types/session';
import { ChatContext } from '../types/chat';

describe('buildSystemPrompt for implement_feature mode', () => {
  const baseSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('prompt template selection', () => {
    it('should use SYSTEM_PROMPT_TEMPLATE when mode is undefined', () => {
      const context: ChatContext = {
        filename: 'architecture.json',
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // OAS assistant prompt contains these characteristic strings
      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).toContain('save_oas_spec');
      expect(prompt).not.toContain('work item');
    });

    it('should use SYSTEM_PROMPT_TEMPLATE when mode is "oas_assistant"', () => {
      const context: ChatContext = {
        filename: 'architecture.json',
        mode: 'oas_assistant',
      };

      const prompt = buildSystemPrompt(baseSession, context);

      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).toContain('save_oas_spec');
      expect(prompt).not.toContain('work item');
    });

    it('should use IMPLEMENT_PLANNER_PROMPT_TEMPLATE when mode is "implement_feature"', () => {
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

      const prompt = buildSystemPrompt(baseSession, context);

      // Implement planner prompt contains these characteristic strings
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).not.toContain('save_oas_spec');
    });
  });

  describe('workItem context injection', () => {
    it('should inject workItem title, type, and description into prompt', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-123',
          title: 'Add user authentication',
          type: 'Feature',
          description: 'Implement OAuth2 authentication with Google provider',
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Feature');
      expect(prompt).toContain('Implement OAuth2 authentication with Google provider');
    });

    it('should handle missing workItem gracefully', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Should still generate a valid prompt
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).toContain('not provided');
    });
  });

  describe('architectureContext injection', () => {
    it('should inject entityIds and diagramIds into prompt', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: ['SVC-AUTH', 'APP-WEB', 'INT-API'],
          diagramIds: ['DIA-001', 'DIA-002'],
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      expect(prompt).toContain('SVC-AUTH');
      expect(prompt).toContain('APP-WEB');
      expect(prompt).toContain('INT-API');
      expect(prompt).toContain('DIA-001');
      expect(prompt).toContain('DIA-002');
    });

    it('should handle empty architectureContext arrays', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
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

      const prompt = buildSystemPrompt(baseSession, context);

      // Should indicate no linked entities/diagrams
      expect(prompt).toContain('none');
    });
  });

  describe('prompt content requirements', () => {
    it('should contain structured refinement dialog and JSON response format elements', () => {
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

      const prompt = buildSystemPrompt(baseSession, context);

      // Check for structured refinement dialog elements (current prompt)
      expect(prompt).toContain('structured refinement dialog');
      expect(prompt).toContain('RESPONSE FORMAT');
      expect(prompt).toContain('schemaVersion');
      expect(prompt).toContain('featureUnderstanding');
      expect(prompt).toContain('scope');
      expect(prompt).toContain('assumptions');
      expect(prompt).toContain('acceptanceCriteria');
      expect(prompt).toContain('openQuestions');
      expect(prompt).toContain('plannerReadyForSpec');
      expect(prompt).toContain('PROGRESSION');
    });

    it('should explicitly forbid code generation and tool calls', () => {
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

      const prompt = buildSystemPrompt(baseSession, context);

      // Check for forbidden actions
      expect(prompt.toLowerCase()).toContain('do not');
      expect(prompt.toLowerCase()).toMatch(/code|implement/i);
      // Check for MCP tool prohibition
      expect(prompt).toContain('DO NOT call MCP tools');
    });
  });
});

describe('buildContextSummary for implement_feature mode', () => {
  it('should include mode in context summary', () => {
    const context: ChatContext = {
      mode: 'implement_feature',
      intent: 'normal_chat',
    };

    const summary = buildContextSummary(context);

    expect(summary.mode).toBe('implement_feature');
    expect(summary.intent).toBe('normal_chat');
  });

  it('should include workItem presence in context summary', () => {
    const context: ChatContext = {
      mode: 'implement_feature',
      workItem: {
        id: 'FEAT-001',
        title: 'Test Feature',
        type: 'Feature',
        description: 'Test description',
      },
    };

    const summary = buildContextSummary(context);

    expect(summary.hasWorkItem).toBe(true);
    expect(summary.workItemId).toBe('FEAT-001');
    expect(summary.workItemType).toBe('Feature');
  });

  it('should include architectureContext presence in context summary', () => {
    const context: ChatContext = {
      mode: 'implement_feature',
      architectureContext: {
        entityIds: ['ENT-001', 'ENT-002'],
        diagramIds: ['DIA-001'],
      },
    };

    const summary = buildContextSummary(context);

    expect(summary.hasArchitectureContext).toBe(true);
    expect(summary.entityIdsCount).toBe(2);
    expect(summary.diagramIdsCount).toBe(1);
  });
});
