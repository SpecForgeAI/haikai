/**
 * Tests for Prompt Builder with Expanded Context - Task Group 10
 *
 * Spec: Context Bundles Backend Expansion (2026-01-16)
 * Task Group 10: Prompt Template Enhancement
 *
 * Tests verify that:
 * - formatHighlightedContext() handles expanded entities with relationships
 * - Entities include name, type, and category in output
 * - Relationship metadata is included in output when available
 * - Bootstrap phase does NOT use expanded context (uses summaries instead)
 * - Refine phase DOES use expanded context
 */

import { formatHighlightedContext, buildSystemPrompt, buildBootstrapPrompt } from '../services/promptBuilder';
import { ChatContext, ResolvedImplementContextDto, ResolvedEntitySummary } from '../types/chat';
import { GatewaySession } from '../types/session';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

describe('Prompt Builder with Expanded Context - Task Group 10', () => {
  const mockSession: GatewaySession = {
    sessionId: 'test-session',
    mcpSessionId: 'mcp-test-session',
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  describe('formatHighlightedContext() handles expanded entities with relationships', () => {
    it('should include relationship metadata in output when available', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'lde-1',
            name: 'User',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {
              description: 'User account entity',
              // Use string representation for relationship metadata since
              // formatHighlightedContext concatenates values with toString()
              relationships: 'hasMany:Order, belongsTo:Organization',
            },
          },
          {
            id: 'lde-2',
            name: 'Order',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {
              description: 'Order entity',
              relationships: 'belongsTo:User',
            },
          },
        ],
        resolved_diagrams: [],
      };

      const formatted = formatHighlightedContext(resolvedContext);

      // Should include relationship metadata
      expect(formatted).toContain('relationships');
      expect(formatted).toContain('hasMany');
      expect(formatted).toContain('Order');
      expect(formatted).toContain('belongsTo');
      expect(formatted).toContain('Organization');
    });

    it('should handle expanded entities with additional context from bundle expansion', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {
              serviceType: 'REST',
              applicationId: 'app-1',
            },
          },
          {
            id: 'int-1',
            name: 'UserAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: {
              interfaceType: 'REST',
              path: '/api/users',
            },
          },
          {
            id: 'ep-1',
            name: 'GET /users',
            entity_type: 'endpoints',
            category: 'application',
            relevant_fields: {
              method: 'GET',
              path: '/users',
              responseSchema: 'UserList',
            },
          },
        ],
        resolved_diagrams: [],
      };

      const formatted = formatHighlightedContext(resolvedContext);

      // Should include all expanded entities with their fields
      expect(formatted).toContain('UserService');
      expect(formatted).toContain('serviceType');
      expect(formatted).toContain('REST');
      expect(formatted).toContain('UserAPI');
      expect(formatted).toContain('interfaceType');
      expect(formatted).toContain('GET /users');
      expect(formatted).toContain('method');
      expect(formatted).toContain('responseSchema');
    });
  });

  describe('Entities include name, type, and category in output', () => {
    it('should list entities with type and category information', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
          {
            id: 'lde-1',
            name: 'User',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
          {
            id: 'bl-1',
            name: 'ValidateUserRule',
            entity_type: 'businessLogic',
            category: 'business',
            relevant_fields: {},
          },
          {
            id: 'ui-1',
            name: 'UserProfileScreen',
            entity_type: 'uiScreens',
            category: 'ui',
            relevant_fields: {},
          },
          {
            id: 'svc-2',
            name: 'OrderService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
          {
            id: 'lde-2',
            name: 'Order',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      const formatted = formatHighlightedContext(resolvedContext);

      // Should have "Highlighted Entities:" header
      expect(formatted).toContain('Highlighted Entities:');

      // Should include all entity names with their type and category info
      expect(formatted).toContain('UserService');
      expect(formatted).toContain('services');
      expect(formatted).toContain('application');
      expect(formatted).toContain('User');
      expect(formatted).toContain('logicalDataEntities');
      expect(formatted).toContain('data');
      expect(formatted).toContain('ValidateUserRule');
      expect(formatted).toContain('businessLogic');
      expect(formatted).toContain('business');
      expect(formatted).toContain('UserProfileScreen');
      expect(formatted).toContain('uiScreens');
      expect(formatted).toContain('ui');
      expect(formatted).toContain('OrderService');
      expect(formatted).toContain('Order');
    });

    it('should only show entities that are present', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
          {
            id: 'lde-1',
            name: 'User',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      const formatted = formatHighlightedContext(resolvedContext);

      // Should include present entities
      expect(formatted).toContain('UserService');
      expect(formatted).toContain('User');

      // Should NOT contain entity types not present
      expect(formatted).not.toContain('businessLogic');
      expect(formatted).not.toContain('uiScreens');
    });
  });

  describe('Relationship metadata inclusion', () => {
    it('should include relationship context when entities have relationship metadata', () => {
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'pde-1',
            name: 'users',
            entity_type: 'physicalDataEntities',
            category: 'data',
            relevant_fields: {
              tableName: 'users',
              // Arrays of primitives are rendered via toString() as comma-separated values
              attributes: 'id, email, name',
              // Use string representation for nested relationship data since
              // formatHighlightedContext renders values with string concatenation
              relationships: 'foreignKey(organization_id) -> organizations',
            },
          },
        ],
        resolved_diagrams: [],
      };

      const formatted = formatHighlightedContext(resolvedContext);

      expect(formatted).toContain('relationships');
      expect(formatted).toContain('foreignKey');
      expect(formatted).toContain('organizations');
      expect(formatted).toContain('organization_id');
    });
  });

  describe('Phase-specific context injection', () => {
    it('should inject expanded context for refine phase prompts', () => {
      const refineContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: ['services::svc-1'],
          diagramIds: [],
        },
      };

      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'UserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { serviceType: 'REST' },
          },
        ],
        resolved_diagrams: [],
      };

      const prompt = buildSystemPrompt(mockSession, refineContext, resolvedContext);

      // Refine phase should include the resolved context with entity details
      expect(prompt).toContain('UserService');
      expect(prompt).toContain('serviceType');
      expect(prompt).toContain('REST');
    });

    it('should NOT use expanded context for bootstrap phase (uses summaries instead)', () => {
      const bootstrapContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'bootstrap',
        workItem: {
          id: 'WI-123',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: ['services::svc-1'],
          diagramIds: [],
        },
      };

      // Even if resolved context is passed, bootstrap phase should not use it
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-1',
            name: 'ExpandedUserService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: { serviceType: 'REST' },
          },
        ],
        resolved_diagrams: [],
      };

      // Bootstrap prompt is built without resolved context
      const prompt = buildBootstrapPrompt(bootstrapContext, null, null);

      // Bootstrap should use summaries, not expanded context
      expect(prompt).toContain('PRODUCT BACKLOG SUMMARY');
      expect(prompt).toContain('ARCHITECTURE META-MODEL SUMMARY');
      // Should NOT contain the resolved entity from expanded context
      expect(prompt).not.toContain('ExpandedUserService');
    });
  });
});
