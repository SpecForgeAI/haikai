/**
 * UIScreenDiagramEditorPanel Component
 *
 * Main editor panel for UI_SCREEN diagrams.
 * Provides a tabbed interface with Overview, Components, Actions, and Raw DSL tabs.
 *
 * Task Group 6: Wiring AddComponentModal and AddActionModal to ComponentsTab and ActionsTab
 *
 * Task Group 1: Wire Props from EditorPanel to OverviewTab
 * - Added handleScreenIdChange callback that calls setScreenId from hook
 * - Pass uiScreensList, content.screen_id, and handleScreenIdChange to OverviewTab
 *
 * Follows the same pattern as SequenceEditorPanel.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Diagram, MetaModel, UIScreen } from '../../types/model';
import { UIScreenComponentRef, UIScreenActionRef } from '../../types/typedContent';
import { useUIScreenDiagram } from '../../hooks/useUIScreenDiagram';
import { OverviewTab, ComponentsTab, ActionsTab, RawDSLTab } from './UIScreenEditor';
import { AddComponentModal } from './UIScreenEditor/modals/AddComponentModal';
import { AddActionModal } from './UIScreenEditor/modals/AddActionModal';

/**
 * Tab type for the editor panel
 */
type EditorTab = 'overview' | 'components' | 'actions' | 'rawDsl';

interface UIScreenDiagramEditorPanelProps {
  /** The current diagram */
  diagram: Diagram;
  /** Callback to update the diagram */
  onUpdateDiagram: (diagramId: string, updates: Partial<Diagram>) => void;
  /** Map of UIScreen entities (id -> entity) */
  uiScreens?: Map<string, { name: string; route?: string }>;
  /** Map of UIComponent entities (id -> entity) */
  uiComponents?: Map<string, { name: string; component_type: string }>;
  /** Map of UIAction entities (id -> entity) */
  uiActions?: Map<string, { name: string; trigger_type: string; effect_type: string; description?: string }>;
  /** Meta model for entity lookups (Task Group 6) */
  metaModel?: MetaModel | null;
}

/**
 * UIScreenDiagramEditorPanel - Main editor panel for UI_SCREEN diagrams
 */
export const UIScreenDiagramEditorPanel: React.FC<UIScreenDiagramEditorPanelProps> = ({
  diagram,
  onUpdateDiagram,
  uiScreens = new Map(),
  uiComponents = new Map(),
  uiActions = new Map(),
  metaModel = null,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('overview');

  // Task Group 6: Modal state management
  const [isAddComponentModalOpen, setIsAddComponentModalOpen] = useState(false);
  const [isAddActionModalOpen, setIsAddActionModalOpen] = useState(false);

  // Use the UI screen diagram hook for state management
  const {
    content,
    setScreenId,
    addComponent,
    removeComponent,
    addAction,
    removeAction,
    setContent,
    isDirty,
    saveNow,
  } = useUIScreenDiagram({
    diagram,
    onUpdateDiagram,
  });

  // Get screen details
  const screenDetails = useMemo(() => {
    if (!content.screen_id) return null;
    return uiScreens.get(content.screen_id);
  }, [content.screen_id, uiScreens]);

  // Create component names and types maps
  const componentNames = useMemo(() => {
    const map = new Map<string, string>();
    uiComponents.forEach((comp, id) => {
      map.set(id, comp.name);
    });
    return map;
  }, [uiComponents]);

  const componentTypes = useMemo(() => {
    const map = new Map<string, string>();
    uiComponents.forEach((comp, id) => {
      map.set(id, comp.component_type);
    });
    return map;
  }, [uiComponents]);

  // Create action details map
  const actionDetails = useMemo(() => {
    const map = new Map<string, { name: string; trigger_type: string; effect_type: string; description?: string }>();
    uiActions.forEach((action, id) => {
      map.set(id, action);
    });
    return map;
  }, [uiActions]);

  // Task Group 6: Get UI Screens list for AddActionModal NAVIGATE picker
  // Task Group 1: Also used for OverviewTab dropdown
  const uiScreensList = useMemo((): UIScreen[] => {
    if (!metaModel) return [];
    return metaModel.entities.ui_screens || [];
  }, [metaModel]);

  /**
   * Task Group 1: Handle screen_id change from OverviewTab dropdown
   * This callback wraps setScreenId from the useUIScreenDiagram hook
   */
  const handleScreenIdChange = useCallback(
    (screenId: string | null) => {
      setScreenId(screenId);
    },
    [setScreenId]
  );

  /**
   * Handle tab change
   */
  const handleTabChange = useCallback((tab: EditorTab) => {
    setActiveTab(tab);
  }, []);

  /**
   * Task Group 6: Handle opening AddComponentModal
   */
  const handleOpenAddComponentModal = useCallback(() => {
    setIsAddComponentModalOpen(true);
  }, []);

  /**
   * Task Group 6: Handle closing AddComponentModal
   */
  const handleCloseAddComponentModal = useCallback(() => {
    setIsAddComponentModalOpen(false);
  }, []);

  /**
   * Task Group 6: Handle adding component from modal
   */
  const handleAddComponent = useCallback((componentRef: UIScreenComponentRef) => {
    addComponent(componentRef);
    setIsAddComponentModalOpen(false);
  }, [addComponent]);

  /**
   * Task Group 6: Handle opening AddActionModal
   */
  const handleOpenAddActionModal = useCallback(() => {
    setIsAddActionModalOpen(true);
  }, []);

  /**
   * Task Group 6: Handle closing AddActionModal
   */
  const handleCloseAddActionModal = useCallback(() => {
    setIsAddActionModalOpen(false);
  }, []);

  /**
   * Task Group 6: Handle adding action from modal
   */
  const handleAddAction = useCallback((actionRef: UIScreenActionRef) => {
    addAction(actionRef);
    setIsAddActionModalOpen(false);
  }, [addAction]);

  /**
   * Tab button style helper
   */
  const getTabStyle = (tab: EditorTab): React.CSSProperties => ({
    padding: '8px 16px',
    background: activeTab === tab ? '#1976d2' : 'transparent',
    color: activeTab === tab ? 'white' : '#666',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #1976d2' : '2px solid transparent',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: activeTab === tab ? 600 : 400,
    transition: 'all 0.2s',
  });

  return (
    <div
      className="ui-screen-diagram-editor-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'white',
        border: '1px solid #e0e0e0',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid #e0e0e0',
          background: '#fafafa',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '14px' }}>
          UI Screen Editor
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isDirty && (
            <span style={{ fontSize: '12px', color: '#f57c00' }}>
              Unsaved changes
            </span>
          )}
          <button
            onClick={saveNow}
            disabled={!isDirty}
            style={{
              padding: '4px 12px',
              background: isDirty ? '#1976d2' : '#e0e0e0',
              color: isDirty ? 'white' : '#999',
              border: 'none',
              borderRadius: '4px',
              cursor: isDirty ? 'pointer' : 'not-allowed',
              fontSize: '12px',
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #e0e0e0',
          background: '#fafafa',
        }}
      >
        <button
          onClick={() => handleTabChange('overview')}
          style={getTabStyle('overview')}
        >
          Overview
        </button>
        <button
          onClick={() => handleTabChange('components')}
          style={getTabStyle('components')}
        >
          Components ({content.components.length})
        </button>
        <button
          onClick={() => handleTabChange('actions')}
          style={getTabStyle('actions')}
        >
          Actions ({content.actions.length})
        </button>
        <button
          onClick={() => handleTabChange('rawDsl')}
          style={getTabStyle('rawDsl')}
        >
          Raw DSL
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'overview' && (
          <OverviewTab
            content={content}
            screenName={screenDetails?.name}
            screenRoute={screenDetails?.route}
            uiScreens={uiScreensList}
            selectedScreenId={content.screen_id}
            onSelectScreenId={handleScreenIdChange}
          />
        )}
        {activeTab === 'components' && (
          <ComponentsTab
            components={content.components}
            componentNames={componentNames}
            componentTypes={componentTypes}
            onAddComponent={handleOpenAddComponentModal}
            onRemoveComponent={removeComponent}
          />
        )}
        {activeTab === 'actions' && (
          <ActionsTab
            actions={content.actions}
            actionDetails={actionDetails}
            metaModel={metaModel}
            onAddAction={handleOpenAddActionModal}
            onRemoveAction={removeAction}
          />
        )}
        {activeTab === 'rawDsl' && (
          <RawDSLTab
            content={content}
            onContentChange={setContent}
          />
        )}
      </div>

      {/* Task Group 6: AddComponentModal */}
      <AddComponentModal
        isOpen={isAddComponentModalOpen}
        onClose={handleCloseAddComponentModal}
        onAdd={handleAddComponent}
      />

      {/* Task Group 6: AddActionModal */}
      <AddActionModal
        isOpen={isAddActionModalOpen}
        onClose={handleCloseAddActionModal}
        onAdd={handleAddAction}
        metaModel={metaModel}
        uiScreens={uiScreensList}
      />
    </div>
  );
};

export default UIScreenDiagramEditorPanel;
