/**
 * StartCaptureSessionWizard -- connection + DB fixes
 *
 * Covers two frontend fixes in the API Behaviour capture wizard:
 *
 *   Fix B -- Sybase advance: selecting `Sybase ASE` as the DB type in step 3
 *     must enable the Next button so the wizard can advance (the current-state
 *     DB is Sybase and the backend `test-db-connection` + DB sampler already
 *     accept `sybase` via the SybaseAdapter -> sybase-discovery-sidecar).
 *
 *   Fix C -- "Test API connection" button in step 2: the wizard collects
 *     baseUrl + auth + default headers in step 2 but offered no way to test
 *     before Start. A new "Test API connection" button calls the stateless
 *     gateway endpoint `testApiConnectionStateless(projectId, architectureId,
 *     body)` with the current step-2 state and renders the returned HTTP
 *     status + duration inline.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - `useArchitecture` mocked to return a fixed in-memory model with one
 *     Interface row so the step-1 selection branch is exercised.
 *   - The api client module is mocked; `testApiConnectionStateless` is a spy
 *     we assert call args + drive the rendered result on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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
    testApiConnectionStateless: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

// ============================================================================
// Imports under test
// ============================================================================

import { useArchitecture } from '../../contexts/ArchitectureContext';
import { testApiConnectionStateless } from '../../api/apiBehaviourClient';
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

/** Drive the wizard from step 1 to step 2 with a selected interface. */
function advanceToStep2() {
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-interface-iface-1'));
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
}

/** Drive the wizard from step 1 to step 3 (env name + base URL filled in). */
function advanceToStep3() {
  advanceToStep2();
  fireEvent.change(screen.getByTestId('start-capture-session-wizard-env-name'), {
    target: { value: 'non-prod' },
  });
  fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartCaptureSessionWizard -- Sybase advances past step 3 (Fix B)', () => {
  it('selecting Sybase as the DB type enables the Next button so the wizard can advance', () => {
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

    advanceToStep3();

    const next = screen.getByTestId(
      'start-capture-session-wizard-next',
    ) as HTMLButtonElement;

    // Default DB type is 'none' -> Next is enabled.
    expect(next).not.toBeDisabled();

    // Select Sybase. The Next button must stay enabled (Fix B: the previous
    // `canAdvanceStep3` only allowed 'none' | 'postgres', which blocked
    // advancing whenever Sybase was chosen).
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-db-type'), {
      target: { value: 'sybase' },
    });
    expect(next).not.toBeDisabled();
  });
});

describe('StartCaptureSessionWizard -- Test API connection button (Fix C)', () => {
  it('clicking "Test API connection" in step 2 calls the stateless client fn with the step-2 baseUrl/auth/headers and renders the returned status + duration', async () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );
    vi.mocked(testApiConnectionStateless).mockResolvedValue({
      success: true,
      status: 200,
      durationMs: 142,
    });

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    advanceToStep2();

    // Fill in the step-2 environment fields: base URL + a custom-header auth +
    // a default header. The Test button should send all of it.
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
      target: { value: 'https://api.nonprod.example.com' },
    });
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-auth-type'), {
      target: { value: 'header' },
    });
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-default-headers'), {
      target: { value: 'X-Tenant: acme' },
    });

    // Click the new in-wizard Test API connection button.
    const testBtn = screen.getByTestId('start-capture-session-wizard-test-connection');
    expect(testBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(testBtn);
      await Promise.resolve();
    });

    // The stateless client fn must have been called once with the bound
    // projectId + architectureId and the current step-2 state.
    expect(testApiConnectionStateless).toHaveBeenCalledTimes(1);
    const [proj, arch, body] = vi.mocked(testApiConnectionStateless).mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(arch).toBe(ARCH_ID);
    expect(body.baseUrl).toBe('https://api.nonprod.example.com');
    expect(body.auth.type).toBe('header');
    expect(body.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'acme' }]);

    // The result is rendered inline: HTTP status + duration.
    const result = await screen.findByTestId(
      'start-capture-session-wizard-test-connection-result',
    );
    expect(result.textContent).toContain('200');
    expect(result.textContent).toContain('142');
  });

  it('renders the error string inline when the stateless test reports a failure', async () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );
    vi.mocked(testApiConnectionStateless).mockResolvedValue({
      success: false,
      status: 0,
      durationMs: 37,
      error: 'ECONNREFUSED',
    });

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    advanceToStep2();
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
      target: { value: 'https://down.example.com' },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-test-connection'),
      );
      await Promise.resolve();
    });

    const result = await screen.findByTestId(
      'start-capture-session-wizard-test-connection-result',
    );
    expect(result.textContent).toContain('ECONNREFUSED');
  });

  it('"ssoToken (in header)" option sends a fixed `ssoToken` header with the TRIMMED value', async () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );
    vi.mocked(testApiConnectionStateless).mockResolvedValue({
      success: true,
      status: 200,
      durationMs: 12,
    });

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    advanceToStep2();
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
      target: { value: 'https://api.nonprod.example.com' },
    });
    // The convenience option exposes a SINGLE value field (no header-name input).
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-auth-type'), {
      target: { value: 'sso_token' },
    });
    const ssoInput = screen.getByTestId('start-capture-session-wizard-sso-token');
    expect(ssoInput).toBeInTheDocument();
    // A stray leading/trailing space (a common copy-paste slip) must be trimmed.
    fireEvent.change(ssoInput, { target: { value: '  my-sso-token-value  ' } });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-test-connection'),
      );
      await Promise.resolve();
    });

    expect(testApiConnectionStateless).toHaveBeenCalledTimes(1);
    const [, , body] = vi.mocked(testApiConnectionStateless).mock.calls[0];
    // Fixed header name `ssoToken`, value trimmed, sent as an ordinary custom header.
    expect(body.auth.type).toBe('header');
    expect(body.auth.headerName).toBe('ssoToken');
    expect(body.auth.headerValue).toBe('my-sso-token-value');
  });

  it('renders an amber "auth was rejected" result (NOT a green Success) on HTTP 401', async () => {
    vi.mocked(useArchitecture).mockReturnValue(
      mockArchitectureModel({ withInterface: true }),
    );
    // The probe REACHED the target (200 envelope) but auth was refused: the
    // route reports success:true (status < 500) AND authRejected:true.
    vi.mocked(testApiConnectionStateless).mockResolvedValue({
      success: true,
      status: 401,
      durationMs: 23,
      authRejected: true,
    });

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    advanceToStep2();
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
      target: { value: 'https://api.nonprod.example.com' },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-test-connection'),
      );
      await Promise.resolve();
    });

    const result = await screen.findByTestId(
      'start-capture-session-wizard-test-connection-result',
    );
    expect(result.textContent).toContain('auth was rejected');
    expect(result.textContent).toContain('401');
    // Must NOT masquerade as a success.
    expect(result.textContent).not.toContain('Success');
  });
});
