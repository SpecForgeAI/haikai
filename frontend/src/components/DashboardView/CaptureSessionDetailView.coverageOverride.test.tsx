/**
 * CaptureSessionDetailView -- coverage-override banner tests
 *
 * Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 4 (4.1f)
 *
 * Coverage: when `coverage_override_justification` is non-null the detail
 * view shows the override banner (justification + unaccounted count at
 * override time + timestamp); when null (legacy / never-overridden rows)
 * nothing renders and the view behaves exactly as before.
 *
 * Test strategy mirrors `CaptureSessionDetailView.test.tsx`: api client
 * mocked with the `vi.importActual` spread pattern, MemoryRouter wrap,
 * ArchitectureContext / ProjectContext / modelApi stubbed as no-ops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    getCaptureSession: vi.fn(),
    cancelCaptureSession: vi.fn(),
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
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';

const PROJECT_ID = 'proj-override-1';
const ARCH_ID = 'arch-override-1';
const SESSION_ID = 'session-override-1';

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
    auth_type: 'none',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: '2026-06-11T00:00:00Z',
    updated_at: '2026-06-11T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureSessionDetailView -- coverage-override banner (Task 4.1f)', () => {
  it('shows the banner with justification, unaccounted count, and timestamp when the override trio is set -- and nothing when null', async () => {
    // Overridden session: the /start gate was bypassed with a persisted
    // justification + count + timestamp.
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({
        coverage_override_justification: 'Decommissioned endpoints accepted',
        coverage_override_unaccounted_count: 3,
        coverage_override_at: '2026-06-11T09:30:00Z',
      }),
    );

    const first = render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
        />
      </MemoryRouter>,
    );

    const banner = await screen.findByTestId('capture-session-coverage-override-banner');
    expect(banner).toHaveTextContent('Inventory coverage gate was overridden at start.');
    expect(banner).toHaveTextContent('Decommissioned endpoints accepted');
    expect(banner).toHaveTextContent(/3\s+in-scope committed endpoint/);
    expect(banner).toHaveTextContent('2026-06-11T09:30:00Z');

    first.unmount();

    // Legacy / never-overridden session (all-null trio): no banner at all.
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({
        coverage_override_justification: null,
        coverage_override_unaccounted_count: null,
        coverage_override_at: null,
      }),
    );

    render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId('capture-session-detail-view');
    expect(
      screen.queryByTestId('capture-session-coverage-override-banner'),
    ).not.toBeInTheDocument();
  });
});
