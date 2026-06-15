/**
 * Tests for Expand-Resolve Gateway Client - Context Bundles Backend Expansion
 *
 * Tests cover:
 * - expandResolveContext() makes correct POST request
 * - Request body includes selected_entities and selected_diagrams with bundle_type
 * - Response parsing handles truncated flag
 * - Graceful error handling returns null on failure
 *
 * Spec: 2026-01-16 Context Bundles Backend Expansion - Task Group 8
 */

import {
  EntityBundleSelection,
  DiagramBundleSelection,
  ExpandResolveResponseDto,
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

describe('Expand-Resolve Gateway Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('expandResolveContext', () => {
    it('should make correct POST request to expand-resolve endpoint', async () => {
      const mockResponse: ExpandResolveResponseDto = {
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
        json: async () => mockResponse,
      });

      const { expandResolveContext } = require('../services/architectureModelClient');

      const selectedEntities: EntityBundleSelection[] = [
        { entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_with_endpoints' },
      ];
      const selectedDiagrams: DiagramBundleSelection[] = [
        { diagram_id: 'diag-1', bundle_type: 'diagram_only' },
      ];

      const result = await expandResolveContext('test-project.json', selectedEntities, selectedDiagrams);

      // Verify the endpoint URL
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/projects/test-project.json/implement-context/expand-resolve',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(result).toEqual(mockResponse);
    });

    it('should include selected_entities and selected_diagrams with bundle_type in request body', async () => {
      const mockResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: ['services::svc-1', 'applications::app-1'],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { expandResolveContext } = require('../services/architectureModelClient');

      const selectedEntities: EntityBundleSelection[] = [
        { entity_type: 'services', entity_id: 'svc-1', bundle_type: 'service_with_parents_and_children' },
        { entity_type: 'logicalDataEntities', entity_id: 'lde-1', bundle_type: 'entity_with_attributes_and_relationships' },
      ];
      const selectedDiagrams: DiagramBundleSelection[] = [
        { diagram_id: 'diag-2', bundle_type: 'diagram_only' },
      ];

      await expandResolveContext('test-project.json', selectedEntities, selectedDiagrams);

      // Verify the request body structure
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody).toEqual({
        selected_entities: [
          { entity_type: 'services', entity_id: 'svc-1', bundle_type: 'service_with_parents_and_children' },
          { entity_type: 'logicalDataEntities', entity_id: 'lde-1', bundle_type: 'entity_with_attributes_and_relationships' },
        ],
        selected_diagrams: [
          { diagram_id: 'diag-2', bundle_type: 'diagram_only' },
        ],
      });
    });

    it('should correctly parse response with truncated flag set to true', async () => {
      const mockResponse: ExpandResolveResponseDto = {
        expanded_entity_ids: Array(250).fill(0).map((_, i) => `entities::entity-${i}`),
        expanded_diagram_ids: ['diag-1'],
        resolved_entities: [],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: true,
        truncation_reason: 'Exceeded maximum entity limit of 250',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { expandResolveContext } = require('../services/architectureModelClient');

      const result = await expandResolveContext(
        'test-project.json',
        [{ entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_with_endpoints_and_schemas' }],
        []
      );

      expect(result).not.toBeNull();
      expect(result!.truncated).toBe(true);
      expect(result!.truncation_reason).toBe('Exceeded maximum entity limit of 250');
      expect(result!.expanded_entity_ids).toHaveLength(250);
    });

    it('should return null on non-OK response (graceful error handling)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { expandResolveContext } = require('../services/architectureModelClient');

      const result = await expandResolveContext(
        'unknown-project.json',
        [{ entity_type: 'services', entity_id: 'svc-1', bundle_type: 'service_only' }],
        []
      );

      expect(result).toBeNull();
    });

    it('should return null on fetch error (network failure)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { expandResolveContext } = require('../services/architectureModelClient');

      const result = await expandResolveContext(
        'test-project.json',
        [{ entity_type: 'interfaces', entity_id: 'int-1', bundle_type: 'interface_only' }],
        [{ diagram_id: 'diag-1', bundle_type: 'diagram_only' }]
      );

      expect(result).toBeNull();
    });
  });

  describe('EntityBundleSelection type structure', () => {
    it('should accept valid EntityBundleSelection with all fields', () => {
      const selection: EntityBundleSelection = {
        entity_type: 'interfaces',
        entity_id: 'int-123',
        bundle_type: 'interface_with_endpoints_and_schemas',
      };

      expect(selection.entity_type).toBe('interfaces');
      expect(selection.entity_id).toBe('int-123');
      expect(selection.bundle_type).toBe('interface_with_endpoints_and_schemas');
    });
  });

  describe('DiagramBundleSelection type structure', () => {
    it('should accept valid DiagramBundleSelection with all fields', () => {
      const selection: DiagramBundleSelection = {
        diagram_id: 'diag-456',
        bundle_type: 'diagram_only',
      };

      expect(selection.diagram_id).toBe('diag-456');
      expect(selection.bundle_type).toBe('diagram_only');
    });
  });

  describe('ExpandResolveResponseDto type structure', () => {
    it('should accept valid ExpandResolveResponseDto with all fields including truncation', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: ['interfaces::int-1', 'endpoints::ep-1', 'endpoints::ep-2'],
        expanded_diagram_ids: ['diag-1'],
        resolved_entities: [
          {
            id: 'int-1',
            name: 'OrderAPI',
            entity_type: 'interfaces',
            category: 'application',
            relevant_fields: { serviceName: 'OrderService', specLink: '/specs/order.yaml' },
          },
        ],
        resolved_diagrams: [
          {
            id: 'diag-1',
            name: 'Order Processing',
            diagram_type: 'Sequence',
            referenced_entity_ids: ['int-1', 'svc-1'],
            referenced_entity_names: ['OrderAPI', 'OrderService'],
          },
        ],
        resolved_relationships: [],
        truncated: false,
      };

      expect(response.expanded_entity_ids).toHaveLength(3);
      expect(response.expanded_diagram_ids).toHaveLength(1);
      expect(response.resolved_entities).toHaveLength(1);
      expect(response.resolved_diagrams).toHaveLength(1);
      expect(response.truncated).toBe(false);
      expect(response.truncation_reason).toBeUndefined();
    });

    it('should accept ExpandResolveResponseDto with truncation_reason when truncated', () => {
      const response: ExpandResolveResponseDto = {
        expanded_entity_ids: [],
        expanded_diagram_ids: [],
        resolved_entities: [],
        resolved_diagrams: [],
        resolved_relationships: [],
        truncated: true,
        truncation_reason: 'Exceeded maximum diagram limit of 50',
      };

      expect(response.truncated).toBe(true);
      expect(response.truncation_reason).toBe('Exceeded maximum diagram limit of 50');
    });
  });
});
