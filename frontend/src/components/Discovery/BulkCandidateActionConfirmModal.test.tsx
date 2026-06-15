/**
 * BulkCandidateActionConfirmModal tests
 *
 * Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression (Spec 2) --
 * Task Group 5.1. The modal is a THIN renderer over the deterministic
 * `resolveBulkActionSet` output (the Spec 1 blast-radius the grid already
 * fetched). These tests pin the load-bearing behaviours:
 *
 *   1. It renders the cascade PREVIEW: net counts (candidates + linked findings,
 *      with the whole-run "of N" context), the seed selection, the dependents
 *      pulled in BY CASCADE with their EDGE PROVENANCE, and the linked findings.
 *   2. Deselecting a cascaded dependent / a linked finding removes it from the
 *      curated set Confirm posts (seeds are NOT deselectable).
 *   3. Confirm posts ONLY the curated ids (after a deselect), plus the trimmed
 *      reviewer note when non-empty.
 *
 * The resolved set is produced by the REAL frontend `resolveBulkActionSet`
 * mirror so the test also exercises the contract-guarded shared logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./BulkCandidateActionConfirmModal.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { BulkCandidateActionConfirmModal } from './BulkCandidateActionConfirmModal';
import { resolveBulkActionSet } from './resolveBulkActionSet';
import type { ReviewModel } from '../../api/discoveryApi';

// ---------------------------------------------------------------------------
// Fixture: seed --parent_child--> depA --endpoint_data_effects--> depB
//   f-seed links [seed]; f-depB links [depB]
// ---------------------------------------------------------------------------

function buildModel(): ReviewModel {
  return {
    nodes: [],
    aggregations: {
      total_candidates: 10,
      total_findings: 4,
      committed_count: 0,
      actionable_count: 10,
      live_conflict_count: 0,
    },
    blast_radius: [
      {
        candidate_id: 'seed',
        dependents: [
          {
            dependent_id: 'depA',
            via_edge_kind: 'parent_child',
            via_predecessor_id: 'seed',
          },
        ],
        would_be_orphaned_parent_ids: [],
      },
      {
        candidate_id: 'depA',
        dependents: [
          {
            dependent_id: 'depB',
            via_edge_kind: 'endpoint_data_effects',
            via_predecessor_id: 'depA',
          },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'depB', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    findings: [
      { id: 'f-seed', candidate_link_ids: ['seed'], title: 'Seed finding' },
      { id: 'f-depB', candidate_link_ids: ['depB'], title: 'DepB finding' },
    ],
  };
}

const NAMES: Record<string, string> = {
  seed: 'Seed Candidate',
  depA: 'Dependent A',
  depB: 'Dependent B',
};
const TITLES: Record<string, string> = {
  'f-seed': 'Seed finding',
  'f-depB': 'DepB finding',
};

function renderModal(
  opts: { onConfirm?: ReturnType<typeof vi.fn>; onClose?: ReturnType<typeof vi.fn> } = {},
) {
  const onConfirm = opts.onConfirm ?? vi.fn();
  const onClose = opts.onClose ?? vi.fn();
  const actionSet = resolveBulkActionSet(
    { seedCandidateIds: ['seed'], action: 'rejected' },
    buildModel(),
  );
  render(
    <BulkCandidateActionConfirmModal
      isOpen
      actionSet={actionSet}
      candidateNamesById={NAMES}
      findingTitlesById={TITLES}
      inFlight={false}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onClose, actionSet };
}

describe('BulkCandidateActionConfirmModal (Spec 2 Group 5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the cascade preview: net counts, cascade-pulled items + edge provenance, linked findings', () => {
    renderModal();

    // Title reflects the curated candidate count (seed + depA + depB = 3) and
    // the chosen disposition.
    expect(screen.getByTestId('bulk-candidate-confirm-title')).toHaveTextContent(
      /Mark 3 candidates as Rejected\?/,
    );

    // Net counts: 3 candidates of 10; 2 linked findings of 4.
    expect(
      screen.getByTestId('bulk-candidate-confirm-candidate-count'),
    ).toHaveTextContent(/3 of 10 candidates/);
    expect(
      screen.getByTestId('bulk-candidate-confirm-finding-count'),
    ).toHaveTextContent(/2 of 4 linked findings/);

    // Cascade summary: 1 seed, 2 pulled in by cascade.
    expect(
      screen.getByTestId('bulk-candidate-confirm-cascade-summary'),
    ).toHaveTextContent(/1 selected/);
    expect(
      screen.getByTestId('bulk-candidate-confirm-cascade-summary'),
    ).toHaveTextContent(/2 pulled in by cascade/);

    // Seed row present (not deselectable -- no checkbox).
    expect(screen.getByTestId('bulk-candidate-seed-seed')).toBeInTheDocument();
    expect(
      screen.queryByTestId('bulk-candidate-cascaded-toggle-seed'),
    ).not.toBeInTheDocument();

    // Cascaded dependents present WITH their edge provenance.
    expect(
      screen.getByTestId('bulk-candidate-cascaded-depA'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('bulk-candidate-cascaded-provenance-depA'),
    ).toHaveTextContent(/via parent → child/);
    expect(
      screen.getByTestId('bulk-candidate-cascaded-provenance-depB'),
    ).toHaveTextContent(/via endpoint → data entity/);

    // Linked findings present.
    expect(
      screen.getByTestId('bulk-candidate-finding-f-seed'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('bulk-candidate-finding-f-depB'),
    ).toBeInTheDocument();
  });

  it('deselecting a cascaded dependent removes it (and a deselected finding) from the curated set Confirm posts', () => {
    const { onConfirm } = renderModal();

    // Deselect depB (a cascaded dependent) and f-seed (a linked finding).
    fireEvent.click(screen.getByTestId('bulk-candidate-cascaded-toggle-depB'));
    fireEvent.click(screen.getByTestId('bulk-candidate-finding-toggle-f-seed'));

    // The title's curated candidate count drops from 3 to 2.
    expect(screen.getByTestId('bulk-candidate-confirm-title')).toHaveTextContent(
      /Mark 2 candidates as Rejected\?/,
    );

    fireEvent.click(screen.getByTestId('bulk-candidate-confirm-confirm-button'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0][0];
    // seed + depA survive (depB deselected); seeds are always included.
    expect([...payload.candidateIds].sort()).toEqual(['depA', 'seed']);
    expect(payload.candidateIds).not.toContain('depB');
    // f-depB survives; f-seed deselected.
    expect(payload.findingIds).toEqual(['f-depB']);
    expect(payload.findingIds).not.toContain('f-seed');
  });

  it('Confirm forwards the full curated set + trimmed reviewer notes (only when non-empty)', () => {
    const { onConfirm } = renderModal();

    const textarea = screen.getByTestId(
      'bulk-candidate-confirm-notes-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   cascade reject note   ' } });

    fireEvent.click(screen.getByTestId('bulk-candidate-confirm-confirm-button'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0][0];
    // No deselects -> full curated set.
    expect([...payload.candidateIds].sort()).toEqual(['depA', 'depB', 'seed']);
    expect([...payload.findingIds].sort()).toEqual(['f-depB', 'f-seed']);
    // Trimmed.
    expect(payload.reviewerNotes).toBe('cascade reject note');
  });
});
