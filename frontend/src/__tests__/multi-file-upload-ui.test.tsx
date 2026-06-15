/**
 * Multi-File Upload UI Component Tests
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * Task Group 4: UI Components -- Inline File Attachment in SA and PM Chat Panels
 *
 * Tests the file attachment UI behaviors using a simplified test approach
 * that validates the core interaction patterns without rendering the full
 * chat panels (which require extensive mocking of API calls, contexts, etc.).
 *
 * Tests:
 * 1. Attach Files button triggers the hidden file input when clicked
 * 2. File chips render for each selected file showing the filename
 * 3. Clicking the X button on a file chip removes that file from the selection
 * 4. Send button is enabled when files are attached but input text is empty
 * 5. Send button is disabled when both input text is empty and no files are attached
 * 6. File validation error is displayed in the error banner when an invalid file is selected
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { validateFiles, ACCEPTED_MIME_TYPES } from '../utils/fileUploadUtils';

/**
 * Helper to create a mock File object with a given name, size, and MIME type.
 */
function createMockFile(name: string, sizeInBytes: number, type: string): File {
  const content = new ArrayBuffer(sizeInBytes);
  return new File([content], name, { type });
}

/**
 * Simplified test component that mimics the file attachment UI pattern
 * used in both SolutionArchitectChatPanel and ProductManagerChatPanel.
 *
 * This component implements the exact same state management and JSX structure
 * as the real panels, but without the conversation rehydration, API calls,
 * and context dependencies that make rendering the full panels complex.
 */
function FileAttachmentTestHarness() {
  const [attachedFiles, setAttachedFiles] = React.useState<File[]>([]);
  const [inputDraft, setInputDraft] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading] = React.useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleAttachFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    const newFiles = Array.from(event.target.files);
    const result = validateFiles(attachedFiles, newFiles);
    if (!result.valid) {
      setError(result.error!);
      return;
    }
    setAttachedFiles((prev) => [...prev, ...newFiles]);
    // Reset input value so re-selecting the same file works
    event.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const canSend = inputDraft.trim() !== '' || attachedFiles.length > 0;

  return (
    <div data-testid="test-container">
      {/* Error banner */}
      {error && (
        <div data-testid="error-banner">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            data-testid="error-dismiss"
          >
            x
          </button>
        </div>
      )}

      {/* File chips container */}
      {attachedFiles.length > 0 && (
        <div data-testid="file-chips-container">
          {attachedFiles.map((file, index) => (
            <span key={`${file.name}-${index}`} data-testid="file-chip">
              {file.name}
              <button
                data-testid={`file-chip-remove-${index}`}
                onClick={() => handleRemoveFile(index)}
                aria-label={`Remove ${file.name}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <form data-testid="chat-form">
        <input
          type="text"
          value={inputDraft}
          onChange={(e) => setInputDraft(e.target.value)}
          placeholder="Type a message..."
          disabled={loading}
          data-testid="chat-input"
        />
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept={ACCEPTED_MIME_TYPES}
          onChange={handleAttachFiles}
          style={{ display: 'none' }}
          data-testid="hidden-file-input"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          data-testid="attach-button"
        >
          Attach Files
        </button>
        <button
          type="submit"
          disabled={loading || !canSend}
          data-testid="send-button"
        >
          Send
        </button>
      </form>
    </div>
  );
}

describe('Task Group 4: UI Components -- Inline File Attachment', () => {
  // ==========================================================================
  // Test 1: Attach Files button triggers the hidden file input when clicked
  // ==========================================================================
  describe('Test 1: Attach Files button triggers the hidden file input when clicked', () => {
    it('should trigger click on the hidden file input when the Attach Files button is clicked', async () => {
      render(React.createElement(FileAttachmentTestHarness));

      const attachButton = screen.getByTestId('attach-button');
      const hiddenInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;

      // Spy on the hidden input's click method
      const clickSpy = vi.spyOn(hiddenInput, 'click');

      await userEvent.click(attachButton);

      expect(clickSpy).toHaveBeenCalledTimes(1);
      clickSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Test 2: File chips render for each selected file showing the filename
  // ==========================================================================
  describe('Test 2: File chips render for each selected file showing the filename', () => {
    it('should render a file chip with the filename for each attached file', async () => {
      render(React.createElement(FileAttachmentTestHarness));

      const hiddenInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;

      // Create mock files and fire change event on the hidden input
      const file1 = createMockFile('readme.txt', 1024, 'text/plain');
      const file2 = createMockFile('screenshot.png', 2048, 'image/png');
      const file3 = createMockFile('document.pdf', 4096, 'application/pdf');

      // Simulate selecting files
      fireEvent.change(hiddenInput, {
        target: { files: [file1, file2, file3] },
      });

      // File chips should appear
      const chips = screen.getAllByTestId('file-chip');
      expect(chips).toHaveLength(3);

      // Each chip should show its filename
      expect(chips[0].textContent).toContain('readme.txt');
      expect(chips[1].textContent).toContain('screenshot.png');
      expect(chips[2].textContent).toContain('document.pdf');
    });
  });

  // ==========================================================================
  // Test 3: Clicking the X button on a file chip removes that file
  // ==========================================================================
  describe('Test 3: Clicking the X button on a file chip removes that file from the selection', () => {
    it('should remove the correct file when its X button is clicked', async () => {
      render(React.createElement(FileAttachmentTestHarness));

      const hiddenInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;

      const file1 = createMockFile('readme.txt', 1024, 'text/plain');
      const file2 = createMockFile('screenshot.png', 2048, 'image/png');
      const file3 = createMockFile('document.pdf', 4096, 'application/pdf');

      fireEvent.change(hiddenInput, {
        target: { files: [file1, file2, file3] },
      });

      // Verify 3 chips exist
      expect(screen.getAllByTestId('file-chip')).toHaveLength(3);

      // Remove the middle file (screenshot.png at index 1)
      const removeButton = screen.getByTestId('file-chip-remove-1');
      await userEvent.click(removeButton);

      // Now only 2 chips should remain
      const remainingChips = screen.getAllByTestId('file-chip');
      expect(remainingChips).toHaveLength(2);

      // The remaining chips should be readme.txt and document.pdf
      expect(remainingChips[0].textContent).toContain('readme.txt');
      expect(remainingChips[1].textContent).toContain('document.pdf');
    });
  });

  // ==========================================================================
  // Test 4: Send button is enabled when files are attached but input text is empty
  // ==========================================================================
  describe('Test 4: Send button is enabled when files are attached but input text is empty', () => {
    it('should enable the Send button when files are attached even without any input text', () => {
      render(React.createElement(FileAttachmentTestHarness));

      const sendButton = screen.getByTestId('send-button') as HTMLButtonElement;
      const hiddenInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;

      // Initially, send should be disabled (no text, no files)
      expect(sendButton.disabled).toBe(true);

      // Attach a file
      const file = createMockFile('notes.md', 512, 'text/markdown');
      fireEvent.change(hiddenInput, {
        target: { files: [file] },
      });

      // Send button should now be enabled (file attached, no text)
      expect(sendButton.disabled).toBe(false);
    });
  });

  // ==========================================================================
  // Test 5: Send button is disabled when both input text is empty and no files
  // ==========================================================================
  describe('Test 5: Send button is disabled when both input text is empty and no files are attached', () => {
    it('should disable the Send button when there is no text and no files attached', () => {
      render(React.createElement(FileAttachmentTestHarness));

      const sendButton = screen.getByTestId('send-button') as HTMLButtonElement;
      const chatInput = screen.getByTestId('chat-input') as HTMLInputElement;

      // Initially: no text, no files -- send should be disabled
      expect(sendButton.disabled).toBe(true);
      expect(chatInput.value).toBe('');
    });
  });

  // ==========================================================================
  // Test 6: File validation error is displayed in the error banner
  // ==========================================================================
  describe('Test 6: File validation error is displayed in the error banner when an invalid file is selected', () => {
    it('should show an error banner when a file with unsupported type is selected', () => {
      render(React.createElement(FileAttachmentTestHarness));

      const hiddenInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;

      // Attempt to attach an .exe file (unsupported)
      const exeFile = createMockFile('malware.exe', 1024, 'application/x-msdownload');
      fireEvent.change(hiddenInput, {
        target: { files: [exeFile] },
      });

      // Error banner should appear with the validation error
      const errorBanner = screen.getByTestId('error-banner');
      expect(errorBanner).toBeTruthy();
      expect(errorBanner.textContent).toContain('Unsupported file type');
      expect(errorBanner.textContent).toContain('malware.exe');

      // No file chips should be rendered (the file was rejected)
      expect(screen.queryByTestId('file-chips-container')).toBeNull();
    });
  });
});
