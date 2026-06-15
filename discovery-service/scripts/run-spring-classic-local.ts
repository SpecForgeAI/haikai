/**
 * Local harness for the V3 spring-classic pack pair (`javaLangPack` +
 * `springClassicFrameworkPack`).
 *
 * V3 shape (Spec: V3 Discovery Pipeline Foundation, Task Group 6):
 *   1. `javaLangPack.extract(sourceFiles, techHints)` produces the
 *      `Map<filePath, SourceFileIR>` — this replaces the direct call to
 *      `extractJavaIR` + `filterJavaFiles` + `isTestFile` the V2 shape used.
 *   2. `springClassicFrameworkPack.adapt(irFiles, runId, techHints)` emits
 *      `DiscoveryCandidate[]` tagged `_addedBy: 'spring-classic-adapter'`.
 *
 * Skips the LLM and all surrounding discovery-service infrastructure —
 * produces a candidate breakdown + identity-tuple sample output
 * (`type`, `name`, `filePath`, `_addedBy`) sufficient for the OpenMRS
 * identity-equality spot-check used by Task Group 7 acceptance.
 *
 * Usage (from discovery-service/):
 *   npx tsx scripts/run-spring-classic-local.ts <path-to-repo>
 *
 * Example — OpenMRS:
 *   git clone --depth 1 https://github.com/openmrs/openmrs-core.git /tmp/openmrs
 *   npx tsx scripts/run-spring-classic-local.ts /tmp/openmrs
 */
import * as fs from 'fs';
import * as path from 'path';
import { javaLangPack } from '../src/services/extensionPacks/languagePacks/javaLangPack';
import { springClassicFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack';
import type { DiscoveryCandidate } from '../src/types/candidate';

// OpenMRS-matching include/exclude — mirror the saved discovery config so
// output is directly comparable to the real run.
const INCLUDE_PATHS = ['api/src/main/java', 'web/src/main/java'];
const EXCLUDE_PATTERNS: RegExp[] = [
  /\/test\//,
  /Test\.java$/,
  /\/generated\//,
  /^api\/src\/main\/resources\//,
  /^tools\//,
  /^liquibase\//,
];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.gradle', '.mvn']);

/**
 * Walks `repoDir` and returns a Map<relPath, contents> of all `.java` files
 * under `INCLUDE_PATHS` that don't match `EXCLUDE_PATTERNS`. Exported for
 * testability.
 */
export function collectJavaSourceMap(repoDir: string): Map<string, string> {
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

/**
 * Run the V3 spring-classic pack pair against a pre-built source-file map.
 * Exported so tests can drive the pack pair without touching the filesystem.
 */
export function runSpringClassicV3(sourceFiles: Map<string, string>, runId = 'local-harness'): {
  irFileCount: number;
  candidates: DiscoveryCandidate[];
  extractMs: number;
  adaptMs: number;
} {
  // Classic-Spring techHints in the shape `parseCoretech` produces.
  const techHints = {
    '0': { language: 'Java' as const },
    '1': { technology: 'Spring' as const },
  };

  const t0 = Date.now();
  const irFiles = javaLangPack.extract(sourceFiles, techHints);
  const extractMs = Date.now() - t0;

  const t1 = Date.now();
  const candidates = springClassicFrameworkPack.adapt(irFiles, runId, techHints);
  const adaptMs = Date.now() - t1;

  return {
    irFileCount: irFiles.size,
    candidates,
    extractMs,
    adaptMs,
  };
}

function main() {
  const repoDir = process.argv[2];
  if (!repoDir) {
    console.error('Usage: tsx scripts/run-spring-classic-local.ts <path-to-repo>');
    process.exit(2);
  }
  if (!fs.existsSync(repoDir)) {
    console.error(`Repo directory does not exist: ${repoDir}`);
    process.exit(2);
  }

  console.log(`[harness] Walking ${repoDir} ...`);
  const sourceFiles = collectJavaSourceMap(repoDir);
  console.log(`[harness] Found ${sourceFiles.size} candidate .java files after include/exclude`);

  let run;
  try {
    run = runSpringClassicV3(sourceFiles);
  } catch (err) {
    console.error(`[harness] V3 pack pair THREW: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  }

  console.log(
    `[harness] Stage 1 (javaLangPack.extract): ${run.irFileCount} IRs in ${run.extractMs}ms`,
  );
  console.log(
    `[harness] Stage 2 (springClassicFrameworkPack.adapt): ${run.candidates.length} candidates in ${run.adaptMs}ms`,
  );

  const byType = new Map<string, number>();
  for (const c of run.candidates) {
    byType.set(c.candidateType, (byType.get(c.candidateType) ?? 0) + 1);
  }

  console.log('');
  console.log(`=== spring-classic V3 adapter RESULT ===`);
  console.log(`Candidates emitted: ${run.candidates.length}`);
  console.log('By type:');
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`);
  }

  // Samples per type (first 3) — retained from the pre-V3 harness for
  // continuity with existing dev workflow.
  console.log('');
  console.log('=== sample candidates (first 3 per type) ===');
  const typeSamples: Record<string, DiscoveryCandidate[]> = {};
  for (const c of run.candidates) {
    const bucket = typeSamples[c.candidateType] ??= [];
    if (bucket.length < 3) bucket.push(c);
  }
  for (const [t, samples] of Object.entries(typeSamples)) {
    console.log(`[${t}]`);
    for (const s of samples) {
      console.log(`  - ${s.name}  @  ${s.sourceClusterIds[0] ?? '?'}`);
    }
  }

  // Identity-tuple detail (type, name, filePath, _addedBy) used by the
  // OpenMRS spot-check acceptance in Task Group 7. Show the first 20
  // across all candidate types — more than the minimum ≥10 required.
  console.log('');
  console.log('=== identity-tuple detail (first 20, for (type,name,filePath,_addedBy) spot-check) ===');
  for (const c of run.candidates.slice(0, 20)) {
    const filePath = c.sourceClusterIds[0] ?? '(no-file)';
    const addedBy =
      ((c.data as Record<string, unknown> | undefined)?._addedBy as string | undefined) ??
      '(unknown)';
    console.log(`  - type=${c.candidateType}  name=${c.name}  file=${filePath}  _addedBy=${addedBy}`);
  }

  // Interface/endpoint distribution — the historical OpenMRS gap target.
  const interfaces = run.candidates.filter((c) => c.candidateType === 'interfaces');
  const endpoints = run.candidates.filter((c) => c.candidateType === 'endpoints');
  console.log('');
  console.log(`=== interface / endpoint detail ===`);
  console.log(`interfaces: ${interfaces.length}`);
  for (const i of interfaces.slice(0, 20)) console.log(`  - ${i.name} @ ${i.sourceClusterIds[0]}`);
  console.log(`endpoints: ${endpoints.length}`);
  for (const e of endpoints.slice(0, 20)) console.log(`  - ${e.name} @ ${e.sourceClusterIds[0]}`);
}

// Only auto-run when invoked as a script (not when imported by tests).
if (require.main === module) {
  main();
}
