/**
 * Scan Plan Builder
 *
 * Builds a prioritized scan plan from 1a evidence atoms and 1b relationships.
 * Identifies architecturally interesting files (those with symbol atoms) and
 * excludes boilerplate files (those with only file_structure atoms).
 *
 * Priority is determined by a combination of symbol count and inbound import
 * count from 1b relationships. Files with more symbols and more inbound imports
 * are ranked higher, as they are more architecturally central.
 *
 * Data flow position: 1a atoms + 1b relationships -> **scan plan** -> LLM file analysis
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { EvidenceAtom, FileStructureData, SymbolData } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import { DISCOVERY_FILE_LINE_LIMIT } from '../config';

/**
 * A single entry in the scan plan, representing a file to be sent to LLM analysis.
 */
export interface ScanPlanEntry {
  /** Absolute or relative file path */
  filePath: string;
  /** Number of lines in the file (from file_structure atom, or 0 if unknown) */
  lineCount: number;
  /** Number of symbol atoms (class, interface, method, annotation, etc.) in the file */
  symbolCount: number;
  /** Number of inbound import relationships targeting this file from 1b relationships */
  inboundImportCount: number;
  /** Human-readable summary of 1a atoms for this file (e.g., "3 classes, 12 methods") */
  atomSummary: string;
  /** Human-readable summary of 1b relationship context for this file */
  relationshipContext: string;
}

/**
 * Options for filtering the scan plan based on discovery config.
 */
export interface ScanPlanFilterOptions {
  /** If provided, only files under one of these path prefixes are included */
  includePaths?: string[];
  /** If provided, files matching these path prefixes are excluded */
  excludePaths?: string[];
}

/**
 * File basenames excluded from LLM analysis in the scan plan.
 * These files generate massive numbers of spurious symbol atoms via ctags
 * (every JSON property becomes a symbol) and produce noisy candidates.
 * They remain in 1a atoms for dependency awareness but are not sent to the LLM.
 */
export const EXCLUDED_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-lock.json',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'package.json',
  'shrinkwrap.json',
  'npm-shrinkwrap.json',
]);

/**
 * File extensions excluded from LLM analysis in the scan plan.
 * ctags extracts every JSON property as a "string" symbol, inflating priority
 * scores and producing non-architectural candidates. Lock files similarly.
 */
export const EXCLUDED_EXTENSIONS = new Set([
  '.json',
  '.lock',
]);

/**
 * Checks if a file path should be excluded from the scan plan for LLM analysis.
 */
function isExcludedFromLlmAnalysis(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (EXCLUDED_FILENAMES.has(basename)) return true;
  const ext = path.extname(filePath).toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(ext)) return true;
  return false;
}

/**
 * Checks if a file path matches any of the exclude path patterns.
 * Supports glob-style `**` suffix (prefix matching) and exact matches.
 */
export function isExcludedByPaths(filePath: string, excludePaths: string[]): boolean {
  if (excludePaths.length === 0) return false;
  const normalized = filePath.replace(/\\/g, '/');
  return excludePaths.some(pattern => {
    // Strip trailing /** or /* glob for prefix matching
    const stripped = pattern.replace(/\\/g, '/').replace(/\/\*\*?$/, '');
    return normalized === stripped || normalized.startsWith(stripped + '/');
  });
}

/**
 * Checks if a file path is under at least one of the include paths.
 * Uses forward-slash normalized prefix matching.
 */
export function isUnderIncludePaths(filePath: string, includePaths: string[]): boolean {
  if (includePaths.length === 0) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return includePaths.some(prefix => {
    const normalizedPrefix = prefix.replace(/\\/g, '/').replace(/\/$/, '');
    return normalized === normalizedPrefix || normalized.startsWith(normalizedPrefix + '/');
  });
}

/**
 * Symbol atom kinds that indicate an architecturally interesting file.
 * Files containing at least one atom with a `kind` in this set are included
 * in the scan plan. Files with only file_structure atoms are excluded.
 */
const SYMBOL_KINDS = new Set([
  'class',
  'interface',
  'method',
  'function',
  'annotation',
  'property',
  'variable',
  'constant',
  'enum',
  'struct',
  'module',
  'namespace',
  'type',
  'import',
  'export',
  'constructor',
  'field',
  'delegate',
  'event',
  'prototype',
  'member',
]);

/**
 * Determines if an evidence atom represents a symbol (architecturally interesting).
 * Symbol atoms have type 'symbol' and their data includes a `kind` field.
 */
function isSymbolAtom(atom: EvidenceAtom): boolean {
  return atom.type === 'symbol';
}

/**
 * Builds a human-readable atom summary string for a file.
 * Groups atoms by kind and produces a string like "3 classes, 12 methods, 2 interfaces".
 */
function buildAtomSummaryString(atoms: EvidenceAtom[]): string {
  const kindCounts = new Map<string, number>();

  for (const atom of atoms) {
    if (atom.type === 'symbol') {
      const kind = (atom.data as SymbolData).kind || 'unknown';
      kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);
    } else if (atom.type === 'string_pattern') {
      kindCounts.set('pattern', (kindCounts.get('pattern') || 0) + 1);
    }
  }

  if (kindCounts.size === 0) {
    return 'no symbols';
  }

  const parts: string[] = [];
  for (const [kind, count] of kindCounts.entries()) {
    parts.push(`${count} ${kind}${count !== 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}

/**
 * Builds a human-readable relationship context string for a file.
 * Summarizes inbound and outbound relationship counts.
 */
function buildRelationshipContextString(
  filePath: string,
  relationships: EvidenceRelationship[],
  atomIdToFile: Map<string, string>
): string {
  let inboundCount = 0;
  let outboundCount = 0;

  for (const rel of relationships) {
    const sourceFile = atomIdToFile.get(rel.sourceAtomId);
    const targetFile = atomIdToFile.get(rel.targetAtomId);

    if (targetFile === filePath && sourceFile !== filePath) {
      inboundCount++;
    }
    if (sourceFile === filePath && targetFile !== filePath) {
      outboundCount++;
    }
  }

  const parts: string[] = [];
  if (inboundCount > 0) {
    parts.push(`imported by ${inboundCount} file${inboundCount !== 1 ? 's' : ''}`);
  }
  if (outboundCount > 0) {
    parts.push(`exports used by ${outboundCount} file${outboundCount !== 1 ? 's' : ''}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no relationships';
}

/**
 * Computes the inbound import count for a file from 1b relationships.
 * Counts relationships where the target atom belongs to this file and the
 * relationship type is 'imports'.
 */
function computeInboundImportCount(
  filePath: string,
  relationships: EvidenceRelationship[],
  atomIdToFile: Map<string, string>
): number {
  let count = 0;
  for (const rel of relationships) {
    if (rel.relationshipType === 'imports') {
      const targetFile = atomIdToFile.get(rel.targetAtomId);
      const sourceFile = atomIdToFile.get(rel.sourceAtomId);
      if (targetFile === filePath && sourceFile !== filePath) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Builds a scan plan from 1a evidence atoms and 1b relationships.
 *
 * Filters out files that contain only `file_structure` atoms (boilerplate files
 * like package.json, .gitignore, lock files). Includes files that have at least
 * one symbol atom. Prioritizes files by symbol count + inbound import count.
 *
 * @param atoms - 1a evidence atoms array
 * @param relationships - 1b relationships array
 * @returns Prioritized array of ScanPlanEntry objects, sorted by
 *          (symbolCount + inboundImportCount) descending
 */
export function buildScanPlan(
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[],
  filterOptions?: ScanPlanFilterOptions
): ScanPlanEntry[] {
  const startTime = Date.now();
  const includePaths = filterOptions?.includePaths || [];
  const excludePaths = filterOptions?.excludePaths || [];
  console.log(`[ScanPlanBuilder] Building scan plan from ${atoms.length} atoms and ${relationships.length} relationships...`);
  console.log(`[ScanPlanBuilder] Filter: includePaths=${JSON.stringify(includePaths)}, excludePaths=${JSON.stringify(excludePaths)}`);

  // Group atoms by filePath
  const atomsByFile = new Map<string, EvidenceAtom[]>();
  const atomIdToFile = new Map<string, string>();

  for (const atom of atoms) {
    const existing = atomsByFile.get(atom.filePath) || [];
    existing.push(atom);
    atomsByFile.set(atom.filePath, existing);
    atomIdToFile.set(atom.id, atom.filePath);
  }

  const totalFilesWithAtoms = atomsByFile.size;
  console.log(`[ScanPlanBuilder] ${totalFilesWithAtoms} unique files found across all atoms`);

  // Count atom types for diagnostics
  const atomTypeCounts: Record<string, number> = {};
  for (const atom of atoms) {
    atomTypeCounts[atom.type] = (atomTypeCounts[atom.type] || 0) + 1;
  }
  console.log(`[ScanPlanBuilder] Atom type distribution: ${JSON.stringify(atomTypeCounts)}`);

  const entries: ScanPlanEntry[] = [];
  let skippedNoSymbols = 0;
  let skippedNotInIncludePaths = 0;
  let skippedExcludedFile = 0;
  let skippedExcludedPath = 0;

  for (const [filePath, fileAtoms] of atomsByFile.entries()) {
    // Filter 1: includePaths — file must be under at least one include path
    if (includePaths.length > 0 && !isUnderIncludePaths(filePath, includePaths)) {
      skippedNotInIncludePaths++;
      continue;
    }

    // Filter 2: excludePaths — file must not match any exclude pattern
    if (isExcludedByPaths(filePath, excludePaths)) {
      skippedExcludedPath++;
      continue;
    }

    // Filter 3: excluded filenames/extensions (lock files, JSON, etc.)
    if (isExcludedFromLlmAnalysis(filePath)) {
      skippedExcludedFile++;
      continue;
    }

    // Filter 3: include files with at least one symbol atom
    const symbolAtoms = fileAtoms.filter(isSymbolAtom);
    if (symbolAtoms.length === 0) {
      skippedNoSymbols++;
      continue;
    }

    // Get line count from file_structure atom if available
    const fileStructureAtom = fileAtoms.find(a => a.type === 'file_structure');
    const lineCount = fileStructureAtom
      ? (fileStructureAtom.data as FileStructureData).lineCount
      : 0;

    const symbolCount = symbolAtoms.length;
    const inboundImportCount = computeInboundImportCount(filePath, relationships, atomIdToFile);
    const atomSummary = buildAtomSummaryString(fileAtoms);
    const relationshipContext = buildRelationshipContextString(filePath, relationships, atomIdToFile);

    entries.push({
      filePath,
      lineCount,
      symbolCount,
      inboundImportCount,
      atomSummary,
      relationshipContext,
    });
  }

  console.log(`[ScanPlanBuilder] ${entries.length} files included, ${skippedNotInIncludePaths} skipped (not in includePaths), ${skippedExcludedPath} skipped (excludePaths), ${skippedExcludedFile} skipped (excluded file type), ${skippedNoSymbols} skipped (no symbols)`);

  // Sort by priority: symbolCount + inboundImportCount descending
  entries.sort((a, b) => {
    const priorityA = a.symbolCount + a.inboundImportCount;
    const priorityB = b.symbolCount + b.inboundImportCount;
    return priorityB - priorityA;
  });

  // Log priority score distribution
  if (entries.length > 0) {
    const scores = entries.map(e => e.symbolCount + e.inboundImportCount);
    const maxScore = scores[0];
    const minScore = scores[scores.length - 1];
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const totalLines = entries.reduce((sum, e) => sum + e.lineCount, 0);
    console.log(`[ScanPlanBuilder] Priority scores: max=${maxScore}, min=${minScore}, avg=${avgScore}. Total lines across all files: ${totalLines}`);
  }

  const duration = Date.now() - startTime;
  console.log(`[ScanPlanBuilder] Scan plan complete in ${duration}ms: ${entries.length} files prioritized`);

  return entries;
}

/**
 * Source file extensions considered architecturally interesting for LLM analysis.
 * Used by the filesystem-based scan plan builder when no 1a atoms are available
 * (service-scoped discovery runs).
 */
export const SOURCE_EXTENSIONS = new Set([
  '.java', '.kt', '.scala', '.groovy',
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.rb', '.go', '.rs', '.cs',
  '.xml', '.yml', '.yaml', '.sql',
  '.graphql', '.gql', '.proto',
  // API/data contracts — bug-fix 2026-05-21 (Issue 1). Previously WSDL was
  // picked up implicitly via .xml but WADL + XSD were dropped entirely, so
  // any service exposing REST/WADL or schema-only XSD contracts produced
  // zero candidates from those files. The walker is already recursive
  // (descends every non-skipped directory), so this whitelist change alone
  // is sufficient — contract files anywhere in the tree are now scanned.
  '.wsdl', '.wadl', '.xsd',
]);

/**
 * Directory names to skip during filesystem walk.
 */
export const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'build', 'dist', 'target', 'out',
  '.gradle', '.mvn', '.idea', '.vscode', '__pycache__',
  'vendor', 'bin', 'obj',
  // Migration/changelog directories — schema is captured via JPA entities
  'changelog', 'changesets', 'migrations',
]);

/**
 * Builds a scan plan by walking the filesystem directly.
 * Used for service-scoped discovery runs where no 1a atoms exist.
 * Discovers source files under the given directory and builds minimal
 * ScanPlanEntry objects (no atom summaries or relationship context).
 *
 * @param repoDir - The root directory to walk
 * @param subfolder - Optional subfolder to scope the walk to
 * @param filterOptions - Optional include/exclude path filters
 */
export async function buildScanPlanFromFilesystem(
  repoDir: string,
  subfolder?: string,
  filterOptions?: ScanPlanFilterOptions
): Promise<ScanPlanEntry[]> {
  const startTime = Date.now();
  const scanRoot = subfolder ? path.join(repoDir, subfolder) : repoDir;
  const includePaths = filterOptions?.includePaths || [];
  const excludePaths = filterOptions?.excludePaths || [];

  console.log(`[ScanPlanBuilder:fs] Walking filesystem at ${scanRoot}...`);
  console.log(`[ScanPlanBuilder:fs] Filter: includePaths=${JSON.stringify(includePaths)}, excludePaths=${JSON.stringify(excludePaths)}`);

  const entries: ScanPlanEntry[] = [];
  let isFirstWalk = true;

  async function walk(dir: string): Promise<void> {
    let dirEntries;
    try {
      dirEntries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the failure — swallowing readdir errors silently was the
      // reason misconfigured scan roots (wrong path, file:// prefix, typo,
      // permissions) produced "0 candidates" with no diagnostic.
      // Scan-root failures are elevated to `error`; descendant failures are
      // kept at `warn` since they are often benign (permission on a single
      // subfolder) and could be noisy in large trees.
      if (isFirstWalk) {
        console.error(`[ScanPlanBuilder:fs] readdir FAILED at scan root "${dir}": ${msg}`);
      } else {
        console.warn(`[ScanPlanBuilder:fs] readdir failed at "${dir}": ${msg}`);
      }
      return;
    } finally {
      isFirstWalk = false;
    }

    for (const dirent of dirEntries) {
      const fullPath = path.join(dir, dirent.name);

      if (dirent.isDirectory()) {
        if (SKIP_DIRECTORIES.has(dirent.name)) continue;
        await walk(fullPath);
      } else if (dirent.isFile()) {
        const ext = path.extname(dirent.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        if (isExcludedFromLlmAnalysis(dirent.name)) continue;

        // Compute relative path from repoDir (not scanRoot) for consistency
        const relativePath = path.relative(repoDir, fullPath).replace(/\\/g, '/');

        // Apply include/exclude filters on relative path
        if (includePaths.length > 0 && !isUnderIncludePaths(relativePath, includePaths)) continue;
        if (isExcludedByPaths(relativePath, excludePaths)) continue;

        entries.push({
          filePath: relativePath,
          lineCount: 0,
          symbolCount: 0,
          inboundImportCount: 0,
          atomSummary: 'filesystem scan (no prior atoms)',
          relationshipContext: 'no relationships',
        });
      }
    }
  }

  await walk(scanRoot);

  // Sort alphabetically for deterministic ordering
  entries.sort((a, b) => a.filePath.localeCompare(b.filePath));

  const duration = Date.now() - startTime;
  console.log(`[ScanPlanBuilder:fs] Filesystem scan complete in ${duration}ms: ${entries.length} source files found`);

  return entries;
}
