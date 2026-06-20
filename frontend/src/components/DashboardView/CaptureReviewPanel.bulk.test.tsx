/**
 * CaptureReviewPanel -- bulk "Accept all" / "Reject all" / "Accept and Save All"
 *
 * Spec: 2026-06-20 Baseline Save & Review -- Batch + Activate -- Task Group 4.
 *
 * These tests pin the rate-limit-fix headline: the header-toolbar bulk actions
 * now collapse to a SINGLE best-effort `updateCapturesBatch` call instead of one
 * gateway PATCH per visible row.
 *   1. "Accept all" calls `updateCapturesBatch` ONCE (not N times) with one
 *      `{ id, patch:{ accepted:true, accepted_at } }` per visible capture, merges
 *      the returned `updated[]` into state, and warns on `failed[]`.
 *   2. "Reject all" (window.confirm -> true) calls `updateCapturesBatch` ONCE
 *      with a PER-ROW notes-preserving patch (`{ accepted:false,
 *      accepted_at:null, reviewer_notes:<that row's masks> }`).
 *   3. "Reject all" is a no-op when window.confirm returns false.
 *   4. "Accept and Save All" runs the accept batch then OPENS the save flow; on
 *      a PARTIAL accept failure it STILL proceeds to the save flow and surfaces
 *      the accept failures as a combined warning.
 *   5. The bulk buttons are hidden when the panel is read-only.
 *
 * Mocks the apiBehaviourClient (spread-actual + override) so the real
 * parse/serialise helpers stay in use; asserts updateCapturesBatch call
 * count/args. The combined action mounts SaveAsBaselineModal, so its context /
 * model-cache deps are stubbed (the save batch itself is covered by
 * SaveAsBaselineModal's own tests -- here we only assert the flow OPENS).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
    listOperations: vi.fn(),
    listScenarios: vi.fn(),
    listCaptures: vi.fn(),
    listDiagnostics: vi.fn(),
    updateCapture: vi.fn(),
    updateCapturesBatch: vi.fn(),
    updateScenario: vi.fn(),
    createBaseline: vi.fn(),
    createBaselineItemsBatch: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn(),
}));

// SaveAsBaselineModal (mounted by the combined "Accept and Save All" flow)
// consumes useArchitectureDispatch / useProject and refreshes the AppShell
// model cache on a successful save. Stub them so the combined-flow test does
// not need a full provider tree.
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
  listDiagnostics,
  updateCapture,
  updateCapturesBatch,
  parseReviewerNotes,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-bulk-1';
const ARCH_ID = 'arch-bulk-1';
const SESSION_ID = 'session-bulk-1';

// ---------------------------------------------------------------------------
// Fixtures (mirror CaptureReviewPanel.test.tsx)
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
    response_body_json: { ok: true },
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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Three captures across two scenarios under one operation. The default
 * `updateCapturesBatch` stub echoes each requested patch onto the matching row
 * and reports no failures.
 */
function seedThreeCaptures(): ApiBehaviourCaptureDto[] {
  const op = buildOperation({ id: 'op-A' });
  const sc1 = buildScenario({ id: 'sc-A1', operation_id: 'op-A', scenario_name: 'A happy' });
  const sc2 = buildScenario({ id: 'sc-A2', operation_id: 'op-A', scenario_name: 'A 404' });
  const caps = [
    buildCapture({ id: 'c1', operation_id: 'op-A', scenario_id: 'sc-A1', attempt_number: 1 }),
    buildCapture({ id: 'c2', operation_id: 'op-A', scenario_id: 'sc-A1', attempt_number: 2 }),
    buildCapture({ id: 'c3', operation_id: 'op-A', scenario_id: 'sc-A2', attempt_number: 1 }),
  ];
  vi.mocked(listOperations).mockResolvedValueOnce([op]);
  vi.mocked(listScenarios).mockResolvedValueOnce([sc1, sc2]);
  vi.mocked(listCaptures).mockResolvedValueOnce(caps);
  vi.mocked(updateCapturesBatch).mockImplementation(async (_p, _a, items) => ({
    updated: items.map((it) => {
      const base = caps.find((c) => c.id === it.id) ?? buildCapture({ id: it.id });
      return { ...base, ...it.patch } as ApiBehaviourCaptureDto;
    }),
    failed: [],
  }));
  return caps;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The panel calls fetchMigrationDiscoveryContext(...).then(...) on mount, so
  // the mock MUST return a thenable. clearAllMocks wipes implementations, so
  // (re)establish a resolved-null result here -- the panel fails soft to null.
  vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof fetchMigrationDiscoveryContext>>,
  );
  vi.mocked(listDiagnostics).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Accept all -- single batch call (rate-limit fix headline)
// ===========================================================================

describe('CaptureReviewPanel -- Accept all', () => {
  it('calls updateCapturesBatch ONCE (not a per-row loop) with accept patches', async () => {
    const caps = seedThreeCaptures();

    renderPanel();
    await flushPromises();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-accept-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // ONE batch call total -- crucially NOT caps.length, and no per-row PATCH.
    expect(updateCapturesBatch).toHaveBeenCalledTimes(1);
    expect(updateCapture).not.toHaveBeenCalled();

    const [proj, arch, items] = vi.mocked(updateCapturesBatch).mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(arch).toBe(ARCH_ID);
    expect(items.map((i) => i.id).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(items).toHaveLength(caps.length);
    for (const item of items) {
      expect(item.patch.accepted).toBe(true);
      expect(typeof item.patch.accepted_at).toBe('string');
      expect(item.patch.accepted_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    }
  });

  it('merges the returned updated[] into the table (accepted tally reflects it)', async () => {
    seedThreeCaptures();

    renderPanel();
    await flushPromises();

    expect(
      screen.getByTestId('capture-review-accepted-count').textContent,
    ).toContain('0 accepted');

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-accept-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stub echoed accepted=true onto each row; the merged state should now
    // show all three as accepted.
    expect(
      screen.getByTestId('capture-review-accepted-count').textContent,
    ).toContain('3 accepted');
  });

  it('surfaces failed[] as a warning naming the failed captures', async () => {
    seedThreeCaptures();
    // Override: c2 fails to patch; c1 + c3 succeed.
    vi.mocked(updateCapturesBatch).mockResolvedValueOnce({
      updated: [
        { ...buildCapture({ id: 'c1' }), accepted: true } as ApiBehaviourCaptureDto,
        { ...buildCapture({ id: 'c3' }), accepted: true } as ApiBehaviourCaptureDto,
      ],
      failed: [{ id: 'c2', reason: 'row not found' }],
    });

    renderPanel();
    await flushPromises();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-accept-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const warning = await screen.findByTestId('capture-review-batch-warning');
    expect(warning.textContent).toContain('c2');
    // The succeeded ids are NOT named as failures.
    expect(warning.textContent).not.toContain('c1');
    expect(warning.textContent).not.toContain('c3');
  });
});

// ===========================================================================
// Reject all -- single batch with per-row notes-preserving patches
// ===========================================================================

describe('CaptureReviewPanel -- Reject all', () => {
  it('calls updateCapturesBatch ONCE with per-row notes-preserving patches', async () => {
    // c2 carries an existing mask in its reviewer_notes -- the reject patch for
    // that row MUST preserve the mask, while c1 / c3 carry none.
    const op = buildOperation({ id: 'op-A' });
    const sc1 = buildScenario({ id: 'sc-A1', operation_id: 'op-A' });
    const caps = [
      buildCapture({ id: 'c1', operation_id: 'op-A', scenario_id: 'sc-A1', attempt_number: 1 }),
      buildCapture({
        id: 'c2',
        operation_id: 'op-A',
        scenario_id: 'sc-A1',
        attempt_number: 2,
        reviewer_notes: JSON.stringify({
          text: 'prior note',
          masks: [{ path: 'response.body.token', label: 'secret' }],
        }),
      }),
      buildCapture({ id: 'c3', operation_id: 'op-A', scenario_id: 'sc-A1', attempt_number: 3 }),
    ];
    vi.mocked(listOperations).mockResolvedValueOnce([op]);
    vi.mocked(listScenarios).mockResolvedValueOnce([sc1]);
    vi.mocked(listCaptures).mockResolvedValueOnce(caps);
    vi.mocked(updateCapturesBatch).mockResolvedValueOnce({ updated: [], failed: [] });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel();
    await flushPromises();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-reject-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateCapturesBatch).toHaveBeenCalledTimes(1);
    expect(updateCapture).not.toHaveBeenCalled();

    const [, , items] = vi.mocked(updateCapturesBatch).mock.calls[0];
    expect(items.map((i) => i.id).sort()).toEqual(['c1', 'c2', 'c3']);
    for (const item of items) {
      expect(item.patch.accepted).toBe(false);
      expect(item.patch.accepted_at).toBeNull();
    }

    // c2's reject patch preserves its existing mask; c1's carries an empty mask
    // list. Decode via the REAL parseReviewerNotes (spread-actual mock).
    const c2 = items.find((i) => i.id === 'c2')!;
    const decodedC2 = parseReviewerNotes(c2.patch.reviewer_notes ?? null);
    expect(decodedC2.masks).toEqual([
      { path: 'response.body.token', label: 'secret' },
    ]);

    const c1 = items.find((i) => i.id === 'c1')!;
    const decodedC1 = parseReviewerNotes(c1.patch.reviewer_notes ?? null);
    expect(decodedC1.masks).toEqual([]);
  });

  it('does nothing when the confirm dialog is dismissed', async () => {
    seedThreeCaptures();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderPanel();
    await flushPromises();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-reject-all'));
      await Promise.resolve();
    });

    expect(updateCapturesBatch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Accept and Save All -- combined flow (proceed-on-partial)
// ===========================================================================

describe('CaptureReviewPanel -- Accept and Save All', () => {
  it('runs the accept batch then OPENS the save flow', async () => {
    seedThreeCaptures();

    renderPanel();
    await flushPromises();

    // Modal not open yet.
    expect(screen.queryByTestId('save-as-baseline-modal')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-accept-and-save-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Accept ran as ONE batch...
    expect(updateCapturesBatch).toHaveBeenCalledTimes(1);
    const [, , items] = vi.mocked(updateCapturesBatch).mock.calls[0];
    for (const item of items) {
      expect(item.patch.accepted).toBe(true);
    }
    // ...then the save flow opened.
    expect(await screen.findByTestId('save-as-baseline-modal')).toBeTruthy();
  });

  it('on a PARTIAL accept failure STILL opens the save flow with a combined warning', async () => {
    seedThreeCaptures();
    // c2 fails to accept; c1 + c3 succeed.
    vi.mocked(updateCapturesBatch).mockResolvedValueOnce({
      updated: [
        { ...buildCapture({ id: 'c1' }), accepted: true } as ApiBehaviourCaptureDto,
        { ...buildCapture({ id: 'c3' }), accepted: true } as ApiBehaviourCaptureDto,
      ],
      failed: [{ id: 'c2', reason: 'row locked' }],
    });

    renderPanel();
    await flushPromises();

    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-accept-and-save-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Proceed-on-partial: the save flow STILL opens for the accepted captures...
    expect(await screen.findByTestId('save-as-baseline-modal')).toBeTruthy();
    // ...and the combined warning names the accept failure (c2) and survives
    // while the modal is open.
    const warning = await screen.findByTestId('capture-review-batch-warning');
    expect(warning.textContent).toContain('c2');
  });
});

// ===========================================================================
// Read-only gating
// ===========================================================================

describe('CaptureReviewPanel -- bulk buttons hidden when read-only', () => {
  it('renders none of the bulk buttons in read-only mode', async () => {
    seedThreeCaptures();

    renderPanel(true);
    await flushPromises();

    expect(screen.queryByTestId('capture-review-accept-all')).toBeNull();
    expect(screen.queryByTestId('capture-review-reject-all')).toBeNull();
    expect(screen.queryByTestId('capture-review-accept-and-save-all')).toBeNull();
  });
});
