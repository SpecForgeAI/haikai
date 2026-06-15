/**
 * ChatInputBar Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 5, Task 5.4: Create ChatInputBar component
 *
 * Input bar for composing and sending chat messages. Contains:
 * - MentionInput textarea (with @-mention persona selection)
 * - FileAttachmentBar (displays attached file chips)
 * - Send button
 * - Paperclip button for file attachment
 *
 * Features:
 * - Enter (without Shift) sends the message; Shift+Enter inserts newline
 *   (matching ChatInput.tsx pattern)
 * - Paperclip button opens a hidden file input; selected files stored in local state
 * - File validation uses validateFiles and readFilesAsBase64 from fileUploadUtils.ts
 * - Send button disabled when textarea is empty/whitespace AND no files attached,
 *   OR when disabled prop is true
 * - On send: clears textarea, clears files, calls onSend(text, processedFiles)
 */

import { useState, useRef, useCallback } from 'react';
import { Paperclip } from 'lucide-react';
import { MentionInput } from './MentionInput';
import { FileAttachmentBar } from './FileAttachmentBar';
import { validateFiles, readFilesAsBase64, ACCEPTED_MIME_TYPES } from '../../utils/fileUploadUtils';
import type { FileAttachment } from '../../api/chatV2Api';
import styles from './ChatInputBar.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface ChatInputBarProps {
  /** Callback when a message is sent (text and optional file attachments) */
  onSend: (text: string, files?: FileAttachment[]) => void;
  /** Whether the input bar is disabled */
  disabled?: boolean;
  /** If provided, only show these personas in the @-mention dropdown */
  allowedPersonaIds?: string[];
  /** Callback when a persona is selected via @-mention */
  onPersonaSelected: (personaId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function ChatInputBar({
  onSend,
  disabled = false,
  allowedPersonaIds,
  onPersonaSelected,
}: ChatInputBarProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if send is possible
  const trimmedText = text.trim();
  const canSend = (trimmedText.length > 0 || files.length > 0) && !disabled;

  /**
   * Handle sending the message.
   * Reads files as base64, calls onSend, then clears state.
   */
  const handleSend = useCallback(async () => {
    if (!canSend) return;

    let processedFiles: FileAttachment[] = [];

    if (files.length > 0) {
      try {
        processedFiles = await readFilesAsBase64(files);
      } catch (err) {
        console.error('Failed to read files:', err);
        return;
      }
    }

    onSend(trimmedText, processedFiles);

    // Clear state after send
    setText('');
    setFiles([]);
  }, [canSend, trimmedText, files, onSend]);

  /**
   * Handle submit from MentionInput (Enter without Shift).
   */
  const handleSubmit = useCallback(() => {
    handleSend();
  }, [handleSend]);

  /**
   * Handle file selection from the hidden file input.
   */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles || selectedFiles.length === 0) return;

      const newFiles = Array.from(selectedFiles);

      // Validate files
      const validation = validateFiles(files, newFiles);
      if (!validation.valid) {
        alert(validation.error);
        // Reset the file input so the same file can be re-selected
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      setFiles((prev) => [...prev, ...newFiles]);

      // Reset the file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [files]
  );

  /**
   * Handle removing a file from the attachment list.
   */
  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Open the hidden file input dialog.
   */
  const handleAttachClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  return (
    <div className={styles.container} data-testid="chat-input-bar">
      {/* File attachment chips */}
      <FileAttachmentBar files={files} onRemove={handleRemoveFile} />

      {/* Input row: textarea + buttons */}
      <div className={styles.inputRow}>
        <MentionInput
          value={text}
          onChange={setText}
          onPersonaSelected={onPersonaSelected}
          allowedPersonaIds={allowedPersonaIds}
          disabled={disabled}
          onSubmit={handleSubmit}
        />

        <div className={styles.actions}>
          {/* Paperclip button: opens hidden file input */}
          <button
            type="button"
            className={styles.attachButton}
            onClick={handleAttachClick}
            disabled={disabled}
            aria-label="Attach files"
            data-testid="chat-attach-button"
          >
            <Paperclip size={18} />
          </button>

          {/* Send button */}
          <button
            type="button"
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            data-testid="chat-send-button"
          >
            Send
          </button>
        </div>
      </div>

      {/* Hidden file input for file selection */}
      <input
        ref={fileInputRef}
        type="file"
        className={styles.hiddenFileInput}
        onChange={handleFileChange}
        accept={ACCEPTED_MIME_TYPES}
        multiple
        data-testid="chat-file-input"
      />
    </div>
  );
}
