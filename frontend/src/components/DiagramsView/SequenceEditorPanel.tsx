/**
 * SequenceEditorPanel Component
 * Task Group 7: Tabbed panel for editing Sequence diagrams using typedContent
 *
 * This component replaces the standard PalettePanel when a Sequence diagram is active.
 * It provides tabs for managing Participants and Flow (Messages + Fragments).
 *
 * Task Group 7 Changes:
 * - Now receives activeDiagram directly instead of sequenceDiagramId
 * - Reads sequence data from activeDiagram.typedContent.content
 * - Persists changes via onUpdateDiagram callback (not /api/sequence-diagrams/*)
 * - No 404 errors on new diagrams - typedContent always exists
 *
 * Features:
 * - Two tabs: "Participants" and "Flow"
 * - Header with "Saving..." indicator during autosave
 * - Collapsible panel matching PalettePanel behavior
 * - Integration with useSequenceDiagram hook for state management
 */

import { useState, useCallback } from 'react';
import { Diagram, MetaModel } from '../../types/model';
import { useSequenceDiagram } from '../../hooks/useSequenceDiagram';
import { ParticipantsTab } from './SequenceEditor/ParticipantsTab';
import { FlowTab } from './SequenceEditor/FlowTab';
import styles from './SequenceEditorPanel.module.css';

// Tab constants
export const SEQUENCE_EDITOR_TABS = {
  PARTICIPANTS: 'Participants',
  FLOW: 'Flow',
} as const;

export type SequenceEditorTab = typeof SEQUENCE_EDITOR_TABS[keyof typeof SEQUENCE_EDITOR_TABS];

// Props interface
export interface SequenceEditorPanelProps {
  /** The active Sequence diagram to edit (Task Group 7: now passes full diagram) */
  activeDiagram: Diagram | null;
  /** Callback to update the diagram (for typedContent persistence) */
  onUpdateDiagram: (updates: Partial<Diagram>) => void;
  /** Whether the panel is collapsed */
  isCollapsed: boolean;
  /** Callback to toggle panel collapse state */
  onToggleCollapse: () => void;
  /** The meta-model for entity resolution */
  metaModel: MetaModel | null;
}

/**
 * SequenceEditorPanel - Tabbed editor for Sequence diagrams
 *
 * Task Group 7: Updated to read from activeDiagram.typedContent instead of
 * calling /api/sequence-diagrams/{id}. Changes are persisted via onUpdateDiagram.
 */
export function SequenceEditorPanel({
  activeDiagram,
  onUpdateDiagram,
  isCollapsed,
  onToggleCollapse,
  metaModel,
}: SequenceEditorPanelProps) {
  // Active tab state
  const [activeTab, setActiveTab] = useState<SequenceEditorTab>(SEQUENCE_EDITOR_TABS.PARTICIPANTS);

  // Use the sequence diagram hook for data management
  // Task Group 7: Now passes activeDiagram and onUpdateDiagram instead of sequenceDiagramId
  const {
    sequenceDiagram,
    isLoading,
    isSaving,
    isDirty: _isDirty, // Prefixed with underscore to suppress unused warning - will be used in future
    error,
    updateSequenceDiagram,
  } = useSequenceDiagram(activeDiagram, onUpdateDiagram);

  // Handle tab switching
  const handleTabClick = useCallback((tab: SequenceEditorTab) => {
    setActiveTab(tab);
  }, []);

  // Render collapsed state
  if (isCollapsed) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          className={styles.toggleButton}
          onClick={onToggleCollapse}
          title="Expand Sequence Editor"
        >
          {'<'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="sequence-editor-panel">
      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.toggleButton}
          onClick={onToggleCollapse}
          title="Collapse Sequence Editor"
        >
          {'>'}
        </button>
        <h3 className={styles.title}>Sequence Editor</h3>
        {isSaving && (
          <span className={styles.savingIndicator} data-testid="saving-indicator">Saving...</span>
        )}
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tab} ${activeTab === SEQUENCE_EDITOR_TABS.PARTICIPANTS ? styles.tabActive : ''}`}
          onClick={() => handleTabClick(SEQUENCE_EDITOR_TABS.PARTICIPANTS)}
          data-testid="participants-tab"
        >
          {SEQUENCE_EDITOR_TABS.PARTICIPANTS}
        </button>
        <button
          className={`${styles.tab} ${activeTab === SEQUENCE_EDITOR_TABS.FLOW ? styles.tabActive : ''}`}
          onClick={() => handleTabClick(SEQUENCE_EDITOR_TABS.FLOW)}
          data-testid="flow-tab"
        >
          {SEQUENCE_EDITOR_TABS.FLOW}
        </button>
      </div>

      {/* Tab Content */}
      <div className={styles.tabContent}>
        {/* Loading State */}
        {isLoading && (
          <div className={styles.emptyState}>
            Loading sequence diagram...
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className={styles.emptyState}>
            Error: {error}
          </div>
        )}

        {/* No Diagram Selected */}
        {!activeDiagram && !isLoading && !error && (
          <div className={styles.emptyState}>
            No sequence diagram selected
          </div>
        )}

        {/* Participants Tab Content - Using actual ParticipantsTab component */}
        {!isLoading && !error && sequenceDiagram && activeTab === SEQUENCE_EDITOR_TABS.PARTICIPANTS && (
          <ParticipantsTab
            sequenceDiagram={sequenceDiagram}
            onUpdate={updateSequenceDiagram}
            metaModel={metaModel}
          />
        )}

        {/* Flow Tab Content - Using actual FlowTab component (Task Group 4) */}
        {!isLoading && !error && sequenceDiagram && activeTab === SEQUENCE_EDITOR_TABS.FLOW && (
          <FlowTab
            sequenceDiagram={sequenceDiagram}
            onUpdate={updateSequenceDiagram}
            metaModel={metaModel}
          />
        )}
      </div>
    </div>
  );
}

export default SequenceEditorPanel;
