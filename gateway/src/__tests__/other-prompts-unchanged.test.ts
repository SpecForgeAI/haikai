/**
 * Regression Tests for Other Prompts Unchanged
 *
 * Tests verify that the structured refinement prompt changes do not affect:
 * - SYSTEM_PROMPT_TEMPLATE (OAS assistant mode)
 * - IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE (bootstrap phase)
 * - IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE (handoff phase)
 * - buildSystemPrompt() routing logic
 *
 * Spec: Implement Assistant Stage 5 - Structured Refinement Loop for Feature Intent Locking
 */

import { buildSystemPrompt, buildBootstrapPrompt, buildGenerateSpecsPrompt } from '../services/promptBuilder';
import { ChatContext, ProductSummaryDto, MetaModelSummaryDto, ResolvedImplementContextDto } from '../types/chat';
import { GatewaySession } from '../types/session';

describe('Other Prompts Unchanged (Regression Tests)', () => {
  const mockSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('SYSTEM_PROMPT_TEMPLATE (OAS assistant mode) unchanged', () => {
    it('should contain OAS assistant characteristic content', () => {
      // OAS assistant mode is used when mode is undefined or "oas_assistant"
      const oasContext: ChatContext = {
        filename: 'test.json',
        interfaceId: 'INT-001',
        preferredFormat: 'yaml',
      };

      const prompt = buildSystemPrompt(mockSession, oasContext, null);

      // OAS assistant specific content
      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).toContain('save_oas_spec');
      expect(prompt).toContain('compute_oas_gaps');
      expect(prompt).toContain('list_interfaces');
      expect(prompt).toContain('get_interface_oas_context');

      // Should NOT contain implement feature content
      expect(prompt).not.toContain('Implementation Planner');
      expect(prompt).not.toContain('Specification Generator');
      expect(prompt).not.toContain('work item');
    });

    it('should inject OAS context placeholders correctly', () => {
      const oasContext: ChatContext = {
        filename: 'my-architecture.json',
        interfaceId: 'INT-TEST',
        preferredFormat: 'json',
      };

      const prompt = buildSystemPrompt(mockSession, oasContext, null);

      expect(prompt).toContain('my-architecture.json');
      expect(prompt).toContain('INT-TEST');
      expect(prompt).toContain('json');
    });
  });

  describe('IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE (bootstrap phase) unchanged', () => {
    it('should contain bootstrap phase characteristic content', () => {
      const bootstrapContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        filename: 'test.json',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, bootstrapContext, null);

      // Bootstrap prompt specific content
      expect(prompt).toContain('greeting');
      expect(prompt).toContain('short');
      expect(prompt).toContain('welcoming');
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');
      expect(prompt).toContain('ARCHITECTURE META-MODEL SUMMARY');
      expect(prompt).toContain('highlight');

      // Should NOT contain refine phase content
      expect(prompt).not.toContain('structured refinement dialog');
      expect(prompt).not.toContain('RESPONSE FORMAT');
      expect(prompt).not.toContain('plannerReadyForSpec');
    });

    it('should inject bootstrap context placeholders correctly', () => {
      const bootstrapContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        workItem: {
          id: 'WI-456',
          title: 'Bootstrap Test Feature',
          type: 'Epic',
          description: 'Bootstrap test description',
        },
      };

      const productSummary: ProductSummaryDto = {
        initiatives: [
          {
            id: 'init-1',
            title: 'Test Initiative',
            description: 'Test initiative description',
            epics: [],
          },
        ],
      };

      const prompt = buildBootstrapPrompt(bootstrapContext, productSummary, null);

      expect(prompt).toContain('Bootstrap Test Feature');
      expect(prompt).toContain('Epic');
      expect(prompt).toContain('Bootstrap test description');
      expect(prompt).toContain('Test Initiative');
    });
  });

  describe('IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE (handoff phase) unchanged', () => {
    it('should contain generate specs characteristic content', () => {
      const handoffContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'handoff',
        filename: 'test.json',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, handoffContext, null);

      // Generate specs prompt specific content
      expect(prompt).toContain('Specification Generator');
      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('/agent-os:write-spec');
      expect(prompt).toContain('OUTPUT FORMAT');
      expect(prompt).toContain('SPEC CONTENT REQUIREMENTS');

      // Should NOT contain refine phase content
      expect(prompt).not.toContain('structured refinement dialog');
      expect(prompt).not.toContain('RESPONSE FORMAT');
      expect(prompt).not.toContain('plannerReadyForSpec');
    });

    it('should inject generate specs context placeholders correctly', () => {
      const handoffContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'handoff',
        workItem: {
          id: 'WI-789',
          title: 'Handoff Test Feature',
          type: 'Story',
          description: 'Handoff test description',
        },
        architectureContext: {
          entityIds: ['SVC-001', 'INT-002'],
          diagramIds: ['DIA-001'],
        },
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'SVC-001',
            name: 'Test Service',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      const prompt = buildGenerateSpecsPrompt(handoffContext, resolvedContext);

      expect(prompt).toContain('Handoff Test Feature');
      expect(prompt).toContain('Story');
      expect(prompt).toContain('Handoff test description');
      expect(prompt).toContain('SVC-001');
      expect(prompt).toContain('INT-002');
      expect(prompt).toContain('DIA-001');
      expect(prompt).toContain('Test Service');
    });
  });

  describe('buildSystemPrompt() routing unchanged', () => {
    it('should route phase=refine to buildImplementPlannerPrompt', () => {
      const refineContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, refineContext, null);

      // Should contain refine phase content
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).toContain('structured refinement dialog');

      // Should NOT contain other phases content
      expect(prompt).not.toContain('Specification Generator');
      expect(prompt).not.toContain('greeting');
      expect(prompt).not.toContain('save_oas_spec');
    });

    it('should route phase=bootstrap to buildBootstrapPrompt', () => {
      const bootstrapContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, bootstrapContext, null);

      // Should contain bootstrap phase content
      expect(prompt).toContain('greeting');
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');

      // Should NOT contain other phases content
      expect(prompt).not.toContain('structured refinement dialog');
      expect(prompt).not.toContain('Specification Generator');
      expect(prompt).not.toContain('save_oas_spec');
    });

    it('should route phase=handoff to buildGenerateSpecsPrompt', () => {
      const handoffContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'handoff',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, handoffContext, null);

      // Should contain handoff phase content
      expect(prompt).toContain('Specification Generator');
      expect(prompt).toContain('/agent-os:write-spec');

      // Should NOT contain other phases content
      expect(prompt).not.toContain('structured refinement dialog');
      expect(prompt).not.toContain('greeting');
      expect(prompt).not.toContain('save_oas_spec');
    });

    it('should route undefined mode to OAS assistant prompt', () => {
      const noModeContext: ChatContext = {
        filename: 'test.json',
      };

      const prompt = buildSystemPrompt(mockSession, noModeContext, null);

      // Should contain OAS content
      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).toContain('save_oas_spec');

      // Should NOT contain implement feature content
      expect(prompt).not.toContain('Implementation Planner');
      expect(prompt).not.toContain('Specification Generator');
    });
  });
});
