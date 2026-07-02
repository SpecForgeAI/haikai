/**
 * Tests for the gap wayfinding registry.
 *
 * Spec 2026-06-11 Deterministic Findings-Coverage Verification + Gap
 * Wayfinding — Task Group 2 (pure unit tests, no rendering).
 */

import { describe, it, expect } from 'vitest';
// The AMS gap-code vocabulary source of truth (read-only reference): the
// Task Group 5 completeness test parses its String constants so a future
// AMS gap-code addition fails THIS suite loudly.
import migrationGapCodesJavaSource from '../../../../architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/migration/MigrationGapCodes.java?raw';
import {
  GAP_WAYFINDING,
  getGapWayfindingEntry,
  buildUnaddressedFindingEntry,
  humanizeGapCode,
  type GapWayfindingContext,
} from '../gapWayfindingRegistry';

const CTX: GapWayfindingContext = {
  projectId: 'proj-1',
  architectureId: 'arch-1',
  runIds: ['run-first', 'run-second'],
};

const BASE = '/projects/proj-1/architectures/arch-1';

const ALL_17_CODES = [
  // The 11 original MigrationGapCodes.
  'no_api_behaviour_baseline',
  'unresolved_discovery_decisions',
  'missing_current_to_target_mappings',
  'no_database_discovery_findings',
  'high_severity_unreviewed_findings',
  'missing_oas_for_in_scope_interface',
  'insufficient_runtime_evidence',
  'no_sample_data_hints',
  'incomplete_capture_coverage',
  'under_specified_endpoints',
  'discovery_harness_inventory_mismatch',
  // The 4 persistence-tier pack codes (Spec 2026-07-02-a/-b).
  'no_physical_schema_promoted',
  'db_migration_pack_missing',
  'unresolved_db_pack_decisions',
  'unapproved_db_translations',
  // The 2 context warnings.
  'no_discovery_runs_selected',
  'no_findings_in_run',
];

describe('gapWayfindingRegistry (Spec 2026-06-11, Task Group 2)', () => {
  it('has a complete entry (title, explanation, actionLabel, destination) for every gap / context-warning code, with the spec-table routes', () => {
    for (const code of ALL_17_CODES) {
      const entry = GAP_WAYFINDING[code];
      expect(entry, `missing registry entry for ${code}`).toBeDefined();
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.explanation.length).toBeGreaterThan(0);
      expect(entry.actionLabel.length).toBeGreaterThan(0);
      expect(typeof entry.buildDestination).toBe('function');
    }
    // The synthetic per-finding entry completes the 18.
    expect(GAP_WAYFINDING.unaddressed_finding).toBeDefined();
    expect(Object.keys(GAP_WAYFINDING)).toHaveLength(18);

    // Spot-check run-scoped destinations.
    expect(
      GAP_WAYFINDING.unresolved_discovery_decisions.buildDestination(CTX),
    ).toBe(`${BASE}/discovery/runs/run-first?room=open`);
    expect(
      GAP_WAYFINDING.high_severity_unreviewed_findings.buildDestination(CTX),
    ).toBe(`${BASE}/discovery/runs/run-first?tab=findings`);
    expect(GAP_WAYFINDING.under_specified_endpoints.buildDestination(CTX)).toBe(
      `${BASE}/discovery/runs/run-first`,
    );
    expect(GAP_WAYFINDING.no_findings_in_run.buildDestination(CTX)).toBe(
      `${BASE}/discovery/runs/run-first?tab=findings`,
    );
    // Spot-check nearest-route destinations.
    expect(GAP_WAYFINDING.no_api_behaviour_baseline.buildDestination(CTX)).toBe(
      `${BASE}/api-behaviour`,
    );
    expect(GAP_WAYFINDING.incomplete_capture_coverage.buildDestination(CTX)).toBe(
      `${BASE}/api-behaviour`,
    );
    expect(
      GAP_WAYFINDING.discovery_harness_inventory_mismatch.buildDestination(CTX),
    ).toBe(`${BASE}/api-behaviour`);
    expect(
      GAP_WAYFINDING.missing_current_to_target_mappings.buildDestination(CTX),
    ).toBe(`${BASE}/architecture-design/target-state`);
    expect(
      GAP_WAYFINDING.missing_oas_for_in_scope_interface.buildDestination(CTX),
    ).toBe(`${BASE}/metamodel/applications`);
    expect(GAP_WAYFINDING.no_database_discovery_findings.buildDestination(CTX)).toBe(
      `${BASE}/discovery`,
    );
    expect(GAP_WAYFINDING.insufficient_runtime_evidence.buildDestination(CTX)).toBe(
      `${BASE}/discovery`,
    );
    expect(GAP_WAYFINDING.no_sample_data_hints.buildDestination(CTX)).toBe(
      `${BASE}/discovery`,
    );
    expect(GAP_WAYFINDING.no_discovery_runs_selected.buildDestination(CTX)).toBe(
      `${BASE}/discovery`,
    );
  });

  it('generates a non-throwing fallback entry for unknown codes (humanized title, generic explanation, no link)', () => {
    expect(() => getGapWayfindingEntry('some_future_server_code')).not.toThrow();
    const entry = getGapWayfindingEntry('some_future_server_code');
    expect(entry.title).toBe('Some future server code');
    expect(entry.explanation).toBe('Review this gap with your architect.');
    expect(entry.buildDestination(CTX)).toBeNull();
    // Known codes resolve to their real entries through the same accessor.
    expect(getGapWayfindingEntry('no_api_behaviour_baseline').title).toBe(
      'No API behaviour baseline',
    );
    // Humanizer handles degenerate inputs without throwing.
    expect(humanizeGapCode('')).toBe('Unknown gap');
  });

  it('run-scoped destinations use flaggedRunId ?? runIds[0] and degrade to /discovery with no run id', () => {
    // flaggedRunId wins over runIds[0].
    expect(
      GAP_WAYFINDING.high_severity_unreviewed_findings.buildDestination({
        ...CTX,
        flaggedRunId: 'run-flagged',
      }),
    ).toBe(`${BASE}/discovery/runs/run-flagged?tab=findings`);
    // No flaggedRunId -> first selected run.
    expect(
      GAP_WAYFINDING.unresolved_discovery_decisions.buildDestination(CTX),
    ).toBe(`${BASE}/discovery/runs/run-first?room=open`);
    // No run id at all -> the /discovery listing route.
    const noRuns: GapWayfindingContext = {
      projectId: 'proj-1',
      architectureId: 'arch-1',
    };
    expect(
      GAP_WAYFINDING.unresolved_discovery_decisions.buildDestination(noRuns),
    ).toBe(`${BASE}/discovery`);
    expect(
      GAP_WAYFINDING.high_severity_unreviewed_findings.buildDestination({
        ...noRuns,
        runIds: [],
      }),
    ).toBe(`${BASE}/discovery`);
  });

  it('buildUnaddressedFindingEntry builds the finding-drawer deep link with the finding’s own title + severity + run', () => {
    const entry = buildUnaddressedFindingEntry(
      {
        id: 'FND-42',
        title: 'Trigger side effect',
        severity: 'critical',
        runId: 'run-9',
      },
      CTX,
    );
    expect(entry.title).toBe('Trigger side effect');
    expect(entry.severity).toBe('critical');
    expect(entry.actionLabel).toBe('Open this finding');
    expect(entry.destination).toBe(
      `${BASE}/discovery/runs/run-9?tab=findings&findingId=FND-42`,
    );
    expect(entry.explanation).toContain('approved critical finding');

    // A finding with no run id degrades to the /discovery listing route.
    const degraded = buildUnaddressedFindingEntry(
      { id: 'FND-43', title: 'No run', severity: 'high', runId: '' },
      CTX,
    );
    expect(degraded.destination).toBe(`${BASE}/discovery`);
  });
  // ==========================================================================
  // Task Group 5 — strategic addition
  // ==========================================================================

  // Registry completeness pinned to the AMS source of truth: every gap code
  // constant in MigrationGapCodes.java must have a REAL (non-fallback)
  // registry entry. A future AMS gap-code addition fails THIS test loudly
  // instead of silently falling back to the generic entry.
  it('covers every gap code declared in the AMS MigrationGapCodes.java constants (fails loudly on a new server code)', () => {
    // Normalize whitespace so multi-line constant declarations match too.
    const source = migrationGapCodesJavaSource.replace(/\s+/g, ' ');
    const declarations = [
      ...source.matchAll(/public static final String (\w+) = "([a-z0-9_]+)"/g),
    ];
    const gapCodes = declarations
      // STATUS_* constants are per-stream status values, not gap codes.
      .filter(([, name]) => !name.startsWith('STATUS_'))
      .map(([, , value]) => value);

    // Parse sanity: the 11 known MigrationGapCodes were extracted.
    expect(gapCodes.length).toBeGreaterThanOrEqual(11);
    for (const code of gapCodes) {
      expect(
        GAP_WAYFINDING[code],
        `AMS declares gap code "${code}" but gapWayfindingRegistry.ts has no entry for it — add the registry entry (title, explanation, actionLabel, destination)`,
      ).toBeDefined();
    }
  });
});
