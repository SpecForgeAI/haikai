/**
 * Tests for Structured Refinement Prompt Template
 *
 * Tests cover:
 * - JSON schema structure with required fields
 * - Placeholder preservation (work item context, architecture context)
 * - DO NOT VIOLATE rules preservation
 * - Behavior rule instructions
 * - Progression guidance
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract v1.1
 * Spec 2026-01-24: Planner Message Hygiene (300 char limit, no bullets)
 */

import { buildSystemPrompt, buildImplementPlannerPrompt } from '../services/promptBuilder';
import { ChatContext } from '../types/chat';
import { GatewaySession } from '../types/session';

describe('Structured Refinement Prompt Template', () => {
  const mockSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  const mockContext: ChatContext = {
    mode: 'implement_feature',
    phase: 'refine',
    filename: 'test-project.json',
    workItem: {
      id: 'WI-123',
      title: 'Add user authentication feature',
      type: 'Feature',
      description: 'Users should be able to authenticate via OAuth2',
    },
    architectureContext: {
      entityIds: ['SVC-AUTH', 'INT-API'],
      diagramIds: ['DIA-001'],
    },
  };

  describe('Part 1: Restate (Replay) Current Understanding', () => {
    it('should contain structured refinement role and JSON schema with featureUnderstanding', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify refinement role
      expect(prompt).toContain('structured refinement dialog');
      expect(prompt).toContain('featureUnderstanding');

      // Verify scope fields exist in schema
      expect(prompt).toContain('"scope"');
      expect(prompt).toContain('"in"');
      expect(prompt).toContain('"out"');
    });
  });

  describe('Part 2: Explicit Assumptions List', () => {
    it('should contain assumptions field with falsifiable guidance', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify assumptions field in schema
      expect(prompt).toContain('"assumptions"');

      // Verify falsifiable guidance in field guidelines
      expect(prompt.toLowerCase()).toContain('falsifiable');
    });
  });

  describe('Part 3: Focused Clarifying Questions', () => {
    it('should contain openQuestions field with 3-7 question progression guidance', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify questions field in schema
      expect(prompt).toContain('"openQuestions"');

      // Verify 3-7 question count guidance in PROGRESSION section
      expect(prompt).toMatch(/3.*7|3-7/);

      // Verify questions must be focused
      expect(prompt.toLowerCase()).toContain('focused');
    });
  });

  describe('Part 4: Proposed Final Feature Definition', () => {
    it('should contain plannerReadyForSpec and implementationPlan fields', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify readiness and plan fields in schema
      expect(prompt).toContain('"plannerReadyForSpec"');
      expect(prompt).toContain('"implementationPlan"');

      // Verify implementation plan must be null in this phase
      expect(prompt.toLowerCase()).toContain('null');
      expect(prompt.toLowerCase()).toContain('implementation_planning phase');
    });
  });

  describe('Placeholder Preservation', () => {
    it('should preserve all existing placeholders', () => {
      const contextWithValues: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'WI-123',
          title: 'TEST_TITLE_PLACEHOLDER',
          type: 'TEST_TYPE_PLACEHOLDER',
          description: 'TEST_DESCRIPTION_PLACEHOLDER',
        },
        architectureContext: {
          entityIds: ['ENTITY_ID_1', 'ENTITY_ID_2'],
          diagramIds: ['DIAGRAM_ID_1'],
        },
      };

      const prompt = buildImplementPlannerPrompt(contextWithValues, null);

      // Verify placeholders are replaced with actual values
      expect(prompt).toContain('TEST_TITLE_PLACEHOLDER');
      expect(prompt).toContain('TEST_TYPE_PLACEHOLDER');
      expect(prompt).toContain('TEST_DESCRIPTION_PLACEHOLDER');
      expect(prompt).toContain('ENTITY_ID_1');
      expect(prompt).toContain('ENTITY_ID_2');
      expect(prompt).toContain('DIAGRAM_ID_1');

      // Verify context sections exist
      expect(prompt).toContain('CONTEXT');
      expect(prompt).toContain('Entity IDs');
      expect(prompt).toContain('Diagram IDs');
      expect(prompt).toContain('Resolved Context Details');
    });
  });

  describe('DO NOT VIOLATE Rules Preservation', () => {
    it('should preserve existing DO NOT VIOLATE rules', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify DO NOT VIOLATE rules section exists
      expect(prompt).toContain('DO NOT VIOLATE');

      // Verify no code generation rule
      expect(prompt).toContain('DO NOT generate code, specs');

      // Verify no MCP tools rule
      expect(prompt.toLowerCase()).toContain('mcp');
      expect(prompt.toLowerCase()).toContain('tool');

      // Verify reference entities by name rule
      expect(prompt.toLowerCase()).toContain('reference entities by name');
      expect(prompt.toLowerCase()).toContain('not by raw ids');
    });
  });

  describe('Behavior Rule: Avoid Speculative Details and New Requirements', () => {
    it('should instruct assistant not to generate implementation details or make up information', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify no implementation details rule
      expect(prompt.toLowerCase()).toContain('do not generate code, specs, or implementation details');

      // Verify no making up information rule
      expect(prompt.toLowerCase()).toContain('do not make up information');
    });
  });

  describe('Behavior Rule: Entity Names and Clarity', () => {
    it('should instruct assistant to reference entities by name and prefer clarity over verbosity', () => {
      const prompt = buildImplementPlannerPrompt(mockContext, null);

      // Verify entity name reference instruction
      expect(prompt.toLowerCase()).toContain('name');
      expect(prompt.toLowerCase()).toMatch(/reference|entity/);

      // Verify conciseness instruction
      expect(prompt.toLowerCase()).toMatch(/concise|brief/);
    });
  });

  describe('Integration with buildSystemPrompt routing', () => {
    it('should route phase=refine to the structured refinement prompt via buildSystemPrompt', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      // Verify it returns the implementation planner prompt with JSON schema
      expect(prompt).toContain('structured refinement dialog');
      expect(prompt).toContain('"featureUnderstanding"');
      expect(prompt).toContain('"openQuestions"');
      expect(prompt).toContain('"plannerReadyForSpec"');
      expect(prompt).toContain('DO NOT VIOLATE');
    });
  });
});
