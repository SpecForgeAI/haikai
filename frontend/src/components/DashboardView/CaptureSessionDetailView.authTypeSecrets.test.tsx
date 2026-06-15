/**
 * CaptureSessionDetailView -- auth-type-aware "Re-enter secrets" form (Fix A).
 *
 * The re-enter-secrets inline prompt previously hardcoded a single "Bearer
 * token (optional)" field and always built `apiAuth` as
 * `bearerToken ? { type:'bearer', token } : { type:'none' }`, IGNORING
 * `session.auth_type`. A `header`-auth session (e.g. a custom header
 * `ssoToken`) could therefore never re-supply its secret.
 *
 * Fix A renders the API-secret field(s) conditional on `session.auth_type`:
 *   - header -> a password field for the header VALUE, labelled with the
 *     header NAME from `session.auth_config_redacted_json.headerName`.
 *   - basic  -> username + password fields.
 *   - bearer -> the token field (legacy behaviour).
 *   - none   -> no API-secret field.
 * and rebuilds `handleSubmitSecrets` to construct `apiAuth` from
 * `session.auth_type` + the entered value(s), matching the shape the
 * wizard's `buildSecretsBundle()` submits.
 *
 * Coverage here:
 *   - A `header`-auth session renders a header-VALUE field labelled with the
 *     header name, and submitting calls `submitSecrets` with
 *     `{ type:'header', headerName, headerValue }`.
 *   - A `bearer`-auth session still renders the token field and submits
 *     `{ type:'bearer', token }`.
 *
 * Test strategy mirrors the sibling CaptureSessionDetailView test files:
 *   - Mock the api client (`getCaptureSession`, `submitSecrets`, list
 *     endpoints for the nested CaptureReviewPanel).
 *   - Stub `useArchitectureDispatch` / `useProject` / `loadModelByProjectId`
 *     so the view renders without a full provider tree.
 *   - Wrap in `<MemoryRouter>` (the view uses `useNavigate`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    getCaptureSession: vi.fn(),
    cancelCaptureSession: vi.fn(),
    createCaptureSession: vi.fn(),
    cloneCaptureSession: vi.fn(),
    startCaptureSession: vi.fn(),
    submitSecrets: vi.fn().mockResolvedValue({ ok: true }),
    testApiConnection: vi.fn(),
    testDbConnection: vi.fn(),
    listOperations: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCaptures: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
}));

import {
  getCaptureSession,
  submitSecrets,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-authtype-1';
const ARCH_ID = 'arch-authtype-1';
const SESSION_ID = 'session-authtype-1';

function buildSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'A session',
    status: 'configured',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/** Open the secrets form on an idle session that has no in-memory secrets. */
async function openSecretsForm() {
  await screen.findByTestId('capture-session-detail-reenter-secrets-prompt');
  fireEvent.click(screen.getByTestId('capture-session-detail-open-secrets-form'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureSessionDetailView -- header-auth secrets re-entry (Fix A)', () => {
  it('renders a header-value field labelled with the header name and submits { type:header, headerName, headerValue }', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({
        auth_type: 'header',
        // The header NAME is known + redacted-safe; only the value is secret.
        auth_config_redacted_json: { type: 'header', headerName: 'ssoToken' },
      }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await openSecretsForm();

    // The bearer-token field must NOT be present for a header-auth session.
    expect(
      screen.queryByTestId('capture-session-detail-secrets-bearer'),
    ).toBeNull();

    // A header-VALUE field must be present, labelled with the header name.
    const headerValueField = screen.getByTestId(
      'capture-session-detail-secrets-header-value',
    ) as HTMLInputElement;
    expect(headerValueField).toBeInTheDocument();
    expect(headerValueField.type).toBe('password');
    // The header name appears in the prompt so the reviewer knows which header
    // they are supplying the secret for.
    expect(
      screen.getByTestId('capture-session-detail-secrets-prompt-body').textContent,
    ).toContain('ssoToken');

    fireEvent.change(headerValueField, { target: { value: 'sso-secret-xyz' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-submit-secrets'));
      await Promise.resolve();
    });

    expect(submitSecrets).toHaveBeenCalledTimes(1);
    const [proj, arch, sid, payload] = vi.mocked(submitSecrets).mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(arch).toBe(ARCH_ID);
    expect(sid).toBe(SESSION_ID);
    expect(payload.apiAuth).toEqual({
      type: 'header',
      headerName: 'ssoToken',
      headerValue: 'sso-secret-xyz',
    });
  });
});

describe('CaptureSessionDetailView -- bearer-auth secrets re-entry still works (Fix A regression guard)', () => {
  it('renders the token field and submits { type:bearer, token } for a bearer-auth session', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({ auth_type: 'bearer' }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await openSecretsForm();

    const bearerField = screen.getByTestId(
      'capture-session-detail-secrets-bearer',
    ) as HTMLInputElement;
    expect(bearerField).toBeInTheDocument();
    fireEvent.change(bearerField, { target: { value: 'tok-abc' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-submit-secrets'));
      await Promise.resolve();
    });

    expect(submitSecrets).toHaveBeenCalledTimes(1);
    const [, , , payload] = vi.mocked(submitSecrets).mock.calls[0];
    expect(payload.apiAuth).toEqual({ type: 'bearer', token: 'tok-abc' });
  });
});

describe('CaptureSessionDetailView -- basic-auth secrets re-entry (Fix A)', () => {
  it('renders username + password fields and submits { type:basic, username, password }', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({ auth_type: 'basic' }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await openSecretsForm();

    const userField = screen.getByTestId(
      'capture-session-detail-secrets-basic-username',
    ) as HTMLInputElement;
    const passField = screen.getByTestId(
      'capture-session-detail-secrets-basic-password',
    ) as HTMLInputElement;
    fireEvent.change(userField, { target: { value: 'svc-account' } });
    fireEvent.change(passField, { target: { value: 'svc-pwd' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-submit-secrets'));
      await Promise.resolve();
    });

    const [, , , payload] = vi.mocked(submitSecrets).mock.calls[0];
    expect(payload.apiAuth).toEqual({
      type: 'basic',
      username: 'svc-account',
      password: 'svc-pwd',
    });
  });
});
