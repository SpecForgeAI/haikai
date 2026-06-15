import * as path from 'path';
import {
  DEFAULT_EXCLUDED_DIRS,
  BINARY_FILE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from '../constants/extractionDefaults';

/**
 * File Filter Utilities
 *
 * Shared include/exclude logic used by multiple sub-extractors.
 * Applies default directory exclusions, binary file detection,
 * size limits, and Phase 0 config include/exclude paths.
 */

/**
 * Checks whether a file's relative path falls within any of the default
 * excluded directories.
 *
 * @param relativePath - The file path relative to the repo root (forward-slash separated)
 * @returns true if the file is in an excluded directory
 */
export function isInExcludedDir(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.some((part) => DEFAULT_EXCLUDED_DIRS.includes(part));
}

/**
 * Checks whether a file has a binary file extension.
 *
 * @param filePath - The file path (only the extension is examined)
 * @returns true if the file has a binary extension
 */
export function hasBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_FILE_EXTENSIONS.includes(ext);
}

/**
 * Checks for null bytes in a buffer, indicating binary content.
 *
 * @param buffer - The buffer to check (typically the first 8KB of a file)
 * @returns true if null bytes are found
 */
export function hasNullBytes(buffer: Buffer): boolean {
  return buffer.includes(0);
}

/**
 * Determines whether a file should be included in extraction based on
 * Phase 0 config `includePaths` and `excludePaths`, plus default exclusions.
 *
 * Evaluation order:
 * 1. If the file is in a default excluded directory, exclude it.
 * 2. If the file matches any config `excludePaths` prefix, exclude it.
 * 3. If `includePaths` is provided and non-empty, the file must match
 *    at least one include prefix; otherwise it is excluded.
 * 4. Otherwise, include it.
 *
 * @param relativePath - The file path relative to the repo root (forward-slash separated)
 * @param includePaths - Phase 0 config include path prefixes (may be undefined or empty)
 * @param excludePaths - Phase 0 config exclude path prefixes (may be undefined or empty)
 * @returns true if the file should be included in extraction
 */
export function shouldIncludeFile(
  relativePath: string,
  includePaths?: string[],
  excludePaths?: string[]
): boolean {
  // Normalize to forward slashes for consistent matching
  const normalized = relativePath.replace(/\\/g, '/');

  // 1. Check default excluded directories
  if (isInExcludedDir(normalized)) {
    return false;
  }

  // 2. Check config excludePaths
  if (excludePaths && excludePaths.length > 0) {
    for (const excludePrefix of excludePaths) {
      const normalizedPrefix = excludePrefix.replace(/\\/g, '/');
      if (normalized.startsWith(normalizedPrefix) || normalized === normalizedPrefix) {
        return false;
      }
    }
  }

  // 3. Check config includePaths (if provided and non-empty, file must match)
  if (includePaths && includePaths.length > 0) {
    const matchesInclude = includePaths.some((includePrefix) => {
      const normalizedPrefix = includePrefix.replace(/\\/g, '/');
      return normalized.startsWith(normalizedPrefix) || normalized === normalizedPrefix;
    });
    if (!matchesInclude) {
      return false;
    }
  }

  return true;
}

/**
 * Checks whether a file exceeds the maximum file size threshold.
 *
 * @param sizeBytes - The file size in bytes
 * @returns true if the file exceeds MAX_FILE_SIZE_BYTES
 */
export function exceedsMaxFileSize(sizeBytes: number): boolean {
  return sizeBytes > MAX_FILE_SIZE_BYTES;
}
