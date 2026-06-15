/**
 * Pure unit tests for logScansEvidenceBuilder.ts
 *
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 3.1.
 *
 * Strict scope: pure module tests over the four per-type Log Scans
 * builders. No React, no rendering, no mocks (`vi.mock`). The module
 * has no React, CSS, or API imports, so test seams are not required.
 *
 * Test surface (6 tests, capped per the brief's 2-8 budget):
 *   - `buildEndpointLogEvidenceSection`  matched happy path (only the
 *     non-zero status classes appear, dates render YYYY-MM-DD, exact
 *     summary wording).
 *   - `buildEndpointLogEvidenceSection`  no-usage path.
 *   - `buildEndpointLogEvidenceSection`  no runtime block (fallback).
 *   - `buildInterfaceLogEvidenceSection` happy path with full coverage
 *     AND partial-rollup status branch.
 *   - `buildLogicalDataEntityLogEvidenceSection` happy path; zero-count
 *     rows hidden.
 *   - `buildInterfaceLogicalEntityLogEvidenceSection` happy path; four
 *     fields in correct display order; Total always shown.
 *
 * Group 1's existing assertions in `candidateEvidenceBuilder.test.ts`
 * (Spec 3 placeholder shape) are preserved unchanged — Group 4 will swap
 * the dispatcher import; until then `buildLogScansEvidenceSection` in
 * `candidateEvidenceBuilder.ts` is still the placeholder version.
 *
 * Spec 7 (2026-05-11) Task Group 3.1 additions: assertions for the
 * dispatcher's `confidenceImpactLabel` / `confidenceImpactReason`
 * population gate (only when `displayConfidence > baseConfidence`).
 * The per-type builders themselves remain unchanged.
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import type {
  InterfaceLogicalEntityRuntimeRollup,
  InterfaceRuntimeRollup,
  LogicalDataEntityRuntimeRollup,
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
} from '../candidateEvidenceTypes';
import {
  buildEndpointLogEvidenceSection,
  buildInterfaceLogEvidenceSection,
  buildInterfaceLogicalEntityLogEvidenceSection,
  buildLogScansEvidenceSection,
  buildLogicalDataEntityLogEvidenceSection,
} from '../logScansEvidenceBuilder';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  id: string,
  candidateType: string,
  data: Record<string, unknown> = {},
  log_enrichment?: Record<string, unknown>
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-1',
    candidate_type: candidateType,
    name: id,
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data,
    synthesized_at: '2026-05-11T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    log_enrichment,
  };
}

function makeMatched(
  overrides: Partial<MatchedRuntimeEvidence> = {}
): MatchedRuntimeEvidence {
  return {
    method: 'GET',
    codePathTemplate: '/owners/{ownerId}',
    normalizedLogPath: '/owners/123',
    observedUsageCount: 0,
    totalLogRequests: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    matchConfidence: 0.99,
    matchReason: 'exact match',
    ...overrides,
  };
}

/**
 * Build a minimal `RuntimeEvidenceContext` with only the maps the
 * caller wants populated. The other maps default to empty so the
 * builders for other candidate types still degrade to "not found"
 * cleanly when probed against this fixture.
 */
function makeContext(overrides: {
  byCandidateId?: Map<string, { runtime: { matched: MatchedRuntimeEvidence } }>;
  interfaceRollupByCandidateId?: Map<string, InterfaceRuntimeRollup>;
  logicalDataEntityRollupByCandidateId?: Map<
    string,
    LogicalDataEntityRuntimeRollup
  >;
  interfaceLogicalEntityRollupByCandidateId?: Map<
    string,
    InterfaceLogicalEntityRuntimeRollup
  >;
} = {}): RuntimeEvidenceContext {
  return {
    byCandidateId: overrides.byCandidateId ?? new Map(),
    interfaceRollupByCandidateId:
      overrides.interfaceRollupByCandidateId ?? new Map(),
    logicalDataEntityRollupByCandidateId:
      overrides.logicalDataEntityRollupByCandidateId ?? new Map(),
    interfaceLogicalEntityRollupByCandidateId:
      overrides.interfaceLogicalEntityRollupByCandidateId ?? new Map(),
  };
}

// ---------------------------------------------------------------------------
// buildEndpointLogEvidenceSection
// ---------------------------------------------------------------------------

describe('buildEndpointLogEvidenceSection', () => {
  it('matched happy path: emits exact summary, Status codes line (only non-zero classes), and YYYY-MM-DD First/Last seen', () => {
    const ep = makeCandidate(
      'ep-1',
      'endpoints',
      { httpMethod: 'GET', pathTemplate: '/owners/{ownerId}' },
      {
        runtime: {
          matched: {
            method: 'GET',
            codePathTemplate: '/owners/{ownerId}',
            normalizedLogPath: '/owners/123',
            observedUsageCount: 1842,
            totalLogRequests: 12430,
            status2xxCount: 1500,
            status3xxCount: 42,
            status4xxCount: 300,
            // 5xx left at zero — must be omitted from the line per spec.
            status5xxCount: 0,
            firstSeen: '2026-04-12T08:15:30Z',
            lastSeen: '2026-05-09T22:01:11Z',
            matchConfidence: 0.99,
            matchReason: 'exact match',
          },
        },
      }
    );

    const section = buildEndpointLogEvidenceSection(ep);

    expect(section.title).toBe('Log Scans');
    expect(section.status).toBe('available');
    expect(section.summary).toBe(
      'Observed 1,842 successful/redirect calls in supplied logs.'
    );

    // Field order: Status codes → First seen → Last seen.
    expect(section.fields).toEqual([
      { label: 'Status codes', value: '2xx: 1,500 \u00b7 3xx: 42 \u00b7 4xx: 300' },
      { label: 'First seen', value: '2026-04-12' },
      { label: 'Last seen', value: '2026-05-09' },
    ]);
  });

  it('no-usage path: status available, exact summary, no fields', () => {
    const ep = makeCandidate('ep-2', 'endpoints', {}, {
      runtime: {
        noUsageObserved: true,
        observedUsageCount: 0,
        status2xxCount: 0,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: 0,
        note: 'no observation in window',
      },
    });

    const section = buildEndpointLogEvidenceSection(ep);

    expect(section.status).toBe('available');
    expect(section.summary).toBe(
      'No matching log observations in processed log window.'
    );
    expect(section.fields).toEqual([]);
  });

  it('no runtime block (no log_enrichment at all): status not_available, fallback summary, fields []', () => {
    const ep = makeCandidate('ep-3', 'endpoints', { httpMethod: 'GET' });

    const section = buildEndpointLogEvidenceSection(ep);

    expect(section).toEqual({
      title: 'Log Scans',
      status: 'not_available',
      summary: 'Log scan evidence was not found for this run.',
      fields: [],
    });
  });
});

// ---------------------------------------------------------------------------
// buildInterfaceLogEvidenceSection
// ---------------------------------------------------------------------------

describe('buildInterfaceLogEvidenceSection', () => {
  it('happy path with full coverage: status available, exact summary, Observed/Top endpoint/Status codes/First/Last fields', () => {
    const iface = makeCandidate('iface-1', 'interfaces');
    const rollup: InterfaceRuntimeRollup = {
      totalObservedCalls: 12430,
      observedEndpointCount: 6,
      totalEndpointCount: 6,
      topEndpoints: [
        {
          method: 'GET',
          pathTemplate: '/owners/{ownerId}',
          observedUsageCount: 1842,
        },
      ],
      statusBreakdown: {
        status2xxCount: 11000,
        status3xxCount: 200,
        status4xxCount: 1230,
        status5xxCount: 0,
      },
      firstSeen: '2026-04-01T00:00:00Z',
      lastSeen: '2026-05-10T23:59:59Z',
    };
    const ctx = makeContext({
      interfaceRollupByCandidateId: new Map([['iface-1', rollup]]),
    });

    const section = buildInterfaceLogEvidenceSection(iface, ctx);

    expect(section.status).toBe('available');
    expect(section.summary).toBe(
      'Related endpoints observed 12,430 successful/redirect calls.'
    );
    expect(section.fields).toEqual([
      { label: 'Observed endpoints', value: '6 of 6 related endpoints.' },
      {
        label: 'Top endpoint',
        value: 'GET /owners/{ownerId} \u2014 1,842 calls',
      },
      { label: 'Status codes', value: '2xx: 11,000 \u00b7 3xx: 200 \u00b7 4xx: 1,230' },
      { label: 'First seen', value: '2026-04-01' },
      { label: 'Last seen', value: '2026-05-10' },
    ]);
  });

  it('partial-rollup: observedEndpointCount < totalEndpointCount AND > 0 → status partial, Observed line "M of N"', () => {
    const iface = makeCandidate('iface-2', 'interfaces');
    const rollup: InterfaceRuntimeRollup = {
      totalObservedCalls: 100,
      observedEndpointCount: 4,
      totalEndpointCount: 6,
      topEndpoints: [
        {
          method: 'POST',
          pathTemplate: '/owners',
          observedUsageCount: 60,
        },
      ],
      statusBreakdown: {
        status2xxCount: 90,
        status3xxCount: 0,
        status4xxCount: 10,
        status5xxCount: 0,
      },
    };
    const ctx = makeContext({
      interfaceRollupByCandidateId: new Map([['iface-2', rollup]]),
    });

    const section = buildInterfaceLogEvidenceSection(iface, ctx);

    expect(section.status).toBe('partial');
    expect(section.summary).toBe(
      'Related endpoints observed 100 successful/redirect calls.'
    );
    const observed = section.fields.find((f) => f.label === 'Observed endpoints');
    expect(observed).toEqual({
      label: 'Observed endpoints',
      value: '4 of 6 related endpoints.',
    });
    const top = section.fields.find((f) => f.label === 'Top endpoint');
    expect(top).toEqual({
      label: 'Top endpoint',
      value: 'POST /owners \u2014 60 calls',
    });
  });
});

// ---------------------------------------------------------------------------
// buildLogicalDataEntityLogEvidenceSection
// ---------------------------------------------------------------------------

describe('buildLogicalDataEntityLogEvidenceSection', () => {
  it('happy path: exact summary; read-like field present when > 0; write-like row hidden when zero', () => {
    const lde = makeCandidate('lde-1', 'logical_data_entities');
    const rollup: LogicalDataEntityRuntimeRollup = {
      totalObservedCalls: 250,
      relatedEndpointCount: 4,
      readLikeCount: 250,
      writeLikeCount: 0, // must be hidden
      firstSeen: '2026-04-15T00:00:00Z',
      lastSeen: '2026-05-10T00:00:00Z',
    };
    const ctx = makeContext({
      logicalDataEntityRollupByCandidateId: new Map([['lde-1', rollup]]),
    });

    const section = buildLogicalDataEntityLogEvidenceSection(lde, ctx);

    expect(section.status).toBe('available');
    expect(section.summary).toBe(
      'Related endpoints observed 250 successful/redirect calls.'
    );
    expect(section.fields).toEqual([
      { label: 'Read-like traffic', value: '250' },
      { label: 'First seen', value: '2026-04-15' },
      { label: 'Last seen', value: '2026-05-10' },
    ]);
    // Defensive: write-like row never landed.
    expect(section.fields.find((f) => f.label === 'Write/change-like traffic'))
      .toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildInterfaceLogicalEntityLogEvidenceSection
// ---------------------------------------------------------------------------

describe('buildInterfaceLogicalEntityLogEvidenceSection', () => {
  it('happy path: exact summary; four fields in correct display order; zero-count rows hidden; Total always shown', () => {
    const ile = makeCandidate('ile-1', 'interface_logical_entities');
    const rollup: InterfaceLogicalEntityRuntimeRollup = {
      supportingEndpointCount: 3,
      requestBodyUsageCount: 50, // visible
      responseBodyUsageCount: 200, // visible
      unknownRoleUsageCount: 0, // hidden
      totalObservedContractUsage: 250,
    };
    const ctx = makeContext({
      interfaceLogicalEntityRollupByCandidateId: new Map([['ile-1', rollup]]),
    });

    const section = buildInterfaceLogicalEntityLogEvidenceSection(ile, ctx);

    expect(section.status).toBe('available'); // unknown bucket empty
    expect(section.summary).toBe(
      'This interface/data relationship is supported by 3 observed endpoints.'
    );

    // Display order is enforced by array index, not just by presence.
    expect(section.fields.map((f) => f.label)).toEqual([
      'Request body usage',
      'Response body usage',
      // 'Unknown role usage' OMITTED (zero)
      'Total observed contract usage',
    ]);
    expect(section.fields).toEqual([
      { label: 'Request body usage', value: '50 calls' },
      { label: 'Response body usage', value: '200 calls' },
      {
        label: 'Total observed contract usage',
        value: '250 successful/redirect calls',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Spec 7 Task Group 3.1 — Log Scans dispatcher impact-block population gate
// ---------------------------------------------------------------------------

describe('buildLogScansEvidenceSection (Spec 7 impact block)', () => {
  it('does NOT set confidenceImpactLabel/Reason when displayConfidence === baseConfidence (no log uplift)', () => {
    // Adapter endpoint candidate with NO entry in the runtime context
    // -> uplift is 0 -> displayConfidence === baseConfidence -> impact
    // block must remain UNSET.
    const ep = makeCandidate(
      'ep-no-logs',
      'endpoints',
      { _addedBy: 'spring-boot-adapter' }
    );
    const ctx = makeContext(); // empty -> no entry for 'ep-no-logs'

    const section = buildLogScansEvidenceSection(ep, ctx);

    expect(section.confidenceImpactLabel).toBeUndefined();
    expect(section.confidenceImpactReason).toBeUndefined();
  });

  it('endpoints uplift case: populates "Confidence increased" + thousand-separated observed-calls reason', () => {
    // Adapter endpoint with observedUsageCount = 1842 yields a +5 uplift
    // (>= 1000 adapter rule). baseConfidence 0.80 -> displayConfidence 0.85
    // -> impact block must be populated.
    const ep = makeCandidate(
      'ep-uplift',
      'endpoints',
      { _addedBy: 'spring-boot-adapter' },
      {
        runtime: {
          matched: makeMatched({ observedUsageCount: 1842 }),
        },
      }
    );
    const ctx = makeContext({
      byCandidateId: new Map([
        ['ep-uplift', { runtime: { matched: makeMatched({ observedUsageCount: 1842 }) } }],
      ]),
    });

    const section = buildLogScansEvidenceSection(ep, ctx);

    expect(section.confidenceImpactLabel).toBe('Confidence increased');
    expect(section.confidenceImpactReason).toBe(
      'Runtime logs observed 1,842 successful/redirect calls matching this candidate.'
    );
  });

  it('indirection-type uplift case (interfaces): populates "Confidence increased" + "Related endpoint runtime usage observed."', () => {
    // Interface candidate with rollup observedEndpointCount = 1, totalEndpointCount = 4
    // -> +2 uplift. baseConfidence 0.80 -> displayConfidence 0.82 -> impact
    // block populated; reason uses the indirection-type wording.
    const iface = makeCandidate('iface-uplift', 'interfaces');
    const rollup: InterfaceRuntimeRollup = {
      totalObservedCalls: 50,
      observedEndpointCount: 1,
      totalEndpointCount: 4,
      topEndpoints: [
        { method: 'GET', pathTemplate: '/x', observedUsageCount: 50 },
      ],
      statusBreakdown: {
        status2xxCount: 50,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: 0,
      },
    };
    const ctx = makeContext({
      interfaceRollupByCandidateId: new Map([['iface-uplift', rollup]]),
    });

    const section = buildLogScansEvidenceSection(iface, ctx);

    expect(section.confidenceImpactLabel).toBe('Confidence increased');
    expect(section.confidenceImpactReason).toBe(
      'Related endpoint runtime usage observed.'
    );
  });
});
