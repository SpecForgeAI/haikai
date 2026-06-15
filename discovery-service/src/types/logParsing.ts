/**
 * Log Parsing Types
 *
 * Defines the intermediate representation produced by all log format parsers.
 * Each parser (JSON lines, syslog, framework pattern, plaintext) converts
 * raw log lines into a uniform ParsedLogEntry array for downstream extraction.
 */

/**
 * A single parsed log entry produced by any format-specific parser.
 *
 * Fields are nullable where the format may not provide them --
 * for example, syslog entries typically lack a `level` field,
 * and plaintext entries have only `message`, `rawLine`, and `lineNumber`.
 */
export interface ParsedLogEntry {
  /** ISO-8601 or raw timestamp string, null if the format provides none. */
  timestamp: string | null;

  /** Log level (e.g., INFO, WARN, ERROR), null if not present. */
  level: string | null;

  /** Logger name or class, null if not present. */
  logger: string | null;

  /** The primary log message content. */
  message: string;

  /** The original unmodified line from the log file. */
  rawLine: string;

  /** 1-based line number in the source file. */
  lineNumber: number;

  /** Additional structured fields extracted from the log entry (e.g., from JSON). */
  metadata: Record<string, unknown>;
}
