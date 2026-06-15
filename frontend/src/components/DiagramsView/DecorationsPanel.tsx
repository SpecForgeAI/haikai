/**
 * DecorationsPanel Component
 * Bottom panel - cleaned up for future repurposing (Task Group 4)
 *
 * Previously contained decoration tools (Add Box, Add Line, Text Editor).
 * These have been moved to the left panel (InspectorPanel) in Task Group 3.
 *
 * Current state:
 * - Component structure remains intact
 * - Collapse/expand functionality preserved
 * - Content area shows placeholder text
 * - Ready for future repurposing
 *
 * Usage:
 * - Place below the canvas container in DiagramsView
 * - Decoration tools are now in the left panel (InspectorPanel)
 */

import styles from './DecorationsPanel.module.css';

// Decoration add mode type - kept for interface compatibility
export type DecorationAddMode = null | 'BOX' | 'LINE';

// Props interface for DecorationsPanel
// Props are kept for backward compatibility but most are no longer used
export interface DecorationsPanelProps {
  // Panel state - these are actively used
  isExpanded: boolean;
  onToggleExpanded: () => void;

  // Legacy props - kept for compatibility but no longer rendered
  // Decoration tools have moved to InspectorPanel (left panel)
  addMode?: DecorationAddMode;
  onAddModeChange?: (mode: DecorationAddMode) => void;
  selectedDecorationIds?: Set<string>;
  decorations?: unknown[];
  onUpdateDecorationText?: (decorationId: string, text: string) => void;
}

/**
 * DecorationsPanel - Bottom panel (cleaned up)
 * Task Group 4: Bottom Panel Cleanup
 *
 * Provides:
 * 1. Collapsed state: Small tab at bottom edge with expand button
 * 2. Expanded state: Panel header with close button and placeholder content
 *
 * Note: Decoration tools (Add Box, Add Line, Text Editor) are now
 * in the InspectorPanel (left panel). This panel is kept for future use.
 */
export function DecorationsPanel({
  isExpanded,
  onToggleExpanded,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addMode: _addMode,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onAddModeChange: _onAddModeChange,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  selectedDecorationIds: _selectedDecorationIds,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  decorations: _decorations,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onUpdateDecorationText: _onUpdateDecorationText,
}: DecorationsPanelProps) {
  // Render collapsed state
  if (!isExpanded) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          className={styles.toggleButton}
          onClick={onToggleExpanded}
          title="Expand panel"
        >
          <span className={styles.toggleIcon}>&#9660;</span>
          <span className={styles.toggleLabel}>Panel</span>
        </button>
      </div>
    );
  }

  // Render expanded state - now with placeholder content only
  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <h3 className={styles.headerTitle}>Panel</h3>
        <button
          className={styles.closeButton}
          onClick={onToggleExpanded}
          title="Collapse panel"
        >
          <span className={styles.closeIcon}>&#9650;</span>
        </button>
      </div>

      {/* Content - placeholder for future use */}
      <div className={styles.content}>
        <div className={styles.placeholder}>
          <span className={styles.placeholderText}>
            This panel is available for future features
          </span>
        </div>
      </div>
    </div>
  );
}
