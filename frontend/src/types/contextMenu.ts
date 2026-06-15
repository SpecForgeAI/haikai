/**
 * TypeScript interfaces for Palette Context Menu feature
 */

/**
 * Data representing a palette item for context menu operations
 */
export interface PaletteItemData {
  id: string;
  name: string;
}

/**
 * State for the context menu (when visible)
 */
export interface ContextMenuStateData {
  visible: boolean;
  x: number;
  y: number;
  item: PaletteItemData;
  sectionId: string;
}

/**
 * Context menu state - null when hidden, ContextMenuStateData when visible
 */
export type ContextMenuState = ContextMenuStateData | null;

/**
 * Callback type for context menu actions
 */
export type ContextMenuAction = (item: PaletteItemData, sectionId: string) => void;
