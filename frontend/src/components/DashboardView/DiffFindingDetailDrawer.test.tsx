/**
 * DriftReportTab + DiffFindingDetailDrawer findings integration tests
 *
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 4
 * sub-task 4.1 (3-4 test budget).
 *
 * Test inventory:
 *   1. DriftReportTab: Findings badge column renders correct count per row
 *      from the batch-loaded `listDiffFindings` payload (grouped client-
 *      side by the linked diff_item_id).
 *   2. DriftReportTab: Badge click opens DiffFindingDetailDrawer pre-loaded
 *      with the linked findings for that diff_item.
 *   3. DiffFindingDetailDrawer: Reviewer status transition fires
 *      `patchDiffFinding` with the right body and reflects the updated
 *      finding via `onFindingUpdated`.
 *   4. DiffFindingDetailDrawer: Save Notes-only fires `patchDiffFinding`
 *      with only `reviewer_notes` (no status field).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// Mock both API modules used by the integrated surface.
vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    getDiffByTargetBaseline: vi.fn(),
    listDiffItems: vi.fn(),
    recomputeDiff: vi.fn(),
    getDiffStatus: vi.fn(),
    createDiff: vi.fn(),
  };
});

vi.mock('../../api/diffFindingsApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/diffFindingsApi')>(
    '../../api/diffFindingsApi',
  );
  return {
    ...actual,
    listDiffFindings: vi.fn(),
    listDiffFindingsByDiffItem: vi.fn(),
    patchDiffFinding: vi.fn(),
  };
});

import {
  getDiffByTargetBaseline,
  listDiffItems,
  type ApiBehaviourBaselineDto,
  type ApiBehaviourDiffDto,
  type ApiBehaviourDiffItemDto,
} from '../../api/apiBehaviourClient';
import {
  listDiffFindings,
  patchDiffFinding,
  type DiscoveryFindingDto,
} from '../../api/diffFindingsApi';
import { DriftReportTab } from './DriftReportTab';
import { DiffFindingDetailDrawer } from './DiffFindingDetailDrawer';

const PROJECT_ID = 'proj-findings-1';
const ARCH_ID = 'arch-findings-1';
const TARGET_BASELINE_ID = 'base-tgt-1';
const SOURCE_BASELINE_ID = 'base-src-1';
const DIFF_ID = 'diff-1';

function buildTargetBaseline(
  overrides: Partial<ApiBehaviourBaselineDto> = {},
): ApiBehaviourBaselineDto {
  return {
    id: TARGET_BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'sess-tgt-1',
    name: 'Target baseline',
    status: 'active',
    accepted_capture_count: 7,
    operation_count: 5,
    notes: null,
    created_at: '2026-05-25T10:00:00Z',
    updated_at: '2026-05-25T10:00:00Z',
    kind: 'target',
    paired_with_baseline_id: SOURCE_BASELINE_ID,
    ...overrides,
  };
}

function buildSourceBaseline(
  overrides: Partial<ApiBehaviourBaselineDto> = {},
): ApiBehaviourBaselineDto {
  return {
    id: SOURCE_BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'sess-src-1',
    name: 'Source baseline',
    status: 'active',
    accepted_capture_count: 7,
    operation_count: 5,
    notes: null,
    created_at: '2026-05-25T09:00:00Z',
    updated_at: '2026-05-25T09:00:00Z',
    kind: 'current',
    paired_with_baseline_id: null,
    ...overrides,
  };
}

function buildDiff(overrides: Partial<ApiBehaviourDiffDto> = {}): ApiBehaviourDiffDto {
  return {
    id: DIFF_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    source_baseline_id: SOURCE_BASELINE_ID,
    target_baseline_id: TARGET_BASELINE_ID,
    status: 'completed',
    matched_count: 3,
    status_drift_count: 1,
    body_shape_drift_count: 1,
    body_value_drift_count: 0,
    source_only_count: 0,
    target_only_count: 0,
    source_baseline_updated_at: '2026-05-25T09:00:00Z',
    target_baseline_updated_at: '2026-05-25T10:00:00Z',
    computed_at: '2026-05-25T10:30:00Z',
    error_message: null,
    created_at: '2026-05-25T10:29:00Z',
    updated_at: '2026-05-25T10:30:00Z',
    ...overrides,
  };
}

function buildDiffItem(
  overrides: Partial<ApiBehaviourDiffItemDto> = {},
): ApiBehaviourDiffItemDto {
  return {
    id: 'item-1',
    diff_id: DIFF_ID,
    method: 'GET',
    path: '/users/1',
    scenario_name: 'happy_path',
    source_baseline_item_id: 'bi-src-1',
    target_baseline_item_id: 'bi-tgt-1',
    status_classification: 'status_match',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
    notes: null,
    created_at: '2026-05-25T10:30:00Z',
    ...overrides,
  };
}

function buildFinding(
  diffItemId: string,
  overrides: Partial<DiscoveryFindingDto> = {},
): DiscoveryFindingDto {
  return {
    id: `finding-${diffItemId}`,
    run_id: null,
    api_behaviour_diff_id: DIFF_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    finding_type: 'api_behaviour_status_drift',
    category: 'api_behaviour_drift',
    severity: 'critical',
    confidence: null,
    status: 'new',
    title: 'Status drift: GET /users responded 200 -> 500',
    summary: 'Server error on target replay',
    detail_json: { method: 'GET', path: '/users', sourceStatus: 200, targetStatus: 500 },
    source: 'api_behaviour_diff',
    created_by_stage: 'diffRunner.findingEmission',
    created_at: '2026-05-25T10:30:30Z',
    updated_at: '2026-05-25T10:30:30Z',
    reviewed_at: null,
    reviewer_notes: null,
    links: [
      {
        id: `link-${diffItemId}`,
        finding_id: `finding-${diffItemId}`,
        link_type: 'derived_from',
        target_type: 'api_behaviour_diff_item',
        target_id: diffItemId,
        label: null,
        created_at: '2026-05-25T10:30:30Z',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: Findings badge column renders correct count per row.
//
// The Drift report tab batch-loads ALL findings for the diff at tab load
// then groups by the link's `target_id` (where target_type='api_behaviour_
// diff_item') for per-row badge counts. This test seeds 3 rows + 2 findings
// (2 linked to row 1, 0 linked to row 2, 0 linked to row 3) and asserts the
// rendered badge counts are 2 / —  / —.
// ---------------------------------------------------------------------------
describe('DriftReportTab -- Findings badge column (4.1 #1)', () => {
  it('renders the correct findings count per diff_item row from the batch payload', async () => {
    const diff = buildDiff();
    const item1 = buildDiffItem({ id: 'item-1', path: '/a' });
    const item2 = buildDiffItem({ id: 'item-2', path: '/b' });
    const item3 = buildDiffItem({ id: 'item-3', path: '/c' });
    const items = [item1, item2, item3];

    // Two findings, both linked to item-1; none linked to item-2 or item-3.
    const finding1 = buildFinding('item-1', { id: 'f-1', severity: 'critical' });
    const finding2 = buildFinding('item-1', { id: 'f-2', severity: 'medium' });
    const findings = [finding1, finding2];

    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValueOnce(items);
    vi.mocked(listDiffFindings).mockResolvedValueOnce(findings);

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline()}
        sourceBaseline={buildSourceBaseline()}
      />,
    );

    // Wait for initial load to settle.
    await screen.findByTestId('drift-report-counts');

    // Three rows rendered.
    const rows = screen.getAllByTestId('drift-report-item-row');
    expect(rows).toHaveLength(3);

    // Row 1 has 2 findings -> badge shows '2' with critical (the highest
    // severity of the two findings on this row) styling.
    const badge = screen.getByTestId('drift-report-findings-badge');
    expect(badge.textContent).toBe('2');
    expect(badge.getAttribute('data-findings-count')).toBe('2');
    expect(badge.getAttribute('data-findings-max-severity')).toBe('critical');

    // Rows 2 and 3 have no findings -> empty marker present, not the badge.
    const emptyMarkers = screen.getAllByTestId('drift-report-findings-badge-empty');
    expect(emptyMarkers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Badge click opens the DiffFindingDetailDrawer pre-loaded.
//
// Clicking the per-row Findings badge sets the drawer state with the diff_item
// + the findings filtered to that diff_item. The drawer renders the diff_item
// context strip + the finding title.
// ---------------------------------------------------------------------------
describe('DriftReportTab -- Findings badge click opens drawer (4.1 #2)', () => {
  it('opens DiffFindingDetailDrawer pre-loaded with the linked findings', async () => {
    const diff = buildDiff();
    const item1 = buildDiffItem({
      id: 'item-1',
      method: 'GET',
      path: '/users/1',
      scenario_name: 'happy_path',
    });
    const items = [item1];

    const finding1 = buildFinding('item-1', {
      id: 'f-1',
      title: 'Status drift: GET /users/1 responded 200 -> 500',
    });
    const findings = [finding1];

    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValueOnce(items);
    vi.mocked(listDiffFindings).mockResolvedValueOnce(findings);

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline()}
        sourceBaseline={buildSourceBaseline()}
      />,
    );

    // Wait for load.
    const badge = await screen.findByTestId('drift-report-findings-badge');
    expect(badge.textContent).toBe('1');

    // Drawer is NOT yet mounted.
    expect(screen.queryByTestId('diff-finding-detail-drawer')).toBeNull();

    // Click the badge -> drawer mounts.
    await act(async () => {
      fireEvent.click(badge);
    });

    expect(screen.getByTestId('diff-finding-detail-drawer')).toBeTruthy();
    expect(screen.getByTestId('diff-finding-detail-title').textContent).toBe(
      'Status drift: GET /users/1 responded 200 -> 500',
    );

    // The diff_item context strip shows the row identity.
    const ctx = screen.getByTestId('diff-finding-detail-diff-item-context');
    expect(ctx.textContent).toContain('GET');
    expect(ctx.textContent).toContain('/users/1');
    expect(ctx.textContent).toContain('happy_path');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Reviewer status transition via drawer.
//
// Render the drawer in isolation with a single finding, click the "Accept"
// button, and assert `patchDiffFinding` is called with `{ status: 'accepted',
// reviewer_notes: '' }` (the default seeded from `finding.reviewer_notes`),
// and that the parent's `onFindingUpdated` callback receives the updated
// finding row.
// ---------------------------------------------------------------------------
describe('DiffFindingDetailDrawer -- reviewer transition (4.1 #3)', () => {
  it('clicking Accept fires patchDiffFinding and surfaces the updated finding', async () => {
    const finding = buildFinding('item-1', { id: 'f-1', status: 'new' });
    const updatedFinding = { ...finding, status: 'accepted', reviewed_at: '2026-05-25T11:00:00Z' };

    vi.mocked(patchDiffFinding).mockResolvedValueOnce(updatedFinding);

    const onClose = vi.fn();
    const onFindingUpdated = vi.fn();

    render(
      <DiffFindingDetailDrawer
        projectId={PROJECT_ID}
        diffId={DIFF_ID}
        diffItem={{
          id: 'item-1',
          method: 'GET',
          path: '/users/1',
          scenario_name: 'happy_path',
        }}
        findings={[finding]}
        onClose={onClose}
        onFindingUpdated={onFindingUpdated}
      />,
    );

    const acceptButton = screen.getByTestId('diff-finding-action-accept');
    await act(async () => {
      fireEvent.click(acceptButton);
    });

    expect(patchDiffFinding).toHaveBeenCalledTimes(1);
    expect(patchDiffFinding).toHaveBeenCalledWith(PROJECT_ID, DIFF_ID, 'f-1', {
      status: 'accepted',
      reviewer_notes: '',
    });
    expect(onFindingUpdated).toHaveBeenCalledTimes(1);
    expect(onFindingUpdated).toHaveBeenCalledWith(updatedFinding);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Save Notes-only fires patchDiffFinding with only the notes field.
//
// Asserts the reviewer-notes textarea is wired correctly: typing into the
// textarea updates the draft state, clicking "Save Notes" PATCHes with
// `{ reviewer_notes: '<draft>' }` (no `status` field), and the updated
// finding propagates.
// ---------------------------------------------------------------------------
describe('DiffFindingDetailDrawer -- Save Notes-only (4.1 #4)', () => {
  it('Save Notes posts only reviewer_notes (no status field)', async () => {
    const finding = buildFinding('item-1', { id: 'f-1', status: 'new', reviewer_notes: null });
    const updatedFinding = { ...finding, reviewer_notes: 'noting this' };

    vi.mocked(patchDiffFinding).mockResolvedValueOnce(updatedFinding);

    const onFindingUpdated = vi.fn();

    render(
      <DiffFindingDetailDrawer
        projectId={PROJECT_ID}
        diffId={DIFF_ID}
        diffItem={{
          id: 'item-1',
          method: 'GET',
          path: '/users/1',
          scenario_name: 'happy_path',
        }}
        findings={[finding]}
        onClose={() => {}}
        onFindingUpdated={onFindingUpdated}
      />,
    );

    const textarea = screen.getByTestId(
      'diff-finding-detail-notes-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'noting this' } });

    const saveButton = screen.getByTestId('diff-finding-action-save-notes');
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(patchDiffFinding).toHaveBeenCalledTimes(1);
    expect(patchDiffFinding).toHaveBeenCalledWith(PROJECT_ID, DIFF_ID, 'f-1', {
      reviewer_notes: 'noting this',
    });
    expect(onFindingUpdated).toHaveBeenCalledWith(updatedFinding);
  });
});
