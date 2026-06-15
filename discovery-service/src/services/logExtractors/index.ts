/**
 * Log Evidence Extractors Barrel Export
 *
 * Re-exports all five log evidence extractors and provides a convenience
 * `runAllLogExtractors` function that calls all five and concatenates results.
 *
 * Each extractor receives parsed log entries and run context, and returns
 * EvidenceAtom[] with `source: "log"` and log-specific metadata.
 */

import { EvidenceAtom } from '../../types/evidenceAtom';
import { ParsedLogEntry } from '../../types/logParsing';
import { extractEndpointUsage } from './endpointUsageExtractor';
import { extractServiceInteractions } from './serviceInteractionExtractor';
import { extractErrorTraces } from './errorTraceExtractor';
import { extractDatabaseQueries } from './databaseQueryExtractor';
import { extractUserFlowHints } from './userFlowHintExtractor';

export { extractEndpointUsage } from './endpointUsageExtractor';
export { extractServiceInteractions } from './serviceInteractionExtractor';
export { extractErrorTraces } from './errorTraceExtractor';
export { extractDatabaseQueries } from './databaseQueryExtractor';
export { extractUserFlowHints } from './userFlowHintExtractor';

/**
 * Runs all five log evidence extractors against the given parsed entries
 * and concatenates the results into a single atom array.
 *
 * @param entries - Parsed log entries to analyze
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param logFilePath - Path to the original log file
 * @returns Combined array of evidence atoms from all extractors
 */
export function runAllLogExtractors(
  entries: ParsedLogEntry[],
  runId: string,
  repoUrl: string,
  logFilePath: string
): EvidenceAtom[] {
  const endpointAtoms = extractEndpointUsage(entries, runId, repoUrl, logFilePath);
  const serviceAtoms = extractServiceInteractions(entries, runId, repoUrl, logFilePath);
  const errorAtoms = extractErrorTraces(entries, runId, repoUrl, logFilePath);
  const databaseAtoms = extractDatabaseQueries(entries, runId, repoUrl, logFilePath);
  const flowAtoms = extractUserFlowHints(entries, runId, repoUrl, logFilePath);

  return [
    ...endpointAtoms,
    ...serviceAtoms,
    ...errorAtoms,
    ...databaseAtoms,
    ...flowAtoms,
  ];
}
