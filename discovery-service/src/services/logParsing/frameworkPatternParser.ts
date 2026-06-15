/**
 * Framework Pattern Log Parser
 *
 * Parses common Log4j / Logback / SLF4J pattern layout output.
 * Handles the ubiquitous format:
 *
 *   2024-01-15 10:30:45.123 [main] INFO com.example.App - Starting up
 *   2024-01-15 10:30:45,456 [http-nio-8080-exec-1] DEBUG c.e.SomeClass - handling request
 *
 * Pattern breakdown: date time [thread] LEVEL logger - message
 *
 * Also handles multiline stack traces by appending continuation lines
 * (lines that do not start with a timestamp) to the previous entry's message.
 */

import { ParsedLogEntry } from '../../types/logParsing';

/**
 * Primary framework log line regex:
 *   Group 1: date+time (e.g., "2024-01-15 10:30:45.123" or "2024-01-15 10:30:45,123")
 *   Group 2: thread name (e.g., "main", "http-nio-8080-exec-1")
 *   Group 3: level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
 *   Group 4: logger class (e.g., "com.example.App")
 *   Group 5: message (everything after " - ")
 */
const FRAMEWORK_LINE_REGEX =
  /^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[.,]\d{3})\s+\[(.+?)\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+(\S+)\s+-\s+(.*)/;

/**
 * Detects whether a line looks like the start of a new framework log entry
 * (i.e., begins with a date-time pattern). Used to distinguish new entries
 * from multiline continuation (stack traces, etc.).
 */
const TIMESTAMP_START_REGEX = /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/;

/**
 * Parses framework-pattern log lines into ParsedLogEntry objects.
 *
 * Lines matching the standard framework pattern are parsed into structured entries.
 * Lines that do NOT start with a timestamp (e.g., stack trace continuation, multiline
 * messages) are appended to the previous entry's message field.
 *
 * @param lines - Raw log lines
 * @returns Array of parsed log entries
 */
export function parseFrameworkPattern(lines: string[]): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) continue;

    const match = FRAMEWORK_LINE_REGEX.exec(trimmed);

    if (match) {
      const [, timestamp, thread, level, logger, message] = match;

      entries.push({
        timestamp: timestamp || null,
        level: level || null,
        logger: logger || null,
        message: message,
        rawLine,
        lineNumber: i + 1,
        metadata: {
          thread: thread,
        },
      });
    } else if (!TIMESTAMP_START_REGEX.test(trimmed)) {
      // Continuation line (stack trace, multiline message)
      // Append to previous entry if available
      if (entries.length > 0) {
        entries[entries.length - 1].message += '\n' + rawLine;
      }
    } else {
      // Line starts with a timestamp but doesn't match the full framework pattern.
      // Treat it as a standalone entry with only message populated.
      entries.push({
        timestamp: null,
        level: null,
        logger: null,
        message: trimmed,
        rawLine,
        lineNumber: i + 1,
        metadata: {},
      });
    }
  }

  return entries;
}
