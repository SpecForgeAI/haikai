/**
 * Tests for Entity Type Canonicalization
 *
 * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
 *
 * Tests cover:
 * - snake_case to camelCase conversion for entity types
 * - Pass-through behavior for already-canonical types
 * - Unknown entity type handling
 * - Full entity ID parsing and reconstruction
 */

import {
  ENTITY_TYPE_CANONICAL_MAP,
  normalizeEntityTypeId,
} from '../services/architectureModelClient';

describe('Entity Type Canonicalization', () => {
  describe('ENTITY_TYPE_CANONICAL_MAP', () => {
    it('should contain mapping for physical_data_entities', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['physical_data_entities']).toBe('physicalDataEntities');
    });

    it('should contain mapping for logical_data_entities', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['logical_data_entities']).toBe('logicalDataEntities');
    });

    it('should contain mapping for app_components', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['app_components']).toBe('appComponents');
    });

    it('should contain mapping for business_processes', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['business_processes']).toBe('businessProcesses');
    });

    it('should contain mapping for business_points', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['business_points']).toBe('businessPoints');
    });

    it('should contain mapping for process_activities to businessPoints', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['process_activities']).toBe('businessPoints');
    });

    it('should contain mapping for ui_screens', () => {
      expect(ENTITY_TYPE_CANONICAL_MAP['ui_screens']).toBe('uiScreens');
    });
  });

  describe('normalizeEntityTypeId()', () => {
    describe('snake_case to camelCase conversion', () => {
      it('should convert physical_data_entities::pde-123 to physicalDataEntities::pde-123', () => {
        const result = normalizeEntityTypeId('physical_data_entities::pde-123');
        expect(result).toBe('physicalDataEntities::pde-123');
      });

      it('should convert logical_data_entities::lde-456 to logicalDataEntities::lde-456', () => {
        const result = normalizeEntityTypeId('logical_data_entities::lde-456');
        expect(result).toBe('logicalDataEntities::lde-456');
      });

      it('should convert app_components::ac-789 to appComponents::ac-789', () => {
        const result = normalizeEntityTypeId('app_components::ac-789');
        expect(result).toBe('appComponents::ac-789');
      });

      it('should convert business_processes::bp-101 to businessProcesses::bp-101', () => {
        const result = normalizeEntityTypeId('business_processes::bp-101');
        expect(result).toBe('businessProcesses::bp-101');
      });

      it('should convert business_points::bpt-102 to businessPoints::bpt-102', () => {
        const result = normalizeEntityTypeId('business_points::bpt-102');
        expect(result).toBe('businessPoints::bpt-102');
      });

      it('should convert process_activities::pa-103 to businessPoints::pa-103 (special mapping)', () => {
        const result = normalizeEntityTypeId('process_activities::pa-103');
        expect(result).toBe('businessPoints::pa-103');
      });

      it('should convert ui_screens::ui-104 to uiScreens::ui-104', () => {
        const result = normalizeEntityTypeId('ui_screens::ui-104');
        expect(result).toBe('uiScreens::ui-104');
      });
    });

    describe('pass-through for already-canonical types', () => {
      it('should pass through services::svc-123 unchanged', () => {
        const result = normalizeEntityTypeId('services::svc-123');
        expect(result).toBe('services::svc-123');
      });

      it('should pass through classes::cls-456 unchanged', () => {
        const result = normalizeEntityTypeId('classes::cls-456');
        expect(result).toBe('classes::cls-456');
      });

      it('should pass through methods::mth-789 unchanged', () => {
        const result = normalizeEntityTypeId('methods::mth-789');
        expect(result).toBe('methods::mth-789');
      });

      it('should pass through interfaces::iface-101 unchanged', () => {
        const result = normalizeEntityTypeId('interfaces::iface-101');
        expect(result).toBe('interfaces::iface-101');
      });

      it('should pass through applications::app-102 unchanged', () => {
        const result = normalizeEntityTypeId('applications::app-102');
        expect(result).toBe('applications::app-102');
      });

      it('should pass through endpoints::ep-103 unchanged', () => {
        const result = normalizeEntityTypeId('endpoints::ep-103');
        expect(result).toBe('endpoints::ep-103');
      });

      it('should pass through physicalDataEntities::pde-104 unchanged (already canonical)', () => {
        const result = normalizeEntityTypeId('physicalDataEntities::pde-104');
        expect(result).toBe('physicalDataEntities::pde-104');
      });

      it('should pass through logicalDataEntities::lde-105 unchanged (already canonical)', () => {
        const result = normalizeEntityTypeId('logicalDataEntities::lde-105');
        expect(result).toBe('logicalDataEntities::lde-105');
      });

      it('should pass through appComponents::ac-106 unchanged (already canonical)', () => {
        const result = normalizeEntityTypeId('appComponents::ac-106');
        expect(result).toBe('appComponents::ac-106');
      });
    });

    describe('unknown entity type handling', () => {
      it('should pass through unknown_type::id-123 unchanged', () => {
        const result = normalizeEntityTypeId('unknown_type::id-123');
        expect(result).toBe('unknown_type::id-123');
      });

      it('should pass through customEntity::ce-456 unchanged', () => {
        const result = normalizeEntityTypeId('customEntity::ce-456');
        expect(result).toBe('customEntity::ce-456');
      });
    });

    describe('edge cases', () => {
      it('should handle entity ID with multiple :: delimiters', () => {
        // Only split on the first ::
        const result = normalizeEntityTypeId('physical_data_entities::pde-with::colons');
        expect(result).toBe('physicalDataEntities::pde-with::colons');
      });

      it('should handle empty string', () => {
        const result = normalizeEntityTypeId('');
        expect(result).toBe('');
      });

      it('should handle string without :: delimiter', () => {
        const result = normalizeEntityTypeId('no-delimiter-here');
        expect(result).toBe('no-delimiter-here');
      });

      it('should handle string with only ::', () => {
        const result = normalizeEntityTypeId('::');
        expect(result).toBe('::');
      });
    });
  });
});
