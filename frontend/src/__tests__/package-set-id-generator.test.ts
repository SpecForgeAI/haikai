/**
 * Tests for ID Generator - Package Set and Package prefixes
 * Task Group 1: ID Generator Updates
 *
 * Spec: Create Package Set Modal with Embedded Packages Builder
 */

import { generateEntityId, getEntityPrefix } from '../utils/idGenerator';

describe('ID Generator - Package Set and Package prefixes', () => {
  describe('getEntityPrefix', () => {
    it('should return "pkgset" prefix for package_sets entity type', () => {
      const prefix = getEntityPrefix('package_sets');
      expect(prefix).toBe('pkgset');
    });

    it('should return "pkg" prefix for packages entity type', () => {
      const prefix = getEntityPrefix('packages');
      expect(prefix).toBe('pkg');
    });
  });

  describe('generateEntityId', () => {
    it('should generate ID with "pkgset" prefix for package_sets', () => {
      const id = generateEntityId('package_sets');
      expect(id).toMatch(/^pkgset-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate ID with "pkg" prefix for packages', () => {
      const id = generateEntityId('packages');
      expect(id).toMatch(/^pkg-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate unique IDs on consecutive calls', () => {
      const id1 = generateEntityId('package_sets');
      const id2 = generateEntityId('package_sets');
      const id3 = generateEntityId('packages');
      const id4 = generateEntityId('packages');

      // All IDs should be unique
      const ids = new Set([id1, id2, id3, id4]);
      expect(ids.size).toBe(4);
    });

    it('should follow the pattern {prefix}-{timestamp}-{random}', () => {
      const packageSetId = generateEntityId('package_sets');
      const packageId = generateEntityId('packages');

      // Pattern: prefix-timestamp(base36)-random(5chars)
      const parts1 = packageSetId.split('-');
      const parts2 = packageId.split('-');

      expect(parts1.length).toBe(3);
      expect(parts1[0]).toBe('pkgset');
      expect(parts1[1].length).toBeGreaterThan(0); // timestamp in base36
      expect(parts1[2].length).toBe(5); // random suffix

      expect(parts2.length).toBe(3);
      expect(parts2[0]).toBe('pkg');
      expect(parts2[1].length).toBeGreaterThan(0);
      expect(parts2[2].length).toBe(5);
    });
  });
});
