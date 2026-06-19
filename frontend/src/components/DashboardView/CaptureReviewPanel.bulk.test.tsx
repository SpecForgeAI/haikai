/**
 * CaptureReviewPanel -- bulk "Accept all" / "Reject all" tests
 *
 * Covers the header-toolbar bulk actions added to the capture-review table:
 *   1. "Accept all" PATCHes every *visible* capture with accepted=true (+ iso
 *      accepted_at), one PATCH per visible row.
 *   2. "Reject all" (window.confirm -> true) PATCHes every visible capture
 *      with accepted=false / accepted_at=null.
 *   3. "Reject all" is a no-op when window.confirm returns false.
 *   4. Both bulk buttons are hidden when the panel is read-only.
 *
 * Mocks the apiBehaviourClient (spread-actual + override) so the real
 * parse/serialise helpers stay in use; asserts updateCapture call count/args.
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
    updateScenario: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn(),
}));

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
 * Three captures across two scenarios under one operation. updateCapture is
 * stubbed to echo its requested mutation onto the row.
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
  vi.mocked(updateCapture).mockImplementation(
    async (_p, _a, captureId, payload) => {
      const base = caps.find((c) => c.id === captureId) ?? buildCapture({ id: captureId });
      return { ...base, ...payload } as ApiBehaviourCaptureDto;
    },
  );
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
// Accept all
// ===========================================================================

describe('CaptureReviewPanel -- Accept all', () => {
  it('PATCHes every visible capture with accepted=true', async () => {
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

    expect(updateCapture).toHaveBeenCalledTimes(caps.length);
    const patchedIds = vi.mocked(updateCapture).mock.calls.map((c) => c[2]).sort();
    expect(patchedIds).toEqual(['c1', 'c2', 'c3']);
    for (const call of vi.mocked(updateCapture).mock.calls) {
      const [proj, arch, , payload] = call;
      expect(proj).toBe(PROJECT_ID);
      expect(arch).toBe(ARCH_ID);
      expect(payload.accepted).toBe(true);
      expect(typeof payload.accepted_at).toBe('string');
      expect(payload.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

// ===========================================================================
// Reject all
// ===========================================================================

describe('CaptureReviewPanel -- Reject all', () => {
  it('PATCHes every visible capture with accepted=false when confirmed', async () => {
    const caps = seedThreeCaptures();
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
    expect(updateCapture).toHaveBeenCalledTimes(caps.length);
    const patchedIds = vi.mocked(updateCapture).mock.calls.map((c) => c[2]).sort();
    expect(patchedIds).toEqual(['c1', 'c2', 'c3']);
    for (const call of vi.mocked(updateCapture).mock.calls) {
      const [, , , payload] = call;
      expect(payload.accepted).toBe(false);
      expect(payload.accepted_at).toBeNull();
    }
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

    expect(updateCapture).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Read-only gating
// ===========================================================================

describe('CaptureReviewPanel -- bulk buttons hidden when read-only', () => {
  it('renders neither bulk button in read-only mode', async () => {
    seedThreeCaptures();

    renderPanel(true);
    await flushPromises();

    expect(screen.queryByTestId('capture-review-accept-all')).toBeNull();
    expect(screen.queryByTestId('capture-review-reject-all')).toBeNull();
  });
});
