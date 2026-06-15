/**
 * DiscoveryRunDetailView -- advisory `degraded` signal + new finding labels
 *
 * Spec 2026-05-30 Oracle Integrity & Determinism (Spec #3) -- Task Group 6.1.
 *
 * Focused coverage for the frontend surfacing this spec adds (ADD-only):
 *   - A `degraded` run renders the advisory flag + its `degraded_reasons` on
 *     the run-detail surface the SAME way the Tier B/C `warnings` banner is
 *     shown (single line for one reason, a list for several).
 *   - A non-degraded run (degraded false / null) renders NO banner.
 *   - `normalizeDegradedReasons` is dual-tolerant: it accepts the AMS wire
 *     shape (a JSON-encoded `string[]`) AND an already-parsed array, mirroring
 *     the `warnings` precedent (AMS emits `degraded_reasons` JSON-encoded,
 *     verbatim, with no parsing layer between AMS and the frontend).
 *   - `FINDING_TYPE_LABELS` carries human labels for the two new evidence-gap
 *     sentinels (`non_deterministic_endpoint`, `possible_entity_collision`) so
 *     `FindingsTab` / `FindingDetailDrawer` render them with NO new component.
 *
 * The embedded Candidates / Findings tab surfaces are mocked out (they have
 * their own dedicated tests) so this file stays focused on the degraded
 * banner orchestration -- mirroring the existing `DiscoveryRunDetailView.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  DiscoveryRunDto,
  DiscoveryCandidateDto,
} from '../../api/discoveryApi';
import {
  FINDING_TYPE_LABELS,
  labelForFindingType,
} from './findingTypeLabels';

// ----------------------------------------------------------------------------
// Mocks for the embedded surfaces -- keep this test on the degraded banner.
// ----------------------------------------------------------------------------

vi.mock('../DashboardView/DiscoveryCandidateTable', () => ({
  DiscoveryCandidateTable: () => (
    <div data-testid="mock-discovery-candidate-table">table mock</div>
  ),
}));

vi.mock('./FindingsTab', () => ({
  FindingsTab: () => <div data-testid="mock-findings-tab">findings mock</div>,
}));

// CSS module identity proxy so styles.X survives without a real loader.
vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import {
  DiscoveryRunDetailView,
  normalizeDegradedReasons,
} from './DiscoveryRunDetailView';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';

function makeRun(overrides: Partial<DiscoveryRunDto> = {}): DiscoveryRunDto {
  return {
    id: 'run-uuid-1',
    project_id: PROJECT_ID,
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-05-30T00:00:00Z',
    updated_at: '2026-05-30T00:00:00Z',
    architecture_id: ARCH_ID,
    ...overrides,
  };
}

const sampleCandidates: DiscoveryCandidateDto[] = [
  {
    id: 'cand-1',
    run_id: 'run-uuid-1',
    candidate_type: 'application',
    name: 'OrderService',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-30T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  },
];

function renderView(run: DiscoveryRunDto | null) {
  return render(
    <DiscoveryRunDetailView
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      selectedRun={run}
      candidates={sampleCandidates}
      onCandidatesChange={vi.fn()}
    />,
  );
}

// ============================================================================
// Degraded banner on the run-detail surface
// ============================================================================

describe('DiscoveryRunDetailView -- degraded banner (Spec #3, Group 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a degraded run shows the flag + its degraded_reasons (JSON-encoded string[], like warnings)', () => {
    // AMS emits `degraded_reasons` as a JSON-encoded string[] verbatim (the
    // `warnings` precedent) -- two reasons here, so the banner renders a list.
    const run = makeRun({
      degraded: true,
      degraded_reasons: JSON.stringify([
        'A pack finding scanner failed (scanner_failed).',
        '3 file(s) failed gap-fill.',
      ]),
    });

    renderView(run);

    // The advisory flag line renders...
    const banner = screen.getByTestId('run-degraded-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId('run-degraded-flag')).toHaveTextContent(
      'Degraded run',
    );

    // ...and BOTH reasons render as list items (same shape as the multi-item
    // warnings banner).
    expect(screen.getByTestId('run-degraded-reasons-list')).toBeInTheDocument();
    const reasons = screen.getAllByTestId('run-degraded-reason');
    expect(reasons).toHaveLength(2);
    expect(banner).toHaveTextContent(
      'A pack finding scanner failed (scanner_failed).',
    );
    expect(banner).toHaveTextContent('3 file(s) failed gap-fill.');
  });

  it('a degraded run with a single reason renders it inline (not a list), like the single-warning banner', () => {
    const run = makeRun({
      degraded: true,
      // Already-parsed array shape is tolerated too (dual-tolerance).
      degraded_reasons: ['Method cap hit (DEFAULT_METHOD_CAP).'],
    });

    renderView(run);

    expect(screen.getByTestId('run-degraded-banner')).toBeInTheDocument();
    // Single reason -> inline span, NOT a <ul> list.
    expect(screen.getByTestId('run-degraded-reason')).toHaveTextContent(
      'Method cap hit (DEFAULT_METHOD_CAP).',
    );
    expect(
      screen.queryByTestId('run-degraded-reasons-list'),
    ).not.toBeInTheDocument();
  });

  it('a non-degraded run shows NO degraded banner (degraded false OR absent)', () => {
    // degraded explicitly false.
    const { unmount } = renderView(makeRun({ degraded: false }));
    expect(screen.queryByTestId('run-degraded-banner')).not.toBeInTheDocument();
    unmount();

    // degraded absent entirely (legacy / not-yet-computed run).
    renderView(makeRun());
    expect(screen.queryByTestId('run-degraded-banner')).not.toBeInTheDocument();
  });
});

// ============================================================================
// normalizeDegradedReasons -- dual-tolerance (JSON string OR array)
// ============================================================================

describe('normalizeDegradedReasons (Spec #3, Group 6.1)', () => {
  it('parses a JSON-encoded string[] (the AMS wire shape) and passes an array through', () => {
    expect(normalizeDegradedReasons(JSON.stringify(['a', 'b']))).toEqual([
      'a',
      'b',
    ]);
    expect(normalizeDegradedReasons(['x', 'y'])).toEqual(['x', 'y']);
    // A non-JSON plain string is wrapped as a single reason; null/empty -> [].
    expect(normalizeDegradedReasons('just one reason')).toEqual([
      'just one reason',
    ]);
    expect(normalizeDegradedReasons(null)).toEqual([]);
    expect(normalizeDegradedReasons(undefined)).toEqual([]);
    expect(normalizeDegradedReasons('')).toEqual([]);
  });
});

// ============================================================================
// New evidence-gap sentinels render via FINDING_TYPE_LABELS (no new component)
// ============================================================================

describe('FINDING_TYPE_LABELS -- new Spec #3 sentinels (Group 6.1)', () => {
  it('has human-readable labels for non_deterministic_endpoint and possible_entity_collision', () => {
    expect(FINDING_TYPE_LABELS['non_deterministic_endpoint']).toBe(
      'Non-deterministic endpoint',
    );
    expect(FINDING_TYPE_LABELS['possible_entity_collision']).toBe(
      'Possible entity collision',
    );
    // The resolver `FindingsTab` / `FindingDetailDrawer` call returns the
    // friendly label (not the raw snake_case) for both.
    expect(labelForFindingType('non_deterministic_endpoint')).toBe(
      'Non-deterministic endpoint',
    );
    expect(labelForFindingType('possible_entity_collision')).toBe(
      'Possible entity collision',
    );
  });
});
