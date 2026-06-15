/**
 * CompletionChip Component
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 5, Task 5.4: Full implementation of CompletionChip
 *
 * Renders as a distinct horizontal pill/chip (not a regular message bubble):
 * - Persona-colored left border accent
 * - Task label text in bold (e.g., "Product Definition Complete")
 * - Artifact name as a muted secondary label (e.g., "MISSION.MD")
 * - Small download icon/button (lucide-react Download, 16px) for transcript
 *
 * Static chip with no expand/collapse for this increment.
 */

import { Download } from 'lucide-react';
import styles from './CompletionChip.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface CompletionChipProps {
  /** Label for the completed task (e.g., "Product Definition Complete") */
  taskLabel: string;
  /** Hex color for the persona accent */
  personaColor: string;
  /** Name of the saved artifact (e.g., "MISSION.MD") */
  artifactName: string;
  /** ISO-8601 timestamp of completion */
  timestamp: string;
  /** Callback to download the conversation transcript */
  onDownloadTranscript: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function CompletionChip({
  taskLabel,
  personaColor,
  artifactName,
  onDownloadTranscript,
}: CompletionChipProps) {
  return (
    <div
      className={styles.chip}
      data-testid="completion-chip"
      style={{ borderLeft: `3px solid ${personaColor}` }}
    >
      <span className={styles.taskLabel}>{taskLabel}</span>
      <span className={styles.artifactName}>{artifactName}</span>
      <button
        type="button"
        className={styles.downloadButton}
        onClick={onDownloadTranscript}
        data-testid="download-transcript-button"
        title="Download transcript"
        aria-label="Download transcript"
      >
        <Download size={16} />
      </button>
    </div>
  );
}
