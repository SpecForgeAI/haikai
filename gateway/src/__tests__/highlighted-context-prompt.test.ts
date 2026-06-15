/**
 * Tests for Highlighted Context Prompt Injection - Stage 4
 *
 * Spec: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 * Task Group 3: Prompt Template Enhancement for Highlighted Context
 *
 * Tests verify that:
 * - Resolved context section appears in prompt for refine phase
 * - Resolved entities include name, type, category, relevant_fields
 * - Resolved diagrams include name, diagram_type, referenced entities
 * - Empty highlighted context shows appropriate fallback message
 */

import { buildSystemPrompt, buildImplementPlannerPrompt } from '../services/promptBuilder';
import { ChatContext, ResolvedImplementContextDto } from '../types/chat';
import { GatewaySession } from '../types/session';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

describe('Highlighted Context Prompt Injection - Stage 4', () => {
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
      title: 'Add user profile feature',
      type: 'Feature',
      description: 'Users should be able to view and edit their profile',
    },
    architectureContext: {
      entityIds: ['services::svc-123'],
      diagramIds: ['diagram-1'],
    },
  };

  describe('Resolved context section in refine phase prompt', () => {
    it('should include resolved context details when resolved context present', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-123',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { serviceType: 'REST' },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diagram-1',
            name: 'System Overview',
            diagram_type: 'General',
            referenced_entity_ids: ['svc-123'],
          },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      // Verify resolved context details section exists
      expect(prompt).toContain('Resolved Context Details');
      // Verify entity and diagram names are included
      expect(prompt).toContain('UserService');
      expect(prompt).toContain('System Overview');
    });

    it('should include entity details: name, type, category, relevant_fields', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-456',
            name: 'OrderService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {
              applicationId: 'app-1',
              serviceType: 'gRPC',
            },
          },
        ],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      expect(prompt).toContain('OrderService');
      expect(prompt).toContain('services');
      expect(prompt).toContain('application');
      expect(prompt).toContain('serviceType');
      expect(prompt).toContain('gRPC');
    });

    it('should include diagram details: name, diagram_type, referenced entities', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [
          {
            id: 'diagram-2',
            name: 'User Flow Sequence',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['svc-123', 'svc-456'],
          },
        ],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      expect(prompt).toContain('User Flow Sequence');
      expect(prompt).toContain('Sequence');
    });

    it('should show fallback when no resolved context available', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt).toContain('No resolved context available');
    });

    it('should show fallback when resolved context has empty arrays', () => {
      const emptyResolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, emptyResolvedContext);

      expect(prompt).toContain('No resolved entities or diagrams');
    });
  });

  describe('Assistant guidance for highlighted items', () => {
    it('should include guidance to reference entities by name', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'TestService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      // Rule 8: "Reference entities by name from resolved context, not by raw IDs"
      expect(prompt).toContain('Reference entities by name');
    });

    it('should include guidance to not make up architecture information', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      // Rule 5: "DO NOT make up information about architecture not in resolved context"
      expect(prompt).toContain('DO NOT make up information about architecture');
    });
  });
});
