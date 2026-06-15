/**
 * RoadmapPreviewBubble Component
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 5, Task 5.2: Create RoadmapPreviewBubble component
 *
 * Renders a bordered container with a header label "Generated Roadmap"
 * and subtitle showing initiative/epic counts. Parses JSON content with
 * the structure: { initiatives: [{ title, description?, epics: [{ title, description? }] }] }
 *
 * Features:
 * - Readable summary view: lists initiatives with nested epics
 * - "Show JSON" toggle to switch between readable and raw JSON view
 * - Confirm/Reject action buttons (same pattern as ArtifactPreviewBubble)
 * - Graceful error handling for malformed JSON
 */

import React, { useState, useMemo } from 'react';
import styles from './RoadmapPreviewBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface RoadmapEpic {
  title: string;
  description?: string;
}

interface RoadmapInitiative {
  title: string;
  description?: string;
  epics: RoadmapEpic[];
}

interface RoadmapData {
  initiatives: RoadmapInitiative[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface RoadmapPreviewBubbleProps {
  /** The JSON string content to parse and preview */
  content: string;
  /** Callback when user confirms the roadmap */
  onConfirm: () => void;
  /** Callback when user rejects the roadmap */
  onReject: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming?: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled?: boolean;
}

// ============================================================================
// Parse Helper
// ============================================================================

/**
 * Attempts to parse JSON content into RoadmapData.
 * Returns the parsed data or an error string.
 */
function parseRoadmapContent(content: string): { data: RoadmapData | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.initiatives)) {
      return { data: null, error: 'Invalid roadmap structure: missing initiatives array.' };
    }
    return { data: parsed as RoadmapData, error: null };
  } catch {
    return { data: null, error: 'Failed to parse roadmap JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function RoadmapPreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: RoadmapPreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const buttonsDisabled = disabled || isConfirming;

  // Parse the JSON content
  const { data, error } = useMemo(() => parseRoadmapContent(content), [content]);

  // Count initiatives and epics
  const initiativeCount = data ? data.initiatives.length : 0;
  const epicCount = data
    ? data.initiatives.reduce((sum, init) => sum + (Array.isArray(init.epics) ? init.epics.length : 0), 0)
    : 0;

  return (
    <div className={styles.container} data-testid="roadmap-preview-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Generated Roadmap
        {data && (
          <span className={styles.headerCounts} data-testid="roadmap-counts">
            {initiativeCount} initiative{initiativeCount !== 1 ? 's' : ''}, {epicCount} epic{epicCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorMessage} data-testid="roadmap-error">
          {error}
        </div>
      )}

      {/* Toggle button (only shown when data is valid) */}
      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="roadmap-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {/* Content area */}
      {data && !showJson && (
        <div className={styles.content} data-testid="roadmap-summary">
          {data.initiatives.map((initiative, initIdx) => (
            <div key={`init-${initIdx}`} className={styles.initiativeItem}>
              <div className={styles.initiativeTitle}>{initiative.title}</div>
              {initiative.description && (
                <div className={styles.initiativeDescription}>{initiative.description}</div>
              )}
              {Array.isArray(initiative.epics) && initiative.epics.length > 0 && (
                <ul className={styles.epicsList}>
                  {initiative.epics.map((epic, epicIdx) => (
                    <li key={`epic-${initIdx}-${epicIdx}`} className={styles.epicItem}>
                      {epic.title}
                      {epic.description && (
                        <span className={styles.epicDescription}> - {epic.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {data && showJson && (
        <div className={styles.rawJson} data-testid="roadmap-raw-json">
          {JSON.stringify(data, null, 2)}
        </div>
      )}

      {/* Action buttons */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.rejectButton}
          onClick={onReject}
          disabled={buttonsDisabled}
        >
          Reject
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={onConfirm}
          disabled={buttonsDisabled}
        >
          {isConfirming ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
