/**
 * Error Trace Log Extractor
 *
 * Scans parsed log entries for stack traces, exception class names,
 * and error codes. Produces `string_pattern` evidence atoms with
 * `source: "log"` and `data.patternName: "error_trace_log"`.
 *
 * Detects:
 * - Stack trace lines (starting with "at ", "Caused by:", "Traceback")
 * - Java/JVM exception class names (e.g., NullPointerException, IOException)
 * - Python exception names (e.g., ValueError, KeyError)
 * - .NET exception patterns (e.g., System.NullReferenceException)
 * - Error codes (e.g., ERR-1001, E0001, HTTP 500)
 */

import { EvidenceAtom } from '../../types/evidenceAtom';
import { ParsedLogEntry } from '../../types/logParsing';
import { generateEvidenceId } from '../../utils/evidenceId';

/**
 * Regex patterns for detecting error traces in log messages.
 */

/** Java-style stack trace line: "at com.example.Class.method(File.java:42)" */
const JAVA_STACK_TRACE_REGEX = /^\s*at\s+([a-zA-Z0-9$_.]+)\(([^)]+)\)/;

/** "Caused by:" chain in stack traces */
const CAUSED_BY_REGEX = /^Caused by:\s*(.+)/;

/** Python traceback */
const PYTHON_TRACEBACK_REGEX = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)/;

/** Java/JVM exception class names */
const JAVA_EXCEPTION_REGEX = /\b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*\.(?:[A-Z][a-zA-Z]*Exception|[A-Z][a-zA-Z]*Error))\b/g;

/** Python-style exception names at the start or in the middle of a message */
const PYTHON_EXCEPTION_REGEX = /\b((?:Base)?Exception|(?:Attribute|Import|Index|Key|Name|OS|Runtime|Stop|Syntax|Type|Value|Zero|Division|File|Permission|Timeout|Connection|Http)Error)\b/g;

/** .NET exception patterns */
const DOTNET_EXCEPTION_REGEX = /\b(System\.[A-Z][a-zA-Z]*Exception)\b/g;

/** Structured error codes like ERR-1001, E0001, ERROR_CODE_123 */
const ERROR_CODE_REGEX = /\b(ERR[-_]?\d{3,}|E\d{4,}|ERROR_CODE[-_]\d+|HTTP\s+[45]\d{2})\b/gi;

/**
 * Internal aggregation for error trace occurrences.
 */
interface ErrorTraceAggregation {
  errorSignature: string;
  errorType: string;
  firstLine: number;
  lastLine: number;
  occurrenceCount: number;
  firstTimestamp: string | null;
  contextSnippet: string;
}

/**
 * Extracts error trace evidence from parsed log entries.
 *
 * @param entries - Parsed log entries to analyze
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param logFilePath - Path to the original log file
 * @returns Array of string_pattern evidence atoms for detected error traces
 */
export function extractErrorTraces(
  entries: ParsedLogEntry[],
  runId: string,
  repoUrl: string,
  logFilePath: string
): EvidenceAtom[] {
  const now = new Date().toISOString();
  const aggregations = new Map<string, ErrorTraceAggregation>();

  for (const entry of entries) {
    const message = entry.message;

    // Detect stack trace lines
    const stackTraceMatch = JAVA_STACK_TRACE_REGEX.exec(message);
    if (stackTraceMatch) {
      const className = stackTraceMatch[1];
      const key = `stack_trace:${className}`;
      updateAggregation(aggregations, key, className, 'stack_trace', entry);
    }

    // Detect "Caused by:" patterns
    const causedByMatch = CAUSED_BY_REGEX.exec(message);
    if (causedByMatch) {
      const cause = causedByMatch[1].trim().substring(0, 100);
      const key = `caused_by:${cause}`;
      updateAggregation(aggregations, key, cause, 'caused_by', entry);
    }

    // Detect Python tracebacks
    const pyTracebackMatch = PYTHON_TRACEBACK_REGEX.exec(message);
    if (pyTracebackMatch) {
      const filePath = pyTracebackMatch[1];
      const key = `python_traceback:${filePath}`;
      updateAggregation(aggregations, key, filePath, 'python_traceback', entry);
    }

    // Detect Java/JVM exception class names
    let match: RegExpExecArray | null;
    JAVA_EXCEPTION_REGEX.lastIndex = 0;
    while ((match = JAVA_EXCEPTION_REGEX.exec(message)) !== null) {
      const exceptionClass = match[1];
      const key = `exception:${exceptionClass}`;
      updateAggregation(aggregations, key, exceptionClass, 'exception_class', entry);
    }

    // Detect Python exception names
    PYTHON_EXCEPTION_REGEX.lastIndex = 0;
    while ((match = PYTHON_EXCEPTION_REGEX.exec(message)) !== null) {
      const exceptionName = match[1];
      const key = `py_exception:${exceptionName}`;
      updateAggregation(aggregations, key, exceptionName, 'exception_class', entry);
    }

    // Detect .NET exception patterns
    DOTNET_EXCEPTION_REGEX.lastIndex = 0;
    while ((match = DOTNET_EXCEPTION_REGEX.exec(message)) !== null) {
      const exceptionName = match[1];
      const key = `dotnet_exception:${exceptionName}`;
      updateAggregation(aggregations, key, exceptionName, 'exception_class', entry);
    }

    // Detect error codes
    ERROR_CODE_REGEX.lastIndex = 0;
    while ((match = ERROR_CODE_REGEX.exec(message)) !== null) {
      const errorCode = match[1].toUpperCase();
      const key = `error_code:${errorCode}`;
      updateAggregation(aggregations, key, errorCode, 'error_code', entry);
    }
  }

  // Convert aggregations to EvidenceAtoms
  const atoms: EvidenceAtom[] = [];
  for (const [, agg] of aggregations) {
    const distinguishingKey = `error_trace_log:${agg.errorType}:${agg.errorSignature}`;
    const id = generateEvidenceId(runId, repoUrl, logFilePath, 'string_pattern', distinguishingKey);

    atoms.push({
      id,
      runId,
      repoUrl,
      filePath: logFilePath,
      type: 'string_pattern',
      data: {
        patternName: 'error_trace_log',
        matchedText: `${agg.errorType}:${agg.errorSignature}`,
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
 * Updates or creates an aggregation entry for a detected error trace.
 */
function updateAggregation(
  aggregations: Map<string, ErrorTraceAggregation>,
  key: string,
  errorSignature: string,
  errorType: string,
  entry: ParsedLogEntry
): void {
  const existing = aggregations.get(key);
  if (existing) {
    existing.lastLine = entry.lineNumber;
    existing.occurrenceCount += 1;
  } else {
    aggregations.set(key, {
      errorSignature,
      errorType,
      firstLine: entry.lineNumber,
      lastLine: entry.lineNumber,
      occurrenceCount: 1,
      firstTimestamp: entry.timestamp,
      contextSnippet: entry.message.trim(),
    });
  }
}
