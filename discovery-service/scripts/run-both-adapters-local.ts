/**
 * Local harness: runs spring-boot adapter FIRST, then spring-classic V3
 * FrameworkPack SECOND, on the SAME shared IR produced by `javaLangPack`.
 * Mirrors the live registration order so we can confirm whether running
 * both in sequence loses spring-classic output.
 *
 * V3 migration state (Spec: V3 Discovery Pipeline Foundation, Task Group 6):
 *   - spring-classic is now a V3 FrameworkPack (`springClassicFrameworkPack`).
 *     We invoke it via `.adapt(irFiles, runId, techHints)` — NOT via V2
 *     `pack.enrich()`.
 *   - spring-boot has NOT migrated yet (it remains the V2
 *     `javaSpringBootPackV2`). Spec 4 will migrate it. For now we keep the
 *     comparison by calling the underlying `runSpringBootAdapter` directly
 *     on the shared IR — this matches what the V2 pack does internally and
 *     avoids pulling the full V2 `pack.enrich()` machinery into this dev
 *     aid.
 *   - The IR itself is produced via the V3 `javaLangPack` so both adapters
 *     see identical input (previously this harness called `extractJavaIR`
 *     directly; the V3 LanguagePack wraps that same code path).
 *
 * Usage (from discovery-service/):
 *   npx tsx scripts/run-both-adapters-local.ts <path-to-repo>
 */
import * as fs from 'fs';
import * as path from 'path';
import { javaLangPack } from '../src/services/extensionPacks/languagePacks/javaLangPack';
import { springClassicFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack';
import { runSpringBootAdapter } from '../src/services/extensionPacks/frameworkAdapters/springBoot';
import type { SourceFileIR } from '../src/services/extensionPacks/languageIR';

const INCLUDE_PATHS = ['api/src/main/java', 'web/src/main/java'];
const EXCLUDE_PATTERNS: RegExp[] = [
  /\/test\//, /Test\.java$/, /\/generated\//,
  /^api\/src\/main\/resources\//, /^tools\//, /^liquibase\//,
];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.gradle', '.mvn']);

/**
 * Walks `repoDir` and returns a Map<relPath, contents> of .java files under
 * `INCLUDE_PATHS` that don't match `EXCLUDE_PATTERNS`. Exported for tests.
 */
export function collectJavaSourceFiles(repoDir: string): Map<string, string> {
  const out = new Map<string, string>();
  function walk(abs: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.java')) {
        const rel = path.relative(repoDir, full).replace(/\\/g, '/');
        if (!INCLUDE_PATHS.some((p) => rel.startsWith(p + '/'))) continue;
        if (EXCLUDE_PATTERNS.some((re) => re.test(rel))) continue;
        try {
          out.set(rel, fs.readFileSync(full, 'utf-8'));
        } catch (err) {
          console.warn(`  read-throw: ${rel} :: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  walk(repoDir);
  return out;
}

function summarize(label: string, candidates: Array<{ candidateType: string }>) {
  const byType = new Map<string, number>();
  for (const c of candidates) byType.set(c.candidateType, (byType.get(c.candidateType) ?? 0) + 1);
  console.log(`[${label}] total=${candidates.length}`);
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t}: ${n}`);
  }
}

function main() {
  const repoDir = process.argv[2];
  if (!repoDir || !fs.existsSync(repoDir)) {
    console.error('Usage: tsx scripts/run-both-adapters-local.ts <path-to-repo>');
    process.exit(2);
  }

  console.log(`[harness] Walking ${repoDir} ...`);
  const sourceFiles = collectJavaSourceFiles(repoDir);
  console.log(`[harness] Candidate files: ${sourceFiles.size}`);

  // --- Stage 1: V3 javaLangPack extracts Universal IR --------------------
  // Use Spring-Boot-shaped techHints here so `filterJavaFiles` matches —
  // the Java LanguagePack treats Java files the same regardless of which
  // framework triggers it.
  const techHintsBoot = {
    '0': { language: 'Java' as const },
    '1': { technology: 'Spring Boot' as const },
  };
  const irFiles: Map<string, SourceFileIR> = javaLangPack.extract(sourceFiles, techHintsBoot);
  console.log(`[harness] IRs extracted via javaLangPack: ${irFiles.size}`);
  const irArray = Array.from(irFiles.values());

  // === Simulate live pipeline order: spring-boot FIRST (V2 still), then
  // spring-classic SECOND (V3 FrameworkPack) on the SAME shared IR. ===
  console.log('');
  console.log('--- Running spring-boot adapter (first; still V2, underlying runSpringBootAdapter) ---');
  let springBootOut;
  try { springBootOut = runSpringBootAdapter(irArray, 'harness'); }
  catch (err) { console.error(`spring-boot THREW: ${err instanceof Error ? err.stack : err}`); process.exit(1); }
  summarize('spring-boot', springBootOut);

  console.log('');
  console.log('--- Running spring-classic V3 FrameworkPack (second, on SAME IR) ---');
  let springClassicOut;
  try {
    const techHintsClassic = {
      '0': { language: 'Java' as const },
      '1': { technology: 'Spring' as const },
    };
    springClassicOut = springClassicFrameworkPack.adapt(irFiles, 'harness', techHintsClassic);
  }
  catch (err) { console.error(`spring-classic THREW: ${err instanceof Error ? err.stack : err}`); process.exit(1); }
  summarize('spring-classic', springClassicOut);

  console.log('');
  console.log('--- Overlap diagnostic ---');
  const bootSignatures = new Set(springBootOut.map((c) => `${c.candidateType}:${c.name}:${c.sourceClusterIds[0]}`));
  const overlap = springClassicOut.filter((c) => bootSignatures.has(`${c.candidateType}:${c.name}:${c.sourceClusterIds[0]}`));
  const unique = springClassicOut.length - overlap.length;
  console.log(`spring-classic candidates overlapping with spring-boot by (type,name,file): ${overlap.length}`);
  console.log(`spring-classic candidates unique to spring-classic:                      ${unique}`);
}

// Only auto-run when invoked as a script (not when imported by tests).
if (require.main === module) {
  main();
}
