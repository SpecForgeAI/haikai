/**
 * CaptureSessionDetailView -- connection-test result feedback (Bug 2) and
 * guarded/disabled action affordances (Bug 3). (2026-06-16)
 *
 * Bug 2: the "Test API connection" / "Test DB connection" handlers used to
 * `await` the client call and DISCARD the resolved value. The session-bound
 * routes return HTTP 200 even when the *target* fails -- the API route's
 * `success` is `status >= 200 && status < 500`, so a 401/500 RESOLVES (does
 * NOT throw). The component therefore showed NOTHING for a rejected probe,
 * indistinguishable from a dead button. The fix captures the resolved
 * `{ success, status, durationMs }` (API) / `{ success, serverVersion }` (DB)
 * into state and renders inline feedback, treating `success === false` as a
 * VISIBLE failure. The thrown-error path still surfaces via the error banner.
 *
 * Bug 3: the Test + Start buttons are `disabled` while the secrets guard is
 * active, but `.secondaryButton` had no disabled affordance so a guarded Test
 * button looked clickable. The fix adds `.secondaryButtonDisabled` styling, a
 * `title` tooltip, and an inline hint that points at the always-reachable
 * "Re-enter secrets" prompt. The guard LOGIC is unchanged.
 *
 * Test strategy mirrors the sibling CaptureSessionDetailView test files:
 *   - Mock the api client (`getCaptureSession`, `submitSecrets`,
 *     `testApiConnection`, `testDbConnection`, list endpoints for the nested
 *     CaptureReviewPanel).
 *   - Stub `useArchitectureDispatch` / `useProject` / `loadModelByProjectId`.
 *   - Wrap in `<MemoryRouter>` (the view uses `useNavigate`).
 *
 * Reaching an ENABLED Test button requires loading secrets in this UI session
 * first (the conservative guard is on by default), so the helper opens the
 * re-enter-secrets form and submits it -- `submitSecrets` resolving flips the
 * UI-local `secretsLoadedLocal` flag and drops the guard.
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
  testApiConnection,
  testDbConnection,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-conntest-1';
const ARCH_ID = 'arch-conntest-1';
const SESSION_ID = 'session-conntest-1';

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

/**
 * Load secrets in this UI session so the guard drops and the Test/Start
 * buttons become enabled. Opens the re-enter-secrets form and submits it; the
 * mocked `submitSecrets` resolves, which flips the UI-local flag.
 */
async function loadSecrets() {
  await screen.findByTestId('capture-session-detail-reenter-secrets-prompt');
  fireEvent.click(screen.getByTestId('capture-session-detail-open-secrets-form'));
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

describe('CaptureSessionDetailView -- Test API result feedback (Bug 2)', () => {
  it('renders a SUCCESS result with status + durationMs when the probe resolves with success:true', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );
    vi.mocked(testApiConnection).mockResolvedValue({
      sessionId: SESSION_ID,
      success: true,
      status: 200,
      durationMs: 142,
    });

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await loadSecrets();

    const testApi = screen.getByTestId(
      'capture-session-detail-test-api',
    ) as HTMLButtonElement;
    expect(testApi.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(testApi);
      await Promise.resolve();
    });

    const result = await screen.findByTestId(
      'capture-session-detail-test-api-result',
    );
    expect(result).toHaveTextContent('API connection OK');
    expect(result).toHaveTextContent('200');
    expect(result).toHaveTextContent('142ms');
  });

  it('renders a visible FAILURE (not silence) when the probe RESOLVES with success:false (e.g. 401 returned as HTTP 200)', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );
    // The route returns HTTP 200 (so the promise RESOLVES) but the target
    // rejected the probe: success === false.
    vi.mocked(testApiConnection).mockResolvedValue({
      sessionId: SESSION_ID,
      success: false,
      status: 401,
      durationMs: 88,
    });

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await loadSecrets();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-test-api'));
      await Promise.resolve();
    });

    const result = await screen.findByTestId(
      'capture-session-detail-test-api-result',
    );
    expect(result).toHaveTextContent('API connection FAILED');
    expect(result).toHaveTextContent('401');
    expect(result).toHaveTextContent('88ms');
  });

  it('surfaces a thrown error via the error banner', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );
    vi.mocked(testApiConnection).mockRejectedValue(
      new Error('network unreachable'),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await loadSecrets();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-test-api'));
      await Promise.resolve();
    });

    expect(await screen.findByText('network unreachable')).toBeInTheDocument();
    // No success/failure result row when the call threw.
    expect(
      screen.queryByTestId('capture-session-detail-test-api-result'),
    ).toBeNull();
  });
});

describe('CaptureSessionDetailView -- Test DB result feedback (Bug 2)', () => {
  it('renders a SUCCESS result (with server version) when the DB probe resolves with success:true', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );
    vi.mocked(testDbConnection).mockResolvedValue({
      sessionId: SESSION_ID,
      success: true,
      serverVersion: 'PostgreSQL 15.2',
    });

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await loadSecrets();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-test-db'));
      await Promise.resolve();
    });

    const result = await screen.findByTestId(
      'capture-session-detail-test-db-result',
    );
    expect(result).toHaveTextContent('DB connection OK');
    expect(result).toHaveTextContent('PostgreSQL 15.2');
  });

  it('renders a visible FAILURE when the DB probe resolves with success:false', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );
    vi.mocked(testDbConnection).mockResolvedValue({
      sessionId: SESSION_ID,
      success: false,
      serverVersion: null,
    });

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await loadSecrets();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-session-detail-test-db'));
      await Promise.resolve();
    });

    const result = await screen.findByTestId(
      'capture-session-detail-test-db-result',
    );
    expect(result).toHaveTextContent('DB connection FAILED');
  });
});

describe('CaptureSessionDetailView -- guarded/disabled action affordances (Bug 3)', () => {
  it('greys the Test buttons, gives them an explanatory title, and shows the hint pointing at the re-enter-secrets prompt', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({ status: 'configured' }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await screen.findByTestId('capture-session-detail-view');

    const testApi = screen.getByTestId(
      'capture-session-detail-test-api',
    ) as HTMLButtonElement;
    const testDb = screen.getByTestId(
      'capture-session-detail-test-db',
    ) as HTMLButtonElement;
    const start = screen.getByTestId(
      'capture-session-detail-start',
    ) as HTMLButtonElement;

    // Guard logic unchanged: still disabled.
    expect(testApi.disabled).toBe(true);
    expect(testDb.disabled).toBe(true);
    expect(start.disabled).toBe(true);

    // New: visible disabled affordance via the explicit class + a title.
    expect(testApi.className).toContain('secondaryButtonDisabled');
    expect(testDb.className).toContain('secondaryButtonDisabled');
    expect(testApi.getAttribute('title')).toContain('Re-enter secrets');
    expect(start.getAttribute('title')).toContain('Re-enter secrets');

    // New: inline hint that points at the always-reachable prompt.
    const hint = screen.getByTestId(
      'capture-session-detail-actions-disabled-hint',
    );
    expect(hint).toHaveTextContent('disabled until secrets are loaded');
    expect(hint).toHaveTextContent('Re-enter secrets');

    // The re-enter-secrets prompt (the reachable entry point) is present.
    expect(
      screen.getByTestId('capture-session-detail-open-secrets-form'),
    ).toBeInTheDocument();
  });

  it('drops the disabled affordance once secrets are loaded in this UI session', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await loadSecrets();

    const testApi = screen.getByTestId(
      'capture-session-detail-test-api',
    ) as HTMLButtonElement;
    expect(testApi.disabled).toBe(false);
    expect(testApi.className).not.toContain('secondaryButtonDisabled');
    expect(
      screen.queryByTestId('capture-session-detail-actions-disabled-hint'),
    ).toBeNull();
  });
});
