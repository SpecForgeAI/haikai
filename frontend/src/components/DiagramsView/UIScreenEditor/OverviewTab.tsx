/**
 * OverviewTab Component
 *
 * Displays overview information for a UI_SCREEN diagram.
 * Shows the associated screen reference and summary statistics.
 *
 * Task Group 1: Wire Props from EditorPanel to OverviewTab
 * - Added uiScreens, selectedScreenId, and onSelectScreenId props
 *
 * Task Group 2: Implement Dropdown UI in OverviewTab
 * - Replaced static message with dropdown selector
 * - Added Clear button when selection exists
 * - Added warning for missing associated screen
 */

import React, { useCallback, useMemo } from 'react';
import { UIScreenContent } from '../../../types/typedContent';
import { UIScreen } from '../../../types/model';

interface OverviewTabProps {
  content: UIScreenContent;
  /** @deprecated Use selectedScreen from uiScreens list instead */
  screenName?: string;
  /** @deprecated Use selectedScreen from uiScreens list instead */
  screenRoute?: string;
  /** Callback when screen_id is changed via dropdown */
  onScreenIdChange?: (screenId: string | null) => void;
  /** List of available UIScreen entities for the dropdown */
  uiScreens?: UIScreen[];
  /** Currently selected screen_id (from content.screen_id) */
  selectedScreenId?: string | null;
  /** Callback when a screen is selected from the dropdown */
  onSelectScreenId?: (screenId: string | null) => void;
}

/**
 * OverviewTab - Shows overview information for UI_SCREEN diagram
 */
export const OverviewTab: React.FC<OverviewTabProps> = ({
  content,
  // Legacy props - kept for backward compatibility but no longer used
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  screenName: _screenName,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  screenRoute: _screenRoute,
  uiScreens = [],
  selectedScreenId,
  onSelectScreenId,
}) => {
  /**
   * Handle dropdown selection change
   */
  const handleDropdownChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (onSelectScreenId) {
        onSelectScreenId(value === '' ? null : value);
      }
    },
    [onSelectScreenId]
  );

  /**
   * Handle Clear button click
   */
  const handleClearClick = useCallback(() => {
    if (onSelectScreenId) {
      onSelectScreenId(null);
    }
  }, [onSelectScreenId]);

  /**
   * Check if the selected screen is missing from the list
   */
  const isScreenMissing = useMemo(() => {
    if (!selectedScreenId) return false;
    return !uiScreens.some((screen) => screen.id === selectedScreenId);
  }, [selectedScreenId, uiScreens]);

  /**
   * Get the selected screen entity
   */
  const selectedScreen = useMemo(() => {
    if (!selectedScreenId) return null;
    return uiScreens.find((screen) => screen.id === selectedScreenId) || null;
  }, [selectedScreenId, uiScreens]);

  /**
   * Format option label: name (route) or just name if no route
   */
  const formatOptionLabel = useCallback((screen: UIScreen): string => {
    if (screen.route) {
      return `${screen.name} (${screen.route})`;
    }
    return screen.name;
  }, []);

  return (
    <div className="ui-screen-overview-tab">
      <div style={{ padding: '16px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>
          Screen Overview
        </h3>

        {/* Screen Reference Section */}
        <div
          style={{
            background: '#f5f5f5',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: '8px' }}>Associated UIScreen</div>

          {/* Dropdown Selector */}
          <div style={{ marginBottom: '8px' }}>
            <select
              value={selectedScreenId || ''}
              onChange={handleDropdownChange}
              data-testid="uiscreen-dropdown"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                backgroundColor: 'white',
              }}
            >
              <option value="">Select a UIScreen...</option>
              {uiScreens.map((screen) => (
                <option key={screen.id} value={screen.id}>
                  {formatOptionLabel(screen)}
                </option>
              ))}
            </select>
          </div>

          {/* Missing Screen Warning */}
          {isScreenMissing && (
            <div
              style={{
                color: '#b26a00',
                backgroundColor: '#fff3e0',
                padding: '8px',
                borderRadius: '4px',
                fontSize: '13px',
                marginBottom: '8px',
              }}
              data-testid="missing-screen-warning"
            >
              Associated UIScreen not found
            </div>
          )}

          {/* Selected Screen Display */}
          {selectedScreen && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '14px' }}>
                <strong>{selectedScreen.name}</strong>
              </div>
              {selectedScreen.route && (
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {selectedScreen.route}
                </div>
              )}
            </div>
          )}

          {/* Clear Button - only visible when selection exists */}
          {selectedScreenId && (
            <button
              onClick={handleClearClick}
              data-testid="clear-screen-button"
              style={{
                background: 'none',
                border: 'none',
                color: '#1976d2',
                cursor: 'pointer',
                padding: '0',
                fontSize: '13px',
                textDecoration: 'underline',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Statistics Section */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
          }}
        >
          <div
            style={{
              background: '#e3f2fd',
              padding: '12px',
              borderRadius: '4px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: 600, color: '#1976d2' }}>
              {content.components.length}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Components</div>
          </div>
          <div
            style={{
              background: '#e8f5e9',
              padding: '12px',
              borderRadius: '4px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: 600, color: '#388e3c' }}>
              {content.actions.length}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Actions</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
