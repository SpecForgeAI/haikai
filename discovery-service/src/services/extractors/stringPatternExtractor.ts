import * as fs from 'fs/promises';
import * as path from 'path';
import { EvidenceAtom } from '../../types/evidenceAtom';
import { generateEvidenceId } from '../../utils/evidenceId';
import { DEFAULT_STRING_PATTERNS, StringPatternDef } from '../../constants/extractionDefaults';
import {
  shouldIncludeFile,
  hasBinaryExtension,
  exceedsMaxFileSize,
  hasNullBytes,
} from '../../utils/fileFilter';

/**
 * String/Pattern Sub-Extractor
 *
 * Iterates over source files in the cloned repository, reading each file
 * and matching content line-by-line against the default string pattern set.
 * Produces one `string_pattern` evidence atom per match.
 *
 * Shares the same include/exclude filtering logic as the file structure
 * extractor to ensure consistent file coverage.
 */

/**
 * Options for the string pattern extractor.
 */
export interface StringPatternExtractorOptions {
  repoDir: string;
  runId: string;
  repoUrl: string;
  includePaths?: string[];
  excludePaths?: string[];
  patterns?: StringPatternDef[];
}

/**
 * Recursively walks a directory and collects file entries for pattern matching.
 * Applies the same filtering rules as the file structure extractor.
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
    console.warn(`[StringPatternExtractor] Cannot read directory ${dir}:`, error);
    return results;
  }

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
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
 * Checks whether a pattern should be applied to a file based on
 * the pattern's optional fileExtensions filter.
 *
 * @param relativePath - The file's relative path
 * @param pattern - The string pattern definition
 * @returns true if the pattern applies to this file
 */
function patternAppliesToFile(relativePath: string, pattern: StringPatternDef): boolean {
  if (!pattern.fileExtensions || pattern.fileExtensions.length === 0) {
    return true; // No extension filter means the pattern applies to all files
  }
  const ext = path.extname(relativePath).toLowerCase();
  return pattern.fileExtensions.includes(ext);
}

/**
 * Extracts string pattern evidence atoms from a cloned repository.
 *
 * @param options - Extraction options including repo directory, run ID, filter paths, and optional custom patterns
 * @returns Array of string_pattern evidence atoms
 */
export async function extractStringPatterns(
  options: StringPatternExtractorOptions
): Promise<EvidenceAtom[]> {
  const {
    repoDir,
    runId,
    repoUrl,
    includePaths,
    excludePaths,
    patterns = DEFAULT_STRING_PATTERNS,
  } = options;

  const atoms: EvidenceAtom[] = [];
  const now = new Date().toISOString();

  const files = await walkDirectory(repoDir, repoDir, includePaths, excludePaths);

  for (const { relativePath, absolutePath } of files) {
    // Skip binary files
    if (hasBinaryExtension(relativePath)) {
      continue;
    }

    try {
      const stats = await fs.stat(absolutePath);

      // Skip files exceeding size limit
      if (exceedsMaxFileSize(stats.size)) {
        continue;
      }

      const buffer = await fs.readFile(absolutePath);

      // Skip binary files detected by null-byte check in first 8KB
      const checkSlice = buffer.subarray(0, 8192);
      if (hasNullBytes(checkSlice)) {
        continue;
      }

      const content = buffer.toString('utf-8');
      const lines = content.split('\n');

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineText = lines[lineIndex];
        const lineNumber = lineIndex + 1; // 1-based

        for (const pattern of patterns) {
          // Check if this pattern applies to this file's extension
          if (!patternAppliesToFile(relativePath, pattern)) {
            continue;
          }

          const match = pattern.regex.exec(lineText);
          if (match) {
            const matchedText = match[0];
            const contextSnippet = lineText.trim().substring(0, 200); // Trim and cap length

            const distinguishingKey = `${pattern.patternName}:${lineNumber}:${matchedText}`;
            const id = generateEvidenceId(runId, repoUrl, relativePath, 'string_pattern', distinguishingKey);

            atoms.push({
              id,
              runId,
              repoUrl,
              filePath: relativePath,
              type: 'string_pattern',
              data: {
                patternName: pattern.patternName,
                matchedText,
                line: lineNumber,
                contextSnippet,
              },
              extractedAt: now,
            });
          }
        }
      }
    } catch (error) {
      // Skip files that cannot be read (permissions, encoding)
      console.warn(`[StringPatternExtractor] Cannot process file ${relativePath}:`, error);
    }
  }

  return atoms;
}
