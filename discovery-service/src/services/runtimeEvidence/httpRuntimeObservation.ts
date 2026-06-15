/**
 * Runtime Evidence Type Definitions
 *
 * Type-only module for the runtime-evidence sub-stage of `runDiscoveryV3`.
 * No runtime code lives here — co-locating these declarations keeps the
 * downstream modules (parser, aggregator, matcher, persistence,
 * LLM context builder, orchestrator) free of cross-module circular imports.
 *
 * The shapes pinned here mirror the spec section
 * "Type definitions to pin" exactly; do NOT introduce drift without
 * updating spec.md first.
 */

/**
 * A single parsed HTTP request observation derived from a log line.
 *
 * One observation per usable log line. Produced by `accessLogParser`
 * (CLF Common / Combined) or by inline extraction over `ParsedLogEntry`
 * rows for non-CLF formats.
 */
export interface HttpRuntimeObservation {
  /** Uppercase HTTP method (e.g. "GET", "POST"). */
  method: string;
  /** Path exactly as it appeared in the log line, query string stripped. */
  rawPath: string;
  /** Path after three-tier path-segment normalization to `{id}` placeholders. */
  normalizedPath: string;
  /** HTTP status code (integer 100..599). */
  status: number;
  /** ISO 8601 timestamp string when the request occurred, if the log format provides it. */
  timestampIso?: string;
  /** Identifier of the source log artifact (matches `inputArtifacts.logFiles[].artifactId`). */
  sourceArtifactId: string;
  /** Display filename of the source log file (matches `inputArtifacts.logFiles[].fileName`). */
  sourceFileName: string;
  /** 1-based line number within the source log file. */
  lineNumber: number;
  /** Optional safe snippet (≤200 chars), only when consistent with existing evidence-atom snippet conventions. */
  snippet?: string;
}

/**
 * Aggregated stats for a single endpoint key (`method + normalizedPath`).
 *
 * Built by `endpointRuntimeAggregator` after grouping all
 * `HttpRuntimeObservation` rows. Pure-404 routes (every observation 404
 * with zero 2xx/3xx) are excluded entirely from the aggregator output.
 */
export interface EndpointRuntimeAggregate {
  /** Uppercase HTTP method. */
  method: string;
  /** Normalized path template (with `{id}` placeholders). */
  normalizedPath: string;
  /** Total log requests observed for this endpoint, regardless of status. */
  totalLogRequests: number;
  /** "Observed usage" count = 2xx + 3xx only. 4xx and 5xx do NOT contribute. */
  observedUsageCount: number;
  /** Count of 2xx responses. */
  status2xxCount: number;
  /** Count of 3xx responses. */
  status3xxCount: number;
  /** Count of 4xx responses (excluded from `observedUsageCount`). */
  status4xxCount: number;
  /** Count of 5xx responses (excluded from `observedUsageCount`). */
  status5xxCount: number;
  /** Top status codes for this endpoint, sorted by count desc. */
  topStatusCodes: Array<{ status: number; count: number }>;
  /** ISO 8601 timestamp of the earliest observation for this endpoint, if any. */
  firstSeen?: string;
  /** ISO 8601 timestamp of the latest observation for this endpoint, if any. */
  lastSeen?: string;
  /** Number of distinct source log files contributing to this endpoint. */
  sourceLogFileCount: number;
  /** Display names of the source log files contributing to this endpoint. */
  sourceLogFiles: string[];
  /** A small bounded set of `{ sourceArtifactId, lineNumber }` pointers for traceability. */
  sampleLineRefs: Array<{ sourceArtifactId: string; lineNumber: number }>;
}

/**
 * Per-candidate matched runtime evidence written into
 * `logEnrichment.runtime.matched` on a `DiscoveryCandidate` of type
 * `endpoints`.
 */
export interface MatchedRuntimeEvidence {
  candidateId: string;
  candidateType: 'endpoints';
  /** Uppercase HTTP method. */
  method: string;
  /** Path template carried over from the matched code candidate (preserved for display). */
  codePathTemplate: string;
  /** Normalized log path that produced the match. */
  normalizedLogPath: string;
  totalLogRequests: number;
  observedUsageCount: number;
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
  topStatusCodes: Array<{ status: number; count: number }>;
  firstSeen?: string;
  lastSeen?: string;
  sourceLogFileCount: number;
  /** `'high'` for exact normalized-path match, `'medium'` for equivalent-placeholder, `'low'` reserved. */
  matchConfidence: 'high' | 'medium' | 'low';
  /** Short machine-readable reason (e.g. `'exact_normalized_path'`, `'equivalent_placeholders'`). */
  matchReason: string;
}

/**
 * Per-candidate "no usage observed" evidence written into
 * `logEnrichment.runtime` on `endpoints` candidates that had no
 * matching log aggregate within the processed log window.
 *
 * Phrased as "no usage observed" — never "unused" — to make clear
 * that absence of data is not evidence of removal.
 */
export interface NoUsageRuntimeEvidence {
  candidateId: string;
  candidateType: 'endpoints';
  observedUsageCount: 0;
  status2xxCount: 0;
  status3xxCount: 0;
  status4xxCount: 0;
  status5xxCount: 0;
  totalLogRequests: 0;
  noUsageObserved: true;
  /** Human-readable, non-judgemental note (e.g. "No matching log observations in processed log window"). */
  note: string;
}

/**
 * Run-level unmatched route hint — an aggregated endpoint that crossed
 * the env-configurable `RUNTIME_UNMATCHED_HINT_THRESHOLD` (default 5)
 * for `2xx + 3xx` responses but did NOT match any deterministic
 * code-discovered endpoint candidate.
 *
 * Reported under `steps_payload.v3.runtimeEvidence.unmatchedRouteHints[]`.
 */
export interface UnmatchedRouteHint {
  method: string;
  pathTemplate: string;
  observedUsageCount: number;
  status2xxCount: number;
  status3xxCount: number;
}

/**
 * Run-level summary persisted to `steps_payload.v3.runtimeEvidence`.
 *
 * Three variant shapes:
 *   1. The full happy-path summary
 *   2. `{ skipped: true, reason: 'no_log_artifacts' }` when the run has no log files uploaded
 *   3. `{ skipped: true, reason: 'log_processing_failed', warnings: string[] }` when all log files fail to parse
 */
export type RuntimeEvidenceRunSummary =
  | {
      logFilesProcessed: number;
      logWindow: { firstSeen?: string; lastSeen?: string };
      totals: {
        observations: number;
        matchedEndpoints: number;
        noUsageEndpoints: number;
        unmatchedHints: number;
      };
      warnings: string[];
      unmatchedRouteHints: UnmatchedRouteHint[];
    }
  | { skipped: true; reason: 'no_log_artifacts' }
  | { skipped: true; reason: 'log_processing_failed'; warnings: string[] };

/**
 * Discriminated union written into `LogEnrichmentMetadata.runtime` for
 * a single endpoint candidate.
 *
 * Either `{ matched: MatchedRuntimeEvidence }` (the candidate had at
 * least one matching log aggregate) OR
 * `{ noUsageObserved: true } & NoUsageRuntimeEvidence` (the candidate
 * had no matching aggregate within the log window).
 */
export type LogEnrichmentRuntimeBlock =
  | { matched: MatchedRuntimeEvidence }
  | ({ noUsageObserved: true } & NoUsageRuntimeEvidence);

/**
 * Compact LLM-facing summary, injected into the gap-fill prompt
 * alongside `packCandidates` and `ir`. Strict subset of fields —
 * NO IPs, NO user agents, NO referrers, NO source-file lists, NO
 * sample-line refs, NO snippets — to keep the prompt tight and to
 * uphold the "no raw log content to LLM" privacy rule.
 */
export interface RuntimeEvidenceLlmContext {
  runtimeEvidenceSummary: {
    logFilesProcessed: number;
    logWindow: { firstSeen?: string; lastSeen?: string };
    matchedEndpoints: Array<{
      candidateId: string;
      method: string;
      pathTemplate: string;
      observedUsageCount: number;
      status2xxCount: number;
      status3xxCount: number;
      status4xxCount: number;
      status5xxCount: number;
    }>;
    codeEndpointsWithNoObservedUsage: Array<{
      candidateId: string;
      method: string;
      pathTemplate: string;
    }>;
    unmatchedRuntimeRouteHints: Array<{
      method: string;
      pathTemplate: string;
      observedUsageCount: number;
    }>;
  };
}

/**
 * Orchestrator (`runDiscoveryRuntimeEvidence`) return shape.
 *
 * Carries both the persistence summary (used by the orchestrator's
 * caller for status/observability) AND the compact LLM context
 * (passed into the gap-fill prompt composer).
 */
export interface RuntimeEvidenceResult {
  persistenceSummary: RuntimeEvidenceRunSummary;
  llmContext: RuntimeEvidenceLlmContext;
}
