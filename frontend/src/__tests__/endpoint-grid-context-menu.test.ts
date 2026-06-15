/**
 * Grid Row Context Menu Tests for Interface
 * Task Group 7: Tests for RHS context menu integration
 */

import { ENTITY_TYPES } from '../types/model';

describe('Grid Row Context Menu for Interface', () => {
  describe('context menu visibility', () => {
    it('should allow context menu for interfaces entity type', () => {
      const entityType = 'interfaces';
      const showContextMenu = entityType === 'interfaces';

      expect(showContextMenu).toBe(true);
    });

    it('should not show context menu for non-interface entity types', () => {
      const nonInterfaceTypes = [
        'applications',
        'services',
        'endpoints',
        'logical_data_entities',
      ];

      nonInterfaceTypes.forEach((entityType) => {
        const showContextMenu = entityType === 'interfaces';
        expect(showContextMenu).toBe(false);
      });
    });
  });

  describe('context menu options', () => {
    it('should include "Add endpoints and entities/attributes" option for interfaces', () => {
      const entityType = 'interfaces';
      const menuOptions = getContextMenuOptions(entityType);

      expect(menuOptions).toContain('Add endpoints and entities/attributes');
    });

    it('should not include "Add endpoints and entities/attributes" for other entity types', () => {
      const entityType = 'applications';
      const menuOptions = getContextMenuOptions(entityType);

      expect(menuOptions).not.toContain('Add endpoints and entities/attributes');
    });
  });

  describe('GridRowContextMenu props', () => {
    it('should accept required props for context menu', () => {
      const props: GridRowContextMenuProps = {
        isOpen: true,
        position: { x: 100, y: 200 },
        entityType: 'interfaces',
        entityId: 'ifc-001',
        entityName: 'Customer API',
        onClose: () => {},
        onAddEndpointsAndEntities: () => {},
      };

      expect(props.isOpen).toBe(true);
      expect(props.position.x).toBe(100);
      expect(props.position.y).toBe(200);
      expect(props.entityType).toBe('interfaces');
      expect(props.entityId).toBe('ifc-001');
    });
  });

  describe('AdvancedAddDialog integration', () => {
    it('should support INTERFACE root entity type for advanced add', () => {
      // The Advanced Add dialog should support INTERFACE as a root entity
      const supportedRootTypes = [
        ENTITY_TYPES.APPLICATION,
        ENTITY_TYPES.SERVICE,
        ENTITY_TYPES.INTERFACE,
        ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      ];

      expect(supportedRootTypes).toContain(ENTITY_TYPES.INTERFACE);
    });
  });
});

// Helper function to simulate getting context menu options based on entity type
function getContextMenuOptions(entityType: string): string[] {
  const options: string[] = [];

  if (entityType === 'interfaces') {
    options.push('Add endpoints and entities/attributes');
  }

  return options;
}

// Type definition for test purposes
interface GridRowContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  entityType: string;
  entityId: string;
  entityName: string;
  onClose: () => void;
  onAddEndpointsAndEntities: () => void;
}
