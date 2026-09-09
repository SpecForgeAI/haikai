/**
 * Coverage floor for routine behaviour capture (Spec 3, 2026-09-09).
 *
 * Deterministic denominator per routine: the statically enumerated EXIT
 * OUTCOMES (each distinct non-zero RETURN value, each RAISERROR site, the
 * implicit success exit) plus the seeded families present in the body.
 * Numerator: the distinct outcomes observed in ACCEPTED captures plus the
 * families exercised. Reported-only kinds (null / default / boundary) never
 * enter the denominator. Every routine lands in exactly one bucket:
 * verified | not_exercised | unverifiable(reason) | excluded.
 */

import type { RoutineInvocationEnvelope } from '../db/routineEnvelope';
import type { ProcCaptureDto, ProcCoverageSummary, ProcScenarioDto, RoutineCatalogRow, RoutineCoverage } from './types';
import { enumerateExitOutcomes, seededFamilies } from './routineScenarioSeeds';

/** The outcome key of one envelope (the LAST step of a sequence). */
export function exitOutcomeOf(envelope: RoutineInvocationEnvelope | { steps: RoutineInvocationEnvelope[] } | null | undefined): string {
  if (!envelope) return 'unknown';
  const env = 'steps' in envelope ? envelope.steps[envelope.steps.length - 1] : envelope;
  if (!env) return 'unknown';
  if (env.outcome === 'error') return env.error?.number !== null && env.error?.number !== undefined ? `error:${env.error.number}` : 'error:?';
  if (typeof env.return_status === 'number' && env.return_status !== 0) return `return:${env.return_status}`;
  return 'success';
}

const FAMILY_KEY: Record<string, string> = { zero_rows: 'family:zero_rows', error_path: 'family:error_path' };

export function scoreRoutineCoverage(
  routine: RoutineCatalogRow,
  scenarios: ProcScenarioDto[],
  captures: ProcCaptureDto[],
  opts: { excluded?: boolean; unverifiableReason?: string | null } = {},
): RoutineCoverage {
  const base = {
    routine_id: routine.id,
    routine_name: `${routine.schema_name}.${routine.routine_name}`,
  };
  if (opts.excluded) {
    return { ...base, bucket: 'excluded', required: [], achieved: [], missing: [], reported_only_achieved: [], floor_met: false, scenarios_fired: 0, captures_accepted: 0, unverifiable_reason: null };
  }
  if (opts.unverifiableReason) {
    return { ...base, bucket: 'unverifiable', required: [], achieved: [], missing: [], reported_only_achieved: [], floor_met: false, scenarios_fired: 0, captures_accepted: 0, unverifiable_reason: opts.unverifiableReason };
  }
  const required = new Set<string>(enumerateExitOutcomes(routine));
  const families = seededFamilies(routine);
  for (const f of families) required.add(FAMILY_KEY[f.type] ?? `family:${f.type}`);
  // An unknown-number RAISERROR site is satisfied by ANY error outcome.
  const scenarioById = new Map(scenarios.filter((s) => s.id).map((s) => [s.id as string, s]));
  const accepted = captures.filter((c) => c.routine_id === routine.id && c.accepted);
  const achieved = new Set<string>();
  const reportedOnly = new Set<string>();
  for (const c of accepted) {
    const key = exitOutcomeOf(c.envelope_json);
    if (required.has(key)) achieved.add(key);
    else if (key.startsWith('error:') && required.has('error:?')) achieved.add('error:?');
    const scenario = scenarioById.get(c.scenario_id);
    if (scenario) {
      const famKey = FAMILY_KEY[scenario.scenario_type];
      if (famKey && required.has(famKey)) achieved.add(famKey);
      if (['null_param', 'default_param', 'boundary', 'business_edge', 'sequence'].includes(scenario.scenario_type)) {
        reportedOnly.add(scenario.scenario_type);
      }
    }
  }
  const missing = [...required].filter((k) => !achieved.has(k));
  const fired = scenarios.filter((s) => s.routine_id === routine.id && s.status === 'fired').length;
  const floorMet = missing.length === 0 && accepted.length > 0;
  return {
    ...base,
    bucket: floorMet ? 'verified' : 'not_exercised',
    required: [...required].sort(),
    achieved: [...achieved].sort(),
    missing: missing.sort(),
    reported_only_achieved: [...reportedOnly].sort(),
    floor_met: floorMet,
    scenarios_fired: fired,
    captures_accepted: accepted.length,
    unverifiable_reason: null,
  };
}

export function assembleProcCoverageSummary(perRoutine: RoutineCoverage[], now: Date = new Date()): ProcCoverageSummary {
  return {
    routines_in_scope: perRoutine.length,
    verified: perRoutine.filter((r) => r.bucket === 'verified').length,
    not_exercised: perRoutine.filter((r) => r.bucket === 'not_exercised').length,
    unverifiable: perRoutine.filter((r) => r.bucket === 'unverifiable').length,
    excluded: perRoutine.filter((r) => r.bucket === 'excluded').length,
    per_routine: perRoutine,
    computed_at: now.toISOString(),
  };
}
