/**
 * BaselineDetailView -- table default + Full-detail toggle + toolbar tests.
 *
 * Spec: 2026-06-20 Baseline Save & Review -- Batch + Activate + Table Detail +
 * Postman Export -- Task Group 6 (R5 + R3 + R6).
 *
 * Pins the TG6 surface:
 *   - the view DEFAULTS to a compact table (Method / Path / Scenario / Status)
 *     and does NOT render the per-item JSON dump up front
 *   - the "Full detail" toggle reveals the per-item request/response JSON dump;
 *     "Table" switches back
 *   - "Make Active" is shown ONLY while status === 'draft' and calls
 *     updateBaseline({ status: 'active' }), flipping the status badge to active
 *   - "Make Active" is absent on a non-draft (active) baseline
 *   - "Export Postman Collection" is shown for ANY saved baseline (draft OR
 *     active) and triggers a download via triggerDownload, with the collection
 *     built by baselineToPostmanCollection; baseUrl is fail-soft prefilled from
 *     the capture session's api_base_url when the baseline has a session_id
 *
 * Conventions mirror BaselineDetailView.integrity.test.tsx + sequence test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetBaseline = vi.fn();
const mockListBaselineItems = vi.fn();
const mockGetBaselineIntegrity = vi.fn();
const mockUpdateBaseline = vi.fn();
const mockGetCaptureSession = vi.fn();

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/apiBehaviourClient')
  >('../../api/apiBehaviourClient');
  return {
    ...actual,
    getBaseline: (...a: unknown[]) => mockGetBaseline(...a),
    listBaselineItems: (...a: unknown[]) => mockListBaselineItems(...a),
    getBaselineIntegrity: (...a: unknown[]) => mockGetBaselineIntegrity(...a),
    updateBaseline: (...a: unknown[]) => mockUpdateBaseline(...a),
    getCaptureSession: (...a: unknown[]) => mockGetCaptureSession(...a),
  };
});

const mockBaselineToPostmanCollection = vi.fn();
vi.mock('../../utils/postmanExport', () => ({
  baselineToPostmanCollection: (...a: unknown[]) =>
    mockBaselineToPostmanCollection(...a),
}));

const mockTriggerDownload = vi.fn();
vi.mock('../../utils/fileOperations', () => ({
  triggerDownload: (...a: unknown[]) => mockTriggerDownload(...a),
  // Keep sanitizeFilename a real-ish passthrough so the filename assertion is
  // meaningful without pulling the whole (unrelated) util module in.
  sanitizeFilename: (name: string) => name.replace(/[<>:"/\\|?*]/g, ''),
}));

import { BaselineDetailView } from './BaselineDetailView';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const BASELINE_ID = 'b-1';

interface BaselineOverrides {
  status?: string;
  session_id?: string | null;
  name?: string | null;
}

function baseline(overrides: BaselineOverrides = {}) {
  return {
    id: BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: overrides.session_id === undefined ? 'sess-9' : overrides.session_id,
    name: overrides.name === undefined ? 'Oracle baseline' : overrides.name,
    status: overrides.status ?? 'draft',
    accepted_capture_count: 2,
    operation_count: 2,
    notes: null,
    created_at: '2026-06-20T12:00:00Z',
    updated_at: '2026-06-20T12:00:00Z',
    kind: 'current',
    paired_with_baseline_id: null,
    content_hash: null,
    provenance_json: null,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    baseline_id: BASELINE_ID,
    capture_id: 'cap-1',
    operation_id: 'op-1',
    scenario_id: 'sc-1',
    method: 'POST',
    path: '/widgets',
    scenario_name: 'create widget',
    request_json: { query: null, headers: { 'x-test': '1' }, body: { name: 'w' } },
    response_status: 201,
    response_json: { headers: null, body: { id: 'w-1' } },
    business_notes: null,
    volatile_paths_json: null,
    sequence_json: null,
    created_at: '2026-06-20T12:00:00Z',
    updated_at: '2026-06-20T12:00:00Z',
    ...overrides,
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <BaselineDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        baselineId={BASELINE_ID}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListBaselineItems.mockResolvedValue([item()]);
  mockGetBaselineIntegrity.mockResolvedValue({
    content_hash: null,
    recomputed_hash: null,
    integrity_verified: false,
  });
  mockGetCaptureSession.mockResolvedValue({ api_base_url: 'https://api.example.test' });
  mockBaselineToPostmanCollection.mockReturnValue({
    info: { name: 'Oracle baseline', schema: 'x' },
    item: [],
    variable: [],
  });
});

describe('BaselineDetailView -- table default + Full-detail toggle (R5)', () => {
  it('defaults to the compact table (Method / Path / Scenario / Status), no JSON dump', async () => {
    mockGetBaseline.mockResolvedValue(baseline());
    renderView();

    // The table is the default rendering.
    const table = await screen.findByTestId('baseline-detail-items-table');
    expect(table).toBeInTheDocument();

    // Column headers.
    expect(table).toHaveTextContent('Method');
    expect(table).toHaveTextContent('Path');
    expect(table).toHaveTextContent('Scenario');
    expect(table).toHaveTextContent('Status');

    // The row carries the item's values.
    const row = screen.getByTestId('baseline-detail-item-row');
    expect(row).toHaveTextContent('POST');
    expect(row).toHaveTextContent('/widgets');
    expect(row).toHaveTextContent('create widget');
    expect(row).toHaveTextContent('201');

    // The per-item JSON dump (full mode) is NOT rendered by default.
    expect(screen.queryByTestId('baseline-detail-items-list')).toBeNull();
    expect(screen.queryByTestId('baseline-detail-item')).toBeNull();
  });

  it('reveals the per-item JSON dump on the "Full detail" toggle and switches back', async () => {
    mockGetBaseline.mockResolvedValue(baseline());
    renderView();

    fireEvent.click(await screen.findByTestId('baseline-detail-view-mode-full'));

    // Full mode: the dump list + a per-item block + the request/response JSON.
    const list = await screen.findByTestId('baseline-detail-items-list');
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId('baseline-detail-item')).toBeInTheDocument();
    // The JSON dump surfaces the request body shape.
    expect(screen.getByTestId('baseline-detail-item')).toHaveTextContent('"name": "w"');
    // Table is hidden in full mode.
    expect(screen.queryByTestId('baseline-detail-items-table')).toBeNull();

    // Toggle back to the table.
    fireEvent.click(screen.getByTestId('baseline-detail-view-mode-table'));
    expect(await screen.findByTestId('baseline-detail-items-table')).toBeInTheDocument();
    expect(screen.queryByTestId('baseline-detail-items-list')).toBeNull();
  });
});

describe('BaselineDetailView -- Make Active (R3)', () => {
  it('shows "Make Active" while draft and calls updateBaseline({ status: "active" })', async () => {
    mockGetBaseline.mockResolvedValue(baseline({ status: 'draft' }));
    mockUpdateBaseline.mockResolvedValue(baseline({ status: 'active' }));
    renderView();

    const btn = await screen.findByTestId('baseline-detail-make-active');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    await waitFor(() => expect(mockUpdateBaseline).toHaveBeenCalledTimes(1));
    expect(mockUpdateBaseline).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      BASELINE_ID,
      { status: 'active' },
    );

    // After activation the status badge flips to active and Make Active is gone.
    await waitFor(() =>
      expect(screen.getByTestId('baseline-detail-view')).toHaveAttribute(
        'data-status',
        'active',
      ),
    );
    expect(screen.queryByTestId('baseline-detail-make-active')).toBeNull();
  });

  it('does NOT show "Make Active" on an active (non-draft) baseline', async () => {
    mockGetBaseline.mockResolvedValue(baseline({ status: 'active' }));
    renderView();

    // Wait for the view to settle (toolbar present), then assert no Make Active.
    await screen.findByTestId('baseline-detail-toolbar');
    expect(screen.queryByTestId('baseline-detail-make-active')).toBeNull();
    expect(mockUpdateBaseline).not.toHaveBeenCalled();
  });
});

describe('BaselineDetailView -- Export Postman Collection (R6)', () => {
  it('exports on a DRAFT baseline: builds the collection + triggers a download (baseUrl prefilled)', async () => {
    mockGetBaseline.mockResolvedValue(baseline({ status: 'draft', name: 'My API' }));
    renderView();

    const exportBtn = await screen.findByTestId('baseline-detail-export-postman');
    fireEvent.click(exportBtn);

    // Fail-soft baseUrl prefill from the capture session.
    await waitFor(() => expect(mockGetCaptureSession).toHaveBeenCalledTimes(1));
    expect(mockGetCaptureSession).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, 'sess-9');

    await waitFor(() =>
      expect(mockBaselineToPostmanCollection).toHaveBeenCalledTimes(1),
    );
    expect(mockBaselineToPostmanCollection).toHaveBeenCalledWith(
      'My API',
      [expect.objectContaining({ id: 'item-1' })],
      'https://api.example.test',
    );

    await waitFor(() => expect(mockTriggerDownload).toHaveBeenCalledTimes(1));
    const [, filename] = mockTriggerDownload.mock.calls[0];
    expect(filename).toBe('My API.postman_collection.json');
  });

  it('exports on an ACTIVE baseline too (available on any saved baseline)', async () => {
    mockGetBaseline.mockResolvedValue(baseline({ status: 'active' }));
    renderView();

    const exportBtn = await screen.findByTestId('baseline-detail-export-postman');
    fireEvent.click(exportBtn);

    await waitFor(() => expect(mockTriggerDownload).toHaveBeenCalledTimes(1));
    expect(mockBaselineToPostmanCollection).toHaveBeenCalledTimes(1);
  });

  it('exports fail-soft with a blank baseUrl when the baseline has no session_id', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ status: 'active', session_id: null }),
    );
    renderView();

    fireEvent.click(await screen.findByTestId('baseline-detail-export-postman'));

    await waitFor(() =>
      expect(mockBaselineToPostmanCollection).toHaveBeenCalledTimes(1),
    );
    // No session lookup attempted; baseUrl is blank.
    expect(mockGetCaptureSession).not.toHaveBeenCalled();
    expect(mockBaselineToPostmanCollection).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '',
    );
    expect(mockTriggerDownload).toHaveBeenCalledTimes(1);
  });
});
