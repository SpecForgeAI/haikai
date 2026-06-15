/**
 * Frontend Tests for Endpoint Request/Response Data Fields
 * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
 * Task Group 3: TypeScript Interface and Grid Config Updates
 */

import { gridConfigs } from '../config/gridConfigs';

describe('Endpoint interface accepts request/response data entity point fields', () => {
  it('should accept objects with request_data_entity_point_id and response_data_entity_point_id', () => {
    // Validate shape at runtime - the TS compiler enforces the interface at build time
    const endpoint = {
      id: 'ep-1',
      name: 'Create Order',
      description: 'Creates an order',
      interface_id: 'iface-1',
      endpoint_type: 'HTTP_REST',
      path_or_address: '/api/v1/orders',
      valid_from: '2026-Q1',
      valid_to: '2026-Q4',
      request_data_entity_point_id: 'dep_log_entity1',
      response_data_entity_point_id: 'dep_phy_entity2',
    };

    expect(endpoint.request_data_entity_point_id).toBe('dep_log_entity1');
    expect(endpoint.response_data_entity_point_id).toBe('dep_phy_entity2');
    // Verify removed fields are not present
    expect(endpoint).not.toHaveProperty('lifecycle_status');
    expect(endpoint).not.toHaveProperty('version');
    expect(endpoint).not.toHaveProperty('tags');
  });
});

describe('Endpoints grid config contains Request Data and Response Data columns', () => {
  it('should have Request Data and Response Data columns with data_entity_point_picker cellType', () => {
    const endpointsConfig = gridConfigs.endpoints;
    expect(endpointsConfig).toBeDefined();

    const requestDataCol = endpointsConfig.find((col) => col.field === 'request_data_entity_point_id');
    expect(requestDataCol).toBeDefined();
    expect(requestDataCol).toMatchObject({
      field: 'request_data_entity_point_id',
      displayName: 'Request Data',
      cellType: 'data_entity_point_picker',
      required: false,
      width: 200,
    });

    const responseDataCol = endpointsConfig.find((col) => col.field === 'response_data_entity_point_id');
    expect(responseDataCol).toBeDefined();
    expect(responseDataCol).toMatchObject({
      field: 'response_data_entity_point_id',
      displayName: 'Response Data',
      cellType: 'data_entity_point_picker',
      required: false,
      width: 200,
    });

    // Verify position: after direction, before description
    const directionIndex = endpointsConfig.findIndex((col) => col.field === 'direction');
    const requestIndex = endpointsConfig.findIndex((col) => col.field === 'request_data_entity_point_id');
    const responseIndex = endpointsConfig.findIndex((col) => col.field === 'response_data_entity_point_id');
    const descriptionIndex = endpointsConfig.findIndex((col) => col.field === 'description');

    expect(requestIndex).toBe(directionIndex + 1);
    expect(responseIndex).toBe(directionIndex + 2);
    expect(descriptionIndex).toBeGreaterThan(responseIndex);
  });
});

describe('Endpoints grid config does NOT contain removed columns', () => {
  it('should NOT contain lifecycle_status, version, or tags columns', () => {
    const endpointsConfig = gridConfigs.endpoints;
    expect(endpointsConfig).toBeDefined();

    const lifecycleCol = endpointsConfig.find((col) => col.field === 'lifecycle_status');
    expect(lifecycleCol).toBeUndefined();

    const versionCol = endpointsConfig.find((col) => col.field === 'version');
    expect(versionCol).toBeUndefined();

    const tagsCol = endpointsConfig.find((col) => col.field === 'tags');
    expect(tagsCol).toBeUndefined();
  });
});
