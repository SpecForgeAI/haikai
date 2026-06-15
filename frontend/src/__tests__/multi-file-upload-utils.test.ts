/**
 * Multi-File Upload Utility Tests
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * Task Group 3: Frontend ChatRequest Update and File Reading Utilities
 *
 * Tests:
 * 1. validateFiles rejects a file exceeding 5 MB with correct error message
 * 2. validateFiles rejects more than 10 files with correct error message
 * 3. validateFiles rejects unsupported file types (e.g., .exe, .zip) with correct error message
 * 4. validateFiles rejects when total raw size exceeds 20 MB
 * 5. validateFiles accepts a valid mix of text, image, and PDF files within limits
 * 6. readFilesAsBase64 strips the data:...;base64, prefix from the base64 string and returns { filename, mimeType, base64 } for each file
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateFiles,
  readFilesAsBase64,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_SIZE_BYTES,
  ACCEPTED_EXTENSIONS,
} from '../utils/fileUploadUtils';

/**
 * Helper to create a mock File object with a given name, size, and MIME type.
 */
function createMockFile(name: string, sizeInBytes: number, type: string): File {
  // Create a buffer of the specified size
  const content = new ArrayBuffer(sizeInBytes);
  return new File([content], name, { type });
}

describe('Task Group 3: Frontend File Validation and Reading Utilities', () => {
  // ==========================================================================
  // Test 1: validateFiles rejects a file exceeding 5 MB
  // ==========================================================================
  describe('Test 1: validateFiles rejects a file exceeding 5 MB with correct error message', () => {
    it('should reject a single file that exceeds the 5 MB per-file limit', () => {
      const oversizedFile = createMockFile('large-doc.pdf', MAX_FILE_SIZE_BYTES + 1, 'application/pdf');
      const result = validateFiles([], [oversizedFile]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5 MB');
      expect(result.error).toContain('large-doc.pdf');
    });
  });

  // ==========================================================================
  // Test 2: validateFiles rejects more than 10 files
  // ==========================================================================
  describe('Test 2: validateFiles rejects more than 10 files with correct error message', () => {
    it('should reject when combined existing + new files exceed MAX_FILES (10)', () => {
      const existingFiles = Array.from({ length: 6 }, (_, i) =>
        createMockFile(`existing-${i}.txt`, 100, 'text/plain')
      );
      const newFiles = Array.from({ length: 5 }, (_, i) =>
        createMockFile(`new-${i}.txt`, 100, 'text/plain')
      );
      // 6 existing + 5 new = 11, exceeds MAX_FILES of 10
      const result = validateFiles(existingFiles, newFiles);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('10');
    });
  });

  // ==========================================================================
  // Test 3: validateFiles rejects unsupported file types
  // ==========================================================================
  describe('Test 3: validateFiles rejects unsupported file types (e.g., .exe, .zip)', () => {
    it('should reject an .exe file with an unsupported file type error', () => {
      const exeFile = createMockFile('malware.exe', 1024, 'application/x-msdownload');
      const result = validateFiles([], [exeFile]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported file type');
      expect(result.error).toContain('malware.exe');
    });

    it('should reject a .zip file with an unsupported file type error', () => {
      const zipFile = createMockFile('archive.zip', 1024, 'application/zip');
      const result = validateFiles([], [zipFile]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported file type');
      expect(result.error).toContain('archive.zip');
    });
  });

  // ==========================================================================
  // Test 4: validateFiles rejects when total raw size exceeds 20 MB
  // ==========================================================================
  describe('Test 4: validateFiles rejects when total raw size exceeds 20 MB', () => {
    it('should reject when combined total size of existing + new files exceeds 20 MB', () => {
      // 4 existing files at 4 MB each = 16 MB
      const existingFiles = Array.from({ length: 4 }, (_, i) =>
        createMockFile(`existing-${i}.pdf`, 4 * 1024 * 1024, 'application/pdf')
      );
      // 2 new files at 3 MB each = 6 MB; total = 22 MB > 20 MB
      const newFiles = Array.from({ length: 2 }, (_, i) =>
        createMockFile(`new-${i}.pdf`, 3 * 1024 * 1024, 'application/pdf')
      );
      const result = validateFiles(existingFiles, newFiles);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('20 MB');
    });
  });

  // ==========================================================================
  // Test 5: validateFiles accepts a valid mix of text, image, and PDF files
  // ==========================================================================
  describe('Test 5: validateFiles accepts a valid mix of text, image, and PDF files within limits', () => {
    it('should accept valid files of different types within all limits', () => {
      const textFile = createMockFile('readme.txt', 1024, 'text/plain');
      const mdFile = createMockFile('notes.md', 2048, 'text/markdown');
      const csvFile = createMockFile('data.csv', 512, 'text/csv');
      const jsonFile = createMockFile('config.json', 256, 'application/json');
      const pngFile = createMockFile('screenshot.png', 100 * 1024, 'image/png');
      const jpgFile = createMockFile('photo.jpg', 200 * 1024, 'image/jpeg');
      const pdfFile = createMockFile('document.pdf', 500 * 1024, 'application/pdf');

      const result = validateFiles([], [textFile, mdFile, csvFile, jsonFile, pngFile, jpgFile, pdfFile]);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // ==========================================================================
  // Test 6: readFilesAsBase64 strips the data:...;base64, prefix
  // ==========================================================================
  describe('Test 6: readFilesAsBase64 strips the data:...;base64, prefix and returns correct shape', () => {
    it('should strip the data URI prefix and return { filename, mimeType, base64 } for each file', async () => {
      // Create small files with known content
      const textContent = 'Hello, world!';
      const textBlob = new Blob([textContent], { type: 'text/plain' });
      const textFile = new File([textBlob], 'hello.txt', { type: 'text/plain' });

      const pngContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const pngBlob = new Blob([pngContent], { type: 'image/png' });
      const pngFile = new File([pngBlob], 'image.png', { type: 'image/png' });

      const results = await readFilesAsBase64([textFile, pngFile]);

      // Should return array of 2 items
      expect(results).toHaveLength(2);

      // Check first result (text file)
      expect(results[0].filename).toBe('hello.txt');
      expect(results[0].mimeType).toBe('text/plain');
      // The base64 string should NOT contain the data URI prefix
      expect(results[0].base64).not.toContain('data:');
      expect(results[0].base64).not.toContain(';base64,');
      // It should be a non-empty base64 string
      expect(results[0].base64.length).toBeGreaterThan(0);

      // Check second result (PNG file)
      expect(results[1].filename).toBe('image.png');
      expect(results[1].mimeType).toBe('image/png');
      expect(results[1].base64).not.toContain('data:');
      expect(results[1].base64).not.toContain(';base64,');
      expect(results[1].base64.length).toBeGreaterThan(0);
    });
  });
});
