/**
 * CaptureReviewPanel -- Add New Behaviour wiring tests
 *
 * Spec 2026-06-20 Add New Behaviour -- Manual Capture (Task 6.1)
 *
 * Covers the panel-level wiring of the manual-capture feature:
 *   - The `capture-review-add-behaviour` button renders ONLY when
 *     `readOnly === false`, alongside `capture-review-accept-all` /
 *     `capture-review-open-save-baseline`.
 *   - Clicking it opens the AddNewBehaviourModal.
 *   - A successful Save triggers the panel's existing list-refresh path
 *     (`listOperations` / `listScenarios` / `listCaptures` re-called).
 *   - When secrets are not loaded the modal signals the parent via
 *     `onRequestReenterSecrets`.
 *
 * Sibling file (not appended to the large existing panel test) per the
 * anti-clobber protocol; mocks are scoped here so `manualCapture` can be
 * controlled without disturbing the existing test's mock surface.
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
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-mc-1';
const ARCH_ID = 'arch-mc-1';
const SESSION_ID = 'session-mc-1';

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

function renderPanel(
  props: Partial<React.ComponentProps<typeof CaptureReviewPanel>> = {},
) {
  const onRequestReenterSecrets = vi.fn();
  render(
    <MemoryRouter>
      <CaptureReviewPanel
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        readOnly={props.readOnly ?? false}
        mutatingCallsConfirmed={props.mutatingCallsConfirmed ?? true}
        secretsLoaded={props.secretsLoaded ?? true}
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

describe('CaptureReviewPanel -- Add New Behaviour wiring (Task 6.1)', () => {
  it('renders the add-behaviour button only when not read-only, beside the existing actions', async () => {
    seedLists();
    // First, accept exists so accept-all / save buttons render.
    vi.mocked(listCaptures).mockResolvedValue([buildCapture({ accepted: true })]);
    renderPanel({ readOnly: false });
    await flushPromises();

    expect(screen.getByTestId('capture-review-add-behaviour')).toBeTruthy();
    expect(screen.getByTestId('capture-review-accept-all')).toBeTruthy();
    expect(screen.getByTestId('capture-review-open-save-baseline')).toBeTruthy();
  });

  it('does NOT render the add-behaviour button when read-only', async () => {
    seedLists();
    renderPanel({ readOnly: true });
    await flushPromises();
    expect(screen.queryByTestId('capture-review-add-behaviour')).toBeNull();
  });

  it('opens the modal when the button is clicked', async () => {
    seedLists();
    renderPanel();
    await flushPromises();
    fireEvent.click(screen.getByTestId('capture-review-add-behaviour'));
    expect(screen.getByTestId('add-new-behaviour-modal')).toBeTruthy();
  });

  it('refreshes the lists after a successful manual capture', async () => {
    seedLists();
    vi.mocked(manualCapture).mockResolvedValue({
      sessionId: SESSION_ID,
      scenarioId: 'scn-new',
      capture: buildCapture({ id: 'cap-new' }),
    });
    renderPanel();
    await flushPromises();

    // Lists fetched once on mount.
    expect(vi.mocked(listOperations)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('capture-review-add-behaviour'));
    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-1' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-path-param-id'), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByTestId('add-new-behaviour-save'));
    await flushPromises();

    expect(vi.mocked(manualCapture)).toHaveBeenCalledTimes(1);
    // The panel's refresh path re-fetches the lists (mount + refresh).
    expect(vi.mocked(listOperations)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(listCaptures)).toHaveBeenCalledTimes(2);
    // Modal closed after success.
    expect(screen.queryByTestId('add-new-behaviour-modal')).toBeNull();
  });

  it('signals the parent to re-enter secrets when secrets are not loaded', async () => {
    seedLists();
    const { onRequestReenterSecrets } = renderPanel({ secretsLoaded: false });
    await flushPromises();
    fireEvent.click(screen.getByTestId('capture-review-add-behaviour'));
    // Modal shows the not-loaded guidance; clicking re-enter signals the parent.
    expect(screen.getByTestId('add-new-behaviour-secrets-not-loaded')).toBeTruthy();
    fireEvent.click(screen.getByTestId('add-new-behaviour-reenter-secrets'));
    expect(onRequestReenterSecrets).toHaveBeenCalledTimes(1);
  });
});
