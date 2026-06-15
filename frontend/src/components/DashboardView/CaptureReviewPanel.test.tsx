/**
 * CaptureReviewPanel + SaveAsBaselineModal tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 9
 * Task 9.1 sub-tests:
 *   1. Capture-row table renders captures grouped by operation × scenario.
 *   2. Accept action PATCHes the capture row with `accepted=true,
 *      accepted_at=<iso>`.
 *   3. Reject + reviewer-notes flow PATCHes with `accepted=false` AND the
 *      structured reviewer_notes payload carrying the entered text.
 *   4. Rename scenario + mask field both persist via PATCH against the
 *      scenarios resource and the captures resource respectively, with the
 *      mask payload encoded inside the reviewer_notes JSON.
 *   5. Save-as-Baseline flow creates a Baseline row + BaselineItem rows for
 *      ONLY the accepted captures.
 *   6. NO `Rerun` button is rendered anywhere in the review UI -- not even
 *      a disabled placeholder.
 *
 * Test strategy:
 *   - Mock `apiBehaviourClient` per the spread-actual + override pattern so
 *     the parse / serialise helpers from the real module are still in use
 *     in component code paths that don't go through the network.
 *   - Stub `react-router-dom`'s `useNavigate` so we can assert the
 *     post-save redirect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- Mock react-router-dom: keep MemoryRouter etc real, stub useNavigate -----
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

// ---- Mock apiBehaviourClient -----------------------------------------------
vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    listOperations: vi.fn(),
    listScenarios: vi.fn(),
    listCaptures: vi.fn(),
    updateCapture: vi.fn(),
    updateScenario: vi.fn(),
    createBaseline: vi.fn(),
    createBaselineItem: vi.fn(),
  };
});

// Task Group 10: SaveAsBaselineModal (mounted from CaptureReviewPanel)
// consumes useArchitectureDispatch and useProject and calls
// loadModelByProjectId for the AppShell model cache refresh on
// successful baseline save. Stub them here so the integration test does
// not need a full provider tree; the cache-refresh behaviour is covered by
// SaveAsBaselineModal.cacheInvalidation.test.tsx.
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
  listOperations,
  listScenarios,
  listCaptures,
  updateCapture,
  updateScenario,
  createBaseline,
  createBaselineItem,
  parseReviewerNotes,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
  type ApiBehaviourBaselineDto,
  type ApiBehaviourBaselineItemDto,
} from '../../api/apiBehaviourClient';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-review-1';
const ARCH_ID = 'arch-review-1';
const SESSION_ID = 'session-review-1';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function buildOperation(
  overrides: Partial<ApiBehaviourOperationDto> = {},
): ApiBehaviourOperationDto {
  return {
    id: 'op-1',
    session_id: SESSION_ID,
    operation_id: 'getThing',
    method: 'GET',
    path: '/things/{id}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

function buildScenario(
  overrides: Partial<ApiBehaviourScenarioDto> = {},
): ApiBehaviourScenarioDto {
  return {
    id: 'sc-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_name: 'happy path',
    scenario_type: 'happy_path',
    status: 'executed_success',
    generation_source: 'llm_generated',
    request_method: 'GET',
    request_path: '/things/42',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    notes: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

function buildCapture(
  overrides: Partial<ApiBehaviourCaptureDto> = {},
): ApiBehaviourCaptureDto {
  return {
    id: 'cap-1',
    session_id: SESSION_ID,
    scenario_id: 'sc-1',
    operation_id: 'op-1',
    attempt_number: 1,
    request_method: 'GET',
    request_url_redacted: 'https://api.example.com/things/42',
    request_path: '/things/42',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    response_status: 200,
    response_headers_redacted_json: null,
    response_body_json: { user: { email: 'alice@example.com' } },
    duration_ms: 42,
    error_type: null,
    error_message: null,
    captured_at: '2026-05-15T00:00:00Z',
    accepted: null,
    accepted_at: null,
    reviewer_notes: null,
    ...overrides,
  };
}

function renderPanel(readOnly = false) {
  return render(
    <MemoryRouter>
      <CaptureReviewPanel
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        readOnly={readOnly}
      />
    </MemoryRouter>,
  );
}

async function flushPromises() {
  // Run a couple of microtask drains -- the panel's effect awaits a
  // Promise.all of three list endpoints before setState.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockNavigate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 9.1 sub-test #1 -- grouping by operation × scenario
// ===========================================================================

describe('CaptureReviewPanel -- groups captures by operation × scenario (Task 9.1 #1)', () => {
  it('renders one row per capture under its operation + scenario grouping', async () => {
    const op1 = buildOperation({ id: 'op-A', method: 'GET', path: '/a' });
    const op2 = buildOperation({ id: 'op-B', method: 'POST', path: '/b' });
    const sc1 = buildScenario({ id: 'sc-A1', operation_id: 'op-A', scenario_name: 'A happy' });
    const sc2 = buildScenario({ id: 'sc-A2', operation_id: 'op-A', scenario_name: 'A 404' });
    const sc3 = buildScenario({ id: 'sc-B1', operation_id: 'op-B', scenario_name: 'B happy' });
    const caps = [
      buildCapture({ id: 'c1', operation_id: 'op-A', scenario_id: 'sc-A1', attempt_number: 1 }),
      buildCapture({ id: 'c2', operation_id: 'op-A', scenario_id: 'sc-A1', attempt_number: 2 }),
      buildCapture({ id: 'c3', operation_id: 'op-A', scenario_id: 'sc-A2', attempt_number: 1 }),
      buildCapture({ id: 'c4', operation_id: 'op-B', scenario_id: 'sc-B1', attempt_number: 1 }),
    ];

    vi.mocked(listOperations).mockResolvedValueOnce([op1, op2]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc1, sc2, sc3]);
    vi.mocked(listCaptures).mockResolvedValueOnce(caps);

    renderPanel();
    await flushPromises();

    const rows = await screen.findAllByTestId('capture-review-row');
    expect(rows).toHaveLength(4);

    // Verify operation × scenario membership via data attributes.
    const byOp = rows.reduce<Record<string, number>>((acc, r) => {
      const opId = r.getAttribute('data-operation-id') ?? '';
      acc[opId] = (acc[opId] ?? 0) + 1;
      return acc;
    }, {});
    expect(byOp['op-A']).toBe(3);
    expect(byOp['op-B']).toBe(1);

    const scA1Rows = rows.filter((r) => r.getAttribute('data-scenario-id') === 'sc-A1');
    const scA2Rows = rows.filter((r) => r.getAttribute('data-scenario-id') === 'sc-A2');
    const scB1Rows = rows.filter((r) => r.getAttribute('data-scenario-id') === 'sc-B1');
    expect(scA1Rows).toHaveLength(2);
    expect(scA2Rows).toHaveLength(1);
    expect(scB1Rows).toHaveLength(1);
  });
});

// ===========================================================================
// Regression -- a list endpoint returning a non-array body (e.g. 204 / empty)
// resolves to `undefined`; previously this crashed `group()` at
// `operations.map(...)` ("Cannot read properties of undefined (reading 'map')").
// The panel must render empty instead.
// ===========================================================================

describe('CaptureReviewPanel -- resilient to non-array list responses (regression)', () => {
  it('renders empty without crashing when the list endpoints resolve to undefined', async () => {
    vi.mocked(listOperations).mockResolvedValueOnce(
      undefined as unknown as ApiBehaviourOperationDto[],
    );
    vi.mocked(listScenarios).mockResolvedValueOnce(
      undefined as unknown as ApiBehaviourScenarioDto[],
    );
    vi.mocked(listCaptures).mockResolvedValueOnce(
      undefined as unknown as ApiBehaviourCaptureDto[],
    );

    renderPanel();
    // Before the fix, this flush threw inside the render of the re-pointed
    // state. After the fix it settles cleanly with zero rows.
    await flushPromises();

    expect(screen.queryAllByTestId('capture-review-row')).toHaveLength(0);
  });
});

// ===========================================================================
// 9.1 sub-test #2 -- accept PATCHes accepted=true + accepted_at
// ===========================================================================

describe('CaptureReviewPanel -- accept action (Task 9.1 #2)', () => {
  it('PATCHes the capture row with accepted=true and accepted_at=<iso>', async () => {
    const op = buildOperation();
    const sc = buildScenario();
    const cap = buildCapture({ id: 'cap-A' });
    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc]);
    vi.mocked(listCaptures).mockResolvedValueOnce([cap]);
    vi.mocked(updateCapture).mockResolvedValueOnce({
      ...cap,
      accepted: true,
      accepted_at: '2026-05-15T01:00:00Z',
    });

    renderPanel();
    await flushPromises();

    const acceptButton = screen.getByTestId('capture-review-accept-button');
    await act(async () => {
      fireEvent.click(acceptButton);
      await Promise.resolve();
    });

    expect(updateCapture).toHaveBeenCalledTimes(1);
    const [proj, arch, captureId, payload] = vi.mocked(updateCapture).mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(arch).toBe(ARCH_ID);
    expect(captureId).toBe('cap-A');
    expect(payload.accepted).toBe(true);
    expect(typeof payload.accepted_at).toBe('string');
    // accepted_at must round-trip through Date.toISOString -- check shape.
    expect(payload.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ===========================================================================
// 9.1 sub-test #3 -- reject + reviewer notes
// ===========================================================================

describe('CaptureReviewPanel -- reject + reviewer notes (Task 9.1 #3)', () => {
  it('PATCHes the capture with accepted=false and reviewer_notes encoding the typed text', async () => {
    const op = buildOperation();
    const sc = buildScenario();
    const cap = buildCapture({ id: 'cap-R' });
    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc]);
    vi.mocked(listCaptures).mockResolvedValueOnce([cap]);
    vi.mocked(updateCapture).mockResolvedValueOnce({
      ...cap,
      accepted: false,
      accepted_at: null,
      reviewer_notes: JSON.stringify({ text: 'irrelevant edge case', masks: [] }),
    });

    renderPanel();
    await flushPromises();

    const rejectButton = screen.getByTestId('capture-review-reject-button');
    fireEvent.click(rejectButton);
    const notesInput = screen.getByTestId(
      'capture-review-reject-notes-input',
    ) as HTMLTextAreaElement;
    fireEvent.change(notesInput, { target: { value: 'irrelevant edge case' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-reject-submit'));
      await Promise.resolve();
    });

    expect(updateCapture).toHaveBeenCalledTimes(1);
    const [, , captureId, payload] = vi.mocked(updateCapture).mock.calls[0];
    expect(captureId).toBe('cap-R');
    expect(payload.accepted).toBe(false);
    expect(payload.accepted_at).toBeNull();
    expect(typeof payload.reviewer_notes).toBe('string');
    const decoded = parseReviewerNotes(payload.reviewer_notes ?? null);
    expect(decoded.text).toBe('irrelevant edge case');
    expect(decoded.masks).toEqual([]);
  });
});

// ===========================================================================
// 9.1 sub-test #4 -- rename scenario + mask field
// ===========================================================================

describe('CaptureReviewPanel -- rename scenario + mask field (Task 9.1 #4)', () => {
  it('PATCHes the scenario with the new name', async () => {
    const op = buildOperation();
    const sc = buildScenario({ scenario_name: 'old name' });
    const cap = buildCapture();
    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc]);
    vi.mocked(listCaptures).mockResolvedValueOnce([cap]);
    vi.mocked(updateScenario).mockResolvedValueOnce({
      ...sc,
      scenario_name: 'fetch-by-id happy',
    });

    renderPanel();
    await flushPromises();

    fireEvent.click(screen.getByTestId('capture-review-rename-button'));
    const renameInput = screen.getByTestId(
      'capture-review-rename-input',
    ) as HTMLInputElement;
    fireEvent.change(renameInput, { target: { value: 'fetch-by-id happy' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-rename-submit'));
      await Promise.resolve();
    });

    expect(updateScenario).toHaveBeenCalledTimes(1);
    const [, , scenarioId, payload] = vi.mocked(updateScenario).mock.calls[0];
    expect(scenarioId).toBe('sc-1');
    expect(payload.scenario_name).toBe('fetch-by-id happy');
  });

  it('PATCHes the capture row with mask metadata encoded into reviewer_notes', async () => {
    const op = buildOperation();
    const sc = buildScenario();
    const cap = buildCapture({ id: 'cap-M' });
    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc]);
    vi.mocked(listCaptures).mockResolvedValueOnce([cap]);
    vi.mocked(updateCapture).mockResolvedValueOnce({
      ...cap,
      reviewer_notes: JSON.stringify({
        text: '',
        masks: [{ path: 'response.body.user.email', label: 'PII' }],
      }),
    });

    renderPanel();
    await flushPromises();

    fireEvent.click(screen.getByTestId('capture-review-mask-button'));
    fireEvent.change(screen.getByTestId('capture-review-mask-path-input'), {
      target: { value: 'response.body.user.email' },
    });
    fireEvent.change(screen.getByTestId('capture-review-mask-label-input'), {
      target: { value: 'PII' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-mask-submit'));
      await Promise.resolve();
    });

    expect(updateCapture).toHaveBeenCalledTimes(1);
    const [, , captureId, payload] = vi.mocked(updateCapture).mock.calls[0];
    expect(captureId).toBe('cap-M');
    const decoded = parseReviewerNotes(payload.reviewer_notes ?? null);
    expect(decoded.masks).toEqual([
      { path: 'response.body.user.email', label: 'PII' },
    ]);
  });
});

// ===========================================================================
// 9.1 sub-test #5 -- Save as Baseline writes baseline + items (accepted only)
// ===========================================================================

describe('SaveAsBaselineModal -- writes baseline + items for accepted captures only (Task 9.1 #5)', () => {
  it('POSTs createBaseline once and createBaselineItem only for accepted captures', async () => {
    const op = buildOperation();
    const sc = buildScenario();
    const acceptedCap = buildCapture({ id: 'cap-yes', accepted: true });
    const rejectedCap = buildCapture({ id: 'cap-no', accepted: false, attempt_number: 2 });
    const undecidedCap = buildCapture({ id: 'cap-meh', accepted: null, attempt_number: 3 });

    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc]);
    vi.mocked(listCaptures).mockResolvedValueOnce([
      acceptedCap,
      rejectedCap,
      undecidedCap,
    ]);

    const baselineRow: ApiBehaviourBaselineDto = {
      id: 'baseline-new',
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      session_id: SESSION_ID,
      name: 'My baseline',
      status: 'draft',
      accepted_capture_count: 1,
      operation_count: 1,
      notes: null,
      created_at: '2026-05-15T00:00:00Z',
      updated_at: '2026-05-15T00:00:00Z',
    };
    vi.mocked(createBaseline).mockResolvedValueOnce(baselineRow);

    const itemRow: ApiBehaviourBaselineItemDto = {
      id: 'item-1',
      baseline_id: 'baseline-new',
      capture_id: 'cap-yes',
      operation_id: 'op-1',
      scenario_id: 'sc-1',
      method: 'GET',
      path: '/things/{id}',
      scenario_name: 'happy path',
      request_json: null,
      response_status: 200,
      response_json: { user: { email: 'alice@example.com' } },
      business_notes: null,
      created_at: '2026-05-15T00:00:00Z',
      updated_at: '2026-05-15T00:00:00Z',
    };
    vi.mocked(createBaselineItem).mockResolvedValueOnce(itemRow);

    renderPanel();
    await flushPromises();

    // Open the modal.
    const openButton = screen.getByTestId('capture-review-open-save-baseline');
    fireEvent.click(openButton);

    const modal = await screen.findByTestId('save-as-baseline-modal');
    const nameInput = within(modal).getByTestId(
      'save-as-baseline-name-input',
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'My baseline' } });

    await act(async () => {
      fireEvent.click(within(modal).getByTestId('save-as-baseline-submit'));
      // Two awaits: one for createBaseline, one for createBaselineItem (1 item).
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Exactly ONE baseline created.
    expect(createBaseline).toHaveBeenCalledTimes(1);
    const baselinePayload = vi.mocked(createBaseline).mock.calls[0][2];
    expect(baselinePayload.name).toBe('My baseline');
    expect(baselinePayload.session_id).toBe(SESSION_ID);

    // ONLY the accepted capture got an item -- not the rejected or undecided ones.
    expect(createBaselineItem).toHaveBeenCalledTimes(1);
    const itemPayload = vi.mocked(createBaselineItem).mock.calls[0][2];
    expect(itemPayload.baseline_id).toBe('baseline-new');
    expect(itemPayload.capture_id).toBe('cap-yes');

    // And the page navigates to the new baseline's detail URL.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/baselines/baseline-new`,
    );
  });
});

// ===========================================================================
// 9.1 sub-test #6 -- NO Rerun button rendered anywhere
// ===========================================================================

describe('CaptureReviewPanel -- no Rerun affordance (Task 9.1 #6)', () => {
  it('does not render any Rerun button, link, or disabled placeholder anywhere in the review UI', async () => {
    const op = buildOperation();
    const sc = buildScenario();
    // Include both accepted and not-accepted captures so the Save-as-Baseline
    // button is also visible -- we still must not surface any Rerun control.
    const caps = [
      buildCapture({ id: 'c1', accepted: true }),
      buildCapture({ id: 'c2', accepted: false, attempt_number: 2 }),
    ];
    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc]);
    vi.mocked(listCaptures).mockResolvedValueOnce(caps);

    const { container } = renderPanel();
    await flushPromises();

    // Sanity: panel mounted with rows.
    expect(screen.getAllByTestId('capture-review-row').length).toBe(2);

    // No element whose accessible text contains "Rerun" (case-insensitive),
    // no test-id mentioning rerun, and no button with a rerun-suggestive
    // aria-label.
    const allText = container.textContent ?? '';
    expect(allText.toLowerCase()).not.toMatch(/\brerun\b/);

    const rerunByTestId = container.querySelector('[data-testid*="rerun" i]');
    expect(rerunByTestId).toBeNull();

    const rerunByAriaLabel = container.querySelector('[aria-label*="rerun" i]');
    expect(rerunByAriaLabel).toBeNull();

    // Belt-and-braces: no button element whose text contains rerun.
    const buttons = Array.from(container.querySelectorAll('button'));
    for (const btn of buttons) {
      expect(btn.textContent?.toLowerCase() ?? '').not.toMatch(/\brerun\b/);
    }
  });
});
