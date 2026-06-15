/**
 * DriftReportTab + DiffItemDetailModal tests
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 5
 * sub-task 5.1 (4-test budget).
 *
 * Test inventory:
 *   1. Tab counts render correctly given a populated diff DTO + diff items.
 *   2. "Recompute" button click fires the typed-client `recomputeDiff` AND
 *      the tab re-polls `/status` until terminal -- button disabled while
 *      `status='computing'`.
 *   3. "Stale" badge appears when `baseline.updated_at > diff.computed_at`
 *      on EITHER baseline; does NOT appear when both are <= computed_at.
 *   4. `DiffItemDetailModal` renders the `body_diff_json` annotations on
 *      the side-by-side body comparison.
 *
 * The polling is exercised via Vitest fake timers (matches the existing
 * CaptureSessionDetailView polling-test pattern). The api client is mocked
 * so per-call shapes can be controlled per-test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

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

import {
  getDiffByTargetBaseline,
  listDiffItems,
  recomputeDiff,
  getDiffStatus,
  type ApiBehaviourBaselineDto,
  type ApiBehaviourDiffDto,
  type ApiBehaviourDiffItemDto,
} from '../../api/apiBehaviourClient';
import { DriftReportTab } from './DriftReportTab';
import { DiffItemDetailModal } from './DiffItemDetailModal';

const PROJECT_ID = 'proj-drift-1';
const ARCH_ID = 'arch-drift-1';
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
    source_only_count: 2,
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: header counts render correctly given a populated diff DTO + items.
// ---------------------------------------------------------------------------
describe('DriftReportTab -- counts rendering (5.1 #1)', () => {
  it('renders header counts and the diff-items table when given a populated diff', async () => {
    const diff = buildDiff();
    const items: ApiBehaviourDiffItemDto[] = [
      buildDiffItem({ id: 'i1', method: 'GET', path: '/a', status_classification: 'status_match', body_classification: 'body_match' }),
      buildDiffItem({ id: 'i2', method: 'GET', path: '/b', status_classification: 'status_match', body_classification: 'body_match' }),
      buildDiffItem({ id: 'i3', method: 'GET', path: '/c', status_classification: 'status_match', body_classification: 'body_match' }),
      buildDiffItem({ id: 'i4', method: 'GET', path: '/d', status_classification: 'status_drift', source_response_status: 200, target_response_status: 500 }),
      buildDiffItem({ id: 'i5', method: 'POST', path: '/e', status_classification: 'status_match', body_classification: 'body_shape_drift' }),
      buildDiffItem({ id: 'i6', method: 'DELETE', path: '/f', status_classification: 'source_only', body_classification: null, source_baseline_item_id: 'bi-src-6', target_baseline_item_id: null }),
      buildDiffItem({ id: 'i7', method: 'DELETE', path: '/g', status_classification: 'source_only', body_classification: null, source_baseline_item_id: 'bi-src-7', target_baseline_item_id: null }),
    ];

    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValueOnce(items);

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline()}
        sourceBaseline={buildSourceBaseline()}
      />,
    );

    // Wait for initial load to complete.
    await screen.findByTestId('drift-report-counts');

    expect(screen.getByTestId('drift-report-count-matched').textContent).toContain('3');
    expect(screen.getByTestId('drift-report-count-status-drift').textContent).toContain(
      '1',
    );
    expect(
      screen.getByTestId('drift-report-count-body-shape-drift').textContent,
    ).toContain('1');
    expect(
      screen.getByTestId('drift-report-count-body-value-drift').textContent,
    ).toContain('0');
    expect(screen.getByTestId('drift-report-count-source-only').textContent).toContain(
      '2',
    );

    // All 7 items render as rows.
    const rows = screen.getAllByTestId('drift-report-item-row');
    expect(rows).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Recompute button click fires `recomputeDiff` and re-polls
// `getDiffStatus` until terminal. Button is disabled while computing.
// ---------------------------------------------------------------------------
describe('DriftReportTab -- Recompute + re-poll (5.1 #2)', () => {
  it('clicks Recompute, polls getDiffStatus until terminal, and disables the button while computing', async () => {
    const diff = buildDiff();
    const items: ApiBehaviourDiffItemDto[] = [buildDiffItem()];

    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValue(items);

    // Recompute returns a diff in `status='computing'`. The polling effect
    // then queries `getDiffStatus` -- first reply still computing, second
    // reply completed.
    vi.mocked(recomputeDiff).mockResolvedValueOnce(
      buildDiff({ status: 'computing', computed_at: null }),
    );
    vi.mocked(getDiffStatus)
      .mockResolvedValueOnce({
        status: 'computing',
        matched_count: null,
        status_drift_count: null,
        body_shape_drift_count: null,
        body_value_drift_count: null,
        source_only_count: null,
        target_only_count: null,
        computed_at: null,
        error_message: null,
      })
      .mockResolvedValueOnce({
        status: 'completed',
        matched_count: 5,
        status_drift_count: 0,
        body_shape_drift_count: 0,
        body_value_drift_count: 0,
        source_only_count: 0,
        target_only_count: 0,
        computed_at: '2026-05-25T11:00:00Z',
        error_message: null,
      });

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline()}
        sourceBaseline={buildSourceBaseline()}
      />,
    );

    // Initial load: completed diff present, button enabled.
    const button = await screen.findByTestId('drift-report-recompute-button');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toContain('Recompute');

    // Switch to fake timers so the polling setTimeout can be advanced under
    // test control.
    vi.useFakeTimers();

    // Click Recompute. The mocked `recomputeDiff` resolves with a
    // status='computing' diff which triggers the polling effect.
    await act(async () => {
      fireEvent.click(button);
    });
    expect(recomputeDiff).toHaveBeenCalledWith(DIFF_ID);

    // Button now disabled + shows "Computing…" label.
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toContain('Computing');

    // First poll tick -> still computing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getDiffStatus).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);

    // Second poll tick -> completed; polling stops; button re-enabled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getDiffStatus).toHaveBeenCalledTimes(2);
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toContain('Recompute');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Stale badge appears when EITHER baseline's `updated_at` is greater
// than the diff's `computed_at`. Does NOT appear when both are <= computed_at.
// ---------------------------------------------------------------------------
describe('DriftReportTab -- Stale badge (5.1 #3)', () => {
  it('renders Stale badge when target.updated_at > diff.computed_at', async () => {
    // diff was computed_at=10:30, target updated_at=11:00 (newer) -> stale
    const diff = buildDiff({ computed_at: '2026-05-25T10:30:00Z' });
    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValueOnce([]);

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline({ updated_at: '2026-05-25T11:00:00Z' })}
        sourceBaseline={buildSourceBaseline({ updated_at: '2026-05-25T09:00:00Z' })}
      />,
    );

    expect(await screen.findByTestId('drift-report-stale-badge')).toBeTruthy();
  });

  it('renders Stale badge when source.updated_at > diff.computed_at', async () => {
    const diff = buildDiff({ computed_at: '2026-05-25T10:30:00Z' });
    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValueOnce([]);

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline({ updated_at: '2026-05-25T10:00:00Z' })}
        sourceBaseline={buildSourceBaseline({ updated_at: '2026-05-25T11:00:00Z' })}
      />,
    );

    expect(await screen.findByTestId('drift-report-stale-badge')).toBeTruthy();
  });

  it('does NOT render Stale badge when both baselines are <= computed_at', async () => {
    const diff = buildDiff({ computed_at: '2026-05-25T10:30:00Z' });
    vi.mocked(getDiffByTargetBaseline).mockResolvedValueOnce(diff);
    vi.mocked(listDiffItems).mockResolvedValueOnce([]);

    render(
      <DriftReportTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        targetBaseline={buildTargetBaseline({ updated_at: '2026-05-25T10:00:00Z' })}
        sourceBaseline={buildSourceBaseline({ updated_at: '2026-05-25T09:00:00Z' })}
      />,
    );

    // Wait for load to complete (counts render).
    await screen.findByTestId('drift-report-counts');
    expect(screen.queryByTestId('drift-report-stale-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4: DiffItemDetailModal renders the body_diff_json annotations on the
// side-by-side body comparison.
// ---------------------------------------------------------------------------
describe('DiffItemDetailModal -- body_diff_json annotations (5.1 #4)', () => {
  it('renders source + target JSON panes and the body_diff_json annotations', () => {
    const diffItem = buildDiffItem({
      method: 'POST',
      path: '/users',
      body_diff_json: {
        differences: [
          { pointer: '/user/name', kind: 'value_changed' },
          { pointer: '/user/email', kind: 'key_added' },
          { pointer: '/user/legacy_field', kind: 'key_removed' },
          { pointer: '/user/age', kind: 'type_changed' },
        ],
      },
      source_response_status: 200,
      target_response_status: 200,
    });

    const sourceItem = {
      id: 'bi-src-1',
      baseline_id: SOURCE_BASELINE_ID,
      capture_id: 'cap-src-1',
      operation_id: 'op-1',
      scenario_id: 'sc-1',
      method: 'POST',
      path: '/users',
      scenario_name: 'happy_path',
      request_json: null,
      response_status: 200,
      response_json: { user: { name: 'Alice', legacy_field: 'x', age: '42' } },
      business_notes: null,
      created_at: '2026-05-25T09:00:00Z',
      updated_at: '2026-05-25T09:00:00Z',
    };
    const targetItem = {
      id: 'bi-tgt-1',
      baseline_id: TARGET_BASELINE_ID,
      capture_id: 'cap-tgt-1',
      operation_id: 'op-1',
      scenario_id: 'sc-1',
      method: 'POST',
      path: '/users',
      scenario_name: 'happy_path',
      request_json: null,
      response_status: 200,
      response_json: { user: { name: 'Bob', email: 'bob@example.com', age: 42 } },
      business_notes: null,
      created_at: '2026-05-25T10:00:00Z',
      updated_at: '2026-05-25T10:00:00Z',
    };

    render(
      <DiffItemDetailModal
        diffItem={diffItem}
        sourceBaselineItem={sourceItem}
        targetBaselineItem={targetItem}
        onClose={() => {
          // no-op
        }}
      />,
    );

    // Both side-by-side panes are rendered.
    const sourcePane = screen.getByTestId('diff-item-detail-modal-source');
    const targetPane = screen.getByTestId('diff-item-detail-modal-target');
    expect(sourcePane.textContent).toContain('Alice');
    expect(targetPane.textContent).toContain('Bob');
    expect(targetPane.textContent).toContain('bob@example.com');

    // The annotations section is present and lists all four pointer paths
    // with the right kind classification.
    const annotations = screen.getAllByTestId('diff-item-detail-modal-annotation');
    expect(annotations).toHaveLength(4);
    const pointers = annotations.map((a) => a.getAttribute('data-annotation-pointer'));
    const kinds = annotations.map((a) => a.getAttribute('data-annotation-kind'));
    expect(pointers).toEqual(
      expect.arrayContaining([
        '/user/name',
        '/user/email',
        '/user/legacy_field',
        '/user/age',
      ]),
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        'value_changed',
        'key_added',
        'key_removed',
        'type_changed',
      ]),
    );
  });
});
