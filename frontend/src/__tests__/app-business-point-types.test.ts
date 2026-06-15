/**
 * Tests for AppBusinessPoint type definitions
 * Task Group 1: Type Definitions Layer
 */

import { describe, it, expect } from 'vitest';
import {
  AppBusinessPoint,
  AppBusinessPointKind,
  APP_BUSINESS_POINT_KINDS,
  isAppBusinessPointKind,
  ENTITY_TYPES,
  MetaModelEntities,
} from '../types/model';

describe('AppBusinessPoint Type Definitions', () => {
  describe('AppBusinessPoint interface', () => {
    it('should have required fields: id, name, kind, source_entity_id', () => {
      // Create a valid AppBusinessPoint object
      const abp: AppBusinessPoint = {
        id: 'abp_test_001',
        name: 'Test Point',
        kind: 'APPLICATION',
        source_entity_id: 'test_001',
      };

      // Verify all required fields are present
      expect(abp.id).toBe('abp_test_001');
      expect(abp.name).toBe('Test Point');
      expect(abp.kind).toBe('APPLICATION');
      expect(abp.source_entity_id).toBe('test_001');
    });

    it('should allow all valid AppBusinessPointKind values', () => {
      const kinds: AppBusinessPointKind[] = [
        'APPLICATION',
        'APP_COMPONENT',
        'SERVICE',
        'INTERFACE',
        'BUSINESS_PROCESS',
        'PROCESS_ACTIVITY',
      ];

      kinds.forEach(kind => {
        const abp: AppBusinessPoint = {
          id: `abp_${kind.toLowerCase()}_001`,
          name: `Test ${kind}`,
          kind,
          source_entity_id: `${kind.toLowerCase()}_001`,
        };
        expect(abp.kind).toBe(kind);
      });
    });
  });

  describe('APP_BUSINESS_POINT_KINDS constant', () => {
    it('should contain all 6 expected entity types', () => {
      expect(APP_BUSINESS_POINT_KINDS).toContain('APPLICATION');
      expect(APP_BUSINESS_POINT_KINDS).toContain('APP_COMPONENT');
      expect(APP_BUSINESS_POINT_KINDS).toContain('SERVICE');
      expect(APP_BUSINESS_POINT_KINDS).toContain('INTERFACE');
      expect(APP_BUSINESS_POINT_KINDS).toContain('BUSINESS_PROCESS');
      expect(APP_BUSINESS_POINT_KINDS).toContain('PROCESS_ACTIVITY');
      expect(APP_BUSINESS_POINT_KINDS.length).toBe(6);
    });
  });

  describe('isAppBusinessPointKind helper', () => {
    it('should return true for valid AppBusinessPointKind values', () => {
      expect(isAppBusinessPointKind('APPLICATION')).toBe(true);
      expect(isAppBusinessPointKind('APP_COMPONENT')).toBe(true);
      expect(isAppBusinessPointKind('SERVICE')).toBe(true);
      expect(isAppBusinessPointKind('INTERFACE')).toBe(true);
      expect(isAppBusinessPointKind('BUSINESS_PROCESS')).toBe(true);
      expect(isAppBusinessPointKind('PROCESS_ACTIVITY')).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isAppBusinessPointKind('INVALID')).toBe(false);
      expect(isAppBusinessPointKind('')).toBe(false);
      expect(isAppBusinessPointKind('ENDPOINT')).toBe(false); // Endpoint is NOT an ABP kind
      expect(isAppBusinessPointKind('application')).toBe(false); // lowercase
    });
  });

  describe('ENTITY_TYPES constant', () => {
    it('should include APP_BUSINESS_POINT entry', () => {
      expect(ENTITY_TYPES.APP_BUSINESS_POINT).toBe('APP_BUSINESS_POINT');
    });
  });

  describe('Deterministic ID pattern', () => {
    it('should follow abp_{source_entity_id} pattern', () => {
      const sourceId = 'app_001';
      const expectedAbpId = `abp_${sourceId}`;

      const abp: AppBusinessPoint = {
        id: expectedAbpId,
        name: 'Test App',
        kind: 'APPLICATION',
        source_entity_id: sourceId,
      };

      expect(abp.id).toBe('abp_app_001');
      expect(abp.id.startsWith('abp_')).toBe(true);
      expect(abp.id).toContain(abp.source_entity_id);
    });
  });
});
