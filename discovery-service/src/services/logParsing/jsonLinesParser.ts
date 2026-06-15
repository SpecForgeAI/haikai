/**
 * JSON Lines Log Parser
 *
 * Parses log content where each line is a JSON object containing
 * structured log fields. Extracts standard fields (timestamp, level,
 * logger, message) and places remaining fields into metadata.
 *
 * Common JSON log formats supported:
 *   - Bunyan/Pino: { "time": "...", "level": 30, "msg": "...", "name": "..." }
 *   - Winston/Structured: { "timestamp": "...", "level": "info", "message": "...", "logger": "..." }
 *   - Generic: any JSON object with recognizable field names
 */

import { ParsedLogEntry } from '../../types/logParsing';

/**
 * Well-known field names for timestamp extraction.
 */
const TIMESTAMP_FIELDS = ['timestamp', 'time', '@timestamp', 'ts', 'datetime', 'date'];

/**
 * Well-known field names for log level extraction.
 */
const LEVEL_FIELDS = ['level', 'severity', 'loglevel', 'log_level', 'lvl'];

/**
 * Well-known field names for logger/source extraction.
 */
const LOGGER_FIELDS = ['logger', 'loggerName', 'logger_name', 'name', 'source', 'class'];

/**
 * Well-known field names for message extraction.
 */
const MESSAGE_FIELDS = ['message', 'msg', 'text', 'body'];

/**
 * Extracts a string value for a field by checking a list of candidate keys.
 * Returns null if no matching key is found.
 */
function extractField(obj: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) {
      return String(obj[key]);
    }
  }
  return null;
}

/**
 * Collects all fields from the JSON object that were NOT consumed by
 * the standard field extraction into the metadata record.
 */
function extractMetadata(
  obj: Record<string, unknown>,
  consumedKeys: Set<string>
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!consumedKeys.has(key)) {
      metadata[key] = value;
    }
  }
  return metadata;
}

/**
 * Finds which key matched from the candidates list, if any.
 */
function findMatchedKey(obj: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) {
      return key;
    }
  }
  return null;
}

/**
 * Parses an array of JSON-lines log content into ParsedLogEntry objects.
 *
 * Each line is parsed as a JSON object. Standard fields are extracted
 * into the corresponding ParsedLogEntry fields; remaining JSON fields
 * go into `metadata`. Lines that fail to parse are skipped with a
 * warning logged to the console.
 *
 * @param lines - Raw log lines, each expected to be a JSON object string
 * @returns Array of parsed log entries
 */
export function parseJsonLines(lines: string[]): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) continue;

    try {
      const obj = JSON.parse(trimmed);

      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        console.warn(`[jsonLinesParser] Line ${i + 1}: parsed value is not a JSON object, skipping`);
        continue;
      }

      const record = obj as Record<string, unknown>;

      // Extract standard fields and track consumed keys
      const consumedKeys = new Set<string>();

      const timestampKey = findMatchedKey(record, TIMESTAMP_FIELDS);
      const timestamp = timestampKey ? String(record[timestampKey]) : null;
      if (timestampKey) consumedKeys.add(timestampKey);

      const levelKey = findMatchedKey(record, LEVEL_FIELDS);
      const level = levelKey ? String(record[levelKey]) : null;
      if (levelKey) consumedKeys.add(levelKey);

      const loggerKey = findMatchedKey(record, LOGGER_FIELDS);
      const logger = loggerKey ? String(record[loggerKey]) : null;
      if (loggerKey) consumedKeys.add(loggerKey);

      const messageKey = findMatchedKey(record, MESSAGE_FIELDS);
      const message = messageKey ? String(record[messageKey]) : '';
      if (messageKey) consumedKeys.add(messageKey);

      const metadata = extractMetadata(record, consumedKeys);

      entries.push({
        timestamp,
        level,
        logger,
        message,
        rawLine,
        lineNumber: i + 1,
        metadata,
      });
    } catch {
      console.warn(`[jsonLinesParser] Line ${i + 1}: failed to parse JSON, skipping`);
    }
  }

  return entries;
}
