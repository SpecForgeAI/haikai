/**
 * Gap Analysis Tests for Multi-File Upload + URL References (Frontend)
 *
 * Spec: 2026-02-17 Multi-File Upload + URL References for SA and PM Chat
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests cover critical edge cases and boundary conditions not addressed
 * by Task Groups 3-4 tests:
 *
 * Gap 1: validateFiles accepts exactly 10 files (boundary -- at the limit, should succeed)
 * Gap 2: validateFiles rejects 11th file addition (boundary -- one over limit)
 * Gap 3: validateFiles rejects file with no extension
 * Gap 4: readFilesAsBase64 handles empty files array (returns empty array)
 * Gap 5: validateFiles accepts file at exactly 5 MB (boundary -- at the limit, should succeed)
 */

import { describe, it, expect } from 'vitest';
import {
  validateFiles,
  readFilesAsBase64,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
} from '../utils/fileUploadUtils';

/**
 * Helper to create a mock File object with a given name, size, and MIME type.
 */
function createMockFile(name: string, sizeInBytes: number, type: string): File {
  const content = new ArrayBuffer(sizeInBytes);
  return new File([content], name, { type });
}

describe('Multi-File Upload Gap Tests (Frontend)', () => {
  // =========================================================================
  // Gap 1: validateFiles accepts exactly 10 files (boundary)
  // =========================================================================
  it('validateFiles should accept exactly 10 files (at the MAX_FILES limit)', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      createMockFile(`file-${i}.txt`, 100, 'text/plain')
    );

    const result = validateFiles([], files);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // =========================================================================
  // Gap 2: validateFiles rejects 11th file addition (boundary)
  // =========================================================================
  it('validateFiles should reject when adding 1 file to an existing 10 (11th file rejected)', () => {
    const existingFiles = Array.from({ length: 10 }, (_, i) =>
      createMockFile(`existing-${i}.txt`, 100, 'text/plain')
    );
    const newFile = [createMockFile('one-too-many.txt', 100, 'text/plain')];

    const result = validateFiles(existingFiles, newFile);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('10');
  });

  // =========================================================================
  // Gap 3: validateFiles rejects file with no extension
  // =========================================================================
  it('validateFiles should reject a file with no extension', () => {
    const noExtFile = createMockFile('Dockerfile', 512, 'application/octet-stream');

    const result = validateFiles([], [noExtFile]);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported file type');
    expect(result.error).toContain('Dockerfile');
  });

  // =========================================================================
  // Gap 4: readFilesAsBase64 with empty array returns empty array
  // =========================================================================
  it('readFilesAsBase64 should return an empty array when given no files', async () => {
    const results = await readFilesAsBase64([]);

    expect(results).toEqual([]);
    expect(results.length).toBe(0);
  });

  // =========================================================================
  // Gap 5: validateFiles accepts file at exactly 5 MB (boundary)
  // =========================================================================
  it('validateFiles should accept a file at exactly the 5 MB size limit', () => {
    const exactlyAtLimit = createMockFile('big-doc.pdf', MAX_FILE_SIZE_BYTES, 'application/pdf');

    const result = validateFiles([], [exactlyAtLimit]);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
