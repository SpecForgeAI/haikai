/**
 * Tests for oasGaps type definitions
 * These tests verify the structure and constraints of the GapReport-related types
 */

import type {
  GapSeverity,
  GapLocation,
  GapItem,
  DefaultAssumption,
  TypeMapping,
  OperationIdSuggestion,
  GapReport,
  ComputeOasGapsRequest,
} from '../types';

describe('OAS Gaps Type Definitions', () => {
  // ============================================================================
  // Test 1: GapSeverity type values
  // ============================================================================
  describe('GapSeverity type', () => {
    it('accepts valid severity values: BLOCKING, RECOMMENDED, INFO', () => {
      // These assignments should compile without errors
      const blocking: GapSeverity = 'BLOCKING';
      const recommended: GapSeverity = 'RECOMMENDED';
      const info: GapSeverity = 'INFO';

      // Verify the values are what we expect
      expect(blocking).toBe('BLOCKING');
      expect(recommended).toBe('RECOMMENDED');
      expect(info).toBe('INFO');

      // Verify all three values are distinct
      const severities: GapSeverity[] = [blocking, recommended, info];
      expect(new Set(severities).size).toBe(3);
    });
  });

  // ============================================================================
  // Test 2: GapItem interface structure
  // ============================================================================
  describe('GapItem interface', () => {
    it('has all required fields and optional fields with correct types', () => {
      // Minimal GapItem with only required fields
      const minimalGapItem: GapItem = {
        code: 'SERVER_URL_MISSING',
        severity: 'BLOCKING',
        message: 'No server base URL is specified for this API.',
      };

      expect(minimalGapItem.code).toBe('SERVER_URL_MISSING');
      expect(minimalGapItem.severity).toBe('BLOCKING');
      expect(minimalGapItem.message).toBe('No server base URL is specified for this API.');
      expect(minimalGapItem.location).toBeUndefined();
      expect(minimalGapItem.suggestedQuestions).toBeUndefined();
      expect(minimalGapItem.data).toBeUndefined();

      // Full GapItem with all fields
      const fullGapItem: GapItem = {
        code: 'RESPONSES_UNDEFINED',
        severity: 'BLOCKING',
        message: 'Response status codes and response schema are not specified.',
        location: {
          interfaceId: 'iface-1',
          endpointId: 'ep-1',
          method: 'GET',
          path: '/users/{id}',
          paramName: 'id',
        },
        suggestedQuestions: [
          'What status codes should this endpoint return?',
          'What is the response schema?',
        ],
        data: {
          endpointName: 'Get User',
          expectedVerb: 'GET',
        },
      };

      expect(fullGapItem.location).toBeDefined();
      expect(fullGapItem.location?.interfaceId).toBe('iface-1');
      expect(fullGapItem.location?.endpointId).toBe('ep-1');
      expect(fullGapItem.location?.method).toBe('GET');
      expect(fullGapItem.location?.path).toBe('/users/{id}');
      expect(fullGapItem.location?.paramName).toBe('id');
      expect(fullGapItem.suggestedQuestions).toHaveLength(2);
      expect(fullGapItem.data).toHaveProperty('endpointName', 'Get User');
    });
  });

  // ============================================================================
  // Test 3: GapReport interface structure completeness
  // ============================================================================
  describe('GapReport interface', () => {
    it('contains all required sections: interfaceId, generatedAt, gaps, defaults, typeMappings, operationIds', () => {
      const gapReport: GapReport = {
        interfaceId: 'iface-123',
        generatedAt: '2025-12-16T10:00:00.000Z',
        gaps: [
          {
            code: 'SERVER_URL_MISSING',
            severity: 'BLOCKING',
            message: 'No server base URL is specified for this API.',
          },
          {
            code: 'SECURITY_NOT_SPECIFIED',
            severity: 'RECOMMENDED',
            message: 'No authentication/security scheme is specified.',
          },
          {
            code: 'INFO_VERSION_DEFAULTED',
            severity: 'INFO',
            message: 'Interface has no explicit version; a default will be used.',
          },
        ],
        defaults: [
          {
            code: 'DEFAULT_INFO_VERSION',
            value: '1.0.0',
            rationale: 'OpenAPI requires info.version; interface does not provide one.',
          },
          {
            code: 'DEFAULT_MEDIA_TYPE',
            value: 'application/json',
            rationale: 'Assume JSON for REST/HTTP endpoints unless specified otherwise.',
          },
        ],
        typeMappings: [
          {
            logicalType: 'string_uuid',
            oasSchema: { type: 'string', format: 'uuid' },
          },
          {
            logicalType: 'integer',
            oasSchema: { type: 'integer' },
          },
        ],
        operationIds: [
          {
            endpointId: 'ep-1',
            method: 'GET',
            path: '/users/{id}',
            style: 'camelCase',
            operationId: 'getUsersById',
          },
          {
            endpointId: 'ep-1',
            method: 'GET',
            path: '/users/{id}',
            style: 'snake_case',
            operationId: 'get_users_by_id',
          },
        ],
      };

      // Verify all required fields are present
      expect(gapReport.interfaceId).toBe('iface-123');
      expect(gapReport.generatedAt).toBe('2025-12-16T10:00:00.000Z');
      expect(Array.isArray(gapReport.gaps)).toBe(true);
      expect(Array.isArray(gapReport.defaults)).toBe(true);
      expect(Array.isArray(gapReport.typeMappings)).toBe(true);
      expect(Array.isArray(gapReport.operationIds)).toBe(true);

      // Verify structure of nested arrays
      expect(gapReport.gaps).toHaveLength(3);
      expect(gapReport.defaults).toHaveLength(2);
      expect(gapReport.typeMappings).toHaveLength(2);
      expect(gapReport.operationIds).toHaveLength(2);

      // Verify DefaultAssumption structure
      const defaultAssumption: DefaultAssumption = gapReport.defaults[0];
      expect(defaultAssumption).toHaveProperty('code');
      expect(defaultAssumption).toHaveProperty('value');
      expect(defaultAssumption).toHaveProperty('rationale');

      // Verify TypeMapping structure
      const typeMapping: TypeMapping = gapReport.typeMappings[0];
      expect(typeMapping).toHaveProperty('logicalType');
      expect(typeMapping).toHaveProperty('oasSchema');

      // Verify OperationIdSuggestion structure
      const operationIdSuggestion: OperationIdSuggestion = gapReport.operationIds[0];
      expect(operationIdSuggestion).toHaveProperty('endpointId');
      expect(operationIdSuggestion).toHaveProperty('style');
      expect(operationIdSuggestion).toHaveProperty('operationId');
      expect(operationIdSuggestion.style).toBe('camelCase');
    });
  });

  // ============================================================================
  // Test 4: ComputeOasGapsRequest interface validation
  // ============================================================================
  describe('ComputeOasGapsRequest interface', () => {
    it('validates required and optional fields', () => {
      // Minimal request with only required fields
      const minimalRequest: ComputeOasGapsRequest = {
        sessionId: 'session-abc',
        interfaceId: 'iface-xyz',
      };

      expect(minimalRequest.sessionId).toBe('session-abc');
      expect(minimalRequest.interfaceId).toBe('iface-xyz');
      expect(minimalRequest.draftOas).toBeUndefined();

      // Full request with optional draftOas
      const fullRequest: ComputeOasGapsRequest = {
        sessionId: 'session-def',
        interfaceId: 'iface-456',
        draftOas: `openapi: 3.0.0
info:
  title: Draft API
  version: 1.0.0
paths: {}`,
      };

      expect(fullRequest.sessionId).toBe('session-def');
      expect(fullRequest.interfaceId).toBe('iface-456');
      expect(fullRequest.draftOas).toContain('openapi: 3.0.0');

      // Verify draftOas is string type
      expect(typeof fullRequest.draftOas).toBe('string');
    });
  });
});
