/**
 * Database Query Log Extractor
 *
 * Scans parsed log entries for SQL query patterns, database connection
 * strings, and table name references. Produces `string_pattern` evidence
 * atoms with `source: "log"` and `data.patternName: "database_query_log"`.
 *
 * Detects:
 * - SQL keywords with table names (SELECT ... FROM, INSERT INTO, UPDATE, DELETE FROM)
 * - Database connection strings (jdbc:, postgres://, mysql://, mongodb://)
 * - Table name references following SQL keywords
 */

import { EvidenceAtom } from '../../types/evidenceAtom';
import { ParsedLogEntry } from '../../types/logParsing';
import { generateEvidenceId } from '../../utils/evidenceId';

/**
 * Regex patterns for detecting database-related content in log messages.
 */

/** SQL DML statements with table names */
const SELECT_FROM_REGEX = /\bSELECT\b[\s\S]*?\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
const INSERT_INTO_REGEX = /\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
const UPDATE_TABLE_REGEX = /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+SET\b/gi;
const DELETE_FROM_REGEX = /\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;

/** CREATE TABLE, ALTER TABLE, DROP TABLE */
const DDL_TABLE_REGEX = /\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_.]*)/gi;

/** JOIN clauses with table names */
const JOIN_REGEX = /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;

/** Database connection strings */
const CONNECTION_STRING_REGEX = /\b(jdbc:[a-zA-Z]+:\/\/[^\s"'>,;)}\]]+|(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|amqp|mssql):\/\/[^\s"'>,;)}\]]+)/gi;

/**
 * Internal aggregation for database query occurrences.
 */
interface DatabaseQueryAggregation {
  signature: string;
  queryType: string;
  firstLine: number;
  lastLine: number;
  occurrenceCount: number;
  firstTimestamp: string | null;
  contextSnippet: string;
}

/**
 * Extracts database query evidence from parsed log entries.
 *
 * @param entries - Parsed log entries to analyze
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param logFilePath - Path to the original log file
 * @returns Array of string_pattern evidence atoms for detected database queries
 */
export function extractDatabaseQueries(
  entries: ParsedLogEntry[],
  runId: string,
  repoUrl: string,
  logFilePath: string
): EvidenceAtom[] {
  const now = new Date().toISOString();
  const aggregations = new Map<string, DatabaseQueryAggregation>();

  for (const entry of entries) {
    const message = entry.message;

    let match: RegExpExecArray | null;

    // Detect SELECT ... FROM
    SELECT_FROM_REGEX.lastIndex = 0;
    while ((match = SELECT_FROM_REGEX.exec(message)) !== null) {
      const tableName = match[1];
      const key = `select:${tableName.toLowerCase()}`;
      updateAggregation(aggregations, key, `SELECT FROM ${tableName}`, 'select', entry);
    }

    // Detect INSERT INTO
    INSERT_INTO_REGEX.lastIndex = 0;
    while ((match = INSERT_INTO_REGEX.exec(message)) !== null) {
      const tableName = match[1];
      const key = `insert:${tableName.toLowerCase()}`;
      updateAggregation(aggregations, key, `INSERT INTO ${tableName}`, 'insert', entry);
    }

    // Detect UPDATE ... SET
    UPDATE_TABLE_REGEX.lastIndex = 0;
    while ((match = UPDATE_TABLE_REGEX.exec(message)) !== null) {
      const tableName = match[1];
      const key = `update:${tableName.toLowerCase()}`;
      updateAggregation(aggregations, key, `UPDATE ${tableName}`, 'update', entry);
    }

    // Detect DELETE FROM
    DELETE_FROM_REGEX.lastIndex = 0;
    while ((match = DELETE_FROM_REGEX.exec(message)) !== null) {
      const tableName = match[1];
      const key = `delete:${tableName.toLowerCase()}`;
      updateAggregation(aggregations, key, `DELETE FROM ${tableName}`, 'delete', entry);
    }

    // Detect DDL (CREATE/ALTER/DROP TABLE)
    DDL_TABLE_REGEX.lastIndex = 0;
    while ((match = DDL_TABLE_REGEX.exec(message)) !== null) {
      const tableName = match[1];
      const key = `ddl:${tableName.toLowerCase()}`;
      updateAggregation(aggregations, key, `DDL ${tableName}`, 'ddl', entry);
    }

    // Detect JOINs
    JOIN_REGEX.lastIndex = 0;
    while ((match = JOIN_REGEX.exec(message)) !== null) {
      const tableName = match[1];
      const key = `join:${tableName.toLowerCase()}`;
      updateAggregation(aggregations, key, `JOIN ${tableName}`, 'join', entry);
    }

    // Detect connection strings
    CONNECTION_STRING_REGEX.lastIndex = 0;
    while ((match = CONNECTION_STRING_REGEX.exec(message)) !== null) {
      const connString = match[1];
      // Normalize: strip credentials if present
      const sanitized = connString.replace(/\/\/[^@]*@/, '//***@');
      const key = `connection:${sanitized.toLowerCase()}`;
      updateAggregation(aggregations, key, sanitized, 'connection_string', entry);
    }
  }

  // Convert aggregations to EvidenceAtoms
  const atoms: EvidenceAtom[] = [];
  for (const [, agg] of aggregations) {
    const distinguishingKey = `database_query_log:${agg.queryType}:${agg.signature}`;
    const id = generateEvidenceId(runId, repoUrl, logFilePath, 'string_pattern', distinguishingKey);

    atoms.push({
      id,
      runId,
      repoUrl,
      filePath: logFilePath,
      type: 'string_pattern',
      data: {
        patternName: 'database_query_log',
        matchedText: `${agg.queryType}:${agg.signature}`,
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
 * Updates or creates an aggregation entry for a detected database query.
 */
function updateAggregation(
  aggregations: Map<string, DatabaseQueryAggregation>,
  key: string,
  signature: string,
  queryType: string,
  entry: ParsedLogEntry
): void {
  const existing = aggregations.get(key);
  if (existing) {
    existing.lastLine = entry.lineNumber;
    existing.occurrenceCount += 1;
  } else {
    aggregations.set(key, {
      signature,
      queryType,
      firstLine: entry.lineNumber,
      lastLine: entry.lineNumber,
      occurrenceCount: 1,
      firstTimestamp: entry.timestamp,
      contextSnippet: entry.message.trim(),
    });
  }
}
