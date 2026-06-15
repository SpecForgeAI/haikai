/**
 * Unit tests for the pure {@link deriveServiceTier} helper
 * (`frontend/src/utils/deriveServiceTier.ts`).
 *
 * Spec: 2026-06-05-per-service-scan-selection (Half A, Task Group 1.1); the
 * helper was RELOCATED to `utils/` by 2026-06-05-architect-tier-gating (Half B)
 * so the target-state surface can share it without cross-importing from a
 * Discovery component. Covers ONLY the critical branches: the three
 * `tech_type` -> short-tier mappings, and the three+ nullable-hop escape paths
 * that must each resolve to `'Unknown'` WITHOUT throwing. Plus one shape
 * round-trip on the `SelectedScanSetWire`. Exhaustive literal/ordering coverage
 * is intentionally out of scope.
 */

import { describe, it, expect } from 'vitest';

import { deriveServiceTier } from './deriveServiceTier';
import type { ApplicationComponent, Service, TechType } from '../types/model';
import type { SelectedScanSetWire } from '../api/discoveryReviewApi';

// --- minimal fixtures -------------------------------------------------------

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    name: 'MyApp API',
    description: '',
    application_id: 'app-1',
    service_type: 'backend',
    tags: '',
    ...overrides,
  };
}

function makeComponent(
  id: string,
  techType: TechType | undefined,
): ApplicationComponent {
  return {
    id,
    name: `component-${id}`,
    description: '',
    application_id: 'app-1',
    tags: '',
    tech_type: techType,
  };
}

function mapOf(...components: ApplicationComponent[]): Map<string, ApplicationComponent> {
  return new Map(components.map((c) => [c.id, c]));
}

// --- tech_type -> short tier mappings ---------------------------------------

describe('deriveServiceTier -- tech_type mapping', () => {
  it("maps 'UI Tier' -> 'UI'", () => {
    const service = makeService({ app_component_id: 'ac-ui' });
    const byId = mapOf(makeComponent('ac-ui', 'UI Tier'));
    expect(deriveServiceTier(service, byId)).toBe('UI');
  });

  it("maps 'Service Tier' -> 'Service'", () => {
    const service = makeService({ app_component_id: 'ac-svc' });
    const byId = mapOf(makeComponent('ac-svc', 'Service Tier'));
    expect(deriveServiceTier(service, byId)).toBe('Service');
  });

  it("maps 'Persistence Tier' -> 'Persistence'", () => {
    const service = makeService({ app_component_id: 'ac-db' });
    const byId = mapOf(makeComponent('ac-db', 'Persistence Tier'));
    expect(deriveServiceTier(service, byId)).toBe('Persistence');
  });
});

// --- nullable-hop escape paths all -> 'Unknown', never throw ----------------

describe('deriveServiceTier -- nullable-hop misses resolve to Unknown', () => {
  it("returns 'Unknown' for tech_type='Other'", () => {
    const service = makeService({ app_component_id: 'ac-other' });
    const byId = mapOf(makeComponent('ac-other', 'Other'));
    expect(deriveServiceTier(service, byId)).toBe('Unknown');
  });

  it("returns 'Unknown' for an unset (undefined) tech_type", () => {
    const service = makeService({ app_component_id: 'ac-unset' });
    const byId = mapOf(makeComponent('ac-unset', undefined));
    expect(deriveServiceTier(service, byId)).toBe('Unknown');
  });

  it("returns 'Unknown' when app_component_id is absent (NULL hop)", () => {
    const service = makeService({ app_component_id: undefined });
    const byId = mapOf(makeComponent('ac-svc', 'Service Tier'));
    expect(deriveServiceTier(service, byId)).toBe('Unknown');
  });

  it("returns 'Unknown' when the component id is missing from the map", () => {
    const service = makeService({ app_component_id: 'ac-not-in-map' });
    const byId = mapOf(makeComponent('ac-other', 'UI Tier'));
    expect(deriveServiceTier(service, byId)).toBe('Unknown');
  });

  it("returns 'Unknown' (no throw) when the service itself is undefined", () => {
    const byId = mapOf(makeComponent('ac-svc', 'Service Tier'));
    expect(() => deriveServiceTier(undefined, byId)).not.toThrow();
    expect(deriveServiceTier(undefined, byId)).toBe('Unknown');
  });
});

// --- SelectedScanSetWire shape round-trip -----------------------------------

describe('SelectedScanSetWire -- shape round-trips runs[] + primaryRunId', () => {
  it('carries a 2-code + 1-DB selection with primaryRunId among the runs', () => {
    const set: SelectedScanSetWire = {
      runs: [
        { runId: 'run-ui', scanKind: 'code', serviceId: 'svc-ui' },
        { runId: 'run-api', scanKind: 'code', serviceId: 'svc-api' },
        { runId: 'run-db', scanKind: 'database', serviceId: 'svc-db' },
      ],
      primaryRunId: 'run-api',
    };
    expect(set.runs).toHaveLength(3);
    expect(set.runs.filter((r) => r.scanKind === 'code')).toHaveLength(2);
    expect(set.runs.some((r) => r.runId === set.primaryRunId)).toBe(true);
    // orphan-run serviceId is nullable on the wire
    const orphan: SelectedScanSetWire = {
      runs: [{ runId: 'run-x', scanKind: 'code', serviceId: null }],
      primaryRunId: 'run-x',
    };
    expect(orphan.runs[0].serviceId).toBeNull();
  });
});
