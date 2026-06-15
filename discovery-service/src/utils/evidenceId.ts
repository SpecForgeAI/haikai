import { createHash } from 'crypto';

/**
 * Converts a hex string to UUID format (8-4-4-4-12).
 * Takes the first 32 hex characters and inserts dashes.
 */
function hexToUuid(hex: string): string {
  const h = hex.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Generates a deterministic evidence atom ID by hashing the concatenated inputs.
 *
 * Uses SHA-256 to produce a consistent, collision-resistant identifier
 * formatted as a UUID (8-4-4-4-12). The same combination of inputs always
 * produces the same ID, enabling idempotent atom creation.
 *
 * @param runId - The discovery run UUID
 * @param repoUrl - The source repository URL
 * @param filePath - Relative path within the repository
 * @param type - The evidence atom type (file_structure, symbol, string_pattern)
 * @param distinguishingKey - Additional key to distinguish atoms of the same type within the same file
 *                            (e.g., symbol name + line number, or pattern name + line number)
 * @returns A deterministic UUID-formatted string
 */
export function generateEvidenceId(
  runId: string,
  repoUrl: string,
  filePath: string,
  type: string,
  distinguishingKey: string
): string {
  const input = [runId, repoUrl, filePath, type, distinguishingKey].join('|');
  return hexToUuid(createHash('sha256').update(input).digest('hex'));
}

/**
 * Generates a deterministic relationship ID by hashing the concatenated inputs.
 *
 * Uses SHA-256 to produce a consistent, collision-resistant identifier.
 * The same combination of inputs always produces the same ID, enabling
 * idempotent relationship creation during Phase 1b.
 *
 * @param runId - The discovery run UUID
 * @param sourceAtomId - The source evidence atom UUID
 * @param targetAtomId - The target evidence atom UUID
 * @param relationshipType - The relationship type (imports, calls, extends, etc.)
 * @returns A deterministic SHA-256 hex digest string
 */
export function generateRelationshipId(
  runId: string,
  sourceAtomId: string,
  targetAtomId: string,
  relationshipType: string
): string {
  const input = [runId, sourceAtomId, targetAtomId, relationshipType].join('|');
  return hexToUuid(createHash('sha256').update(input).digest('hex'));
}

/**
 * Generates a deterministic cluster ID by hashing the concatenated inputs.
 *
 * Uses SHA-256 to produce a consistent, collision-resistant identifier
 * formatted as a UUID (8-4-4-4-12). The same combination of inputs always
 * produces the same ID, enabling idempotent cluster creation during Phase 1c.
 *
 * @param runId - The discovery run UUID
 * @param clusterLabel - The cluster name/label (human-readable grouping label)
 * @param clusterType - The cluster type (service_boundary, data_domain, etc.)
 * @returns A deterministic UUID-formatted string
 */
export function generateClusterId(
  runId: string,
  clusterLabel: string,
  clusterType: string
): string {
  const input = [runId, clusterLabel, clusterType].join('|');
  return hexToUuid(createHash('sha256').update(input).digest('hex'));
}

/**
 * Generates a deterministic candidate ID by hashing the concatenated inputs.
 *
 * Uses SHA-256 to produce a consistent, collision-resistant identifier
 * formatted as a UUID (8-4-4-4-12). The same combination of inputs always
 * produces the same ID, enabling idempotent candidate creation during Phase 1d.
 *
 * @param runId - The discovery run UUID
 * @param candidateName - The proposed candidate name
 * @param candidateType - The candidate type (application, service, etc.)
 * @param parentCandidateId - The parent candidate ID (use empty string if none)
 * @returns A deterministic UUID-formatted string
 */
export function generateCandidateId(
  runId: string,
  candidateName: string,
  candidateType: string,
  parentCandidateId: string
): string {
  const input = [runId, candidateName, candidateType, parentCandidateId].join('|');
  return hexToUuid(createHash('sha256').update(input).digest('hex'));
}
