/**
 * RawDSLTab Component
 *
 * Displays the raw JSON content for a UI_SCREEN diagram.
 * Allows advanced users to view and edit the typed content directly.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { UIScreenContent } from '../../../types/typedContent';

interface RawDSLTabProps {
  content: UIScreenContent;
  onContentChange?: (content: UIScreenContent) => void;
  readOnly?: boolean;
}

/**
 * RawDSLTab - Shows raw JSON content for UI_SCREEN diagram
 */
export const RawDSLTab: React.FC<RawDSLTabProps> = ({
  content,
  onContentChange,
  readOnly = false,
}) => {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(content, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Sync with external content changes
  useEffect(() => {
    if (!isDirty) {
      setJsonText(JSON.stringify(content, null, 2));
    }
  }, [content, isDirty]);

  /**
   * Handle text change
   */
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonText(e.target.value);
    setIsDirty(true);
    setError(null);
  }, []);

  /**
   * Apply changes
   */
  const handleApply = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as UIScreenContent;

      // Basic validation
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid content: must be an object');
      }
      if (!Array.isArray(parsed.components)) {
        throw new Error('Invalid content: components must be an array');
      }
      if (!Array.isArray(parsed.actions)) {
        throw new Error('Invalid content: actions must be an array');
      }

      onContentChange?.(parsed);
      setError(null);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  }, [jsonText, onContentChange]);

  /**
   * Reset to original content
   */
  const handleReset = useCallback(() => {
    setJsonText(JSON.stringify(content, null, 2));
    setError(null);
    setIsDirty(false);
  }, [content]);

  return (
    <div className="ui-screen-raw-dsl-tab">
      <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Raw JSON Content
          </h3>
          {!readOnly && (
            <div style={{ display: 'flex', gap: '8px' }}>
              {isDirty && (
                <button
                  onClick={handleReset}
                  style={{
                    padding: '6px 12px',
                    background: '#f5f5f5',
                    color: '#666',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Reset
                </button>
              )}
              <button
                onClick={handleApply}
                disabled={!isDirty || !!error}
                style={{
                  padding: '6px 12px',
                  background: isDirty && !error ? '#1976d2' : '#e0e0e0',
                  color: isDirty && !error ? 'white' : '#999',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isDirty && !error ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                }}
              >
                Apply Changes
              </button>
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: '#ffebee',
              color: '#c62828',
              borderRadius: '4px',
              marginBottom: '12px',
              fontSize: '12px',
            }}
          >
            {error}
          </div>
        )}

        <textarea
          value={jsonText}
          onChange={handleChange}
          readOnly={readOnly}
          style={{
            flex: 1,
            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
            fontSize: '12px',
            lineHeight: '1.4',
            padding: '12px',
            border: `1px solid ${error ? '#ef5350' : '#ddd'}`,
            borderRadius: '4px',
            resize: 'none',
            background: readOnly ? '#f5f5f5' : 'white',
            color: '#333',
          }}
          spellCheck={false}
        />

        {isDirty && (
          <div
            style={{
              marginTop: '8px',
              fontSize: '12px',
              color: '#f57c00',
            }}
          >
            * Unsaved changes - click "Apply Changes" to save
          </div>
        )}
      </div>
    </div>
  );
};

export default RawDSLTab;
