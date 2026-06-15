/**
 * Log Enrichment Metadata Computation (Increment 14)
 *
 * Computes `logEnrichment` metadata for discovery candidates by counting
 * log-derived atoms in their source clusters and generating a human-readable
 * signal summary.
 *
 * Used during candidate generation (step 1d) to annotate candidates with
 * information about log evidence contributions.
 */

import { EvidenceAtom, EvidenceCluster, StringPatternData } from '../types';
import { LogEnrichmentMetadata } from '../types/candidate';

/**
 * Human-readable labels for log extractor pattern names.
 *
 * Maps the `patternName` values set by log extractors to user-friendly
 * summary labels used in the signalSummary string.
 */
const PATTERN_LABEL_MAP: Record<string, string> = {
  endpoint_usage_log: 'endpoint hits observed',
  service_interaction_log: 'service interactions detected',
  error_trace_log: 'error traces matched',
  database_query_log: 'database queries found',
  user_flow_hint_log: 'user flow hints detected',
};

/**
 * Computes log enrichment metadata for a single candidate.
 *
 * Resolves the candidate's source cluster IDs to clusters, then counts
 * how many atom members have `source: "log"`. If any log atoms are found,
 * builds a human-readable signal summary aggregating by extractor pattern name.
 *
 * @param sourceClusterIds - IDs of the candidate's source clusters
 * @param clusterMap - Map of cluster ID -> EvidenceCluster
 * @param atomMap - Map of atom ID -> EvidenceAtom
 * @returns LogEnrichmentMetadata with enriched flag, log atom count, and signal summary
 */
export function computeLogEnrichmentForCandidate(
  sourceClusterIds: string[],
  clusterMap: Map<string, EvidenceCluster>,
  atomMap: Map<string, EvidenceAtom>
): LogEnrichmentMetadata {
  // Collect all unique log atoms from the candidate's source clusters
  const logAtomIds = new Set<string>();
  const patternCounts = new Map<string, number>();

  for (const clusterId of sourceClusterIds) {
    const cluster = clusterMap.get(clusterId);
    if (!cluster) continue;

    for (const member of cluster.members) {
      if (member.memberType !== 'atom') continue;

      const atom = atomMap.get(member.memberId);
      if (!atom || atom.source !== 'log') continue;

      // Track unique log atoms to avoid double-counting
      if (logAtomIds.has(atom.id)) continue;
      logAtomIds.add(atom.id);

      // Aggregate by pattern name for the signal summary
      const patternName = (atom.data as StringPatternData).patternName || 'unknown';
      const current = patternCounts.get(patternName) || 0;
      patternCounts.set(patternName, current + 1);
    }
  }

  const logAtomCount = logAtomIds.size;

  if (logAtomCount === 0) {
    return {
      enriched: false,
      logAtomCount: 0,
      signalSummary: '',
    };
  }

  // Build human-readable signal summary
  const summaryParts: string[] = [];
  for (const [patternName, count] of patternCounts) {
    const label = PATTERN_LABEL_MAP[patternName] || patternName;
    summaryParts.push(`${count} ${label}`);
  }

  return {
    enriched: true,
    logAtomCount,
    signalSummary: summaryParts.join(', '),
  };
}

/**
 * Builds lookup maps for clusters and atoms for efficient metadata computation.
 *
 * @param clusters - Array of evidence clusters
 * @param atoms - Array of evidence atoms
 * @returns Object containing clusterMap and atomMap
 */
export function buildLookupMaps(
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[]
): {
  clusterMap: Map<string, EvidenceCluster>;
  atomMap: Map<string, EvidenceAtom>;
} {
  const clusterMap = new Map<string, EvidenceCluster>();
  for (const cluster of clusters) {
    clusterMap.set(cluster.id, cluster);
  }

  const atomMap = new Map<string, EvidenceAtom>();
  for (const atom of atoms) {
    atomMap.set(atom.id, atom);
  }

  return { clusterMap, atomMap };
}
