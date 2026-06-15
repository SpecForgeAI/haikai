/**
 * Model-Aware Discovery (Spec 2026-05-30) -- Task Group 5.1
 *
 * Focused tests for the per-row OPERATION badge + resolved target name in the
 * EXISTING Candidates stream, and the resolved-target + what-is-added block in
 * the details panel. The operation surfaces interleaved in the existing stream
 * (NO separate section); the badge text is:
 *   - create -> "Create new" (the default; absence of `operation` is tolerated)
 *   - enrich -> "Enrich existing <target>"
 *   - link   -> "Link <logical>↔<physical>"
 *
 * The resolved target NAME(s) + what-is-added ride on the candidate `data`
 * payload (carried from discovery, resolved late at save-back) and are read
 * defensively, mirroring the save-back reader key order in
 * `mcp-server/src/services/candidateSaveBackService.ts`:
 *   - enrich target:   data.targetEntityName (-> ... -> data.target)
 *   - link endpoints:  data.logicalEntityName / data.physicalEntityName
 *   - enrich addition: data.attributeName / data.dataType, data.relatedEntityName
 *
 * Test (d) drives `<CandidateDetailsPanel>` directly: its operation block is
 * gated on `candidate.operation` (NOT candidate_type), so no table-level
 * allowlist mocking is needed.
 *
 * Mocks mirror `discoveryCandidateTableCommitted.test.tsx` to keep the suite
 * shape consistent across the table's tests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { CandidateDetailsPanel } from '../CandidateDetailsPanel';

// ============================================================================
// Mock setup
// ============================================================================

vi.mock('../../../api/discoveryApi', () => ({
  reviewCandidate: vi.fn(),
  bulkReviewCandidates: vi.fn(),
  // Spec 1 (2026-06-02) Group 6: the table fetches the review-model backbone on
  // mount. These operation-badge tests don't exercise counts, so the backbone
  // fetch is mocked to REJECT and the grid falls back to the local derivation.
  getReviewModel: vi.fn().mockRejectedValue(new Error('not under test')),
}));

// CSS-module identity mocks so className assertions are predictable and the
// components mount without a real CSS pipeline.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../TierBadge.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
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
// Fixtures
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-001',
    run_id: 'run-1',
    candidate_type: 'logical_data_entities',
    name: 'Owner',
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
    ...overrides,
  };
}

// ============================================================================
// Lazy import after mocks
// ============================================================================

let DiscoveryCandidateTable: React.FC<{
  projectId: string;
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
  lastSaveTimestamp?: number;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = mod.DiscoveryCandidateTable;
});

// ============================================================================
// Row-level operation badge tests
// ============================================================================

describe('DiscoveryCandidateTable -- operation badge + target name (Spec 2026-05-30 TG5.3)', () => {
  // --------------------------------------------------------------------------
  // (a) create row shows the default "Create new" treatment. Absence of
  //     `operation` on the wire is tolerated as create.
  // --------------------------------------------------------------------------
  it('(a) a create row (operation absent) shows the default "Create new" badge', () => {
    const candidates = [
      // No `operation` field at all -> default-tolerated as create.
      makeCandidate({ id: 'cand-create', name: 'Owner', candidate_type: 'application' }),
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

    const badge = screen.getByTestId('candidate-operation-badge-cand-create');
    expect(badge).toHaveTextContent('Create new');
    // The neutral (grey) variant is used for create.
    expect(badge).toHaveAttribute('data-variant', 'neutral');
  });

  // --------------------------------------------------------------------------
  // (b) enrich row shows the operation badge + target name. The target NAME
  //     rides on data.targetEntityName.
  // --------------------------------------------------------------------------
  it('(b) an enrich row shows "Enrich existing <target>" with the target name from data', () => {
    const candidates = [
      makeCandidate({
        id: 'cand-enrich',
        name: 'Owner.telephone',
        candidate_type: 'logical_data_attributes',
        operation: 'enrich',
        data: {
          targetEntityName: 'Owner',
          attributeName: 'telephone',
          dataType: 'VARCHAR',
        },
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

    const badge = screen.getByTestId('candidate-operation-badge-cand-enrich');
    expect(badge).toHaveTextContent('Enrich existing Owner');
    expect(badge).not.toHaveTextContent('Create new');
  });

  // --------------------------------------------------------------------------
  // (c) link row shows "Link Owner↔owners" with BOTH endpoint NAMES from data.
  // --------------------------------------------------------------------------
  it('(c) a link row shows "Link Owner↔owners" from both endpoint names on data', () => {
    const candidates = [
      makeCandidate({
        id: 'cand-link',
        name: 'Owner <-> owners',
        candidate_type: 'logical_data_entities',
        operation: 'link',
        data: {
          logicalEntityName: 'Owner',
          physicalEntityName: 'owners',
        },
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

    const badge = screen.getByTestId('candidate-operation-badge-cand-link');
    expect(badge).toHaveTextContent('Link Owner↔owners');
  });

  // --------------------------------------------------------------------------
  // Interleaving guard: create / enrich / link rows all render in the SAME
  // existing candidate stream (NO separate section). Three rows, three badges.
  // --------------------------------------------------------------------------
  it('renders create / enrich / link rows interleaved in the existing stream (no separate section)', () => {
    const candidates = [
      makeCandidate({ id: 'cand-create', name: 'PaymentService', candidate_type: 'service' }),
      makeCandidate({
        id: 'cand-enrich',
        name: 'Owner.telephone',
        candidate_type: 'logical_data_attributes',
        operation: 'enrich',
        data: { targetEntityName: 'Owner', attributeName: 'telephone' },
      }),
      makeCandidate({
        id: 'cand-link',
        name: 'Owner <-> owners',
        operation: 'link',
        data: { logicalEntityName: 'Owner', physicalEntityName: 'owners' },
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

    // All three candidate rows render in the one table body.
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(3);
    expect(screen.getByTestId('candidate-operation-badge-cand-create')).toHaveTextContent(
      'Create new'
    );
    expect(screen.getByTestId('candidate-operation-badge-cand-enrich')).toHaveTextContent(
      'Enrich existing Owner'
    );
    expect(screen.getByTestId('candidate-operation-badge-cand-link')).toHaveTextContent(
      'Link Owner↔owners'
    );
  });
});

// ============================================================================
// Details-panel operation-target block tests
// ============================================================================

describe('CandidateDetailsPanel -- resolved target + what-is-added (Spec 2026-05-30 TG5.4)', () => {
  // --------------------------------------------------------------------------
  // (d.1) enrich candidate: the panel renders the resolved target entity AND
  //       exactly what is being added (attribute name + data type).
  // --------------------------------------------------------------------------
  it('(d) renders the resolved target + the attribute being added for an enrich candidate', () => {
    const candidate = makeCandidate({
      id: 'cand-enrich-details',
      name: 'Owner.telephone',
      candidate_type: 'logical_data_attributes',
      operation: 'enrich',
      data: {
        targetEntityName: 'Owner',
        attributeName: 'telephone',
        dataType: 'VARCHAR',
      },
    });

    render(<CandidateDetailsPanel candidate={candidate} />);

    const block = screen.getByTestId('operation-target-block-cand-enrich-details');
    expect(within(block).getByTestId('operation-target-entity-cand-enrich-details')).toHaveTextContent(
      'Target entity: Owner'
    );
    expect(
      within(block).getByTestId('operation-enrich-attribute-cand-enrich-details')
    ).toHaveTextContent('Adds attribute: telephone (VARCHAR)');
  });

  // --------------------------------------------------------------------------
  // (d.2) link candidate: the panel renders BOTH endpoints of the
  //       logical<->physical mapping.
  // --------------------------------------------------------------------------
  it('(d) renders both endpoints of the logical↔physical mapping for a link candidate', () => {
    const candidate = makeCandidate({
      id: 'cand-link-details',
      name: 'Owner <-> owners',
      candidate_type: 'logical_data_entities',
      operation: 'link',
      data: {
        logicalEntityName: 'Owner',
        physicalEntityName: 'owners',
      },
    });

    render(<CandidateDetailsPanel candidate={candidate} />);

    const block = screen.getByTestId('operation-target-block-cand-link-details');
    expect(within(block).getByTestId('operation-target-logical-cand-link-details')).toHaveTextContent(
      'Logical entity: Owner'
    );
    expect(
      within(block).getByTestId('operation-target-physical-cand-link-details')
    ).toHaveTextContent('Physical entity: owners');
  });

  // --------------------------------------------------------------------------
  // create candidate: NO operation-target block (purely additive for
  // enrich/link). Guards against the block leaking onto the default path.
  // --------------------------------------------------------------------------
  it('renders NO operation-target block for a create candidate', () => {
    const candidate = makeCandidate({
      id: 'cand-create-details',
      candidate_type: 'endpoints',
      name: 'GET /owners',
      // No `operation` -> create.
      data: { _addedBy: 'spring-boot-adapter', httpMethod: 'GET', fullPath: '/owners' },
    });

    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(
      screen.queryByTestId('operation-target-block-cand-create-details')
    ).not.toBeInTheDocument();
  });
});
