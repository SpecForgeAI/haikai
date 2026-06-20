/**
 * CaptureReviewPanel -- Manual scenario badge tests
 *
 * Spec 2026-06-20 Add New Behaviour -- Manual Capture (Task 7.1)
 *
 * Asserts a scenario row with `generation_source === 'manual'` renders the
 * `capture-review-scenario-manual-badge`, and a non-manual row does not.
 * Sibling file (anti-clobber protocol); mocks scoped here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-badge-1';
const ARCH_ID = 'arch-badge-1';
const SESSION_ID = 'session-badge-1';

function buildOperation(): ApiBehaviourOperationDto {
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
    request_headers_redacted_json: null,
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

function renderPanel() {
  render(
    <MemoryRouter>
      <CaptureReviewPanel
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        readOnly={false}
      />
    </MemoryRouter>,
  );
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
  vi.mocked(listOperations).mockResolvedValue([buildOperation()]);
  vi.mocked(listDiagnostics).mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureReviewPanel -- Manual scenario badge (Task 7.1)', () => {
  it('renders the Manual badge for a generation_source==="manual" scenario', async () => {
    vi.mocked(listScenarios).mockResolvedValue([
      buildScenario({ generation_source: 'manual', scenario_type: 'manual' }),
    ]);
    vi.mocked(listCaptures).mockResolvedValue([buildCapture()]);
    renderPanel();
    await flushPromises();
    expect(screen.getByTestId('capture-review-scenario-manual-badge')).toBeTruthy();
  });

  it('does NOT render the Manual badge for a non-manual scenario', async () => {
    vi.mocked(listScenarios).mockResolvedValue([
      buildScenario({ generation_source: 'llm_generated' }),
    ]);
    vi.mocked(listCaptures).mockResolvedValue([buildCapture()]);
    renderPanel();
    await flushPromises();
    expect(screen.queryByTestId('capture-review-scenario-manual-badge')).toBeNull();
  });
});
