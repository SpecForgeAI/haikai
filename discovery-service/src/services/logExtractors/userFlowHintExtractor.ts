/**
 * User Flow Hint Log Extractor
 *
 * Scans parsed log entries for sequential request patterns that suggest
 * user journeys. Detects session/request ID reuse across entries and
 * common flow-related keywords (login, auth, checkout, payment, etc.).
 * Produces `string_pattern` evidence atoms with `source: "log"` and
 * `data.patternName: "user_flow_hint_log"`.
 *
 * Detects:
 * - Sequential request patterns: same session/request/correlation ID across multiple entries
 * - Flow-related keywords: login, logout, authenticate, register, checkout, payment, order, cart
 */

import { EvidenceAtom } from '../../types/evidenceAtom';
import { ParsedLogEntry } from '../../types/logParsing';
import { generateEvidenceId } from '../../utils/evidenceId';

/**
 * Regex patterns for detecting user flow indicators in log messages.
 */

/** Session or request ID patterns */
const SESSION_ID_REGEX = /\b(?:session[-_]?id|request[-_]?id|correlation[-_]?id|trace[-_]?id|x-request-id)\s*[=:]\s*['"]?([a-zA-Z0-9_-]{8,})/gi;

/** Common flow step keywords indicating user journeys */
const FLOW_KEYWORDS_REGEX = /\b(login|log[-_]?in|logout|log[-_]?out|sign[-_]?in|sign[-_]?out|sign[-_]?up|authenticate|authentication|authorize|authorization|register|registration|checkout|check[-_]?out|payment|pay|purchase|add[-_]?to[-_]?cart|cart|order|place[-_]?order|submit|confirm|verify|reset[-_]?password|forgot[-_]?password|onboarding|profile[-_]?update|upload|download)\b/gi;

/** Request lifecycle patterns (start/end of a request) */
const REQUEST_LIFECYCLE_REGEX = /\b(request\s+(?:started|received|completed|finished|failed)|response\s+(?:sent|returned)|handling\s+(?:GET|POST|PUT|PATCH|DELETE))\b/gi;

/**
 * Internal structure for tracking session/correlation ID sequences.
 */
interface SessionSequence {
  sessionId: string;
  entries: Array<{ lineNumber: number; message: string; timestamp: string | null }>;
}

/**
 * Internal aggregation for user flow hints.
 */
interface FlowHintAggregation {
  flowSignature: string;
  flowType: string;
  firstLine: number;
  lastLine: number;
  occurrenceCount: number;
  firstTimestamp: string | null;
  contextSnippet: string;
}

/**
 * Extracts user flow hint evidence from parsed log entries.
 *
 * @param entries - Parsed log entries to analyze
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param logFilePath - Path to the original log file
 * @returns Array of string_pattern evidence atoms for detected user flow hints
 */
export function extractUserFlowHints(
  entries: ParsedLogEntry[],
  runId: string,
  repoUrl: string,
  logFilePath: string
): EvidenceAtom[] {
  const now = new Date().toISOString();
  const aggregations = new Map<string, FlowHintAggregation>();

  // Phase 1: Detect session/correlation ID sequences
  const sessionSequences = new Map<string, SessionSequence>();

  for (const entry of entries) {
    const message = entry.message;

    // Also check metadata for session/request IDs
    let sessionId: string | null = null;

    SESSION_ID_REGEX.lastIndex = 0;
    const sessionMatch = SESSION_ID_REGEX.exec(message);
    if (sessionMatch) {
      sessionId = sessionMatch[1];
    }

    // Check metadata fields from JSON logs
    if (!sessionId && entry.metadata) {
      for (const key of ['sessionId', 'session_id', 'requestId', 'request_id', 'correlationId', 'correlation_id', 'traceId', 'trace_id']) {
        const val = entry.metadata[key];
        if (val && typeof val === 'string' && val.length >= 8) {
          sessionId = val;
          break;
        }
      }
    }

    if (sessionId) {
      if (!sessionSequences.has(sessionId)) {
        sessionSequences.set(sessionId, {
          sessionId,
          entries: [],
        });
      }
      sessionSequences.get(sessionId)!.entries.push({
        lineNumber: entry.lineNumber,
        message: entry.message,
        timestamp: entry.timestamp,
      });
    }
  }

  // Produce atoms for sessions with multiple entries (indicates a user flow/journey)
  for (const [, seq] of sessionSequences) {
    if (seq.entries.length >= 2) {
      const key = `session_flow:${seq.sessionId}`;
      const firstEntry = seq.entries[0];
      const lastEntry = seq.entries[seq.entries.length - 1];

      aggregations.set(key, {
        flowSignature: `session:${seq.sessionId}`,
        flowType: 'session_sequence',
        firstLine: firstEntry.lineNumber,
        lastLine: lastEntry.lineNumber,
        occurrenceCount: seq.entries.length,
        firstTimestamp: firstEntry.timestamp,
        contextSnippet: `Session ${seq.sessionId}: ${seq.entries.length} sequential requests`,
      });
    }
  }

  // Phase 2: Detect flow-related keyword patterns
  for (const entry of entries) {
    const message = entry.message;

    let match: RegExpExecArray | null;

    // Detect flow keywords
    FLOW_KEYWORDS_REGEX.lastIndex = 0;
    while ((match = FLOW_KEYWORDS_REGEX.exec(message)) !== null) {
      const keyword = match[1].toLowerCase().replace(/[-_]/g, '_');
      const key = `flow_keyword:${keyword}`;
      updateAggregation(aggregations, key, keyword, 'flow_keyword', entry);
    }

    // Detect request lifecycle events
    REQUEST_LIFECYCLE_REGEX.lastIndex = 0;
    while ((match = REQUEST_LIFECYCLE_REGEX.exec(message)) !== null) {
      const lifecycle = match[1].toLowerCase();
      const key = `request_lifecycle:${lifecycle}`;
      updateAggregation(aggregations, key, lifecycle, 'request_lifecycle', entry);
    }
  }

  // Convert aggregations to EvidenceAtoms
  const atoms: EvidenceAtom[] = [];
  for (const [, agg] of aggregations) {
    const distinguishingKey = `user_flow_hint_log:${agg.flowType}:${agg.flowSignature}`;
    const id = generateEvidenceId(runId, repoUrl, logFilePath, 'string_pattern', distinguishingKey);

    atoms.push({
      id,
      runId,
      repoUrl,
      filePath: logFilePath,
      type: 'string_pattern',
      data: {
        patternName: 'user_flow_hint_log',
        matchedText: `${agg.flowType}:${agg.flowSignature}`,
        line: agg.firstLine,
        contextSnippet: agg.contextSnippet.substring(0, 200),
      },
      extractedAt: now,
      source: 'log',
      logOrigin: {
        filePath: logFilePath,
        lineStart: agg.firstLine,
        lineEnd: agg.lastLine,
        timestamp: agg.firstTimestamp ?? undefined,
        occurrenceCount: agg.occurrenceCount,
      },
    });
  }

  return atoms;
}

/**
 * Updates or creates an aggregation entry for a detected flow hint.
 */
function updateAggregation(
  aggregations: Map<string, FlowHintAggregation>,
  key: string,
  flowSignature: string,
  flowType: string,
  entry: ParsedLogEntry
): void {
  const existing = aggregations.get(key);
  if (existing) {
    existing.lastLine = entry.lineNumber;
    existing.occurrenceCount += 1;
  } else {
    aggregations.set(key, {
      flowSignature,
      flowType,
      firstLine: entry.lineNumber,
      lastLine: entry.lineNumber,
      occurrenceCount: 1,
      firstTimestamp: entry.timestamp,
      contextSnippet: entry.message.trim(),
    });
  }
}
