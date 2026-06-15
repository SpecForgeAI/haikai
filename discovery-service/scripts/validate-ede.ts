/**
 * Offline validation harness for Spec 1 — the Endpoint->Data-Effect Call Graph
 * (Spring Classic). Runs the PURE static-extraction seam against a real
 * checkout of the classic Spring PetClinic (or any Java/Spring tree):
 *
 *   Stage 1: javaLangPack.extract(sourceFiles, techHints)  -> IR map
 *   Stage 2: springClassicFrameworkPack.adapt(irFiles, runId, techHints)
 *            (runs endpointDataEffectResolver + endpointDataEffectCandidates)
 *   Findings: runSpringClassicFindingScanner({ irFiles, packCandidates, runId })
 *            (emits endpoint_data_effect_unresolved findings)
 *
 * NO services started. NO AMS / MCP. NO DB. Pure file-read + in-memory parse.
 *
 * Usage:
 *   npx tsx scripts/validate-ede.ts <path-to-java-repo-root>
 */

import * as fs from 'fs';
import * as path from 'path';

import { javaLangPack } from '../src/services/extensionPacks/languagePacks/javaLangPack/index';
import { springClassicFrameworkPack } from '../src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack/index';
import { runSpringClassicFindingScanner } from '../src/services/findings/packFindingScanners/springClassicFindingScanner';
import { resolveEndpointDataEffects } from '../src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import type { TechHints } from '../src/services/extensionPacks/packTypes';
import type { SourceFileIR } from '../src/services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../src/types/candidate';

// Java + Spring Classic techHints (one field per hint — see parseCoretech /
// matchesPredicate per-field AND semantics; matches the unit-test shape).
const TECH_HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

function repoRoot(): string {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx scripts/validate-ede.ts <path-to-java-repo-root>');
    process.exit(2);
  }
  return path.resolve(arg);
}

/** Recursively load every *.java file under root into Map<filePath, source>. */
function loadJavaFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules' || e.name === 'target') continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.java')) {
        try {
          out.set(full, fs.readFileSync(full, 'utf8'));
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  return out;
}

function asData(c: DiscoveryCandidate): Record<string, any> {
  return (c.data ?? {}) as Record<string, any>;
}

function main(): void {
  const root = repoRoot();
  console.log(`\n=== EDE VALIDATION HARNESS ===`);
  console.log(`repo root: ${root}\n`);

  const sourceFiles = loadJavaFiles(root);
  console.log(`Loaded ${sourceFiles.size} .java files.\n`);

  // ---- Stage 1: language extraction (Java IR) ----
  const irFiles: Map<string, SourceFileIR> = javaLangPack.extract(sourceFiles, TECH_HINTS);

  // ---- Stage 2: framework adapt (emits endpoint_data_effects candidates) ----
  const candidates = springClassicFrameworkPack.adapt(irFiles, 'validate-run', TECH_HINTS);

  // ---- Findings: unresolved-chain scanner ----
  const findings = runSpringClassicFindingScanner({
    runId: 'validate-run',
    irFiles,
    packCandidates: candidates,
  });

  // Also call the resolver directly for the full resolved+unresolved split
  // (the adapter only surfaces `resolved` as candidates; the scanner only
  // surfaces `unresolved` as findings — calling the resolver gives both at once
  // so we can cross-check counts).
  const direct = resolveEndpointDataEffects(Array.from(irFiles.values()));

  // ==========================================================================
  // (a) endpoint_data_effects candidates
  // ==========================================================================
  const edeCandidates = candidates.filter((c) => c.candidateType === 'endpoint_data_effects');
  console.log(`\n========================================================`);
  console.log(`(a) endpoint_data_effects CANDIDATES: ${edeCandidates.length}`);
  console.log(`========================================================`);
  // Sort by endpoint name then entity for stable reading.
  const sorted = [...edeCandidates].sort((a, b) => {
    const da = asData(a);
    const db = asData(b);
    return (
      String(da.endpointName).localeCompare(String(db.endpointName)) ||
      String(da.dataEntityName).localeCompare(String(db.dataEntityName))
    );
  });
  for (const c of sorted) {
    const d = asData(c);
    const meta = d.path_metadata_json ?? {};
    const hops = (meta.hops ?? []) as Array<Record<string, string>>;
    const hopStr = hops
      .map((h) => `${h.role}:${h.method_id}`)
      .join('  ->  ');
    console.log(
      `\n  • ${d.endpointName}\n` +
        `      entity=${d.dataEntityName}  access=${d.access_mode}  op=${d.operation_hint}  ` +
        `txn=${meta.transactional}  conf=${d.confidence}\n` +
        `      path: ${hopStr}`,
    );
  }

  // ==========================================================================
  // (b) endpoint_data_effect_unresolved findings
  // ==========================================================================
  const unresolvedFindings = findings.filter(
    (f) => f.findingType === 'endpoint_data_effect_unresolved',
  );
  console.log(`\n\n========================================================`);
  console.log(`(b) endpoint_data_effect_unresolved FINDINGS: ${unresolvedFindings.length}`);
  console.log(`========================================================`);
  for (const f of unresolvedFindings) {
    const dj = (f.detailJson ?? {}) as Record<string, any>;
    const stopped = (dj.stoppedAtPath ?? []) as Array<Record<string, string>>;
    const stoppedStr = stopped.map((h) => `${h.role}:${h.method_id}`).join(' -> ');
    console.log(
      `\n  • ${dj.endpoint}\n` +
        `      reason=${dj.reason}\n` +
        `      detail=${dj.detail}\n` +
        `      stoppedAt: ${stoppedStr}`,
    );
  }

  // ==========================================================================
  // Cross-check + coverage summary
  // ==========================================================================
  console.log(`\n\n========================================================`);
  console.log(`SUMMARY`);
  console.log(`========================================================`);
  console.log(`IR files (parsed): ${irFiles.size}`);
  console.log(`Total candidates emitted: ${candidates.length}`);
  console.log(`  endpoint_data_effects: ${edeCandidates.length}`);
  console.log(`  endpoints: ${candidates.filter((c) => c.candidateType === 'endpoints').length}`);
  console.log(
    `  interfaces: ${candidates.filter((c) => c.candidateType === 'interfaces').length}`,
  );
  console.log(
    `  physical_data_entities: ${candidates.filter((c) => c.candidateType === 'physical_data_entities').length}`,
  );
  console.log(`Resolver direct: resolved=${direct.resolved.length} unresolved=${direct.unresolved.length}`);

  // Inbound-endpoint coverage: list every endpoint candidate, mark whether it
  // has >=1 EDE edge, an unresolved finding, or NOTHING.
  const endpointCands = candidates.filter((c) => c.candidateType === 'endpoints');
  const edgeByEndpoint = new Set(edeCandidates.map((c) => String(asData(c).endpointName)));
  const unresolvedByEndpoint = new Set(
    unresolvedFindings.map((f) => String((f.detailJson as any).endpoint)),
  );
  console.log(`\n--- Inbound endpoint coverage (${endpointCands.length} endpoint candidates) ---`);
  let withEdge = 0;
  let withUnresolved = 0;
  let withNothing = 0;
  const nothingList: string[] = [];
  // Dedupe endpoint candidate names (the adapter may emit dup names across overloads).
  const seenEp = new Set<string>();
  for (const c of endpointCands) {
    const d = asData(c);
    const name = String(d.name ?? `${d.httpMethod} ${d.fullPath}`);
    // The EDE endpointName is `${httpMethod} ${fullPath}`.
    const edeName = `${d.httpMethod} ${d.fullPath}`;
    if (seenEp.has(edeName)) continue;
    seenEp.add(edeName);
    const hasEdge = edgeByEndpoint.has(edeName);
    const hasUnresolved = unresolvedByEndpoint.has(edeName);
    let tag = '';
    if (hasEdge) {
      tag = 'EDGE';
      withEdge++;
    } else if (hasUnresolved) {
      tag = 'UNRESOLVED';
      withUnresolved++;
    } else {
      tag = 'NOTHING';
      withNothing++;
      nothingList.push(edeName + `   (${d.controllerClassName}#${d.methodName})`);
    }
    console.log(`  [${tag}] ${edeName}   (${d.controllerClassName}#${d.methodName})`);
  }
  console.log(
    `\nCoverage: ${withEdge} with >=1 edge, ${withUnresolved} unresolved-finding-only, ${withNothing} nothing.`,
  );
  if (nothingList.length) {
    console.log(`\nEndpoints with NO edge and NO finding:`);
    for (const n of nothingList) console.log(`  - ${n}`);
  }
}

main();
