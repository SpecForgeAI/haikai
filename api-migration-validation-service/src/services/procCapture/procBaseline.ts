/**
 * Save-as-baseline for proc behaviour (Spec 3, 2026-09-09): one item per
 * fired scenario, keyed by routine body hash; the canonical capture is the
 * first ACCEPTED capture (bracket clean | compensated | healed, or
 * unbracketed for write-free routines). Volatile cells ride the item as
 * evidence (never a mask list).
 */

import type { ProcBaselineItemDto, ProcCaptureDto, ProcScenarioDto, RoutineCatalogRow } from './types';
import { exitOutcomeOf } from './routineCoverageFloor';

export function buildBaselineItems(
  routines: RoutineCatalogRow[],
  scenarios: ProcScenarioDto[],
  captures: ProcCaptureDto[],
): ProcBaselineItemDto[] {
  const routineById = new Map(routines.map((r) => [r.id, r]));
  const items: ProcBaselineItemDto[] = [];
  for (const scenario of scenarios) {
    if (!scenario.id || scenario.status === 'excluded') continue;
    const routine = routineById.get(scenario.routine_id);
    if (!routine) continue;
    const canonical = captures
      .filter((c) => c.scenario_id === scenario.id && c.accepted)
      .sort((a, b) => (a.attempt_number ?? 0) - (b.attempt_number ?? 0))[0];
    if (!canonical) continue;
    items.push({
      routine_id: routine.id,
      routine_body_hash: routine.body_hash ?? null,
      scenario_id: scenario.id,
      scenario_name: scenario.scenario_name,
      scenario_type: scenario.scenario_type,
      exit_outcome: exitOutcomeOf(canonical.envelope_json),
      inputs_json: scenario.inputs_json,
      sequence_json: scenario.sequence_json ?? null,
      expected_envelope_json: canonical.envelope_json,
      state_delta_json: canonical.state_delta_json ?? null,
      volatile_cells_json: canonical.volatile_cells_json ?? null,
      business_notes: scenario.notes ?? null,
    });
  }
  items.sort((a, b) => a.routine_id.localeCompare(b.routine_id) || a.scenario_name.localeCompare(b.scenario_name));
  return items;
}
