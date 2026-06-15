/**
 * Tests for buildHandoffPlanningPrompt function
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 2: Handoff Planning Prompt Template and Builder
 */

import { buildHandoffPlanningPrompt } from '../services/promptBuilder';
import type { ChatContext, ResolvedImplementContextDto } from '../types';

describe('buildHandoffPlanningPrompt', () => {
  const baseContext: ChatContext = {
    mode: 'implement_feature',
    phase: 'handoff',
    filename: 'test-project',
    workItem: {
      id: 'WI-123',
      title: 'Add user authentication',
      type: 'Feature',
      description: 'Implement login and registration functionality',
    },
    architectureContext: {
      entityIds: ['services::auth-service', 'services::user-service'],
      diagramIds: ['diagram-auth-flow'],
    },
  };

  describe('work item context placeholders', () => {
    it('should include work item title in prompt', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toContain('Add user authentication');
    });

    it('should include work item type in prompt', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toContain('Feature');
    });

    it('should include work item description in prompt', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toContain('Implement login and registration functionality');
    });

    it('should handle missing work item with fallback values', () => {
      const contextWithoutWorkItem: ChatContext = {
        mode: 'implement_feature',
        phase: 'handoff',
      };
      const prompt = buildHandoffPlanningPrompt(contextWithoutWorkItem);
      expect(prompt).toContain('not provided');
    });
  });

  describe('architecture context placeholders', () => {
    it('should include entity IDs in prompt', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toContain('services::auth-service');
      expect(prompt).toContain('services::user-service');
    });

    it('should include diagram IDs in prompt', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toContain('diagram-auth-flow');
    });

    it('should handle empty architecture context', () => {
      const contextWithEmptyArch: ChatContext = {
        ...baseContext,
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };
      const prompt = buildHandoffPlanningPrompt(contextWithEmptyArch);
      // Should still produce valid prompt with "none" for empty arrays
      expect(prompt).toContain('none');
    });
  });

  describe('resolved context inclusion', () => {
    it('should include resolved context when provided', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'services::auth-service',
            name: 'Authentication Service',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { technology: 'Node.js' },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diagram-auth-flow',
            name: 'Auth Flow Diagram',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['services::auth-service'],
            referenced_entity_names: ['Authentication Service'],
          },
        ],
      };
      const prompt = buildHandoffPlanningPrompt(baseContext, resolvedContext);
      expect(prompt).toContain('Authentication Service');
    });

    it('should handle null resolved context', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext, null);
      expect(prompt).toContain('No resolved context available');
    });
  });

  describe('splitting heuristics instructions', () => {
    it('should include multi-service boundary heuristic', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toMatch(/multi.*service.*boundary/i);
    });

    it('should include multiple user behaviors heuristic', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toMatch(/multiple.*independent.*user.*visible.*behaviors/i);
    });

    it('should include data/schema with UI heuristic', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toMatch(/data.*schema.*UI/i);
    });

    it('should include prompt/LLM orchestration heuristic', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toMatch(/prompt.*LLM.*orchestration/i);
    });
  });

  describe('JSON-only output instructions', () => {
    it('should instruct LLM to output ONLY JSON', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toMatch(/only.*json/i);
    });

    it('should include JSON schema specification', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toContain('is_split');
      expect(prompt).toContain('handoff_plan_summary');
      expect(prompt).toContain('handoff_intents');
    });

    it('should instruct no prose before or after JSON', () => {
      const prompt = buildHandoffPlanningPrompt(baseContext);
      expect(prompt).toMatch(/no.*prose/i);
    });
  });
});
