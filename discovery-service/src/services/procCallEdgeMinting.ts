/**
 * Proc-call EDGE minting (Spec 2026-07-06-f §2, wired by the Tier-1 batch
 * 2026-07-10).
 *
 * A COMBINED run (code + DB sidecar in one pass) carries both sides of the
 * proc-call linkage in its candidate set: data-effect edges whose captured
 * `query_text` calls a procedure, and the sidecar's proc inventory. This
 * deterministic post-pass joins them, minting ONE `endpoint_data_effects`
 * candidate per (endpoint, proc) pair with:
 *
 *   - `access_mode: 'execute'` — DELIBERATELY outside the write/read-write
 *     set so Spec N's state-delta effect scope (write edges → table
 *     snapshots) never tries to `COUNT(*)` a procedure; the reverse
 *     consumer queries (Spec F) are mode-agnostic and still see the edge;
 *   - `query_kind: 'proc_call'` + the proc name VERBATIM as written in code.
 *
 * Code-only runs (no proc inventory among the candidates) mint NOTHING —
 * the `proc_call_unmatched` finding path (sqlDialectFindings) stays the
 * visible signal there, unchanged.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../types/candidate';
import {
  extractProcCallNames,
  matchProcCalls,
  normalizeProcName,
} from './findings/sqlDialectClassifier';

/** Defensive proc-inventory read off the run's candidates (sidecar shapes). */
export function procInventoryFromCandidates(candidates: DiscoveryCandidate[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (name: unknown): void => {
    if (typeof name !== 'string' || name.length === 0) return;
    const key = normalizeProcName(name);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  for (const candidate of candidates) {
    const data = (candidate.data ?? {}) as Record<string, unknown>;
    push(data.procedureName ?? data.procedure_name);
    const routineKind =
      (data.routineKind as string | undefined) ?? (data.routine_kind as string | undefined);
    if (routineKind === 'procedure' || routineKind === 'function') {
      push(candidate.name);
    }
  }
  return names;
}

/**
 * Mint proc-call edges for every matched proc reference in the run's
 * data-effect candidates. Pure + deterministic; the caller appends the
 * result to the candidate stream (soft-fail wrapped at the call site).
 */
export function mintProcCallEdgeCandidates(
  candidates: DiscoveryCandidate[],
  runId: string,
): DiscoveryCandidate[] {
  const inventory = procInventoryFromCandidates(candidates);
  if (inventory.length === 0) return [];

  const minted: DiscoveryCandidate[] = [];
  const seenPairs = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.candidateType !== 'endpoint_data_effects') continue;
    const data = (candidate.data ?? {}) as Record<string, unknown>;
    const endpointName = data.endpointName;
    if (typeof endpointName !== 'string' || endpointName.length === 0) continue;
    const meta = (data.path_metadata_json ?? {}) as Record<string, unknown>;
    const queryText = meta.query_text;
    if (typeof queryText !== 'string' || queryText.length === 0) continue;

    const { matched } = matchProcCalls(extractProcCallNames(queryText), inventory);
    for (const hit of matched) {
      const pairKey = `${endpointName}=>${normalizeProcName(hit.inventoryName)}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      minted.push({
        id: uuidv4(),
        runId,
        candidateType: 'endpoint_data_effects',
        name: `${endpointName} → ${hit.inventoryName} (execute)`,
        confidence: 0.85,
        status: 'proposed',
        sourceClusterIds: candidate.sourceClusterIds ?? [],
        data: {
          endpointName,
          dataEntityName: hit.inventoryName,
          access_mode: 'execute',
          operation_hint: 'proc_call',
          transactional: false,
          confidence: 0.85,
          path_metadata_json: {
            hops: [],
            operation_hint: 'proc_call',
            transactional: false,
            query_text: queryText,
            query_kind: 'proc_call',
            proc_name: hit.verbatim,
          },
          relationshipType: 'uses_data',
          usesData: { accessType: 'execute', dataIdentifier: hit.inventoryName },
          _addedBy: 'proc-call-edge-minting',
        },
        synthesizedAt: new Date().toISOString(),
      } as DiscoveryCandidate);
    }
  }

  return minted;
}
