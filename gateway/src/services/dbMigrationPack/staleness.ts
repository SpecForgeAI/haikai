/**
 * Pack staleness check.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 4.6.
 *
 * Staleness = "the inputs the pack was generated from have changed". Two
 * independent signals, surfaced on the pack GET as `is_stale` + reason:
 *
 *   1. INPUT-HASH DRIFT — recompute the input snapshot hash from CURRENT
 *      inputs using the ONE shared implementation
 *      (`inputs.ts#computeInputSnapshotHash`, the same canonical
 *      serialization generation stage 1 uses) and compare to the pack's
 *      stored `input_snapshot_hash`.
 *   2. DECISION RESOLUTION — AMS already flips the pack's `status` to
 *      `stale` (with a stale_reason) when a pack decision is resolved; the
 *      stored status is honored verbatim here.
 *
 * NEVER auto-regenerates. This module only ever reports; Regenerate is an
 * explicit user action through the explicit route.
 */

import {
  computeInputSnapshotHash,
  defaultInputFetchDeps,
  fetchGenerationInputs,
  InputFetchDeps,
} from './inputs';

export const STALE_REASON_INPUTS_CHANGED = 'inputs changed since generation';

export interface PackStalenessInput {
  projectId: string;
  architectureId: string;
  /**
   * The target architecture the pack's `db.*` decisions were bound to at
   * generation (persisted as `manifest_json.target_architecture_id`,
   * Spec 2026-07-02-a). The recompute MUST read decisions from the SAME
   * target or the hash comparison is meaningless. null/absent = legacy pack
   * (active-target fallback).
   */
  targetArchitectureId?: string | null;
  /** The pack's stored `input_snapshot_hash` (null = legacy/no hash). */
  storedHash: string | null;
  /** The pack's stored `status` (`generated` | `stale`). */
  storedStatus: string | null;
  /** The pack's stored `stale_reason` (set by AMS on decision resolve). */
  storedStaleReason: string | null;
}

export interface PackStalenessResult {
  is_stale: boolean;
  /** Human-readable reason; null when not stale. */
  staleness_reason: string | null;
  /** The freshly recomputed hash (null when recompute failed). */
  current_input_snapshot_hash: string | null;
  /** Non-fatal recompute failure detail (the GET still succeeds). */
  staleness_check_error: string | null;
}

/**
 * Evaluate the pack's staleness against current inputs. Pure report — no
 * writes, no regeneration. A failed input fetch degrades gracefully: the
 * stored-status signal still applies and the error detail is surfaced.
 */
export async function evaluatePackStaleness(
  input: PackStalenessInput,
  deps: Partial<InputFetchDeps> = {}
): Promise<PackStalenessResult> {
  const fetchDeps: InputFetchDeps = {
    fetchModel: deps.fetchModel ?? defaultInputFetchDeps.fetchModel,
    fetchFindings: deps.fetchFindings ?? defaultInputFetchDeps.fetchFindings,
    fetchDbDecisions: deps.fetchDbDecisions ?? defaultInputFetchDeps.fetchDbDecisions,
    fetchResolvedPackDecisions:
      deps.fetchResolvedPackDecisions ?? defaultInputFetchDeps.fetchResolvedPackDecisions,
  };

  let currentHash: string | null = null;
  let checkError: string | null = null;
  try {
    const inputs = await fetchGenerationInputs(
      input.projectId,
      input.architectureId,
      fetchDeps,
      input.targetArchitectureId ?? null
    );
    currentHash = computeInputSnapshotHash(inputs);
  } catch (error) {
    checkError = error instanceof Error ? error.message : String(error);
  }

  // Signal 2 — AMS already marked the pack stale (decision resolve path).
  if (input.storedStatus === 'stale') {
    return {
      is_stale: true,
      staleness_reason: input.storedStaleReason ?? 'decision resolved since generation',
      current_input_snapshot_hash: currentHash,
      staleness_check_error: checkError,
    };
  }

  // Signal 1 — input-hash drift against the recomputed hash.
  if (
    currentHash !== null &&
    input.storedHash !== null &&
    currentHash !== input.storedHash
  ) {
    return {
      is_stale: true,
      staleness_reason: STALE_REASON_INPUTS_CHANGED,
      current_input_snapshot_hash: currentHash,
      staleness_check_error: checkError,
    };
  }

  return {
    is_stale: false,
    staleness_reason: null,
    current_input_snapshot_hash: currentHash,
    staleness_check_error: checkError,
  };
}
