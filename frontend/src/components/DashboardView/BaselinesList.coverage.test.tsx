/**
 * BaselinesList -- read-only coverage figure + override note tests
 *
 * Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 4 (4.1g)
 *
 * Coverage: the baseline surface shows the coverage figure fetched
 * READ-ONLY via `reconcile-inventory` with `refresh_findings: false`
 * against the baseline's source `session_id`, plus the override note when
 * the source session carries one -- WITHOUT altering the Activate control
 * (informational only; Activate never re-blocks per D3).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockListBaselines = vi.fn();
const mockUpdateBaseline = vi.fn();
const mockReconcileInventory = vi.fn();
const mockGetCaptureSession = vi.fn();

vi.mock('../../api/apiBehaviourClient', () => ({
  listBaselines: (...a: unknown[]) => mockListBaselines(...a),
  updateBaseline: (...a: unknown[]) => mockUpdateBaseline(...a),
  reconcileInventory: (...a: unknown[]) => mockReconcileInventory(...a),
  getCaptureSession: (...a: unknown[]) => mockGetCaptureSession(...a),
}));

import { BaselinesList } from './BaselinesList';

const PROJECT_ID = 'proj-base-cov';
const ARCH_ID = 'arch-base-cov';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BaselinesList -- baseline coverage display (Task 4.1g)', () => {
  it('fetches coverage read-only (refresh_findings:false), renders both figures + the override note, and leaves Activate untouched', async () => {
    mockListBaselines.mockResolvedValue([
      {
        id: 'b-1',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        session_id: 'sess-1',
        name: 'Baseline b-1',
        status: 'draft',
        accepted_capture_count: 3,
        operation_count: 3,
        notes: null,
        created_at: '2026-06-11T12:00:00Z',
        updated_at: '2026-06-11T12:00:00Z',
      },
    ]);
    mockReconcileInventory.mockResolvedValue({
      in_scope_unaccounted_endpoints: [],
      operations_without_model_endpoint: [],
      excluded_by_scope_endpoints: [],
      in_scope_coverage_pct: 80,
      in_scope_accounted_count: 4,
      in_scope_total_count: 5,
      architecture_coverage_pct: 60,
      architecture_accounted_count: 4,
      architecture_total_count: 6,
    });
    mockGetCaptureSession.mockResolvedValue({
      id: 'sess-1',
      status: 'completed',
      coverage_override_justification: 'Decommissioned endpoints accepted',
      coverage_override_unaccounted_count: 1,
      coverage_override_at: '2026-06-11T09:30:00Z',
    });

    render(
      <BaselinesList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelect={vi.fn()} />,
    );

    // The coverage note renders both figures + the override marker.
    const coverage = await screen.findByTestId('baseline-coverage-b-1');
    expect(coverage).toHaveTextContent('Coverage: 80% in scope');
    expect(coverage).toHaveTextContent('60% architecture');
    expect(coverage).toHaveTextContent('started with coverage override');

    // Display-only fetch: refresh_findings MUST be false (never writes
    // reconciliation findings from a render).
    expect(mockReconcileInventory).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, 'sess-1', {
      refresh_findings: false,
    });

    // The Activate control is untouched -- informational only (D3): the
    // draft row still offers Activate and it is enabled.
    const activate = screen.getByTestId('baseline-status-action-b-1') as HTMLButtonElement;
    expect(activate).toHaveTextContent('Activate');
    expect(activate).not.toBeDisabled();
    // No status PATCH was issued by the coverage display itself.
    expect(mockUpdateBaseline).not.toHaveBeenCalled();
  });
});
