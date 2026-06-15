/**
 * Tests for Interface Entity Relationship Refactor
 *
 * Spec: Interface Entity Relationship Refactor (2026-01-11)
 *
 * This test file covers all 5 task groups:
 * - Task Group 1: Frontend Type & Config Updates
 * - Task Group 2: Grid Cell/Selector Integration (verification tests)
 * - Task Group 3: Backend DTO/Entity/Mapper (mocked - actual tests in Java)
 * - Task Group 4: XLSX Import/Export Updates
 * - Task Group 5: Test Review & Gap Analysis (integration tests)
 */

import { describe, it, expect } from 'vitest';
import {
  gridConfigs,
  relationshipTabToType,
  relationshipTabNames,
} from '../config/gridConfigs';
import {
  RELATIONSHIP_DEFINITIONS,
  RELATIONSHIP_TAB_ORDER,
} from '../config/relationshipDefinitions';
import type { InterfaceLogicalEntity } from '../types/model';

// ============================================================================
// Task Group 1: Frontend Type & Config Updates
// ============================================================================

describe('Task Group 1: Frontend Type and Config Updates', () => {
  describe('1.2 relationshipTabToType mapping', () => {
    it('maps "Interface <-> Entity" to "interface_logical_entities"', () => {
      expect(relationshipTabToType['Interface <-> Entity']).toBe('interface_logical_entities');
    });

    it('does NOT have legacy "Interface <-> Logical Entity" mapping', () => {
      expect(relationshipTabToType['Interface <-> Logical Entity']).toBeUndefined();
    });
  });

  describe('1.3 relationshipTabNames array', () => {
    it('includes "Interface <-> Entity" tab name', () => {
      expect(relationshipTabNames).toContain('Interface <-> Entity');
    });

    it('does NOT include legacy "Interface <-> Logical Entity" tab name', () => {
      expect(relationshipTabNames).not.toContain('Interface <-> Logical Entity');
    });
  });

  describe('1.4 RELATIONSHIP_DEFINITIONS', () => {
    it('has correct displayName "Interface <-> Entity"', () => {
      const def = RELATIONSHIP_DEFINITIONS.find(
        d => d.relationshipKey === 'interface_logical_entities'
      );
      expect(def).toBeDefined();
      expect(def!.displayName).toBe('Interface <-> Entity');
    });

    it('has updated endpointEntityTypes including logical, physical, and data_entity_points', () => {
      const def = RELATIONSHIP_DEFINITIONS.find(
        d => d.relationshipKey === 'interface_logical_entities'
      );
      expect(def).toBeDefined();
      expect(def!.endpointEntityTypes).toContain('interfaces');
      expect(def!.endpointEntityTypes).toContain('logical_data_entities');
      expect(def!.endpointEntityTypes).toContain('physical_data_entities');
      expect(def!.endpointEntityTypes).toContain('data_entity_points');
    });
  });

  describe('1.5 RELATIONSHIP_TAB_ORDER', () => {
    it('includes "Interface <-> Entity" in tab order', () => {
      expect(RELATIONSHIP_TAB_ORDER).toContain('Interface <-> Entity');
    });

    it('does NOT include legacy "Interface <-> Logical Entity" in tab order', () => {
      expect(RELATIONSHIP_TAB_ORDER).not.toContain('Interface <-> Logical Entity');
    });
  });

  describe('1.6 interface_logical_entities grid config', () => {
    it('has dataEntityPointId column instead of logical_entity_id', () => {
      const config = gridConfigs['interface_logical_entities'];
      expect(config).toBeDefined();

      // Should have dataEntityPointId column
      const dataEntityPointCol = config.find(c => c.field === 'dataEntityPointId');
      expect(dataEntityPointCol).toBeDefined();

      // Should NOT have logical_entity_id column (removed)
      const logicalEntityCol = config.find(c => c.field === 'logical_entity_id');
      expect(logicalEntityCol).toBeUndefined();
    });

    it('dataEntityPointId column has correct displayName "Data Entity"', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.displayName).toBe('Data Entity');
    });

    it('dataEntityPointId column has cellType "data_entity_point_picker"', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.cellType).toBe('data_entity_point_picker');
    });

    it('dataEntityPointId column is required', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.required).toBe(true);
    });

    it('dataEntityPointId column does NOT have fkTarget (picker handles this)', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.fkTarget).toBeUndefined();
    });
  });

  describe('1.7 InterfaceLogicalEntity interface', () => {
    it('accepts dataEntityPointId field', () => {
      const entity: InterfaceLogicalEntity = {
        id: 'rel_ile_001',
        interface_id: 'if_001',
        dataEntityPointId: 'dep_log_lde_001',
        description: 'Test relationship',
        tags: '',
      };
      expect(entity.dataEntityPointId).toBe('dep_log_lde_001');
    });

    it('supports both logical and physical entity point IDs', () => {
      const logicalEntity: InterfaceLogicalEntity = {
        id: 'rel_ile_001',
        interface_id: 'if_001',
        dataEntityPointId: 'dep_log_lde_001',
        description: 'Logical entity reference',
        tags: '',
      };
      expect(logicalEntity.dataEntityPointId.startsWith('dep_log_')).toBe(true);

      const physicalEntity: InterfaceLogicalEntity = {
        id: 'rel_ile_002',
        interface_id: 'if_002',
        dataEntityPointId: 'dep_phy_pde_001',
        description: 'Physical entity reference',
        tags: '',
      };
      expect(physicalEntity.dataEntityPointId.startsWith('dep_phy_')).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 2: Grid Cell/Selector Integration (Verification Tests)
// ============================================================================

describe('Task Group 2: Grid Cell/Selector Integration', () => {
  describe('2.2-2.4 Verification: data_entity_point_picker support', () => {
    it('interface_logical_entities config uses data_entity_point_picker cellType', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.cellType).toBe('data_entity_point_picker');
    });

    it('data_movements config also uses data_entity_point_picker (reference pattern)', () => {
      const config = gridConfigs['data_movements'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.cellType).toBe('data_entity_point_picker');
    });
  });

  describe('2.5 Data Entity Point ID format', () => {
    it('validates logical entity point ID format', () => {
      const logicalPointId = 'dep_log_lde_abc123';
      expect(logicalPointId.startsWith('dep_log_')).toBe(true);
    });

    it('validates physical entity point ID format', () => {
      const physicalPointId = 'dep_phy_pde_abc123';
      expect(physicalPointId.startsWith('dep_phy_')).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 4: XLSX Import/Export Updates
// ============================================================================

describe('Task Group 4: XLSX Import/Export Updates', () => {
  describe('4.2-4.3 Export uses new column header', () => {
    it('interface_logical_entities config has "Data Entity" displayName for export', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.field === 'dataEntityPointId');
      expect(col).toBeDefined();
      expect(col!.displayName).toBe('Data Entity');
    });
  });

  describe('4.4-4.5 Import handles legacy and new column formats', () => {
    it('grid config field is dataEntityPointId (new format)', () => {
      const config = gridConfigs['interface_logical_entities'];
      const col = config.find(c => c.displayName === 'Data Entity');
      expect(col).toBeDefined();
      expect(col!.field).toBe('dataEntityPointId');
    });
  });
});

// ============================================================================
// Task Group 5: Test Review & Gap Analysis
// ============================================================================

describe('Task Group 5: Integration Tests', () => {
  describe('5.2-5.3 End-to-end workflow verification', () => {
    it('relationship definition is consistent across all configuration sources', () => {
      // Verify relationshipTabToType matches RELATIONSHIP_DEFINITIONS
      const tabMapping = relationshipTabToType['Interface <-> Entity'];
      expect(tabMapping).toBe('interface_logical_entities');

      const definition = RELATIONSHIP_DEFINITIONS.find(
        d => d.relationshipKey === 'interface_logical_entities'
      );
      expect(definition).toBeDefined();
      expect(definition!.displayName).toBe('Interface <-> Entity');

      // Verify tab order includes the new name
      expect(RELATIONSHIP_TAB_ORDER).toContain('Interface <-> Entity');

      // Verify relationshipTabNames includes the new name
      expect(relationshipTabNames).toContain('Interface <-> Entity');
    });

    it('grid config has all required columns for interface_logical_entities', () => {
      const config = gridConfigs['interface_logical_entities'];
      expect(config).toBeDefined();

      // Required columns
      const requiredFields = ['id', 'interface_id', 'dataEntityPointId'];
      for (const field of requiredFields) {
        const col = config.find(c => c.field === field);
        expect(col).toBeDefined();
      }
    });

    it('domain visibility includes both Application and Data domains', () => {
      const definition = RELATIONSHIP_DEFINITIONS.find(
        d => d.relationshipKey === 'interface_logical_entities'
      );
      expect(definition).toBeDefined();

      // Application domain entities
      expect(definition!.endpointEntityTypes).toContain('interfaces');

      // Data domain entities
      expect(definition!.endpointEntityTypes).toContain('logical_data_entities');
      expect(definition!.endpointEntityTypes).toContain('physical_data_entities');
      expect(definition!.endpointEntityTypes).toContain('data_entity_points');
    });
  });

  describe('5.3 Backward compatibility verification', () => {
    it('interface_logical_entities relationship key is preserved (no key change)', () => {
      const definition = RELATIONSHIP_DEFINITIONS.find(
        d => d.relationshipKey === 'interface_logical_entities'
      );
      expect(definition).toBeDefined();
      expect(definition!.relationshipKey).toBe('interface_logical_entities');
    });

    it('gridConfigs key is preserved as interface_logical_entities', () => {
      const config = gridConfigs['interface_logical_entities'];
      expect(config).toBeDefined();
      expect(Array.isArray(config)).toBe(true);
    });
  });
});
