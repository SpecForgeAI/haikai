/**
 * Runtime Evidence Atom Builder (Spec
 * 2026-06-20-runtime-log-evidence-format-agnostic-extraction, Task Group 7).
 *
 * Converts the rich HTTP observations produced by the quality-first extraction
 * pipeline (known-format fast path -> Task Group 3, recipe-aware extractor ->
 * Task Group 6, or the broadened deterministic fallback matcher -> Task Group 1)
 * into `source: 'log'` `string_pattern` evidence atoms that AMS counts.
 *
 * THE GAP-CLEARING CONTRACT: AMS
 * `MigrationDiscoveryContextService.buildRuntimeUsageSummary` (read-only; NOT
 * modified by this spec) computes
 *   `runtimeEvidence = count of discovery_evidence rows where source == 'log'`
 *   `hasRuntimeEvidence = runtimeEvidence > 0 || runtimeFindings > 0`.
 * So every atom this builder emits MUST carry `source: 'log'`; that single field
 * is what flips `hasRuntimeEvidence` true and clears the
 * `insufficient_runtime_evidence` migration-readiness gap. The atom SHAPE mirrors
 * the Increment-14 `logExtractors/endpointUsageExtractor.ts`
 * (`type: 'string_pattern'`, `data.patternName: 'endpoint_usage_log'`, populated
 * `logOrigin`) so the evidence reads identically in the Findings/evidence views;
 * we deliberately do NOT extend that old regex-only extractor (per spec NON-GOAL)
 * -- this builder is driven by the richer observations instead.
 *
 * Aggregation: observations for the SAME `METHOD normalizedPath` collapse into a
 * single atom (recording the first/last line and an occurrence count), exactly
 * like `endpointUsageExtractor`, so one hammered endpoint does not produce
 * thousands of rows. The id is the same deterministic
 * `generateEvidenceId(runId, repoUrl, logFilePath, 'string_pattern', key)` hash,
 * keeping atom creation idempotent across re-runs.
 *
 * Nothing is invented: response / header / body richness rides along inside the
 * observations the upstream extractors produced (they only populate what the log
 * actually contained); this builder shapes them into atoms, it does not fabricate
 * fields.
 */

import type { EvidenceAtom } from '../../types/evidenceAtom';
import { generateEvidenceId } from '../../utils/evidenceId';
import type { RichObservation } from './knownFormatFastPath';

/** Per-file inputs needed to stamp atoms with run / repo / file identity. */
export interface AtomBuildContext {
  /** Discovery run UUID (atom `runId` + id-hash component). */
  runId: string;
  /** Source repository URL from `config_snapshot.repoUrl` (id-hash component). */
  repoUrl: string;
  /**
   * Display path of the source log file -- used as the atom `filePath`,
   * `logOrigin.filePath`, and id-hash component. Typically the artifact's
   * `originalFileName` (or `relativePath`).
   */
  logFilePath: string;
}

/** Internal accumulator for one `METHOD normalizedPath` group. */
interface EndpointAtomAggregation {
  method: string;
  normalizedPath: string;
  rawPathSample: string;
  firstLine: number;
  lastLine: number;
  occurrenceCount: number;
  firstTimestamp?: string;
  /** Whether ANY observation in the group carried a logged response status. */
  sawResponse: boolean;
  /** A small status sample for the context snippet (first observed status). */
  firstStatus?: number;
}

/**
 * The 1-based source line an observation maps to. The recipe-aware extractor
 * carries an explicit record line RANGE (`lineStart`/`lineEnd`); the fast-path
 * / fallback observations only carry a single `lineNumber`. Read whichever is
 * present, defaulting to 0 (the existing extractor convention).
 */
function observationLineRange(obs: RichObservation): { start: number; end: number } {
  const maybeRanged = obs as RichObservation & { lineStart?: number; lineEnd?: number };
  const start =
    typeof maybeRanged.lineStart === 'number' ? maybeRanged.lineStart : obs.lineNumber ?? 0;
  const end =
    typeof maybeRanged.lineEnd === 'number' ? maybeRanged.lineEnd : obs.lineNumber ?? start;
  return { start, end };
}

/**
 * Build `source: 'log'` evidence atoms from rich observations.
 *
 * One atom per distinct `METHOD normalizedPath`. Observations missing a method
 * or a `/`-leading path are skipped (they are not usable endpoint evidence).
 * Returns an empty array when given no usable observations -- the caller decides
 * whether the empty case is a diagnostic-worthy "~0 despite hits" situation
 * (Task Group 8).
 */
export function buildLogEvidenceAtoms(
  observations: RichObservation[],
  ctx: AtomBuildContext,
): EvidenceAtom[] {
  const now = new Date().toISOString();
  const aggregations = new Map<string, EndpointAtomAggregation>();

  for (const obs of observations) {
    if (!obs) continue;
    const method = (obs.method ?? '').trim().toUpperCase();
    const normalizedPath = (obs.normalizedPath ?? obs.rawPath ?? '').trim();
    if (!method || !normalizedPath || normalizedPath[0] !== '/') continue;

    const key = `${method} ${normalizedPath}`;
    const { start, end } = observationLineRange(obs);
    const existing = aggregations.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      if (start > 0 && (existing.firstLine === 0 || start < existing.firstLine)) {
        existing.firstLine = start;
      }
      if (end > existing.lastLine) existing.lastLine = end;
      if (!existing.firstTimestamp && obs.timestampIso) existing.firstTimestamp = obs.timestampIso;
      if (obs.status !== undefined) {
        existing.sawResponse = true;
        if (existing.firstStatus === undefined) existing.firstStatus = obs.status;
      }
    } else {
      aggregations.set(key, {
        method,
        normalizedPath,
        rawPathSample: (obs.rawPath ?? normalizedPath).trim(),
        firstLine: start,
        lastLine: end > start ? end : start,
        occurrenceCount: 1,
        firstTimestamp: obs.timestampIso,
        sawResponse: obs.status !== undefined,
        firstStatus: obs.status,
      });
    }
  }

  const atoms: EvidenceAtom[] = [];
  for (const [, agg] of aggregations) {
    const distinguishingKey = `endpoint_usage_log:${agg.method}:${agg.normalizedPath}`;
    const id = generateEvidenceId(
      ctx.runId,
      ctx.repoUrl,
      ctx.logFilePath,
      'string_pattern',
      distinguishingKey,
    );
    const matchedText = `${agg.method} ${agg.normalizedPath}`;
    const contextSnippet =
      agg.firstStatus !== undefined
        ? `${agg.method} ${agg.rawPathSample} -> ${agg.firstStatus}`
        : `${agg.method} ${agg.rawPathSample}`;

    atoms.push({
      id,
      runId: ctx.runId,
      repoUrl: ctx.repoUrl,
      filePath: ctx.logFilePath,
      type: 'string_pattern',
      data: {
        patternName: 'endpoint_usage_log',
        matchedText,
        line: agg.firstLine,
        contextSnippet: contextSnippet.substring(0, 200),
      },
      extractedAt: now,
      source: 'log',
      logOrigin: {
        filePath: ctx.logFilePath,
        lineStart: agg.firstLine,
        lineEnd: agg.lastLine,
        timestamp: agg.firstTimestamp,
        occurrenceCount: agg.occurrenceCount,
      },
    });
  }
  return atoms;
}
