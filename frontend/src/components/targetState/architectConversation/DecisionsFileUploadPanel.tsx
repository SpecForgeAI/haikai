/**
 * DecisionsFileUploadPanel
 *
 * Spec: 2026-06-26-target-state-decisions-file-import (Spec 3 of 3) — FR6 (upload
 * box + mutual exclusivity) + FR7 (post-import summary + full-close / subset-
 * continue branch).
 *
 * "Manually Answer Target State": upload a text file of FINAL target-state
 * decisions (the round-trip of the "Preview prompt-ready output") to pre-complete
 * the conversation. Sits JUST ABOVE the `ManifestUploadPanel`. The two file inputs
 * are MUTUALLY EXCLUSIVE — the parent passes `disabledReason` when the OTHER box
 * is active, and this panel reports its own active state via `onActiveChange`
 * (file selected → active; cleared → inactive) so the parent can disable the
 * other. Clearing re-enables the other box.
 *
 * After an import it renders a lightweight summary (FR7): what was written (each
 * `from imported file`), what prior answers it superseded, which lines were skipped
 * for tiers not in this project, which non-architecture sections were ignored, and
 * any per-line errors (partial-accept; fix-and-reload). FULL (all answered) →
 * prompts the existing "Save Conversation" close; SUBSET → notes the walk continues.
 */

import { useCallback, useRef, useState } from 'react';
import {
  uploadDecisionsFile as defaultUploadDecisionsFile,
  type DecisionsFileImportResult,
} from '../../../api/decisionsFileImportApi';
import styles from './DecisionsFileUploadPanel.module.css';

export interface DecisionsFileUploadPanelDeps {
  uploadDecisionsFile: typeof defaultUploadDecisionsFile;
}

export const defaultDecisionsFileUploadPanelDeps: DecisionsFileUploadPanelDeps = {
  uploadDecisionsFile: (projectId, targetArchitectureId, file, options) =>
    defaultUploadDecisionsFile(projectId, targetArchitectureId, file, options),
};

export interface DecisionsFileUploadPanelProps {
  projectId: string;
  targetArchitectureId: string;
  conversationThreadId?: string | null;
  /** Fired after a successful import so the parent can refresh decisions + walk. */
  onImported?: (result: DecisionsFileImportResult) => void;
  /** When set, this panel is disabled (the OTHER bulk input is active) + tooltip. */
  disabledReason?: string | null;
  /** Reports active state (file staged) so the parent can disable the other box. */
  onActiveChange?: (active: boolean) => void;
  deps?: DecisionsFileUploadPanelDeps;
}

export function DecisionsFileUploadPanel({
  projectId,
  targetArchitectureId,
  conversationThreadId = null,
  onImported,
  disabledReason = null,
  onActiveChange,
  deps = defaultDecisionsFileUploadPanelDeps,
}: DecisionsFileUploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionsFileImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const disabled = !!disabledReason;

  const handleFileChosen = useCallback(
    (fileList: FileList | null) => {
      const chosen = fileList && fileList.length > 0 ? fileList[0] : null;
      setFile(chosen);
      setError(null);
      onActiveChange?.(chosen !== null);
    },
    [onActiveChange],
  );

  const handleClear = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onActiveChange?.(false);
  }, [onActiveChange]);

  const handleUpload = useCallback(async () => {
    if (!file || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deps.uploadDecisionsFile(projectId, targetArchitectureId, file, {
        conversationThreadId,
      });
      setResult(res);
      onImported?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import decisions file');
    } finally {
      setBusy(false);
    }
  }, [file, disabled, deps, projectId, targetArchitectureId, conversationThreadId, onImported]);

  const canSubmit = !!file && !busy && !disabled;

  return (
    <section
      className={styles.panel}
      data-testid="decisions-file-upload-panel"
      aria-label="Manually answer target state"
    >
      <h3 className={styles.heading}>Manually Answer Target State</h3>
      <p className={styles.subheading}>
        Already have your target-state decisions written down? Upload a text file
        (the same format as <em>Preview prompt-ready output</em>) to complete the
        conversation in one step. Unanswered questions continue as normal.
      </p>

      <div className={styles.dropRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          disabled={disabled}
          onChange={(e) => handleFileChosen(e.target.files)}
          data-testid="decisions-file-input"
          aria-label="Choose a decisions text file"
        />
      </div>

      {disabledReason && (
        <p
          className={styles.disabledNote}
          data-testid="decisions-file-disabled-note"
          title={disabledReason}
        >
          {disabledReason}
        </p>
      )}

      {file && !disabled && (
        <div className={styles.actions}>
          <span className={styles.fileName} data-testid="decisions-file-name">
            {file.name}
          </span>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canSubmit}
            onClick={() => void handleUpload()}
            data-testid="decisions-file-submit"
          >
            {busy ? 'Importing…' : 'Import + complete'}
          </button>
          <button
            type="button"
            className={styles.clearButton}
            onClick={handleClear}
            data-testid="decisions-file-clear"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert" data-testid="decisions-file-error">
          {error}
        </div>
      )}

      {result && (
        <div className={styles.summary} data-testid="decisions-import-summary">
          {result.allAnswered ? (
            <p className={styles.allAnswered} data-testid="decisions-import-allanswered">
              All target-state questions are answered — use <strong>Save
              Conversation</strong> below to finish.
            </p>
          ) : (
            <p data-testid="decisions-import-subset">
              Imported {result.written.length} answer
              {result.written.length === 1 ? '' : 's'}; the remaining questions
              continue in the conversation.
            </p>
          )}

          {result.written.length > 0 && (
            <ul className={styles.writtenList} data-testid="decisions-import-written-list">
              {result.written.map((code) => (
                <li key={code} className={styles.writtenItem} data-testid="decisions-import-written">
                  <code>{code}</code>
                  <span className={styles.provenanceBadge} data-testid="decisions-provenance-badge">
                    from imported file
                  </span>
                </li>
              ))}
            </ul>
          )}

          {result.overrides.length > 0 && (
            <div data-testid="decisions-import-overrides">
              <p className={styles.sectionLabel}>
                Superseded {result.overrides.length} prior answer
                {result.overrides.length === 1 ? '' : 's'}:
              </p>
              <ul>
                {result.overrides.map((o) => (
                  <li key={o.decisionCode} data-testid="decisions-import-override">
                    <code>{o.decisionCode}</code>: {o.prior ?? '(none)'} → {o.next}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.skippedTierCodes.length > 0 && (
            <p className={styles.note} data-testid="decisions-import-tierskip">
              Skipped {result.skippedTierCodes.length} line
              {result.skippedTierCodes.length === 1 ? '' : 's'} for tiers not in
              this project: {result.skippedTierCodes.join(', ')}.
            </p>
          )}

          {result.skippedSections.length > 0 && (
            <p className={styles.note} data-testid="decisions-import-skipped-sections">
              Ignored (not applied): {result.skippedSections.join('; ')}.
            </p>
          )}

          {result.failedCodes.length > 0 && (
            <p className={styles.note} data-testid="decisions-import-failed">
              {result.failedCodes.length} write
              {result.failedCodes.length === 1 ? '' : 's'} failed:{' '}
              {result.failedCodes.join(', ')}.
            </p>
          )}

          {result.badLines.length > 0 && (
            <div className={styles.badLines} data-testid="decisions-import-badlines">
              <p className={styles.sectionLabel}>
                {result.badLines.length} line
                {result.badLines.length === 1 ? '' : 's'} could not be imported —
                fix and re-upload:
              </p>
              <ul>
                {result.badLines.map((b, i) => (
                  <li key={`${b.lineNumber}-${i}`} data-testid="decisions-import-badline">
                    Line {b.lineNumber} ({b.reason}): {b.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
