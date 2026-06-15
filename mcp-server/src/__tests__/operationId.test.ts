/**
 * Tests for operationId generation service
 * Tests the generation of operationIds in both camelCase and snake_case styles,
 * path parameter handling, collision detection, and suffix generation.
 */

import {
  normalizeVerb,
  parsePathSegments,
  generateOperationId,
  generateOperationIdsWithCollisionHandling,
} from '../services/operationId';
import type { InterfaceEndpointDto } from '../types';

describe('OperationId Generation Service', () => {
  // ============================================================================
  // Test 1: GET /resources produces getResources (camelCase) and get_resources (snake_case)
  // ============================================================================
  describe('GET /resources', () => {
    it('produces getResources (camelCase) and get_resources (snake_case)', () => {
      const camelCaseResult = generateOperationId('GET', '/resources', 'camelCase');
      const snakeCaseResult = generateOperationId('GET', '/resources', 'snake_case');

      expect(camelCaseResult).toBe('getResources');
      expect(snakeCaseResult).toBe('get_resources');
    });
  });

  // ============================================================================
  // Test 2: GET /resources/{id} produces getResourcesById and get_resources_by_id
  // ============================================================================
  describe('GET /resources/{id}', () => {
    it('produces getResourcesById (camelCase) and get_resources_by_id (snake_case)', () => {
      const camelCaseResult = generateOperationId('GET', '/resources/{id}', 'camelCase');
      const snakeCaseResult = generateOperationId('GET', '/resources/{id}', 'snake_case');

      expect(camelCaseResult).toBe('getResourcesById');
      expect(snakeCaseResult).toBe('get_resources_by_id');
    });
  });

  // ============================================================================
  // Test 3: POST /users produces postUsers and post_users
  // ============================================================================
  describe('POST /users', () => {
    it('produces postUsers (camelCase) and post_users (snake_case)', () => {
      const camelCaseResult = generateOperationId('POST', '/users', 'camelCase');
      const snakeCaseResult = generateOperationId('POST', '/users', 'snake_case');

      expect(camelCaseResult).toBe('postUsers');
      expect(snakeCaseResult).toBe('post_users');
    });
  });

  // ============================================================================
  // Test 4: Kebab-case path /user-profiles converts correctly
  // ============================================================================
  describe('kebab-case path /user-profiles', () => {
    it('converts kebab-case path segments correctly', () => {
      const camelCaseResult = generateOperationId('GET', '/user-profiles', 'camelCase');
      const snakeCaseResult = generateOperationId('GET', '/user-profiles', 'snake_case');

      expect(camelCaseResult).toBe('getUserProfiles');
      expect(snakeCaseResult).toBe('get_user_profiles');
    });

    it('handles kebab-case path with parameters', () => {
      const camelCaseResult = generateOperationId('GET', '/user-profiles/{profile-id}', 'camelCase');
      const snakeCaseResult = generateOperationId('GET', '/user-profiles/{profile-id}', 'snake_case');

      expect(camelCaseResult).toBe('getUserProfilesByProfileId');
      expect(snakeCaseResult).toBe('get_user_profiles_by_profile_id');
    });
  });

  // ============================================================================
  // Test 5: Nested path /api/v1/users/{id}/orders produces correct operationIds
  // ============================================================================
  describe('nested path /api/v1/users/{id}/orders', () => {
    it('produces correct operationIds for nested paths', () => {
      const camelCaseResult = generateOperationId('GET', '/api/v1/users/{id}/orders', 'camelCase');
      const snakeCaseResult = generateOperationId('GET', '/api/v1/users/{id}/orders', 'snake_case');

      expect(camelCaseResult).toBe('getApiV1UsersByIdOrders');
      expect(snakeCaseResult).toBe('get_api_v1_users_by_id_orders');
    });

    it('handles POST on nested path', () => {
      const camelCaseResult = generateOperationId('POST', '/api/v1/users/{id}/orders', 'camelCase');
      const snakeCaseResult = generateOperationId('POST', '/api/v1/users/{id}/orders', 'snake_case');

      expect(camelCaseResult).toBe('postApiV1UsersByIdOrders');
      expect(snakeCaseResult).toBe('post_api_v1_users_by_id_orders');
    });
  });

  // ============================================================================
  // Test 6: Collision detection with two identical endpoints
  // ============================================================================
  describe('collision detection', () => {
    it('detects collision when two endpoints produce the same operationId', () => {
      const endpoints: InterfaceEndpointDto[] = [
        {
          id: 'ep-1',
          name: 'Get Resources 1',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/resources',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        {
          id: 'ep-2',
          name: 'Get Resources 2',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/resources',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
      ];

      const result = generateOperationIdsWithCollisionHandling(endpoints);

      // Should have 4 suggestions (2 per endpoint)
      expect(result.suggestions).toHaveLength(4);

      // Should have 1 collision gap item
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].code).toBe('OPERATION_ID_COLLISION');
      expect(result.collisions[0].severity).toBe('INFO');
      expect(result.collisions[0].message).toContain('getResources');

      // Verify collision data
      expect(result.collisions[0].data).toBeDefined();
      expect(result.collisions[0].data?.collisionCount).toBe(2);
    });
  });

  // ============================================================================
  // Test 7: Collision suffix generation (_2, _3 for snake_case; 2, 3 for camelCase)
  // ============================================================================
  describe('collision suffix generation', () => {
    it('adds correct suffixes for collisions: 2, 3 for camelCase; _2, _3 for snake_case', () => {
      const endpoints: InterfaceEndpointDto[] = [
        {
          id: 'ep-1',
          name: 'Get Users 1',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/users',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        {
          id: 'ep-2',
          name: 'Get Users 2',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/users',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        {
          id: 'ep-3',
          name: 'Get Users 3',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/users',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
      ];

      const result = generateOperationIdsWithCollisionHandling(endpoints);

      // Should have 6 suggestions (2 per endpoint)
      expect(result.suggestions).toHaveLength(6);

      // Extract camelCase operationIds
      const camelCaseIds = result.suggestions
        .filter(s => s.style === 'camelCase')
        .map(s => s.operationId);

      // Extract snake_case operationIds
      const snakeCaseIds = result.suggestions
        .filter(s => s.style === 'snake_case')
        .map(s => s.operationId);

      // Verify camelCase suffixes: getUsers, getUsers2, getUsers3
      expect(camelCaseIds).toContain('getUsers');
      expect(camelCaseIds).toContain('getUsers2');
      expect(camelCaseIds).toContain('getUsers3');

      // Verify snake_case suffixes: get_users, get_users_2, get_users_3
      expect(snakeCaseIds).toContain('get_users');
      expect(snakeCaseIds).toContain('get_users_2');
      expect(snakeCaseIds).toContain('get_users_3');

      // All operationIds should be unique within their style
      expect(new Set(camelCaseIds).size).toBe(3);
      expect(new Set(snakeCaseIds).size).toBe(3);
    });
  });

  // ============================================================================
  // Test 8: Empty/missing verb or path returns null suggestion
  // ============================================================================
  describe('empty/missing verb or path', () => {
    it('returns empty string for null verb', () => {
      const result = generateOperationId(null as unknown as string, '/users', 'camelCase');
      expect(result).toBe('');
    });

    it('returns empty string for undefined verb', () => {
      const result = generateOperationId(undefined as unknown as string, '/users', 'camelCase');
      expect(result).toBe('');
    });

    it('returns empty string for empty verb', () => {
      const result = generateOperationId('', '/users', 'camelCase');
      expect(result).toBe('');

      const whitespaceResult = generateOperationId('   ', '/users', 'camelCase');
      expect(whitespaceResult).toBe('');
    });

    it('returns just the verb for empty path', () => {
      const camelCaseResult = generateOperationId('GET', '', 'camelCase');
      const snakeCaseResult = generateOperationId('GET', '', 'snake_case');

      expect(camelCaseResult).toBe('get');
      expect(snakeCaseResult).toBe('get');
    });

    it('skips endpoints with missing verb or path in generateOperationIdsWithCollisionHandling', () => {
      const endpoints: InterfaceEndpointDto[] = [
        {
          id: 'ep-1',
          name: 'Missing Verb',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/users',
          protocol: 'HTTP',
          operationVerb: null, // Missing verb
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        {
          id: 'ep-2',
          name: 'Missing Path',
          description: null,
          endpointType: 'REST',
          pathOrAddress: null, // Missing path
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        {
          id: 'ep-3',
          name: 'Empty Path',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '', // Empty path
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        {
          id: 'ep-4',
          name: 'Valid Endpoint',
          description: null,
          endpointType: 'REST',
          pathOrAddress: '/orders',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'Inbound',
          lifecycleStatus: 'Active',
          version: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
      ];

      const result = generateOperationIdsWithCollisionHandling(endpoints);

      // Only the valid endpoint should have suggestions
      expect(result.suggestions).toHaveLength(2); // camelCase + snake_case
      expect(result.suggestions[0].endpointId).toBe('ep-4');
      expect(result.suggestions[1].endpointId).toBe('ep-4');

      // No collisions since there's only one valid endpoint
      expect(result.collisions).toHaveLength(0);
    });
  });

  // ============================================================================
  // Additional helper function tests
  // ============================================================================
  describe('helper functions', () => {
    describe('normalizeVerb', () => {
      it('converts verbs to lowercase', () => {
        expect(normalizeVerb('GET')).toBe('get');
        expect(normalizeVerb('POST')).toBe('post');
        expect(normalizeVerb('Put')).toBe('put');
        expect(normalizeVerb('DELETE')).toBe('delete');
        expect(normalizeVerb('PATCH')).toBe('patch');
      });

      it('trims whitespace', () => {
        expect(normalizeVerb('  GET  ')).toBe('get');
      });

      it('returns null for invalid inputs', () => {
        expect(normalizeVerb(null)).toBeNull();
        expect(normalizeVerb(undefined)).toBeNull();
        expect(normalizeVerb('')).toBeNull();
        expect(normalizeVerb('   ')).toBeNull();
      });
    });

    describe('parsePathSegments', () => {
      it('parses simple paths', () => {
        const result = parsePathSegments('/users', 'camelCase');
        expect(result).toEqual(['users']);
      });

      it('parses paths with parameters', () => {
        const camelResult = parsePathSegments('/users/{id}', 'camelCase');
        expect(camelResult).toEqual(['users', 'By', 'Id']);

        const snakeResult = parsePathSegments('/users/{id}', 'snake_case');
        expect(snakeResult).toEqual(['users', 'by', 'id']);
      });

      it('handles empty paths', () => {
        expect(parsePathSegments('', 'camelCase')).toEqual([]);
        expect(parsePathSegments('/', 'camelCase')).toEqual([]);
      });

      it('handles multiple segments', () => {
        const result = parsePathSegments('/api/v1/users', 'camelCase');
        expect(result).toEqual(['api', 'v1', 'users']);
      });
    });
  });
});
