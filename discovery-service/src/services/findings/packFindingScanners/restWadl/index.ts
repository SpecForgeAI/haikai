/**
 * REST WADL sub-module -- public orchestrator entry point.
 *
 * Spec: agent-os/specs/2026-05-21-wadl-deterministic-parser/spec.md
 *
 * ===========================================================================
 * MODULE HEADER (Task Group 5)
 * ===========================================================================
 *
 * Purpose
 * -------
 * Discover REST APIs described by WADL contracts (`*.wadl`) in any codebase
 * scan. Mirrors the springClassicSoap pack 1:1 in module shape (header
 * docblock, log-marker style, soft-fail behaviour, IR walk pattern) but emits
 * `FindingEmitInput[]` only -- no parallel candidate pipeline, all output
 * flows through the existing `FindingEmitter`.
 *
 * Outputs (one stream)
 * --------------------
 *  - Structural findings produced by `wadlEndpointEmitter.emitWadlFindings`:
 *      * `interface_definition` -- one per WADL file (parse success).
 *      * `endpoint`             -- one per `<method>` operation, in document
 *                                  order. Preserves parser ordering.
 *  - Evidence-gap findings produced by `wadlEvidenceGaps.emitWadlEvidenceGaps`:
 *      * `wadl_parse_failed`            -- `fast-xml-parser` threw.
 *      * `wadl_unsupported_namespace`   -- root `<application xmlns>` gate
 *                                          rejected.
 *      * `wadl_missing_grammar`         -- `<grammars><include href>` entry
 *                                          not resolvable in the
 *                                          caller-supplied `relatedFiles`
 *                                          map. One finding per entry; no
 *                                          dedup (spec Q2).
 *      * `wadl_missing_schema_element`  -- `<representation element="X"/>`
 *                                          ref unresolved in any loaded
 *                                          grammar. One per entry.
 *
 * Ordering (spec Q9): per file, structural findings flow first (interface
 * then endpoints in document order), then gap findings flow last. Across
 * multiple WADL files, files are processed in IR-iteration order.
 *
 * Sibling-XSD resolution
 * ----------------------
 * The parser performs `relatedFiles.get(href)` using the literal href string
 * from `<include href="X">`. For a WADL at
 * `src/main/resources/api/foo.wadl` declaring `<include href="xsd0.xsd"/>`,
 * the sibling XSD lives at `src/main/resources/api/xsd0.xsd`. To cover the
 * common Jersey-generated case (href is bare filename, sibling lives next to
 * the WADL) the orchestrator registers every `.xsd` IR entry under multiple
 * key variants for the parser to find:
 *  - the entry's full repo-relative path (e.g. `src/main/resources/api/xsd0.xsd`)
 *  - the entry's basename only (e.g. `xsd0.xsd`)
 *  - the path relative to each WADL's directory (e.g. `./xsd0.xsd` /
 *    `xsd0.xsd` when both live in the same dir)
 *
 * Absolute URLs (`http://...`) are silently skipped by the parser (per D-4)
 * and never appear on `missingGrammars`.
 *
 * Pack activation
 * ---------------
 * Active for ALL discovery runs (no core_tech gating). Empty IR (no `.wadl`
 * files) yields `{ findings: [] }` cleanly.
 *
 * Diagnostics (Group 5.4): structured `[diag-pack] scanner=rest_wadl ...`
 * log lines are written at the following points:
 *  - Start of pass: `start files=<N>` (N = count of `.wadl` IRs).
 *  - Per file parse OK: `wadl_parse=ok path=<rel> operations=<N> interfaces=<N>`.
 *  - Per file parse fail: `wadl_parse=fail path=<rel> reason=<...>`.
 *  - Per gap emission lines are written by the gap-emitter itself (see
 *    `wadlEvidenceGaps.ts`).
 *
 * Soft-fail
 * ---------
 * Per-file errors (anything thrown out of the parser / emitter / gap builder
 * by accident) are caught and downgraded to a warning so a single malformed
 * IR cannot poison the run. `runRestWadlPass` itself NEVER throws.
 */

import type { SourceFileIR } from '../../../extensionPacks';
import type { FindingEmitInput, FindingEmitRunContext } from '../../FindingEmitter';
import type { PackFindingScannerInput } from '../index';
import { parseWadl, type WadlParseResult } from './wadlParser';
import { emitWadlFindings } from './wadlEndpointEmitter';
import { emitWadlEvidenceGaps } from './wadlEvidenceGaps';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Output of the orchestrated REST WADL pass. Carries a single `findings`
 * stream -- structural emissions concatenated with gap emissions in spec-Q9
 * order. No candidate pipeline; all WADL output flows through the existing
 * `FindingEmitter` (spec Q7).
 */
export interface RestWadlPassOutput {
  findings: FindingEmitInput[];
}

/**
 * Optional extra inputs threaded into the pack alongside the standard
 * `PackFindingScannerInput`. `runContext` is required by the emitter +
 * gap-builder context shapes for signature uniformity with peer packs; when
 * omitted the orchestrator falls back to the `runId` on the main input plus
 * empty string placeholders for `projectId` / `architectureId` (the
 * `FindingEmitter` itself attaches the run-level coordinates on persist, so
 * this is informational only).
 */
export interface RestWadlPassExtraInput {
  runContext?: FindingEmitRunContext;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Detect WADL-bearing IR entries by file extension + rawContent presence. */
function isWadlFile(ir: SourceFileIR): boolean {
  const fp = ir.filePath.toLowerCase();
  return (
    fp.endsWith('.wadl') &&
    typeof ir.rawContent === 'string' &&
    ir.rawContent.length > 0
  );
}

/** Detect XSD-bearing IR entries by file extension + rawContent presence. */
function isXsdFile(ir: SourceFileIR): boolean {
  const fp = ir.filePath.toLowerCase();
  return (
    fp.endsWith('.xsd') &&
    typeof ir.rawContent === 'string' &&
    ir.rawContent.length > 0
  );
}

/**
 * Return the directory portion of a repo-relative path. Cope with both POSIX
 * and Windows separators -- the IR walk may surface either depending on the
 * extractor that produced it.
 */
function dirnameOf(p: string): string {
  if (!p) return '';
  const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return lastSep >= 0 ? p.slice(0, lastSep) : '';
}

/**
 * Return the basename (final segment) of a repo-relative path. Cope with
 * both separators.
 */
function basenameOf(p: string): string {
  if (!p) return '';
  const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return lastSep >= 0 ? p.slice(lastSep + 1) : p;
}

/**
 * Build the parser's `relatedFiles` map from every `.xsd` IR entry. Each
 * sibling XSD is registered under multiple key variants so the parser's
 * literal `relatedFiles.get(href)` lookup hits regardless of how the WADL
 * declared the href (bare filename / sibling-relative / repo-relative).
 *
 *  - The entry's full IR path (e.g. `src/main/resources/api/xsd0.xsd`).
 *  - The entry's basename (e.g. `xsd0.xsd`) -- matches the Jersey-generated
 *    case where the WADL declares `<include href="xsd0.xsd"/>` next to a
 *    sibling XSD.
 *  - The entry's path relative to the WADL's directory (when the XSD lives
 *    under the WADL's parent directory). Forward-slash form only -- WADL
 *    href values are URI-shaped.
 *
 * Later writes win when two entries collide on the same key; this is
 * acceptable in v1 -- the spec does not require cross-directory disambiguation.
 */
function buildRelatedFiles(
  xsdIrs: SourceFileIR[],
  wadlPath: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const wadlDir = dirnameOf(wadlPath);
  for (const xsd of xsdIrs) {
    const content = xsd.rawContent as string;
    // Variant 1: full repo-relative path (always registered).
    map.set(xsd.filePath, content);
    // Variant 2: basename (registered for every XSD; later writes win).
    map.set(basenameOf(xsd.filePath), content);
    // Variant 3: path relative to the WADL's directory.
    if (wadlDir) {
      const wadlDirNorm = wadlDir.replace(/\\/g, '/');
      const xsdPathNorm = xsd.filePath.replace(/\\/g, '/');
      const prefix = wadlDirNorm + '/';
      if (xsdPathNorm.startsWith(prefix)) {
        const rel = xsdPathNorm.slice(prefix.length);
        map.set(rel, content);
      }
    }
  }
  return map;
}

/**
 * Compact `by_type` summariser for the scanner-end diag log line. Returns a
 * comma-separated list of `type:count` pairs, sorted by descending count then
 * type so the order is stable across runs. Caps at the top 8 types so the
 * line stays one screen wide.
 */
function summariseByType(findings: FindingEmitInput[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const k = (f.findingType || 'unknown').toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  return sorted.map(([t, c]) => `${t}:${c}`).join(',');
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Run the REST WADL pass over a `PackFindingScannerInput`.
 *
 * Pure (besides diagnostic-sink writes): reads only `input.irFiles`. Returns
 * the concatenated `findings` stream described in the module header.
 *
 * Graceful behaviour:
 *  - Empty IR (no `.wadl` files) yields `{ findings: [] }` cleanly (still
 *    logs the `start files=0` diag line so the operator can confirm the pass
 *    ran).
 *  - A WADL with a `parseError` is included in the gap emitter's pass and
 *    produces exactly one `wadl_parse_failed` / `wadl_unsupported_namespace`
 *    finding; the structural emitter skips that file cleanly.
 *  - Non-WADL inputs (SOAP-only / Java-only) produce zero WADL findings.
 *
 * Soft-fail: per-file try/catch around the parse + emit + gap path. A throw
 * downgrades to a warning and the run continues with the next file. The
 * function itself NEVER throws.
 */
export function runRestWadlPass(
  input: PackFindingScannerInput,
  extra?: RestWadlPassExtraInput,
): RestWadlPassOutput {
  // Collect WADL + XSD IRs in one pass over the file map.
  const wadlIrs: SourceFileIR[] = [];
  const xsdIrs: SourceFileIR[] = [];
  for (const ir of input.irFiles.values()) {
    if (isWadlFile(ir)) {
      wadlIrs.push(ir);
    } else if (isXsdFile(ir)) {
      xsdIrs.push(ir);
    }
  }

  // Group 5.4: structured start line -- count of `.wadl` files only (xsd
  // entries are supporting material, not the unit of work).
  //
  // Bug-fix 2026-05-22: also log total IR size + xsd count so operators
  // can confirm the pack was invoked AND distinguish "no .wadl in repo"
  // from "wadl extension never reached the scan plan". When the pack is
  // wired correctly this line MUST appear in every production discovery
  // run; if it does not, the wiring is broken upstream.
  console.log(
    `[diag-pack] scanner=rest_wadl start files=${wadlIrs.length} ` +
      `xsd_companion_files=${xsdIrs.length} total_irFiles=${input.irFiles.size}`,
  );

  const findings: FindingEmitInput[] = [];

  // Run context for the emitter / gap-builder context shapes. Falls back to
  // a synthetic shape when the caller did not thread one through -- the
  // `FindingEmitter` re-attaches run-level coordinates on persist, so the
  // exact values here are informational only.
  const runContext: FindingEmitRunContext = extra?.runContext ?? {
    runId: input.runId,
    projectId: '',
    architectureId: '',
  };

  for (const ir of wadlIrs) {
    const sourceFilePath = ir.filePath;
    try {
      const relatedFiles = buildRelatedFiles(xsdIrs, sourceFilePath);

      const parseResult: WadlParseResult = parseWadl(ir.rawContent as string, {
        relatedFiles,
        sourceFilePath,
      });

      // Group 5.4: per-WADL parse diagnostic.
      if (parseResult.parseError) {
        console.warn(
          `[diag-pack] scanner=rest_wadl wadl_parse=fail path=${sourceFilePath} ` +
            `reason=${parseResult.parseError}`,
        );
      } else {
        console.log(
          `[diag-pack] scanner=rest_wadl wadl_parse=ok path=${sourceFilePath} ` +
            `operations=${parseResult.operations.length} interfaces=${parseResult.interfaces.length}`,
        );
      }

      // Structural findings first (interface + endpoints in document order).
      const structural = emitWadlFindings(parseResult, {
        sourceFilePath,
        runId: runContext.runId,
        projectId: runContext.projectId,
        architectureId: runContext.architectureId,
      });
      findings.push(...structural);

      // Gap findings last (spec Q9).
      const gaps = emitWadlEvidenceGaps(parseResult, {
        sourceFilePath,
        runId: runContext.runId,
        projectId: runContext.projectId,
        architectureId: runContext.architectureId,
      });
      findings.push(...gaps);
    } catch (err) {
      // Belt-and-braces soft-fail: the parser/emitter/gap-builder are all
      // soft-fail by contract, but any accidental throw here is downgraded
      // to a warning so a single malformed IR cannot poison the whole run.
      console.warn(
        `[restWadl/index] Failed on file '${sourceFilePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
      console.warn(
        `[diag-pack] scanner=rest_wadl soft_fail=true category=pass_threw path=${sourceFilePath}`,
      );
    }
  }

  // Scanner-end summary line -- mirrors the springClassicSoap pack's
  // `[diag-pack] scanner=spring_classic_soap ...` shape with a WADL twist.
  const gapCount = findings.filter((f) => f.findingType === 'evidence_gap').length;
  console.log(
    `[diag-pack] scanner=rest_wadl scan_complete findings=${findings.length} ` +
      `gaps=${gapCount} by_type=${summariseByType(findings)}`,
  );

  return { findings };
}
