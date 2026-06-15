/**
 * CaptureSessionDetailView -- AppShell model cache invalidation tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 10
 * Task 10.1 sub-tests #1 + #3.
 *
 * Per `project_appshell_model_cache.md`: backend writes from the capture
 * loop bypass the frontend dispatch path, so the AppShell per-(project,
 * architecture) in-memory model cache is stale once a run ends. The detail
 * view is a same-arch flow (always scoped to the currently-active
 * architecture), so on a non-terminal -> terminal status transition we
 * dispatch `LOAD_MODEL` with a fresh `loadModelByProjectId` fetch so the
 * user sees the new entities in their current view.
 *
 * Coverage:
 *   1. Terminal-status EDGE detection: when the polling loop observes a
 *      transition from `running` -> `completed`, the view dispatches
 *      exactly ONE `LOAD_MODEL` action carrying the freshly-fetched
 *      model.
 *   2. NO dispatch spam during polling: while the session stays in
 *      `running`, repeated polls must NOT fire `LOAD_MODEL`. Only the
 *      single transition is load-bearing.
 *
 * Test strategy mirrors `CaptureSessionDetailView.test.tsx`:
 *   - Mock the api client so polling is a `getCaptureSession` spy we can
 *     count calls on.
 *   - Mock `useArchitectureDispatch` to a spy we can assert against.
 *   - Mock `loadModelByProjectId` to return a sentinel model.
 *   - Use Vitest fake timers to advance through polling intervals.
 *   - Wrap renders in `<MemoryRouter>` because the view uses `useNavigate`
 *     for the secret-loss CTAs.
 *   - Stub the list endpoints used by the nested `CaptureReviewPanel`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- Mock apiBehaviourClient -----------------------------------------------
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
    listOperations: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCaptures: vi.fn().mockResolvedValue([]),
  };
});

// ---- Mock ArchitectureContext to expose a dispatch spy ---------------------
vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(),
}));

// ---- Mock ProjectContext: return a stable project so we have a name -------
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

// ---- Mock modelApi: loadModelByProjectId returns a sentinel ---------------
vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn(),
}));

import {
  getCaptureSession,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-cache-1';
const ARCH_ID = 'arch-cache-1';
const SESSION_ID = 'session-cache-1';

const SENTINEL_MODEL = {
  diagrams: [],
  business_actors: [],
  business_processes: [],
  business_capabilities: [],
  business_information_assets: [],
  organisations: [],
  application_components: [],
  application_collaborations: [],
  application_components_users: [],
  application_interfaces: [],
  application_interface_invocations: [],
  application_interface_collaborations: [],
  logical_data_entities: [],
  physical_data_entities: [],
  interactions: [],
  relationships: [],
};

function buildSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'A session',
    status: 'running',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: '2026-05-15T00:00:00Z',
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

let dispatchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  dispatchMock = vi.fn();
  vi.mocked(useArchitectureDispatch).mockReturnValue(dispatchMock as unknown as ReturnType<typeof useArchitectureDispatch>);
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Cache Test Project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(loadModelByProjectId).mockResolvedValue(SENTINEL_MODEL as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CaptureSessionDetailView -- cache invalidation (Task 10.1 #1)', () => {
  it('dispatches LOAD_MODEL exactly once on the running -> completed transition with the freshly-fetched model', async () => {
    vi.useFakeTimers();

    const running = buildSession({ status: 'running' });
    const completed = buildSession({
      status: 'completed',
      completed_at: '2026-05-15T00:01:00Z',
    });

    vi.mocked(getCaptureSession)
      .mockResolvedValueOnce(running) // initial load
      .mockResolvedValueOnce(running) // first poll
      .mockResolvedValueOnce(completed) // second poll -> terminal transition
      .mockResolvedValue(completed); // any further calls

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

    // First poll: still running. Edge detector must NOT fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const loadModelDispatchesAfterPoll1 = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL',
    );
    expect(loadModelDispatchesAfterPoll1).toHaveLength(0);
    expect(loadModelByProjectId).not.toHaveBeenCalled();

    // Second poll: status transitions to completed. Edge detector fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // Flush the loadModelByProjectId promise + the .then dispatch.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadModelByProjectId).toHaveBeenCalledTimes(1);
    expect(loadModelByProjectId).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);

    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL',
    );
    expect(loadModelDispatches).toHaveLength(1);
    expect(loadModelDispatches[0][0].payload).toBe(SENTINEL_MODEL);
    expect(loadModelDispatches[0][0].fileName).toBe('Cache Test Project');
  });
});

describe('CaptureSessionDetailView -- no dispatch spam during polling (Task 10.1 #3)', () => {
  it('does NOT dispatch LOAD_MODEL on every poll while status remains running', async () => {
    vi.useFakeTimers();

    const running = buildSession({ status: 'running' });

    // Return `running` for every call -- no terminal transition.
    vi.mocked(getCaptureSession).mockResolvedValue(running);

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        pollIntervalMs={2500}
      />,
    );

    // Flush initial load.
    await act(async () => {
      await Promise.resolve();
    });

    // Advance through MANY polling ticks.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
    }

    // getCaptureSession was called many times (initial + 5 polls).
    expect(vi.mocked(getCaptureSession).mock.calls.length).toBeGreaterThanOrEqual(5);

    // BUT no LOAD_MODEL dispatch should have fired, because the status
    // never transitioned. And loadModelByProjectId was never called.
    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL',
    );
    expect(loadModelDispatches).toHaveLength(0);
    expect(loadModelByProjectId).not.toHaveBeenCalled();
  });

  it('does NOT dispatch LOAD_MODEL when the session is already terminal on first load (no edge to detect)', async () => {
    // Session starts in `completed`: there was no transition observed in
    // this UI session, so AppShell has already loaded the model elsewhere
    // and we should not double-fire.
    const completed = buildSession({
      status: 'completed',
      completed_at: '2026-05-15T00:01:00Z',
    });
    vi.mocked(getCaptureSession).mockResolvedValue(completed);

    renderWithRouter(
      <CaptureSessionDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />,
    );

    // Wait for initial load to settle.
    await screen.findByTestId('capture-session-detail-view');
    // Flush any queued microtasks.
    await act(async () => {
      await Promise.resolve();
    });

    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL',
    );
    expect(loadModelDispatches).toHaveLength(0);
    expect(loadModelByProjectId).not.toHaveBeenCalled();
  });
});
