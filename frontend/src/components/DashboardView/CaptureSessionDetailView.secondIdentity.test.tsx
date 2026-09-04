/**
 * Second identity token on the secrets RE-ENTER prompt (2026-09-04).
 *
 * The wizard's Step 2 collects a second identity token (four-eyes
 * endpoints) but the session screen's re-enter prompt did not, so a session
 * whose secrets were re-supplied after a restart silently lost its second
 * identity and every four-eyes scenario recorded `manual_rec_required`
 * instead of firing. The prompt now offers the field for the auth shapes
 * that can carry one (bearer / header), trims it, omits it when blank, and
 * never renders it for basic / none.
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

const PROJECT_ID = 'proj-second-1';
const ARCH_ID = 'arch-second-1';
const SESSION_ID = 'session-second-1';

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

function renderView() {
  return render(
    <MemoryRouter>
      <CaptureSessionDetailView projectId={PROJECT_ID} architectureId={ARCH_ID} sessionId={SESSION_ID} />
    </MemoryRouter>,
  );
}

async function openSecretsForm() {
  await screen.findByTestId('capture-session-detail-reenter-secrets-prompt');
  fireEvent.click(screen.getByTestId('capture-session-detail-open-secrets-form'));
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('capture-session-detail-submit-secrets'));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureSessionDetailView -- second identity on the re-enter prompt', () => {
  it('bearer: sends the trimmed second identity alongside the primary token', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(buildSession({ auth_type: 'bearer' }));
    renderView();
    await openSecretsForm();

    fireEvent.change(screen.getByTestId('capture-session-detail-secrets-bearer'), {
      target: { value: 'tok-primary' },
    });
    fireEvent.change(screen.getByTestId('capture-session-detail-secrets-second-identity'), {
      target: { value: '  tok-second\n' },
    });
    await submit();

    expect(submitSecrets).toHaveBeenCalledTimes(1);
    const [, , , payload] = vi.mocked(submitSecrets).mock.calls[0];
    expect(payload.apiAuth).toEqual({ type: 'bearer', token: 'tok-primary', secondaryValue: 'tok-second' });
  });

  it('bearer: a blank second identity omits the key entirely (manual_rec_required path intact)', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(buildSession({ auth_type: 'bearer' }));
    renderView();
    await openSecretsForm();

    fireEvent.change(screen.getByTestId('capture-session-detail-secrets-bearer'), {
      target: { value: 'tok-primary' },
    });
    fireEvent.change(screen.getByTestId('capture-session-detail-secrets-second-identity'), {
      target: { value: '   ' },
    });
    await submit();

    const [, , , payload] = vi.mocked(submitSecrets).mock.calls[0];
    expect(payload.apiAuth).toEqual({ type: 'bearer', token: 'tok-primary' });
    expect('secondaryValue' in payload.apiAuth).toBe(false);
  });

  it('header: offers the field and sends it with headerName / headerValue', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({
        auth_type: 'header',
        auth_config_redacted_json: { type: 'header', headerName: 'ssoToken' },
      }),
    );
    renderView();
    await openSecretsForm();

    const headerField = screen.getByTestId('capture-session-detail-secrets-header-value');
    fireEvent.change(headerField, { target: { value: 'sso-primary' } });
    fireEvent.change(screen.getByTestId('capture-session-detail-secrets-second-identity'), {
      target: { value: 'sso-second' },
    });
    await submit();

    const [, , , payload] = vi.mocked(submitSecrets).mock.calls[0];
    expect(payload.apiAuth).toMatchObject({ type: 'header', headerValue: 'sso-primary', secondaryValue: 'sso-second' });
  });

  it('basic: never renders the second identity field (a second identity is meaningless there)', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(buildSession({ auth_type: 'basic' }));
    renderView();
    await openSecretsForm();

    expect(screen.getByTestId('capture-session-detail-secrets-basic-username')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-session-detail-secrets-second-identity')).toBeNull();
  });
});
