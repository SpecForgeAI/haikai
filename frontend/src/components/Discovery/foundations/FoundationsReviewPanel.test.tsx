/**
 * FoundationsReviewPanel (Spec 2, 2026-08-22): renders derived question
 * cards with recommended defaults, applies answers through the gateway with
 * scope + payload + evidence hash, and refreshes to the settled state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FoundationsReviewPanel from './FoundationsReviewPanel';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import * as foundationsApi from '../../../api/foundationsApi';

vi.mock('../../../api/foundationsApi', () => ({
  listFoundationDecisions: vi.fn(),
  applyFoundationDecisions: vi.fn(),
  fetchRawModelForFoundations: vi.fn(),
}));

function cand(partial: Record<string, unknown>): DiscoveryCandidateDto {
  return partial as unknown as DiscoveryCandidateDto;
}

const CANDIDATES: DiscoveryCandidateDto[] = [
  cand({
    candidate_type: 'physical_data_entities',
    name: 'orders',
    data: { objectType: 'table', schemaName: 'dbo' },
  }),
  cand({
    candidate_type: 'physical_data_attributes',
    name: 'id',
    data: { tableName: 'orders', dataType: 'int', isNullable: false, isPrimaryKey: true },
  }),
  cand({
    candidate_type: 'physical_data_entities',
    name: 'orders_bak',
    data: { objectType: 'table', schemaName: 'dbo' },
  }),
  cand({
    candidate_type: 'physical_data_attributes',
    name: 'id',
    data: { tableName: 'orders_bak', dataType: 'int', isNullable: false },
  }),
];

describe('FoundationsReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foundationsApi.listFoundationDecisions).mockResolvedValue([]);
    vi.mocked(foundationsApi.applyFoundationDecisions).mockResolvedValue({
      entities_updated: 1,
      decisions_upserted: 2,
      skipped: [],
    });
  });

  it('a pending exclude suppresses dependent questions; flipping the answer reveals them; apply sends only visible', async () => {
    render(
      <FoundationsReviewPanel
        projectId="p1"
        architectureId="a1"
        candidates={CANDIDATES}
      />,
    );

    // backup_copy default (exclude_all) covers orders_bak — its key_posture
    // card is HIDDEN (no conflicting questions) with the honest note.
    await screen.findByTestId('foundation-q-FQ-backup_copy');
    expect(
      screen.queryByTestId('foundation-q-FQ-key_posture-orders_bak'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('foundations-hidden-note')).toBeInTheDocument();

    // Flip backup_copy to keep_all — the key question REAPPEARS.
    await userEvent.click(screen.getByLabelText(/Keep all in migration/));
    expect(
      await screen.findByTestId('foundation-q-FQ-key_posture-orders_bak'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('foundations-hidden-note')).not.toBeInTheDocument();

    // Flip back to exclude — hidden again; apply sends ONLY the visible card.
    await userEvent.click(screen.getByLabelText(/Exclude all from migration/));
    await waitFor(() =>
      expect(
        screen.queryByTestId('foundation-q-FQ-key_posture-orders_bak'),
      ).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId('foundations-apply'));
    await waitFor(() =>
      expect(foundationsApi.applyFoundationDecisions).toHaveBeenCalledTimes(1),
    );
    const [, , inputs] = vi.mocked(foundationsApi.applyFoundationDecisions).mock.calls[0];
    expect(inputs.map((i) => i.rule_key)).toEqual(['backup_copy']);
    expect(inputs[0]).toMatchObject({
      answer: 'exclude_all',
      scope: 'excluded',
      target_entity_names: ['orders_bak'],
    });
    expect(inputs[0].evidence_hash).toMatch(/^[0-9a-f]{8}$/);
    await screen.findByTestId('foundations-apply-note');
  });

  it('a settled question (decision with matching evidence) does not render', async () => {
    // First render to LEARN the evidence hash the rule computes.
    render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={CANDIDATES} />,
    );
    await screen.findByTestId('foundation-q-FQ-backup_copy');
    await userEvent.click(screen.getByTestId('foundations-apply'));
    await waitFor(() =>
      expect(foundationsApi.applyFoundationDecisions).toHaveBeenCalled(),
    );
    const [, , inputs] = vi.mocked(foundationsApi.applyFoundationDecisions).mock.calls[0];
    const backup = inputs.find((i) => i.rule_key === 'backup_copy')!;

    vi.mocked(foundationsApi.listFoundationDecisions).mockResolvedValue([
      {
        id: 'fd-1',
        project_id: 'p1',
        architecture_id: 'a1',
        decision_key: backup.decision_key,
        rule_key: 'backup_copy',
        question_text: null,
        answer: 'exclude_all',
        scope: 'excluded',
        targets_json: [{ entity_name: 'orders_bak' }],
        payload_json: null,
        rationale: null,
        evidence_hash: backup.evidence_hash ?? null,
        stale: false,
        decided_at: null,
        created_at: null,
        updated_at: null,
      },
    ]);

    const { container } = render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={CANDIDATES} />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="foundation-q-FQ-backup_copy"]'),
      ).toBeNull(),
    );
    // Derive-time suppression: the STORED excluded decision covers
    // orders_bak, so its key question never derives either — all settled.
    expect(
      container.querySelector('[data-testid="foundation-q-FQ-key_posture-orders_bak"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="foundations-all-settled"]'),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Partial-exclusion remainder (2026-08-22 user ruling): deselecting tables
// from an exclude/volatile answer MEANS keeping them — one apply settles the
// WHOLE set and the residual question never re-poses.
// ---------------------------------------------------------------------------

const TEMP_CANDIDATES: DiscoveryCandidateDto[] = [
  cand({
    candidate_type: 'physical_data_entities',
    name: 'temp_alpha',
    data: { objectType: 'table', schemaName: 'dbo' },
  }),
  cand({
    candidate_type: 'physical_data_attributes',
    name: 'a',
    data: { tableName: 'temp_alpha', dataType: 'int', isNullable: false, isPrimaryKey: true },
  }),
  cand({
    candidate_type: 'physical_data_entities',
    name: 'temp_beta',
    data: { objectType: 'table', schemaName: 'dbo' },
  }),
  cand({
    candidate_type: 'physical_data_attributes',
    name: 'b',
    data: { tableName: 'temp_beta', dataType: 'int', isNullable: false, isPrimaryKey: true },
  }),
];

describe('partial exclusion decides the remainder (one apply, no residual question)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foundationsApi.listFoundationDecisions).mockResolvedValue([]);
    vi.mocked(foundationsApi.applyFoundationDecisions).mockResolvedValue({
      entities_updated: 0,
      decisions_upserted: 2,
      skipped: [],
    });
  });

  it('sends the volatile decision for the selected set AND a keep decision for the rest, whose hash settles the residual question', async () => {
    render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={TEMP_CANDIDATES} />,
    );
    await screen.findByTestId('foundation-q-FQ-temp_working');

    // Deselect temp_beta from the volatile answer (keep it).
    await userEvent.click(screen.getByText('2 of 2 table(s) selected'));
    await userEvent.click(screen.getByRole('checkbox', { name: /temp_beta/ }));
    await userEvent.click(screen.getByTestId('foundations-apply'));

    await waitFor(() =>
      expect(foundationsApi.applyFoundationDecisions).toHaveBeenCalledTimes(1),
    );
    const [, , inputs] = vi.mocked(foundationsApi.applyFoundationDecisions).mock.calls[0];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      rule_key: 'temp_working',
      answer: 'mark_volatile',
      scope: 'volatile',
      target_entity_names: ['temp_alpha'],
    });
    expect(inputs[1]).toMatchObject({
      rule_key: 'temp_working',
      answer: 'keep_all',
      scope: 'in_scope',
      target_entity_names: ['temp_beta'],
    });

    // Store both decisions and re-render: temp_alpha is scoped out, the
    // residual (temp_beta) question is SETTLED by the keep decision's hash
    // — nothing re-poses.
    vi.mocked(foundationsApi.listFoundationDecisions).mockResolvedValue(
      inputs.map((i, n) => ({
        id: `fd-${n}`,
        project_id: 'p1',
        architecture_id: 'a1',
        decision_key: i.decision_key,
        rule_key: i.rule_key,
        question_text: null,
        answer: i.answer,
        scope: i.scope ?? null,
        targets_json: i.target_entity_names.map((name) => ({ entity_name: name })),
        payload_json: null,
        rationale: null,
        evidence_hash: i.evidence_hash ?? null,
        stale: false,
        decided_at: null,
        created_at: null,
        updated_at: null,
      })),
    );
    const { container } = render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={TEMP_CANDIDATES} />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="foundations-all-settled"]'),
      ).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-testid="foundation-q-FQ-temp_working"]'),
    ).toBeNull();
  });
});

describe('stale reopen preselects the PREVIOUS answer (2026-08-22 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foundationsApi.applyFoundationDecisions).mockResolvedValue({
      entities_updated: 1,
      decisions_upserted: 1,
      skipped: [],
    });
  });

  it('a keep_all decision reopening stale shows keep_all selected, not the recommended exclude', async () => {
    vi.mocked(foundationsApi.listFoundationDecisions).mockResolvedValue([
      {
        decision_key: 'F-7',
        rule_key: 'backup_copy',
        answer: 'keep_all',
        scope: 'in_scope',
        targets_json: [{ entity_name: 'orders_bak' }],
        evidence_hash: 'pre-save-order-hash',
        stale: false,
      } as never,
    ]);
    render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={CANDIDATES} />,
    );

    await screen.findByTestId('foundation-q-FQ-backup_copy');
    expect(screen.getByText(/previously F-7: keep_all/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Keep all in migration/) as HTMLInputElement).checked).toBe(
      true,
    );
    // With keep_all honored there is NO pending exclusion — the dependent
    // key-posture card must be VISIBLE (the default-exclude preselect used
    // to hide it and silently flip scope on re-apply).
    expect(
      screen.getByTestId('foundation-q-FQ-key_posture-orders_bak'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('foundations-hidden-note')).not.toBeInTheDocument();
  });
});

describe('code mode gates joint questions on committed code evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foundationsApi.listFoundationDecisions).mockResolvedValue([]);
  });

  it('a model with NO endpoints/effects shows the pending note and NO crud_never card', async () => {
    vi.mocked(foundationsApi.fetchRawModelForFoundations).mockResolvedValue({
      metaModel: {
        entities: { physical_data_entities: [{ id: 'e1', name: 'orders' }] },
        relationships: { endpoint_data_effects: [] },
      },
    } as never);
    render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={[]} mode="code" />,
    );
    expect(await screen.findByTestId('foundations-joint-pending-note')).toBeInTheDocument();
    expect(screen.queryByTestId('foundation-q-FQ-crud_never')).not.toBeInTheDocument();
  });

  it('once the model carries code evidence the joint questions derive normally', async () => {
    vi.mocked(foundationsApi.fetchRawModelForFoundations).mockResolvedValue({
      metaModel: {
        entities: {
          physical_data_entities: [{ id: 'e1', name: 'orders' }],
          endpoints: [{ id: 'ep1' }],
        },
        relationships: { endpoint_data_effects: [] },
      },
    } as never);
    render(
      <FoundationsReviewPanel projectId="p1" architectureId="a1" candidates={[]} mode="code" />,
    );
    expect(await screen.findByTestId('foundation-q-FQ-crud_never')).toBeInTheDocument();
    expect(screen.queryByTestId('foundations-joint-pending-note')).not.toBeInTheDocument();
  });
});
