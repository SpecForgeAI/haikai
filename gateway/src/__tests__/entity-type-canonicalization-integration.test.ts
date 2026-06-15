/**
 * Integration tests for Entity Type Canonicalization - End-to-End Flow
 *
 * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
 *
 * Tests verify the full resolution flow:
 * - Gateway receives snake_case entity IDs
 * - Gateway normalizes to camelCase
 * - Model Service resolves entities
 * - Response contains expected fields with canonical entity types
 */

import { ResolvedImplementContextDto, ResolvedEntitySummary } from '../types/chat';
import { ENTITY_TYPE_CANONICAL_MAP, normalizeEntityTypeId } from '../services/architectureModelClient';

// Mock the config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// Mock fetch for integration tests
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Entity Type Canonicalization - Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Full resolution flow with snake_case entity types', () => {
    it('should normalize physical_data_entities and receive resolved entity with name', async () => {
      // Arrange: Mock response from Model Service
      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'pde-123',
            name: 'users_table',
            entity_type: 'physicalDataEntities',
            category: 'data',
            relevant_fields: {
              database: 'main_db',
              physicalType: 'TABLE',
            },
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

      // Act: Call with snake_case entity type
      const result = await resolveImplementContext(
        'test-project.json',
        ['physical_data_entities::pde-123'],
        []
      );

      // Assert: Verify normalized entity ID was sent to Model Service
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('physicalDataEntities::pde-123'),
        })
      );

      // Assert: Verify response contains resolved entity
      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(1);

      const entity = result!.resolved_entities[0];
      expect(entity.id).toBe('pde-123');
      expect(entity.name).toBe('users_table');
      expect(entity.entity_type).toBe('physicalDataEntities');
      expect(entity.category).toBe('data');
      expect(entity.relevant_fields.database).toBe('main_db');
      expect(entity.relevant_fields.physicalType).toBe('TABLE');
    });

    it('should handle mixed batch with snake_case and camelCase types', async () => {
      // Arrange: Mixed input with snake_case and already-canonical types
      const inputEntityIds = [
        'physical_data_entities::pde-111',  // snake_case
        'logical_data_entities::lde-222',   // snake_case
        'app_components::ac-333',           // snake_case
        'services::svc-444',                // already canonical
        'physicalDataEntities::pde-555',    // already canonical
      ];

      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'pde-111',
            name: 'customers_table',
            entity_type: 'physicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
          {
            id: 'lde-222',
            name: 'Order',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
          {
            id: 'ac-333',
            name: 'AuthModule',
            entity_type: 'appComponents',
            category: 'application',
            relevant_fields: {},
          },
          {
            id: 'svc-444',
            name: 'PaymentService',
            entity_type: 'services',
            category: 'application',
            relevant_fields: {},
          },
          {
            id: 'pde-555',
            name: 'orders_table',
            entity_type: 'physicalDataEntities',
            category: 'data',
            relevant_fields: {},
          },
        ],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      // Act
      const result = await resolveImplementContext(
        'test-project.json',
        inputEntityIds,
        []
      );

      // Assert: All entity IDs should be normalized in the request
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.selected_entity_ids).toContain('physicalDataEntities::pde-111');
      expect(requestBody.selected_entity_ids).toContain('logicalDataEntities::lde-222');
      expect(requestBody.selected_entity_ids).toContain('appComponents::ac-333');
      expect(requestBody.selected_entity_ids).toContain('services::svc-444');
      expect(requestBody.selected_entity_ids).toContain('physicalDataEntities::pde-555');

      // Assert: All entities should be resolved
      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(5);

      // Verify each entity was resolved with correct canonical type
      const entityMap = new Map<string, ResolvedEntitySummary>(
        result!.resolved_entities.map((e: ResolvedEntitySummary) => [e.id, e])
      );
      expect(entityMap.get('pde-111')?.entity_type).toBe('physicalDataEntities');
      expect(entityMap.get('lde-222')?.entity_type).toBe('logicalDataEntities');
      expect(entityMap.get('ac-333')?.entity_type).toBe('appComponents');
      expect(entityMap.get('svc-444')?.entity_type).toBe('services');
      expect(entityMap.get('pde-555')?.entity_type).toBe('physicalDataEntities');
    });

    it('should resolve logical_data_entities with correct output format', async () => {
      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'lde-789',
            name: 'Customer',
            entity_type: 'logicalDataEntities',
            category: 'data',
            relevant_fields: {
              tags: 'core,domain',
            },
          },
        ],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'test-project.json',
        ['logical_data_entities::lde-789'],
        []
      );

      // Verify request was normalized
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      expect(requestBody.selected_entity_ids[0]).toBe('logicalDataEntities::lde-789');

      // Verify response format
      expect(result).not.toBeNull();
      const entity = result!.resolved_entities[0];
      expect(entity.id).toBe('lde-789');
      expect(entity.name).toBe('Customer');
      expect(entity.entity_type).toBe('logicalDataEntities');
      expect(entity.category).toBe('data');
    });

    it('should handle app_components normalization correctly', async () => {
      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'ac-456',
            name: 'NotificationService',
            entity_type: 'appComponents',
            category: 'application',
            relevant_fields: {
              applicationId: 'app-1',
            },
          },
        ],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'test-project.json',
        ['app_components::ac-456'],
        []
      );

      // Verify normalization
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      expect(requestBody.selected_entity_ids[0]).toBe('appComponents::ac-456');

      // Verify response
      expect(result).not.toBeNull();
      expect(result!.resolved_entities[0].name).toBe('NotificationService');
      expect(result!.resolved_entities[0].entity_type).toBe('appComponents');
    });
  });

  describe('Resolved output format verification', () => {
    it('should contain expected fields for physical data entities', async () => {
      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [
          {
            id: 'pde-output-test',
            name: 'orders_table',
            entity_type: 'physicalDataEntities',
            category: 'data',
            relevant_fields: {
              database: 'orders_db',
              physicalType: 'TABLE',
            },
          },
        ],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'test-project.json',
        ['physical_data_entities::pde-output-test'],
        []
      );

      expect(result).not.toBeNull();
      const entity = result!.resolved_entities[0];

      // Verify all expected fields per spec
      expect(entity).toHaveProperty('id');
      expect(entity).toHaveProperty('name');
      expect(entity).toHaveProperty('entity_type');
      expect(entity).toHaveProperty('category');
      expect(entity).toHaveProperty('relevant_fields');

      // Verify specific values
      expect(entity.id).toBe('pde-output-test');
      expect(entity.name).toBe('orders_table'); // Human-readable name, not ID
      expect(entity.entity_type).toBe('physicalDataEntities'); // Canonical camelCase
      expect(entity.category).toBe('data');
      expect(entity.relevant_fields.database).toBe('orders_db');
      expect(entity.relevant_fields.physicalType).toBe('TABLE');
    });

    it('should return empty resolved_entities when service returns no matches', async () => {
      const mockResponse: ResolvedImplementContextDto = {
        resolved_entities: [],
        resolved_diagrams: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { resolveImplementContext } = require('../services/architectureModelClient');

      const result = await resolveImplementContext(
        'test-project.json',
        ['physical_data_entities::non-existent-id'],
        []
      );

      expect(result).not.toBeNull();
      expect(result!.resolved_entities).toHaveLength(0);
    });
  });

  describe('Normalization consistency verification', () => {
    it('should normalize all known snake_case types consistently', () => {
      // Verify the normalization function produces expected output for all known types
      const testCases = [
        { input: 'physical_data_entities::pde-1', expected: 'physicalDataEntities::pde-1' },
        { input: 'logical_data_entities::lde-1', expected: 'logicalDataEntities::lde-1' },
        { input: 'app_components::ac-1', expected: 'appComponents::ac-1' },
        { input: 'business_processes::bp-1', expected: 'businessProcesses::bp-1' },
        { input: 'business_points::bpt-1', expected: 'businessPoints::bpt-1' },
        { input: 'process_activities::pa-1', expected: 'businessPoints::pa-1' }, // Special mapping
        { input: 'ui_screens::ui-1', expected: 'uiScreens::ui-1' },
      ];

      for (const { input, expected } of testCases) {
        const result = normalizeEntityTypeId(input);
        expect(result).toBe(expected);
      }
    });

    it('should leave already-canonical types unchanged', () => {
      const canonicalTypes = [
        'services::svc-1',
        'classes::cls-1',
        'methods::mth-1',
        'interfaces::iface-1',
        'applications::app-1',
        'endpoints::ep-1',
        'physicalDataEntities::pde-1',
        'logicalDataEntities::lde-1',
        'appComponents::ac-1',
        'businessProcesses::bp-1',
        'businessPoints::bpt-1',
        'uiScreens::ui-1',
      ];

      for (const id of canonicalTypes) {
        const result = normalizeEntityTypeId(id);
        expect(result).toBe(id);
      }
    });
  });
});
