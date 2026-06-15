import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { EvidenceAtom } from '../../types/evidenceAtom';
import { generateEvidenceId } from '../../utils/evidenceId';
import { DEFAULT_EXCLUDED_DIRS } from '../../constants/extractionDefaults';

const execFileAsync = promisify(execFile);

/**
 * Symbol Sub-Extractor (ctags)
 *
 * Shells out to `universal-ctags --output-format=json --recurse` on the
 * cloned repository directory, parsing JSON output line-by-line to produce
 * one `symbol` evidence atom per tag entry.
 *
 * If the ctags binary is not found (ENOENT), logs a warning and returns
 * an empty array for graceful partial success.
 */

/**
 * Options for the symbol extractor.
 */
export interface SymbolExtractorOptions {
  repoDir: string;
  runId: string;
  repoUrl: string;
}

/**
 * Shape of a single ctags JSON output line.
 */
interface CtagsEntry {
  _type: string;
  name: string;
  path: string;
  pattern?: string;
  kind: string;
  line?: number;
  scope?: string;
  scopeKind?: string;
  language?: string;
}

/**
 * Extracts symbol evidence atoms from a repository using universal-ctags.
 *
 * @param options - Extraction options including repo directory, run ID, and repo URL
 * @returns Array of symbol evidence atoms, or empty array if ctags is unavailable
 */
export async function extractSymbols(
  options: SymbolExtractorOptions
): Promise<EvidenceAtom[]> {
  const { repoDir, runId, repoUrl } = options;

  // Build --exclude flags for default non-source directories
  const excludeArgs: string[] = [];
  for (const dir of DEFAULT_EXCLUDED_DIRS) {
    excludeArgs.push('--exclude=' + dir);
  }

  // Try 'universal-ctags' first, then fall back to 'ctags' (win32 release name)
  const binaryNames = ['universal-ctags', 'ctags'];

  for (const binary of binaryNames) {
    try {
      const { stdout } = await execFileAsync(binary, [
        '--output-format=json',
        '--fields=+nKSl',
        '--recurse',
        ...excludeArgs,
        repoDir,
      ], {
        timeout: 60_000, // 60-second timeout
        maxBuffer: 50 * 1024 * 1024, // 50 MB to handle large repos
      });

      return parseCtagsOutput(stdout, repoDir, runId, repoUrl);
    } catch (error: unknown) {
      if (isEnoentError(error)) {
        // Binary not found, try next name
        continue;
      }
      // For other errors (timeout, parse errors, etc.), log and return empty
      console.warn(`[SymbolExtractor] ${binary} execution failed:`, error);
      return [];
    }
  }

  console.warn(
    '[SymbolExtractor] No ctags binary found (tried: universal-ctags, ctags). ' +
    'Symbol extraction skipped. Install universal-ctags for symbol evidence.'
  );
  return [];
}

/**
 * Parses the JSON-per-line output from ctags.
 *
 * @param stdout - The raw ctags stdout
 * @param repoDir - The repository root directory
 * @param runId - The discovery run UUID
 * @param repoUrl - The repository URL
 * @returns Array of symbol evidence atoms
 */
function parseCtagsOutput(
  stdout: string,
  repoDir: string,
  runId: string,
  repoUrl: string
): EvidenceAtom[] {
  const atoms: EvidenceAtom[] = [];
  const now = new Date().toISOString();
  const lines = stdout.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: CtagsEntry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      // Skip malformed lines
      continue;
    }

    // Only process tag entries (skip program info lines, etc.)
    if (entry._type !== 'tag') continue;

    const relativePath = path.relative(repoDir, entry.path).replace(/\\/g, '/');
    const lineNum = entry.line ?? 0;
    const scope = entry.scope ?? null;
    const language = entry.language ?? 'unknown';
    const kind = entry.kind ?? 'unknown';

    const distinguishingKey = `${entry.name}:${kind}:${lineNum}`;
    const id = generateEvidenceId(runId, repoUrl, relativePath, 'symbol', distinguishingKey);

    atoms.push({
      id,
      runId,
      repoUrl,
      filePath: relativePath,
      type: 'symbol',
      data: {
        name: entry.name,
        kind,
        line: lineNum,
        scope,
        language,
      },
      extractedAt: now,
    });
  }

  return atoms;
}

/**
 * Type guard for ENOENT errors (binary not found).
 */
function isEnoentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  );
}
