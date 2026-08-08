/**
 * Gap-proposal queue tests (Spec 4 — LLM gap-proposal queue, 2026-08-04).
 *
 * Driven through DbMigrationPackStructuralFindingsPanel (the "Draft proposals
 * with AI" entry point) with the api module mocked. Focused coverage only:
 *   (1) generate renders the queue rows with human payload summaries plus the
 *       honest dropped-draft warnings;
 *   (2) approve fires the review call WITH architecture_id and renders the
 *       post-approve regenerate reminder + the honest apply-skip note;
 *   (3) an unsupported finding kind renders unsupportedReason inline;
 *   (4) manual add answering 400 renders the validation warnings inline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-gap-1';
const PACK_ID = 'pack-gap-1';
const ARCH_ID = 'arch-gap-1';

vi.mock('../DbMigrationPack.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

const mockListFindings = vi.fn();
const mockGenerate = vi.fn();
const mockListProposals = vi.fn();
const mockReview = vi.fn();
const mockManual = vi.fn();

vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPackStructuralFindings: (...args: unknown[]) =>
      mockListFindings(...args),
    generateGapProposals: (...args: unknown[]) => mockGenerate(...args),
    listGapProposals: (...args: unknown[]) => mockListProposals(...args),
    reviewGapProposal: (...args: unknown[]) => mockReview(...args),
    addManualGapProposal: (...args: unknown[]) => mockManual(...args),
  };
});

import DbMigrationPackStructuralFindingsPanel from '../DbMigrationPackStructuralFindingsPanel';
import {
  DbGapProposalValidationError,
  type DbGapProposalRow,
  type DbMigrationPackStructuralFinding,
} from '../../../../api/dbMigrationPackApi';

const FK_FINDING: DbMigrationPackStructuralFinding = {
  key: 'relationships_without_fk_columns:all_relationships',
  kind: 'relationships_without_fk_columns',
  subject: 'all_relationships',
  message: 'Relationships carry no fk_columns join metadata.',
  disposition: null,
  note: null,
  open: true,
};

const PK_FINDING: DbMigrationPackStructuralFinding = {
  key: 'no_primary_keys:all_tables',
  kind: 'no_primary_keys',
  subject: 'all_tables',
  message: 'No primary keys captured across any table.',
  disposition: null,
  note: null,
  open: true,
};

const CONSTRAINTS_FINDING: DbMigrationPackStructuralFinding = {
  key: 'constraints_metadata_absent:all_tables',
  kind: 'constraints_metadata_absent',
  subject: 'all_tables',
  message: 'No check/unique constraint metadata captured.',
  disposition: null,
  note: null,
  open: true,
};

const FK_ROW: DbGapProposalRow = {
  id: 'gp-fk-1',
  proposal_key: 'fk--rel-1',
  finding_key: FK_FINDING.key,
  kind: 'fk_join',
  payload_json: {
    relationship_id: 'rel-1',
    from_table: 'orders',
    join_columns: ['customer_id'],
    to_table: 'customers',
    referenced_columns: ['id'],
  },
  rationale: 'customer_id matches the customers identity column.',
  confidence: 'high',
  origin: 'llm',
  review_status: 'unreviewed',
  reviewer_notes: null,
  applied_at: null,
  created_at: '2026-08-04T00:00:00Z',
};

const PK_ROW: DbGapProposalRow = {
  id: 'gp-pk-1',
  proposal_key: 'pk--orders',
  finding_key: FK_FINDING.key,
  kind: 'primary_key',
  payload_json: { table: 'orders', entity_id: 'ent-orders', columns: ['order_id'] },
  rationale: 'order_id is the identity column.',
  confidence: 'medium',
  origin: 'manual',
  review_status: 'unreviewed',
  reviewer_notes: null,
  applied_at: null,
  created_at: '2026-08-04T00:00:00Z',
};

function renderPanel() {
  return render(
    <DbMigrationPackStructuralFindingsPanel
      projectId={PROJECT_ID}
      packId={PACK_ID}
      architectureId={ARCH_ID}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DbMigrationPack gap proposals (Spec 4)', () => {
  it('Draft proposals with AI: generates, then renders queue rows with payload summaries + honest warnings', async () => {
    mockListFindings.mockResolvedValue({ findings: [FK_FINDING] });
    mockGenerate.mockResolvedValue({
      supported: true,
      proposals: [
        {
          proposal_key: FK_ROW.proposal_key,
          finding_key: FK_ROW.finding_key,
          kind: FK_ROW.kind,
          payload_json: FK_ROW.payload_json,
          rationale: FK_ROW.rationale,
          confidence: FK_ROW.confidence,
        },
      ],
      warnings: [
        'dropped fk proposal for rel-9: hallucinated column(s) ghost_col',
      ],
    });
    mockListProposals.mockResolvedValue([FK_ROW, PK_ROW]);
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(`db-gap-proposals-draft-${FK_FINDING.key}`),
    );

    await waitFor(() =>
      expect(mockGenerate).toHaveBeenCalledWith(PROJECT_ID, {
        architecture_id: ARCH_ID,
        finding_kind: 'relationships_without_fk_columns',
        finding_key: FK_FINDING.key,
      }),
    );
    // The queue is refetched for THIS finding key after generation.
    await waitFor(() =>
      expect(mockListProposals).toHaveBeenCalledWith(PROJECT_ID, FK_FINDING.key),
    );

    // Human payload summaries: fk arrow form + pk PK() form.
    expect(
      await screen.findByTestId(`db-gap-proposal-summary-${FK_ROW.id}`),
    ).toHaveTextContent('orders.customer_id → customers.id');
    expect(
      screen.getByTestId(`db-gap-proposal-summary-${PK_ROW.id}`),
    ).toHaveTextContent('orders: PK(order_id)');

    // Origin chips: AI vs Manual.
    expect(
      screen.getByTestId(`db-gap-proposal-origin-${FK_ROW.id}`),
    ).toHaveTextContent('AI');
    expect(
      screen.getByTestId(`db-gap-proposal-origin-${PK_ROW.id}`),
    ).toHaveTextContent('Manual');

    // Honest dropped-draft warnings from generation.
    expect(
      screen.getByTestId(`db-gap-proposals-warnings-${FK_FINDING.key}`),
    ).toHaveTextContent(
      'dropped fk proposal for rel-9: hallucinated column(s) ghost_col',
    );
  });

  it('Approve fires review with architecture_id and renders the regenerate reminder + the honest skip note', async () => {
    mockListFindings.mockResolvedValue({ findings: [FK_FINDING] });
    mockGenerate.mockResolvedValue({ supported: true, proposals: [], warnings: [] });
    mockListProposals.mockResolvedValue([FK_ROW]);
    mockReview.mockResolvedValue({
      review_status: 'approved',
      apply: {
        applied: 0,
        skipped: [
          {
            delta: {},
            reason:
              'fk_columns already populated on relationship rel-1 — left untouched',
          },
        ],
      },
      applied_at: null,
    });
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(`db-gap-proposals-draft-${FK_FINDING.key}`),
    );
    fireEvent.click(
      await screen.findByTestId(`db-gap-proposal-approve-${FK_ROW.id}`),
    );

    await waitFor(() =>
      expect(mockReview).toHaveBeenCalledWith(PROJECT_ID, FK_ROW.id, {
        action: 'approve',
        architecture_id: ARCH_ID,
      }),
    );

    // Post-approve reminder: findings only clear on pack regeneration.
    expect(
      await screen.findByTestId(
        `db-gap-proposals-regenerate-reminder-${FK_FINDING.key}`,
      ),
    ).toHaveTextContent(
      'Approved metadata is written to the model — Regenerate the pack to clear the finding.',
    );
    // The honest apply-skip note rides through verbatim.
    expect(
      screen.getByTestId(`db-gap-proposals-apply-note-${FK_FINDING.key}`),
    ).toHaveTextContent(
      'Apply skipped: fk_columns already populated on relationship rel-1 — left untouched',
    );
  });

  it('renders unsupportedReason inline when generation is not supported for the finding kind', async () => {
    mockListFindings.mockResolvedValue({ findings: [CONSTRAINTS_FINDING] });
    mockGenerate.mockResolvedValue({
      supported: false,
      unsupportedReason:
        'Constraint metadata cannot be inferred from names — harvest from the source DB or accept the finding instead.',
      proposals: [],
      warnings: [],
    });
    mockListProposals.mockResolvedValue([]);
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(
        `db-gap-proposals-draft-${CONSTRAINTS_FINDING.key}`,
      ),
    );

    expect(
      await screen.findByTestId(
        `db-gap-proposals-unsupported-${CONSTRAINTS_FINDING.key}`,
      ),
    ).toHaveTextContent('Constraint metadata cannot be inferred from names');
  });

  it('manual add answering 400 renders the validation warnings inline', async () => {
    mockListFindings.mockResolvedValue({ findings: [PK_FINDING] });
    mockGenerate.mockResolvedValue({ supported: true, proposals: [], warnings: [] });
    mockListProposals.mockResolvedValue([]);
    mockManual.mockRejectedValue(
      new DbGapProposalValidationError(
        'payload_json failed validation against the committed model.',
        ['dropped pk proposal for orders: hallucinated column(s) ghost_col'],
      ),
    );
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(`db-gap-proposals-draft-${PK_FINDING.key}`),
    );
    fireEvent.click(
      await screen.findByTestId(
        `db-gap-proposals-manual-open-${PK_FINDING.key}`,
      ),
    );

    // pk finding defaults the kind selector to primary_key -> table + columns.
    fireEvent.change(
      screen.getByTestId(`db-gap-proposals-manual-table-${PK_FINDING.key}`),
      { target: { value: 'orders' } },
    );
    fireEvent.change(
      screen.getByTestId(`db-gap-proposals-manual-columns-${PK_FINDING.key}`),
      { target: { value: 'ghost_col' } },
    );
    fireEvent.click(
      screen.getByTestId(`db-gap-proposals-manual-add-${PK_FINDING.key}`),
    );

    await waitFor(() =>
      expect(mockManual).toHaveBeenCalledWith(PROJECT_ID, {
        architecture_id: ARCH_ID,
        finding_key: PK_FINDING.key,
        kind: 'primary_key',
        payload_json: { table: 'orders', columns: ['ghost_col'] },
      }),
    );
    expect(
      await screen.findByTestId(
        `db-gap-proposals-manual-error-${PK_FINDING.key}`,
      ),
    ).toHaveTextContent('payload_json failed validation');
    expect(
      screen.getByTestId(`db-gap-proposals-manual-warnings-${PK_FINDING.key}`),
    ).toHaveTextContent(
      'dropped pk proposal for orders: hallucinated column(s) ghost_col',
    );
  });
  it('Approve all (2026-08-08): approves every UNREVIEWED proposal sequentially; approved/needs-rework rows untouched', async () => {
    const reworkRow: DbGapProposalRow = {
      ...PK_ROW,
      id: 'gp-rework-1',
      proposal_key: 'pk--lines',
      review_status: 'needs_rework',
      reviewer_notes: 'wrong column',
    };
    const approvedRow: DbGapProposalRow = {
      ...PK_ROW,
      id: 'gp-done-1',
      proposal_key: 'pk--done',
      review_status: 'approved',
      applied_at: '2026-08-08T10:00:00Z',
    };
    mockListFindings.mockResolvedValue({ findings: [FK_FINDING] });
    mockListProposals.mockResolvedValue([FK_ROW, PK_ROW, reworkRow, approvedRow]);
    mockGenerate.mockResolvedValue({ supported: true, proposals: [], warnings: [] });
    mockReview.mockResolvedValue({ review_status: 'approved', apply: { applied: 1, skipped: [] } });
    renderPanel();

    fireEvent.click(
      await screen.findByTestId(`db-gap-proposals-draft-${FK_FINDING.key}`),
    );

    const button = await screen.findByTestId(
      `db-gap-proposals-approve-all-${FK_FINDING.key}`,
    );
    expect(button.textContent).toContain('Approve all (2)');
    fireEvent.click(button);

    await waitFor(() => expect(mockReview).toHaveBeenCalledTimes(2));
    // Only the two UNREVIEWED rows were approved, in list order.
    expect(mockReview.mock.calls.map((c) => c[1])).toEqual([FK_ROW.id, PK_ROW.id]);
    for (const call of mockReview.mock.calls) {
      expect(call[2]).toMatchObject({ action: 'approve', architecture_id: ARCH_ID });
    }
    // The regenerate reminder renders after a bulk approve like a single one.
    expect(
      await screen.findByTestId(`db-gap-proposals-regenerate-reminder-${FK_FINDING.key}`),
    ).toBeInTheDocument();
  });
});

