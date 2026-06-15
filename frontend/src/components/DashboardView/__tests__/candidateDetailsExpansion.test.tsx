/**
 * Candidate Details Expansion Integration Tests
 *
 * Spec 2026-05-10: Candidate Details Expansion UI -- Task Group 4, Task 4.1
 *
 * Focused integration tests for the expansion wire-up inside
 * `DiscoveryCandidateTable`. Mirrors the conventions in
 * `candidateReviewWorkflow.test.tsx`:
 *   - `vi.mock('../../../api/discoveryApi', ...)` with spread of unmocked
 *     exports so the table can still find the named exports it imports.
 *   - CSS module identity Proxy mock so className assertions are predictable.
 *   - `ArchitectureContext` mocks so the table mounts without a provider.
 *
 * Tests cover (per spec):
 *   (a) Show Details button is rendered on every candidate row, with
 *       `data-testid="show-details-{candidate.id}"`.
 *   (b) Action button order in the actions cell is exactly
 *       Show Details, Approve, Reject, Defer.
 *   (c) Show Details is enabled for an allowlisted type (`endpoints`) and
 *       disabled for a non-allowlisted type. Disabled instance has the
 *       native `disabled` attribute and the explanatory `title`.
 *   (d) Clicking Show Details on an eligible row reveals the panel and
 *       toggles the label to "Close Details"; clicking again collapses it.
 *   (e) Opening details on a second eligible row collapses the first
 *       (single-row expansion guarantee).
 *   (f) The expanded panel does NOT contain the candidate name, tier, type
 *       label, confidence, review status, or synthesized timestamp.
 *   (g) A disabled (non-allowlisted) row never renders an expansion panel
 *       even if forcibly toggled (state cannot lead to render).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';

// ============================================================================
// Mock setup -- mirror candidateReviewWorkflow.test.tsx conventions
// ============================================================================

const mockReviewCandidate = vi.fn();
const mockBulkReviewCandidates = vi.fn();

// Preserve unmocked exports via async spread of the actual module so any
// export the table imports that we don't explicitly stub still resolves.
vi.mock('../../../api/discoveryApi', async () => {
  const actual = await vi.importActual<typeof import('../../../api/discoveryApi')>(
    '../../../api/discoveryApi'
  );
  return {
    ...actual,
    reviewCandidate: (...args: unknown[]) => mockReviewCandidate(...args),
    bulkReviewCandidates: (...args: unknown[]) => mockBulkReviewCandidates(...args),
  };
});

// CSS-module identity mock: className lookups return the property name.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ArchitectureContext hooks -- the table itself doesn't read context, but
// downstream imports (e.g. DiscoveryRunDetailView in shared mock space) may.
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
// Fixture builder
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-001',
    run_id: 'run-001',
    candidate_type: 'endpoints',
    name: 'GET /orders',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['cluster-1'],
    data: { _addedBy: 'spring-adapter', http_method: 'GET', path: '/orders' },
    synthesized_at: '2026-05-10T12:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

/**
 * Mixed fixture used by most tests:
 *  - cand-001: endpoints (allowlisted)
 *  - cand-002: interfaces (allowlisted)
 *  - cand-003: services   (NOT allowlisted -> disabled)
 */
function makeMixedCandidates(): DiscoveryCandidateDto[] {
  return [
    makeCandidate({ id: 'cand-001', name: 'GET /orders', candidate_type: 'endpoints' }),
    makeCandidate({
      id: 'cand-002',
      name: 'OrdersInterface',
      candidate_type: 'interfaces',
      data: { path: '/orders/interface' },
    }),
    makeCandidate({
      id: 'cand-003',
      name: 'PaymentSvc',
      candidate_type: 'services',
      data: {},
      source_cluster_ids: [],
    }),
  ];
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
  mockReviewCandidate.mockReset();
  mockBulkReviewCandidates.mockReset();

  const tableMod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = tableMod.DiscoveryCandidateTable;
});

function renderTable(candidates: DiscoveryCandidateDto[]) {
  const onCandidatesChange = vi.fn();
  render(
    <DiscoveryCandidateTable
      projectId="proj-1"
      architectureId="arch-uuid-default"
      runId="run-001"
      candidates={candidates}
      onCandidatesChange={onCandidatesChange}
    />
  );
  return { onCandidatesChange };
}

// ============================================================================
// Tests
// ============================================================================

describe('Candidate Details Expansion (Task Group 4)', () => {
  // (a) Show Details button is rendered on every candidate row.
  it('renders a Show Details button on every candidate row with the correct testid', () => {
    const candidates = makeMixedCandidates();
    renderTable(candidates);

    for (const c of candidates) {
      expect(screen.getByTestId(`show-details-${c.id}`)).toBeInTheDocument();
    }
  });

  // (b) Action button order in the actions cell is exactly Show Details,
  // Approve, Reject, Defer.
  it('renders the actions cell button order as Show Details, Approve, Reject, Defer', () => {
    const candidates = [makeCandidate({ id: 'cand-001', candidate_type: 'endpoints' })];
    renderTable(candidates);

    // Locate the row, then the actions cell via the action-approve button's row.
    const row = screen.getByTestId('candidate-row');
    const buttons = within(row).getAllByRole('button');
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels).toEqual(['Show Details', 'Approve', 'Reject', 'Defer']);
  });

  // (c) Allowlisted (endpoints) -> enabled; non-allowlisted (services) ->
  // disabled with `disabled` attribute and explanatory `title`.
  it('enables Show Details for allowlisted types and disables it (with title) for non-allowlisted types', () => {
    renderTable(makeMixedCandidates());

    const enabledBtn = screen.getByTestId('show-details-cand-001');
    const disabledBtn = screen.getByTestId('show-details-cand-003');

    expect(enabledBtn).not.toBeDisabled();
    expect(enabledBtn).not.toHaveAttribute('title');

    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn).toHaveAttribute('title', 'Details not available for this candidate type');
  });

  // (d) Clicking Show Details on an eligible row reveals the panel and the
  // toggle label flips to "Close Details"; clicking Close Details collapses.
  it('toggles the panel and flips the button label between Show Details and Close Details', () => {
    renderTable(makeMixedCandidates());

    const toggle = screen.getByTestId('show-details-cand-001');

    // Initially collapsed -- panel not in document, label is "Show Details".
    expect(screen.queryByTestId('candidate-details-panel-cand-001')).not.toBeInTheDocument();
    expect(toggle).toHaveTextContent('Show Details');

    // Open
    fireEvent.click(toggle);
    expect(screen.getByTestId('candidate-details-panel-cand-001')).toBeInTheDocument();
    expect(screen.getByTestId('show-details-cand-001')).toHaveTextContent('Close Details');

    // Close
    fireEvent.click(screen.getByTestId('show-details-cand-001'));
    expect(screen.queryByTestId('candidate-details-panel-cand-001')).not.toBeInTheDocument();
    expect(screen.getByTestId('show-details-cand-001')).toHaveTextContent('Show Details');
  });

  // (e) Opening details on a second eligible row collapses the first
  // (single-row expansion guarantee).
  it('enforces single-row expansion: opening a second row collapses the first', () => {
    renderTable(makeMixedCandidates());

    fireEvent.click(screen.getByTestId('show-details-cand-001'));
    expect(screen.getByTestId('candidate-details-panel-cand-001')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('show-details-cand-002'));
    expect(screen.getByTestId('candidate-details-panel-cand-002')).toBeInTheDocument();
    // First row's panel must be gone.
    expect(screen.queryByTestId('candidate-details-panel-cand-001')).not.toBeInTheDocument();
    // First row's button label resets to "Show Details".
    expect(screen.getByTestId('show-details-cand-001')).toHaveTextContent('Show Details');
  });

  // (f) The expanded panel does NOT contain the candidate name, tier, type
  // label, confidence, review status, or synthesized timestamp.
  it('does not repeat row-level summary fields inside the expanded panel', () => {
    const candidate = makeCandidate({
      id: 'cand-001',
      name: 'UNIQUE-CANDIDATE-NAME-XYZ',
      candidate_type: 'endpoints',
      confidence: 0.9,
      review_status: 'approved',
      synthesized_at: '2026-05-10T12:34:56Z',
      data: { http_method: 'GET' },
      source_cluster_ids: ['cluster-1'],
    });
    renderTable([candidate]);

    fireEvent.click(screen.getByTestId('show-details-cand-001'));
    const panel = screen.getByTestId('candidate-details-panel-cand-001');

    // Row-level fields must NOT appear inside the panel.
    expect(panel).not.toHaveTextContent('UNIQUE-CANDIDATE-NAME-XYZ');
    // Type label "endpoints" must not be reproduced as a literal cell value.
    expect(within(panel).queryByText(/^endpoints$/)).not.toBeInTheDocument();
    // Confidence ("90%") and review status ("approved") must not appear.
    expect(panel).not.toHaveTextContent('90%');
    expect(within(panel).queryByText(/^approved$/)).not.toBeInTheDocument();
    // Synthesized timestamp string from the row above (locale-rendered) must
    // not be repeated.
    const synthesizedDisplay = new Date(candidate.synthesized_at).toLocaleString();
    expect(panel).not.toHaveTextContent(synthesizedDisplay);
    // Tier badge content (em-dash neutral or adapter tag) must not be in the
    // panel as a tier rendering.
    expect(within(panel).queryByTestId('candidate-tier-badge')).not.toBeInTheDocument();
  });

  // (g) A disabled (non-allowlisted) row never renders an expansion panel
  // even if forcibly toggled. The disabled attribute prevents the click
  // handler from firing AND the render guard double-protects.
  it('never renders an expansion panel for a disabled (non-allowlisted) row, even when forcibly clicked', () => {
    renderTable(makeMixedCandidates());

    const disabledBtn = screen.getByTestId('show-details-cand-003');
    expect(disabledBtn).toBeDisabled();

    // Force a click; native disabled buttons should ignore it, and even if
    // some UA delivered the event, the render guard ensures no panel.
    fireEvent.click(disabledBtn);

    expect(screen.queryByTestId('candidate-details-panel-cand-003')).not.toBeInTheDocument();
    // Sanity: the disabled row's toggle label stays "Show Details".
    expect(disabledBtn).toHaveTextContent('Show Details');
  });
});
