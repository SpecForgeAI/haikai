/**
 * ElementContextMenu Component
 *
 * Task Group 3: Create Element Context Menu Component
 * Right-click context menu for canvas elements (nodes, edges, decorations)
 * Provides auto-size toggle and z-index controls
 */

import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { ElementContextMenuType } from '../../types/model';
import styles from './ElementContextMenu.module.css';

// Z-index action types
export type ZIndexAction = 'bring-forward' | 'send-backward' | 'bring-to-front' | 'send-to-back';

interface ElementContextMenuProps {
  /** Whether the menu is visible */
  visible: boolean;
  /** X coordinate (screen position) of the menu */
  x: number;
  /** Y coordinate (screen position) of the menu */
  y: number;
  /** Type of element being right-clicked */
  elementType: ElementContextMenuType;
  /** ID of the element being right-clicked */
  elementId: string;
  /** Current auto_size value (only for nodes and shape decorations) */
  currentAutoSize?: boolean;
  /** Whether the element currently has a link */
  currentLinkedDiagramId?: string;
  /** Handler for closing the menu */
  onClose: () => void;
  /** Handler for toggling auto-size */
  onAutoSizeToggle: (elementId: string, newValue: boolean) => void;
  /** Handler for z-index changes */
  onZIndexChange: (elementId: string, action: ZIndexAction) => void;
  /** Handler for "Link" menu item click */
  onLink: (elementId: string) => void;
  /** Handler for "Unlink" menu item click */
  onUnlink: (elementId: string) => void;
  /** Whether to show the "Advanced Edit" menu item */
  showAdvancedEdit?: boolean;
  /** Handler for "Advanced Edit" menu item click */
  onAdvancedEdit?: (elementId: string) => void;
  /** Handler for "Reset Edge" menu item click (edges only) */
  onEdgeReset?: (edgeId: string) => void;
  /** Whether copy is available (something is selected) */
  copyEnabled?: boolean;
  /** Whether paste is available (clipboard has content) */
  pasteEnabled?: boolean;
  /** Whether undo is available (history has entries) */
  undoEnabled?: boolean;
  /** Handler for "Copy" menu item click */
  onCopy?: () => void;
  /** Handler for "Paste" menu item click */
  onPaste?: () => void;
  /** Handler for "Undo" menu item click */
  onUndo?: () => void;
}

/**
 * Check if element type supports auto-size toggle
 * Only nodes and shape decorations have auto-size
 */
function supportsAutoSize(elementType: ElementContextMenuType): boolean {
  return elementType === 'node' || elementType === 'shape-decoration';
}

/**
 * Get the label for the auto-size toggle based on current state
 */
function getAutoSizeLabel(currentAutoSize: boolean | undefined): string {
  return currentAutoSize ? 'Disable Auto-Size' : 'Enable Auto-Size';
}

/**
 * Calculate clamped position to keep menu within viewport
 */
function getClampedPosition(x: number, y: number): { posX: number; posY: number } {
  const menuWidth = 160; // min-width from CSS
  const menuHeight = 180; // estimated height for 5 items
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
}

export function ElementContextMenu({
  visible,
  x,
  y,
  elementType,
  elementId,
  currentAutoSize,
  currentLinkedDiagramId,
  onClose,
  onAutoSizeToggle,
  onZIndexChange,
  onLink,
  onUnlink,
  showAdvancedEdit,
  onAdvancedEdit,
  onEdgeReset,
  copyEnabled,
  pasteEnabled,
  undoEnabled,
  onCopy,
  onPaste,
  onUndo,
}: ElementContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss on outside click
  useEffect(() => {
    if (!visible) return;

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
  }, [visible, onClose]);

  // Auto-dismiss on Escape key
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose]);

  // Don't render if not visible
  if (!visible) {
    return null;
  }

  const { posX, posY } = getClampedPosition(x, y);

  // Handle auto-size toggle click
  const handleAutoSizeClick = () => {
    onAutoSizeToggle(elementId, !currentAutoSize);
    onClose();
  };

  // Handle z-index action click
  const handleZIndexClick = (action: ZIndexAction) => {
    onZIndexChange(elementId, action);
    onClose();
  };

  // Handle link click
  const handleLinkClick = () => {
    onLink(elementId);
    onClose();
  };

  // Handle unlink click
  const handleUnlinkClick = () => {
    onUnlink(elementId);
    onClose();
  };

  // Handle advanced edit click
  const handleAdvancedEditClick = () => {
    if (onAdvancedEdit) onAdvancedEdit(elementId);
    onClose();
  };

  // Handle edge reset click
  const handleEdgeResetClick = () => {
    if (onEdgeReset) onEdgeReset(elementId);
    onClose();
  };

  // Handle copy click
  const handleCopyClick = () => {
    if (onCopy) onCopy();
    onClose();
  };

  // Handle paste click
  const handlePasteClick = () => {
    if (onPaste) onPaste();
    onClose();
  };

  // Handle undo click
  const handleUndoClick = () => {
    if (onUndo) onUndo();
    onClose();
  };

  // Stop propagation on menu clicks
  const handleMenuClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  const showAutoSize = supportsAutoSize(elementType);

  const menuContent = (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{
        left: posX,
        top: posY,
      }}
      onClick={handleMenuClick}
      onContextMenu={handleMenuClick}
      data-testid="element-context-menu"
    >
      {/* Undo */}
      <div
        className={undoEnabled ? styles.menuItem : styles.menuItemDisabled}
        onClick={undoEnabled ? handleUndoClick : undefined}
        data-testid="context-menu-undo"
      >
        Undo
      </div>
      <div className={styles.separator} />

      {/* Copy/Paste */}
      <div
        className={copyEnabled ? styles.menuItem : styles.menuItemDisabled}
        onClick={copyEnabled ? handleCopyClick : undefined}
        data-testid="context-menu-copy"
      >
        Copy
      </div>
      <div
        className={pasteEnabled ? styles.menuItem : styles.menuItemDisabled}
        onClick={pasteEnabled ? handlePasteClick : undefined}
        data-testid="context-menu-paste"
      >
        Paste
      </div>
      <div className={styles.separator} />

      {/* Auto-size toggle (only for nodes and shape decorations) */}
      {showAutoSize && (
        <>
          <div
            className={styles.menuItem}
            onClick={handleAutoSizeClick}
            data-testid="context-menu-auto-size"
          >
            {getAutoSizeLabel(currentAutoSize)}
          </div>
          <div className={styles.separator} />
        </>
      )}

      {/* Link/Unlink controls */}
      <div
        className={styles.menuItem}
        onClick={handleLinkClick}
        data-testid="context-menu-link"
      >
        Link
      </div>
      {currentLinkedDiagramId && (
        <div
          className={styles.menuItem}
          onClick={handleUnlinkClick}
          data-testid="context-menu-unlink"
        >
          Unlink
        </div>
      )}
      <div className={styles.separator} />

      {/* Advanced Edit (only for supported node types) */}
      {showAdvancedEdit && (
        <>
          <div
            className={styles.menuItem}
            onClick={handleAdvancedEditClick}
            data-testid="context-menu-advanced-edit"
          >
            Advanced Edit
          </div>
          <div className={styles.separator} />
        </>
      )}

      {/* Reset Edge (only for edges) */}
      {elementType === 'edge' && onEdgeReset && (
        <>
          <div
            className={styles.menuItem}
            onClick={handleEdgeResetClick}
            data-testid="context-menu-reset-edge"
          >
            Reset Edge
          </div>
          <div className={styles.separator} />
        </>
      )}

      {/* Z-index controls */}
      <div
        className={styles.menuItem}
        onClick={() => handleZIndexClick('bring-forward')}
        data-testid="context-menu-bring-forward"
      >
        Bring Forward
      </div>
      <div
        className={styles.menuItem}
        onClick={() => handleZIndexClick('send-backward')}
        data-testid="context-menu-send-backward"
      >
        Send Backward
      </div>
      <div className={styles.separator} />
      <div
        className={styles.menuItem}
        onClick={() => handleZIndexClick('bring-to-front')}
        data-testid="context-menu-bring-to-front"
      >
        Bring to Front
      </div>
      <div
        className={styles.menuItem}
        onClick={() => handleZIndexClick('send-to-back')}
        data-testid="context-menu-send-to-back"
      >
        Send to Back
      </div>
    </div>
  );

  // Render using portal to body for proper z-index stacking
  return ReactDOM.createPortal(menuContent, document.body);
}
