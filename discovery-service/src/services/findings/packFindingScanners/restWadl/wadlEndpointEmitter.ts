/**
 * WADL endpoint emitter -- pure mapping from `WadlParseResult` to
 * `FindingEmitInput[]`.
 *
 * Spec: 2026-05-21 WADL Deterministic Parser, Task Group 3.
 *
 * Mirrors the springClassicSoap pack's `soapEndpointEmitter.ts` 1:1 in module
 * shape (header docblock, pure-helper structure, soft-fail behaviour, log-line
 * style) but adapted to the REST-over-HTTP WADL flavour:
 *  - SOAP emits `DiscoveryCandidate[]`; WADL emits `FindingEmitInput[]` per
 *    the spec's Q7 (the REST WADL pack flows everything through the existing
 *    `FindingEmitter` channel without a parallel candidate pipeline).
 *  - WADL emits TWO finding kinds: `interface_definition` (one per WADL file)
 *    and `endpoint` (one per `WadlOperation`).
 *
 * Public function: `emitWadlFindings(parseResult, context)` -> `FindingEmitInput[]`.
 *
 * Emission rules (spec Q3-Q7, Q9):
 *  1. `interface_definition` -- one finding per WADL file. Skipped entirely
 *     when `parseResult.parseError` is set (the gap emitter in
 *     `wadlEvidenceGaps.ts` reports the failure; nothing structural to emit).
 *     `title`  -- `WadlInterface.applicationTitle` (falls back to the filename
 *                 without extension when null).
 *     `summary` -- `WadlInterface.doc` (literal pass-through; null when no
 *                  `<doc>` content was collected).
 *     `detailJson` -- `{ format: 'wadl', version, grammarPaths, sourceFilePath }`.
 *  2. `endpoint` -- one finding per `WadlOperation`.
 *     `title`  -- `compositeId` (e.g. `POST /hierarchynodes/{orgUnitId}`).
 *     `summary` -- `WadlOperation.doc` (literal pass-through; null when no
 *                  `<doc>` content was collected).
 *     `detailJson` -- `{ protocol: 'rest', method, path, baseUrl, methodId,
 *                       params, request, response, sourceFilePath, sourceLine? }`.
 *  3. Ordering -- `interface_definition` first, then `endpoint` findings in
 *     document order. The parser already walks resources in document order so
 *     the emitter preserves `parseResult.operations[]` ordering as-is.
 *
 * Logging:
 *  - One `[diag-pack] scanner=rest_wadl emit_findings sourceFilePath=<path>
 *    interface_count=<N> endpoint_count=<N>` line per call, matching the WSDL
 *    pack's `console.log` style.
 *
 * Soft-fail:
 *  - Never throws. If the parse result is malformed in a way that prevents
 *    individual finding construction, that finding is skipped and a warning
 *    is logged; the function still returns the remaining findings. The caller
 *    is responsible for handling empty arrays.
 *
 * Pure: no `fs`, no `http`, no `process` usage. Caller (Group 5 / `index.ts`)
 * is responsible for I/O.
 */

import type { FindingEmitInput } from '../../FindingEmitter';
import type {
  WadlInterface,
  WadlOperation,
  WadlParseResult,
} from './wadlParser';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Per-call context threaded into emission. The scanner orchestrator
 * (`restWadl/index.ts`, Group 5) builds this from the IR file entry.
 *
 *  - `sourceFilePath` -- repo-relative path of the WADL file the parse result
 *    came from. Surfaces verbatim on every finding's `detailJson.sourceFilePath`
 *    and as the fallback `title` for `interface_definition` when no
 *    `applicationTitle` is present.
 *  - `runId` / `projectId` / `architectureId` -- standard discovery-run
 *    coordinates. The emitter itself does not embed them on findings (the
 *    `FindingEmitter` adds run-level coordinates via `FindingEmitRunContext`),
 *    but they are accepted here so the signature is uniform with peer
 *    emitter modules.
 *  - `serviceId` -- optional service scoping when the WADL belongs to a
 *    known service. Accepted but unused in v1 (the spec's "Existing Code to
 *    Leverage" leaves service scoping to the orchestrator).
 */
export interface EmitWadlFindingsContext {
  sourceFilePath: string;
  runId: string;
  projectId: string;
  architectureId: string;
  serviceId?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Strip the trailing file extension (and any directory prefix) from a path. */
function fileBasename(p: string): string {
  if (!p) return '';
  // Cope with both POSIX and Windows separators -- the orchestrator may pass
  // either depending on how the IR walk surfaces paths.
  const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const tail = lastSep >= 0 ? p.slice(lastSep + 1) : p;
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(0, dot) : tail;
}

/**
 * Build the `interface_definition` finding for one WADL file. Caller has
 * already filtered out the `parseError`-set case.
 */
function buildInterfaceFinding(
  iface: WadlInterface,
  sourceFilePath: string,
): FindingEmitInput {
  const title =
    iface.applicationTitle && iface.applicationTitle.trim().length > 0
      ? iface.applicationTitle
      : fileBasename(sourceFilePath) || 'wadl_interface';
  return {
    findingType: 'interface_definition',
    category: 'interface',
    severity: 'info',
    title,
    summary: iface.doc ?? undefined,
    detailJson: {
      format: 'wadl',
      version: iface.version,
      grammarPaths: iface.grammarPaths,
      sourceFilePath,
    },
    source: 'rest_wadl_scanner',
    createdByStage: 'findings.restWadlScanner',
  };
}

/**
 * Build one `endpoint` finding per `WadlOperation`. Pure; never throws.
 * Returns null when the operation is unusable (missing both `compositeId`
 * and `httpMethod` -- defensive only; the parser populates both).
 */
function buildEndpointFinding(
  op: WadlOperation,
  sourceFilePath: string,
): FindingEmitInput | null {
  const title = op.compositeId && op.compositeId.length > 0 ? op.compositeId : null;
  if (!title) {
    return null;
  }
  const detailJson: Record<string, unknown> = {
    protocol: 'rest',
    method: op.httpMethod,
    path: op.path,
    baseUrl: op.baseUrl,
    methodId: op.methodId,
    params: op.params,
    request: { representations: op.request.representations },
    response: { representations: op.response.representations },
    sourceFilePath,
  };
  if (op.sourceLine != null) {
    detailJson.sourceLine = op.sourceLine;
  }
  return {
    findingType: 'endpoint',
    category: 'endpoint',
    severity: 'info',
    title,
    summary: op.doc ?? undefined,
    detailJson,
    source: 'rest_wadl_scanner',
    createdByStage: 'findings.restWadlScanner',
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Translate a `WadlParseResult` into an ordered `FindingEmitInput[]` for the
 * existing `FindingEmitter`. See module docblock for emission rules.
 *
 * Soft-fail: returns whatever findings can be built, never throws. The caller
 * is responsible for handling empty arrays (e.g. when `parseError` is set --
 * the gap emitter in `wadlEvidenceGaps.ts` produces the evidence-gap finding
 * in that case).
 */
export function emitWadlFindings(
  parseResult: WadlParseResult,
  context: EmitWadlFindingsContext,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const sourceFilePath = context.sourceFilePath;

  let interfaceCount = 0;
  let endpointCount = 0;

  // Skip structural emission entirely on parse failure -- the gap emitter in
  // `wadlEvidenceGaps.ts` owns the `evidence_gap` finding for that case.
  if (!parseResult.parseError) {
    try {
      const iface = parseResult.interfaces[0];
      if (iface) {
        out.push(buildInterfaceFinding(iface, sourceFilePath));
        interfaceCount += 1;
      }
    } catch (err) {
      console.warn(
        `[diag-pack] scanner=rest_wadl emit_findings sourceFilePath=${sourceFilePath} ` +
          `interface_skip=true reason='${err instanceof Error ? err.message : String(err)}'`,
      );
    }

    // Endpoints -- preserve parser document order.
    for (const op of parseResult.operations) {
      try {
        const finding = buildEndpointFinding(op, sourceFilePath);
        if (finding != null) {
          out.push(finding);
          endpointCount += 1;
        }
      } catch (err) {
        console.warn(
          `[diag-pack] scanner=rest_wadl emit_findings sourceFilePath=${sourceFilePath} ` +
            `endpoint_skip=true compositeId='${op.compositeId}' ` +
            `reason='${err instanceof Error ? err.message : String(err)}'`,
        );
      }
    }
  }

  console.log(
    `[diag-pack] scanner=rest_wadl emit_findings sourceFilePath=${sourceFilePath} ` +
      `interface_count=${interfaceCount} endpoint_count=${endpointCount}`,
  );

  return out;
}
