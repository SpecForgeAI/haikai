/**
 * Plaintext Log Parser (Fallback)
 *
 * Used when the log format is 'unknown' -- auto-detection did not
 * match any recognized format. Each non-empty line becomes a
 * ParsedLogEntry with only `message`, `rawLine`, and `lineNumber`
 * populated; all other fields are null/empty.
 */

import { ParsedLogEntry } from '../../types/logParsing';

/**
 * Parses plain-text log lines into minimal ParsedLogEntry objects.
 *
 * Every non-empty line produces one entry. No structural extraction
 * is attempted -- downstream log extractors can still scan the
 * `message` field for patterns.
 *
 * @param lines - Raw log lines
 * @returns Array of parsed log entries
 */
export function parsePlaintext(lines: string[]): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Skip completely empty lines
    if (rawLine.trim().length === 0) continue;

    entries.push({
      timestamp: null,
      level: null,
      logger: null,
      message: rawLine,
      rawLine,
      lineNumber: i + 1,
      metadata: {},
    });
  }

  return entries;
}
