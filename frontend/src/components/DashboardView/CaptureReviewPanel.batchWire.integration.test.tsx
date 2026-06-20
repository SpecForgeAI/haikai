/**
 * CaptureReviewPanel -- batch bulk actions through the REAL apiBehaviourClient
 * (end-to-end wire seam for the rate-limit-fix headline).
 *
 * Spec: 2026-06-20 Baseline Save & Review -- Batch + Activate + Export, R1/R2
 * (Task Group 8 -- strategic gap fill).
 *
 * WHY THIS EXISTS (the gap it closes):
 *   Every other CaptureReviewPanel batch test (`CaptureReviewPanel.bulk.test.tsx`)
 *   stubs `updateCapturesBatch` itself, so it pins the BUTTON -> handler ->
 *   warning behaviour but NEVER exercises the real client's wire shape
 *   (`updateCapturesBatch` -> `jsonRequest` -> ONE `fetch` to `.../captures/batch`
 *   under the `{ items }` envelope) together with the component. A regression in
 *   the real client -- the wrong URL, the wrong verb, a dropped `{ items }`
 *   wrapper, a per-row patch lost during real `JSON.stringify`, or mis-reading
 *   the wire `{ updated, failed }` envelope -- would pass every existing test.
 *   This file mounts the panel with ONLY the mount-time loaders stubbed and lets
 *   the REAL `updateCapturesBatch` run against a stubbed `globalThis.fetch`, so
 *   the whole thread is proven:
 *
 *     click -> real updateCapturesBatch -> exactly ONE fetch to the batch URL
 *           -> wire { updated, failed } -> merged state + the failed[] warning.
 *
 *   This is the headline guarantee (N captures collapse to a SINGLE batch
 *   request, and the per-item `failed[]` surfaces as a warning) asserted on the
 *   genuine wire, not a mock boundary.
 *
 * Strategy: spread-actual the apiBehaviourClient and override ONLY the three
 * list loaders + diagnostics (so the mount is deterministic) -- `updateCapturesBatch`
 * is deliberately LEFT REAL. `globalThis.fetch` is the single stub under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

// Spread-actual: the REAL updateCapturesBatch / parseReviewerNotes /
// serialiseReviewerNotes stay in use. Only the mount-time list loaders are
// stubbed so the panel renders a deterministic set of rows.
vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/apiBehaviourClient')
  >('../../api/apiBehaviourClient');
  return {
    ...actual,
    listOperations: vi.fn(),
    listScenarios: vi.fn(),
    listCaptures: vi.fn(),
    listDiagnostics: vi.fn(),
    // updateCapturesBatch is intentionally NOT overridden -- it runs for real.
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
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-wire-1';
const ARCH_ID = 'arch-wire-1';
const SESSION_ID = 'session-wire-1';

// The gateway URL the real client builds for the captures batch. GATEWAY_BASE is
// `import.meta.env.VITE_GATEWAY_BASE_URL ?? ''`, which is unset in the test env,
// so the path is root-relative -- matching `apiBehaviourClient.test.ts`.
const CAPTURES_BATCH_URL = `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/captures/batch`;

// ---------------------------------------------------------------------------
// Fixtures (mirror CaptureReviewPanel.bulk.test.tsx)
// ---------------------------------------------------------------------------

function buildOperation(
  overrides: Partial<ApiBehaviourOperationDto> = {},
): ApiBehaviourOperationDto {
  return {
    id: 'op-A',
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
    id: 'sc-A1',
    session_id: SESSION_ID,
    operation_id: 'op-A',
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
    scenario_id: 'sc-A1',
    operation_id: 'op-A',
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

/**
 * A minimal `fetch` Response double whose `content-type` is JSON, so the real
 * `jsonRequest` parses the body via `.json()`.
 */
function jsonOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function renderPanel() {
  return render(
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

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  // Mount-time fail-soft dependencies.
  vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof fetchMigrationDiscoveryContext>>,
  );
  vi.mocked(listDiagnostics).mockResolvedValue([]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/**
 * Seed three un-reviewed captures across two scenarios under one operation via
 * the stubbed loaders.
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
  return caps;
}

describe('CaptureReviewPanel -- Accept All through the real client (wire seam)', () => {
  it('issues exactly ONE fetch to the captures/batch URL and renders the wire failed[] as a warning end-to-end', async () => {
    seedThreeCaptures();

    // The single wire response: c1 + c3 accepted, c2 in failed[]. This is the
    // genuine `{ updated, failed }` envelope the real client parses.
    fetchMock.mockResolvedValueOnce(
      jsonOk({
        updated: [
          { ...buildCapture({ id: 'c1' }), accepted: true },
          { ...buildCapture({ id: 'c3' }), accepted: true },
        ],
        failed: [{ id: 'c2', reason: 'row not found' }],
      }),
    );

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

    // The headline: ONE real network request for ALL three captures (no N-loop).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(CAPTURES_BATCH_URL);
    expect(calledInit.method).toBe('PATCH');

    // The real client wrapped every capture in ONE `{ items }` envelope on the
    // wire, each carrying the accept patch.
    const body = JSON.parse(calledInit.body as string);
    expect(body.items).toHaveLength(3);
    expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    for (const it of body.items) {
      expect(it.patch.accepted).toBe(true);
      expect(typeof it.patch.accepted_at).toBe('string');
    }

    // The wire failed[] surfaced as a warning naming ONLY the failed capture...
    const warning = await screen.findByTestId('capture-review-batch-warning');
    expect(warning.textContent).toContain('c2');
    expect(warning.textContent).not.toContain('c1');
    expect(warning.textContent).not.toContain('c3');

    // ...and the wire updated[] merged into state (the accepted tally moved).
    expect(
      screen.getByTestId('capture-review-accepted-count').textContent,
    ).toContain('2 accepted');
  });
});

describe('CaptureReviewPanel -- Reject All through the real client (wire seam)', () => {
  it('serialises each row\'s OWN notes-preserving patch onto the wire in ONE request', async () => {
    // c2 carries an existing mask; c1 / c3 carry none. The reject patch for c2
    // MUST preserve its mask through the REAL serialiseReviewerNotes + the real
    // JSON.stringify that hits the wire -- the property the `{ id, patch }`
    // envelope exists to guarantee.
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

    fetchMock.mockResolvedValueOnce(jsonOk({ updated: [], failed: [] }));
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
    // ONE request for all three rejects -- the rate-limit fix on the reject path.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(CAPTURES_BATCH_URL);
    expect(calledInit.method).toBe('PATCH');

    const body = JSON.parse(calledInit.body as string);
    expect(body.items).toHaveLength(3);
    for (const it of body.items) {
      expect(it.patch.accepted).toBe(false);
      expect(it.patch.accepted_at).toBeNull();
    }

    // c2's mask SURVIVED the round-trip onto the wire (the property the
    // per-row { id, patch } envelope exists to guarantee). Its reviewer_notes is
    // a JSON string on the wire because the real serialiseReviewerNotes ran, so
    // parse it to assert the mask is intact and row-specific.
    const c2 = body.items.find((i: { id: string }) => i.id === 'c2');
    expect(JSON.parse(c2.patch.reviewer_notes).masks).toEqual([
      { path: 'response.body.token', label: 'secret' },
    ]);
    // c1 had NO prior masks and the reject contributes no text, so the real
    // serialiseReviewerNotes returns null to CLEAR the column (its documented
    // empty-case contract) -- proving c2's mask was not bled onto c1.
    const c1 = body.items.find((i: { id: string }) => i.id === 'c1');
    expect(c1.patch.reviewer_notes).toBeNull();
  });
});
