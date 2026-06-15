/**
 * contextBundleTypes.test.ts
 *
 * Spec 2026-01-16: Context Picker Bundles - UI and Selection Contract
 * Task Group 1: Tests for bundle type utilities
 *
 * Tests:
 * - getDefaultBundleType returns correct defaults for interfaces, services, physical_data_entities, diagrams
 * - getDefaultBundleType returns undefined for unsupported entity types
 * - getBundleOptionsForEntityType returns correct options array for each supported type
 * - getBundleOptionsForEntityType returns empty array for unsupported types
 */

import { describe, it, expect } from 'vitest';
import {
  getDefaultBundleType,
  getBundleOptionsForEntityType,
  BUNDLE_TYPE_LABELS,
  type InterfaceBundleType,
  type ServiceBundleType,
  type PhysicalDataEntityBundleType,
  type DiagramBundleType,
  type BundleType,
} from '../utils/contextBundleTypes';

describe('contextBundleTypes', () => {
  describe('getDefaultBundleType', () => {
    it('returns interface_with_endpoints_and_schemas for interfaces', () => {
      // Act
      const result = getDefaultBundleType('interfaces');

      // Assert
      expect(result).toBe('interface_with_endpoints_and_schemas');
    });

    it('returns service_with_parents_and_children for services', () => {
      // Act
      const result = getDefaultBundleType('services');

      // Assert
      expect(result).toBe('service_with_parents_and_children');
    });

    it('returns entity_with_attributes_and_relationships for physical_data_entities', () => {
      // Act
      const result = getDefaultBundleType('physical_data_entities');

      // Assert
      expect(result).toBe('entity_with_attributes_and_relationships');
    });

    it('returns diagram_only for diagrams', () => {
      // Act
      const result = getDefaultBundleType('diagrams');

      // Assert
      expect(result).toBe('diagram_only');
    });

    it('returns undefined for unsupported entity types', () => {
      // Act & Assert
      expect(getDefaultBundleType('applications')).toBeUndefined();
      expect(getDefaultBundleType('business_processes')).toBeUndefined();
      expect(getDefaultBundleType('endpoints')).toBeUndefined();
      expect(getDefaultBundleType('unknown_type')).toBeUndefined();
      expect(getDefaultBundleType('')).toBeUndefined();
    });
  });

  describe('getBundleOptionsForEntityType', () => {
    it('returns correct options array for interfaces', () => {
      // Act
      const result = getBundleOptionsForEntityType('interfaces');

      // Assert
      expect(result).toEqual([
        'interface_only',
        'interface_with_endpoints',
        'interface_with_endpoints_and_schemas',
      ]);
    });

    it('returns correct options array for services', () => {
      // Act
      const result = getBundleOptionsForEntityType('services');

      // Assert
      expect(result).toEqual([
        'service_only',
        'service_with_parents_and_children',
      ]);
    });

    it('returns correct options array for physical_data_entities', () => {
      // Act
      const result = getBundleOptionsForEntityType('physical_data_entities');

      // Assert
      expect(result).toEqual([
        'entity_only',
        'entity_with_attributes_and_relationships',
      ]);
    });

    it('returns correct options array for diagrams', () => {
      // Act
      const result = getBundleOptionsForEntityType('diagrams');

      // Assert
      expect(result).toEqual(['diagram_only']);
    });

    it('returns empty array for unsupported entity types', () => {
      // Act & Assert
      expect(getBundleOptionsForEntityType('applications')).toEqual([]);
      expect(getBundleOptionsForEntityType('business_processes')).toEqual([]);
      expect(getBundleOptionsForEntityType('endpoints')).toEqual([]);
      expect(getBundleOptionsForEntityType('unknown_type')).toEqual([]);
      expect(getBundleOptionsForEntityType('')).toEqual([]);
    });
  });

  describe('BUNDLE_TYPE_LABELS', () => {
    it('provides human-readable labels for all interface bundle types', () => {
      expect(BUNDLE_TYPE_LABELS['interface_only']).toBe('Interface Only');
      expect(BUNDLE_TYPE_LABELS['interface_with_endpoints']).toBe('With Endpoints');
      expect(BUNDLE_TYPE_LABELS['interface_with_endpoints_and_schemas']).toBe('With Endpoints & Schemas');
    });

    it('provides human-readable labels for all service bundle types', () => {
      expect(BUNDLE_TYPE_LABELS['service_only']).toBe('Service Only');
      expect(BUNDLE_TYPE_LABELS['service_with_parents_and_children']).toBe('With Parents & Children');
    });

    it('provides human-readable labels for all physical data entity bundle types', () => {
      expect(BUNDLE_TYPE_LABELS['entity_only']).toBe('Entity Only');
      expect(BUNDLE_TYPE_LABELS['entity_with_attributes_and_relationships']).toBe('With Attributes & Relationships');
    });

    it('provides human-readable label for diagram bundle type', () => {
      expect(BUNDLE_TYPE_LABELS['diagram_only']).toBe('Diagram Only');
    });
  });
});
