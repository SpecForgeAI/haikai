/**
 * Integration Tests for Highlighted Context - Stage 4
 *
 * Spec: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 * Task Group 6: Test Review and Gap Analysis
 *
 * These tests verify the full flow from frontend selection through gateway resolution
 * to prompt injection for highlighted context.
 */

import { buildSystemPrompt, buildImplementPlannerPrompt, formatHighlightedContext } from '../services/promptBuilder';
import { ChatContext, ResolvedImplementContextDto, ResolvedDiagramSummary } from '../types/chat';
import { GatewaySession } from '../types/session';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

describe('Highlighted Context Integration - Stage 4', () => {
  const mockSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('Full flow: frontend selection -> gateway resolution -> prompt injection', () => {
    it('should include highlighted entities in final prompt', () => {
      // Simulate frontend sending highlighted entity IDs
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-integration-001',
          title: 'Integration Test Feature',
          type: 'Feature',
          description: 'Testing the full flow',
        },
        architectureContext: {
          entityIds: ['services::svc-highlighted-001', 'classes::cls-highlighted-002'],
          diagramIds: [],
        },
      };

      // Simulate backend resolution response
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-highlighted-001',
            name: 'HighlightedUserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { serviceType: 'REST' },
          },
          {
            id: 'cls-highlighted-002',
            name: 'HighlightedUserController',
            entity_type: 'classes',
            category: 'application',
            relevant_fields: { namespace: 'com.example.controllers' },
          },
        ],
        resolved_diagrams: [],
      };

      // Build prompt
      const prompt = buildSystemPrompt(mockSession, context, resolvedContext);

      // Verify highlighted entities appear in final prompt
      expect(prompt).toContain('HighlightedUserService');
      expect(prompt).toContain('HighlightedUserController');
      expect(prompt).toContain('REST');
      expect(prompt).toContain('com.example.controllers');
    });

    it('should include highlighted diagrams with entity names in final prompt', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-integration-002',
          title: 'Diagram Integration Test',
          type: 'Feature',
          description: 'Testing diagram highlighting',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: ['diagram-highlighted-001'],
        },
      };

      // Simulate backend resolution with entity names populated
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [
          {
            id: 'diagram-highlighted-001',
            name: 'Highlighted System Overview',
            diagram_type: 'General',
            referenced_entity_ids: ['services::svc-001', 'services::svc-002'],
            referenced_entity_names: ['UserService', 'OrderService'],
          },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, context, resolvedContext);

      expect(prompt).toContain('Highlighted System Overview');
      expect(prompt).toContain('General');
      // Should prefer entity names over IDs
      expect(prompt).toContain('UserService');
      expect(prompt).toContain('OrderService');
    });
  });

  describe('Empty selection handling across all layers', () => {
    it('should handle empty entityIds and diagramIds gracefully', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        filename: 'test-project.json',
        workItem: {
          id: 'WI-empty-001',
          title: 'Empty Selection Feature',
          type: 'Feature',
          description: 'No highlighted items',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      // Empty resolved context (simulating backend response when nothing selected)
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, context, resolvedContext);

      // Should not crash and should indicate no resolved context
      expect(prompt).toContain('No resolved entities or diagrams');
      expect(prompt).toContain('Implementation Planner');
    });

    it('should handle null resolved context gracefully', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'WI-null-001',
          title: 'Null Context Feature',
          type: 'Feature',
          description: 'Resolution failed',
        },
        architectureContext: {
          entityIds: ['services::svc-not-found'],
          diagramIds: [],
        },
      };

      // Resolution failed - null context
      const prompt = buildSystemPrompt(mockSession, context, null);

      expect(prompt).toContain('No resolved context available');
      expect(prompt).toContain('Implementation Planner');
    });
  });

  describe('Resolution failure graceful degradation', () => {
    it('should fall back to IDs when entity names are not available', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'WI-fallback-001',
          title: 'Fallback Feature',
          type: 'Feature',
          description: 'Testing ID fallback',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: ['diagram-no-names'],
        },
      };

      // Diagram without entity names (backend could not resolve them)
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [
          {
            id: 'diagram-no-names',
            name: 'Diagram Without Names',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['services::svc-unknown-001'],
            // No referenced_entity_names - should fall back to IDs
          },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, context, resolvedContext);

      expect(prompt).toContain('Diagram Without Names');
      expect(prompt).toContain('Sequence');
      // Should fall back to IDs when names not available
      expect(prompt).toContain('svc-unknown-001');
    });

    it('should handle partial entity name resolution', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [
          {
            id: 'diagram-partial',
            name: 'Partial Resolution Diagram',
            diagram_type: 'General',
            referenced_entity_ids: ['services::svc-001', 'services::svc-002', 'services::svc-003'],
            // Only 2 out of 3 names resolved
            referenced_entity_names: ['Service1', 'Service2'],
          },
        ],
      };

      const formatted = formatHighlightedContext(resolvedContext);

      // Should use the names that were resolved
      expect(formatted).toContain('Service1');
      expect(formatted).toContain('Service2');
    });
  });

  describe('formatHighlightedContext helper', () => {
    it('should return empty message when no items highlighted', () => {
      const result = formatHighlightedContext(null);
      expect(result).toBe('No items highlighted by user.');
    });

    it('should return empty message when resolved context has empty arrays', () => {
      const emptyContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };
      const result = formatHighlightedContext(emptyContext);
      expect(result).toBe('No items highlighted by user.');
    });

    it('should format entities with name, type, category, and relevant fields', () => {
      const context: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-format-001',
            name: 'FormattedService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { serviceType: 'GraphQL', applicationId: 'app-1' },
          },
        ],
        resolved_diagrams: [],
      };

      const result = formatHighlightedContext(context);

      expect(result).toContain('Highlighted Entities:');
      expect(result).toContain('FormattedService');
      expect(result).toContain('services');
      expect(result).toContain('application');
      expect(result).toContain('serviceType: GraphQL');
      expect(result).toContain('applicationId: app-1');
    });

    it('should format diagrams with name, type, and references', () => {
      const context: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [
          {
            id: 'diag-format-001',
            name: 'FormattedDiagram',
            diagram_type: 'Activity',
            referenced_entity_ids: ['id-1', 'id-2'],
            referenced_entity_names: ['Entity1', 'Entity2'],
          },
        ],
      };

      const result = formatHighlightedContext(context);

      expect(result).toContain('Highlighted Diagrams:');
      expect(result).toContain('FormattedDiagram');
      expect(result).toContain('Activity');
      expect(result).toContain('Entity1');
      expect(result).toContain('Entity2');
    });
  });
});
