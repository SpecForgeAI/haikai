/**
 * Tests for Planner prompt templates
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Task Group 3: System Prompts Layer
 */

import { buildSystemPrompt } from '../services/promptBuilder';
import { IMPLEMENT_PLANNING_PROMPT_TEMPLATE } from '../services/implementationPlanningPrompt';
import type { GatewaySession, ChatContext } from '../types';

// Helper to create a minimal session
function createMockSession(): GatewaySession {
  return {
    sessionId: 'test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
    mcpSessionId: 'mcp-123',
  };
}

// Helper to create implement_feature context
function createImplementContext(phase: string): ChatContext {
  return {
    mode: 'implement_feature',
    phase: phase as 'refine' | 'implementation_planning' | 'bootstrap' | 'handoff',
    workItem: {
      id: 'feat-123',
      title: 'Add User Login',
      type: 'Feature',
      description: 'Implement user login functionality',
    },
    architectureContext: {
      entityIds: ['entity-1', 'entity-2'],
      diagramIds: ['diagram-1'],
    },
  };
}

describe('Planner Prompt Templates', () => {
  describe('IMPLEMENT_PLANNER_PROMPT_TEMPLATE (refine phase)', () => {
    it('should contain JSON schema example with schemaVersion 1.1', () => {
      const session = createMockSession();
      const context = createImplementContext('refine');

      const prompt = buildSystemPrompt(session, context);

      expect(prompt).toContain('schemaVersion');
      expect(prompt).toContain('1.1');
    });

    it('should enforce JSON-only output', () => {
      const session = createMockSession();
      const context = createImplementContext('refine');

      const prompt = buildSystemPrompt(session, context);

      expect(prompt).toContain('VALID JSON ONLY');
    });

    it('should specify implementationPlan must be null during refine', () => {
      const session = createMockSession();
      const context = createImplementContext('refine');

      const prompt = buildSystemPrompt(session, context);

      expect(prompt).toContain('implementationPlan');
      expect(prompt).toContain('null');
    });

    it('should include all required placeholder variables', () => {
      const session = createMockSession();
      const context = createImplementContext('refine');

      const prompt = buildSystemPrompt(session, context);

      // Check that placeholders were substituted
      expect(prompt).toContain('Add User Login'); // workItemTitle
      expect(prompt).toContain('Feature'); // workItemType
      expect(prompt).toContain('Implement user login functionality'); // workItemDescription
    });

    it('should include acceptanceCriteria in the JSON schema example', () => {
      const session = createMockSession();
      const context = createImplementContext('refine');

      const prompt = buildSystemPrompt(session, context);

      expect(prompt).toContain('acceptanceCriteria');
    });
  });

  describe('IMPLEMENT_PLANNING_PROMPT_TEMPLATE (implementation_planning phase)', () => {
    it('should contain implementationPlan structure', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('implementationPlan');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('planTitle');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('increments');
    });

    it('should require schemaVersion 1.1', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('"schemaVersion": "1.1"');
    });

    it('should require increments array with partIndex and intent fields', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('"partIndex"');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('"intent"');
    });

    it('should include shaped feature placeholders', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('{featureUnderstanding}');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('{scopeIn}');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('{scopeOut}');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('{assumptions}');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('{acceptanceCriteria}');
    });

    it('should include increment ID format example', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('INC-1');
    });
  });

  describe('buildSystemPrompt with implementation_planning phase', () => {
    it('should return implementation planning prompt for implementation_planning phase', () => {
      const session = createMockSession();
      const context = createImplementContext('implementation_planning');

      const prompt = buildSystemPrompt(session, context);

      // Should contain implementation planning specific content
      expect(prompt).toContain('implementation plan');
      expect(prompt).toContain('increments');
    });

    it('should include isSplit reference in built prompt', () => {
      const session = createMockSession();
      const context = createImplementContext('implementation_planning');

      const prompt = buildSystemPrompt(session, context);

      expect(prompt).toContain('isSplit');
    });
  });

  describe('split plan support in prompt template', () => {
    it('should contain isSplit reference', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('isSplit');
    });

    it('should contain splitting criteria guidance', () => {
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('WHEN TO SPLIT');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('truly independent');
    });

    it('should contain both standard and split JSON examples', () => {
      // Standard Plan: has increments with INC-1
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('Standard Plan');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('"INC-1"');

      // Split Plan: isSplit: true with partIndex
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('Split Plan');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('"isSplit": true');
      expect(IMPLEMENT_PLANNING_PROMPT_TEMPLATE).toContain('"partIndex": 1');
    });
  });
});
