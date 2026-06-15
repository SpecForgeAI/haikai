/**
 * EpicCapturedDecisionsPanel + dashboard summary tests
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 8.1
 *
 * Covers the 2-8 focused Vitest tests for the new epic-decisions edit panel
 * and the read-only dashboard summary:
 *
 *   1. (T8-1) Panel lists decisions returned by the API client.
 *   2. (T8-2) Creating a new decision calls POST and refreshes the list.
 *   3. (T8-3) Editing an auto-seeded decision calls PATCH and the row's
 *      source flips to user_edited in the UI (the API response drives the
 *      flip; the panel re-renders with the updated row).
 *   4. (T8-4) The "auto-extracted from spec X, unedited" chip is visible on
 *      auto-seeded rows and disappears after the source flips post-edit.
 *   5. (T8-5) The dashboard's read-only collapsed summary renders counts by
 *      status (the existing MigrationDeliveryEpicDecisionsSummary used by
 *      Task Group 7.3).
 *
 * Test conventions mirror MigrationDeliveryPassTwoSurfaces.test.tsx:
 *   - vi.mock the API surfaces BEFORE importing components.
 *   - Override the test seam props on the panel so the mocks are wired
 *     deterministically per-test.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Imports under test ----------------------------------------------------
import { EpicCapturedDecisionsPanel } from '../EpicCapturedDecisionsPanel';
import { MigrationDeliveryEpicDecisionsSummary } from '../MigrationDeliveryEpicDecisionsSummary';
import type { EpicCapturedDecisionDto } from '../../../../api/epicCapturedDecisionsApi';

// Silence the "'React' is declared but its value is never read" check; React
// is the JSX runtime here so the import IS load-bearing.
void React;

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const EPIC_WORK_ITEM_ID = '00000000-0000-0000-0000-000000000002';

function makeDecision(
  overrides: Partial<EpicCapturedDecisionDto> = {},
): EpicCapturedDecisionDto {
  return {
    id: '00000000-0000-0000-0000-00000000aaaa',
    projectId: PROJECT_ID,
    epicWorkItemId: EPIC_WORK_ITEM_ID,
    decisionKey: 'persist_user_via_eventbridge',
    decisionText: 'Use EventBridge to fan out user persistence events.',
    source: 'auto_extracted',
    sourceSpecGenerationId: '00000000-0000-0000-0000-00000000bbbb',
    status: 'draft',
    lastEditedBy: null,
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-20T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// Test 1 -- Panel lists decisions from GET .../captured-decisions (T8-1)
// ============================================================================

describe('EpicCapturedDecisionsPanel -- list (T8-1)', () => {
  it('lists decisions returned by the list API', async () => {
    const decisions = [
      makeDecision({ id: 'id-1', decisionKey: 'decisionA' }),
      makeDecision({
        id: 'id-2',
        decisionKey: 'decisionB',
        source: 'user_added',
        sourceSpecGenerationId: null,
      }),
    ];
    const listFn = vi.fn().mockResolvedValue(decisions);

    render(
      <EpicCapturedDecisionsPanel
        projectId={PROJECT_ID}
        epicWorkItemId={EPIC_WORK_ITEM_ID}
        onClose={vi.fn()}
        listFn={listFn}
        createFn={vi.fn()}
        updateFn={vi.fn()}
        deleteFn={vi.fn()}
      />,
    );

    // Wait for the rows to appear.
    await waitFor(() => {
      expect(
        screen.getByTestId('epic-decision-row-id-1'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('epic-decision-row-id-2'),
      ).toBeInTheDocument();
    });
    // List API was called once on mount.
    expect(listFn).toHaveBeenCalledWith(PROJECT_ID, EPIC_WORK_ITEM_ID);
    // Each row's decision-key text shows up.
    expect(screen.getByTestId('epic-decision-row-id-1-key')).toHaveTextContent(
      'decisionA',
    );
    expect(screen.getByTestId('epic-decision-row-id-2-key')).toHaveTextContent(
      'decisionB',
    );
  });
});

// ============================================================================
// Test 2 -- Creating a new decision calls POST and refreshes the list (T8-2)
// ============================================================================

describe('EpicCapturedDecisionsPanel -- create (T8-2)', () => {
  it('calls createFn with the entered key + text and then reloads the list', async () => {
    // The mock listFn returns different lists on first vs. second invocation:
    // first call returns [], second call (post-create) returns the new row.
    const listFn = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeDecision({
          id: 'id-new',
          decisionKey: 'newKey',
          decisionText: 'Some new decision text',
          source: 'user_added',
          sourceSpecGenerationId: null,
        }),
      ]);
    const createFn = vi.fn().mockResolvedValue(
      makeDecision({
        id: 'id-new',
        decisionKey: 'newKey',
        decisionText: 'Some new decision text',
        source: 'user_added',
        sourceSpecGenerationId: null,
      }),
    );

    render(
      <EpicCapturedDecisionsPanel
        projectId={PROJECT_ID}
        epicWorkItemId={EPIC_WORK_ITEM_ID}
        onClose={vi.fn()}
        listFn={listFn}
        createFn={createFn}
        updateFn={vi.fn()}
        deleteFn={vi.fn()}
      />,
    );

    // Wait for initial empty load to settle.
    await waitFor(() => {
      expect(
        screen.getByTestId('epic-captured-decisions-panel-empty'),
      ).toBeInTheDocument();
    });

    // Open the add form.
    fireEvent.click(screen.getByTestId('epic-captured-decisions-panel-add'));
    expect(
      screen.getByTestId('epic-captured-decisions-panel-add-form'),
    ).toBeInTheDocument();

    // Fill it.
    fireEvent.change(
      screen.getByTestId('epic-captured-decisions-panel-new-key-input'),
      { target: { value: 'newKey' } },
    );
    fireEvent.change(
      screen.getByTestId('epic-captured-decisions-panel-new-text-input'),
      { target: { value: 'Some new decision text' } },
    );

    // Save.
    fireEvent.click(screen.getByTestId('epic-captured-decisions-panel-new-save'));

    // POST was called with the right body, then the list was reloaded.
    await waitFor(() => {
      expect(createFn).toHaveBeenCalledWith(
        PROJECT_ID,
        EPIC_WORK_ITEM_ID,
        expect.objectContaining({
          decisionKey: 'newKey',
          decisionText: 'Some new decision text',
          status: 'draft',
        }),
      );
    });
    // listFn was invoked twice: once on mount + once on refresh after create.
    await waitFor(() => {
      expect(listFn).toHaveBeenCalledTimes(2);
    });
    // The new row appears.
    await waitFor(() => {
      expect(
        screen.getByTestId('epic-decision-row-id-new'),
      ).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Test 3 -- Editing an auto-seeded decision calls PATCH and the row's source
// flips to user_edited in the UI (T8-3) + chip disappears (T8-4).
// ============================================================================

describe('EpicCapturedDecisionsPanel -- edit + chip flip (T8-3 + T8-4)', () => {
  it('PATCHes on save and the source chip flips from auto_extracted to user_edited', async () => {
    const original = makeDecision({
      id: 'id-auto-1',
      decisionKey: 'decisionA',
      decisionText: 'Original text',
      source: 'auto_extracted',
      sourceSpecGenerationId: '00000000-0000-0000-0000-00000000ffff',
    });
    const updated = makeDecision({
      ...original,
      decisionText: 'Edited text',
      source: 'user_edited',
    });
    const listFn = vi.fn().mockResolvedValue([original]);
    const updateFn = vi.fn().mockResolvedValue(updated);

    render(
      <EpicCapturedDecisionsPanel
        projectId={PROJECT_ID}
        epicWorkItemId={EPIC_WORK_ITEM_ID}
        onClose={vi.fn()}
        listFn={listFn}
        createFn={vi.fn()}
        updateFn={updateFn}
        deleteFn={vi.fn()}
      />,
    );

    // Wait for the auto-seeded row to render. Verify chip is present.
    await waitFor(() => {
      expect(
        screen.getByTestId('epic-decision-row-id-auto-1-source-chip'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('epic-decision-row-id-auto-1-source-chip'),
    ).toHaveTextContent(/auto-extracted from spec .+, unedited/i);

    // Open the inline editor.
    fireEvent.click(screen.getByTestId('epic-decision-row-id-auto-1-edit'));

    // Edit the text.
    fireEvent.change(
      screen.getByTestId('epic-decision-row-id-auto-1-text-input'),
      { target: { value: 'Edited text' } },
    );

    // Save -> PATCH.
    fireEvent.click(screen.getByTestId('epic-decision-row-id-auto-1-save'));

    await waitFor(() => {
      expect(updateFn).toHaveBeenCalledWith(
        PROJECT_ID,
        EPIC_WORK_ITEM_ID,
        'id-auto-1',
        expect.objectContaining({
          decisionText: 'Edited text',
        }),
      );
    });

    // The auto-extracted chip should be gone, and the user-edited chip
    // should appear (driven by the updated DTO returned by the PATCH).
    await waitFor(() => {
      expect(
        screen.queryByTestId('epic-decision-row-id-auto-1-source-chip'),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId('epic-decision-row-id-auto-1-user-edited-chip'),
      ).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Test 5 -- Dashboard read-only collapsed summary
// (MigrationDeliveryEpicDecisionsSummary) renders counts.
// ============================================================================

// Mock the dashboard CSS module so style class lookups don't blow up. The
// summary component imports MigrationDeliveryDashboard.module.css directly.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

describe('MigrationDeliveryEpicDecisionsSummary -- read-only summary (T8-5)', () => {
  it('renders count by status per epic and exposes an Edit affordance', () => {
    const summaries = [
      {
        epicWorkItemId: '00000000-0000-0000-0000-00000000aaaa',
        epicTitle: 'Customer-onboarding epic',
        draftCount: 3,
        confirmedCount: 2,
        supersededCount: 1,
      },
    ];
    const onOpenEpicDetail = vi.fn();

    render(
      <MigrationDeliveryEpicDecisionsSummary
        summaries={summaries}
        onOpenEpicDetail={onOpenEpicDetail}
      />,
    );

    // Counts render -- 3 draft, 2 confirmed, 1 superseded, 6 total.
    const counts = screen.getByTestId(
      'mdd-epic-decisions-summary-item-00000000-0000-0000-0000-00000000aaaa-counts',
    );
    expect(counts).toHaveTextContent('6 total');
    expect(counts).toHaveTextContent('2 confirmed');
    expect(counts).toHaveTextContent('3 draft');
    expect(counts).toHaveTextContent('1 superseded');

    // Edit link wires through to the callback with the right epic id.
    fireEvent.click(
      screen.getByTestId(
        'mdd-epic-decisions-summary-item-00000000-0000-0000-0000-00000000aaaa-edit',
      ),
    );
    expect(onOpenEpicDetail).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-00000000aaaa',
    );
  });

  it('renders an empty-state hint when no epics have decisions yet', () => {
    render(
      <MigrationDeliveryEpicDecisionsSummary
        summaries={[]}
        onOpenEpicDetail={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('mdd-epic-decisions-summary-empty'),
    ).toBeInTheDocument();
  });
});
