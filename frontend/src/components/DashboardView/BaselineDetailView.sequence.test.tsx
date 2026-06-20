/**
 * BaselineDetailView -- stateful-sequence rendering (Spec D, Task Group 4).
 *
 * A baseline item carrying a non-null `sequence_json` renders its ordered
 * steps (index, role badge setup/act/cleanup, method + path, expected_status)
 * and the inter-step `$N.<path>` references. A null `sequence_json` keeps
 * today's single-shot rendering entirely unchanged (no sequence block).
 *
 * Conventions mirror BaselineDetailView.integrity.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetBaseline = vi.fn();
const mockListBaselineItems = vi.fn();
const mockGetBaselineIntegrity = vi.fn();

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/apiBehaviourClient')
  >('../../api/apiBehaviourClient');
  return {
    ...actual,
    getBaseline: (...a: unknown[]) => mockGetBaseline(...a),
    listBaselineItems: (...a: unknown[]) => mockListBaselineItems(...a),
    getBaselineIntegrity: (...a: unknown[]) => mockGetBaselineIntegrity(...a),
  };
});

import { BaselineDetailView } from './BaselineDetailView';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const BASELINE_ID = 'b-seq-1';

const SEQUENCE_JSON = {
  steps: [
    {
      index: 0,
      role: 'setup',
      kind: 'http',
      request: { method: 'post', path: '/filters', query: null, headers: null, body: { name: 'x' } },
      expected_status: 201,
      response_refs: [],
    },
    {
      index: 1,
      role: 'act',
      kind: 'http',
      request: { method: 'POST', path: '/filters/submitForReview', query: null, headers: null, body: { id: '$0.id' } },
      expected_status: 200,
      response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
    },
    {
      index: 2,
      role: 'cleanup',
      kind: 'http',
      request: { method: 'DELETE', path: '/filters/$0.id', query: null, headers: null, body: null },
      expected_status: 204,
      response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
    },
  ],
  act_step_index: 1,
  cleanup_best_effort: true,
};

function baseline() {
  return {
    id: BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'sess-9',
    name: 'Sequence oracle',
    status: 'active',
    accepted_capture_count: 1,
    operation_count: 1,
    notes: null,
    created_at: '2026-06-18T12:00:00Z',
    updated_at: '2026-06-18T12:00:00Z',
    kind: 'current',
    paired_with_baseline_id: null,
    content_hash: null,
    provenance_json: null,
  };
}

function item(sequenceJson: Record<string, unknown> | null) {
  return {
    id: 'item-seq-1',
    baseline_id: BASELINE_ID,
    capture_id: 'cap-1',
    operation_id: 'op-1',
    scenario_id: 'sc-1',
    method: 'POST',
    path: '/filters/submitForReview',
    scenario_name: 'submit for review (stateful)',
    request_json: { id: 'real-id' },
    response_status: 200,
    response_json: { headers: null, body: { ok: true } },
    business_notes: null,
    volatile_paths_json: null,
    sequence_json: sequenceJson,
    created_at: '2026-06-18T12:00:00Z',
    updated_at: '2026-06-18T12:00:00Z',
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <BaselineDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        baselineId={BASELINE_ID}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBaseline.mockResolvedValue(baseline());
  mockGetBaselineIntegrity.mockResolvedValue({
    content_hash: null,
    recomputed_hash: null,
    integrity_verified: false,
  });
});

describe('BaselineDetailView -- stateful-sequence rendering (Spec D)', () => {
  it('renders the ordered steps, role badges and inter-step refs for a sequence item', async () => {
    mockListBaselineItems.mockResolvedValue([item(SEQUENCE_JSON)]);
    renderView();

    // R5: the view defaults to the compact table; switch to Full detail so the
    // per-item JSON dump + BaselineSequenceView render.
    fireEvent.click(await screen.findByTestId('baseline-detail-view-mode-full'));

    await waitFor(() =>
      expect(screen.getByTestId('baseline-detail-sequence')).toBeInTheDocument(),
    );

    // Three steps rendered in order.
    const steps = screen.getAllByTestId('baseline-detail-sequence-step');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveAttribute('data-step-role', 'setup');
    expect(steps[1]).toHaveAttribute('data-step-role', 'act');
    expect(steps[2]).toHaveAttribute('data-step-role', 'cleanup');

    // Role badges read apart (labels).
    const roleBadges = screen.getAllByTestId('baseline-detail-sequence-step-role');
    expect(roleBadges.map((b) => b.textContent)).toEqual([
      'Setup',
      'Act',
      'Cleanup',
    ]);

    // Method + path + expected status surfaced for the act step.
    expect(steps[1]).toHaveTextContent('POST');
    expect(steps[1]).toHaveTextContent('/filters/submitForReview');
    expect(steps[1]).toHaveTextContent('expects 200');

    // The inter-step $N.<path> refs are rendered.
    const refs = screen.getAllByTestId('baseline-detail-sequence-ref');
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.getAttribute('data-ref') === '$0.id')).toBe(true);
  });

  it('renders single-shot (no sequence block) when sequence_json is null', async () => {
    mockListBaselineItems.mockResolvedValue([item(null)]);
    renderView();

    // R5: switch to Full detail so the per-item dump renders.
    fireEvent.click(await screen.findByTestId('baseline-detail-view-mode-full'));

    await waitFor(() =>
      expect(screen.getByTestId('baseline-detail-item')).toBeInTheDocument(),
    );
    // The single-shot request/response detail still renders.
    expect(
      screen.getByTestId('baseline-detail-items-list'),
    ).toBeInTheDocument();
    // No sequence block at all.
    expect(
      screen.queryByTestId('baseline-detail-sequence'),
    ).not.toBeInTheDocument();
  });
});
