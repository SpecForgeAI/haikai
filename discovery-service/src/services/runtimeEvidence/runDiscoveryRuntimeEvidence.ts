/**
 * Runtime Evidence Orchestrator (Spec 5 Task Group 4).
 *
 * Wraps the per-module runtime-evidence pipeline into a single function
 * called from `runDiscoveryV3` between Stage 2 (FrameworkPack.adapt) and
 * Stage 3 (LLM gap-fill). The orchestrator reads the run's uploaded log
 * files from disk, parses them (CLF Common/Combined via the new
 * `accessLogParser`, JSONL/syslog/framework-pattern/plaintext via the
 * existing `parseLogContent`), aggregates HTTP observations, matches
 * them against the deterministic Stage 2 candidates, mutates those
 * candidates in memory with the matched / no-usage runtime evidence
 * (the bulk-save path in RunManager then persists `logEnrichment.runtime`
 * end-to-end), and writes the run-level runtime summary via the existing
 * AMS run-update endpoint.
 *
 * Failure-mode policy (per spec acceptance criterion 22):
 *   - The discovery run NEVER fails because of log processing.
 *   - No log artifacts             -> persist `{ skipped: true, reason: 'no_log_artifacts' }`
 *                                     and return early.
 *   - All log files unparsable     -> persist
 *                                     `{ skipped: true, reason: 'log_processing_failed', warnings: [...] }`
 *                                     and return a no-runtime-context result.
 *   - Single file missing on disk  -> warn, skip the file, continue with the rest.
 *   - Top-level uncaught error     -> caught at the orchestrator boundary,
 *                                     persisted as `log_processing_failed`,
 *                                     and the LLM stage proceeds without
 *                                     runtime context.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';

import { archModelClient as defaultArchModelClient } from '../archModelClient';
import { detectLogFormat, parseLogContent } from '../logParsing';
import type { ParsedLogEntry } from '../../types/logParsing';
import { DiscoveryCandidate } from '../../types/candidate';

import {
  HttpRuntimeObservation,
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
  RuntimeEvidenceLlmContext,
  RuntimeEvidenceResult,
  RuntimeEvidenceRunSummary,
  UnmatchedRouteHint,
} from './httpRuntimeObservation';
import { parseClfStream } from './accessLogParser';
import { normalizePath } from './endpointPathNormalizer';
import { aggregateObservations } from './endpointRuntimeAggregator';
import { matchAggregatesToCandidates } from './endpointRuntimeMatcher';
import {
  applyRuntimeEvidenceToCandidates,
  persistRuntimeEvidence,
} from './runtimeEvidencePersistence';
import {
  buildRuntimeEvidenceLlmContext,
  CandidateIdentityLookup,
} from './runtimeEvidenceLlmContextBuilder';
import { findingEmitter, type FindingEmitRunContext } from '../findings/FindingEmitter';
import {
  buildUnmatchedRuntimeEndpointFinding,
  buildRuntimeUsageObservationFinding,
  buildUnusedCodeEndpointFinding,
} from '../findings/emissionSources';

/**
 * Per-file size cap. Default 100MB matches the upload cap from Spec 4
 * (`LOG_PARSE_MAX_FILE_BYTES`). Files exceeding this are SKIPPED with
 * a warning -- they are not parsed at a partial position.
 */
const LOG_PARSE_MAX_FILE_BYTES: number = Number(
  process.env.LOG_PARSE_MAX_FILE_BYTES ?? 104857600,
);

/**
 * Total bundle cap across the whole run. Default 2000MB (2 GB) matches
 * Spec 4 (`LOG_PARSE_MAX_TOTAL_BYTES`). Once the cumulative parsed bytes
 * exceeds this cap the orchestrator skips remaining files with a
 * warning.
 */
const LOG_PARSE_MAX_TOTAL_BYTES: number = Number(
  process.env.LOG_PARSE_MAX_TOTAL_BYTES ?? 2097152000,
);

/**
 * HTTP-method + path regex used against the `message` field of non-CLF
 * log entries (JSONL/syslog/framework-pattern/plaintext). Mirrors the
 * pattern used by `endpointUsageExtractor` so the orchestrator picks up
 * the same observations the manual reprocess route would.
 */
const HTTP_METHOD_PATH_REGEX =
  /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s"'>,;)\]}]+)(?:[^0-9]*?(\d{3}))?/i;

/**
 * KV-style status fallback. The user's actual access-log lines tail the
 * CLF prefix with key=value pairs like `port=8080 statusCode=200
 * responseBytes=8132`, so the primary HTTP_METHOD_PATH_REGEX (which
 * stops at the closing quote of the request line) never reaches the
 * status. This regex picks the status out of the KV tail. Accepted
 * keys: `statusCode`, `status_code`, `status`, `http_status`,
 * `httpStatus` -- separator `=` or `:`.
 */
const KV_STATUS_REGEX =
  /\b(?:statusCode|status_code|status|http_status|httpStatus)\s*[=:]\s*(\d{3})\b/i;

/**
 * Bare-3-digit status fallback. Strict CLF status position is the
 * 3-digit number immediately after the closing quote of the request
 * line (e.g. `... HTTP/1.1" 200 8132`). This regex catches that shape
 * for log lines that drop the KV tail entirely.
 */
const BARE_STATUS_AFTER_QUOTE_REGEX = /"\s+(\d{3})\s/;

/**
 * Defensive default for the per-run "max leading proxy-prefix segments"
 * knob. Discovery Run Robustness Section 1 wires this through from the
 * frontend modal -> AMS log-files PATCH -> `config_snapshot` -> here ->
 * the matcher's tier-3 suffix pass. A missing / out-of-range / wrong-type
 * value defaults to `1` so older runs that pre-date the knob still get
 * the most-common single-segment proxy-prefix tolerance.
 */
const MAX_LOG_PATH_PREFIX_SEGMENTS_DEFAULT = 1;
const MAX_LOG_PATH_PREFIX_SEGMENTS_LOWER = 0;
const MAX_LOG_PATH_PREFIX_SEGMENTS_UPPER = 5;

/**
 * The shape of a single entry inside `config_snapshot.inputArtifacts.logFiles[]`.
 *
 * Mirrors the AMS `LogFileMetaDto` record. Re-declared loosely here so
 * the orchestrator does not import a Java-DTO-shaped TypeScript module.
 * Only the four fields the orchestrator actually consumes are pinned.
 */
export interface LogFileArtifactEntry {
  artifactId: string;
  originalFileName: string;
  sizeBytes?: number;
  fileExtension?: string;
  contentType?: string | null;
  uploadedAtIso?: string;
  relativePath: string;
}

/**
 * Minimal client surface the orchestrator depends on. Defined as a
 * structural subset of `archModelClient` so callers (and tests) can
 * pass a small stub object without replicating the full 22-method
 * interface.
 *
 * Note: post-hotfix-2026-05-12-A the runtime-evidence sub-stage no
 * longer calls `updateCandidate` or `getCandidatesByRun` from inside
 * the V3 pipeline (the bulk-save path persists per-candidate
 * `logEnrichment.runtime` end-to-end). The minimal client surface is
 * therefore narrowed to the two methods we still call.
 */
type RuntimeEvidenceArchClient = Pick<
  typeof defaultArchModelClient,
  'updateDiscoveryRun' | 'getDiscoveryRun'
>;

export interface RunDiscoveryRuntimeEvidenceArgs {
  projectId: string;
  runId: string;
  /**
   * Architecture id is currently unused inside the orchestrator -- the
   * arch-model client resolves it lazily for each PUT/GET. It is
   * accepted to match the spec's pinned signature and to leave a hook
   * for future architecture-scoped persistence variants.
   */
  architectureId?: string;
  /**
   * Absolute path of the project parent folder on disk. Each
   * `config_snapshot.inputArtifacts.logFiles[].relativePath` is joined
   * against this to resolve the absolute log file path.
   */
  projectFolder: string;
  /** Stage 2 deterministic candidates, used by the matcher. */
  deterministicCandidates: DiscoveryCandidate[];
  /**
   * The run's `config_snapshot` object. The orchestrator reads
   * `inputArtifacts.logFiles[]` from this -- nothing else.
   */
  configSnapshot: Record<string, unknown> | null | undefined;
  /** Optional client override for tests. Defaults to the singleton. */
  archModelClient?: RuntimeEvidenceArchClient;
}

/**
 * Runtime-context variant returned when log processing was skipped.
 * Mirrors the empty-context shape produced by
 * `runtimeEvidenceLlmContextBuilder.emptyContext()` so the gap-fill
 * stage sees a valid `RuntimeEvidenceLlmContext` regardless of
 * orchestrator outcome.
 */
function emptyLlmContext(): RuntimeEvidenceLlmContext {
  return {
    runtimeEvidenceSummary: {
      logFilesProcessed: 0,
      logWindow: {},
      matchedEndpoints: [],
      codeEndpointsWithNoObservedUsage: [],
      unmatchedRuntimeRouteHints: [],
    },
  };
}

/**
 * Pull `inputArtifacts.logFiles[]` from a `config_snapshot` blob,
 * returning an empty array when the path is missing or malformed.
 */
function readLogFileArtifacts(
  configSnapshot: Record<string, unknown> | null | undefined,
): LogFileArtifactEntry[] {
  if (!configSnapshot || typeof configSnapshot !== 'object') return [];
  const inputArtifacts = (configSnapshot as Record<string, unknown>).inputArtifacts;
  if (!inputArtifacts || typeof inputArtifacts !== 'object') return [];
  const logFiles = (inputArtifacts as Record<string, unknown>).logFiles;
  if (!Array.isArray(logFiles)) return [];
  return logFiles.filter(
    (e): e is LogFileArtifactEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as Record<string, unknown>).relativePath === 'string' &&
      typeof (e as Record<string, unknown>).artifactId === 'string',
  );
}

/**
 * Pull the per-run "max leading proxy-prefix segments" tier-3 knob
 * (`M`) from `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments`.
 *
 * Returns an integer clamped to `[0..5]`. Defaults to `1` when the key
 * is missing, the value is not an integer, or the value is out of range
 * via the wrong type (e.g. a string like `"two"`). Out-of-range numeric
 * values are clamped (negative -> `0`, > `5` -> `5`).
 */
function readMaxLogPathPrefixSegments(
  configSnapshot: Record<string, unknown> | null | undefined,
): number {
  if (!configSnapshot || typeof configSnapshot !== 'object') {
    return MAX_LOG_PATH_PREFIX_SEGMENTS_DEFAULT;
  }
  const runtimeEvidenceConfig = (configSnapshot as Record<string, unknown>)
    .runtimeEvidenceConfig;
  if (!runtimeEvidenceConfig || typeof runtimeEvidenceConfig !== 'object') {
    return MAX_LOG_PATH_PREFIX_SEGMENTS_DEFAULT;
  }
  const raw = (runtimeEvidenceConfig as Record<string, unknown>)
    .maxLogPathPrefixSegments;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return MAX_LOG_PATH_PREFIX_SEGMENTS_DEFAULT;
  }
  // Floor non-integer numerics to keep the matcher's integer contract.
  const intVal = Math.trunc(raw);
  if (intVal < MAX_LOG_PATH_PREFIX_SEGMENTS_LOWER) {
    return MAX_LOG_PATH_PREFIX_SEGMENTS_LOWER;
  }
  if (intVal > MAX_LOG_PATH_PREFIX_SEGMENTS_UPPER) {
    return MAX_LOG_PATH_PREFIX_SEGMENTS_UPPER;
  }
  return intVal;
}

/**
 * Sample the first non-empty lines of a file (for format detection).
 *
 * Reads UP TO `maxLines` lines via `readline`, then returns. Used only
 * to feed `detectLogFormat` -- the actual streaming parse re-opens the
 * file for the second pass.
 */
async function sampleFirstLines(
  filePath: string,
  maxLines: number,
): Promise<string[]> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  try {
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const out: string[] = [];
    for await (const line of lines) {
      if (out.length >= maxLines) break;
      out.push(line);
    }
    return out;
  } finally {
    stream.close();
  }
}

/**
 * Apply the `endpointUsageExtractor`-style regex to a single
 * `ParsedLogEntry` and yield a partial observation if a method+path
 * (and optionally a status code) is recovered. Status codes are
 * required for an observation to count -- entries without a status
 * are dropped.
 *
 * Hotfix (Image #5 — Fix 2): the primary regex's status capture group
 * stops at the closing quote of the request line and so misses the
 * user's actual access-log shape, which tails the CLF prefix with
 * `port=8080 statusCode=200 responseBytes=8132`. When the primary
 * group does not capture, fall through to (a) a KV-style scan against
 * the message body and (b) a strict-CLF bare-status-after-quote scan,
 * in that order. The existing `Number.isFinite + range` guard is
 * preserved for the final value.
 *
 * Exported for direct unit testing -- see
 * `userLogShape.regression.test.ts`.
 */
// Module-scoped flag: log a one-shot diagnostic when the KV fallback
// actually fires. Reset on process restart, so a fresh `npm run dev`
// will emit it on the first line that exercises the path. If you
// re-run discovery and DO NOT see this banner, the file content
// doesn't have any KV-style status tail. If you DO see it, the
// hotfix is provably executing.
let __kvFallbackBanner = false;

export function tryExtractFromMessage(
  entry: ParsedLogEntry,
  artifact: LogFileArtifactEntry,
): HttpRuntimeObservation | null {
  const message = entry.message ?? '';
  HTTP_METHOD_PATH_REGEX.lastIndex = 0;
  const m = HTTP_METHOD_PATH_REGEX.exec(message);
  if (!m) return null;
  const method = m[1].toUpperCase();
  const rawPath = m[2];
  let statusStr: string | undefined = m[3];
  if (!statusStr) {
    const kvMatch = KV_STATUS_REGEX.exec(message);
    if (kvMatch) {
      statusStr = kvMatch[1];
      if (!__kvFallbackBanner) {
        __kvFallbackBanner = true;
        // eslint-disable-next-line no-console
        console.log(
          `[runtime-evidence:hotfix-2026-05-12-A] KV-status fallback fired (first occurrence). Sample: method=${method} rawPath=${rawPath} status=${statusStr} sourceFile=${artifact.originalFileName}`,
        );
      }
    } else {
      const bareAfterQuote = BARE_STATUS_AFTER_QUOTE_REGEX.exec(message);
      if (bareAfterQuote) {
        statusStr = bareAfterQuote[1];
      }
    }
  }
  if (!statusStr) return null;
  const status = Number(statusStr);
  if (!Number.isFinite(status) || status < 100 || status > 599) return null;
  const normalized = normalizePath(rawPath);
  return {
    method,
    rawPath,
    normalizedPath: normalized,
    status,
    timestampIso: entry.timestamp ?? undefined,
    sourceArtifactId: artifact.artifactId,
    sourceFileName: artifact.originalFileName,
    lineNumber: entry.lineNumber ?? 0,
    snippet: undefined,
  };
}

/**
 * Build the run-level `RuntimeEvidenceRunSummary` from the matched +
 * no-usage + unmatched-hint sets, applying the env-configurable
 * threshold via the matcher's filtering of unmatched aggregates.
 */
function buildRunSummary(
  observations: HttpRuntimeObservation[],
  matched: MatchedRuntimeEvidence[],
  noUsage: NoUsageRuntimeEvidence[],
  unmatchedHints: UnmatchedRouteHint[],
  warnings: string[],
  logFilesProcessed: number,
): RuntimeEvidenceRunSummary {
  let firstSeen: string | undefined;
  let lastSeen: string | undefined;
  for (const o of observations) {
    if (!o.timestampIso) continue;
    if (!firstSeen || o.timestampIso < firstSeen) firstSeen = o.timestampIso;
    if (!lastSeen || o.timestampIso > lastSeen) lastSeen = o.timestampIso;
  }
  return {
    logFilesProcessed,
    logWindow: { firstSeen, lastSeen },
    totals: {
      observations: observations.length,
      matchedEndpoints: matched.length,
      noUsageEndpoints: noUsage.length,
      unmatchedHints: unmatchedHints.length,
    },
    warnings,
    unmatchedRouteHints: unmatchedHints,
  };
}

/**
 * Build the candidate-id -> { method, pathTemplate } lookup the LLM
 * context builder uses to populate the no-usage rows.
 */
function buildCandidateIdentityLookup(
  candidates: DiscoveryCandidate[],
): CandidateIdentityLookup {
  const map = new Map<string, { method: string; pathTemplate: string }>();
  for (const c of candidates) {
    if (c.candidateType !== 'endpoints') continue;
    const data = c.data as Record<string, unknown> | undefined;
    const pathTemplate = (data?.pathTemplate as string | undefined) ?? '';
    const method = ((data?.method as string | undefined) ?? 'UNKNOWN').toUpperCase();
    map.set(c.id, { method, pathTemplate });
  }
  return {
    get: (candidateId: string) => map.get(candidateId),
  };
}

/**
 * Persist the no-log / failed sub-stage state and return a
 * `RuntimeEvidenceResult` whose `llmContext` is empty.
 *
 * Centralised so the no-log short-circuit and the top-level catch use
 * the same write shape. Skipped runs have no per-candidate evidence,
 * so the in-memory mutation step is not needed here.
 */
async function persistSkipped(
  archModelClient: RuntimeEvidenceArchClient,
  projectId: string,
  runId: string,
  runSummary: RuntimeEvidenceRunSummary,
): Promise<void> {
  try {
    await persistRuntimeEvidence({
      projectId,
      runId,
      runSummary,
      archModelClient,
    });
  } catch (err) {
    console.warn(
      `[runtimeEvidence] Failed to persist skipped runtime evidence summary for run ${runId}: ${(err as Error).message}`,
    );
  }
}

/**
 * Run the runtime-evidence sub-stage.
 *
 * See module-level comment for the failure-mode contract; in short, this
 * function NEVER throws -- all error paths produce a valid
 * `RuntimeEvidenceResult` so the V3 pipeline can continue to Stage 3.
 */
export async function runDiscoveryRuntimeEvidence(
  args: RunDiscoveryRuntimeEvidenceArgs,
): Promise<RuntimeEvidenceResult> {
  const {
    projectId,
    runId,
    projectFolder,
    deterministicCandidates,
    configSnapshot,
    archModelClient = defaultArchModelClient,
  } = args;

  // Step 1: read configured log artifacts. Empty -> short-circuit.
  const logFiles = readLogFileArtifacts(configSnapshot);
  if (logFiles.length === 0) {
    const skipped: RuntimeEvidenceRunSummary = {
      skipped: true,
      reason: 'no_log_artifacts',
    };
    await persistSkipped(archModelClient, projectId, runId, skipped);
    return {
      persistenceSummary: skipped,
      llmContext: emptyLlmContext(),
    };
  }

  // Read the per-run M (max leading proxy-prefix segments) knob. Done
  // up-front so the matcher call site is a pure pass-through.
  const maxLogPathPrefixSegments = readMaxLogPathPrefixSegments(configSnapshot);

  try {
    const warnings: string[] = [];
    const observations: HttpRuntimeObservation[] = [];
    let totalBytesProcessed = 0;
    let logFilesProcessed = 0;
    let attemptedFiles = 0;
    let failedFiles = 0;

    // Step 2 + 3 + 4: per-file streaming parse with disk-resolution,
    // size-cap enforcement, and per-file failure isolation.
    for (const artifact of logFiles) {
      attemptedFiles += 1;
      const absolutePath = path.join(projectFolder, artifact.relativePath);

      // File-missing-on-disk -> warn and skip this artifact.
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(absolutePath);
      } catch (err) {
        warnings.push(
          `Log file missing on disk: ${artifact.originalFileName} (${(err as Error).message})`,
        );
        failedFiles += 1;
        continue;
      }

      // Per-file size cap.
      if (stat.size > LOG_PARSE_MAX_FILE_BYTES) {
        warnings.push(
          `Log file exceeds per-file cap (${stat.size} > ${LOG_PARSE_MAX_FILE_BYTES} bytes), skipped: ${artifact.originalFileName}`,
        );
        failedFiles += 1;
        continue;
      }

      // Total bundle cap.
      if (totalBytesProcessed + stat.size > LOG_PARSE_MAX_TOTAL_BYTES) {
        warnings.push(
          `Log bundle exceeds total cap (${totalBytesProcessed + stat.size} > ${LOG_PARSE_MAX_TOTAL_BYTES} bytes), remaining files skipped starting at: ${artifact.originalFileName}`,
        );
        failedFiles += 1;
        break;
      }

      try {
        // Detect the format from a small head sample.
        const sample = await sampleFirstLines(absolutePath, 20);
        const format = detectLogFormat(sample);

        // [RUNTIME-EVIDENCE BUILD-FINGERPRINT 2026-05-12-A]
        // Diagnostic banner: confirms the orchestrator code that's
        // actually serving this run includes the Image-#5 hotfixes
        // (KV-status fallback in tryExtractFromMessage, dotted long
        // tokens in normalizer, etc.). Look for this exact line in
        // discovery-service logs after a fresh `npm run dev` --
        // if it doesn't appear, tsx watch is serving stale code.
        // eslint-disable-next-line no-console
        console.log(
          `[runtime-evidence:hotfix-2026-05-12-A] processing artifact="${artifact.originalFileName}" sizeBytes=${stat.size} detectedFormat="${format}" absolutePath="${absolutePath}"`,
        );

        let perFileObservations = 0;
        const perFileNullSamples: string[] = [];
        if (format === 'clf_common' || format === 'clf_combined') {
          for await (const obs of parseClfStream(
            absolutePath,
            format,
            artifact.artifactId,
            artifact.originalFileName,
          )) {
            observations.push(obs);
            perFileObservations += 1;
          }
        } else {
          // Non-CLF format -> reuse the existing whole-file parser.
          // Per Spec 4 the per-file cap (100MB default) keeps memory bounded.
          const fileContent = await fsp.readFile(absolutePath, 'utf8');
          const parsed = parseLogContent(fileContent);
          for (const entry of parsed.entries) {
            const obs = tryExtractFromMessage(entry, artifact);
            if (obs) {
              observations.push(obs);
              perFileObservations += 1;
            } else if (perFileNullSamples.length < 3) {
              perFileNullSamples.push((entry.message ?? '').slice(0, 110));
            }
          }
        }

        // eslint-disable-next-line no-console
        console.log(
          `[runtime-evidence:hotfix-2026-05-12-A] file="${artifact.originalFileName}" extracted=${perFileObservations} ` +
          (perFileNullSamples.length > 0
            ? `firstNullSamples=${JSON.stringify(perFileNullSamples)}`
            : 'nullSamples=none'),
        );

        totalBytesProcessed += stat.size;
        logFilesProcessed += 1;
      } catch (err) {
        warnings.push(
          `Log file failed to parse: ${artifact.originalFileName} (${(err as Error).message})`,
        );
        failedFiles += 1;
        continue;
      }
    }

    // All files failed -> short-circuit with `log_processing_failed`.
    if (logFilesProcessed === 0 && attemptedFiles > 0) {
      const failedSummary: RuntimeEvidenceRunSummary = {
        skipped: true,
        reason: 'log_processing_failed',
        warnings,
      };
      await persistSkipped(archModelClient, projectId, runId, failedSummary);
      return {
        persistenceSummary: failedSummary,
        llmContext: emptyLlmContext(),
      };
    }

    // Step 5: aggregate.
    const { aggregates, unmatchedRouteHintCandidates } =
      aggregateObservations(observations);

    // Step 6: match against deterministic candidates. The per-run
    // tier-3 knob (`M`, defensively defaulted at the read site above)
    // is threaded in as the options-object third arg.
    const { matched, noUsage } = matchAggregatesToCandidates(
      aggregates,
      deterministicCandidates,
      { maxLogPathPrefixSegments },
    );

    // Step 7: build unmatched hints from the threshold-filtered candidate
    // list (the matcher does not yet filter, so we exclude any hint that
    // ended up matched to a code candidate via the aggregates Map keys).
    const matchedAggregateKeys = new Set<string>();
    for (const m of matched) {
      matchedAggregateKeys.add(`${m.method.toUpperCase()} ${m.normalizedLogPath}`);
    }
    const unmatchedHints: UnmatchedRouteHint[] = unmatchedRouteHintCandidates
      .filter(
        (a) => !matchedAggregateKeys.has(`${a.method.toUpperCase()} ${a.normalizedPath}`),
      )
      .map((a) => ({
        method: a.method,
        pathTemplate: a.normalizedPath,
        observedUsageCount: a.observedUsageCount,
        status2xxCount: a.status2xxCount,
        status3xxCount: a.status3xxCount,
      }));

    const runSummary = buildRunSummary(
      observations,
      matched,
      noUsage,
      unmatchedHints,
      warnings,
      logFilesProcessed,
    );

    // Step 8a: HOTFIX 2026-05-12-A. The V3 pipeline runs this stage
    // BEFORE Stage 2's deterministic candidates have been persisted to
    // AMS (RunManager.bulkSaveCandidates runs AFTER the pipeline
    // returns). Previously this module PUT each candidate via
    // `archModelClient.updateCandidate(...)` and every request 400'd
    // ("Candidate not found"). The fix is to mutate the in-memory
    // candidate objects in place; the bulk-save path then serialises
    // `logEnrichment.runtime` end-to-end through `mapCandidateToBackend`
    // -> AMS DTO -> JSONB column. No per-candidate PUT is required.
    applyRuntimeEvidenceToCandidates(deterministicCandidates, matched, noUsage);
    // eslint-disable-next-line no-console
    console.log(
      `[runtime-evidence:hotfix-2026-05-12-A] applied in-memory: matched=${matched.length} noUsage=${noUsage.length} to ${deterministicCandidates.length} candidates`,
    );

    // Step 8b: persist the run-level summary only. Per-candidate writes
    // are intentionally NOT performed here -- see Step 8a above. Errors
    // here surface as warnings inside the persistence module and do NOT
    // throw.
    await persistRuntimeEvidence({
      projectId,
      runId,
      runSummary,
      archModelClient,
    });

    // =====================================================================
    // Discovery Findings emission (Spec 2026-05-16 -- Task Group 5)
    // ---------------------------------------------------------------------
    // Two v1 sources fire from the runtime-evidence sub-stage:
    //   - Source D: unmatched_runtime_endpoint -- one finding per
    //               unmatched route hint that survived the threshold filter.
    //   - Source E: runtime_usage_observation  -- one info-severity finding
    //               per matched runtime aggregate, linked to its candidate.
    //
    // Emission is soft-fail at the FindingEmitter boundary; any failure
    // here cannot abort the runtime-evidence stage, which in turn cannot
    // abort the discovery run (the orchestrator's top-level safety net
    // already enforces that).
    // =====================================================================
    try {
      const findingsRunContext: FindingEmitRunContext = {
        runId,
        projectId,
        architectureId: args.architectureId ?? '',
      };
      const findingInputs = [];
      // Source D: unmatched runtime endpoints.
      for (const hint of unmatchedHints) {
        findingInputs.push(
          buildUnmatchedRuntimeEndpointFinding({
            method: hint.method,
            pathTemplate: hint.pathTemplate,
            observedUsageCount: hint.observedUsageCount,
            status2xxCount: hint.status2xxCount,
            status3xxCount: hint.status3xxCount,
          }),
        );
      }
      // Source E: per-candidate runtime_usage_observation.
      for (const m of matched) {
        findingInputs.push(
          buildRuntimeUsageObservationFinding({
            candidateId: m.candidateId,
            method: m.method,
            pathTemplate: m.codePathTemplate,
            observedUsageCount: m.observedUsageCount,
          }),
        );
      }
      // Source D extension (Spec 2026-05-16 Wire Java/Spring/Maven Findings,
      // D2): for each code-discovered endpoint candidate that had NO matching
      // runtime traffic, emit one info-severity finding so reviewers can
      // filter no-usage endpoints in the Findings tab. The method / path
      // come from the candidate's data blob (with the same fallback chain
      // the matcher uses) since NoUsageRuntimeEvidence does not carry them.
      const candidateById = new Map(deterministicCandidates.map((c) => [c.id, c]));
      for (const n of noUsage) {
        const cand = candidateById.get(n.candidateId);
        if (!cand) continue;
        const data = (cand.data as Record<string, unknown> | undefined) ?? {};
        const rawMethod = typeof data.method === 'string' ? data.method.trim().toUpperCase() : '';
        const rawPath =
          (typeof data.pathTemplate === 'string' && data.pathTemplate) ||
          (typeof data.fullPath === 'string' && data.fullPath) ||
          (typeof data.path === 'string' && data.path) ||
          (typeof data.url === 'string' && data.url) ||
          '';
        findingInputs.push(
          buildUnusedCodeEndpointFinding({
            candidateId: n.candidateId,
            method: rawMethod || 'ANY',
            pathTemplate: rawPath || '(unknown path)',
            note: n.note,
          }),
        );
      }
      if (findingInputs.length > 0) {
        await findingEmitter.emitFindings(findingsRunContext, findingInputs);
      }
    } catch (err) {
      console.warn(
        `[runtimeEvidence:Findings] Emission boundary swallowed error:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Step 9: build the LLM context.
    const identities = buildCandidateIdentityLookup(deterministicCandidates);
    const llmContext = buildRuntimeEvidenceLlmContext(
      matched,
      noUsage,
      runSummary,
      identities,
    );

    if (failedFiles > 0) {
      console.log(
        `[runtimeEvidence] Run ${runId}: processed ${logFilesProcessed}/${attemptedFiles} log files, ` +
          `${observations.length} observations, ${matched.length} matched, ${noUsage.length} no-usage, ` +
          `${unmatchedHints.length} unmatched hints, ${warnings.length} warnings.`,
      );
    } else {
      console.log(
        `[runtimeEvidence] Run ${runId}: processed ${logFilesProcessed} log files, ` +
          `${observations.length} observations, ${matched.length} matched, ${noUsage.length} no-usage, ` +
          `${unmatchedHints.length} unmatched hints.`,
      );
    }

    return { persistenceSummary: runSummary, llmContext };
  } catch (err) {
    // Top-level safety net: ANY uncaught error here MUST NOT fail the
    // discovery run (acceptance criterion 22). Persist the failure-state
    // sub-stage and return the empty LLM context.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[runtimeEvidence] Run ${runId}: log processing failed at the orchestrator boundary: ${message}`,
    );
    const failedSummary: RuntimeEvidenceRunSummary = {
      skipped: true,
      reason: 'log_processing_failed',
      warnings: [message],
    };
    await persistSkipped(archModelClient, projectId, runId, failedSummary);
    return {
      persistenceSummary: failedSummary,
      llmContext: emptyLlmContext(),
    };
  }
}
