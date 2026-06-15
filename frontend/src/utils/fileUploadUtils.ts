/**
 * File Upload Utilities
 *
 * Provides file validation and base64 reading utilities for inline file attachment
 * in the SA and PM chat panels.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * Task Group 3: Frontend ChatRequest Update and File Reading Utilities
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 3: Added .xlsx and .xlsm extensions and MIME types
 */

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of files allowed per message */
export const MAX_FILES = 10;

/** Maximum size of a single file in bytes (5 MB) */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum total size of all attached files in bytes (20 MB) */
export const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024;

/** Accepted file extensions for upload */
export const ACCEPTED_EXTENSIONS: string[] = [
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.pdf',
  '.xlsx',
  '.xlsm',
];

/**
 * Corresponding MIME type string for the HTML file input `accept` attribute.
 * Covers all accepted text, image, document, and spreadsheet formats.
 */
export const ACCEPTED_MIME_TYPES =
  'text/plain,text/markdown,text/csv,application/json,application/x-yaml,text/yaml,text/xml,application/xml,image/png,image/jpeg,image/gif,image/svg+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12';

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates a set of new files against upload constraints.
 *
 * Checks:
 * 1. Combined count of existing + new files does not exceed MAX_FILES
 * 2. Each new file's extension is in ACCEPTED_EXTENSIONS
 * 3. Each new file's size does not exceed MAX_FILE_SIZE_BYTES
 * 4. Combined total size of existing + new files does not exceed MAX_TOTAL_SIZE_BYTES
 *
 * @param existingFiles - Files already attached (for count and size accumulation)
 * @param newFiles - New files being added
 * @returns `{ valid: true }` or `{ valid: false, error: '<specific message>' }`
 */
export function validateFiles(
  existingFiles: File[],
  newFiles: File[]
): { valid: boolean; error?: string } {
  // Check combined count
  const totalCount = existingFiles.length + newFiles.length;
  if (totalCount > MAX_FILES) {
    return {
      valid: false,
      error: `Maximum ${MAX_FILES} files allowed`,
    };
  }

  // Check each new file's extension
  for (const file of newFiles) {
    const extension = getFileExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return {
        valid: false,
        error: `Unsupported file type: ${file.name}`,
      };
    }
  }

  // Check each new file's size
  for (const file of newFiles) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File exceeds 5 MB limit: ${file.name}`,
      };
    }
  }

  // Check combined total size
  const existingTotalSize = existingFiles.reduce((sum, f) => sum + f.size, 0);
  const newTotalSize = newFiles.reduce((sum, f) => sum + f.size, 0);
  if (existingTotalSize + newTotalSize > MAX_TOTAL_SIZE_BYTES) {
    return {
      valid: false,
      error: `Total file size exceeds 20 MB limit`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Base64 File Reading
// ============================================================================

/**
 * Reads an array of files as base64-encoded strings.
 *
 * Uses `FileReader.readAsDataURL` for each file, then strips the
 * `data:<mimeType>;base64,` prefix to produce raw base64 data.
 *
 * @param files - Array of File objects to read
 * @returns Promise resolving to array of `{ filename, mimeType, base64 }` objects
 * @throws Error if any file read fails, with a descriptive message including the filename
 */
export async function readFilesAsBase64(
  files: File[]
): Promise<Array<{ filename: string; mimeType: string; base64: string }>> {
  const results: Array<{ filename: string; mimeType: string; base64: string }> = [];

  for (const file of files) {
    try {
      const base64 = await readSingleFileAsBase64(file);
      results.push({
        filename: file.name,
        mimeType: file.type,
        base64,
      });
    } catch (err) {
      throw new Error(`Failed to read file: ${file.name}`);
    }
  }

  return results;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Extracts the lowercase file extension from a filename (e.g., ".pdf", ".txt").
 * Returns empty string if no extension is found.
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) {
    return '';
  }
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Reads a single file as base64 using FileReader.readAsDataURL.
 * Strips the `data:<mimeType>;base64,` prefix from the result.
 *
 * @param file - The File to read
 * @returns Promise resolving to the raw base64 string (without data URI prefix)
 */
function readSingleFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the "data:<mimeType>;base64," prefix
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex >= 0) {
        resolve(dataUrl.slice(commaIndex + 1));
      } else {
        // Fallback: return the full string if no comma found (unlikely)
        resolve(dataUrl);
      }
    };
    reader.onerror = () => {
      reject(new Error(`FileReader error for ${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}
