/**
 * runInputArtifactsHelpers
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start
 * Task Group 5: Warning chip on the run row.
 *
 * Pure helpers that read `config_snapshot.inputArtifacts` from a discovery
 * run row and decide whether the run is in a "logs partially attached" or
 * "log attach failed" state. Extracted so the run-row chip predicate can be
 * unit-tested without mounting the run-list component.
 *
 * Field shape (locked by Spec 4):
 *   config_snapshot: {
 *     inputArtifacts: {
 *       logFiles: LogFileMeta[];
 *       attemptedCount: number;   // set by the gateway BEFORE write attempts
 *     };
 *   }
 *
 * `attemptedCount` is what the user picked in the modal; `logFiles.length` is
 * what was actually persisted to disk and acknowledged by the AMS PATCH. When
 * `attemptedCount > logFiles.length` the run row is in a partial / failed
 * state and the UI surfaces a warning chip.
 *
 * The run is NEVER rolled back on log-upload failure (per spec failure-mode
 * flow); this helper exists to surface that state cleanly to the UI.
 */

/**
 * Discriminated state of the "log-attach" sub-status on a discovery run row.
 *
 *   - `'none'`: no warning chip should render (either no upload was attempted,
 *               or every attempted file was successfully attached).
 *   - `'partial'`: at least one file attached but fewer than were attempted
 *                  (`attemptedCount > logFiles.length > 0`). Chip label is
 *                  "Logs partially attached".
 *   - `'failed'`: zero files attached but at least one was attempted
 *                 (`attemptedCount > 0 && logFiles.length === 0`). Chip label
 *                 is "Log attach failed".
 */
export type LogAttachWarningState = 'none' | 'partial' | 'failed';

/**
 * Locked chip labels (must match the spec acceptance criteria exactly).
 */
export const LOG_ATTACH_WARNING_LABEL_PARTIAL = 'Logs partially attached';
export const LOG_ATTACH_WARNING_LABEL_FAILED = 'Log attach failed';

/**
 * Map a LogAttachWarningState to its user-facing chip label, or `null` when
 * no chip should render. Centralised here so the run-row JSX stays terse.
 */
export function logAttachWarningLabel(state: LogAttachWarningState): string | null {
  switch (state) {
    case 'failed':
      return LOG_ATTACH_WARNING_LABEL_FAILED;
    case 'partial':
      return LOG_ATTACH_WARNING_LABEL_PARTIAL;
    case 'none':
    default:
      return null;
  }
}

/**
 * Read `inputArtifacts.logFiles` and `inputArtifacts.attemptedCount` from a
 * run row's `config_snapshot` and decide which warning chip (if any) to show.
 *
 * Defensive against every shape the backend may legitimately return:
 *   - `config_snapshot` may be `null` (legacy / pre-Spec-4 runs)
 *   - `inputArtifacts` may be missing entirely (no upload attempted)
 *   - `attemptedCount` may be missing or non-numeric (treated as 0)
 *   - `logFiles` may be missing or not an array (treated as length 0)
 *
 * @param configSnapshot The `config_snapshot` JSONB blob from a discovery run
 *                       (typed `Record<string, unknown> | null` on the DTO).
 * @returns The warning-chip state to render for this run row.
 */
export function computeLogAttachWarningState(
  configSnapshot: Record<string, unknown> | null | undefined,
): LogAttachWarningState {
  if (!configSnapshot || typeof configSnapshot !== 'object') {
    return 'none';
  }

  const inputArtifacts = (configSnapshot as { inputArtifacts?: unknown }).inputArtifacts;
  if (!inputArtifacts || typeof inputArtifacts !== 'object') {
    return 'none';
  }

  const ia = inputArtifacts as { logFiles?: unknown; attemptedCount?: unknown };

  const attemptedCount =
    typeof ia.attemptedCount === 'number' && Number.isFinite(ia.attemptedCount)
      ? ia.attemptedCount
      : 0;

  const logFilesLength = Array.isArray(ia.logFiles) ? ia.logFiles.length : 0;

  // No upload was attempted at all -- byte-for-byte the existing no-log
  // behaviour. Spec acceptance criterion (a).
  if (attemptedCount <= 0) {
    return 'none';
  }

  // Every attempted file landed -- silent success. Spec acceptance (a).
  if (logFilesLength >= attemptedCount) {
    return 'none';
  }

  // attemptedCount > 0 here. Distinguish "all failed" from "some failed".
  if (logFilesLength === 0) {
    return 'failed';
  }
  return 'partial';
}
