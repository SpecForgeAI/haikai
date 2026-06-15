/**
 * Endpoint Usage Log Extractor
 *
 * Scans parsed log entries for URL paths, HTTP method + path patterns,
 * and route references. Produces `string_pattern` evidence atoms with
 * `source: "log"` and `data.patternName: "endpoint_usage_log"`.
 *
 * Aggregates occurrences of the same endpoint across multiple log lines,
 * recording the first and last line numbers and total occurrence count.
 */

import { EvidenceAtom } from '../../types/evidenceAtom';
import { ParsedLogEntry } from '../../types/logParsing';
import { generateEvidenceId } from '../../utils/evidenceId';

/**
 * Regex patterns for detecting endpoint usage in log messages.
 *
 * - HTTP method + path: e.g., "GET /api/users", "POST /v1/orders"
 * - URL paths starting with common API prefixes
 * - Generic path patterns that look like route definitions
 */
const HTTP_METHOD_PATH_REGEX = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s"'>,;)}\]]+)/gi;
const API_PATH_REGEX = /(?:^|\s|["'=:>])(\/(?:api|v[0-9]+|rest|graphql|webhook|health|metrics|status|auth|oauth)\/[^\s"'>,;)}\]]*)/gi;
const ROUTE_PATTERN_REGEX = /(?:^|\s|["'=:>])(\/[a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_:{}.-]+){1,})/g;

/**
 * Internal structure for aggregating endpoint occurrences.
 */
interface EndpointAggregation {
  endpoint: string;
  method: string | null;
  firstLine: number;
  lastLine: number;
  occurrenceCount: number;
  firstTimestamp: string | null;
  contextSnippet: string;
}

/**
 * Normalizes an endpoint path by trimming trailing punctuation and
 * collapsing path parameter segments into a canonical form.
 */
function normalizeEndpoint(path: string): string {
  // Trim trailing punctuation that is not part of the path
  let normalized = path.replace(/[.,;:!?]+$/, '');
  // Collapse numeric path segments into {id} for aggregation
  normalized = normalized.replace(/\/\d+/g, '/{id}');
  return normalized;
}

/**
 * Extracts endpoint usage evidence from parsed log entries.
 *
 * @param entries - Parsed log entries to analyze
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param logFilePath - Path to the original log file
 * @returns Array of string_pattern evidence atoms for detected endpoints
 */
export function extractEndpointUsage(
  entries: ParsedLogEntry[],
  runId: string,
  repoUrl: string,
  logFilePath: string
): EvidenceAtom[] {
  const now = new Date().toISOString();
  const aggregations = new Map<string, EndpointAggregation>();

  for (const entry of entries) {
    const message = entry.message;

    // Match HTTP method + path patterns
    let match: RegExpExecArray | null;
    HTTP_METHOD_PATH_REGEX.lastIndex = 0;
    while ((match = HTTP_METHOD_PATH_REGEX.exec(message)) !== null) {
      const method = match[1].toUpperCase();
      const rawPath = match[2];
      const normalizedPath = normalizeEndpoint(rawPath);
      const key = `${method} ${normalizedPath}`;

      updateAggregation(aggregations, key, normalizedPath, method, entry);
    }

    // Match API path patterns (without explicit HTTP method)
    API_PATH_REGEX.lastIndex = 0;
    while ((match = API_PATH_REGEX.exec(message)) !== null) {
      const rawPath = match[1];
      const normalizedPath = normalizeEndpoint(rawPath);
      const key = normalizedPath;

      if (!aggregations.has(key)) {
        updateAggregation(aggregations, key, normalizedPath, null, entry);
      }
    }

    // Match route-like patterns with at least 2 segments
    ROUTE_PATTERN_REGEX.lastIndex = 0;
    while ((match = ROUTE_PATTERN_REGEX.exec(message)) !== null) {
      const rawPath = match[1];
      const normalizedPath = normalizeEndpoint(rawPath);
      const key = normalizedPath;

      // Only add if not already captured by more specific patterns
      if (!aggregations.has(key) && !aggregations.has(`GET ${key}`) && !aggregations.has(`POST ${key}`)) {
        updateAggregation(aggregations, key, normalizedPath, null, entry);
      }
    }
  }

  // Convert aggregations to EvidenceAtoms
  const atoms: EvidenceAtom[] = [];
  for (const [, agg] of aggregations) {
    const distinguishingKey = `endpoint_usage_log:${agg.method ?? 'ANY'}:${agg.endpoint}`;
    const id = generateEvidenceId(runId, repoUrl, logFilePath, 'string_pattern', distinguishingKey);

    const matchedText = agg.method ? `${agg.method} ${agg.endpoint}` : agg.endpoint;

    atoms.push({
      id,
      runId,
      repoUrl,
      filePath: logFilePath,
      type: 'string_pattern',
      data: {
        patternName: 'endpoint_usage_log',
        matchedText,
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
 * Updates or creates an aggregation entry for a detected endpoint.
 */
function updateAggregation(
  aggregations: Map<string, EndpointAggregation>,
  key: string,
  endpoint: string,
  method: string | null,
  entry: ParsedLogEntry
): void {
  const existing = aggregations.get(key);
  if (existing) {
    existing.lastLine = entry.lineNumber;
    existing.occurrenceCount += 1;
  } else {
    aggregations.set(key, {
      endpoint,
      method,
      firstLine: entry.lineNumber,
      lastLine: entry.lineNumber,
      occurrenceCount: 1,
      firstTimestamp: entry.timestamp,
      contextSnippet: entry.message.trim(),
    });
  }
}
