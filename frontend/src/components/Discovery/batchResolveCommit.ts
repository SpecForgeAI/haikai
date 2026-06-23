/**
 * batchResolveCommit
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 3.
 *
 * The best-effort, NON-ATOMIC commit loop behind the batch modal's Confirm /
 * Retry. It REUSES the existing single-attribute client unchanged:
 *
 *   resolveDiscoveryConflict(projectId, architectureId, runId, candidateId, body)
 *     -> PATCH .../runs/{runId}/candidates/{candidateId}/resolve-conflict
 *
 * once per selected (candidate, attribute), stamping
 * `resolved_by = "reviewer (batch)"` (distinct from the single-row "reviewer").
 * The loop mirrors the gateway's existing `resolveConflictsByPattern` fan-out:
 * one failure never aborts the rest, so a partial outcome is reported back and
 * the modal keeps ONLY the failed rows selected for a retry.
 *
 * This helper is deliberately PURE w.r.t. React: it returns DATA (the resolved /
 * failed (candidate, attr) pairs PLUS an updated candidates array), and never
 * calls a setter -- so it is unit-testable in isolation and the caller (TG4)
 * owns `onCandidatesChange` + the backbone-snapshot patch. The local candidate
 * mutation it applies mirrors `DiscoveryCandidateTable.handleResolveConflicts`
 * (~line 980-1098): set the canonical slot, stamp `_conflictResolutions[attr]`
 * (camelCase keys), and clear `_conflicts[attr]`, so resolved rows do NOT
 * reappear on re-read.
 */

import {
  resolveDiscoveryConflict,
  type DiscoveryCandidateDto,
  type ResolveDiscoveryConflictBody,
} from '../../api/discoveryApi';
import {
  rowKey,
  type BatchSelections,
  type ConflictRow,
} from './batchResolveConflictsSupport';

/** Reviewer label stamped by the BATCH path (Decision 11; distinct from "reviewer"). */
export const BATCH_RESOLVED_BY = 'reviewer (batch)';

/**
 * The (candidate, attribute) identity of one commit unit -- echoed back in the
 * result so the modal can keep ONLY the failed rows selected for a retry.
 */
export interface BatchResolvePair {
  candidateId: string;
  attr: string;
}

/**
 * A row selected for commit = a {@link ConflictRow} plus the chosen option index
 * (resolved from the modal's per-row selection map). The helper accepts these so
 * it never has to re-derive the chosen value/source from a bare index + the
 * caller's row list.
 */
export interface BatchResolveSelection {
  row: ConflictRow;
  /** Chosen index into `row.options`. */
  optionIndex: number;
}

/** The identifiers the resolve endpoint needs (already in component scope, TG4). */
export interface BatchResolveContext {
  projectId: string;
  architectureId: string;
  runId: string;
}

/**
 * The outcome of one commit pass. `resolved` / `failed` carry the (candidate,
 * attr) pairs (NOT just counts) so the modal can drive the retry-only-the-
 * failures behaviour; `candidates` is the locally-mutated array the caller hands
 * to `onCandidatesChange`.
 */
export interface BatchResolveCommitResult {
  resolved: BatchResolvePair[];
  failed: BatchResolvePair[];
  candidates: DiscoveryCandidateDto[];
}

/**
 * Resolve the modal's per-row selection map into the concrete list of
 * (row, optionIndex) commit units, dropping any unselected / out-of-range entry.
 * Pure -- shared by the modal's Confirm handler (TG4) and the helper's tests.
 *
 * @param rows - the aggregated conflict rows currently shown in the modal
 * @param selections - the modal's selection map keyed by {@link rowKey}
 */
export function selectionsToCommitUnits(
  rows: ConflictRow[],
  selections: BatchSelections | Record<string, number | undefined>,
): BatchResolveSelection[] {
  const units: BatchResolveSelection[] = [];
  for (const row of rows) {
    const optionIndex = selections[rowKey(row)];
    if (optionIndex === undefined || optionIndex === null) continue;
    if (optionIndex < 0 || optionIndex >= row.options.length) continue;
    units.push({ row, optionIndex });
  }
  return units;
}

/**
 * Apply the SAME local mutation as `handleResolveConflicts` for one resolved
 * (candidate, attribute) onto a candidate's `data`, returning a NEW candidate
 * (never mutating the input in place, preserving optimistic-revert safety):
 *   - canonical slot `data[attr]` <- chosen value;
 *   - stamp `data._conflictResolutions[attr]` (camelCase keys);
 *   - clear `data._conflicts[attr]`.
 */
function applyResolutionToCandidate(
  candidate: DiscoveryCandidateDto,
  attr: string,
  chosenValue: unknown,
  chosenSource: string,
  resolvedBy: string,
  resolvedAt: string,
): DiscoveryCandidateDto {
  const prevData = (candidate.data ?? {}) as Record<string, unknown>;
  const nextConflicts: Record<string, unknown> = {
    ...((prevData._conflicts as Record<string, unknown>) ?? {}),
  };
  const nextResolutions: Record<string, unknown> = {
    ...((prevData._conflictResolutions as Record<string, unknown>) ?? {}),
  };

  // Canonical slot <- chosen value.
  const nextData: Record<string, unknown> = { ...prevData, [attr]: chosenValue };
  // Stamp the resolution (camelCase keys inside the JSONB, mirroring AMS).
  nextResolutions[attr] = {
    chosenValue,
    chosenSource,
    resolvedBy,
    resolvedAt,
  };
  // Clear the now-resolved conflict.
  delete nextConflicts[attr];

  nextData._conflicts = nextConflicts;
  nextData._conflictResolutions = nextResolutions;

  return { ...candidate, data: nextData };
}

/**
 * Best-effort commit of the selected conflict resolutions. Loops the existing
 * `resolveDiscoveryConflict` once per selected (candidate, attribute) and applies
 * the local candidate mutation for each SUCCESS. Non-atomic: a rejected call is
 * recorded in `failed` and never aborts the others (uses `Promise.allSettled`).
 *
 * @param context - project / architecture / run identifiers for the endpoint
 * @param units - the (row, optionIndex) commit units (see
 *                {@link selectionsToCommitUnits})
 * @param candidates - the current candidates array; a locally-mutated copy is
 *                     returned (only successfully-resolved attributes change)
 * @returns the resolved / failed (candidate, attr) pairs + the updated array
 */
export async function batchResolveCommit(
  context: BatchResolveContext,
  units: BatchResolveSelection[],
  candidates: DiscoveryCandidateDto[],
): Promise<BatchResolveCommitResult> {
  const { projectId, architectureId, runId } = context;
  const resolvedAt = new Date().toISOString();

  // Fire every selected resolution; settle ALL so one rejection never aborts the
  // rest (best-effort / non-atomic fan-out, mirroring resolveConflictsByPattern).
  const outcomes = await Promise.allSettled(
    units.map((unit) => {
      const option = unit.row.options[unit.optionIndex];
      const body: ResolveDiscoveryConflictBody = {
        attr: unit.row.attr,
        chosen_value: option.value,
        chosen_source: option.source,
        resolved_by: BATCH_RESOLVED_BY,
        resolved_at: resolvedAt,
      };
      return resolveDiscoveryConflict(
        projectId,
        architectureId,
        runId,
        unit.row.candidateId,
        body,
      );
    }),
  );

  const resolved: BatchResolvePair[] = [];
  const failed: BatchResolvePair[] = [];
  // Index successfully-resolved (candidateId -> attr -> {value, source}) so we
  // apply each local mutation exactly once below.
  const successByCandidate = new Map<
    string,
    { attr: string; value: unknown; source: string }[]
  >();

  outcomes.forEach((outcome, i) => {
    const unit = units[i];
    const pair: BatchResolvePair = {
      candidateId: unit.row.candidateId,
      attr: unit.row.attr,
    };
    if (outcome.status === 'fulfilled') {
      resolved.push(pair);
      const option = unit.row.options[unit.optionIndex];
      const list = successByCandidate.get(unit.row.candidateId);
      const entry = { attr: unit.row.attr, value: option.value, source: option.source };
      if (list) list.push(entry);
      else successByCandidate.set(unit.row.candidateId, [entry]);
    } else {
      failed.push(pair);
    }
  });

  // Apply the local candidate mutation for every successfully-resolved attribute
  // so resolved rows do not reappear on a re-read. Untouched candidates keep
  // their original reference.
  const nextCandidates =
    successByCandidate.size === 0
      ? candidates
      : candidates.map((candidate) => {
          const wins = successByCandidate.get(candidate.id);
          if (!wins || wins.length === 0) return candidate;
          let updated = candidate;
          for (const win of wins) {
            updated = applyResolutionToCandidate(
              updated,
              win.attr,
              win.value,
              win.source,
              BATCH_RESOLVED_BY,
              resolvedAt,
            );
          }
          return updated;
        });

  return { resolved, failed, candidates: nextCandidates };
}
