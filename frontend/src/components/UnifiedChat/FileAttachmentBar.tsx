/**
 * FileAttachmentBar Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 6, Task 6.5: Create FileAttachmentBar component
 *
 * Renders a horizontal row of file chips below the textarea.
 * Each chip shows a truncated filename (max 20 chars with ellipsis)
 * with the full name as a `title` tooltip attribute.
 * An X button on each chip calls `onRemove(index)`.
 *
 * Follows the chip pattern from ProductManagerChatPanel.tsx file attachment display.
 */

import styles from './FileAttachmentBar.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface FileAttachmentBarProps {
  /** Array of attached File objects */
  files: File[];
  /** Callback to remove a file by its index */
  onRemove: (index: number) => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Truncate a filename to maxLen characters with ellipsis if needed.
 */
function truncateFilename(name: string, maxLen: number = 20): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen) + '...';
}

// ============================================================================
// Component
// ============================================================================

export function FileAttachmentBar({ files, onRemove }: FileAttachmentBarProps) {
  if (files.length === 0) return null;

  return (
    <div className={styles.container} data-testid="file-attachment-bar">
      {files.map((file, index) => (
        <span
          key={`${file.name}-${index}`}
          className={styles.fileChip}
          title={file.name}
          data-testid={`file-chip-${index}`}
        >
          <span className={styles.fileName}>
            {truncateFilename(file.name)}
          </span>
          <button
            type="button"
            className={styles.removeButton}
            onClick={() => onRemove(index)}
            aria-label={`Remove ${file.name}`}
            data-testid={`file-chip-remove-${index}`}
          >
            &times;
          </button>
        </span>
      ))}
    </div>
  );
}
