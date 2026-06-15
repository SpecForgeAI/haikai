/**
 * WADL evidence-gap finding builder.
 *
 * Spec: 2026-05-21 WADL Deterministic Parser, Task Group 4.
 *
 * Pure helper that translates the soft-fail conditions captured on a
 * `WadlParseResult` into `evidence_gap` `FindingEmitInput`s for the existing
 * `FindingEmitter`. Lives inside the restWadl subtree so the call site
 * (Group 5's `index.ts`) only needs a single import.
 *
 * Four sentinel `gapType` values emitted (registered in `emissionSources.ts`):
 *
 *  1. `wadl_parse_failed`
 *     Emitted when `parseError === 'malformed_xml'` (the parser caught a
 *     `fast-xml-parser` throw). No structural finding is produced for the
 *     file -- this evidence_gap finding is the only output.
 *
 *  2. `wadl_unsupported_namespace`
 *     Emitted when `parseError === 'unsupported_wadl_namespace'` (the root
 *     `<application xmlns>` gate failed). Same shape semantics as
 *     `wadl_parse_failed`: no structural finding, gap-only.
 *
 *  3. `wadl_missing_grammar`
 *     Emitted ONCE PER ENTRY in `WadlParseResult.missingGrammars`. The
 *     parser appends an entry when an `<grammars><include href>` was
 *     either absent from the caller-supplied `relatedFiles` map OR present
 *     but the parser threw on it -- both flow through this single bucket
 *     per spec Q2.
 *
 *  4. `wadl_missing_schema_element`
 *     Emitted ONCE PER ENTRY in `WadlParseResult.missingSchemaElements`.
 *     Carries the originating `compositeId` on the finding as
 *     `sourceOperationId` so the reviewer can pivot from the gap back to
 *     the operation that referenced the missing element.
 *
 * Pure. Never throws. Caller passes the result list to
 * `FindingEmitter.emitFindings`.
 *
 * Standing-constraint compliance:
 *  - Uses the existing centralised builder `buildWadlEvidenceGapFinding`
 *    in `emissionSources.ts` -- NO parallel emitter pipeline.
 *  - `gapType` strings are the four new sentinels registered in the
 *    centralised `EvidenceGapType` union (per Task Group 4.2).
 */

import type { FindingEmitInput } from '../../FindingEmitter';
import { buildWadlEvidenceGapFinding } from '../../emissionSources';
import type { WadlParseResult } from './wadlParser';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Per-call context threaded into evidence-gap emission. Mirrors
 * `EmitWadlFindingsContext` in `wadlEndpointEmitter.ts` so callers can pass
 * the same context object to both.
 *
 *  - `sourceFilePath` -- repo-relative path of the WADL file the parse result
 *    came from. Surfaces verbatim on every finding's `detailJson.sourceFilePath`
 *    and as the disambiguating subject in the finding title.
 *  - `runId` / `projectId` / `architectureId` -- standard discovery-run
 *    coordinates. Accepted here for signature uniformity with the structural
 *    emitter (`FindingEmitter` itself adds run-level coordinates via
 *    `FindingEmitRunContext`).
 */
export interface EmitWadlEvidenceGapsContext {
  sourceFilePath: string;
  runId: string;
  projectId: string;
  architectureId: string;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Translate a `WadlParseResult` into a flat `FindingEmitInput[]` of
 * `evidence_gap` findings. See module docblock for the four gap kinds.
 *
 * Order:
 *  1. `parseError`-derived gap (at most one finding per parse result).
 *  2. `missingGrammars` entries in document order (parser preserves it).
 *  3. `missingSchemaElements` entries in document order (parser preserves it).
 *
 * Soft-fail: never throws. If a `missingSchemaElements` entry is malformed
 * (e.g. `ref` undefined), the entry is skipped with a warning and the
 * remaining entries continue to flow.
 */
export function emitWadlEvidenceGaps(
  parseResult: WadlParseResult,
  context: EmitWadlEvidenceGapsContext,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const sourceFilePath = context.sourceFilePath;

  // Pass 1: parseError sentinels -- at most one per parse result.
  // `'malformed_xml'` is the soft-failed `fast-xml-parser` throw;
  // `'unsupported_wadl_namespace'` is the root namespace gate. Anything else
  // also routes through `wadl_parse_failed` defensively (the parser only
  // currently emits the two sentinels above, but future additions land in
  // the same bucket per spec Q2).
  if (parseResult.parseError === 'unsupported_wadl_namespace') {
    out.push(
      buildWadlEvidenceGapFinding({
        gapType: 'wadl_unsupported_namespace',
        sourcePath: sourceFilePath,
        reason: parseResult.parseError,
        gapDescription:
          `WADL file '${sourceFilePath}' has an unsupported root namespace ` +
          `(expected 'http://wadl.dev.java.net/2009/02'). No structural findings emitted.`,
      }),
    );
    console.warn(
      `[diag-pack] scanner=rest_wadl gap=wadl_unsupported_namespace sourceFilePath=${sourceFilePath}`,
    );
  } else if (parseResult.parseError) {
    out.push(
      buildWadlEvidenceGapFinding({
        gapType: 'wadl_parse_failed',
        sourcePath: sourceFilePath,
        reason: parseResult.parseError,
        gapDescription:
          `WADL parse failed for '${sourceFilePath}': ${parseResult.parseError}. ` +
          `No structural findings emitted.`,
      }),
    );
    console.warn(
      `[diag-pack] scanner=rest_wadl gap=wadl_parse_failed sourceFilePath=${sourceFilePath} ` +
        `reason=${parseResult.parseError}`,
    );
  }

  // Pass 2: missing grammars -- one finding per entry, no dedup (spec Q2).
  for (const href of parseResult.missingGrammars ?? []) {
    if (typeof href !== 'string' || href.length === 0) continue;
    out.push(
      buildWadlEvidenceGapFinding({
        gapType: 'wadl_missing_grammar',
        sourcePath: sourceFilePath,
        ref: href,
      }),
    );
    console.warn(
      `[diag-pack] scanner=rest_wadl gap=wadl_missing_grammar sourceFilePath=${sourceFilePath} ` +
        `ref=${href}`,
    );
  }

  // Pass 3: missing schema elements -- one finding per entry.
  for (const entry of parseResult.missingSchemaElements ?? []) {
    if (!entry || typeof entry.ref !== 'string' || entry.ref.length === 0) {
      console.warn(
        `[diag-pack] scanner=rest_wadl gap=wadl_missing_schema_element sourceFilePath=${sourceFilePath} ` +
          `skip=malformed_entry`,
      );
      continue;
    }
    out.push(
      buildWadlEvidenceGapFinding({
        gapType: 'wadl_missing_schema_element',
        sourcePath: sourceFilePath,
        ref: entry.ref,
        sourceOperationId: entry.sourceOperationId,
      }),
    );
    console.warn(
      `[diag-pack] scanner=rest_wadl gap=wadl_missing_schema_element sourceFilePath=${sourceFilePath} ` +
        `ref=${entry.ref} sourceOperationId=${entry.sourceOperationId}`,
    );
  }

  return out;
}
