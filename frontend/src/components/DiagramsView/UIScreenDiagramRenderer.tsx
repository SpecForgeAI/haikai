/**
 * UIScreenDiagramRenderer Component
 *
 * Non-canvas structured preview renderer for UI_SCREEN diagrams.
 * Displays the screen header, component tree, and actions list.
 *
 * This is a read-only visualization of the UI screen specification.
 * Follows the same pattern as SequenceDiagramRenderer.
 */

import React, { useMemo } from 'react';
import { Diagram } from '../../types/model';
import {
  UIScreenContent,
  UIScreenComponentRef,
  UIScreenActionRef,
  createDefaultUIScreenContent,
} from '../../types/typedContent';

interface UIScreenDiagramRendererProps {
  /** The diagram to render */
  diagram: Diagram;
  /** Map of UIScreen entities (id -> entity) */
  uiScreens?: Map<string, { name: string; route?: string; description?: string }>;
  /** Map of UIComponent entities (id -> entity) */
  uiComponents?: Map<string, { name: string; component_type: string; description?: string }>;
  /** Map of UIAction entities (id -> entity) */
  uiActions?: Map<string, { name: string; trigger_type: string; effect_type: string; description?: string }>;
}

/**
 * Extract UIScreenContent from diagram
 */
function extractContent(diagram: Diagram): UIScreenContent {
  if (!diagram.typed_content || diagram.typed_content.type !== 'UI_SCREEN') {
    return createDefaultUIScreenContent();
  }
  return diagram.typed_content.content as UIScreenContent;
}

/**
 * Get icon for component type
 */
function getComponentIcon(componentType: string): string {
  switch (componentType?.toUpperCase()) {
    case 'PAGE_LAYOUT':
      return '[ ]';
    case 'FORM':
      return '[=]';
    case 'TABLE':
      return '[#]';
    case 'MODAL':
      return '[*]';
    case 'NAV':
      return '[>]';
    case 'CARD':
      return '[+]';
    case 'DETAILS':
      return '[i]';
    default:
      return '[?]';
  }
}

/**
 * Get color for component type
 */
function getComponentColor(componentType: string): string {
  switch (componentType?.toUpperCase()) {
    case 'PAGE_LAYOUT':
      return '#1565c0';
    case 'FORM':
      return '#2e7d32';
    case 'TABLE':
      return '#5e35b1';
    case 'MODAL':
      return '#ef6c00';
    case 'NAV':
      return '#00838f';
    case 'CARD':
      return '#6d4c41';
    case 'DETAILS':
      return '#546e7a';
    default:
      return '#757575';
  }
}

/**
 * Get badge for action trigger type
 */
function getTriggerBadge(triggerType: string): { label: string; color: string } {
  switch (triggerType?.toUpperCase()) {
    case 'CLICK':
      return { label: 'Click', color: '#1976d2' };
    case 'SUBMIT':
      return { label: 'Submit', color: '#388e3c' };
    case 'CHANGE':
      return { label: 'Change', color: '#f57c00' };
    case 'LOAD':
      return { label: 'Load', color: '#7b1fa2' };
    case 'NAVIGATE':
      return { label: 'Navigate', color: '#0288d1' };
    case 'CUSTOM':
      return { label: 'Custom', color: '#757575' };
    default:
      return { label: triggerType || 'Unknown', color: '#757575' };
  }
}

/**
 * Get badge for action effect type
 */
function getEffectBadge(effectType: string): { label: string; color: string } {
  switch (effectType?.toUpperCase()) {
    case 'NAVIGATE':
      return { label: 'Navigate', color: '#0288d1' };
    case 'CALL_API':
      return { label: 'API Call', color: '#388e3c' };
    case 'SET_STATE':
      return { label: 'Set State', color: '#7b1fa2' };
    case 'OPEN_MODAL':
      return { label: 'Open Modal', color: '#ef6c00' };
    case 'CLOSE_MODAL':
      return { label: 'Close Modal', color: '#795548' };
    case 'VALIDATE':
      return { label: 'Validate', color: '#1976d2' };
    case 'CUSTOM':
      return { label: 'Custom', color: '#757575' };
    default:
      return { label: effectType || 'Unknown', color: '#757575' };
  }
}

/**
 * ComponentTreeItem - Renders a single component in the tree
 */
const ComponentTreeItem: React.FC<{
  componentRef: UIScreenComponentRef;
  componentInfo?: { name: string; component_type: string; description?: string };
  level: number;
}> = ({ componentRef, componentInfo, level }) => {
  const name = componentInfo?.name || componentRef.component_id;
  const type = componentInfo?.component_type || 'CUSTOM';
  const icon = getComponentIcon(type);
  const color = getComponentColor(type);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        paddingLeft: `${12 + level * 20}px`,
        borderBottom: '1px solid #f0f0f0',
        background: level % 2 === 0 ? 'white' : '#fafafa',
      }}
    >
      <span
        style={{
          fontFamily: 'monospace',
          marginRight: '8px',
          color: color,
          fontWeight: 600,
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 500, flex: 1 }}>{name}</span>
      <span
        style={{
          padding: '2px 8px',
          background: color,
          color: 'white',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 500,
        }}
      >
        {type}
      </span>
    </div>
  );
};

/**
 * ActionItem - Renders a single action in the list
 */
const ActionItem: React.FC<{
  actionRef: UIScreenActionRef;
  actionInfo?: { name: string; trigger_type: string; effect_type: string; description?: string };
}> = ({ actionRef, actionInfo }) => {
  const name = actionInfo?.name || actionRef.action_id;
  const triggerBadge = getTriggerBadge(actionInfo?.trigger_type || '');
  const effectBadge = getEffectBadge(actionInfo?.effect_type || '');

  return (
    <div
      style={{
        padding: '12px',
        borderBottom: '1px solid #f0f0f0',
        background: 'white',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ fontWeight: 500, flex: 1 }}>{name}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <span
            style={{
              padding: '2px 6px',
              background: triggerBadge.color,
              color: 'white',
              borderRadius: '3px',
              fontSize: '10px',
              fontWeight: 500,
            }}
          >
            {triggerBadge.label}
          </span>
          <span
            style={{
              padding: '2px 6px',
              background: effectBadge.color,
              color: 'white',
              borderRadius: '3px',
              fontSize: '10px',
              fontWeight: 500,
            }}
          >
            {effectBadge.label}
          </span>
        </div>
      </div>
      {actionInfo?.description && (
        <div style={{ fontSize: '12px', color: '#666' }}>
          {actionInfo.description}
        </div>
      )}
    </div>
  );
};

/**
 * UIScreenDiagramRenderer - Renders a UI_SCREEN diagram as structured preview
 */
export const UIScreenDiagramRenderer: React.FC<UIScreenDiagramRendererProps> = ({
  diagram,
  uiScreens = new Map(),
  uiComponents = new Map(),
  uiActions = new Map(),
}) => {
  const content = useMemo(() => extractContent(diagram), [diagram]);

  const screenInfo = useMemo(() => {
    if (!content.screen_id) return null;
    return uiScreens.get(content.screen_id);
  }, [content.screen_id, uiScreens]);

  // Build component tree (flat for now, can be nested later)
  const sortedComponents = useMemo(() => {
    return [...content.components].sort((a, b) => {
      const orderA = a.order_index ?? 0;
      const orderB = b.order_index ?? 0;
      return orderA - orderB;
    });
  }, [content.components]);

  // Sort actions by order_index
  const sortedActions = useMemo(() => {
    return [...content.actions].sort((a, b) => {
      const orderA = a.order_index ?? 0;
      const orderB = b.order_index ?? 0;
      return orderA - orderB;
    });
  }, [content.actions]);

  return (
    <div
      className="ui-screen-diagram-renderer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        background: '#f5f5f5',
        padding: '16px',
      }}
    >
      {/* Screen Header */}
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '8px',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              background: '#e3f2fd',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '12px',
            }}
          >
            <span style={{ fontSize: '20px' }}>[ ]</span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              {screenInfo?.name || diagram.name || 'Unnamed Screen'}
            </h2>
            {screenInfo?.route && (
              <div style={{ fontSize: '13px', color: '#666', fontFamily: 'monospace' }}>
                {screenInfo.route}
              </div>
            )}
          </div>
        </div>
        {screenInfo?.description && (
          <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: '#666' }}>
            {screenInfo.description}
          </p>
        )}
        {!content.screen_id && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px 12px',
              background: '#fff3e0',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#e65100',
            }}
          >
            No screen entity linked. Edit the diagram to associate a UIScreen.
          </div>
        )}
      </div>

      {/* Components Section */}
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            background: '#e3f2fd',
            borderBottom: '1px solid #bbdefb',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#1565c0' }}>
            Components ({sortedComponents.length})
          </h3>
        </div>
        {sortedComponents.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#999',
              fontSize: '13px',
            }}
          >
            No components defined for this screen.
          </div>
        ) : (
          <div>
            {sortedComponents.map((comp) => (
              <ComponentTreeItem
                key={comp.id}
                componentRef={comp}
                componentInfo={uiComponents.get(comp.component_id)}
                level={comp.parent_ref_id ? 1 : 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Actions Section */}
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            background: '#e8f5e9',
            borderBottom: '1px solid #c8e6c9',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#2e7d32' }}>
            Actions ({sortedActions.length})
          </h3>
        </div>
        {sortedActions.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#999',
              fontSize: '13px',
            }}
          >
            No actions defined for this screen.
          </div>
        ) : (
          <div>
            {sortedActions.map((action) => (
              <ActionItem
                key={action.id}
                actionRef={action}
                actionInfo={uiActions.get(action.action_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UIScreenDiagramRenderer;
