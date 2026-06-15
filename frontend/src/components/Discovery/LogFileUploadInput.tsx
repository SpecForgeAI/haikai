/**
 * LogFileUploadInput Component
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start
 * Task Group 3: Reusable LogFileUploadInput component
 *
 * A fully-controlled, embeddable upload section for runtime log files.
 *
 * Designed to be embedded inside an existing modal body (e.g. the new
 * `StartDiscoveryRunModal` and the existing `PreflightModal`). Does NOT supply
 * its own modal chrome, header, footer, or submit handling -- the parent owns
 * `selectedFiles` state and the run-start orchestration.
 *
 * Shape:
 *   - Native `<input type="file" multiple accept=".log,.txt,.jsonl,.ndjson" />`
 *     (drag-and-drop is whatever the browser provides for free; no custom
 *     drag-drop handlers are added per spec).
 *   - Selection list: one row per file with filename, human-readable size,
 *     and a per-row Remove button.
 *   - Client-side validation runs at file-pick time:
 *       a) reject files whose extension is not in the accept list (case-insensitive)
 *       b) reject any single file whose size > `maxFileBytes`
 *       c) reject if cumulative size of accepted+previously-selected files
 *          would exceed `maxTotalBytes`
 *     Rejected files are NOT silently dropped -- the rejection reasons are
 *     surfaced inline. Accepted files are appended to the parent's selection
 *     via `onChange`.
 *
 * Notes:
 *   - Defaults for `maxFileBytes` (100 MB) and `maxTotalBytes` (2000 MB / 2 GB)
 *     match the gateway-side caps defined in spec; can be overridden via props
 *     or read from frontend env.
 *   - The component mirrors the input-group / hint / error-message visual
 *     conventions of `InfrastructureTerraformImportModal` (the canonical
 *     multi-file upload component in this codebase).
 */

import React, { useMemo, useRef, useState } from 'react';
import styles from './LogFileUploadInput.module.css';

// Locked accept list (case-insensitive matching is performed in code).
const ACCEPTED_EXTENSIONS = ['.log', '.txt', '.jsonl', '.ndjson'] as const;
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

// Defaults: 100 MB per file, 2000 MB (2 GB) cumulative. Frontend env
// overrides via `VITE_LOG_UPLOAD_MAX_FILE_BYTES` /
// `VITE_LOG_UPLOAD_MAX_TOTAL_BYTES` fall through to these defaults when not set.
const DEFAULT_MAX_FILE_BYTES = 104857600; // 100 MB
const DEFAULT_MAX_TOTAL_BYTES = 2097152000; // 2000 MB (2 GB)

function readEnvNumber(name: string, fallback: number): number {
  // Vite injects env at build time on `import.meta.env`. We guard for the
  // possibility that it is undefined (e.g. during certain test setups) and
  // fall through to the spec default.
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (env && typeof env[name] === 'string') {
      const parsed = Number(env[name]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return fallback;
}

const ENV_MAX_FILE_BYTES = readEnvNumber('VITE_LOG_UPLOAD_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
const ENV_MAX_TOTAL_BYTES = readEnvNumber('VITE_LOG_UPLOAD_MAX_TOTAL_BYTES', DEFAULT_MAX_TOTAL_BYTES);

/**
 * Format a byte count as a human-readable string (e.g. "1.2 MB", "512 KB").
 * Uses 1024-based units to match conventional "MB / GB" labelling for file sizes.
 */
export function formatHumanReadableBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // One decimal for sub-100 numbers, none for >=100 to keep the column tidy.
  const formatted = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

/**
 * Returns the lowercase extension (including the leading dot) of a filename,
 * or an empty string when the filename has no extension.
 */
function getLowerExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return '';
  return fileName.slice(idx).toLowerCase();
}

export interface LogFileUploadInputProps {
  /** Currently selected files -- the parent owns this state. */
  selectedFiles: File[];
  /** Called whenever the selection changes (add or remove). */
  onChange: (files: File[]) => void;
  /** Optional override for the per-file size cap. Defaults to env / 100 MB. */
  maxFileBytes?: number;
  /** Optional override for the cumulative size cap. Defaults to env / 2000 MB (2 GB). */
  maxTotalBytes?: number;
  /** Optional `data-testid` for the wrapper section. */
  'data-testid'?: string;
  /** When true, disables the file input and remove buttons (e.g. while a parent submit is in flight). */
  disabled?: boolean;
}

/**
 * LogFileUploadInput -- a controlled multi-file upload section.
 */
export function LogFileUploadInput({
  selectedFiles,
  onChange,
  maxFileBytes,
  maxTotalBytes,
  'data-testid': dataTestId,
  disabled = false,
}: LogFileUploadInputProps) {
  const effectiveMaxFile = maxFileBytes ?? ENV_MAX_FILE_BYTES;
  const effectiveMaxTotal = maxTotalBytes ?? ENV_MAX_TOTAL_BYTES;

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const currentTotalBytes = useMemo(
    () => selectedFiles.reduce((sum, f) => sum + (f.size ?? 0), 0),
    [selectedFiles],
  );

  const handleFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    const picked = list ? Array.from(list) : [];

    const errors: string[] = [];
    const accepted: File[] = [];
    let runningTotal = currentTotalBytes;

    for (const file of picked) {
      const ext = getLowerExtension(file.name);
      if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
        errors.push(
          `"${file.name}" was rejected: unsupported file extension. Allowed: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
        );
        continue;
      }
      if (file.size > effectiveMaxFile) {
        errors.push(
          `"${file.name}" was rejected: file size ${formatHumanReadableBytes(file.size)} exceeds the per-file limit of ${formatHumanReadableBytes(effectiveMaxFile)}.`,
        );
        continue;
      }
      if (runningTotal + file.size > effectiveMaxTotal) {
        errors.push(
          `"${file.name}" was rejected: cumulative selected size would exceed the total upload limit of ${formatHumanReadableBytes(effectiveMaxTotal)}.`,
        );
        continue;
      }
      runningTotal += file.size;
      accepted.push(file);
    }

    setValidationErrors(errors);

    if (accepted.length > 0) {
      onChange([...selectedFiles, ...accepted]);
    }

    // Reset the native input value so the same file can be re-picked after
    // removal (browsers otherwise ignore selecting the same path twice).
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleRemove = (indexToRemove: number) => {
    const next = selectedFiles.filter((_, i) => i !== indexToRemove);
    onChange(next);
    // Removing a file should NOT clear validation errors from the previous
    // pick attempt -- they describe a separate user action and the parent
    // remains in control of when to dismiss them via re-picking.
  };

  return (
    <section className={styles.section} data-testid={dataTestId ?? 'log-file-upload-input'}>
      <label className={styles.sectionTitle} htmlFor="log-file-upload-input-files">
        Upload Log Files
      </label>
      <p className={styles.helperText} data-testid="log-file-upload-input-helper">
        Optional. Upload runtime log files to attach them to this discovery run. Log processing will be used by later
        discovery steps.
      </p>
      <input
        id="log-file-upload-input-files"
        ref={inputRef}
        className={styles.fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={handleFilePick}
        disabled={disabled}
        data-testid="log-file-upload-input-file-input"
      />

      {selectedFiles.length === 0 ? (
        <div className={styles.selectionListEmpty} data-testid="log-file-upload-input-empty">
          No files selected.
        </div>
      ) : (
        <ul className={styles.selectionList} data-testid="log-file-upload-input-selection-list">
          {selectedFiles.map((file, idx) => {
            // Files don't have stable ids; combine name + size + index to give
            // React a reasonably stable key for the typical "small list" case.
            const key = `${file.name}__${file.size}__${idx}`;
            return (
              <li
                key={key}
                className={styles.selectionRow}
                data-testid={`log-file-upload-input-row-${idx}`}
              >
                <span className={styles.fileName} title={file.name}>
                  {file.name}
                </span>
                <span className={styles.fileSize} data-testid={`log-file-upload-input-size-${idx}`}>
                  {formatHumanReadableBytes(file.size)}
                </span>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => handleRemove(idx)}
                  disabled={disabled}
                  data-testid={`log-file-upload-input-remove-${idx}`}
                  aria-label={`Remove ${file.name}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {validationErrors.length > 0 && (
        <ul
          className={styles.validationErrors}
          role="alert"
          data-testid="log-file-upload-input-validation-errors"
        >
          {validationErrors.map((msg, i) => (
            <li key={i} data-testid={`log-file-upload-input-validation-error-${i}`}>
              {msg}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default LogFileUploadInput;
