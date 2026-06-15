/**
 * ComponentsTab Component
 *
 * Displays and manages component references for a UI_SCREEN diagram.
 * Shows a list of components with their types and allows editing.
 */

import React from 'react';
import { UIScreenComponentRef } from '../../../types/typedContent';

interface ComponentsTabProps {
  components: UIScreenComponentRef[];
  /** Map of component IDs to component names for display */
  componentNames?: Map<string, string>;
  /** Map of component IDs to component types for display */
  componentTypes?: Map<string, string>;
  onAddComponent?: () => void;
  onRemoveComponent?: (componentId: string) => void;
  onReorderComponents?: (components: UIScreenComponentRef[]) => void;
}

/**
 * ComponentsTab - Manages component references for UI_SCREEN diagram
 */
export const ComponentsTab: React.FC<ComponentsTabProps> = ({
  components,
  componentNames = new Map(),
  componentTypes = new Map(),
  onAddComponent,
  onRemoveComponent,
}) => {
  return (
    <div className="ui-screen-components-tab">
      <div style={{ padding: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Components ({components.length})
          </h3>
          {onAddComponent && (
            <button
              onClick={onAddComponent}
              style={{
                padding: '6px 12px',
                background: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Add Component
            </button>
          )}
        </div>

        {components.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#999',
              background: '#f5f5f5',
              borderRadius: '4px',
            }}
          >
            No components added yet.
            {onAddComponent && ' Click "Add Component" to get started.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {components.map((comp, index) => (
              <div
                key={comp.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px',
                  background: '#f9f9f9',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                }}
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    background: '#e3f2fd',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: '12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#1976d2',
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: '14px' }}>
                    {componentNames.get(comp.component_id) || comp.component_id}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {componentTypes.get(comp.component_id) || 'Component'}
                    {comp.parent_ref_id && (
                      <span style={{ marginLeft: '8px', color: '#999' }}>
                        (nested)
                      </span>
                    )}
                  </div>
                </div>
                {onRemoveComponent && (
                  <button
                    onClick={() => onRemoveComponent(comp.id)}
                    style={{
                      padding: '4px 8px',
                      background: '#ffebee',
                      color: '#c62828',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ComponentsTab;
