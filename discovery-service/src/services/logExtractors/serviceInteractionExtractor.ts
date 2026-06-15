/**
 * Service Interaction Log Extractor
 *
 * Scans parsed log entries for HTTP/HTTPS URLs, host:port patterns,
 * gRPC references, and service name mentions. Produces `string_pattern`
 * evidence atoms with `source: "log"` and `data.patternName: "service_interaction_log"`.
 *
 * Aggregates occurrences of the same service reference across multiple
 * log lines, recording line range and occurrence count.
 */

import { EvidenceAtom } from '../../types/evidenceAtom';
import { ParsedLogEntry } from '../../types/logParsing';
import { generateEvidenceId } from '../../utils/evidenceId';

/**
 * Regex patterns for detecting service interactions in log messages.
 */

/** HTTP/HTTPS URLs pointing to external services */
const HTTP_URL_REGEX = /\bhttps?:\/\/([a-zA-Z0-9._-]+(?::\d+)?)[^\s"'>,;)}\]]*/gi;

/** Host:port patterns (e.g., "db-server:5432", "redis-host:6379") */
const HOST_PORT_REGEX = /\b([a-zA-Z][a-zA-Z0-9._-]*):(\d{2,5})\b/g;

/** gRPC references */
const GRPC_REGEX = /\bgrpc:\/\/([a-zA-Z0-9._-]+(?::\d+)?)[^\s"']*/gi;
const GRPC_CHANNEL_REGEX = /\b(?:grpc|gRPC)\s+(?:channel|call|request|connection|stub)\s+(?:to\s+)?([a-zA-Z0-9._-]+)/gi;

/** Service name patterns commonly found in logs */
const SERVICE_NAME_REGEX = /\b(?:calling|connecting to|forwarding to|proxying to|request to|response from|upstream|downstream)\s+(?:service\s+)?['"]?([a-zA-Z][a-zA-Z0-9_-]+(?:-service|-svc|-api|-server)?)\b/gi;

/**
 * Internal structure for aggregating service interaction occurrences.
 */
interface ServiceInteractionAggregation {
  target: string;
  interactionType: string;
  firstLine: number;
  lastLine: number;
  occurrenceCount: number;
  firstTimestamp: string | null;
  contextSnippet: string;
}

/**
 * Extracts service interaction evidence from parsed log entries.
 *
 * @param entries - Parsed log entries to analyze
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param logFilePath - Path to the original log file
 * @returns Array of string_pattern evidence atoms for detected service interactions
 */
export function extractServiceInteractions(
  entries: ParsedLogEntry[],
  runId: string,
  repoUrl: string,
  logFilePath: string
): EvidenceAtom[] {
  const now = new Date().toISOString();
  const aggregations = new Map<string, ServiceInteractionAggregation>();

  for (const entry of entries) {
    const message = entry.message;

    // Match HTTP/HTTPS URLs
    let match: RegExpExecArray | null;
    HTTP_URL_REGEX.lastIndex = 0;
    while ((match = HTTP_URL_REGEX.exec(message)) !== null) {
      const host = match[1];
      const fullUrl = match[0];
      const key = `http:${host}`;

      updateAggregation(aggregations, key, host, 'http', entry, fullUrl);
    }

    // Match gRPC URLs
    GRPC_REGEX.lastIndex = 0;
    while ((match = GRPC_REGEX.exec(message)) !== null) {
      const host = match[1];
      const key = `grpc:${host}`;

      updateAggregation(aggregations, key, host, 'grpc', entry, match[0]);
    }

    // Match gRPC channel/call references
    GRPC_CHANNEL_REGEX.lastIndex = 0;
    while ((match = GRPC_CHANNEL_REGEX.exec(message)) !== null) {
      const target = match[1];
      const key = `grpc_ref:${target}`;

      if (!aggregations.has(key)) {
        updateAggregation(aggregations, key, target, 'grpc', entry, match[0]);
      }
    }

    // Match host:port patterns (skip common false positives like timestamps)
    HOST_PORT_REGEX.lastIndex = 0;
    while ((match = HOST_PORT_REGEX.exec(message)) !== null) {
      const host = match[1];
      const port = parseInt(match[2], 10);

      // Filter out unlikely service ports and common false positives
      if (port < 80 || port > 65535) continue;
      // Skip if the host looks like a timestamp component
      if (/^\d+$/.test(host)) continue;

      const key = `hostport:${host}:${port}`;
      if (!aggregations.has(key) && !aggregations.has(`http:${host}:${port}`)) {
        updateAggregation(aggregations, key, `${host}:${port}`, 'host_port', entry, match[0]);
      }
    }

    // Match service name references
    SERVICE_NAME_REGEX.lastIndex = 0;
    while ((match = SERVICE_NAME_REGEX.exec(message)) !== null) {
      const serviceName = match[1];
      const key = `service:${serviceName.toLowerCase()}`;

      if (!aggregations.has(key)) {
        updateAggregation(aggregations, key, serviceName, 'service_name', entry, match[0]);
      } else {
        const existing = aggregations.get(key)!;
        existing.lastLine = entry.lineNumber;
        existing.occurrenceCount += 1;
      }
    }
  }

  // Convert aggregations to EvidenceAtoms
  const atoms: EvidenceAtom[] = [];
  for (const [, agg] of aggregations) {
    const distinguishingKey = `service_interaction_log:${agg.interactionType}:${agg.target}`;
    const id = generateEvidenceId(runId, repoUrl, logFilePath, 'string_pattern', distinguishingKey);

    atoms.push({
      id,
      runId,
      repoUrl,
      filePath: logFilePath,
      type: 'string_pattern',
      data: {
        patternName: 'service_interaction_log',
        matchedText: `${agg.interactionType}:${agg.target}`,
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
 * Updates or creates an aggregation entry for a detected service interaction.
 */
function updateAggregation(
  aggregations: Map<string, ServiceInteractionAggregation>,
  key: string,
  target: string,
  interactionType: string,
  entry: ParsedLogEntry,
  matchedText: string
): void {
  const existing = aggregations.get(key);
  if (existing) {
    existing.lastLine = entry.lineNumber;
    existing.occurrenceCount += 1;
  } else {
    aggregations.set(key, {
      target,
      interactionType,
      firstLine: entry.lineNumber,
      lastLine: entry.lineNumber,
      occurrenceCount: 1,
      firstTimestamp: entry.timestamp,
      contextSnippet: (matchedText || entry.message).trim(),
    });
  }
}
