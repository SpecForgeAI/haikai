/**
 * ContractFileUploadInput (2026-08-02)
 *
 * The service-discovery analogue of API Baseline Capture's contract upload:
 * a controlled multi-file picker for AUTHORITATIVE API contract files
 * (WADL/WSDL/XSD) attached to a discovery run. The uploaded content is parsed
 * as an authoritative Interface/Endpoint source, so the endpoint/format
 * inventory is anchored to the declared contract rather than reconstructed
 * (and can't silently shrink). Mirrors `LogFileUploadInput`'s shape + visual
 * conventions; the parent owns `selectedFiles` and the upload orchestration.
 */

import React, { useRef, useState } from 'react';
import styles from './LogFileUploadInput.module.css';
import { formatHumanReadableBytes } from './LogFileUploadInput';

const ACCEPTED_EXTENSIONS = ['.wadl', '.wsdl', '.xsd', '.xml'] as const;
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');
const MAX_FILE_BYTES = 10_485_760; // 10 MB — contracts are small text documents
const MAX_FILES = 25;

function getLowerExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return '';
  return fileName.slice(idx).toLowerCase();
}

export interface ContractFileUploadInputProps {
  selectedFiles: File[];
  onChange: (files: File[]) => void;
  'data-testid'?: string;
  disabled?: boolean;
}

export function ContractFileUploadInput({
  selectedFiles,
  onChange,
  'data-testid': dataTestId,
  disabled = false,
}: ContractFileUploadInputProps) {
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    const picked = list ? Array.from(list) : [];
    const errors: string[] = [];
    const accepted: File[] = [];

    for (const file of picked) {
      const ext = getLowerExtension(file.name);
      if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
        errors.push(
          `"${file.name}" was rejected: unsupported extension. Allowed API contracts: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
        );
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        errors.push(
          `"${file.name}" was rejected: ${formatHumanReadableBytes(file.size)} exceeds the ${formatHumanReadableBytes(MAX_FILE_BYTES)} per-file limit.`,
        );
        continue;
      }
      if (selectedFiles.length + accepted.length >= MAX_FILES) {
        errors.push(`"${file.name}" was rejected: at most ${MAX_FILES} contract files.`);
        continue;
      }
      accepted.push(file);
    }

    setValidationErrors(errors);
    if (accepted.length > 0) onChange([...selectedFiles, ...accepted]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRemove = (indexToRemove: number) => {
    onChange(selectedFiles.filter((_, i) => i !== indexToRemove));
  };

  return (
    <section className={styles.section} data-testid={dataTestId ?? 'contract-file-upload-input'}>
      <label className={styles.sectionTitle} htmlFor="contract-file-upload-input-files">
        Upload API contract files
      </label>
      <p className={styles.helperText} data-testid="contract-file-upload-input-helper">
        Optional. WADL / WSDL / XSD (.wadl, .wsdl, .xsd, .xml). Used as an{' '}
        <strong>authoritative</strong> source of interfaces &amp; endpoints — the discovered
        inventory is reconciled against the declared contract rather than reconstructed from
        source alone.
      </p>
      <input
        id="contract-file-upload-input-files"
        ref={inputRef}
        className={styles.fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={handleFilePick}
        disabled={disabled}
        data-testid="contract-file-upload-input-file-input"
      />

      {selectedFiles.length === 0 ? (
        <div className={styles.selectionListEmpty} data-testid="contract-file-upload-input-empty">
          No contract files selected.
        </div>
      ) : (
        <ul className={styles.selectionList} data-testid="contract-file-upload-input-selection-list">
          {selectedFiles.map((file, idx) => {
            const key = `${file.name}__${file.size}__${idx}`;
            return (
              <li
                key={key}
                className={styles.selectionRow}
                data-testid={`contract-file-upload-input-row-${idx}`}
              >
                <span className={styles.fileName} title={file.name}>
                  {file.name}
                </span>
                <span
                  className={styles.fileSize}
                  data-testid={`contract-file-upload-input-size-${idx}`}
                >
                  {formatHumanReadableBytes(file.size)}
                </span>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => handleRemove(idx)}
                  disabled={disabled}
                  data-testid={`contract-file-upload-input-remove-${idx}`}
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
          data-testid="contract-file-upload-input-validation-errors"
        >
          {validationErrors.map((msg, i) => (
            <li key={i} data-testid={`contract-file-upload-input-validation-error-${i}`}>
              {msg}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ContractFileUploadInput;
