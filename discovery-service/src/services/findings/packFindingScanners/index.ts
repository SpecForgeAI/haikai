/**
 * Pack-finding scanners barrel + fan-out shim.
 *
 * Spec: 2026-05-16 Wire Java + Spring Classic + Maven Findings (Task Group 1).
 *
 * Each pack scanner (Java in this commit; Spring Classic in Commit 2; Maven
 * lives separately and is invoked from `runManager.ts`) consumes the V3
 * Stage-2 outputs and produces zero or more `FindingEmitInput`s.
 *
 * Wiring shape mirrors `evidenceGapScanner.ts`:
 *   - Each scanner is a pure function: `(input) => FindingEmitInput[]`.
 *   - The shim collects all inputs from all scanners and returns the
 *     concatenated list. The caller (`discoveryV3Pipeline.ts`) is responsible
 *     for passing the list to `findingEmitter.emitFindings`.
 *   - Soft-fail per scanner: one scanner throwing must NOT prevent other
 *     scanners from running, and must NOT abort the discovery run.
 *
 * NOTE on Maven: the Maven scanner is intentionally NOT part of the V3-pipeline
 * fan-out. The Maven resolver runs outside the V3 pipeline (it has its own
 * per-POM walker), so the Maven scanner is invoked separately from
 * `runManager.ts` after `buildRepoLookupTable`. It is re-exported from this
 * module for ergonomic test imports only.
 *
 * Phase 3 (2026-05-17 Spec File Auto-Linking, Task Group 4):
 * --------------------------------------------------------------------------
 * The Workstream A `specFileLinker` scanner is invoked as an additional
 * stage of this fan-out, AFTER the framework-pack-driven candidate scanners
 * (Java + Spring Classic) have run. The linker walks the on-disk repo for
 * standalone OpenAPI / Swagger spec files and either:
 *   - mutates an interface candidate's `data.spec_link` in place when a
 *     unique match exists, OR
 *   - emits `oas_spec_ambiguous_match` / `oas_spec_orphan` findings via the
 *     same return path as every other pack scanner (no parallel emitter --
 *     P-1 / P-12 contract).
 *
 * The linker requires `repoRoot` and `runContext` to be supplied on
 * `PackFindingScannerInput`; when either is absent, the linker stage is
 * skipped cleanly (back-compat for callers that have not yet been wired,
 * e.g. tests that exercise only the Java / Spring scanners).
 */

import type { DiscoveryCandidate } from '../../../types/candidate';
import type { SourceFileIR } from '../../extensionPacks';
import type {
  FindingEmitInput,
  FindingEmitRunContext,
} from '../FindingEmitter';
import { runJavaFindingScanner } from './javaFindingScanner';
import {
  runSpringClassicFindingScanner,
  runSpringClassicScannerWithSoap,
} from './springClassicFindingScanner';
import { runSpecFileLinker } from './specFileLinker';
import { runNonDeterministicEndpointScanner } from './nonDeterministicEndpointScanner';
import { runDeferredSurfaceScanner } from './deferredSurfaceScanner';
import { buildScannerFailedFinding } from '../emissionSources';

/**
 * Input passed to every pack-finding scanner invoked from the V3 pipeline.
 *
 * Carries Stage-1 IR (per file), Stage-2 pack candidates (post-filter), and
 * the run identifiers needed by builders to wire up links. Stage-3 LLM
 * candidates are intentionally NOT included -- pack-finding scanners run
 * post-Stage-2 / before merge, so the LLM output is not yet available.
 *
 * Phase 3 Task Group 4 additions (all optional for back-compat):
 *   - `repoRoot`         absolute path to the cloned-repo root on disk.
 *     Required for the spec-file linker stage; when omitted, the stage is
 *     skipped cleanly.
 *   - `serviceRootPath`  repo-relative service-root prefix used by the linker
 *     to honour P-17 service-scoping (files outside the prefix are not
 *     scanned). `null` (or omitted) means "no scoping".
 *   - `runContext`       per-run scoping (`runId` / `projectId` /
 *     `architectureId`) forwarded into linker emissions so the finding
 *     emitter can associate the findings with the run. Required for the
 *     spec-file linker stage; when omitted, the stage is skipped cleanly.
 */
export interface PackFindingScannerInput {
  /** Discovery run id (for forward compat; the emitter holds the run context). */
  runId: string;
  /** Stage-1 IR keyed by file path. May be empty if no language pack matched. */
  irFiles: Map<string, SourceFileIR>;
  /**
   * Stage-2 pack candidates after the service-scoped post-filter. Used by
   * scanners to resolve `discovery_candidate` link targets by walking
   * `sourceClusterIds` against the IR file path of the detection site.
   *
   * Phase 3 Task Group 4: the spec-file linker MUTATES this array in place
   * (sets `data.spec_link` on matched interface candidates). The mutation is
   * deliberate -- downstream stages (LLM gap-fill, Stage 4 persist) see the
   * updated candidate set without any plumbing changes.
   */
  packCandidates: DiscoveryCandidate[];
  /**
   * Absolute on-disk path to the cloned-repo root, used by the Phase 3
   * spec-file linker stage. Omit (or pass `undefined`) to skip the linker.
   */
  repoRoot?: string;
  /**
   * Repo-relative service-root prefix for P-17 scoping. Pass `null` (or
   * omit) to scan the entire repo. Forwarded into the linker's file walker
   * unchanged.
   */
  serviceRootPath?: string | null;
  /**
   * Per-run scoping forwarded into spec-link findings. Required when
   * `repoRoot` is supplied -- omit BOTH together to skip the linker stage.
   */
  runContext?: FindingEmitRunContext;
}

/**
 * Compact `by_type` summariser for the scanner-end diag log line. Returns a
 * comma-separated list of `type:count` pairs, sorted by descending count then
 * type so the order is stable across runs. Caps at the top 8 types so the
 * line stays one screen wide -- the AMS Findings tab is the source of truth
 * for the long tail.
 */
function summariseByType(findings: FindingEmitInput[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const k = (f.findingType || 'unknown').toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const sorted = Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 8);
  return sorted.map(([t, c]) => `${t}:${c}`).join(',');
}

/**
 * Diagnostic helper -- counts files in the IR map by lowercase extension.
 *
 * Bug-fix 2026-05-22: operators reported that WADL files in real projects
 * were not producing deterministic endpoint findings even after the WADL
 * pack landed. Root cause was an upstream wiring gap (production called
 * the REST-only `runSpringClassicFindingScanner`, never the combined
 * `runSpringClassicScannerWithSoap`). This helper feeds the entry-line
 * diag log so operators can immediately confirm whether contract files
 * reached the IR set in the first place, separating "scan plan didn't
 * include them" from "scanner saw them but emitted nothing".
 */
function countIrFilesByExtension(
  irFiles: Map<string, SourceFileIR>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [filePath] of irFiles) {
    const dotIndex = filePath.lastIndexOf('.');
    const ext =
      dotIndex >= 0 ? filePath.substring(dotIndex).toLowerCase() : '<no-ext>';
    counts[ext] = (counts[ext] ?? 0) + 1;
  }
  return counts;
}

/**
 * Fan out to every registered pack-finding scanner.
 *
 * Each scanner is wrapped in try/catch -- a single scanner throwing logs a
 * warning and lets the remaining scanners run. The shim itself NEVER throws;
 * callers can rely on getting back a (possibly empty) array.
 */
export function runPackFindingScanners(
  input: PackFindingScannerInput,
): FindingEmitInput[] {
  const collected: FindingEmitInput[] = [];

  // Java scanner (Commit 1).
  const javaStart = Date.now();
  console.log(`[diag-pack] scanner=java start files=${input.irFiles.size}`);
  try {
    const javaFindings = runJavaFindingScanner(input);
    collected.push(...javaFindings);
    console.log(
      `[diag-pack] scanner=java elapsed_ms=${Date.now() - javaStart} ` +
        `emitted_total=${javaFindings.length} by_type=${summariseByType(javaFindings)}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[packFindingScanners] javaFindingScanner threw; continuing run:`,
      errMsg,
    );
    console.warn(
      `[diag-pack] scanner=java soft_fail=true category=scanner_threw elapsed_ms=${Date.now() - javaStart}`,
    );
    // W4 (2026-05-30): make the silent drop VISIBLE as a Finding naming the
    // failed scanner. Soft-fail preserved -- the remaining scanners still run.
    collected.push(
      buildScannerFailedFinding({
        scanner: 'javaFindingScanner',
        phase: 'pack_finding_scanner',
        error: errMsg,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Bug-fix 2026-05-22: irFiles extension distribution diagnostic.
  //
  // Production callers (`discoveryV3Pipeline.ts:818`) previously fanned out
  // to `runSpringClassicFindingScanner` ONLY -- the REST emit path. The
  // SOAP peer pass (Spec 2026-05-17) AND the WADL peer pass
  // (Spec 2026-05-21) live behind the combined entry point
  // `runSpringClassicScannerWithSoap`, which was never invoked in
  // production. Both deterministic packs were dead code at runtime; every
  // SOAP / WADL endpoint + interface seen in the dashboard was coming from
  // the LLM analysis step, not the deterministic packs.
  //
  // This diag line surfaces the breadth of the IR set so operators can
  // verify the scan plan actually contains the contract files they care
  // about. If `.wadl` or `.wsdl` counts are 0 here, the upstream scan-plan
  // step is the suspect; if they are > 0 but downstream emit-counts are
  // still 0, the suspect moves to the pack itself.
  // -------------------------------------------------------------------------
  const irExtCounts = countIrFilesByExtension(input.irFiles);
  console.log(
    `[diag-pack-scanner] entry irFiles=${input.irFiles.size} ` +
      `by_ext=${JSON.stringify(irExtCounts)}`,
  );

  // Spring Classic + SOAP + WADL scanners (Commit 2 + 2026-05-17 SOAP +
  // 2026-05-21 WADL bug-fix wiring). The combined entry point runs the
  // REST emit path PLUS the SOAP peer pass PLUS the REST WADL peer pass
  // against the same input; we fan the `findings` AND `wadlFindings`
  // arrays into the collected stream. The SOAP "candidates" arrays
  // (`soapInterfaceCandidates` / `soapEndpointCandidates`) are NOT fanned
  // here -- the V3 pipeline emits SOAP / WADL / XSD candidates via the
  // dedicated `runContractCandidatePasses` call during Stage 2 so they
  // flow into `filteredPackCandidates` BEFORE the merge + persist step
  // (bug-fix 2026-05-22).
  const springStart = Date.now();
  console.log(
    `[diag-pack-scanner] scanner=spring_classic start files=${input.irFiles.size} ` +
      `wadl_files=${irExtCounts['.wadl'] ?? 0} ` +
      `wsdl_files=${irExtCounts['.wsdl'] ?? 0} ` +
      `xsd_files=${irExtCounts['.xsd'] ?? 0}`,
  );
  try {
    const combined = runSpringClassicScannerWithSoap(input);
    collected.push(...combined.findings);
    collected.push(...combined.wadlFindings);
    // Bug-fix 2026-05-28: fan SOAP findings into the collected stream too.
    // Previously dropped on the floor — `buildSoapEvidenceGapFindings` had
    // no call site, and `runSpringClassicScannerWithSoap` never propagated
    // `soap.findings`. Both are fixed; this push completes the wiring.
    collected.push(...combined.soapFindings);
    console.log(
      `[diag-pack-scanner] scanner=spring_classic elapsed_ms=${Date.now() - springStart} ` +
        `emitted_rest=${combined.findings.length} ` +
        `emitted_wadl=${combined.wadlFindings.length} ` +
        `emitted_soap=${combined.soapFindings.length} ` +
        `rest_by_type=${summariseByType(combined.findings)} ` +
        `wadl_by_type=${summariseByType(combined.wadlFindings)} ` +
        `soap_by_type=${summariseByType(combined.soapFindings)} ` +
        `soap_iface_candidates=${combined.soapInterfaceCandidates.length} ` +
        `soap_endpoint_candidates=${combined.soapEndpointCandidates.length}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[packFindingScanners] runSpringClassicScannerWithSoap threw; continuing run:`,
      errMsg,
    );
    console.warn(
      `[diag-pack-scanner] scanner=spring_classic soft_fail=true category=scanner_threw ` +
        `elapsed_ms=${Date.now() - springStart}`,
    );
    // W4: the Spring Classic + SOAP + WADL combined pass is the richest
    // deterministic emitter; a throw here drops a whole framework's
    // endpoints/interfaces. Surface it as a Finding.
    collected.push(
      buildScannerFailedFinding({
        scanner: 'runSpringClassicScannerWithSoap',
        phase: 'pack_finding_scanner',
        error: errMsg,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Spec 2026-05-30 Oracle Integrity & Determinism (Spec #3) Task Group 4:
  // non-deterministic-endpoint scanner. Deterministic Spring / Spring Classic
  // pass that flags endpoints whose handler reaches a source of legitimate
  // runtime variance (@Scheduled / @Cacheable / @Async / @Profile-gated bean /
  // session state / clock / random) so the runtime harness does not false-diff
  // expected variance. Soft-fail at the boundary (W4-aligned) -- a throw here
  // surfaces as a `scanner_failed` Finding and the remaining stages still run.
  // ---------------------------------------------------------------------------
  const nonDetStart = Date.now();
  try {
    const nonDetFindings = runNonDeterministicEndpointScanner(input);
    collected.push(...nonDetFindings);
    console.log(
      `[diag-pack] scanner=non_deterministic_endpoint elapsed_ms=${Date.now() - nonDetStart} ` +
        `emitted_total=${nonDetFindings.length} by_type=${summariseByType(nonDetFindings)}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[packFindingScanners] nonDeterministicEndpointScanner threw; continuing run:`,
      errMsg,
    );
    console.warn(
      `[diag-pack] scanner=non_deterministic_endpoint soft_fail=true category=scanner_threw ` +
        `elapsed_ms=${Date.now() - nonDetStart}`,
    );
    // W4: make the silent drop VISIBLE as a Finding naming the failed scanner.
    collected.push(
      buildScannerFailedFinding({
        scanner: 'nonDeterministicEndpointScanner',
        phase: 'pack_finding_scanner',
        error: errMsg,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Spec 2026-05-30 Inbound Surface Completeness (Spec #4) Task Group 7:
  // deferred-inbound-surface scanner. Deterministic Spring / Spring Classic pass
  // that records the PRESENCE of an inbound entry-point surface v1 deliberately
  // does NOT model (GraphQL / gRPC / WebSocket-STOMP / Spring Batch) as a Finding
  // -- Finding-and-defer, never a silent drop, never a fabricated endpoint.
  // Soft-fail at the boundary (W4-aligned) -- a throw here surfaces as a
  // `scanner_failed` Finding and the remaining stages still run.
  // ---------------------------------------------------------------------------
  const deferredStart = Date.now();
  try {
    const deferredFindings = runDeferredSurfaceScanner(input);
    collected.push(...deferredFindings);
    console.log(
      `[diag-pack] scanner=deferred_inbound_surface elapsed_ms=${Date.now() - deferredStart} ` +
        `emitted_total=${deferredFindings.length} by_type=${summariseByType(deferredFindings)}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[packFindingScanners] deferredSurfaceScanner threw; continuing run:`,
      errMsg,
    );
    console.warn(
      `[diag-pack] scanner=deferred_inbound_surface soft_fail=true category=scanner_threw ` +
        `elapsed_ms=${Date.now() - deferredStart}`,
    );
    // W4: make the silent drop VISIBLE as a Finding naming the failed scanner.
    collected.push(
      buildScannerFailedFinding({
        scanner: 'deferredSurfaceScanner',
        phase: 'pack_finding_scanner',
        error: errMsg,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 3 Task Group 4: spec-file linker stage.
  //
  // Runs AFTER the framework-driven candidate scanners so the linker sees
  // the in-memory interface-candidate set produced by Stage 2. The stage is
  // optional: it requires `repoRoot` + `runContext` to be supplied. When
  // either is omitted, the stage is skipped and the rest of the pipeline
  // is unaffected (back-compat for tests / legacy callers that do not yet
  // thread the new fields).
  //
  // Soft-fail: any scanner exception is caught and downgraded to a warning,
  // matching the per-scanner pattern above. The shim itself NEVER throws.
  // ---------------------------------------------------------------------------
  if (input.repoRoot && input.runContext) {
    const linkerStart = Date.now();
    try {
      const linkerOutput = runSpecFileLinker({
        repoRoot: input.repoRoot,
        serviceRootPath: input.serviceRootPath ?? null,
        // The linker mutates `data.spec_link` on matched interface
        // candidates in place; the returned array is the same reference
        // as the input -- the assignment to `updatedCandidates` is
        // ergonomic only.
        existingInterfaceCandidates: input.packCandidates,
        runContext: input.runContext,
      });
      collected.push(...linkerOutput.findings);
      console.log(
        `[diag-pack] scanner=spec_file_linker elapsed_ms=${Date.now() - linkerStart} ` +
          `emitted_total=${linkerOutput.findings.length} ` +
          `by_type=${summariseByType(linkerOutput.findings)}`,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[packFindingScanners] specFileLinker threw; continuing run:`,
        errMsg,
      );
      console.warn(
        `[diag-pack] scanner=spec_file_linker soft_fail=true category=scanner_threw elapsed_ms=${Date.now() - linkerStart}`,
      );
      // W4: surface a spec-file-linker failure as a Finding.
      collected.push(
        buildScannerFailedFinding({
          scanner: 'specFileLinker',
          phase: 'pack_finding_scanner',
          error: errMsg,
        }),
      );
    }
  }

  return collected;
}

// Re-exports for callers that want a specific scanner by name (tests).
export { runJavaFindingScanner } from './javaFindingScanner';
export { runSpringClassicFindingScanner } from './springClassicFindingScanner';
export { runNonDeterministicEndpointScanner } from './nonDeterministicEndpointScanner';
export { runDeferredSurfaceScanner } from './deferredSurfaceScanner';
export {
  runMavenFindingScanner,
  type MavenFindingScannerInput,
  type MavenPomScannerInput,
} from './mavenFindingScanner';
export { MAX_FINDINGS_PER_TYPE_PER_RUN, EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION } from './constants';
