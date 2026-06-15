/**
 * CaptureSessionDetailView tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 * Task 8.1 sub-tests #2-4: polling cadence, idle-session secret-loss prompt,
 * and secrets-lost-during-run CTAs.
 *
 * Coverage:
 *   - View polls AMS at ~2-3s cadence while `status === 'running'` and
 *     stops polling when status transitions to a terminal state.
 *   - Idle session (status=`configured`/`completed`/`failed`/`cancelled`)
 *     without in-memory secrets in this UI session shows the
 *     "Re-enter secrets" inline prompt AND blocks execution actions
 *     (Test API / Test DB / Start are disabled).
 *   - Session marked `failed` with `error_message='secrets_lost_during_run'`
 *     shows BOTH CTAs: "Clone configuration" and "Re-enter secrets and
 *     start a new run".
 *
 * Test strategy:
 *   - Mock the api client so polling is a `getCaptureSession` spy we can
 *     count calls on.
 *   - Use Vitest fake timers to advance through polling intervals.
 *   - Wrap renders in `<MemoryRouter>` because Task Group 9 wired the view
 *     up to `useNavigate` for the secret-loss clone CTAs.
 *   - Stub the list endpoints used by the nested `CaptureReviewPanel` so
 *     it mounts cleanly when the session status is `running` / `failed` --
 *     the panel's own behaviour is covered by `CaptureReviewPanel.test.tsx`.
 *   - Task Group 10 wired the view to `useArchitectureDispatch`, `useProject`,
 *     and `loadModelByProjectId` for AppShell model cache refresh on the
 *     non-terminal -> terminal transition. Mock those here as no-ops so the
 *     view renders without needing a full provider tree; the cache-refresh
 *     behaviour is covered by `CaptureSessionDetailView.cacheInvalidation.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
    submitSecrets: vi.fn(),
    testApiConnection: vi.fn(),
    testDbConnection: vi.fn(),
    // Stub the list endpoints the nested CaptureReviewPanel calls on mount
    // for sessions that are running / completed / failed. Returning empty
    // arrays keeps the panel in its "no captured rows yet" state and out of
    // the way of these tests.
    listOperations: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCaptures: vi.fn().mockResolvedValue([]),
  };
});

// Task Group 10: the view now consumes `useArchitectureDispatch` and
// `useProject` (for the terminal-transition LOAD_MODEL dispatch) and calls
// `loadModelByProjectId`. Stub them here so this file's tests don't need a
// full provider tree.
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
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-detail-1';
const ARCH_ID = 'arch-detail-1';
const SESSION_ID = 'session-detail-1';

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CaptureSessionDetailView -- polling cadence (Task 8.1 #2)', () => {
  it('polls at the configured cadence while status=running and stops once status reaches a terminal value', async () => {
    vi.useFakeTimers();

    // First fetch returns running; subsequent fetches initially also running,
    // then on the 3rd call returns completed -- polling should stop after
    // that.
    const running = buildSession({ status: 'running' });
    const completed = buildSession({
      status: 'completed',
      completed_at: '2026-05-15T00:01:00Z',
    });

    vi.mocked(getCaptureSession)
      .mockResolvedValueOnce(running) // initial load
      .mockResolvedValueOnce(running) // first poll
      .mockResolvedValueOnce(completed) // second poll -> terminal
      .mockResolvedValue(completed); // any further calls would also return completed

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        pollIntervalMs={2500}
      />,
    );

    // Flush the initial load promise.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(1);

    // Advance one polling tick -> 2nd call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(2);

    // Advance another tick -> 3rd call returns `completed` (terminal).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(3);

    // After the terminal status lands, polling must stop. Advance several
    // more ticks worth of wall-clock; the call count must not climb.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(3);
  });
});

describe('CaptureSessionDetailView -- idle session secret-loss prompt (Task 8.1 #3)', () => {
  it('shows the inline "Re-enter secrets" prompt and disables execution actions for an idle session with no in-memory secrets', async () => {
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

    // Wait for the initial load to flush.
    await screen.findByTestId('capture-session-detail-view');
    // The inline re-enter prompt must be present.
    expect(
      screen.getByTestId('capture-session-detail-reenter-secrets-prompt'),
    ).toBeInTheDocument();

    // Execution actions must be disabled until secrets are re-entered.
    const testApi = screen.getByTestId(
      'capture-session-detail-test-api',
    ) as HTMLButtonElement;
    const testDb = screen.getByTestId(
      'capture-session-detail-test-db',
    ) as HTMLButtonElement;
    const start = screen.getByTestId(
      'capture-session-detail-start',
    ) as HTMLButtonElement;
    expect(testApi.disabled).toBe(true);
    expect(testDb.disabled).toBe(true);
    expect(start.disabled).toBe(true);
  });
});

describe('CaptureSessionDetailView -- secrets-lost-during-run CTAs (Task 8.1 #4)', () => {
  it('shows both "Clone configuration" and "Re-enter secrets and start a new run" CTAs when error_message=secrets_lost_during_run', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({
        status: 'failed',
        error_message: 'secrets_lost_during_run',
      }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await screen.findByTestId('capture-session-detail-view');

    expect(
      screen.getByTestId('capture-session-detail-secrets-lost-banner'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('capture-session-detail-clone-config-cta'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('capture-session-detail-reenter-and-restart-cta'),
    ).toBeInTheDocument();

    // And the idle-secret-loss prompt is NOT also shown -- the
    // secrets-lost-during-run branch is mutually exclusive with the generic
    // re-enter prompt per spec.
    expect(
      screen.queryByTestId('capture-session-detail-reenter-secrets-prompt'),
    ).toBeNull();
  });
});

describe('CaptureSessionDetailView -- misleading-COMPLETED fix (scenario tallies)', () => {
  it('a COMPLETED session whose scenarios ALL errored shows the zero-captures warning + the 0-of-N tally', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({
        status: 'completed',
        completed_at: '2026-06-10T13:50:38Z',
        scenarios_attempted: 12,
        scenarios_completed: 0,
        scenarios_errored: 12,
      }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await screen.findByTestId('capture-session-detail-view');

    // The header tally makes the outcome explicit next to the status badge.
    expect(screen.getByTestId('capture-session-scenario-tally')).toHaveTextContent(
      '0 of 12 scenarios captured',
    );
    // The warning banner makes an all-failed run impossible to read as success.
    const banner = screen.getByTestId('capture-session-zero-captures-banner');
    expect(banner).toHaveTextContent('completed without capturing anything');
    expect(banner).toHaveTextContent('all 12 scenarios errored');
  });

  it('a COMPLETED session with captures shows the N-of-M tally and NO warning banner', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({
        status: 'completed',
        completed_at: '2026-06-10T13:50:38Z',
        scenarios_attempted: 12,
        scenarios_completed: 10,
        scenarios_errored: 2,
      }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await screen.findByTestId('capture-session-detail-view');

    expect(screen.getByTestId('capture-session-scenario-tally')).toHaveTextContent(
      '10 of 12 scenarios captured',
    );
    expect(screen.queryByTestId('capture-session-zero-captures-banner')).toBeNull();
  });

  it('a legacy COMPLETED session with NO recorded tallies renders neither the tally nor the warning (back-compat)', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(
      buildSession({
        status: 'completed',
        completed_at: '2026-06-10T13:50:38Z',
        // scenarios_* absent: pre-fix runner / legacy row.
      }),
    );

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    await screen.findByTestId('capture-session-detail-view');

    expect(screen.queryByTestId('capture-session-scenario-tally')).toBeNull();
    expect(screen.queryByTestId('capture-session-zero-captures-banner')).toBeNull();
  });
});
