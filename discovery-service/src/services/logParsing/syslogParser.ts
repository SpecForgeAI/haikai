/**
 * Syslog Log Parser
 *
 * Parses RFC 3164-style (BSD) syslog messages with the pattern:
 *   timestamp hostname process[pid]: message
 *
 * Supports both traditional BSD timestamps (e.g., "Jan 15 10:30:45")
 * and ISO-8601 timestamps (e.g., "2024-01-15T10:30:45.000Z").
 *
 * Maps:
 *   - timestamp -> timestamp
 *   - hostname  -> metadata.hostname
 *   - process   -> logger
 *   - pid       -> metadata.pid
 *   - message   -> message
 *
 * Level is not inherently part of the syslog message text, so it
 * remains null unless a recognizable level keyword appears in the message.
 */

import { ParsedLogEntry } from '../../types/logParsing';

/**
 * BSD-style syslog regex:
 *   Group 1: timestamp (e.g., "Jan 15 10:30:45")
 *   Group 2: hostname
 *   Group 3: process name
 *   Group 4: PID (optional, captured without brackets)
 *   Group 5: message
 */
const BSD_SYSLOG_REGEX =
  /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s+(.*)/;

/**
 * ISO-8601 syslog regex:
 *   Group 1: ISO timestamp (e.g., "2024-01-15T10:30:45.000Z")
 *   Group 2: hostname
 *   Group 3: process name
 *   Group 4: PID (optional)
 *   Group 5: message
 */
const ISO_SYSLOG_REGEX =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s+(.*)/;

/**
 * Attempt to detect a log level from the message content.
 * Returns the level string (uppercased) if found, otherwise null.
 */
const LEVEL_KEYWORDS = /\b(EMERG|ALERT|CRIT|ERROR|WARN(?:ING)?|NOTICE|INFO|DEBUG)\b/i;

function detectLevelFromMessage(message: string): string | null {
  const match = LEVEL_KEYWORDS.exec(message);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Parses syslog-formatted log lines into ParsedLogEntry objects.
 *
 * Lines that do not match either syslog regex are treated as
 * plain continuation lines and appended to the previous entry's
 * message (if one exists), or skipped if there is no previous entry.
 *
 * @param lines - Raw log lines
 * @returns Array of parsed log entries
 */
export function parseSyslog(lines: string[]): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) continue;

    // Try BSD-style first, then ISO-8601
    const bsdMatch = BSD_SYSLOG_REGEX.exec(trimmed);
    const isoMatch = bsdMatch ? null : ISO_SYSLOG_REGEX.exec(trimmed);
    const match = bsdMatch || isoMatch;

    if (match) {
      const [, timestamp, hostname, processName, pid, message] = match;

      entries.push({
        timestamp: timestamp || null,
        level: detectLevelFromMessage(message),
        logger: processName || null,
        message: message,
        rawLine,
        lineNumber: i + 1,
        metadata: {
          hostname: hostname,
          ...(pid ? { pid: parseInt(pid, 10) } : {}),
        },
      });
    } else {
      // Non-matching line: append to previous entry if available
      if (entries.length > 0) {
        entries[entries.length - 1].message += '\n' + rawLine;
      }
      // Otherwise skip the orphan line
    }
  }

  return entries;
}
