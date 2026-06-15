/**
 * Log Parsing Barrel Export
 *
 * Re-exports the format detector, all four parsers, and the
 * convenience `parseLogContent` function that auto-detects
 * format and delegates to the appropriate parser.
 */

import { ParsedLogEntry } from '../../types/logParsing';
import { detectLogFormat, LogFormat } from './logFormatDetector';
import { parseJsonLines } from './jsonLinesParser';
import { parseSyslog } from './syslogParser';
import { parseFrameworkPattern } from './frameworkPatternParser';
import { parsePlaintext } from './plaintextParser';

export { detectLogFormat, LogFormat } from './logFormatDetector';
export { parseJsonLines } from './jsonLinesParser';
export { parseSyslog } from './syslogParser';
export { parseFrameworkPattern } from './frameworkPatternParser';
export { parsePlaintext } from './plaintextParser';

/**
 * Result of the convenience `parseLogContent` function.
 */
export interface ParseLogContentResult {
  /** The detected (or fallback) format label. */
  format: string;
  /** The parsed log entries produced by the format-specific parser. */
  entries: ParsedLogEntry[];
}

/**
 * Convenience function: splits raw log content into lines,
 * auto-detects the format, delegates to the matching parser,
 * and returns both the detected format and the parsed entries.
 *
 * @param content - Raw log file content as a single string
 * @returns Object with detected format and parsed entries
 */
export function parseLogContent(content: string): ParseLogContentResult {
  const lines = content.split('\n');
  const format: LogFormat = detectLogFormat(lines);

  let entries: ParsedLogEntry[];

  switch (format) {
    case 'json_lines':
      entries = parseJsonLines(lines);
      break;
    case 'syslog':
      entries = parseSyslog(lines);
      break;
    case 'framework_pattern':
      entries = parseFrameworkPattern(lines);
      break;
    case 'unknown':
    default:
      entries = parsePlaintext(lines);
      break;
  }

  return { format, entries };
}
