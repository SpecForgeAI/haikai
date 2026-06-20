/**
 * CaptureReviewPanel -- 409 SECRETS_NOT_LOADED round-trip
 *
 * Spec 2026-06-20 Add New Behaviour -- Manual Capture (Task Group 8 gap-fill).
 *
 * The existing wiring test covers the secrets-not-loaded *prop* path, and the
 * modal test covers the 409 mapping in isolation. This test fills the
 * end-to-end gap: the panel reports `secretsLoaded === true` at open (so the
 * request form renders and a send is attempted), but the manual-capture
 * ENDPOINT returns 409 SECRETS_NOT_LOADED at Save time. That late 409 must
 * surface the modal's re-enter guidance and propagate all the way to the
 * parent's `onRequestReenterSecrets` (which owns the existing re-enter prompt)
 * -- NOT a generic submit error, and WITHOUT closing/refreshing as a success.
 *
 * Sibling file per the anti-clobber protocol; mocks scoped here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => vi.fn() };
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
    manualCapture: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn().mockResolvedValue(null),
}));
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
  manualCapture,
  ApiBehaviourApiError,
  SECRETS_NOT_LOADED_CODE,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-409';
const ARCH_ID = 'arch-409';
const SESSION_ID = 'session-409';

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
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
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
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
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
    request_headers_redacted_json: { 'Content-Type': '[REDACTED]' },
    request_body_json: null,
    response_status: 200,
    response_headers_redacted_json: null,
    response_body_json: { ok: true },
    duration_ms: 42,
    error_type: null,
    error_message: null,
    captured_at: '2026-06-20T00:00:00Z',
    accepted: null,
    accepted_at: null,
    reviewer_notes: null,
    ...overrides,
  };
}

function seedLists() {
  vi.mocked(listOperations).mockResolvedValue([buildOperation()]);
  vi.mocked(listScenarios).mockResolvedValue([buildScenario()]);
  vi.mocked(listCaptures).mockResolvedValue([buildCapture()]);
  vi.mocked(listDiagnostics).mockResolvedValue([]);
}

function renderPanel() {
  const onRequestReenterSecrets = vi.fn();
  render(
    <MemoryRouter>
      <CaptureReviewPanel
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        readOnly={false}
        mutatingCallsConfirmed={true}
        secretsLoaded={true}
        onRequestReenterSecrets={onRequestReenterSecrets}
      />
    </MemoryRouter>,
  );
  return { onRequestReenterSecrets };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValue(null as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureReviewPanel -- endpoint 409 SECRETS_NOT_LOADED round-trip', () => {
  it('routes a late 409 send failure to the parent re-enter prompt instead of refreshing as a success', async () => {
    seedLists();
    // Secrets reported loaded at open, but the ENDPOINT 409s on Save.
    vi.mocked(manualCapture).mockRejectedValue(
      new ApiBehaviourApiError(409, { code: SECRETS_NOT_LOADED_CODE, message: 'no secrets' }),
    );

    const { onRequestReenterSecrets } = renderPanel();
    await flushPromises();

    // Lists fetched once on mount.
    expect(vi.mocked(listOperations)).toHaveBeenCalledTimes(1);

    // Open the modal -- the request form renders because secretsLoaded === true.
    fireEvent.click(screen.getByTestId('capture-review-add-behaviour'));
    expect(screen.getByTestId('add-new-behaviour-operation-select')).toBeTruthy();

    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-1' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-path-param-id'), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByTestId('add-new-behaviour-save'));
    await flushPromises();

    // The send was attempted exactly once and rejected with the 409.
    expect(vi.mocked(manualCapture)).toHaveBeenCalledTimes(1);

    // The modal stays open and shows the re-enter guidance (NOT a generic error,
    // NOT a success close).
    expect(screen.getByTestId('add-new-behaviour-secrets-not-loaded')).toBeTruthy();
    expect(screen.queryByTestId('add-new-behaviour-submit-error')).toBeNull();

    // No success refresh occurred -- lists were not re-fetched.
    expect(vi.mocked(listOperations)).toHaveBeenCalledTimes(1);

    // Clicking re-enter propagates to the parent's prompt owner.
    fireEvent.click(screen.getByTestId('add-new-behaviour-reenter-secrets'));
    expect(onRequestReenterSecrets).toHaveBeenCalledTimes(1);
  });
});
