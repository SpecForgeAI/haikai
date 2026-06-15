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
 * BEFORE navigating to the baseline detail view.
 *
 * Coverage:
 *   1. Successful save: after the baseline + baseline-items are written,
 *      the modal dispatches `LOAD_MODEL` with the freshly-fetched model
 *      and then navigates to the baseline detail URL.
 *   2. Cache-refresh failure path: when `loadModelByProjectId` rejects,
 *      the modal STILL navigates to the baseline detail view (the
 *      cache-refresh failure is non-fatal for the success path).
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
    createBaselineItem: vi.fn(),
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
  createBaselineItem,
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
  vi.mocked(createBaselineItem).mockResolvedValue({
    id: 'item-1',
  } as unknown as ApiBehaviourBaselineItemDto);
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

    // Wait for createBaseline + createBaselineItem to have been called.
    await waitFor(() => {
      expect(createBaseline).toHaveBeenCalledTimes(1);
      expect(createBaselineItem).toHaveBeenCalledTimes(1);
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

    // Navigation to the baseline detail URL fired.
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/baselines/${BASELINE_ID}`,
      );
    });
  });

  it('still navigates to the baseline detail view when the cache refresh fails (non-fatal)', async () => {
    // loadModelByProjectId rejects -- the dispatch path should swallow,
    // log, and STILL navigate to the baseline detail URL.
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

    // Even though the refresh failed, navigation still fires.
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/baselines/${BASELINE_ID}`,
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
