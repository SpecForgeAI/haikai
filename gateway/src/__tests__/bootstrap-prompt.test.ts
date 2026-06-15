/**
 * Tests for Bootstrap Phase Prompt and Routing
 *
 * Tests cover:
 * - IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE structure
 * - buildBootstrapPrompt() function
 * - buildSystemPrompt() routing for phase: 'bootstrap'
 * - tryResolveImplementContext() allowing empty message for bootstrap
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 */

import { buildSystemPrompt, buildBootstrapPrompt } from '../services/promptBuilder';
import { ChatContext, ProductSummaryDto, MetaModelSummaryDto } from '../types/chat';
import { GatewaySession } from '../types/session';

describe('Bootstrap Phase Prompt and Routing', () => {
  const mockSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  const mockContext: ChatContext = {
    mode: 'implement_feature',
    phase: 'bootstrap',
    filename: 'test-project.json',
    workItem: {
      id: 'WI-123',
      title: 'Add user profile feature',
      type: 'Feature',
      description: 'Users should be able to view and edit their profile',
    },
    architectureContext: {
      entityIds: [],
      diagramIds: [],
    },
  };

  describe('buildSystemPrompt routing for bootstrap phase', () => {
    it('should route phase: bootstrap to bootstrap template', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      // Bootstrap prompt should have specific sections
      expect(prompt).toContain('YOUR ROLE');
      expect(prompt).toContain('WORK ITEM CONTEXT');
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');
      expect(prompt).toContain('ARCHITECTURE META-MODEL SUMMARY');
      expect(prompt).toContain('INSTRUCTIONS');
      expect(prompt).toContain('RULES');
    });

    it('should still route phase: refine to planner template', () => {
      const refineContext: ChatContext = {
        ...mockContext,
        phase: 'refine',
      };

      const prompt = buildSystemPrompt(mockSession, refineContext, null);

      expect(prompt).toContain('Implementation Planner');
      expect(prompt).toContain('structured refinement dialog');
    });

    it('should still route phase: handoff to generate specs template', () => {
      const handoffContext: ChatContext = {
        ...mockContext,
        phase: 'handoff',
      };

      const prompt = buildSystemPrompt(mockSession, handoffContext, null);

      expect(prompt).toContain('Specification Generator');
    });
  });

  describe('IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE content', () => {
    it('should include required sections', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      // Required sections per spec
      expect(prompt).toContain('YOUR ROLE');
      expect(prompt).toContain('WORK ITEM CONTEXT');
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');
      expect(prompt).toContain('ARCHITECTURE META-MODEL SUMMARY');
      expect(prompt).toContain('INSTRUCTIONS');
      expect(prompt).toContain('RULES');
    });

    it('should instruct LLM to acknowledge feature and context', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt.toLowerCase()).toContain('acknowledge');
      expect(prompt.toLowerCase()).toContain('welcom');
    });

    it('should instruct LLM to ask about architecture/diagrams', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt).toContain('highlight');
      expect(prompt.toLowerCase()).toContain('diagram');
    });

    it('should forbid detailed questions and proposing solutions', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt).toContain('DO NOT');
      expect(prompt.toLowerCase()).toContain('question');
      expect(prompt.toLowerCase()).toContain('solution');
    });

    it('should forbid refining requirements', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt.toLowerCase()).toContain('refine');
      expect(prompt).toContain('DO NOT');
    });
  });

  describe('buildBootstrapPrompt with context', () => {
    it('should include work item fields in prompt', () => {
      const prompt = buildBootstrapPrompt(mockContext, null, null);

      expect(prompt).toContain('Add user profile feature');
      expect(prompt).toContain('Feature');
      expect(prompt).toContain('view and edit their profile');
    });

    it('should format product summary when provided', () => {
      const productSummary: ProductSummaryDto = {
        initiatives: [
          {
            id: 'init-1',
            title: 'User Management',
            description: 'Comprehensive user management',
            epics: [
              {
                id: 'epic-1',
                title: 'Authentication',
                description: 'User auth system',
                features: [
                  {
                    id: 'feat-1',
                    title: 'Login',
                    description: 'User login',
                  },
                ],
              },
            ],
          },
        ],
      };

      const prompt = buildBootstrapPrompt(mockContext, productSummary, null);

      expect(prompt).toContain('User Management');
      expect(prompt).toContain('Authentication');
      expect(prompt).toContain('Login');
    });

    it('should show placeholder when product summary is null', () => {
      const prompt = buildBootstrapPrompt(mockContext, null, null);

      expect(prompt).toContain('No product backlog available');
    });

    it('should format meta-model summary when provided', () => {
      const metaModelSummary: MetaModelSummaryDto = {
      applications: [],
      business_users: [],
      process_activities: [],
      ui_screens: [],
      data_store_count: 0,
        services: [
          { id: 'svc-1', name: 'UserService', entity_type: 'services' },
        ],
        data_entities: [
          { id: 'lde-1', name: 'User', entity_type: 'logicalDataEntities' },
        ],
        interfaces: [
          { id: 'int-1', name: 'UserAPI', entity_type: 'interfaces' },
        ],
        relationships: [
          { source_entity: 'UserService', target_entity: 'UserAPI', relationship_type: 'exposes' },
        ],
      };

      const prompt = buildBootstrapPrompt(mockContext, null, metaModelSummary);

      expect(prompt).toContain('UserService');
      expect(prompt).toContain('User');
      expect(prompt).toContain('UserAPI');
    });

    it('should show placeholder when meta-model summary is null', () => {
      const prompt = buildBootstrapPrompt(mockContext, null, null);

      expect(prompt).toContain('No architecture context available');
    });
  });

  describe('Bootstrap prompt rules', () => {
    it('should instruct short welcome response', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt.toLowerCase()).toContain('short');
      expect(prompt.toLowerCase()).toContain('welcom');
    });
  });
});
