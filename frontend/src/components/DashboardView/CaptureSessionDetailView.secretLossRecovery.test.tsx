/**
 * CaptureSessionDetailView -- secret-loss recovery CTA click-through test
 * (Task Group 11.3 gap-fill #2b).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 11.
 *
 * Why: `CaptureSessionDetailView.test.tsx` (Group 8.1 #4) verifies the
 * Clone-configuration and Re-enter-and-restart CTAs are rendered when a
 * session is marked `failed` with `error_message='secrets_lost_during_run'`,
 * but no existing test exercises the click flow:
 *
 *   - "Clone configuration" must call `cloneCaptureSession(projectId,
 *     architectureId, failedSession)` and navigate to the clone's detail
 *     URL.
 *   - "Re-enter secrets and start a new run" must call the same clone
 *     helper and navigate to the same URL plus a `#enter-secrets` hash so
 *     the destination auto-opens the secrets prompt.
 *
 * This closes the loop on the secret-loss recovery story (startup
 * reconciliation -> session marked failed -> UI surfaces CTAs -> click
 * lands a new draft session).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- Mock react-router-dom: keep MemoryRouter real, stub useNavigate -----
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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
  cloneCaptureSession,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-recovery-1';
const ARCH_ID = 'arch-recovery-1';
const FAILED_SESSION_ID = 'session-failed-1';
const CLONE_SESSION_ID = 'session-clone-1';

function buildFailedSession(): ApiBehaviourCaptureSessionDto {
  return {
    id: FAILED_SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'orphan session',
    status: 'failed',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: '2026-05-15T00:00:00Z',
    completed_at: '2026-05-15T00:01:00Z',
    error_message: 'secrets_lost_during_run',
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:01:00Z',
  };
}

function buildClonedDraft(): ApiBehaviourCaptureSessionDto {
  return {
    ...buildFailedSession(),
    id: CLONE_SESSION_ID,
    name: 'orphan session (clone)',
    status: 'draft',
    started_at: null,
    completed_at: null,
    error_message: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNavigate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureSessionDetailView -- secret-loss recovery CTAs (Task 11.3 gap-fill)', () => {
  it('clicking "Clone configuration" clones the failed session and navigates to the new draft detail URL', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(buildFailedSession());
    vi.mocked(cloneCaptureSession).mockResolvedValueOnce(buildClonedDraft());

    render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={FAILED_SESSION_ID}
        />
      </MemoryRouter>,
    );

    // Wait for the failed session to mount and the CTAs to render.
    await screen.findByTestId('capture-session-detail-clone-config-cta');

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('capture-session-detail-clone-config-cta'),
      );
      // Flush the clone promise and the navigate side-effect.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloneCaptureSession).toHaveBeenCalledTimes(1);
    const [proj, arch, source] = vi.mocked(cloneCaptureSession).mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(arch).toBe(ARCH_ID);
    expect(source.id).toBe(FAILED_SESSION_ID);

    // Navigation lands on the clone's detail URL (no #enter-secrets hash).
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/sessions/${CLONE_SESSION_ID}`,
    );
  });

  it('clicking "Re-enter secrets and start a new run" clones AND adds the #enter-secrets hash so the destination auto-opens the secrets prompt', async () => {
    vi.mocked(getCaptureSession).mockResolvedValueOnce(buildFailedSession());
    vi.mocked(cloneCaptureSession).mockResolvedValueOnce(buildClonedDraft());

    render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={FAILED_SESSION_ID}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId('capture-session-detail-reenter-and-restart-cta');

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('capture-session-detail-reenter-and-restart-cta'),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloneCaptureSession).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    // The destination URL carries the #enter-secrets hash per spec section
    // "Secret-loss UX (after process restart)".
    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/sessions/${CLONE_SESSION_ID}#enter-secrets`,
    );
  });
});
