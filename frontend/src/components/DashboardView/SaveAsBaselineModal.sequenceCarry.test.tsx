/**
 * SaveAsBaselineModal -- stateful-sequence carry (Spec D, Task Group 4).
 *
 * The capture orchestrator persists the assembled `sequence_json` (+ the
 * ref-derived `volatile_paths_json`) as a `sequence_pinned`-marked diagnostic
 * keyed to the canonical ACT-step capture. When the modal pins that capture's
 * baseline item it must carry the `sequence_json` AND prefer the ref-derived
 * `volatile_paths_json` from the marker -- mirroring exactly how
 * `volatile_paths_json` is carried today.
 *
 * Covered here:
 *   1. A capture matched by a `sequence_pinned` marker's `canonical_capture_id`
 *      carries `sequence_json` (+ the marker's ref-derived volatile envelope)
 *      onto its `createBaselineItem` payload.
 *   2. A non-sequence capture (no matching marker) carries `sequence_json: null`
 *      and keeps the capture-row volatile envelope -- pinned exactly as today.
 *
 * Conventions mirror SaveAsBaselineModal.headerCarry.test.tsx.
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
  type ApiBehaviourDiagnosticDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { SaveAsBaselineModal } from './SaveAsBaselineModal';

const PROJECT_ID = 'proj-seq-1';
const ARCH_ID = 'arch-seq-1';
const SESSION_ID = 'session-seq-1';
const BASELINE_ID = 'baseline-seq-1';

const ACT_CAPTURE_ID = 'cap-act-1';

const SEQUENCE_JSON = {
  steps: [
    {
      index: 0,
      role: 'setup',
      kind: 'http',
      request: { method: 'POST', path: '/filters', query: null, headers: null, body: { name: 'x' } },
      expected_status: 201,
      response_refs: [],
    },
    {
      index: 1,
      role: 'act',
      kind: 'http',
      request: { method: 'POST', path: '/filters/submitForReview', query: null, headers: null, body: { id: '$0.id' } },
      expected_status: 200,
      response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
    },
  ],
  act_step_index: 1,
  cleanup_best_effort: true,
};

const REF_VOLATILE = { paths: ['/id'], volatility_source: 'ref_derived', k: 0 };
const CAPTURE_VOLATILE = { paths: ['/createdAt'], volatility_source: 'probed', k: 3 };

function buildBaselineResponse(): ApiBehaviourBaselineDto {
  return {
    id: BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: SESSION_ID,
    name: 'seq baseline v1',
    status: 'draft',
    accepted_capture_count: 1,
    operation_count: 1,
    notes: null,
    created_at: '2026-06-18T00:00:00Z',
    updated_at: '2026-06-18T00:00:00Z',
  } as ApiBehaviourBaselineDto;
}

function buildAcceptedCapture(
  overrides: Partial<ApiBehaviourCaptureDto> = {},
): ApiBehaviourCaptureDto {
  return {
    id: ACT_CAPTURE_ID,
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_id: 'sc-1',
    attempt_number: 1,
    request_method: 'POST',
    request_path: '/filters/submitForReview',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: { id: 'real-id-123' },
    response_status: 200,
    response_headers_redacted_json: null,
    response_body_json: { ok: true },
    duration_ms: 12,
    error_type: null,
    error_message: null,
    captured_at: '2026-06-18T00:00:00Z',
    accepted: true,
    accepted_at: '2026-06-18T00:00:01Z',
    reviewer_notes: null,
    volatile_paths_json: CAPTURE_VOLATILE,
    ...overrides,
  } as unknown as ApiBehaviourCaptureDto;
}

function buildOperation(): ApiBehaviourOperationDto {
  return {
    id: 'op-1',
    session_id: SESSION_ID,
    operation_id: 'submitForReview',
    method: 'POST',
    path: '/filters/submitForReview',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: false,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-06-18T00:00:00Z',
    updated_at: '2026-06-18T00:00:00Z',
  } as unknown as ApiBehaviourOperationDto;
}

function buildScenario(): ApiBehaviourScenarioDto {
  return {
    id: 'sc-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_name: 'submit for review (stateful)',
    scenario_type: 'happy_path',
    status: 'executed_success',
    generation_source: 'llm_generated',
    request_method: 'POST',
    request_path: '/filters/submitForReview',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    notes: null,
    created_at: '2026-06-18T00:00:00Z',
    updated_at: '2026-06-18T00:00:00Z',
  } as unknown as ApiBehaviourScenarioDto;
}

function buildSequenceMarker(): ApiBehaviourDiagnosticDto {
  return {
    id: 'diag-seq-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_id: 'sc-1',
    diagnostic_type: 'endpoint_skipped',
    message: 'sequence_pinned: stateful sequence',
    detail_json: {
      marker: 'sequence_pinned',
      canonical_capture_id: ACT_CAPTURE_ID,
      sequence_json: SEQUENCE_JSON,
      volatile_paths_json: REF_VOLATILE,
    },
    created_at: '2026-06-18T00:00:00Z',
  } as unknown as ApiBehaviourDiagnosticDto;
}

function renderModal(
  captures: ApiBehaviourCaptureDto[],
  diagnostics: ApiBehaviourDiagnosticDto[],
) {
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
        diagnostics={diagnostics}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

async function submit() {
  fireEvent.change(screen.getByTestId('save-as-baseline-name-input'), {
    target: { value: 'seq baseline v1' },
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('save-as-baseline-submit'));
  });
  await waitFor(() => expect(createBaselineItem).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitectureDispatch).mockReturnValue(
    vi.fn() as unknown as ReturnType<typeof useArchitectureDispatch>,
  );
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Sequence Project',
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

describe('SaveAsBaselineModal -- stateful-sequence carry (Spec D)', () => {
  it('carries sequence_json + the ref-derived volatile envelope onto the ACT-step item when the sequence_pinned marker matches', async () => {
    renderModal([buildAcceptedCapture()], [buildSequenceMarker()]);
    await submit();

    const payload = vi.mocked(createBaselineItem).mock.calls[0][2];
    // The assembled sequence chain is carried verbatim onto the act-step item.
    expect(payload.sequence_json).toEqual(SEQUENCE_JSON);
    // The marker's ref-derived volatile envelope is PREFERRED over the
    // capture-row envelope (the generated ids are expected-volatile).
    expect(payload.volatile_paths_json).toEqual(REF_VOLATILE);
    expect(payload.capture_id).toBe(ACT_CAPTURE_ID);
  });

  it('carries sequence_json: null and keeps the capture-row volatile envelope when there is no matching marker (single-shot, unchanged)', async () => {
    // No diagnostics -> no sequence_pinned marker.
    renderModal([buildAcceptedCapture()], []);
    await submit();

    const payload = vi.mocked(createBaselineItem).mock.calls[0][2];
    expect(payload.sequence_json ?? null).toBeNull();
    // Falls back to the capture-row volatile envelope exactly as today.
    expect(payload.volatile_paths_json).toEqual(CAPTURE_VOLATILE);
  });

  it('does not match a marker whose canonical_capture_id points at a different capture', async () => {
    const marker = buildSequenceMarker();
    (marker.detail_json as Record<string, unknown>).canonical_capture_id =
      'some-other-capture';
    renderModal([buildAcceptedCapture()], [marker]);
    await submit();

    const payload = vi.mocked(createBaselineItem).mock.calls[0][2];
    expect(payload.sequence_json ?? null).toBeNull();
    expect(payload.volatile_paths_json).toEqual(CAPTURE_VOLATILE);
  });
});
