/**
 * InterfaceEndpointPicker Component
 *
 * Task Group 4: Two-step picker for selecting Interface and then Endpoint
 * Used in AddActionModal for CALL_API effect type.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MetaModel } from '../../../../types/model';

/**
 * Props for InterfaceEndpointPicker
 */
export interface InterfaceEndpointPickerProps {
  /** Meta model for entity lookups */
  metaModel: MetaModel | null;
  /** Currently selected endpoint ID */
  value: string | undefined;
  /** Callback when endpoint selection changes */
  onChange: (endpointId: string | undefined) => void;
  /** CSS class name for the container */
  className?: string;
}

/**
 * InterfaceEndpointPicker Component
 *
 * Two-step selection: First select Interface, then select Endpoint.
 * Filters endpoints by the selected interface.
 */
export function InterfaceEndpointPicker({
  metaModel,
  value,
  onChange,
  className,
}: InterfaceEndpointPickerProps) {
  // State for selected interface
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string>('');

  // Get interfaces list
  const interfaces = useMemo(() => {
    if (!metaModel) return [];
    return metaModel.entities.interfaces || [];
  }, [metaModel]);

  // Get endpoints filtered by selected interface
  const endpoints = useMemo(() => {
    if (!metaModel || !selectedInterfaceId) return [];
    return (metaModel.entities.endpoints || []).filter(
      ep => ep.interface_id === selectedInterfaceId
    );
  }, [metaModel, selectedInterfaceId]);

  // Initialize selectedInterfaceId from value (if endpoint is already selected)
  useEffect(() => {
    if (value && metaModel) {
      const endpoint = metaModel.entities.endpoints.find(ep => ep.id === value);
      if (endpoint && endpoint.interface_id !== selectedInterfaceId) {
        setSelectedInterfaceId(endpoint.interface_id);
      }
    }
  }, [value, metaModel, selectedInterfaceId]);

  // Handle interface selection change
  const handleInterfaceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newInterfaceId = e.target.value;
    setSelectedInterfaceId(newInterfaceId);
    // Clear endpoint selection when interface changes
    onChange(undefined);
  }, [onChange]);

  // Handle endpoint selection change
  const handleEndpointChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newEndpointId = e.target.value || undefined;
    onChange(newEndpointId);
  }, [onChange]);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Interface Dropdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
          Interface
        </label>
        <select
          value={selectedInterfaceId}
          onChange={handleInterfaceChange}
          style={{
            padding: '8px 12px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: 'white',
            color: '#333',
            cursor: 'pointer',
            outline: 'none',
          }}
          data-testid="interface-select"
        >
          <option value="">-- Select Interface --</option>
          {interfaces.map((iface) => (
            <option key={iface.id} value={iface.id}>
              {iface.name}
            </option>
          ))}
        </select>
      </div>

      {/* Endpoint Dropdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
          Endpoint
        </label>
        <select
          value={value || ''}
          onChange={handleEndpointChange}
          disabled={!selectedInterfaceId}
          style={{
            padding: '8px 12px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: selectedInterfaceId ? 'white' : '#f5f5f5',
            color: selectedInterfaceId ? '#333' : '#999',
            cursor: selectedInterfaceId ? 'pointer' : 'not-allowed',
            outline: 'none',
          }}
          data-testid="endpoint-select"
        >
          <option value="">
            {selectedInterfaceId ? '-- Select Endpoint --' : 'Select an Interface first'}
          </option>
          {endpoints.map((endpoint) => (
            <option key={endpoint.id} value={endpoint.id}>
              {endpoint.name} ({endpoint.operation_verb || endpoint.endpoint_type})
            </option>
          ))}
        </select>
        {selectedInterfaceId && endpoints.length === 0 && (
          <span style={{ fontSize: '12px', color: '#f57c00' }}>
            No endpoints found for this interface
          </span>
        )}
      </div>
    </div>
  );
}

export default InterfaceEndpointPicker;
