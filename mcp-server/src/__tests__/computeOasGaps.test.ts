/**
 * Unit tests for computeOasGaps service
 *
 * Tests the gap computation logic for OAS generation, including:
 * - Interface-level gaps (SERVER_URL_MISSING, SECURITY_NOT_SPECIFIED, INFO_VERSION_DEFAULTED)
 * - Endpoint-level gaps (RESPONSES_UNDEFINED, REQUEST_BODY_UNDEFINED, PATH_PARAMS_NEED_SCHEMA)
 * - Missing endpoint data gaps (ENDPOINT_METHOD_MISSING, ENDPOINT_PATH_MISSING)
 * - Default assumptions (DEFAULT_INFO_VERSION, DEFAULT_MEDIA_TYPE, SUGGESTED_SUCCESS_STATUS_BY_VERB)
 * - Type mappings from logical entities
 * - Determinism of computation
 */

import {
  computeOasGaps,
  computeInterfaceGaps,
  computeDefaults,
  computeTypeMappings,
} from '../services/computeOasGaps';
import type {
  InterfaceOasContextDto,
  InterfaceDetailDto,
  InterfaceEndpointDto,
  LogicalEntitySchemaDto,
  LogicalAttributeDto,
} from '../types';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock InterfaceDetailDto
 */
function createMockInterface(overrides?: Partial<InterfaceDetailDto>): InterfaceDetailDto {
  return {
    id: 'interface-123',
    name: 'Test API',
    description: 'Test API description',
    interfaceType: 'REST_API',
    specLink: null,
    tags: null,
    validFrom: null,
    validTo: null,
    ...overrides,
  };
}

/**
 * Creates a mock InterfaceEndpointDto
 */
function createMockEndpoint(overrides?: Partial<InterfaceEndpointDto>): InterfaceEndpointDto {
  return {
    id: 'endpoint-1',
    name: 'Get Resources',
    description: null,
    endpointType: 'HTTP_REST',
    pathOrAddress: '/resources',
    protocol: 'HTTP',
    operationVerb: 'GET',
    direction: 'Inbound',
    lifecycleStatus: 'Active',
    version: null,
    tags: null,
    validFrom: null,
    validTo: null,
    ...overrides,
  };
}

/**
 * Creates a mock LogicalAttributeDto
 */
function createMockAttribute(overrides?: Partial<LogicalAttributeDto>): LogicalAttributeDto {
  return {
    id: 'attr-1',
    name: 'id',
    description: null,
    dataType: 'string_uuid',
    isPrimaryKey: true,
    isNullable: false,
    tags: null,
    ...overrides,
  };
}

/**
 * Creates a mock LogicalEntitySchemaDto
 */
function createMockEntity(overrides?: Partial<LogicalEntitySchemaDto>): LogicalEntitySchemaDto {
  return {
    id: 'entity-1',
    name: 'Resource',
    description: null,
    tags: null,
    validFrom: null,
    validTo: null,
    attributes: [createMockAttribute()],
    ...overrides,
  };
}

/**
 * Creates a mock InterfaceOasContextDto with customizable parts
 */
function createMockContext(overrides?: {
  interfaceOverrides?: Partial<InterfaceDetailDto>;
  endpoints?: InterfaceEndpointDto[];
  logicalEntities?: LogicalEntitySchemaDto[];
}): InterfaceOasContextDto {
  return {
    interface: createMockInterface(overrides?.interfaceOverrides),
    service: null,
    application: null,
    endpoints: overrides?.endpoints ?? [createMockEndpoint()],
    logicalEntities: overrides?.logicalEntities ?? [createMockEntity()],
    notes: null,
  };
}

// ============================================================================
// Test 1: REST_API interface with GET endpoint produces correct gaps
// ============================================================================
describe('computeOasGaps Service', () => {
  describe('Test 1: REST_API interface with GET endpoint', () => {
    it('produces SERVER_URL_MISSING, SECURITY_NOT_SPECIFIED, INFO_VERSION_DEFAULTED, RESPONSES_UNDEFINED gaps', () => {
      const context = createMockContext({
        interfaceOverrides: { interfaceType: 'REST_API' },
        endpoints: [
          createMockEndpoint({
            id: 'ep-1',
            operationVerb: 'GET',
            pathOrAddress: '/resources',
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Check for SERVER_URL_MISSING
      const serverUrlGap = result.gaps.find(g => g.code === 'SERVER_URL_MISSING');
      expect(serverUrlGap).toBeDefined();
      expect(serverUrlGap?.severity).toBe('BLOCKING');
      expect(serverUrlGap?.message).toBe('No server base URL is specified for this API.');

      // Check for SECURITY_NOT_SPECIFIED
      const securityGap = result.gaps.find(g => g.code === 'SECURITY_NOT_SPECIFIED');
      expect(securityGap).toBeDefined();
      expect(securityGap?.severity).toBe('RECOMMENDED');
      expect(securityGap?.message).toBe('No authentication/security scheme is specified.');

      // Check for INFO_VERSION_DEFAULTED
      const versionGap = result.gaps.find(g => g.code === 'INFO_VERSION_DEFAULTED');
      expect(versionGap).toBeDefined();
      expect(versionGap?.severity).toBe('INFO');
      expect(versionGap?.message).toBe('Interface has no explicit version; a default will be used.');

      // Check for RESPONSES_UNDEFINED
      const responsesGap = result.gaps.find(g => g.code === 'RESPONSES_UNDEFINED');
      expect(responsesGap).toBeDefined();
      expect(responsesGap?.severity).toBe('BLOCKING');
      expect(responsesGap?.location?.method).toBe('GET');
      expect(responsesGap?.location?.path).toBe('/resources');
    });
  });

  // ============================================================================
  // Test 2: Defaults include DEFAULT_INFO_VERSION, DEFAULT_MEDIA_TYPE, SUGGESTED_SUCCESS_STATUS_BY_VERB
  // ============================================================================
  describe('Test 2: default assumptions', () => {
    it('includes DEFAULT_INFO_VERSION, DEFAULT_MEDIA_TYPE, and SUGGESTED_SUCCESS_STATUS_BY_VERB', () => {
      const context = createMockContext({
        interfaceOverrides: { interfaceType: 'REST_API' },
      });

      const result = computeOasGaps(context);

      // Check for DEFAULT_INFO_VERSION
      const versionDefault = result.defaults.find(d => d.code === 'DEFAULT_INFO_VERSION');
      expect(versionDefault).toBeDefined();
      expect(versionDefault?.value).toBe('1.0.0');
      expect(versionDefault?.rationale).toBe('OpenAPI requires info.version; interface does not provide one.');

      // Check for DEFAULT_MEDIA_TYPE
      const mediaTypeDefault = result.defaults.find(d => d.code === 'DEFAULT_MEDIA_TYPE');
      expect(mediaTypeDefault).toBeDefined();
      expect(mediaTypeDefault?.value).toBe('application/json');
      expect(mediaTypeDefault?.rationale).toBe('Assume JSON for REST/HTTP endpoints unless specified otherwise.');

      // Check for SUGGESTED_SUCCESS_STATUS_BY_VERB
      const statusDefault = result.defaults.find(d => d.code === 'SUGGESTED_SUCCESS_STATUS_BY_VERB');
      expect(statusDefault).toBeDefined();
      expect(statusDefault?.value).toEqual({
        GET: 200,
        POST: 201,
        PUT: 200,
        PATCH: 200,
        DELETE: 204,
      });
      expect(statusDefault?.rationale).toBe('Common REST conventions; confirm per endpoint.');
    });

    it('does not include DEFAULT_MEDIA_TYPE for non-REST interfaces without HTTP endpoints', () => {
      const context = createMockContext({
        interfaceOverrides: { interfaceType: 'MESSAGING' },
        endpoints: [
          createMockEndpoint({
            endpointType: 'QUEUE',
            protocol: 'AMQP',
          }),
        ],
      });

      const result = computeDefaults(context);

      // Check that DEFAULT_MEDIA_TYPE is NOT included
      const mediaTypeDefault = result.find(d => d.code === 'DEFAULT_MEDIA_TYPE');
      expect(mediaTypeDefault).toBeUndefined();

      // But other defaults should still be present
      expect(result.find(d => d.code === 'DEFAULT_INFO_VERSION')).toBeDefined();
      expect(result.find(d => d.code === 'SUGGESTED_SUCCESS_STATUS_BY_VERB')).toBeDefined();
    });
  });

  // ============================================================================
  // Test 3: POST endpoint produces REQUEST_BODY_UNDEFINED gap
  // ============================================================================
  describe('Test 3: POST endpoint', () => {
    it('produces REQUEST_BODY_UNDEFINED gap', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-post',
            operationVerb: 'POST',
            pathOrAddress: '/resources',
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Check for REQUEST_BODY_UNDEFINED
      const requestBodyGap = result.gaps.find(g => g.code === 'REQUEST_BODY_UNDEFINED');
      expect(requestBodyGap).toBeDefined();
      expect(requestBodyGap?.severity).toBe('BLOCKING');
      expect(requestBodyGap?.message).toBe('Request body schema is not specified for a write operation.');
      expect(requestBodyGap?.location?.method).toBe('POST');
      expect(requestBodyGap?.location?.path).toBe('/resources');
    });

    it('produces REQUEST_BODY_UNDEFINED for PUT endpoint', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-put',
            operationVerb: 'PUT',
            pathOrAddress: '/resources/{id}',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const requestBodyGap = result.gaps.find(g => g.code === 'REQUEST_BODY_UNDEFINED');
      expect(requestBodyGap).toBeDefined();
      expect(requestBodyGap?.location?.method).toBe('PUT');
    });

    it('produces REQUEST_BODY_UNDEFINED for PATCH endpoint', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-patch',
            operationVerb: 'PATCH',
            pathOrAddress: '/resources/{id}',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const requestBodyGap = result.gaps.find(g => g.code === 'REQUEST_BODY_UNDEFINED');
      expect(requestBodyGap).toBeDefined();
      expect(requestBodyGap?.location?.method).toBe('PATCH');
    });

    it('does NOT produce REQUEST_BODY_UNDEFINED for GET or DELETE endpoints', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-get',
            operationVerb: 'GET',
            pathOrAddress: '/resources',
          }),
          createMockEndpoint({
            id: 'ep-delete',
            operationVerb: 'DELETE',
            pathOrAddress: '/resources/{id}',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const requestBodyGaps = result.gaps.filter(g => g.code === 'REQUEST_BODY_UNDEFINED');
      expect(requestBodyGaps).toHaveLength(0);
    });
  });

  // ============================================================================
  // Test 4: Path with {param} produces PATH_PARAMS_NEED_SCHEMA gap with param list
  // ============================================================================
  describe('Test 4: path with {param}', () => {
    it('produces PATH_PARAMS_NEED_SCHEMA gap with extracted param names', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-1',
            operationVerb: 'GET',
            pathOrAddress: '/users/{userId}/orders/{orderId}',
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Check for PATH_PARAMS_NEED_SCHEMA
      const pathParamsGap = result.gaps.find(g => g.code === 'PATH_PARAMS_NEED_SCHEMA');
      expect(pathParamsGap).toBeDefined();
      expect(pathParamsGap?.severity).toBe('RECOMMENDED');
      expect(pathParamsGap?.message).toBe('Path parameters are present but types/formats are not specified.');
      expect(pathParamsGap?.data?.params).toEqual(['userId', 'orderId']);

      // Should have suggested questions for each param
      expect(pathParamsGap?.suggestedQuestions).toContain(
        "What is the type and format of the 'userId' path parameter?"
      );
      expect(pathParamsGap?.suggestedQuestions).toContain(
        "What is the type and format of the 'orderId' path parameter?"
      );
    });

    it('produces PATH_PARAMS_NEED_SCHEMA with single param', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-1',
            operationVerb: 'GET',
            pathOrAddress: '/resources/{id}',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const pathParamsGap = result.gaps.find(g => g.code === 'PATH_PARAMS_NEED_SCHEMA');
      expect(pathParamsGap).toBeDefined();
      expect(pathParamsGap?.data?.params).toEqual(['id']);
    });

    it('does NOT produce PATH_PARAMS_NEED_SCHEMA for paths without params', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-1',
            operationVerb: 'GET',
            pathOrAddress: '/resources',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const pathParamsGap = result.gaps.find(g => g.code === 'PATH_PARAMS_NEED_SCHEMA');
      expect(pathParamsGap).toBeUndefined();
    });
  });

  // ============================================================================
  // Test 5: Endpoint missing operationVerb produces ENDPOINT_METHOD_MISSING gap
  // ============================================================================
  describe('Test 5: endpoint missing operationVerb', () => {
    it('produces ENDPOINT_METHOD_MISSING gap', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-no-verb',
            operationVerb: null,
            pathOrAddress: '/resources',
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Check for ENDPOINT_METHOD_MISSING
      const methodMissingGap = result.gaps.find(g => g.code === 'ENDPOINT_METHOD_MISSING');
      expect(methodMissingGap).toBeDefined();
      expect(methodMissingGap?.severity).toBe('BLOCKING');
      expect(methodMissingGap?.message).toBe('HTTP method is not specified for this endpoint.');
      expect(methodMissingGap?.location?.endpointId).toBe('ep-no-verb');
      expect(methodMissingGap?.location?.path).toBe('/resources');
    });

    it('produces ENDPOINT_METHOD_MISSING for empty string verb', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-empty-verb',
            operationVerb: '   ',
            pathOrAddress: '/resources',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const methodMissingGap = result.gaps.find(g => g.code === 'ENDPOINT_METHOD_MISSING');
      expect(methodMissingGap).toBeDefined();
    });

    it('does NOT produce RESPONSES_UNDEFINED when method is missing', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-no-verb',
            operationVerb: null,
            pathOrAddress: '/resources',
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Should have ENDPOINT_METHOD_MISSING but NOT RESPONSES_UNDEFINED
      expect(result.gaps.find(g => g.code === 'ENDPOINT_METHOD_MISSING')).toBeDefined();
      const responsesGap = result.gaps.find(
        g => g.code === 'RESPONSES_UNDEFINED' && g.location?.endpointId === 'ep-no-verb'
      );
      expect(responsesGap).toBeUndefined();
    });
  });

  // ============================================================================
  // Test 6: Endpoint missing pathOrAddress produces ENDPOINT_PATH_MISSING gap
  // ============================================================================
  describe('Test 6: endpoint missing pathOrAddress', () => {
    it('produces ENDPOINT_PATH_MISSING gap', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-no-path',
            operationVerb: 'GET',
            pathOrAddress: null,
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Check for ENDPOINT_PATH_MISSING
      const pathMissingGap = result.gaps.find(g => g.code === 'ENDPOINT_PATH_MISSING');
      expect(pathMissingGap).toBeDefined();
      expect(pathMissingGap?.severity).toBe('BLOCKING');
      expect(pathMissingGap?.message).toBe('Path/address is not specified for this endpoint.');
      expect(pathMissingGap?.location?.endpointId).toBe('ep-no-path');
      expect(pathMissingGap?.location?.method).toBe('GET');
    });

    it('produces ENDPOINT_PATH_MISSING for empty string path', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-empty-path',
            operationVerb: 'GET',
            pathOrAddress: '   ',
          }),
        ],
      });

      const result = computeOasGaps(context);

      const pathMissingGap = result.gaps.find(g => g.code === 'ENDPOINT_PATH_MISSING');
      expect(pathMissingGap).toBeDefined();
    });

    it('does NOT produce RESPONSES_UNDEFINED when path is missing', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-no-path',
            operationVerb: 'GET',
            pathOrAddress: null,
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Should have ENDPOINT_PATH_MISSING but NOT RESPONSES_UNDEFINED
      expect(result.gaps.find(g => g.code === 'ENDPOINT_PATH_MISSING')).toBeDefined();
      const responsesGap = result.gaps.find(
        g => g.code === 'RESPONSES_UNDEFINED' && g.location?.endpointId === 'ep-no-path'
      );
      expect(responsesGap).toBeUndefined();
    });
  });

  // ============================================================================
  // Test 7: Logical entity attributes are mapped to typeMappings array
  // ============================================================================
  describe('Test 7: logical entity attributes type mapping', () => {
    it('maps logical entity attributes to typeMappings array', () => {
      const context = createMockContext({
        logicalEntities: [
          createMockEntity({
            id: 'entity-1',
            name: 'User',
            attributes: [
              createMockAttribute({ id: 'attr-1', name: 'id', dataType: 'string_uuid' }),
              createMockAttribute({ id: 'attr-2', name: 'email', dataType: 'string' }),
              createMockAttribute({ id: 'attr-3', name: 'age', dataType: 'integer' }),
              createMockAttribute({ id: 'attr-4', name: 'isActive', dataType: 'boolean' }),
            ],
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Should have 4 type mappings
      expect(result.typeMappings).toHaveLength(4);

      // Check string_uuid mapping
      const uuidMapping = result.typeMappings.find(m => m.logicalType === 'string_uuid');
      expect(uuidMapping).toBeDefined();
      expect(uuidMapping?.oasSchema).toEqual({ type: 'string', format: 'uuid' });

      // Check string mapping
      const stringMapping = result.typeMappings.find(m => m.logicalType === 'string');
      expect(stringMapping).toBeDefined();
      expect(stringMapping?.oasSchema).toEqual({ type: 'string' });

      // Check integer mapping
      const intMapping = result.typeMappings.find(m => m.logicalType === 'integer');
      expect(intMapping).toBeDefined();
      expect(intMapping?.oasSchema).toEqual({ type: 'integer' });

      // Check boolean mapping
      const boolMapping = result.typeMappings.find(m => m.logicalType === 'boolean');
      expect(boolMapping).toBeDefined();
      expect(boolMapping?.oasSchema).toEqual({ type: 'boolean' });
    });

    it('emits UNKNOWN_LOGICAL_TYPE_MAPPING gap for unknown types', () => {
      const context = createMockContext({
        logicalEntities: [
          createMockEntity({
            id: 'entity-1',
            name: 'Widget',
            attributes: [
              createMockAttribute({ id: 'attr-1', name: 'custom', dataType: 'custom_type' }),
            ],
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Should have mapping for unknown type (defaults to string)
      const customMapping = result.typeMappings.find(m => m.logicalType === 'custom_type');
      expect(customMapping).toBeDefined();
      expect(customMapping?.oasSchema).toEqual({ type: 'string' });

      // Should have UNKNOWN_LOGICAL_TYPE_MAPPING gap
      const unknownTypeGap = result.gaps.find(g => g.code === 'UNKNOWN_LOGICAL_TYPE_MAPPING');
      expect(unknownTypeGap).toBeDefined();
      expect(unknownTypeGap?.severity).toBe('RECOMMENDED');
      expect(unknownTypeGap?.message).toContain('custom_type');
      expect(unknownTypeGap?.data?.logicalType).toBe('custom_type');
    });

    it('deduplicates types across multiple entities and attributes', () => {
      const context = createMockContext({
        logicalEntities: [
          createMockEntity({
            id: 'entity-1',
            name: 'User',
            attributes: [
              createMockAttribute({ id: 'attr-1', name: 'id', dataType: 'string_uuid' }),
              createMockAttribute({ id: 'attr-2', name: 'name', dataType: 'string' }),
            ],
          }),
          createMockEntity({
            id: 'entity-2',
            name: 'Order',
            attributes: [
              createMockAttribute({ id: 'attr-3', name: 'id', dataType: 'string_uuid' }),
              createMockAttribute({ id: 'attr-4', name: 'total', dataType: 'number_double' }),
            ],
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Should have 3 unique type mappings (string_uuid appears twice but mapped once)
      expect(result.typeMappings).toHaveLength(3);
      expect(result.typeMappings.filter(m => m.logicalType === 'string_uuid')).toHaveLength(1);
    });

    it('handles entities with no attributes', () => {
      const context = createMockContext({
        logicalEntities: [
          createMockEntity({
            id: 'entity-1',
            name: 'EmptyEntity',
            attributes: [],
          }),
        ],
      });

      const result = computeOasGaps(context);

      expect(result.typeMappings).toHaveLength(0);
    });

    it('ignores attributes with null or empty dataType', () => {
      const context = createMockContext({
        logicalEntities: [
          createMockEntity({
            id: 'entity-1',
            name: 'MixedEntity',
            attributes: [
              createMockAttribute({ id: 'attr-1', name: 'valid', dataType: 'string' }),
              createMockAttribute({ id: 'attr-2', name: 'nullType', dataType: null }),
              createMockAttribute({ id: 'attr-3', name: 'emptyType', dataType: '' }),
              createMockAttribute({ id: 'attr-4', name: 'whitespace', dataType: '   ' }),
            ],
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Only the valid 'string' type should be mapped
      expect(result.typeMappings).toHaveLength(1);
      expect(result.typeMappings[0].logicalType).toBe('string');
    });
  });

  // ============================================================================
  // Test 8: Determinism - same input produces exact same output
  // ============================================================================
  describe('Test 8: determinism', () => {
    it('produces exact same output for same input (except generatedAt timestamp)', () => {
      const context = createMockContext({
        interfaceOverrides: { interfaceType: 'REST_API' },
        endpoints: [
          createMockEndpoint({
            id: 'ep-1',
            operationVerb: 'GET',
            pathOrAddress: '/users/{id}',
          }),
          createMockEndpoint({
            id: 'ep-2',
            operationVerb: 'POST',
            pathOrAddress: '/users',
          }),
        ],
        logicalEntities: [
          createMockEntity({
            id: 'entity-1',
            name: 'User',
            attributes: [
              createMockAttribute({ id: 'attr-1', name: 'id', dataType: 'string_uuid' }),
              createMockAttribute({ id: 'attr-2', name: 'name', dataType: 'string' }),
            ],
          }),
        ],
      });

      // Run computation multiple times
      const result1 = computeOasGaps(context);
      const result2 = computeOasGaps(context);
      const result3 = computeOasGaps(context);

      // Compare everything except generatedAt
      const compareWithoutTimestamp = (report: typeof result1) => ({
        interfaceId: report.interfaceId,
        gaps: report.gaps,
        defaults: report.defaults,
        typeMappings: report.typeMappings,
        operationIds: report.operationIds,
      });

      expect(compareWithoutTimestamp(result1)).toEqual(compareWithoutTimestamp(result2));
      expect(compareWithoutTimestamp(result2)).toEqual(compareWithoutTimestamp(result3));

      // Verify gap ordering is consistent
      expect(result1.gaps.map(g => g.code)).toEqual(result2.gaps.map(g => g.code));
      expect(result1.gaps.map(g => g.code)).toEqual(result3.gaps.map(g => g.code));

      // Verify type mapping ordering is consistent (should be sorted alphabetically)
      expect(result1.typeMappings.map(t => t.logicalType)).toEqual(
        result2.typeMappings.map(t => t.logicalType)
      );
    });

    it('type mappings are sorted alphabetically for determinism', () => {
      const context = createMockContext({
        logicalEntities: [
          createMockEntity({
            attributes: [
              createMockAttribute({ dataType: 'string' }),
              createMockAttribute({ dataType: 'boolean' }),
              createMockAttribute({ dataType: 'number' }),
              createMockAttribute({ dataType: 'integer' }),
              createMockAttribute({ dataType: 'array' }),
            ],
          }),
        ],
      });

      const result = computeOasGaps(context);

      const types = result.typeMappings.map(m => m.logicalType);
      const sortedTypes = [...types].sort();

      expect(types).toEqual(sortedTypes);
    });
  });

  // ============================================================================
  // Additional tests for edge cases and integration
  // ============================================================================
  describe('integration and edge cases', () => {
    it('generates operationIds for valid endpoints', () => {
      const context = createMockContext({
        endpoints: [
          createMockEndpoint({
            id: 'ep-1',
            operationVerb: 'GET',
            pathOrAddress: '/users',
          }),
          createMockEndpoint({
            id: 'ep-2',
            operationVerb: 'POST',
            pathOrAddress: '/users',
          }),
        ],
      });

      const result = computeOasGaps(context);

      // Should have 4 operationId suggestions (2 endpoints x 2 styles)
      expect(result.operationIds).toHaveLength(4);

      // Check camelCase suggestions
      const camelCaseIds = result.operationIds.filter(s => s.style === 'camelCase');
      expect(camelCaseIds).toHaveLength(2);
      expect(camelCaseIds.map(s => s.operationId)).toContain('getUsers');
      expect(camelCaseIds.map(s => s.operationId)).toContain('postUsers');

      // Check snake_case suggestions
      const snakeCaseIds = result.operationIds.filter(s => s.style === 'snake_case');
      expect(snakeCaseIds).toHaveLength(2);
      expect(snakeCaseIds.map(s => s.operationId)).toContain('get_users');
      expect(snakeCaseIds.map(s => s.operationId)).toContain('post_users');
    });

    it('handles empty endpoints array', () => {
      const context = createMockContext({
        endpoints: [],
      });

      const result = computeOasGaps(context);

      // Should still have interface-level gaps
      expect(result.gaps.find(g => g.code === 'SERVER_URL_MISSING')).toBeDefined();
      expect(result.gaps.find(g => g.code === 'SECURITY_NOT_SPECIFIED')).toBeDefined();
      expect(result.gaps.find(g => g.code === 'INFO_VERSION_DEFAULTED')).toBeDefined();

      // Should not have endpoint-level gaps
      expect(result.gaps.find(g => g.code === 'RESPONSES_UNDEFINED')).toBeUndefined();
      expect(result.gaps.find(g => g.code === 'REQUEST_BODY_UNDEFINED')).toBeUndefined();

      // Should have no operationIds
      expect(result.operationIds).toHaveLength(0);
    });

    it('handles empty logicalEntities array', () => {
      const context = createMockContext({
        logicalEntities: [],
      });

      const result = computeOasGaps(context);

      expect(result.typeMappings).toHaveLength(0);
      expect(result.gaps.find(g => g.code === 'UNKNOWN_LOGICAL_TYPE_MAPPING')).toBeUndefined();
    });

    it('includes interfaceId in all interface-level gap locations', () => {
      const context = createMockContext({
        interfaceOverrides: { id: 'test-interface-id' },
      });

      const result = computeOasGaps(context);

      // All interface-level gaps should have the interfaceId in location
      const interfaceGaps = result.gaps.filter(g =>
        ['SERVER_URL_MISSING', 'SECURITY_NOT_SPECIFIED', 'INFO_VERSION_DEFAULTED'].includes(g.code)
      );

      for (const gap of interfaceGaps) {
        expect(gap.location?.interfaceId).toBe('test-interface-id');
      }
    });

    it('report interfaceId matches context interface id', () => {
      const context = createMockContext({
        interfaceOverrides: { id: 'my-interface-123' },
      });

      const result = computeOasGaps(context);

      expect(result.interfaceId).toBe('my-interface-123');
    });

    it('generatedAt is a valid ISO timestamp', () => {
      const context = createMockContext();
      const before = new Date().toISOString();
      const result = computeOasGaps(context);
      const after = new Date().toISOString();

      // Verify it's a valid ISO string
      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);

      // Verify it's between before and after
      expect(result.generatedAt >= before).toBe(true);
      expect(result.generatedAt <= after).toBe(true);
    });
  });
});
