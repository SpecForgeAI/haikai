/**
 * Tests for Chat Route Integration with Expand-Resolve - Context Bundles Backend Expansion
 *
 * Tests cover:
 * - tryResolveImplementContext uses expand-resolve when bundle_type present
 * - Falls back to existing resolve when no bundle_type present
 * - Truncation warning is logged when truncated=true in response
 * - Helper function correctly detects bundle selections
 *
 * Spec: 2026-01-16 Context Bundles Backend Expansion - Task Group 9
 */

import {
  EntityBundleSelection,
  DiagramBundleSelection,
  ExpandResolveResponseDto,
  ResolvedImplementContextDto,
  ArchitectureContext,
} from '../types/chat';

// Mock the config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// Mock fetch for client tests
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Mock logger to capture log calls
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();
jest.mock('../services/logger', () => ({
  logger: {
    warn: (...args: any[]) => mockLoggerWarn(...args),
    debug: (...args: any[]) => mockLoggerDebug(...args),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Expand-Resolve Chat Route Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('hasBundleTypeSelections helper', () => {
    it('should return true when entities have bundle_type field', () => {
      const { hasBundleTypeSelections } = require('../services/architectureModelClient');

      const architectureContext: ArchitectureContext = {
        entityIds: ['interfaces::int-1', 'services::svc-1'],
        diagramIds: ['diag-1'],
        entities: [
          { entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_with_endpoints' },
          { entity_type: 'services', entity_id: 'svc-1', bundle_type: 'service_only' },
        ],
      };

      expect(hasBundleTypeSelections(architectureContext)).toBe(true);
    });

    it('should return true when diagrams have bundle_type field', () => {
      const { hasBundleTypeSelections } = require('../services/architectureModelClient');

      const architectureContext: ArchitectureContext = {
        entityIds: [],
        diagramIds: ['diag-1'],
        diagrams: [
          { diagram_id: 'diag-1', bundle_type: 'diagram_only' },
        ],
      };

      expect(hasBundleTypeSelections(architectureContext)).toBe(true);
    });

    it('should return false when no bundle_type is present', () => {
      const { hasBundleTypeSelections } = require('../services/architectureModelClient');

      const architectureContext: ArchitectureContext = {
        entityIds: ['interfaces::int-1'],
        diagramIds: ['diag-1'],
        // No entities or diagrams arrays with bundle_type
      };

      expect(hasBundleTypeSelections(architectureContext)).toBe(false);
    });

    it('should return false for undefined/null architectureContext', () => {
      const { hasBundleTypeSelections } = require('../services/architectureModelClient');

      expect(hasBundleTypeSelections(undefined)).toBe(false);
      expect(hasBundleTypeSelections(null)).toBe(false);
    });

    it('should return false when entities/diagrams arrays are empty', () => {
      const { hasBundleTypeSelections } = require('../services/architectureModelClient');

      const architectureContext: ArchitectureContext = {
        entityIds: ['interfaces::int-1'],
        diagramIds: ['diag-1'],
        entities: [],
        diagrams: [],
      };

      expect(hasBundleTypeSelections(architectureContext)).toBe(false);
    });
  });

  describe('tryResolveImplementContext with expand-resolve', () => {
    it('should use expandResolveContext when bundle_type is present in entities', async () => {
      const mockExpandResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: ['interfaces::int-1', 'endpoints::ep-1'],
        expanded_diagram_ids: [],
        resolved_entities: [
          {
            id: 'int-1',
            name: 'UserAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: { serviceName: 'UserService' },
          },
          {
            id: 'ep-1',
            name: 'GET /users',
            entity_type: 'endpoints',
            category: 'application',
            relevant_fields: { method: 'GET', path: '/users' },
          },
        ],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockExpandResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: ['interfaces::int-1'],
          diagramIds: [],
          entities: [
            { entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_with_endpoints' },
          ],
        },
      };

      const result = await tryResolveImplementContextWithBundles(context, 'test-request-id');

      // Verify expand-resolve endpoint was called
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/implement-context/expand-resolve',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify result is transformed to ResolvedImplementContextDto structure
      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(2);
      expect(result!.resolved_diagrams).toHaveLength(0);
    });

    it('should fall back to existing resolveImplementContext when no bundle_type present', async () => {
      const mockResolveResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'int-1',
            name: 'UserAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolveResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: ['interfaces::int-1'],
          diagramIds: [],
          // No entities array with bundle_type
        },
      };

      const result = await tryResolveImplementContextWithBundles(context, 'test-request-id');

      // Verify standard resolve endpoint was called (not expand-resolve)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/implement-context/resolve',
        expect.objectContaining({
          method: 'POST',
        })
      );

      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(1);
    });

    it('should log truncation warning when truncated=true in expand-resolve response', async () => {
      const mockExpandResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: Array(250).fill(0).map((_, i) => `entities::entity-${i}`),
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: true,
        truncation_reason: 'Exceeded maximum entity limit of 250',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockExpandResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_with_endpoints_and_schemas' },
          ],
        },
      };

      await tryResolveImplementContextWithBundles(context, 'test-request-id');

      // Verify truncation warning was logged
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('truncat'),
        expect.objectContaining({
          truncationReason: 'Exceeded maximum entity limit of 250',
        })
      );
    });
  });

  describe('Response transformation', () => {
    it('should transform ExpandResolveResponseDto to ResolvedImplementContextDto structure', async () => {
      const mockExpandResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: ['interfaces::int-1', 'endpoints::ep-1'],
        expanded_diagram_ids: ['diag-1'],
        resolved_entities: [
          {
            id: 'int-1',
            name: 'UserAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: { serviceName: 'UserService' },
          },
          {
            id: 'ep-1',
            name: 'GET /users',
            entity_type: 'endpoints',
            category: 'application',
            relevant_fields: { method: 'GET', path: '/users' },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diag-1',
            name: 'User Flow',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['int-1'],
          },
        ],
        resolved_relationships: [],
        truncated: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockExpandResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_with_endpoints' },
          ],
          diagrams: [
            { diagram_id: 'diag-1', bundle_type: 'diagram_only' },
          ],
        },
      };

      const result = await tryResolveImplementContextWithBundles(context, 'test-request-id');

      // Verify the result matches ResolvedImplementContextDto structure
      expect(result).toEqual({
        resolved_entities: mockExpandResponse.resolved_entities,
        resolved_diagrams: mockExpandResponse.resolved_diagrams,
      });
    });
  });
});
