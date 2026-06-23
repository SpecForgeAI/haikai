/**
 * CaptureReviewPanel -- "Show N system-hidden captures" reveal + re-accept tests
 *
 * Spec: 2026-06-23 Semantics-aware API Behaviour Baseline coverage -- Task
 * Group 5 (5.1c).
 *
 * Coverage (focused):
 *   - the reveal toggle is COLLAPSED by default (the hidden table is not in the
 *     DOM until expanded), and names the count of system-hidden captures;
 *   - expanding it lists the `isAutoRejectedFumble` captures (accepted:false +
 *     the bare `superseded_non_canonical` marker) which the main table hides;
 *   - the re-accept affordance PATCHes the capture `accepted: true` (reusing the
 *     existing capture-accept mechanism).
 *
 * Test strategy mirrors the existing CaptureReviewPanel suites: mock
 * `apiBehaviourClient` (spread-actual + spy the network wrappers), stub the
 * discovery-context fetch, and mock the `*.module.css` import with the identity
 * Proxy idiom the project's component tests use.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    listOperations: vi.fn(),
    listScenarios: vi.fn(),
    listCaptures: vi.fn(),
    listDiagnostics: vi.fn().mockResolvedValue([]),
    updateCapture: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn().mockRejectedValue(new Error('unavailable')),
}));

vi.mock('./CaptureReviewPanel.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import {
  listOperations,
  listScenarios,
  listCaptures,
  listDiagnostics,
  updateCapture,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-hidden-1';
const ARCH_ID = 'arch-hidden-1';
const SESSION_ID = 'session-hidden-1';

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
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
    ...overrides,
  } as ApiBehaviourOperationDto;
}

function buildScenario(
  overrides: Partial<ApiBehaviourScenarioDto> = {},
): ApiBehaviourScenarioDto {
  return {
    id: 'sc-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_name: 'missing resource',
    scenario_type: 'not_found',
    status: 'executed_success',
    generation_source: 'llm_generated',
    request_method: 'GET',
    request_path: '/things/42',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    notes: null,
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
    ...overrides,
  } as ApiBehaviourScenarioDto;
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
    duration_ms: 10,
    error_type: null,
    error_message: null,
    captured_at: '2026-06-23T00:00:00Z',
    accepted: null,
    accepted_at: null,
    reviewer_notes: null,
    ...overrides,
  };
}

/** A visible (accepted) capture + a system-hidden auto-rejected fumble. */
const VISIBLE_CAPTURE = buildCapture({ id: 'cap-visible', accepted: true });
const HIDDEN_CAPTURE = buildCapture({
  id: 'cap-hidden',
  attempt_number: 2,
  response_status: 500,
  accepted: false,
  reviewer_notes: 'superseded_non_canonical',
});

function renderPanel() {
  render(
    <CaptureReviewPanel
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      sessionId={SESSION_ID}
    />,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // afterEach's vi.restoreAllMocks() strips the vi.mock factory default off
  // fetchMigrationDiscoveryContext after the first test, so re-arm it here --
  // the panel's mount effect calls `.then()` on the result and a bare
  // (undefined-returning) mock would throw.
  vi.mocked(fetchMigrationDiscoveryContext).mockRejectedValue(
    new Error('unavailable'),
  );
  vi.mocked(listOperations).mockResolvedValue([buildOperation()]);
  vi.mocked(listScenarios).mockResolvedValue([buildScenario()]);
  vi.mocked(listCaptures).mockResolvedValue([VISIBLE_CAPTURE, HIDDEN_CAPTURE]);
  vi.mocked(listDiagnostics).mockResolvedValue([]);
  vi.mocked(updateCapture).mockImplementation(
    async (_p, _a, _id, patch) =>
      ({ ...HIDDEN_CAPTURE, ...patch }) as ApiBehaviourCaptureDto,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureReviewPanel -- system-hidden reveal + re-accept (Task 5.1c)', () => {
  it('hides the system-rejected fumble from the main table and offers a collapsed reveal toggle', async () => {
    renderPanel();
    await flush();

    // The hidden fumble is NOT in the main review table.
    const mainRows = screen.getAllByTestId('capture-review-row');
    expect(
      mainRows.some((r) => r.getAttribute('data-capture-id') === 'cap-hidden'),
    ).toBe(false);
    expect(
      mainRows.some((r) => r.getAttribute('data-capture-id') === 'cap-visible'),
    ).toBe(true);

    // The reveal toggle is present and names the count, but is COLLAPSED: the
    // hidden table is not yet in the DOM.
    const toggle = screen.getByTestId('capture-review-hidden-toggle');
    expect(toggle).toHaveTextContent('1 system-hidden capture');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByTestId('capture-review-hidden-table'),
    ).not.toBeInTheDocument();
  });

  it('reveals the hidden fumble captures on expand and exposes a re-accept affordance', async () => {
    renderPanel();
    await flush();

    fireEvent.click(screen.getByTestId('capture-review-hidden-toggle'));

    const hiddenTable = screen.getByTestId('capture-review-hidden-table');
    expect(hiddenTable).toBeInTheDocument();
    const hiddenRows = screen.getAllByTestId('capture-review-hidden-row');
    expect(hiddenRows).toHaveLength(1);
    expect(hiddenRows[0].getAttribute('data-capture-id')).toBe('cap-hidden');
    // The re-accept affordance is present.
    expect(
      screen.getByTestId('capture-review-hidden-reaccept'),
    ).toBeInTheDocument();
  });

  it('re-accept PATCHes the hidden capture accepted:true (reusing the accept mechanism)', async () => {
    renderPanel();
    await flush();

    fireEvent.click(screen.getByTestId('capture-review-hidden-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('capture-review-hidden-reaccept'));
    });

    expect(updateCapture).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      'cap-hidden',
      expect.objectContaining({ accepted: true }),
    );
  });
});
