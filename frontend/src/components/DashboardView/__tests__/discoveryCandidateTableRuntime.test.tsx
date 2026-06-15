/**
 * DiscoveryCandidateTable runtime + display-confidence wire-up tests
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 4.1.
 *
 * Hotfix 2026-05-11 -- Bugs 4 & 5 retitle this suite:
 *  - Bug 5 retires the sibling `<RuntimeBadge>` in the table; the Tier cell
 *    now renders a SINGLE `<TierBadge>` whose label encodes log-evidence
 *    presence as a `" + logs"` suffix (discrete text, filterable).
 *  - Bug 4 adds a Tier filter dropdown populated with the discrete labels
 *    (e.g. "adapter + logs"). The dropdown values come from the SAME
 *    helper used by the row render so they stay in lockstep.
 *
 * Strict scope: integration tests over the Tier `<td>`, the new Tier
 * filter dropdown, and the Confidence `<td>` `+N` uplift indicator. The
 * `runtimeEvidenceContext` memo is still the shared Spec 6 precomputation
 * read by all three derivations.
 *
 * Coverage (7 focused tests):
 *  1. Adapter endpoint with observedUsageCount = 1842 -> Tier <td> renders
 *     a SINGLE <TierBadge> whose label reads "adapter + logs". No sibling
 *     <RuntimeBadge> is rendered in the table (Bug 5).
 *  2. Adapter endpoint with no associated log evidence -> Tier <td> renders
 *     ONLY a <TierBadge> labelled "adapter" (no " + logs" suffix, no
 *     sibling runtime badge).
 *  3. Adapter endpoint with baseConfidence = 0.80 and observedUsageCount = 1500
 *     -> Confidence <td> renders "85%" followed by a `+5` uplift span.
 *  4. Adapter endpoint with baseConfidence = 0.97, eligible +5 uplift -> capped
 *     at 99% with `+2` shown in the uplift indicator.
 *  5. Unsupported candidate type -> NO sibling RuntimeBadge AND no `+N`
 *     uplift indicator. The TierBadge still renders with the base label
 *     (e.g. "adapter") because the type-gate forbids the log-evidence
 *     suffix even when raw log_enrichment data exists on the candidate.
 *  6. LLM-only endpoint with observedUsageCount > 0 -> SINGLE TierBadge
 *     labelled "llm-solo + logs" AND a capped uplift up to 95%.
 *  7. (Bug 4) Tier filter dropdown shows the discrete combined labels for
 *     a representative candidate list and the dropdown selection filters
 *     visible rows to those matching the chosen discrete label.
 *
 * Mocks:
 *  - Standard ArchitectureContext mock (matches candidateReviewWorkflow.test).
 *  - Vitest CSS-module Proxy for DiscoveryRunDetailView.module.css and
 *    TierBadge.module.css.
 *  - discoveryApi mock kept narrow -- the table only invokes the API on
 *    review actions, which these tests do NOT exercise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';

// ============================================================================
// Mock setup
// ============================================================================

vi.mock('../../../api/discoveryApi', () => ({
  reviewCandidate: vi.fn(),
  bulkReviewCandidates: vi.fn(),
  // Spec 1 (2026-06-02) Group 6: the table fetches the review-model backbone on
  // mount. These runtime/tier-label tests assert the LOCAL display derivation
  // (the backbone does not carry the display vocabulary), so the backbone fetch
  // is mocked to REJECT and the grid falls back to the identical local logic.
  getReviewModel: vi.fn().mockRejectedValue(new Error('not under test')),
}));

vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    {
      get: (_target: object, prop: string | symbol) => String(prop),
    }
  ),
}));

vi.mock('../TierBadge.module.css', () => ({
  default: new Proxy(
    {},
    {
      get: (_target: object, prop: string | symbol) => String(prop),
    }
  ),
}));

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-uuid-default',
  useArchitectureContext: () => ({
    architectures: [
      {
        id: 'arch-uuid-default',
        projectId: 'proj-1',
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  }),
}));

// ============================================================================
// Fixture helpers
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-001',
    run_id: 'run-1',
    candidate_type: 'endpoints',
    name: 'GET /orders',
    confidence: 0.8,
    status: 'proposed',
    source_cluster_ids: [],
    data: {
      _addedBy: 'spring-boot-adapter',
      httpMethod: 'GET',
      fullPath: '/orders',
      controllerClassName: 'OrderController',
    },
    synthesized_at: '2026-05-11T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

function makeRuntimeBlock(overrides: {
  observedUsageCount: number;
  totalLogRequests?: number;
  status2xxCount?: number;
  status5xxCount?: number;
}): Record<string, unknown> {
  return {
    runtime: {
      matched: {
        method: 'GET',
        codePathTemplate: '/orders',
        normalizedLogPath: '/orders',
        observedUsageCount: overrides.observedUsageCount,
        totalLogRequests: overrides.totalLogRequests ?? overrides.observedUsageCount,
        status2xxCount: overrides.status2xxCount ?? overrides.observedUsageCount,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: overrides.status5xxCount ?? 0,
        matchConfidence: 0.95,
        matchReason: 'exact match',
      },
    },
  };
}

// ============================================================================
// Test harness
// ============================================================================

let DiscoveryCandidateTable: React.FC<{
  projectId: string;
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = mod.DiscoveryCandidateTable;
});

// Helper that locates the Tier <td> for a row -- the second <td> in the row.
// Returns the cell element so callers can use `within()` to assert children.
function getTierCell(rowIndex: number): HTMLElement {
  const rows = screen.getAllByTestId('candidate-row');
  const cells = rows[rowIndex].querySelectorAll('td');
  return cells[1] as HTMLElement; // 0=Name, 1=Tier, 2=Type, 3=Confidence...
}

// Helper that locates the Confidence <td> for a row by its preserved testid.
// All rows share the same testid value, so we collect them and index in.
function getConfidenceCell(rowIndex: number): HTMLElement {
  const cells = screen.getAllByTestId('candidate-confidence-cell');
  return cells[rowIndex];
}

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryCandidateTable runtime + display-confidence wire-up (Spec 7 Group 4 + Hotfix Bugs 4/5)', () => {
  // --------------------------------------------------------------------------
  // Test 1 (Bug 5 retitled): adapter endpoint with high-usage runtime
  //   -> single TierBadge labelled "adapter + logs", no sibling RuntimeBadge.
  // --------------------------------------------------------------------------
  it('Test 1: adapter endpoint with observedUsageCount = 1842 renders a single TierBadge labelled "adapter + logs" and NO sibling RuntimeBadge', () => {
    const candidate = makeCandidate({
      id: 'ep-high',
      log_enrichment: makeRuntimeBlock({ observedUsageCount: 1842 }),
    });

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[candidate]}
        onCandidatesChange={vi.fn()}
      />
    );

    const tierCell = getTierCell(0);
    const tierBadge = within(tierCell).getByTestId('candidate-tier-badge');
    expect(tierBadge).toBeInTheDocument();
    expect(tierBadge).toHaveTextContent('adapter + logs');
    // Bug 5: the previous sibling RuntimeBadge is no longer rendered in the table.
    expect(within(tierCell).queryByTestId('candidate-runtime-badge')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: adapter endpoint with no log evidence -> only TierBadge "adapter"
  // --------------------------------------------------------------------------
  it('Test 2: adapter endpoint with no associated log evidence renders TierBadge "adapter" with no " + logs" suffix and no sibling badge', () => {
    const candidate = makeCandidate({
      id: 'ep-bare',
      // No log_enrichment at all -> no entry in the runtime context map.
    });

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[candidate]}
        onCandidatesChange={vi.fn()}
      />
    );

    const tierCell = getTierCell(0);
    const tierBadge = within(tierCell).getByTestId('candidate-tier-badge');
    expect(tierBadge).toBeInTheDocument();
    expect(tierBadge).toHaveTextContent(/^adapter$/);
    expect(within(tierCell).queryByTestId('candidate-runtime-badge')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: confidence + uplift -> "85%" with "+5" sibling
  // --------------------------------------------------------------------------
  it('Test 3: baseConfidence = 0.80 and observedUsageCount = 1500 -> Confidence cell shows "85%" with "+5" uplift indicator', () => {
    const candidate = makeCandidate({
      id: 'ep-uplift',
      confidence: 0.8,
      log_enrichment: makeRuntimeBlock({ observedUsageCount: 1500 }),
    });

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[candidate]}
        onCandidatesChange={vi.fn()}
      />
    );

    const cell = getConfidenceCell(0);
    expect(cell).toHaveTextContent('85%');
    const uplift = within(cell).getByTestId('candidate-confidence-uplift');
    expect(uplift).toHaveTextContent('+5');
  });

  // --------------------------------------------------------------------------
  // Test 4: confidence cap -> "99%" with "+2" shown after capping
  // --------------------------------------------------------------------------
  it('Test 4: baseConfidence = 0.97, eligible +5 -> capped at "99%" with "+2" shown in the uplift indicator', () => {
    const candidate = makeCandidate({
      id: 'ep-cap',
      confidence: 0.97,
      log_enrichment: makeRuntimeBlock({ observedUsageCount: 1500 }),
    });

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[candidate]}
        onCandidatesChange={vi.fn()}
      />
    );

    const cell = getConfidenceCell(0);
    expect(cell).toHaveTextContent('99%');
    const uplift = within(cell).getByTestId('candidate-confidence-uplift');
    expect(uplift).toHaveTextContent('+2');
  });

  // --------------------------------------------------------------------------
  // Test 5: unsupported candidate type -> no RuntimeBadge, no uplift,
  //   no " + logs" suffix on the TierBadge (type-gate forbids it).
  // --------------------------------------------------------------------------
  it('Test 5: unsupported candidate type renders TierBadge "adapter" (no " + logs") and NO `+N` uplift indicator', () => {
    // 'capabilities' is not in the Spec 6 supported allowlist
    // (endpoints / interfaces / logical_data_entities / interface_logical_entities).
    const candidate = makeCandidate({
      id: 'cap-1',
      candidate_type: 'capabilities',
      confidence: 0.8,
      // Even if we attached log evidence, the type-gate forbids the suffix.
      log_enrichment: makeRuntimeBlock({ observedUsageCount: 5000 }),
    });

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[candidate]}
        onCandidatesChange={vi.fn()}
      />
    );

    const tierCell = getTierCell(0);
    const tierBadge = within(tierCell).getByTestId('candidate-tier-badge');
    expect(tierBadge).toBeInTheDocument();
    // No " + logs" suffix because the type-gate excludes 'capabilities'.
    expect(tierBadge).toHaveTextContent(/^adapter$/);
    expect(within(tierCell).queryByTestId('candidate-runtime-badge')).not.toBeInTheDocument();

    const confidenceCell = getConfidenceCell(0);
    // displayConfidence === baseConfidence -> still "80%" but no uplift span.
    expect(confidenceCell).toHaveTextContent('80%');
    expect(within(confidenceCell).queryByTestId('candidate-confidence-uplift')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 6: LLM-only endpoint with observed usage
  //   -> single TierBadge labelled "llm-solo + logs" + capped LLM uplift.
  // --------------------------------------------------------------------------
  it('Test 6: LLM-only endpoint with observedUsageCount > 0 renders TierBadge "llm-solo + logs" and a capped uplift up to 95%', () => {
    // baseConfidence 0.92 + raw +5 -> 0.97 -> capped at 0.95 -> applied +3pp.
    const candidate = makeCandidate({
      id: 'ep-llm',
      confidence: 0.92,
      data: {
        _addedBy: 'llm-solo',
        httpMethod: 'GET',
        fullPath: '/llm-only',
        controllerClassName: 'LlmOnlyController',
      },
      log_enrichment: makeRuntimeBlock({ observedUsageCount: 5 }),
    });

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[candidate]}
        onCandidatesChange={vi.fn()}
      />
    );

    const tierCell = getTierCell(0);
    const tierBadge = within(tierCell).getByTestId('candidate-tier-badge');
    // Bug 5: the badge now carries the combined label directly.
    expect(tierBadge).toHaveTextContent('llm-solo + logs');
    // No sibling RuntimeBadge sibling rendered in the table any more.
    expect(within(tierCell).queryByTestId('candidate-runtime-badge')).not.toBeInTheDocument();

    const confidenceCell = getConfidenceCell(0);
    // Capped at 95% (LLM cap).
    expect(confidenceCell).toHaveTextContent('95%');
    const uplift = within(confidenceCell).getByTestId('candidate-confidence-uplift');
    expect(uplift).toHaveTextContent('+3');
  });

  // --------------------------------------------------------------------------
  // Test 7 (Bug 4): Tier filter dropdown shows discrete combined labels
  //   AND filters visible rows to the chosen label.
  // --------------------------------------------------------------------------
  it('Test 7: Tier filter dropdown lists discrete combined labels and filters rows to the chosen label', () => {
    const candidates: DiscoveryCandidateDto[] = [
      makeCandidate({
        id: 'ep-adapter-with-logs',
        name: 'GET /orders',
        // adapter + observed usage -> "adapter + logs"
        log_enrichment: makeRuntimeBlock({ observedUsageCount: 100 }),
      }),
      makeCandidate({
        id: 'ep-adapter-no-logs',
        name: 'GET /products',
        // adapter only -> "adapter"
      }),
      makeCandidate({
        id: 'ep-llm-solo',
        name: 'GET /llm-only',
        data: {
          _addedBy: 'llm-solo',
          httpMethod: 'GET',
          fullPath: '/llm-only',
          controllerClassName: 'LlmOnlyController',
        },
        // llm-solo, no logs -> "llm-solo"
      }),
    ];

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={candidates}
        onCandidatesChange={vi.fn()}
      />
    );

    // All three rows visible at start.
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(3);

    // The Tier filter exists and lists the three discrete labels.
    const filterTier = screen.getByTestId('filter-tier') as HTMLSelectElement;
    const optionValues = Array.from(filterTier.options).map((o) => o.value);
    expect(optionValues).toContain('');
    expect(optionValues).toContain('adapter');
    expect(optionValues).toContain('adapter + logs');
    expect(optionValues).toContain('llm-solo');

    // Selecting "adapter + logs" leaves only that row visible.
    fireEvent.change(filterTier, { target: { value: 'adapter + logs' } });
    const filteredRows = screen.getAllByTestId('candidate-row');
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0]).toHaveTextContent('GET /orders');
  });
});
