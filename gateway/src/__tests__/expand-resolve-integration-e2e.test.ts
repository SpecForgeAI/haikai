/**
 * End-to-End and Integration Tests for Context Bundles Backend Expansion
 *
 * These tests verify critical integration points and end-to-end workflows that
 * were identified as gaps during the test review and analysis phase.
 *
 * Coverage:
 * 1. End-to-end: entity selection with bundle_type flows through expand-resolve
 * 2. End-to-end: expanded context appears in LLM prompt via formatHighlightedContext
 * 3. Integration: truncation at configured limits
 * 4. Integration: graceful degradation when expansion service unavailable
 *
 * Spec: 2026-01-16 Context Bundles Backend Expansion - Task Group 11
 */

import {
  EntityBundleSelection,
  DiagramBundleSelection,
  ExpandResolveResponseDto,
  ResolvedImplementContextDto,
  ChatContext,
  ArchitectureContext,
} from '../types/chat';
import { formatHighlightedContext } from '../services/promptBuilder';

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
const mockLoggerInfo = jest.fn();
jest.mock('../services/logger', () => ({
  logger: {
    warn: (...args: any[]) => mockLoggerWarn(...args),
    debug: (...args: any[]) => mockLoggerDebug(...args),
    info: (...args: any[]) => mockLoggerInfo(...args),
    error: jest.fn(),
  },
}));

describe('Context Bundles Backend Expansion - E2E and Integration Tests (Task Group 11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // E2E Test 1: Entity selection with bundle_type flows through expand-resolve
  // ===========================================================================
  describe('E2E: Entity selection with bundle_type flows through expand-resolve', () => {
    it('should route request through expand-resolve when bundle_type is present in entities', async () => {
      // Arrange: Full mock response simulating backend expansion
      const mockExpandResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: [
          'interfaces::iface-001',
          'endpoints::ep-001',
          'endpoints::ep-002',
          'logicalDataEntities::user-entity',
        ],
        expanded_diagram_ids: [],
        resolved_entities: [
          {
            id: 'iface-001',
            name: 'UserAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: { serviceName: 'UserService', path: '/api/users' },
          },
          {
            id: 'ep-001',
            name: 'GET /users',
            entity_type: 'endpoints',
            category: 'application',
            relevant_fields: { method: 'GET', path: '/users' },
          },
          {
            id: 'ep-002',
            name: 'POST /users',
            entity_type: 'endpoints',
            category: 'application',
            relevant_fields: { method: 'POST', path: '/users' },
          },
          {
            id: 'user-entity',
            name: 'User',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: { description: 'User account entity' },
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

      // Context with bundle_type selections
      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'interfaces', entity_id: 'iface-001', bundle_type: 'interface_with_endpoints_and_schemas' },
          ],
        },
      };

      // Act
      const result = await tryResolveImplementContextWithBundles(context, 'e2e-test-request-001');

      // Assert: Verify expand-resolve endpoint was called
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/implement-context/expand-resolve',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Assert: Verify the response is properly transformed
      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(4);
      expect(result!.resolved_entities.map((e: any) => e.name)).toContain('UserAPI');
      expect(result!.resolved_entities.map((e: any) => e.name)).toContain('GET /users');
      expect(result!.resolved_entities.map((e: any) => e.name)).toContain('User');
    });

    it('should NOT call expand-resolve when no bundle_type is present', async () => {
      // Arrange: Standard resolve response
      const mockResolveResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'iface-001',
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

      // Context WITHOUT bundle_type selections (legacy format)
      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: ['interfaces::iface-001'],
          diagramIds: [],
          // No entities array with bundle_type
        },
      };

      // Act
      await tryResolveImplementContextWithBundles(context, 'e2e-test-request-002');

      // Assert: Verify standard resolve endpoint was called (not expand-resolve)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/implement-context/resolve',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  // ===========================================================================
  // E2E Test 2: Expanded context appears in LLM prompt
  // ===========================================================================
  describe('E2E: Expanded context appears in LLM prompt via formatHighlightedContext', () => {
    it('should format expanded entities with category grouping and relationship metadata', () => {
      // Arrange: Resolved context with expanded entities from bundle expansion
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'svc-001',
            name: 'OrderService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {
              serviceType: 'REST',
              applicationId: 'app-001',
            },
          },
          {
            id: 'int-001',
            name: 'OrderAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: {
              interfaceType: 'REST',
              path: '/api/orders',
            },
          },
          {
            id: 'lde-001',
            name: 'Order',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {
              description: 'Order entity',
              relationships: [
                { type: 'hasMany', target: 'OrderLine' },
                { type: 'belongsTo', target: 'Customer' },
              ],
            },
          },
          {
            id: 'lde-002',
            name: 'OrderLine',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {
              description: 'Line item in an order',
            },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diag-001',
            name: 'Order Flow',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['svc-001', 'int-001'],
            referenced_entity_names: ['OrderService', 'OrderAPI'],
          },
        ],
      };

      // Act
      const formatted = formatHighlightedContext(resolvedContext);

      // Assert: Verify entities section header
      expect(formatted).toContain('Highlighted Entities:');

      // Assert: Verify entities are included with category info
      expect(formatted).toContain('OrderService');
      expect(formatted).toContain('services, application');
      expect(formatted).toContain('OrderAPI');
      expect(formatted).toContain('interfaces, application');
      expect(formatted).toContain('Order (');
      expect(formatted).toContain('logicalDataEntities, data');
      expect(formatted).toContain('OrderLine');

      // Assert: Verify relationship metadata field is present
      expect(formatted).toContain('relationships');

      // Assert: Verify diagram is included with entity names
      expect(formatted).toContain('Highlighted Diagrams:');
      expect(formatted).toContain('Order Flow');
      expect(formatted).toContain('References: OrderService, OrderAPI');

      // Assert: Entities appear before diagrams
      const entitiesIndex = formatted.indexOf('Highlighted Entities');
      const diagramsIndex = formatted.indexOf('Highlighted Diagrams');
      expect(entitiesIndex).toBeLessThan(diagramsIndex);
    });

    it('should handle empty resolved context gracefully', () => {
      // Act
      const formatted = formatHighlightedContext(null);

      // Assert
      expect(formatted).toBe('No items highlighted by user.');
    });
  });

  // ===========================================================================
  // Integration Test 3: Truncation at configured limits
  // ===========================================================================
  describe('Integration: Truncation at configured limits', () => {
    it('should log truncation warning when response indicates truncation', async () => {
      // Arrange: Response with truncation flag
      const mockTruncatedResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: Array(250).fill(0).map((_, i) => `entities::entity-${i}`),
        expanded_diagram_ids: ['diag-001'],
        resolved_entities: [],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: true,
        truncation_reason: 'Exceeded maximum entity limit of 250 (original count: 350)',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTruncatedResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'services', entity_id: 'svc-001', bundle_type: 'service_with_parents_and_children' },
          ],
        },
      };

      // Act
      const result = await tryResolveImplementContextWithBundles(context, 'truncation-test-request');

      // Assert: Verify result is still returned (graceful degradation)
      expect(result).not.toBeNull();

      // Assert: Verify truncation warning was logged
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('truncat'),
        expect.objectContaining({
          truncationReason: expect.stringContaining('Exceeded maximum entity limit'),
        })
      );
    });

    it('should not log truncation warning when response is not truncated', async () => {
      // Arrange: Response without truncation
      const mockNonTruncatedResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: ['services::svc-001', 'interfaces::int-001'],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockNonTruncatedResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'services', entity_id: 'svc-001', bundle_type: 'service_only' },
          ],
        },
      };

      // Act
      await tryResolveImplementContextWithBundles(context, 'no-truncation-test');

      // Assert: Verify truncation warning was NOT logged
      const truncationWarnings = mockLoggerWarn.mock.calls.filter(
        (call: any[]) => call[0] && call[0].includes('truncat')
      );
      expect(truncationWarnings).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Integration Test 4: Graceful degradation when expansion service unavailable
  // ===========================================================================
  describe('Integration: Graceful degradation when expansion service unavailable', () => {
    it('should return null when expand-resolve endpoint returns non-OK status', async () => {
      // Arrange: Service returns 503 Service Unavailable
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'interfaces', entity_id: 'int-001', bundle_type: 'interface_with_endpoints' },
          ],
        },
      };

      // Act
      const result = await tryResolveImplementContextWithBundles(context, 'service-unavailable-test');

      // Assert: Should return null gracefully
      expect(result).toBeNull();

      // Assert: Should log warning
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-OK response'),
        expect.objectContaining({
          status: 503,
        })
      );
    });

    it('should return null when expand-resolve endpoint throws network error', async () => {
      // Arrange: Network error
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED: Connection refused'));

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'services', entity_id: 'svc-001', bundle_type: 'service_with_parents_and_children' },
          ],
        },
      };

      // Act
      const result = await tryResolveImplementContextWithBundles(context, 'network-error-test');

      // Assert: Should return null gracefully
      expect(result).toBeNull();

      // Assert: Should log warning about the failure
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed'),
        expect.objectContaining({
          error: expect.stringContaining('ECONNREFUSED'),
        })
      );
    });

    it('should handle malformed JSON response gracefully', async () => {
      // Arrange: Invalid JSON response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
      });

      const { expandResolveContext } = require('../services/architectureModelClient');

      // Act
      const result = await expandResolveContext(
        'test-project.json',
        [{ entity_type: 'interfaces', entity_id: 'int-001', bundle_type: 'interface_only' }],
        []
      );

      // Assert: Should return null gracefully
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Additional strategic test: Mixed entity types and diagrams flow
  // ===========================================================================
  describe('Integration: Mixed entity types and diagrams flow through expand-resolve', () => {
    it('should handle mixed selection of entities and diagrams with different bundle types', async () => {
      // Arrange: Full mixed selection
      const mockMixedResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: [
          'interfaces::int-001',
          'endpoints::ep-001',
          'services::svc-001',
          'applications::app-001',
          'logicalDataEntities::lde-001',
          'physicalDataEntities::pde-001',
        ],
        expanded_diagram_ids: ['diag-001', 'diag-002'],
        resolved_entities: [
          { id: 'int-001', name: 'PaymentAPI', entity_type: 'interfaces', category: 'application', relevant_fields: {} },
          { id: 'ep-001', name: 'POST /payments', entity_type: 'endpoints', category: 'application', relevant_fields: {} },
          { id: 'svc-001', name: 'PaymentService', entity_type: 'services', category: 'application', relevant_fields: {} },
          { id: 'app-001', name: 'PaymentApp', entity_type: 'applications', category: 'application', relevant_fields: {} },
          { id: 'lde-001', name: 'Payment', entity_type: 'logicalDataEntities', category: 'data', relevant_fields: {} },
          { id: 'pde-001', name: 'payments', entity_type: 'physicalDataEntities', category: 'data', relevant_fields: {} },
        ],
        resolved_diagrams: [
          { id: 'diag-001', name: 'Payment Flow', diagram_type: 'Sequence', referenced_entity_ids: ['svc-001'] },
          { id: 'diag-002', name: 'Payment ERD', diagram_type: 'ER', referenced_entity_ids: ['lde-001', 'pde-001'] },
        ],
        resolved_relationships: [],
        truncated: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMixedResponse,
      });

      const { tryResolveImplementContextWithBundles } = require('../services/architectureModelClient');

      const context: ChatContext = {
        mode: 'implement_feature',
        filename: 'test-project.json',
        architectureContext: {
          entityIds: [],
          diagramIds: [],
          entities: [
            { entity_type: 'interfaces', entity_id: 'int-001', bundle_type: 'interface_with_endpoints' },
            { entity_type: 'services', entity_id: 'svc-001', bundle_type: 'service_with_parents_and_children' },
            { entity_type: 'logicalDataEntities', entity_id: 'lde-001', bundle_type: 'entity_with_attributes_and_relationships' },
          ],
          diagrams: [
            { diagram_id: 'diag-001', bundle_type: 'diagram_only' },
            { diagram_id: 'diag-002', bundle_type: 'diagram_only' },
          ],
        },
      };

      // Act
      const result = await tryResolveImplementContextWithBundles(context, 'mixed-selection-test');

      // Assert: Verify request body was constructed correctly
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.selected_entities).toHaveLength(3);
      expect(requestBody.selected_diagrams).toHaveLength(2);

      // Assert: Verify response transformation
      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(6);
      expect(result!.resolved_diagrams).toHaveLength(2);

      // Assert: Verify formatting includes entities with categories
      const formatted = formatHighlightedContext(result);
      expect(formatted).toContain('Highlighted Entities:');
      expect(formatted).toContain('PaymentAPI');
      expect(formatted).toContain('application');
      expect(formatted).toContain('PaymentService');
      expect(formatted).toContain('data');
      expect(formatted).toContain('Payment (');
      expect(formatted).toContain('Highlighted Diagrams:');
      expect(formatted).toContain('Payment Flow');
      expect(formatted).toContain('Payment ERD');
    });
  });
});
