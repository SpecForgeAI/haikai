/**
 * Tests for Generate Specs prompt template and building
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 2: Generate Specs System Prompt
 */

import { buildSystemPrompt, buildGenerateSpecsPrompt } from '../services/promptBuilder';
import { GatewaySession } from '../types/session';
import { ChatContext, ResolvedImplementContextDto } from '../types/chat';

describe('Generate Specs Prompt', () => {
  const baseSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('buildSystemPrompt prompt selection', () => {
    it('should return generate specs prompt when mode is "implement_feature" and intent is "generate_specs"', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(baseSession, context);

      // Generate specs prompt should contain these characteristic strings
      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('/agent-os:write-spec');
      // Should NOT contain normal planner dialog instructions
      expect(prompt).not.toContain('structured refinement dialog');
      expect(prompt).not.toContain('plannerReadyForSpec');
    });

    it('should return implement planner prompt when mode is "implement_feature" and intent is "normal_chat"', () => {
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

      // Normal planner prompt should contain dialog instructions
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).toContain('structured refinement dialog');
      expect(prompt).toContain('RESPONSE FORMAT');
    });

    it('should return implement planner prompt when mode is "implement_feature" and intent is undefined', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
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
      expect(prompt).not.toContain('JSON array of strings');
    });
  });

  describe('buildGenerateSpecsPrompt context injection', () => {
    it('should inject work item title, type, and description into prompt', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-123',
          title: 'Add user authentication',
          type: 'Epic',
          description: 'Implement OAuth2 authentication with Google provider',
        },
      };

      const prompt = buildGenerateSpecsPrompt(context);

      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Epic');
      expect(prompt).toContain('Implement OAuth2 authentication with Google provider');
    });

    it('should inject architecture context entityIds and diagramIds', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
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

      const prompt = buildGenerateSpecsPrompt(context);

      expect(prompt).toContain('SVC-AUTH');
      expect(prompt).toContain('APP-WEB');
      expect(prompt).toContain('INT-API');
      expect(prompt).toContain('DIA-001');
      expect(prompt).toContain('DIA-002');
    });

    it('should inject resolved context when provided', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'SVC-AUTH',
            name: 'Authentication Service',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { technology: 'Node.js' },
          },
        ],
        resolved_diagrams: [
          {
            id: 'DIA-001',
            name: 'Architecture Overview',
            diagram_type: 'General',
            referenced_entity_ids: ['SVC-AUTH'],
          },
        ],
      };

      const prompt = buildGenerateSpecsPrompt(context, resolvedContext);

      expect(prompt).toContain('Authentication Service');
      expect(prompt).toContain('Architecture Overview');
    });
  });

  describe('prompt content requirements', () => {
    it('should contain JSON array format instructions', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildGenerateSpecsPrompt(context);

      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('/agent-os:write-spec');
      // Should contain format example
      expect(prompt).toMatch(/\[.*\/agent-os:write-spec.*\]/s);
    });

    it('should explicitly forbid explanatory prose and tool calls', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildGenerateSpecsPrompt(context);

      // Check for forbidden actions
      expect(prompt.toLowerCase()).toContain('do not');
      expect(prompt).toMatch(/prose|explanation/i);
      expect(prompt).toMatch(/tool|mcp/i);
    });

    it('should instruct model to consider conversation history', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildGenerateSpecsPrompt(context);

      expect(prompt).toMatch(/conversation|dialog|history/i);
    });
  });
});
