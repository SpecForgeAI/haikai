/**
 * PreflightModal smoke tests
 *
 * Spec 2026-05-06: Library Discovery Integration -- Task Group 7
 *
 * Tests the modal renders in the computing state, renders all sections in the
 * loaded state, and re-fetches when the "Include external libraries" toggle
 * changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreflightModal, ScanPlan } from '../PreflightModal';

// Mock CSS module so class names match the property names (identity proxy).
vi.mock('../PreflightModal.module.css', () => ({
  default: new Proxy({}, {
    get: (_t: object, prop: string | symbol) => String(prop),
  }),
}));

// ============================================================================
// Fixtures
// ============================================================================

const samplePlan: ScanPlan = {
  root: {
    kind: 'service',
    id: 'svc-1',
    name: 'OrderService',
    repo_location: 'https://github.com/example/repo.git',
    repo_subfolder: 'services/order',
    ecosystem: 'MAVEN',
  },
  internalLibrariesToScan: [
    {
      library_id: 'lib-a',
      name: 'com.example:lib-a',
      repo_subfolder: 'libs/lib-a',
      depth: 1,
      status: 'new',
    },
    {
      library_id: 'lib-b',
      name: 'com.example:lib-b',
      repo_subfolder: 'libs/lib-b',
      depth: 2,
      status: 're-scan',
    },
  ],
  externalLibrariesToRecord: [
    {
      name: 'com.fasterxml.jackson.core:jackson-databind',
      declared_coordinates: 'com.fasterxml.jackson.core:jackson-databind@2.15.3',
      scope: 'compile',
    },
  ],
  warnings: [
    {
      type: 'unresolvable-internal',
      message: 'Looks internal but missing from lookup table',
      library_name: 'com.example:mystery',
    },
  ],
};

// ============================================================================
// Tests
// ============================================================================

describe('PreflightModal (Spec 2026-05-06, Task Group 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the computing-state spinner while preflight is in flight', async () => {
    // previewFn returns a promise that never resolves during this test --
    // the spinner stays visible.
    const previewFn = vi.fn(() => new Promise<ScanPlan>(() => {}));

    render(
      <PreflightModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        rootEntity={{ kind: 'service', id: 'svc-1', name: 'OrderService' }}
        previewFn={previewFn}
      />,
    );

    // Modal mounts and shows the computing state.
    expect(screen.getByTestId('preflight-modal')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-computing')).toBeInTheDocument();
    expect(screen.getByText(/Computing scan plan/i)).toBeInTheDocument();
    // Run button is disabled while computing.
    expect(screen.getByTestId('preflight-modal-run-button')).toBeDisabled();
    // previewFn was called once with the default toggle value (true).
    expect(previewFn).toHaveBeenCalledTimes(1);
    expect(previewFn).toHaveBeenCalledWith(true);
  });

  it('renders all 4 sections when the scan plan resolves', async () => {
    const previewFn = vi.fn(async () => samplePlan);

    render(
      <PreflightModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        rootEntity={{ kind: 'service', id: 'svc-1', name: 'OrderService' }}
        previewFn={previewFn}
      />,
    );

    // Wait for the plan to resolve.
    await waitFor(() => {
      expect(screen.getByTestId('preflight-modal-root-summary')).toBeInTheDocument();
    });

    // Root summary section.
    expect(screen.getByTestId('preflight-modal-root-summary')).toHaveTextContent('OrderService');
    expect(screen.getByTestId('preflight-modal-root-summary')).toHaveTextContent('services/order');
    expect(screen.getByTestId('preflight-modal-root-summary')).toHaveTextContent('MAVEN');

    // Internal libraries to scan -- 2 rows expected.
    expect(screen.getByTestId('preflight-modal-internal-libs')).toBeInTheDocument();
    const internalRows = screen.getAllByTestId('preflight-modal-internal-lib-row');
    expect(internalRows).toHaveLength(2);
    expect(internalRows[0]).toHaveTextContent('com.example:lib-a');
    expect(internalRows[0]).toHaveTextContent('depth 1');
    expect(internalRows[0]).toHaveTextContent('new');
    expect(internalRows[1]).toHaveTextContent('re-scan');

    // External libraries to record.
    expect(screen.getByTestId('preflight-modal-external-libs')).toBeInTheDocument();
    const externalRows = screen.getAllByTestId('preflight-modal-external-lib-row');
    expect(externalRows).toHaveLength(1);
    expect(externalRows[0]).toHaveTextContent('jackson-databind');

    // Warnings panel.
    expect(screen.getByTestId('preflight-modal-warnings')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-warning-unresolvable-internal')).toBeInTheDocument();

    // Toggle is rendered and ON by default (per spec: default ON, modal-session-only).
    const toggle = screen.getByTestId('preflight-modal-toggle-include-external') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    // Run button enabled after plan loads.
    expect(screen.getByTestId('preflight-modal-run-button')).not.toBeDisabled();
  });

  it('re-runs preflight when the include-external toggle is toggled off', async () => {
    const previewFn = vi.fn(async () => samplePlan);

    render(
      <PreflightModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        rootEntity={{ kind: 'library', id: 'lib-1', name: 'sharedLib' }}
        previewFn={previewFn}
      />,
    );

    // Wait for the first call to settle.
    await waitFor(() => {
      expect(previewFn).toHaveBeenCalledTimes(1);
    });
    expect(previewFn).toHaveBeenLastCalledWith(true);

    // Flip the toggle off.
    const toggle = screen.getByTestId('preflight-modal-toggle-include-external');
    fireEvent.click(toggle);

    // The modal should re-run preflight with `false`.
    await waitFor(() => {
      expect(previewFn).toHaveBeenCalledTimes(2);
    });
    expect(previewFn).toHaveBeenLastCalledWith(false);
  });

  it('Run button calls onConfirm with the current includeExternal value', async () => {
    const previewFn = vi.fn(async () => samplePlan);
    const onConfirm = vi.fn();

    render(
      <PreflightModal
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        rootEntity={{ kind: 'service', id: 'svc-1', name: 'OrderService' }}
        previewFn={previewFn}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('preflight-modal-run-button')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('preflight-modal-run-button'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Spec 2026-05-11 Section 1: onConfirm signature now also receives the
    // selected log files (empty here) and the per-run M (default 1).
    expect(onConfirm).toHaveBeenCalledWith(true, [], 1);
  });
});
