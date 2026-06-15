/**
 * StartCaptureSessionWizard tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
 * Task 7.1 sub-tests #2-4: focused coverage of the wizard surface that
 * matters for the spec's hard constraints. The api-client URL contract
 * (sub-test #1) lives in `src/api/__tests__/apiBehaviourClient.test.ts`;
 * the launcher pre-binding (sub-test #5) lives in
 * `ManageArchitecturesModal.captureBaselineLauncher.test.tsx`.
 *
 * Coverage:
 *   - Step 1 -> Step 2 advance is blocked when no Interface row is
 *     selected AND no OAS file is uploaded (Next disabled).
 *   - Sybase DB-type dropdown option is `disabled` AND carries the spec's
 *     "not yet implemented in v1" tooltip text (visible-but-disabled per
 *     spec; never hidden).
 *   - Mutating-call confirmation toggle on step 2 is editable while the
 *     session is still `draft` (i.e. throughout the wizard since the
 *     wizard only transitions out of draft on the final Start press).
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - `useArchitecture` is mocked to return a fixed in-memory model with
 *     a single Interface row so the step-1 selection branch is exercised.
 *   - The api client module is mocked so step transitions never reach a
 *     real network call; we don't drive past step 3 here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mocks (declared before imports per Vitest's hoisting semantics)
// ============================================================================

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    createCaptureSession: vi.fn(),
    submitSecrets: vi.fn(),
    parseOas: vi.fn(),
    startCaptureSession: vi.fn(),
    updateCaptureSession: vi.fn(),
    updateOperation: vi.fn(),
    listOperations: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

// ============================================================================
// Imports under test
// ============================================================================

import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-uuid-aaa';
const ARCH_ID = 'arch-uuid-bbb';

function mockArchitectureModel(opts: { withInterface?: boolean } = {}) {
  const interfaces = opts.withInterface
    ? [
        {
          id: 'iface-1',
          name: 'Customer API',
          description: '',
          service_id: 'svc-1',
          interface_type: 'REST_API',
          spec_link: 'customer-api.json',
          tags: '',
        },
      ]
    : [];
  return {
    model: {
      metaModel: {
        entities: { interfaces },
      },
    },
  } as unknown as ReturnType<typeof useArchitecture>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartCaptureSessionWizard -- step 1 -> step 2 gating (Task 7.1 #2)', () => {
  it('Next button on step 1 is disabled when no Interface is selected and no OAS file is uploaded', () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    const next = screen.getByTestId(
      'start-capture-session-wizard-next',
    ) as HTMLButtonElement;
    expect(next).toBeDisabled();

    // Selecting the interface row enables the Next button (the gate is
    // either-or: file OR interface, so this confirms the selection path
    // actually lifts the block).
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-interface-iface-1'));
    expect(next).not.toBeDisabled();
  });
});

describe('StartCaptureSessionWizard -- Sybase DB-type enabled (Task 7.1 #3, 2026-05-17)', () => {
  // The Sybase dropdown option is fully enabled now that SybaseAdapter
  // proxies through the JVM sidecar. Replaces the previous "visible-but-
  // disabled" assertion -- AMVS no longer ships a Sybase throwing stub.
  it('renders the Sybase DB-type option as enabled and selectable', () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Advance step 1 -> 2 -> 3.
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-interface-iface-1'));
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-env-name'), {
      target: { value: 'non-prod' },
    });
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));

    const sybaseOpt = screen.getByTestId(
      'start-capture-session-wizard-db-type-sybase',
    ) as HTMLOptionElement;
    expect(sybaseOpt).toBeInTheDocument();
    expect(sybaseOpt.disabled).toBe(false);
    // The tooltip is gone -- if we ever need a runtime check (e.g. sidecar
    // health) the UX gate moves elsewhere, but the dropdown itself is open.
    expect(sybaseOpt.getAttribute('title')).toBeNull();
  });
});

describe('StartCaptureSessionWizard -- mutating-call confirmation toggle (Task 7.1 #4)', () => {
  it('mutating-call confirmation toggle is editable on step 2 while the session is still draft', () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Advance to step 2.
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-interface-iface-1'));
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));

    const toggle = screen.getByTestId(
      'start-capture-session-wizard-mutating-confirm',
    ) as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    // Toggle must be editable (not disabled) -- spec says it locks only once
    // the session moves to `configured`. The wizard creates the session at
    // step-3-advance with status='draft' and only transitions to configured
    // on the final Start press, so the toggle stays editable throughout the
    // wizard.
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
  });
});
