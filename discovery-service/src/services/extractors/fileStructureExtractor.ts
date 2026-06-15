import * as fs from 'fs/promises';
import * as path from 'path';
import { EvidenceAtom } from '../../types/evidenceAtom';
import { generateEvidenceId } from '../../utils/evidenceId';
import {
  shouldIncludeFile,
  hasBinaryExtension,
  hasNullBytes,
  exceedsMaxFileSize,
} from '../../utils/fileFilter';

/**
 * File Structure Sub-Extractor
 *
 * Walks the cloned repository file tree and produces one `file_structure`
 * evidence atom per included source file. Captures file metadata: relative
 * path, extension, size, and line count.
 *
 * Applies filtering:
 * - Skips default excluded directories and Phase 0 excludePaths
 * - Respects Phase 0 includePaths if provided
 * - Skips binary files (extension list + null-byte check in first 8KB)
 * - Skips files exceeding MAX_FILE_SIZE_BYTES (1 MB)
 */

/**
 * Options for the file structure extractor.
 */
export interface FileStructureExtractorOptions {
  repoDir: string;
  runId: string;
  repoUrl: string;
  includePaths?: string[];
  excludePaths?: string[];
}

/**
 * Counts the number of newline characters in a buffer to determine line count.
 * An empty file has 0 lines; a file with content but no trailing newline
 * still counts the last line.
 *
 * @param buffer - File content buffer
 * @returns Number of lines in the file
 */
function countLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) { // newline byte
      count++;
    }
  }
  // If the file doesn't end with a newline, count the last line
  if (buffer[buffer.length - 1] !== 0x0a) {
    count++;
  }
  return count;
}

/**
 * Recursively walks a directory and collects file entries.
 *
 * @param dir - The directory to walk
 * @param baseDir - The base repo directory (for computing relative paths)
 * @param includePaths - Phase 0 config include path prefixes
 * @param excludePaths - Phase 0 config exclude path prefixes
 * @returns Array of { relativePath, absolutePath } for included files
 */
async function walkDirectory(
  dir: string,
  baseDir: string,
  includePaths?: string[],
  excludePaths?: string[]
): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  const results: Array<{ relativePath: string; absolutePath: string }> = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[FileStructureExtractor] Cannot read directory ${dir}:`, error);
    return results;
  }

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      // Check if this directory itself is excluded before recursing
      if (!shouldIncludeFile(relativePath + '/', includePaths, excludePaths)) {
        continue;
      }
      const subResults = await walkDirectory(absolutePath, baseDir, includePaths, excludePaths);
      results.push(...subResults);
    } else if (entry.isFile()) {
      if (shouldIncludeFile(relativePath, includePaths, excludePaths)) {
        results.push({ relativePath, absolutePath });
      }
    }
  }

  return results;
}

/**
 * Extracts file structure evidence atoms from a cloned repository.
 *
 * @param options - Extraction options including repo directory, run ID, and filter paths
 * @returns Array of file_structure evidence atoms
 */
export async function extractFileStructure(
  options: FileStructureExtractorOptions
): Promise<EvidenceAtom[]> {
  const { repoDir, runId, repoUrl, includePaths, excludePaths } = options;
  const atoms: EvidenceAtom[] = [];
  const now = new Date().toISOString();

  const files = await walkDirectory(repoDir, repoDir, includePaths, excludePaths);

  for (const { relativePath, absolutePath } of files) {
    try {
      // Skip binary files by extension
      if (hasBinaryExtension(relativePath)) {
        continue;
      }

      // Get file stats for size check
      const stats = await fs.stat(absolutePath);

      // Skip files exceeding size limit
      if (exceedsMaxFileSize(stats.size)) {
        continue;
      }

      // Read file content for binary check and line count
      const buffer = await fs.readFile(absolutePath);

      // Skip binary files detected by null-byte check in first 8KB
      const checkSlice = buffer.subarray(0, 8192);
      if (hasNullBytes(checkSlice)) {
        continue;
      }

      const extension = path.extname(relativePath);
      const lineCount = countLines(buffer);

      const id = generateEvidenceId(runId, repoUrl, relativePath, 'file_structure', relativePath);

      atoms.push({
        id,
        runId,
        repoUrl,
        filePath: relativePath,
        type: 'file_structure',
        data: {
          relativePath,
          extension,
          sizeBytes: stats.size,
          lineCount,
        },
        extractedAt: now,
      });
    } catch (error) {
      // Skip files that cannot be read (permissions, encoding)
      console.warn(`[FileStructureExtractor] Cannot process file ${relativePath}:`, error);
    }
  }

  return atoms;
}
