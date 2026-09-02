/**
 * CaptureSessionDetailView — ASYNC coverage closure (2026-09-02).
 *
 * "Run closure" used to await ONE synchronous proxy call; the multi-minute
 * run outlived the gateway's fetch timeout and the modal showed a false
 * "API migration validation service unavailable" banner while the run
 * completed fine — the real outcome only appeared after a full-page refresh.
 *
 * The action now answers 202 and the view POLLS `closure-status` until
 * terminal. Pins:
 *   1. the modal STAYS in its running state ("Running closure…") across
 *      polls, then the terminal result flows through the same processing as
 *      the old synchronous response (session refreshed, note rendered);
 *   2. a failed background run surfaces its real error, not "unavailable";
 *   3. a 404 poll (AMVS restarted mid-run) refreshes the session and says so
 *      honestly;
 *   4. the old synchronous 200 shape (already-complete gate / older AMVS)
 *      still processes directly — no polling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    getCaptureSession: vi.fn(),
    retryUncoveredApis: vi.fn(),
    fetchClosureStatus: vi.fn(),
    listOperations: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCaptures: vi.fn().mockResolvedValue([]),
    listDiagnostics: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => ({ id: 'proj-ac-1', name: 'Async Closure Project' })),
}));
vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
}));

import {
  getCaptureSession,
  retryUncoveredApis,
  fetchClosureStatus,
  listOperations,
  listScenarios,
  listCaptures,
  listDiagnostics,
  ApiBehaviourApiError,
  type ApiBehaviourCaptureSessionDto,
  type RetryUncoveredResponse,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-ac-1';
const ARCH_ID = 'arch-ac-1';
const SESSION_ID = 'session-ac-1';

function coverageWithUnresolved(): Record<string, unknown> {
  return {
    overall_score: 0,
    dimensions_total: 1,
    dimensions_achieved: 0,
    per_endpoint: [
      {
        operation_id: 'listWidgets',
        method: 'GET',
        path: '/widgets',
        score: 0,
        dimensions: [
          {
            name: 'happy_path',
            type: 'happy_path',
            expected_status: 'success',
            achieved: false,
            canonical_capture_id: null,
            reason: 'no 2xx observed',
            observation: null,
          },
        ],
      },
    ],
    auth_coverage: { achieved: true, representative_operation_id: null, probes: [] },
    observations: [],
  };
}

function buildSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Async closure session',
    status: 'completed',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: '2026-09-02T00:00:00Z',
    completed_at: '2026-09-02T00:10:00Z',
    error_message: null,
    created_at: '2026-09-02T00:00:00Z',
    updated_at: '2026-09-02T00:10:00Z',
    coverage_summary_json: coverageWithUnresolved(),
    ...overrides,
  } as ApiBehaviourCaptureSessionDto;
}

const ACCEPTED = { accepted: true as const, closureRunId: 'closure-r1', sessionId: SESSION_ID };

function closureResult(): RetryUncoveredResponse {
  return {
    sessionId: SESSION_ID,
    passA: { fired: 1, closed: ['listWidgets'] },
    passB: { attempted: 0, closed: [], available: true },
    dimensional: { attempted: 0, closed: [] },
    authReprobe: null,
    gate: { complete: true, included_total: 1, happy_achieved: 1, unresolved: [] },
  };
}

function statusOf(
  status: 'running' | 'completed' | 'failed',
  extra: Partial<{ result: RetryUncoveredResponse | null; error: string | null }> = {},
) {
  return {
    sessionId: SESSION_ID,
    closureRunId: 'closure-r1',
    status,
    startedAt: '2026-09-02T00:11:00Z',
    completedAt: status === 'running' ? null : '2026-09-02T00:12:00Z',
    result: extra.result ?? null,
    error: extra.error ?? null,
  };
}

/** Render, flush the initial session fetch, open the modal, click launch.
 *  Microtask flushes only (fake-timer safe): the session fetch and the launch
 *  POST resolve on microtasks; only the POLLS need timer advancement. */
async function openModalAndLaunch(): Promise<void> {
  render(
    <MemoryRouter>
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        pollIntervalMs={20}
      />
    </MemoryRouter>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByTestId('capture-session-coverage-gate-retry'));
  await act(async () => {});
  fireEvent.click(screen.getByTestId('retry-uncovered-modal-launch'));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  // Stubs re-established here (never rely on factory-time implementations —
  // they do not survive mock resets between tests).
  vi.mocked(getCaptureSession).mockResolvedValue(buildSession());
  vi.mocked(listOperations).mockResolvedValue([]);
  vi.mocked(listScenarios).mockResolvedValue([]);
  vi.mocked(listCaptures).mockResolvedValue([]);
  vi.mocked(listDiagnostics).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CaptureSessionDetailView — async closure polling', () => {
  it('202 keeps the modal RUNNING across polls, then the terminal result closes it (gate complete)', async () => {
    vi.mocked(retryUncoveredApis).mockResolvedValue(ACCEPTED);
    // The run stays 'running' until the TEST releases it — deterministic
    // regardless of poll cadence.
    let allowComplete = false;
    vi.mocked(fetchClosureStatus).mockImplementation(async () =>
      allowComplete
        ? statusOf('completed', { result: closureResult() })
        : statusOf('running'),
    );

    await openModalAndLaunch();

    // Busy state renders immediately after launch...
    expect(screen.getByTestId('retry-uncovered-modal-launch')).toHaveTextContent(
      'Running closure…',
    );

    // ...and SURVIVES multiple still-running polls — no false banner, the
    // modal stays open in its running state the whole time.
    await waitFor(() =>
      expect(vi.mocked(fetchClosureStatus).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByTestId('retry-uncovered-modal')).toBeInTheDocument();
    expect(screen.getByTestId('retry-uncovered-modal-launch')).toHaveTextContent(
      'Running closure…',
    );

    // Release: the next poll returns the terminal result — gate complete ->
    // the modal closes (the refresh the operator previously did by hand).
    allowComplete = true;
    await waitFor(() => {
      expect(screen.queryByTestId('retry-uncovered-modal')).toBeNull();
    });
  });

  it('a FAILED background run surfaces its real error in the modal note', async () => {
    vi.mocked(retryUncoveredApis).mockResolvedValue(ACCEPTED);
    vi.mocked(fetchClosureStatus).mockResolvedValue(
      statusOf('failed', { error: 'legacy system rejected every candidate' }),
    );

    await openModalAndLaunch();

    await waitFor(() => {
      expect(
        screen.getByText('legacy system rejected every candidate'),
      ).toBeInTheDocument();
    });
    // The modal is idle again for an adjusted re-run.
    expect(screen.getByTestId('retry-uncovered-modal-launch')).toHaveTextContent('Run closure');
  });

  it('a 404 poll (service restarted mid-run) refreshes the session and says so honestly', async () => {
    vi.mocked(retryUncoveredApis).mockResolvedValue(ACCEPTED);
    vi.mocked(fetchClosureStatus).mockRejectedValue(
      new ApiBehaviourApiError(404, { error: { code: 'NO_CLOSURE_RUN', message: 'gone' } } as never),
    );

    await openModalAndLaunch();
    const sessionsFetchedBefore = vi.mocked(getCaptureSession).mock.calls.length;

    await waitFor(() => {
      expect(screen.getByText(/Closure status expired/)).toBeInTheDocument();
    });
    // The durable outcome was re-read from the session row.
    expect(vi.mocked(getCaptureSession).mock.calls.length).toBeGreaterThan(sessionsFetchedBefore);
  });

  it('the OLD synchronous 200 shape still processes directly — no polling', async () => {
    vi.mocked(retryUncoveredApis).mockResolvedValue(closureResult());

    await openModalAndLaunch();

    await waitFor(() => {
      expect(screen.queryByTestId('retry-uncovered-modal')).toBeNull();
    });
    expect(vi.mocked(fetchClosureStatus)).not.toHaveBeenCalled();
  });
});
