/**
 * StartTargetReplayWizard + related target-capture surface tests
 *
 * Spec 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 5
 * Task 5.1.
 *
 * Coverage (the 4 tests authorised by the test cap in tasks.md):
 *   1. Source baseline picker (Step 1) lists ONLY
 *      `kind='current', status='active'` baselines for the bound project +
 *      architecture; Next is disabled until the user picks one.
 *   2. Target URL validation on Step 2 blocks Next for an empty / malformed
 *      `targetBaseUrl`; a valid `https://` URL allows progression.
 *   3. Progress polling: `CaptureSessionDetailView` polls
 *      `getCaptureSession` at the configured cadence while a target
 *      session's status is `running` and stops once the status reaches a
 *      terminal value -- proving the polling cadence is kind-agnostic and
 *      reused as-is for target sessions.
 *   4. Manual-reject toggle on `CaptureReviewPanel` still works for
 *      auto-accepted target items: clicking Reject + Confirm sends a PATCH
 *      with `accepted=false`. Confirms the panel is kind-agnostic and the
 *      target-side review surface inherits the toggle unchanged.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - The api client module is mocked so step transitions never reach a
 *     real network call.
 *   - The wizard is rendered standalone (no MemoryRouter required since it
 *     doesn't use react-router). The CaptureSessionDetailView and
 *     CaptureReviewPanel tests follow the existing patterns in
 *     `CaptureSessionDetailView.test.tsx` and `CaptureReviewPanel.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ============================================================================
// Shared mocks
// ============================================================================

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    listBaselines: vi.fn(),
    listBaselineItems: vi.fn(),
    createTargetCaptureSession: vi.fn(),
    setTargetSessionSecrets: vi.fn(),
    startTargetCaptureSession: vi.fn(),
    // CaptureSessionDetailView polling test:
    getCaptureSession: vi.fn(),
    cancelCaptureSession: vi.fn(),
    cloneCaptureSession: vi.fn(),
    startCaptureSession: vi.fn(),
    submitSecrets: vi.fn(),
    testApiConnection: vi.fn(),
    testDbConnection: vi.fn(),
    // CaptureReviewPanel mount needs these stubs:
    listOperations: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCaptures: vi.fn().mockResolvedValue([]),
    updateCapture: vi.fn(),
    updateScenario: vi.fn(),
    createBaseline: vi.fn(),
    createBaselineItem: vi.fn(),
  };
});

// CaptureSessionDetailView consumes useArchitectureDispatch + useProject +
// loadModelByProjectId for the model-cache refresh on terminal transitions.
// Stub them as no-ops so the polling test doesn't need a full provider tree.
vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
}));

// ============================================================================
// Imports under test (must come after mocks per Vitest hoisting semantics)
// ============================================================================

import {
  listBaselines,
  listBaselineItems,
  getCaptureSession,
  updateCapture,
  type ApiBehaviourBaselineDto,
  type ApiBehaviourCaptureSessionDto,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { loadModelByProjectId } from '../../api/modelApi';
import { StartTargetReplayWizard } from './StartTargetReplayWizard';
import { CaptureSessionDetailView } from '../DashboardView/CaptureSessionDetailView';
import { CaptureReviewPanel } from '../DashboardView/CaptureReviewPanel';

// ============================================================================
// Constants / fixtures
// ============================================================================

const PROJECT_ID = 'proj-target-1';
const ARCH_ID = 'arch-target-1';
const SESSION_ID = 'session-target-1';

function buildBaseline(
  id: string,
  overrides: Partial<ApiBehaviourBaselineDto> = {},
): ApiBehaviourBaselineDto {
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: null,
    name: `Baseline ${id}`,
    status: 'active',
    accepted_capture_count: 3,
    operation_count: 5,
    notes: null,
    created_at: '2026-05-25T00:00:00Z',
    updated_at: '2026-05-25T00:00:00Z',
    kind: 'current',
    paired_with_baseline_id: null,
    ...overrides,
  };
}

function buildTargetSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Target replay of Baseline X',
    status: 'running',
    environment_name: null,
    api_base_url: 'https://api.uat.example.com',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: '2026-05-25T00:00:00Z',
    completed_at: null,
    error_message: null,
    created_at: '2026-05-25T00:00:00Z',
    updated_at: '2026-05-25T00:00:00Z',
    kind: 'target',
    source_baseline_id: 'src-baseline-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The afterEach restoreAllMocks() strips the factory default off this
  // module mock; re-arm it so the terminal-transition model-cache refresh in
  // CaptureSessionDetailView stays a resolved promise across every test.
  vi.mocked(loadModelByProjectId).mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1: source baseline picker filters by kind + status, gates Next
// ============================================================================

describe('StartTargetReplayWizard -- source baseline picker (Task 5.1 #1)', () => {
  it("lists only kind='current', status='active' baselines and gates Next on selection", async () => {
    // The wizard calls listBaselines with kind='current'. We belt-and-braces
    // assert by including a draft current baseline AND a target baseline in
    // the response (which the wizard's belt-and-braces filter must also
    // exclude). Only the two active current baselines should appear.
    const active1 = buildBaseline('cur-active-1', { name: 'Active A', status: 'active' });
    const active2 = buildBaseline('cur-active-2', { name: 'Active B', status: 'active' });
    const draft = buildBaseline('cur-draft-1', { name: 'Draft baseline', status: 'draft' });
    const targetSneak = buildBaseline('tgt-sneak-1', {
      name: 'Should not appear',
      kind: 'target',
      paired_with_baseline_id: 'cur-active-1',
    });
    vi.mocked(listBaselines).mockResolvedValueOnce([
      active1,
      active2,
      draft,
      targetSneak,
    ]);

    render(
      <StartTargetReplayWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Wait for the baseline list to render.
    await screen.findByTestId('start-target-replay-wizard-baseline-list');

    // The two active current baselines should be visible; the draft +
    // target baselines must NOT be.
    expect(
      screen.getByTestId('start-target-replay-wizard-baseline-cur-active-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('start-target-replay-wizard-baseline-cur-active-2'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('start-target-replay-wizard-baseline-cur-draft-1'),
    ).toBeNull();
    expect(
      screen.queryByTestId('start-target-replay-wizard-baseline-tgt-sneak-1'),
    ).toBeNull();

    // The Next button starts disabled (no selection) and enables once the
    // user picks a baseline.
    const next = screen.getByTestId(
      'start-target-replay-wizard-next',
    ) as HTMLButtonElement;
    expect(next).toBeDisabled();

    // Pick the first eligible baseline.
    const radioRow = screen.getByTestId(
      'start-target-replay-wizard-baseline-cur-active-1',
    );
    const radio = within(radioRow).getByRole('radio') as HTMLInputElement;
    fireEvent.click(radio);
    expect(radio.checked).toBe(true);

    expect(next).not.toBeDisabled();

    // Confirm the wizard passed the kind filter through.
    expect(listBaselines).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, { kind: 'current' });
  });
});

// ============================================================================
// Test 2: target URL validation blocks Next on Step 2
// ============================================================================

describe('StartTargetReplayWizard -- target URL validation (Task 5.1 #2)', () => {
  it('blocks Next on Step 2 for an empty / malformed targetBaseUrl and allows it once an https URL is entered', async () => {
    const active = buildBaseline('cur-active-1', {
      name: 'Source',
      status: 'active',
    });
    vi.mocked(listBaselines).mockResolvedValueOnce([active]);
    vi.mocked(listBaselineItems).mockResolvedValueOnce([
      // The item-count fetch is informational; an empty list is fine.
    ]);

    render(
      <StartTargetReplayWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Step 1: pick the source baseline.
    await screen.findByTestId('start-target-replay-wizard-baseline-list');
    const radioRow = screen.getByTestId(
      'start-target-replay-wizard-baseline-cur-active-1',
    );
    const radio = within(radioRow).getByRole('radio') as HTMLInputElement;
    fireEvent.click(radio);

    // Advance to Step 2. The advance is async (items fetch), so flush.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-target-replay-wizard-next'));
    });

    // The Next button on Step 2 is now visible. It starts disabled
    // (targetBaseUrl is empty).
    const next = screen.getByTestId(
      'start-target-replay-wizard-next',
    ) as HTMLButtonElement;
    expect(next).toBeDisabled();

    // Typing a clearly-malformed URL must NOT enable Next.
    const urlInput = screen.getByTestId(
      'start-target-replay-wizard-base-url',
    ) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } });
    expect(next).toBeDisabled();

    fireEvent.change(urlInput, { target: { value: 'ftp://example.com' } });
    expect(next).toBeDisabled();

    // A valid https URL enables Next.
    fireEvent.change(urlInput, {
      target: { value: 'https://api.uat.example.com' },
    });
    expect(next).not.toBeDisabled();
  });
});

// ============================================================================
// Test 3: progress polling on a target session uses the same cadence and
// terminal-stop semantics as current-state sessions
// ============================================================================

describe('StartTargetReplayWizard -- progress polling for target sessions (Task 5.1 #3)', () => {
  it('CaptureSessionDetailView polls at the configured cadence while a target session is running and stops on terminal status', async () => {
    vi.useFakeTimers();

    const running = buildTargetSession({ status: 'running' });
    const completed = buildTargetSession({
      status: 'completed',
      completed_at: '2026-05-25T00:01:00Z',
    });

    vi.mocked(getCaptureSession)
      .mockResolvedValueOnce(running) // initial load
      .mockResolvedValueOnce(running) // first poll
      .mockResolvedValueOnce(completed) // second poll -> terminal
      .mockResolvedValue(completed); // any further calls

    render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
          pollIntervalMs={2500}
        />
      </MemoryRouter>,
    );

    // Flush the initial load promise.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(1);

    // Advance one polling tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(2);

    // Advance another tick -> terminal landing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(3);

    // Polling must stop after terminal. Advance multiple intervals more --
    // the call count must NOT climb.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getCaptureSession).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// Test 4: manual-reject toggle on CaptureReviewPanel works for auto-accepted
// target items
// ============================================================================

describe('CaptureReviewPanel -- manual-reject toggle for target captures (Task 5.1 #4)', () => {
  it('PATCHes accepted=false when the user rejects an auto-accepted target item', async () => {
    // Single operation + scenario + auto-accepted capture (simulating the
    // target replay runner's "every replay auto-accepts" output shape).
    const operation: ApiBehaviourOperationDto = {
      id: 'op-1',
      session_id: SESSION_ID,
      operation_id: 'getUsers',
      method: 'GET',
      path: '/users',
      summary: 'List users',
      description: null,
      included: true,
      safe_to_execute: true,
      request_schema_json: null,
      response_schema_json: null,
      oas_operation_json: null,
      created_at: '2026-05-25T00:00:00Z',
      updated_at: '2026-05-25T00:00:00Z',
    };
    const scenario: ApiBehaviourScenarioDto = {
      id: 'sc-1',
      session_id: SESSION_ID,
      operation_id: 'op-1',
      scenario_name: 'happy path',
      scenario_type: 'happy_path',
      status: 'done',
      generation_source: 'replay',
      request_method: 'GET',
      request_path: '/users',
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      notes: null,
      created_at: '2026-05-25T00:00:00Z',
      updated_at: '2026-05-25T00:00:00Z',
    };
    const capture: ApiBehaviourCaptureDto = {
      id: 'cap-1',
      session_id: SESSION_ID,
      scenario_id: 'sc-1',
      operation_id: 'op-1',
      attempt_number: 1,
      request_method: 'GET',
      request_url_redacted: 'https://api.uat.example.com/users',
      request_path: '/users',
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      response_status: 200,
      response_headers_redacted_json: null,
      response_body_json: { users: [] },
      duration_ms: 42,
      error_type: null,
      error_message: null,
      captured_at: '2026-05-25T00:00:00Z',
      // Auto-accepted by the target replay runner. The manual-reject toggle
      // must flip this to false via a PATCH.
      accepted: true,
      accepted_at: '2026-05-25T00:00:00Z',
      reviewer_notes: null,
    };

    const { listOperations, listScenarios, listCaptures } = await import(
      '../../api/apiBehaviourClient'
    );
    vi.mocked(listOperations).mockResolvedValue([operation]);
    vi.mocked(listScenarios).mockResolvedValue([scenario]);
    vi.mocked(listCaptures).mockResolvedValue([capture]);
    vi.mocked(updateCapture).mockResolvedValue({
      ...capture,
      accepted: false,
      accepted_at: null,
      reviewer_notes: JSON.stringify({ text: 'broken response', masks: [] }),
    });

    render(
      <MemoryRouter>
        <CaptureReviewPanel
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
        />
      </MemoryRouter>,
    );

    // Wait for the panel to load and surface the reject button. The button
    // surfaces for every reviewable capture regardless of kind.
    const rejectButton = await screen.findByTestId('capture-review-reject-button');
    expect(rejectButton).toBeInTheDocument();

    // Click reject -> inline form opens.
    fireEvent.click(rejectButton);
    const notesInput = await screen.findByTestId(
      'capture-review-reject-notes-input',
    );
    fireEvent.change(notesInput, { target: { value: 'broken response' } });

    // Click Confirm reject -> updateCapture is called with accepted=false.
    fireEvent.click(screen.getByTestId('capture-review-reject-submit'));

    // Flush the async PATCH.
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateCapture).toHaveBeenCalledTimes(1);
    const [pid, aid, cid, payload] = vi.mocked(updateCapture).mock.calls[0];
    expect(pid).toBe(PROJECT_ID);
    expect(aid).toBe(ARCH_ID);
    expect(cid).toBe('cap-1');
    expect(payload.accepted).toBe(false);
    // Confirm the notes text round-trips through the structured wrapper.
    expect(typeof payload.reviewer_notes).toBe('string');
    expect(payload.reviewer_notes as string).toContain('broken response');
  });
});
