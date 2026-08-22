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
