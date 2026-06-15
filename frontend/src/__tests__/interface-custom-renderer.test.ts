/**
 * Tests for Interface Custom Renderer
 *
 * Task Group 3: Interface Custom Renderer Layer
 * Tests for formatEndpointLine(), getEndpointLinesForInterface(),
 * calculateEndpointSectionHeight(), and isInterfaceWithCustomRendering().
 */

import {
  formatEndpointLine,
  getEndpointLinesForInterface,
  calculateEndpointSectionHeight,
  isInterfaceWithCustomRendering,
  ENDPOINT_LINE_HEIGHT,
  ENDPOINT_SECTION_PADDING,
} from '../utils/interfaceCustomRenderer';
import { Endpoint, EndpointType, EndpointDirection, EndpointLifecycleStatus, MetaModel, DiagramNode } from '../types/model';

// Create a minimal metaModel fixture with endpoints
function createMetaModelWithEndpoints(endpoints: Endpoint[]): MetaModel {
  return {
    entities: {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: endpoints,
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

describe('Interface Custom Renderer', () => {
  // Test 3.1: formatEndpointLine formats endpoints correctly
  describe('formatEndpointLine', () => {
    it('should format endpoint line with full information', () => {
      const endpoint: Endpoint = {
        id: 'ep-1',
        name: 'Get customer by id',
        description: 'Retrieves a customer record',
        interface_id: 'if-1',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/customers/{id}',
        operation_verb: 'GET',
        tags: '',
      };

      const result = formatEndpointLine(endpoint, 1);

      // Expected format: "1. GET /customers/{id} - Get customer by id"
      expect(result).toBe('1. GET /customers/{id} - Get customer by id');
    });

    it('should handle missing operation_verb gracefully', () => {
      const endpoint: Endpoint = {
        id: 'ep-2',
        name: 'Customer Message',
        description: 'Consumes customer events',
        interface_id: 'if-1',
        endpoint_type: EndpointType.MESSAGE_TOPIC,
        path_or_address: 'customers.events.v1',
        tags: '',
      };

      const result = formatEndpointLine(endpoint, 2);

      // Should show just the path when no verb
      expect(result).toBe('2. customers.events.v1 - Customer Message');
    });

    it('should handle missing path_or_address gracefully', () => {
      const endpoint: Endpoint = {
        id: 'ep-3',
        name: 'Legacy File Transfer',
        description: 'Old file-based integration',
        interface_id: 'if-1',
        endpoint_type: EndpointType.FILE_TRANSFER,
        path_or_address: '',
        operation_verb: 'PUT',
        tags: '',
      };

      const result = formatEndpointLine(endpoint, 3);

      // Should show just the verb when no path
      expect(result).toBe('3. PUT - Legacy File Transfer');
    });

    it('should handle both missing gracefully', () => {
      const endpoint: Endpoint = {
        id: 'ep-4',
        name: 'Unknown Endpoint',
        description: 'Minimal endpoint',
        interface_id: 'if-1',
        endpoint_type: EndpointType.OTHER,
        path_or_address: '',
        tags: '',
      };

      const result = formatEndpointLine(endpoint, 4);

      // Should show just name when verb and path missing
      expect(result).toBe('4. Unknown Endpoint');
    });

    it('should use index correctly for numbering', () => {
      const endpoint: Endpoint = {
        id: 'ep-5',
        name: 'Order API',
        description: '',
        interface_id: 'if-1',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/orders',
        operation_verb: 'POST',
        tags: '',
      };

      expect(formatEndpointLine(endpoint, 1)).toContain('1.');
      expect(formatEndpointLine(endpoint, 10)).toContain('10.');
    });
  });

  // Test 3.2: getEndpointLinesForInterface retrieves and formats endpoints
  describe('getEndpointLinesForInterface', () => {
    it('should return empty array when no endpoints exist for interface', () => {
      const metaModel = createMetaModelWithEndpoints([]);

      const result = getEndpointLinesForInterface('if-1', metaModel);

      expect(result).toEqual([]);
    });

    it('should return formatted lines for endpoints belonging to interface', () => {
      const endpoints: Endpoint[] = [
        {
          id: 'ep-1',
          name: 'Get All',
          description: '',
          interface_id: 'if-1',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/items',
          operation_verb: 'GET',
          tags: '',
        },
        {
          id: 'ep-2',
          name: 'Create',
          description: '',
          interface_id: 'if-1',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/items',
          operation_verb: 'POST',
          tags: '',
        },
      ];
      const metaModel = createMetaModelWithEndpoints(endpoints);

      const result = getEndpointLinesForInterface('if-1', metaModel);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('1. GET /items - Get All');
      expect(result[1]).toBe('2. POST /items - Create');
    });

    it('should filter out endpoints belonging to other interfaces', () => {
      const endpoints: Endpoint[] = [
        {
          id: 'ep-1',
          name: 'Endpoint 1',
          description: '',
          interface_id: 'if-1',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/api',
          operation_verb: 'GET',
          tags: '',
        },
        {
          id: 'ep-2',
          name: 'Endpoint 2',
          description: '',
          interface_id: 'if-2',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/other',
          operation_verb: 'POST',
          tags: '',
        },
      ];
      const metaModel = createMetaModelWithEndpoints(endpoints);

      const result = getEndpointLinesForInterface('if-1', metaModel);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Endpoint 1');
    });
  });

  // Test 3.3: calculateEndpointSectionHeight calculates height correctly
  describe('calculateEndpointSectionHeight', () => {
    it('should return 0 for empty endpoint list', () => {
      const result = calculateEndpointSectionHeight([]);

      expect(result).toBe(0);
    });

    it('should calculate height based on number of endpoints', () => {
      const endpoints = ['Line 1', 'Line 2', 'Line 3'];

      const result = calculateEndpointSectionHeight(endpoints);

      // height = (lineCount * lineHeight) + (2 * padding)
      const expectedHeight = (3 * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING);
      expect(result).toBe(expectedHeight);
    });

    it('should calculate height for single endpoint', () => {
      const endpoints = ['One line'];

      const result = calculateEndpointSectionHeight(endpoints);

      const expectedHeight = (1 * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING);
      expect(result).toBe(expectedHeight);
    });
  });

  // Test 3.4: isInterfaceWithCustomRendering checks if node should use custom rendering
  describe('isInterfaceWithCustomRendering', () => {
    it('should return true for INTERFACE node with embedded_endpoint_ids', () => {
      const node: DiagramNode = {
        id: 'node-1',
        entity_type: 'INTERFACE',
        entity_id: 'if-1',
        pos_x: 0,
        pos_y: 0,
        width: 200,
        height: 100,
        z_index: 1,
        auto_size: false,
        parent_node_id: null,
        style_override: {},
        embedded_endpoint_ids: ['ep-1', 'ep-2'],
      };

      expect(isInterfaceWithCustomRendering(node)).toBe(true);
    });

    it('should return false for INTERFACE node without embedded_endpoint_ids', () => {
      const node: DiagramNode = {
        id: 'node-1',
        entity_type: 'INTERFACE',
        entity_id: 'if-1',
        pos_x: 0,
        pos_y: 0,
        width: 200,
        height: 100,
        z_index: 1,
        auto_size: false,
        parent_node_id: null,
        style_override: {},
      };

      expect(isInterfaceWithCustomRendering(node)).toBe(false);
    });

    it('should return false for INTERFACE node with empty embedded_endpoint_ids', () => {
      const node: DiagramNode = {
        id: 'node-1',
        entity_type: 'INTERFACE',
        entity_id: 'if-1',
        pos_x: 0,
        pos_y: 0,
        width: 200,
        height: 100,
        z_index: 1,
        auto_size: false,
        parent_node_id: null,
        style_override: {},
        embedded_endpoint_ids: [],
      };

      expect(isInterfaceWithCustomRendering(node)).toBe(false);
    });

    it('should return false for non-INTERFACE entity types', () => {
      const node: DiagramNode = {
        id: 'node-1',
        entity_type: 'SERVICE',
        entity_id: 'svc-1',
        pos_x: 0,
        pos_y: 0,
        width: 200,
        height: 100,
        z_index: 1,
        auto_size: false,
        parent_node_id: null,
        style_override: {},
        embedded_endpoint_ids: ['ep-1'],
      };

      expect(isInterfaceWithCustomRendering(node)).toBe(false);
    });
  });
});
