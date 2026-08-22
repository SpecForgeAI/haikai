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

  it('renders derived cards and applies answers with scope, payload and evidence hash', async () => {
    render(
      <FoundationsReviewPanel
        projectId="p1"
        architectureId="a1"
        candidates={CANDIDATES}
      />,
    );

    // backup_copy card (orders_bak vs orders) + key_posture for orders_bak
    // (keyless — no PK, no unique index).
    await screen.findByTestId('foundation-q-FQ-backup_copy');
    expect(screen.getByTestId('foundation-q-FQ-key_posture-orders_bak')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('foundations-apply'));

    await waitFor(() =>
      expect(foundationsApi.applyFoundationDecisions).toHaveBeenCalledTimes(1),
    );
    const [, , inputs] = vi.mocked(foundationsApi.applyFoundationDecisions).mock.calls[0];
    const backup = inputs.find((i) => i.rule_key === 'backup_copy')!;
    expect(backup).toMatchObject({
      answer: 'exclude_all',
      scope: 'excluded',
      target_entity_names: ['orders_bak'],
    });
    expect(backup.evidence_hash).toMatch(/^[0-9a-f]{8}$/);
    const keyless = inputs.find((i) => i.rule_key === 'key_posture')!;
    expect(keyless).toMatchObject({
      answer: 'keyless_multiset',
      payload_json: { key_policy: 'keyless_multiset' },
    });
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
    // The keyless question is still open (different rule) — panel visible.
    expect(
      container.querySelector('[data-testid="foundation-q-FQ-key_posture-orders_bak"]'),
    ).not.toBeNull();
  });
});
