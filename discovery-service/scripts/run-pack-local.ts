/**
 * Generic local harness that runs the V3 discovery pack pipeline against a
 * local repo checkout. Bypasses LLM — reports adapter output directly. Used
 * to pre-validate pack coverage before committing to an expensive discovery
 * run.
 *
 * V3-only (Spec: V3 Pack Migration Batch — Task Groups 1 + 11):
 *   1. `findLanguagePack(techHints).extract(sourceFiles, techHints)` produces
 *      a `Map<filePath, SourceFileIR>` (Stage 1).
 *   2. Every matching FrameworkPack from `findFrameworkPacks(techHints)` is
 *      invoked via `pack.adapt(irFiles, runId, techHints)` (Stage 2).
 *
 * The V2 fallback path was removed when the last `<framework>PackV2/`
 * directory was deleted — every pack now has a V3 equivalent.
 *
 * Output includes per-pack candidate counts plus enough per-candidate detail
 * (`type`, `name`, `filePath`, `_addedBy`) to support the identity-equality
 * spot-check used by the OpenMRS parity acceptance.
 *
 * Usage (from discovery-service/):
 *   npx tsx scripts/run-pack-local.ts <path-to-repo> <coreTech> [subfolder]
 *
 * Examples:
 *   npx tsx scripts/run-pack-local.ts C:/tmp/openmrs "Java, Spring"
 *   npx tsx scripts/run-pack-local.ts C:/tmp/petclinic "Java, Spring Boot"
 *   npx tsx scripts/run-pack-local.ts C:/tmp/saleor "Python, Django" saleor
 */
import * as fs from 'fs';
import * as path from 'path';
import '../src/services/extensionPacks/register';
import { parseCoretech } from '../src/utils/coreTechParser';
import {
  findLanguagePack,
  findFrameworkPacks,
  computeTier,
} from '../src/services/extensionPackRegistry';
import type { DiscoveryCandidate } from '../src/types/candidate';

const SOURCE_EXTENSIONS = new Set([
  '.java', '.kt', '.scala', '.groovy',
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.rb', '.go', '.rs', '.cs',
  '.xml', '.yml', '.yaml', '.sql',
  '.graphql', '.gql', '.proto',
  '.php', '.c', '.cc', '.cpp', '.h', '.hpp',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', 'target', 'out',
  '.gradle', '.mvn', '.idea', '.vscode', '__pycache__',
  'vendor', 'bin', 'obj', 'changelog', 'changesets', 'migrations',
]);

const DEFAULT_EXCLUDES: RegExp[] = [
  /\/test\//i, /\/tests\//i, /Tests?\.(java|ts|tsx|js|jsx|py|rb|go|cs|php)$/i,
  /\.spec\.(ts|tsx|js|jsx)$/i, /\.test\.(ts|tsx|js|jsx)$/i,
];

const FILE_SIZE_CAP = 512 * 1024; // 512KB per file, to avoid massive generated/vendored files

/**
 * Walks a repo directory and returns a Map<relPath, contents> of source files.
 * Exported for testability.
 */
export function walkRepo(root: string, subfolder?: string): Map<string, string> {
  const scanRoot = subfolder ? path.join(root, subfolder) : root;
  const out = new Map<string, string>();
  let tooBig = 0, excluded = 0, readErr = 0;

  function recurse(abs: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        recurse(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (DEFAULT_EXCLUDES.some((re) => re.test(rel))) { excluded++; continue; }
        let stats: fs.Stats;
        try { stats = fs.statSync(full); } catch { readErr++; continue; }
        if (stats.size > FILE_SIZE_CAP) { tooBig++; continue; }
        try {
          const content = fs.readFileSync(full, 'utf-8');
          out.set(rel, content);
        } catch { readErr++; }
      }
    }
  }
  recurse(scanRoot);
  if (tooBig || excluded || readErr) {
    console.log(`  [walk] excluded=${excluded}, tooBig=${tooBig} (>${FILE_SIZE_CAP}), readErr=${readErr}`);
  }
  return out;
}

/**
 * Per-framework-pack result returned by `runHarness`. Used by tests and the
 * CLI reporter to emit candidate counts per registered FrameworkPack.
 */
export interface PackRunResult {
  /** Pack id (e.g. `spring-classic`, `java-spring-boot`). */
  packId: string;
  /** How the pack was invoked. V3-only: always `v3-framework-pack.adapt`. */
  invokedVia: 'v3-framework-pack.adapt';
  /** Candidates emitted by this pack. */
  candidates: DiscoveryCandidate[];
  /** Wall-clock duration for this pack's invocation (ms). */
  durationMs: number;
}

/**
 * Aggregate harness result. Tests use this to assert that the harness
 * invoked `LanguagePack.extract` and `FrameworkPack.adapt`.
 */
export interface HarnessResult {
  /** Tier computed from the techHints (A / B / C). */
  tier: 'A' | 'B' | 'C';
  /** LanguagePack id that matched (or null if none). */
  languagePackId: string | null;
  /** Number of files for which the LanguagePack produced IR. */
  irFileCount: number;
  /** Per-pack results (V3 FrameworkPacks). */
  packResults: PackRunResult[];
  /** Flat list of all candidates emitted across every pack. */
  allCandidates: DiscoveryCandidate[];
}

/**
 * Harness input parameters. `runId` defaults to `"local-harness"` when not
 * provided.
 */
export interface HarnessInput {
  sourceFiles: Map<string, string>;
  coreTech: string;
  runId?: string;
}

/**
 * Core harness entry point, exported for testability.
 *
 * Runs `LanguagePack.extract()` then every matching `FrameworkPack.adapt()`.
 * V2 packs no longer exist — see V3 Pack Migration Batch Task Groups 1 + 11.
 */
export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  const runId = input.runId ?? 'local-harness';
  const techHints = parseCoretech(input.coreTech);
  const tier = computeTier(techHints);

  // --- Stage 1: LanguagePack.extract -------------------------------------
  const languagePack = findLanguagePack(techHints);
  let irFiles = new Map<string, ReturnType<NonNullable<typeof languagePack>['extract']> extends Map<infer _K, infer V> ? V : never>();
  if (languagePack) {
    irFiles = languagePack.extract(input.sourceFiles, techHints) as typeof irFiles;
  }

  const packResults: PackRunResult[] = [];

  // --- Stage 2: FrameworkPack.adapt --------------------------------------
  const frameworkPacks = findFrameworkPacks(techHints);
  for (const pack of frameworkPacks) {
    const t0 = Date.now();
    try {
      const candidates = pack.adapt(irFiles as Map<string, any>, runId, techHints);
      packResults.push({
        packId: pack.id,
        invokedVia: 'v3-framework-pack.adapt',
        candidates,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      console.error(`[${pack.id}] V3 adapt THREW:`, err instanceof Error ? err.message : err);
      packResults.push({
        packId: pack.id,
        invokedVia: 'v3-framework-pack.adapt',
        candidates: [],
        durationMs: Date.now() - t0,
      });
    }
  }

  const allCandidates = packResults.flatMap((p) => p.candidates);

  return {
    tier,
    languagePackId: languagePack?.id ?? null,
    irFileCount: irFiles.size,
    packResults,
    allCandidates,
  };
}

/**
 * Extract identity tuple (type, name, filePath, _addedBy) from a candidate —
 * this is the shape used by the OpenMRS identity-equality spot-check.
 */
function identityTuple(c: DiscoveryCandidate): {
  type: string;
  name: string;
  filePath: string;
  _addedBy: string;
} {
  return {
    type: c.candidateType,
    name: c.name,
    filePath: c.sourceClusterIds[0] ?? '(no-file)',
    _addedBy:
      ((c.data as Record<string, unknown> | undefined)?._addedBy as string | undefined) ?? '(unknown)',
  };
}

/**
 * Print a human-readable summary of a HarnessResult. Exported so tests can
 * exercise the reporter without spinning up a full CLI run.
 */
export function printHarnessReport(result: HarnessResult): void {
  console.log(`[harness] tier=${result.tier}  languagePack=${result.languagePackId ?? '(none)'}  irFiles=${result.irFileCount}`);

  for (const pr of result.packResults) {
    console.log(`[${pr.packId}] (${pr.invokedVia}) emitted ${pr.candidates.length} in ${pr.durationMs}ms`);
    const byType = new Map<string, number>();
    for (const c of pr.candidates) byType.set(c.candidateType, (byType.get(c.candidateType) ?? 0) + 1);
    for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${t}: ${n}`);
    }
  }

  console.log('');
  console.log(`=== TOTAL ${result.allCandidates.length} candidates across ${result.packResults.length} pack(s) ===`);
  const byAddedBy = new Map<string, number>();
  for (const c of result.allCandidates) {
    const tag = identityTuple(c)._addedBy;
    byAddedBy.set(tag, (byAddedBy.get(tag) ?? 0) + 1);
  }
  for (const [src, n] of [...byAddedBy.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    _addedBy=${src}: ${n}`);
  }

  // Per-candidate detail sufficient for (type, name, filePath, _addedBy)
  // identity-equality spot-check. Limit to first 15 per pack to keep the
  // log readable.
  console.log('');
  console.log('=== sample candidates (first 15 per pack) ===');
  for (const pr of result.packResults) {
    if (pr.candidates.length === 0) continue;
    console.log(`[${pr.packId}]`);
    for (const c of pr.candidates.slice(0, 15)) {
      const t = identityTuple(c);
      console.log(`  - type=${t.type}  name=${t.name}  file=${t.filePath}  _addedBy=${t._addedBy}`);
    }
  }
}

async function main() {
  const [, , repoDir, coreTech, subfolder] = process.argv;
  if (!repoDir || !coreTech) {
    console.error('Usage: tsx scripts/run-pack-local.ts <path-to-repo> <coreTech> [subfolder]');
    process.exit(2);
  }
  if (!fs.existsSync(repoDir)) {
    console.error(`Repo directory does not exist: ${repoDir}`);
    process.exit(2);
  }

  console.log(`[harness] repo=${repoDir}  coreTech="${coreTech}"  subfolder=${subfolder ?? '(root)'}`);
  const techHints = parseCoretech(coreTech);
  console.log(`[harness] techHints: ${JSON.stringify(techHints)}`);

  const walkStart = Date.now();
  const sourceFiles = walkRepo(repoDir, subfolder);
  console.log(`[harness] sourceFiles: ${sourceFiles.size} files read in ${Date.now() - walkStart}ms`);

  const result = await runHarness({ sourceFiles, coreTech });

  if (result.packResults.length === 0 && result.languagePackId === null) {
    console.log('[harness] No V3 LanguagePack or FrameworkPacks matched. Exiting.');
    return;
  }

  printHarnessReport(result);
}

// Only auto-run when invoked as a script (not when imported by tests).
if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
