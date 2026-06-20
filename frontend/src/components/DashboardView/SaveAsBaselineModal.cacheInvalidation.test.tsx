/**
 * SaveAsBaselineModal -- AppShell model cache invalidation tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 10
 * Task 10.1 sub-test #2.
 *
 * Per `project_appshell_model_cache.md`: the baseline create + bulk
 * baseline-item create writes rows to AMS tables that the AppShell
 * per-(project, architecture) in-memory model cache is unaware of. The
 * save flow is always scoped to the currently-active architecture
 * (same-arch flow), so we dispatch `LOAD_MODEL` with a fresh fetch
 * BEFORE navigating to the baselines list (Spec 2026-06-20, R4: the save
 * lands on the LIST route, not the per-item detail dump; the new baseline
 * shows there as draft and is activated via a separate Make Active action).
 *
 * Coverage:
 *   1. Successful save: after the baseline + baseline-items are written in
 *      ONE best-effort batch call, the modal dispatches `LOAD_MODEL` with
 *      the freshly-fetched model and then navigates to the baselines LIST.
 *   2. Cache-refresh failure path: when `loadModelByProjectId` rejects,
 *      the modal STILL navigates to the baselines list (the cache-refresh
 *      failure is non-fatal for the success path).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- Mock react-router-dom: stub useNavigate ------------------------------
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

// ---- Mock apiBehaviourClient ----------------------------------------------
vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    createBaseline: vi.fn(),
    createBaselineItemsBatch: vi.fn(),
    updateBaseline: vi.fn(),
  };
});

// ---- Mock ArchitectureContext for dispatch spy ----------------------------
vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(),
}));

// ---- Mock ProjectContext for active project name -------------------------
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

// ---- Mock modelApi: loadModelByProjectId returns a sentinel ---------------
vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn(),
}));

import {
  createBaseline,
  createBaselineItemsBatch,
  updateBaseline,
  type ApiBehaviourBaselineDto,
  type ApiBehaviourBaselineItemDto,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { SaveAsBaselineModal } from './SaveAsBaselineModal';

const PROJECT_ID = 'proj-baseline-cache-1';
const ARCH_ID = 'arch-baseline-cache-1';
const SESSION_ID = 'session-baseline-cache-1';
const BASELINE_ID = 'baseline-cache-1';

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

function buildBaselineResponse(): ApiBehaviourBaselineDto {
  return {
    id: BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: SESSION_ID,
    name: 'baseline v1',
    status: 'draft',
    accepted_capture_count: 1,
    operation_count: 1,
    notes: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
  } as ApiBehaviourBaselineDto;
}

function buildAcceptedCapture(): ApiBehaviourCaptureDto {
  return {
    id: 'cap-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_id: 'sc-1',
    attempt_number: 1,
    request_method: 'GET',
    request_path: '/owners',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    response_status: 200,
    response_headers_redacted_json: null,
    response_body_json: { ok: true },
    duration_ms: 12,
    error_type: null,
    error_message: null,
    captured_at: '2026-05-15T00:00:00Z',
    accepted: true,
    accepted_at: '2026-05-15T00:00:01Z',
    reviewer_notes: null,
  } as unknown as ApiBehaviourCaptureDto;
}

function buildOperation(): ApiBehaviourOperationDto {
  return {
    id: 'op-1',
    session_id: SESSION_ID,
    operation_id: 'getOwners',
    method: 'GET',
    path: '/owners',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
  } as unknown as ApiBehaviourOperationDto;
}

function buildScenario(): ApiBehaviourScenarioDto {
  return {
    id: 'sc-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_name: 'happy path',
    scenario_type: 'happy_path',
    status: 'executed_success',
    generation_source: 'llm_generated',
    request_method: 'GET',
    request_path: '/owners',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    notes: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
  } as unknown as ApiBehaviourScenarioDto;
}

function renderModal() {
  return render(
    <MemoryRouter>
      <SaveAsBaselineModal
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        captures={[buildAcceptedCapture()]}
        operations={[buildOperation()]}
        scenarios={[buildScenario()]}
        operationsWithoutAccepted={[]}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

let dispatchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  dispatchMock = vi.fn();
  vi.mocked(useArchitectureDispatch).mockReturnValue(dispatchMock as unknown as ReturnType<typeof useArchitectureDispatch>);
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Baseline Test Project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(loadModelByProjectId).mockResolvedValue(SENTINEL_MODEL as never);
  vi.mocked(createBaseline).mockResolvedValue(buildBaselineResponse());
  vi.mocked(createBaselineItemsBatch).mockResolvedValue({
    created: [{ id: 'item-1' } as unknown as ApiBehaviourBaselineItemDto],
    failed: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SaveAsBaselineModal -- cache invalidation (Task 10.1 #2)', () => {
  it('dispatches LOAD_MODEL with the freshly-fetched model after baseline + items are written, then navigates', async () => {
    renderModal();

    // Type a name (canSubmit gates on a non-empty name).
    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    // Wait for createBaseline + the batch item create to have been called.
    await waitFor(() => {
      expect(createBaseline).toHaveBeenCalledTimes(1);
      expect(createBaselineItemsBatch).toHaveBeenCalledTimes(1);
    });

    // Cache refresh: loadModelByProjectId called with active arch.
    await waitFor(() => {
      expect(loadModelByProjectId).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);
    });

    // LOAD_MODEL dispatched with the freshly-fetched sentinel model.
    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL',
    );
    expect(loadModelDispatches).toHaveLength(1);
    expect(loadModelDispatches[0][0].payload).toBe(SENTINEL_MODEL);
    expect(loadModelDispatches[0][0].fileName).toBe('Baseline Test Project');

    // Navigation to the baselines LIST route fired (NOT the per-item
    // detail dump): the new baseline shows there as draft; activation is a
    // separate Make Active action (Spec 2026-06-20, R4).
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour`,
      );
    });
  });

  it('still navigates to the baselines list when the cache refresh fails (non-fatal)', async () => {
    // loadModelByProjectId rejects -- the dispatch path should swallow,
    // log, and STILL navigate to the baselines list route.
    vi.mocked(loadModelByProjectId).mockRejectedValueOnce(
      new Error('network failure during refresh'),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderModal();
    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    // Even though the refresh failed, navigation still fires (to the LIST).
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour`,
      );
    });

    // No LOAD_MODEL dispatch (the model fetch failed before the .then).
    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL',
    );
    expect(loadModelDispatches).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});

/**
 * SaveAsBaselineModal -- best-effort batch save (Spec 2026-06-20, R1/R4).
 *
 * The save POSTs every accepted capture in ONE `createBaselineItemsBatch`
 * call rather than looping one gateway request per capture (the loop tripped
 * the rate limiter). The call is NON-atomic: a bad item is reported in
 * `failed[]` WITHOUT aborting the rest, so the save still succeeds for the
 * `created` rows and the modal surfaces a non-fatal warning. The baseline is
 * left as `draft` -- there is NO `updateBaseline` status call here (activation
 * is a deliberate, separate Make Active action).
 */
describe('SaveAsBaselineModal -- best-effort batch save (Spec 2026-06-20)', () => {
  it('saves every accepted capture in ONE createBaselineItemsBatch call (not one call per capture)', async () => {
    // Three accepted captures: the former per-capture loop would have fired
    // three separate gateway POSTs (and tripped the rate limiter).
    const captures = [
      buildAcceptedCapture(),
      {
        ...buildAcceptedCapture(),
        id: 'cap-2',
      } as unknown as ApiBehaviourCaptureDto,
      {
        ...buildAcceptedCapture(),
        id: 'cap-3',
      } as unknown as ApiBehaviourCaptureDto,
    ];
    vi.mocked(createBaselineItemsBatch).mockResolvedValue({
      created: [
        { id: 'item-1' } as unknown as ApiBehaviourBaselineItemDto,
        { id: 'item-2' } as unknown as ApiBehaviourBaselineItemDto,
        { id: 'item-3' } as unknown as ApiBehaviourBaselineItemDto,
      ],
      failed: [],
    });

    render(
      <MemoryRouter>
        <SaveAsBaselineModal
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
          captures={captures}
          operations={[buildOperation()]}
          scenarios={[buildScenario()]}
          operationsWithoutAccepted={[]}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    // ONE batch call regardless of capture count -- the headline rate-limit fix.
    await waitFor(() =>
      expect(createBaselineItemsBatch).toHaveBeenCalledTimes(1),
    );
    // The single call carried ALL three accepted captures as items.
    const [, , items] = vi.mocked(createBaselineItemsBatch).mock.calls[0];
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.capture_id)).toEqual([
      'cap-1',
      'cap-2',
      'cap-3',
    ]);
  });

  it('surfaces a non-fatal warning naming the captures in the returned failed[] and still navigates', async () => {
    vi.mocked(createBaselineItemsBatch).mockResolvedValue({
      created: [{ id: 'item-1' } as unknown as ApiBehaviourBaselineItemDto],
      failed: [
        { index: 1, capture_id: 'cap-2', reason: 'requestJson is required' },
      ],
    });

    render(
      <MemoryRouter>
        <SaveAsBaselineModal
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
          captures={[
            buildAcceptedCapture(),
            {
              ...buildAcceptedCapture(),
              id: 'cap-2',
            } as unknown as ApiBehaviourCaptureDto,
          ]}
          operations={[buildOperation()]}
          scenarios={[buildScenario()]}
          operationsWithoutAccepted={[]}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    // The failed item is surfaced as a non-fatal warning naming the capture.
    const warning = await screen.findByTestId(
      'save-as-baseline-batch-warning',
    );
    expect(warning.textContent).toContain('cap-2');
    expect(warning.textContent).toMatch(/could not be saved/i);

    // Best-effort: the save still proceeds to navigate to the list.
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour`,
      ),
    );
  });

  it('leaves the baseline as draft -- no updateBaseline status call happens here', async () => {
    render(
      <MemoryRouter>
        <SaveAsBaselineModal
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
          captures={[buildAcceptedCapture()]}
          operations={[buildOperation()]}
          scenarios={[buildScenario()]}
          operationsWithoutAccepted={[]}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    // The save completes (one batch call) and navigates to the list...
    await waitFor(() =>
      expect(createBaselineItemsBatch).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour`,
      ),
    );
    // ...but the baseline is NEVER activated from here (no auto-activate).
    expect(updateBaseline).not.toHaveBeenCalled();
  });
});
