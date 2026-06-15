import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { PaletteItemData, ContextMenuAction } from '../../types/contextMenu';
import { hasExpandableRelationships } from '../../utils/advancedAddRelationships';
import { getEntityTypeConstant } from '../../utils/paletteData';
import styles from './PaletteContextMenu.module.css';

interface PaletteContextMenuProps {
  x: number;
  y: number;
  item: PaletteItemData;
  sectionId: string;
  isOnDiagram: boolean;
  // Item type (entity or relationship)
  itemType?: 'entity' | 'relationship';
  // For relationships: whether the relationship can be added
  isRelationshipEnabled?: boolean;
  // Standardise User Interaction Palette UI: Action type for relationship items (add or delete)
  action?: 'add' | 'delete';
  onAdd: ContextMenuAction;
  onAddRelationship?: ContextMenuAction;
  // Standardise User Interaction Palette UI: Handler for deleting relationship (User Interactions)
  onDeleteRelationship?: ContextMenuAction;
  onDelete: ContextMenuAction;
  onAddWithBusinessProcesses: ContextMenuAction;
  onAddWithAppComponents: ContextMenuAction;
  onAddWithProcessActivities: ContextMenuAction;
  // Advanced Add action - opens the Advanced Add dialog
  onAdvancedAdd?: ContextMenuAction;
  // Task Group 3: Add with attributes action for data entities (ERD-style rendering)
  onAddWithAttributes?: ContextMenuAction;
  // Add with all children action for interfaces (endpoints + logical entities)
  onAddWithAllChildren?: ContextMenuAction;
  onClose: () => void;
}

export function PaletteContextMenu({
  x,
  y,
  item,
  sectionId,
  isOnDiagram,
  itemType = 'entity',
  isRelationshipEnabled = false,
  action = 'add',
  onAdd,
  onAddRelationship,
  onDeleteRelationship,
  onDelete,
  onAddWithBusinessProcesses,
  onAddWithAppComponents,
  onAddWithProcessActivities,
  onAdvancedAdd,
  onAddWithAttributes,
  onAddWithAllChildren,
  onClose,
}: PaletteContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Calculate position, clamping to viewport edges
  const getClampedPosition = () => {
    const menuWidth = 180; // min-width from CSS
    const menuHeight = 220; // increased for Add with attributes option
    const padding = 5;

    let posX = x;
    let posY = y;

    // Clamp to right edge
    if (posX + menuWidth > window.innerWidth - padding) {
      posX = window.innerWidth - menuWidth - padding;
    }

    // Clamp to bottom edge
    if (posY + menuHeight > window.innerHeight - padding) {
      posY = window.innerHeight - menuHeight - padding;
    }

    // Clamp to left edge
    if (posX < padding) {
      posX = padding;
    }

    // Clamp to top edge
    if (posY < padding) {
      posY = padding;
    }

    return { posX, posY };
  };

  const { posX, posY } = getClampedPosition();

  // Auto-dismiss on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Add listener with slight delay to prevent immediate dismiss
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Auto-dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Handle menu item click
  const handleMenuItemClick = (action: ContextMenuAction) => {
    action(item, sectionId);
    onClose();
  };

  // Stop propagation on menu clicks
  const handleMenuClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  // Determine if this is an APPLICATION item (for extended options)
  const isApplicationItem = sectionId === 'applications';

  // Determine if this is a BUSINESS_PROCESS item (for process activities option)
  const isBusinessProcessItem = sectionId === 'business_processes';

  // Task Group 3: Determine if this is a data entity item (for "Add with attributes" option)
  const isDataEntityItem = sectionId === 'logical_data_entities' || sectionId === 'physical_data_entities';

  // Check if "Advanced Add..." should be shown
  // Only visible for entity types that have at least one expandable relationship
  const entityType = getEntityTypeConstant(sectionId);
  const showAdvancedAdd = hasExpandableRelationships(entityType) && onAdvancedAdd;

  // Task Group 3: Check if "Add with attributes" should be shown
  const showAddWithAttributes = isDataEntityItem && onAddWithAttributes;

  // Check if this is an INTERFACE item (for "Add with all children" option)
  const isInterfaceItem = sectionId === 'interfaces';
  const showAddWithAllChildren = isInterfaceItem && onAddWithAllChildren;

  // Render entity context menu
  const renderEntityMenu = () => (
    <>
      {/* Base options */}
      {!isOnDiagram && (
        <div
          className={styles.menuItem}
          onClick={() => handleMenuItemClick(onAdd)}
          data-testid="context-menu-add"
        >
          Add
        </div>
      )}
      {isOnDiagram && (
        <div
          className={styles.menuItem}
          onClick={() => handleMenuItemClick(onDelete)}
          data-testid="context-menu-delete"
        >
          Delete
        </div>
      )}

      {/* Extended options for APPLICATION items */}
      {isApplicationItem && (
        <>
          <div className={styles.separator} />
          <div
            className={styles.menuItem}
            onClick={() => handleMenuItemClick(onAddWithBusinessProcesses)}
            data-testid="context-menu-add-with-bp"
          >
            Add with business processes
          </div>
          <div
            className={styles.menuItem}
            onClick={() => handleMenuItemClick(onAddWithAppComponents)}
            data-testid="context-menu-add-with-ac"
          >
            Add with app components
          </div>
        </>
      )}

      {/* Extended options for BUSINESS_PROCESS items */}
      {isBusinessProcessItem && (
        <>
          <div className={styles.separator} />
          <div
            className={styles.menuItem}
            onClick={() => handleMenuItemClick(onAddWithProcessActivities)}
            data-testid="context-menu-add-with-pa"
          >
            Add with process activities
          </div>
        </>
      )}

      {/* Task Group 3: "Add with attributes" option for data entities (ERD-style) */}
      {showAddWithAttributes && (
        <>
          <div className={styles.separator} />
          <div
            className={styles.menuItem}
            onClick={() => handleMenuItemClick(onAddWithAttributes)}
            data-testid="context-menu-add-with-attributes"
          >
            Add with attributes
          </div>
        </>
      )}

      {/* "Add with all children" option for interfaces (endpoints + logical entities) */}
      {showAddWithAllChildren && (
        <>
          <div className={styles.separator} />
          <div
            className={styles.menuItem}
            onClick={() => handleMenuItemClick(onAddWithAllChildren)}
            data-testid="context-menu-add-with-all-children"
          >
            Add with all children
          </div>
        </>
      )}

      {/* Advanced Add option - shown for entity types with expandable relationships */}
      {showAdvancedAdd && (
        <>
          <div className={styles.separator} />
          <div
            className={styles.menuItem}
            onClick={() => handleMenuItemClick(onAdvancedAdd)}
            data-testid="context-menu-advanced-add"
          >
            Advanced Add...
          </div>
        </>
      )}
    </>
  );

  // Render relationship context menu
  // Standardise User Interaction Palette UI: Dynamic Add/Delete based on action prop
  const renderRelationshipMenu = () => {
    const isDeleteAction = action === 'delete';

    const handleActionClick = () => {
      if (!isRelationshipEnabled) return;

      if (isDeleteAction && onDeleteRelationship) {
        handleMenuItemClick(onDeleteRelationship);
      } else if (onAddRelationship) {
        handleMenuItemClick(onAddRelationship);
      }
    };

    const menuLabel = isDeleteAction ? 'Delete' : 'Add';
    const menuTitle = !isRelationshipEnabled
      ? 'Both endpoints must be on diagram'
      : isDeleteAction
        ? 'Delete relationship from diagram'
        : 'Add relationship to diagram';

    return (
      <>
        <div
          className={`${styles.menuItem} ${!isRelationshipEnabled ? styles.menuItemDisabled : ''}`}
          onClick={handleActionClick}
          data-testid={isDeleteAction ? 'context-menu-delete-relationship' : 'context-menu-add-relationship'}
          title={menuTitle}
        >
          {menuLabel}
        </div>
      </>
    );
  };

  const menuContent = (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{
        left: posX,
        top: posY,
      }}
      onClick={handleMenuClick}
      data-testid="palette-context-menu"
    >
      {itemType === 'entity' ? renderEntityMenu() : renderRelationshipMenu()}
    </div>
  );

  // Render using portal to body for proper z-index stacking
  return ReactDOM.createPortal(menuContent, document.body);
}
