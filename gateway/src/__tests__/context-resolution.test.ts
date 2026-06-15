/**
 * Tests for Implement Context Resolution - Iteration 3
 *
 * Tests cover:
 * - architectureModelClient.ts resolveImplementContext function
 * - promptBuilder.ts buildImplementPlannerPrompt with resolved context
 * - chat.ts integration with context resolution
 */

import { buildSystemPrompt, buildImplementPlannerPrompt } from '../services/promptBuilder';
import { ResolvedImplementContextDto, ChatContext } from '../types/chat';
import { GatewaySession } from '../types/session';

// Mock the config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// Mock fetch for architectureModelClient tests
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Implement Context Resolution - Iteration 3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ResolvedImplementContext types', () => {
    it('should accept valid ResolvedImplementContextDto structure', () => {
      // This is a compile-time check - if types are wrong, TypeScript will fail
      const validContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-123',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { applicationId: 'app-1' },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diagram-1',
            name: 'System Overview',
            diagram_type: 'General',
            referenced_entity_ids: ['svc-123', 'app-1'],
          },
        ],
      };

      expect(validContext.resolved_entities).toHaveLength(1);
      expect(validContext.resolved_diagrams).toHaveLength(1);
      expect(validContext.resolved_entities[0].entity_type).toBe('services');
      expect(validContext.resolved_diagrams[0].diagram_type).toBe('General');
    });

    it('should accept empty resolved context', () => {
      const emptyContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      expect(emptyContext.resolved_entities).toHaveLength(0);
      expect(emptyContext.resolved_diagrams).toHaveLength(0);
    });
  });

  describe('buildImplementPlannerPrompt with resolved context', () => {
    const mockSession: GatewaySession = {
      sessionId: 'test-session',
      mcpSessionId: 'mcp-test-session',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    const mockContext: ChatContext = {
      mode: 'implement_feature',
      filename: 'test-project.json',
      workItem: {
        id: 'WI-123',
        title: 'Add user profile feature',
        type: 'Feature',
        description: 'Users should be able to view and edit their profile',
      },
      architectureContext: {
        entityIds: ['services::svc-123', 'classes::cls-456'],
        diagramIds: ['diagram-1'],
      },
    };

    it('should include resolved context in system prompt', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-123',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { applicationId: 'app-1', serviceType: 'REST' },
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

      // Verify prompt contains resolved context section
      expect(prompt).toContain('Resolved Context Details');
      expect(prompt).toContain('UserService');
      expect(prompt).toContain('System Overview');
      expect(prompt).toContain('services');
      expect(prompt).toContain('application');
    });

    it('should show "No resolved context available" when context is null', () => {
      const prompt = buildSystemPrompt(mockSession, mockContext, null);

      expect(prompt).toContain('No resolved context available');
    });

    it('should show "No resolved entities or diagrams" when lists are empty', () => {
      const emptyResolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, emptyResolvedContext);

      expect(prompt).toContain('No resolved entities or diagrams');
    });

    it('should include rule about using entity names instead of IDs', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-123',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      // Check for the rules about entity names (rule 8 in current prompt)
      expect(prompt).toContain('Reference entities by name from resolved context');
      // Check for rule about not making up information (rule 5 in current prompt)
      expect(prompt).toContain('DO NOT make up information about architecture');
    });

    it('should format relevant fields in resolved context JSON', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'endpoint-1',
            name: 'getUser',
            entity_type: 'endpoints',
            category: 'application',
            relevant_fields: {
              interfaceId: 'iface-1',
              httpMethod: 'GET',
              path: '/api/users/{id}',
            },
          },
        ],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, mockContext, resolvedContext);

      // Verify relevant fields are included in the formatted JSON
      expect(prompt).toContain('httpMethod');
      expect(prompt).toContain('GET');
      expect(prompt).toContain('/api/users/{id}');
    });
  });

  describe('buildSystemPrompt mode selection', () => {
    const mockSession: GatewaySession = {
      sessionId: 'test-session',
      mcpSessionId: 'mcp-test-session',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    it('should use OAS assistant prompt when mode is not implement_feature', () => {
      const context: ChatContext = {
        mode: 'oas_assistant',
        filename: 'test.json',
      };

      const prompt = buildSystemPrompt(mockSession, context, null);

      expect(prompt).toContain('OpenAPI specification assistant');
      expect(prompt).not.toContain('Implementation Planner');
    });

    it('should use implement planner prompt when mode is implement_feature', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        workItem: {
          id: 'WI-1',
          title: 'Test',
          type: 'Feature',
          description: 'Test description',
        },
      };

      const prompt = buildSystemPrompt(mockSession, context, null);

      expect(prompt).toContain('Implementation Planner');
      expect(prompt).not.toContain('OpenAPI specification assistant');
    });

    it('should pass resolved context only to implement_feature mode', () => {
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

      // OAS mode should not include resolved context
      const oasContext: ChatContext = {
        mode: 'oas_assistant',
        filename: 'test.json',
      };
      const oasPrompt = buildSystemPrompt(mockSession, oasContext, resolvedContext);
      expect(oasPrompt).not.toContain('TestService');

      // Implement mode should include resolved context
      const implementContext: ChatContext = {
        mode: 'implement_feature',
        workItem: {
          id: 'WI-1',
          title: 'Test',
          type: 'Feature',
          description: 'Test',
        },
      };
      const implementPrompt = buildSystemPrompt(mockSession, implementContext, resolvedContext);
      expect(implementPrompt).toContain('TestService');
    });
  });

  describe('architectureModelClient resolveImplementContext', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should call correct endpoint with proper request body', async () => {
      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-123',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // Import after mocking
      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'test-project.json',
        ['services::svc-123'],
        ['diagram-1']
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/implement-context/resolve',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selected_entity_ids: ['services::svc-123'],
            selected_diagram_ids: ['diagram-1'],
          }),
        }
      );

      expect(result).toEqual(mockResponse);
    });

    it('should return null on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'unknown-project.json',
        ['services::svc-123'],
        []
      );

      expect(result).toBeNull();
    });

    it('should return null on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'test-project.json',
        ['services::svc-123'],
        []
      );

      expect(result).toBeNull();
    });

    it('should URL-encode project ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ resolved_entities: [], resolved_diagrams: [] }),
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      await resolveImplementContext(
        'project with spaces.json',
        [],
        []
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('project%20with%20spaces.json'),
        expect.any(Object)
      );
    });
  });
});
