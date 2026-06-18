/**
 * SaveAsBaselineModal -- source baseline-item header carry
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types --
 * Task Group 4 (R5, source-side header symmetry). The SOURCE baseline item must
 * pin its response as a `{ headers, body }` envelope SYMMETRIC with the target
 * side (targetReplayRunner stores `{ headers: response_headers_redacted_json,
 * body: response_body_json }`). Without this the reconcile comparator has no
 * source headers to diff against and skips the header dimension entirely.
 *
 * Covered here:
 *   1. The createBaselineItem payload's `response_json` is the
 *      `{ headers, body }` envelope -- headers from response_headers_redacted_json,
 *      body from response_body_json.
 *   2. When the capture row has NO redacted response headers, the envelope still
 *      carries `headers: null` (the comparator degrades gracefully to skip the
 *      header dimension).
 *
 * Conventions mirror SaveAsBaselineModal.cacheInvalidation.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/apiBehaviourClient')
  >('../../api/apiBehaviourClient');
  return { ...actual, createBaseline: vi.fn(), createBaselineItem: vi.fn() };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(),
}));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: vi.fn() }));
vi.mock('../../api/modelApi', () => ({ loadModelByProjectId: vi.fn() }));

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

const PROJECT_ID = 'proj-hc-1';
const ARCH_ID = 'arch-hc-1';
const SESSION_ID = 'session-hc-1';
const BASELINE_ID = 'baseline-hc-1';

const RESPONSE_HEADERS = { 'content-type': 'application/json', date: 'X' };
const RESPONSE_BODY = { ok: true, id: 42 };

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
    created_at: '2026-06-17T00:00:00Z',
    updated_at: '2026-06-17T00:00:00Z',
  } as ApiBehaviourBaselineDto;
}

function buildAcceptedCapture(
  overrides: Partial<ApiBehaviourCaptureDto> = {},
): ApiBehaviourCaptureDto {
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
    response_headers_redacted_json: RESPONSE_HEADERS,
    response_body_json: RESPONSE_BODY,
    duration_ms: 12,
    error_type: null,
    error_message: null,
    captured_at: '2026-06-17T00:00:00Z',
    accepted: true,
    accepted_at: '2026-06-17T00:00:01Z',
    reviewer_notes: null,
    ...overrides,
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
    created_at: '2026-06-17T00:00:00Z',
    updated_at: '2026-06-17T00:00:00Z',
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
    created_at: '2026-06-17T00:00:00Z',
    updated_at: '2026-06-17T00:00:00Z',
  } as unknown as ApiBehaviourScenarioDto;
}

function renderModal(captures: ApiBehaviourCaptureDto[]) {
  return render(
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
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitectureDispatch).mockReturnValue(
    vi.fn() as unknown as ReturnType<typeof useArchitectureDispatch>,
  );
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Header Carry Project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(loadModelByProjectId).mockResolvedValue({} as never);
  vi.mocked(createBaseline).mockResolvedValue(buildBaselineResponse());
  vi.mocked(createBaselineItem).mockResolvedValue({
    id: 'item-1',
  } as unknown as ApiBehaviourBaselineItemDto);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SaveAsBaselineModal -- source header carry (R5)', () => {
  it('pins response_json as a { headers, body } envelope symmetric with the target side', async () => {
    renderModal([buildAcceptedCapture()]);

    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    await waitFor(() => expect(createBaselineItem).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(createBaselineItem).mock.calls[0][2];
    expect(payload.response_json).toEqual({
      headers: RESPONSE_HEADERS,
      body: RESPONSE_BODY,
    });
    // The raw body is NO LONGER pinned bare -- it is nested under `body`.
    expect(payload.response_json).not.toEqual(RESPONSE_BODY);
  });

  it('carries headers: null when the capture has no redacted response headers (graceful degrade)', async () => {
    renderModal([
      buildAcceptedCapture({ response_headers_redacted_json: null }),
    ]);

    fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
      target: { value: 'baseline v1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
    });

    await waitFor(() => expect(createBaselineItem).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(createBaselineItem).mock.calls[0][2];
    expect(payload.response_json).toEqual({
      headers: null,
      body: RESPONSE_BODY,
    });
  });
});
