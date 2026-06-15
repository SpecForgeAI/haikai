/**
 * Cross-layer gap coverage for the In-Product Spec Editor + Confirm-Overwrite
 * feature on the frontend layers.
 *
 * Task Group 10 audit identified these gaps in the existing Group 6-9 suites:
 *
 *   1. Drawer save -> quality grade chip refresh chain. Existing Group 7 test
 *      verifies `onManualEditSaved` is called and the Edited indicator
 *      appears, but does NOT assert the `mdd-story-drawer-quality-grade-badge`
 *      data-grade attribute updates from the returned DTO's qualityGrade.
 *      This is the auto-refresh chain end-to-end (save -> AMS pipeline ->
 *      DTO -> drawer state replaced).
 *
 *   2. Prefix-warning NOT shown when the saved text DOES start with
 *      `/agent-os:shape-spec`. Existing Group 7 test covers the positive
 *      warning case; the negative case is unproven, leaving the regex
 *      condition untested in one direction.
 *
 *   3. Diff toggle round-trip: save -> previousSpecText populated on the
 *      returned DTO -> user returns to View mode -> diff toggle materialises
 *      in the DOM. Existing Group 7 test mounts the drawer with
 *      `previousSpecText` already set; this test proves the toggle appears
 *      after a successful save when the prior state had no previous version,
 *      AND the inline diff renders when the toggle is clicked.
 *
 *   4. Bulk modal: when at least one row is checked, `onConfirm` must carry
 *      the allow-list AND the upstream caller should know to pair it with
 *      `overwriteManuallyEdited: true`. This test pins the contract: the
 *      checked rows surface verbatim so the caller can branch on
 *      `manuallyEditedWorkItemIdsToOverwrite.length > 0` to decide whether to
 *      send the flag.
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 10.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';

// CSS module Proxy stub so class lookups never throw.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock CodeMirror with a controlled textarea (same shape as the existing
// Group 7 drawer suite). Real CodeMirror is heavy in jsdom and synthetic
// events do not exercise its keymap.
vi.mock('@uiw/react-codemirror', async () => {
  const ReactModule = await import('react');
  const Mock = ReactModule.forwardRef<
    unknown,
    {
      value?: string;
      readOnly?: boolean;
      onChange?: (next: string) => void;
    }
  >(function MockCodeMirror(props, ref) {
    ReactModule.useImperativeHandle(
      ref,
      () => ({ editor: null, state: null, view: null }),
      [],
    );
    return ReactModule.createElement('textarea', {
      'data-testid': 'mock-codemirror-textarea',
      value: props.value ?? '',
      readOnly: props.readOnly === true,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (props.onChange) props.onChange(e.target.value);
      },
    });
  });
  return { __esModule: true, default: Mock };
});

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({ __marker: 'markdown-extension' }),
}));

vi.mock('@codemirror/view', () => ({
  keymap: { of: (_b: unknown) => ({ __marker: 'keymap-extension' }) },
}));

// API stubs.
const mockManualEditSpec = vi.fn();
const mockRecomputeSpecQuality = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    manualEditSpec: (...args: unknown[]) => mockManualEditSpec(...args),
    recomputeSpecQuality: (...args: unknown[]) =>
      mockRecomputeSpecQuality(...args),
  };
});

// Toast.
const mockShowToast = vi.fn();
vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import {
  MigrationDeliveryStoryDrawer,
  type StoryPassTwoDetail,
} from '../MigrationDeliveryStoryDrawer';
import BulkManualEditOverwriteModal from '../BulkManualEditOverwriteModal';
import type {
  ManuallyEditedScopeRow,
  SpecGenerationRow,
} from '../../../../api/specGenerationApi';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

function makeStory(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto> = {},
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: 'story-x',
    parentId: 'feature-1',
    type: 'story',
    title: 'Story',
    workstream: 'order-service',
    sequenceOrder: 1,
    workItemId: 'wi-x',
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: 'medium',
    implementationStatus: 'not_started',
    evidenceStatus: 'no_evidence',
    needsAttentionCount: 0,
    missingInputsCount: 0,
    children: [],
    ...overrides,
  };
}

function makeSpec(
  overrides: Partial<StoryPassTwoDetail> = {},
): StoryPassTwoDetail {
  return {
    generationPass: 1,
    pass1SpecText: null,
    generatedSpecText: '/agent-os:shape-spec\noriginal text',
    pass2ChangesSummary: null,
    budgetMetaJson: null,
    noMeaningfulChange: null,
    warnings: [],
    specGenerationId: 'spec-x',
    qualityScore: 50,
    qualityGrade: 'D',
    qualityDimensions: null,
    previousQualityScore: null,
    manuallyEdited: false,
    lastManuallyEditedAt: null,
    lastManuallyEditedBy: null,
    previousSpecText: null,
    ...overrides,
  };
}

function makeReturnedRow(
  overrides: Partial<SpecGenerationRow> = {},
): SpecGenerationRow {
  return {
    id: 'spec-x',
    projectId: 'p-1',
    workItemId: 'wi-x',
    bookOfWorkId: 'b-1',
    bookItemId: 'bi-1',
    status: 'generated',
    confidence: 'medium',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: '/agent-os:shape-spec\nedited text',
    warnings: [],
    missingInputs: [],
    focusedContextRefs: null,
    evidenceRefs: [],
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: null,
    createdAt: null,
    updatedAt: null,
    manuallyEdited: true,
    lastManuallyEditedAt: '2026-05-20T12:30:00Z',
    lastManuallyEditedBy: 'user-alice',
    previousSpecText: '/agent-os:shape-spec\noriginal text',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ----------------------------------------------------------------------------
// Gap 1: Save -> grade chip refreshes from the returned DTO (auto-refresh
// chain). Pre-save grade is "D" (50); post-save grade is "B" (80). The
// drawer state machine must replace qualityGrade + qualityScore from the
// returned row in one round-trip.
// ----------------------------------------------------------------------------

describe('Drawer save -> quality grade chip auto-refresh (Group 10 gap)', () => {
  it('refreshes the grade chip + score from the returned DTOs quality fields', async () => {
    mockManualEditSpec.mockResolvedValueOnce(
      makeReturnedRow({
        // Returned DTO carries the refreshed quality fields. Cast through
        // `as never` to avoid wrestling with the SpecGenerationRow shape on
        // the lazy index signature -- the drawer reads via duck typing
        // (`as { qualityGrade?: ... }`).
        ...({ qualityScore: 80, qualityGrade: 'B' } as never),
      }),
    );

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec()}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );

    // Pre-save: grade is "D" from initial spec.
    expect(
      screen.getByTestId('mdd-story-drawer-quality-grade-badge').textContent,
    ).toBe('D');

    // Enter edit mode + change text + save.
    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '/agent-os:shape-spec\nedited text' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mdd-story-drawer-save-button'));
    });

    // Post-save: grade chip reflects the DTO's qualityGrade.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-story-drawer-quality-grade-badge').textContent,
      ).toBe('B');
    });
    expect(
      screen.getByTestId('mdd-story-drawer-quality-score-value').textContent,
    ).toContain('80');
  });
});

// ----------------------------------------------------------------------------
// Gap 2: Prefix-warning toast is NOT raised when text DOES start with
// `/agent-os:shape-spec`. Negative case proving the regex condition fires
// only on the missing-prefix branch.
// ----------------------------------------------------------------------------

describe('Drawer save -- no prefix-warning toast when prefix present (Group 10 gap)', () => {
  it('does NOT show the prefix-warning toast when the saved text starts with /agent-os:shape-spec', async () => {
    mockManualEditSpec.mockResolvedValueOnce(makeReturnedRow());

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec()}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '/agent-os:shape-spec\nrevised body' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mdd-story-drawer-save-button'));
    });

    await waitFor(() => {
      expect(mockManualEditSpec).toHaveBeenCalledTimes(1);
    });

    // No toast invocations referencing the prefix warning.
    const prefixToastCall = mockShowToast.mock.calls.find((c) =>
      typeof c[0] === 'string' &&
      (c[0] as string).includes('/agent-os:shape-spec'),
    );
    expect(prefixToastCall).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// Gap 3: Diff toggle round-trip after save. Starts with previousSpecText=null
// (no toggle); after the save returns a populated previousSpecText AND the
// user returns to View mode the toggle materialises in the DOM. The diff
// toggle lives in the spec-text-section header only when editorMode === 'view'
// (the in-edit slot is occupied by the save-status badge), so the user must
// switch back to view mode after save to see it.
// ----------------------------------------------------------------------------

describe('Drawer save -- diff toggle round-trip (Group 10 gap)', () => {
  it('renders the View-previous-version toggle after save+return-to-view, and the diff renders on click', async () => {
    mockManualEditSpec.mockResolvedValueOnce(
      makeReturnedRow({
        previousSpecText: '/agent-os:shape-spec\noriginal text',
        generatedSpecText: '/agent-os:shape-spec\nrevised body',
      }),
    );

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        // Pre-save: no prior version.
        specGeneration={makeSpec({ previousSpecText: null })}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );

    // Pre-save: toggle is absent.
    expect(
      screen.queryByTestId('mdd-story-drawer-previous-version-toggle'),
    ).not.toBeInTheDocument();

    // Enter edit, change text, save.
    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '/agent-os:shape-spec\nrevised body' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mdd-story-drawer-save-button'));
    });

    // Wait for the save to land (Edited indicator + saved status).
    await waitFor(() => {
      expect(mockManualEditSpec).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-story-drawer-edited-indicator'),
      ).toBeInTheDocument();
    });

    // Switch back to View mode -- the diff toggle lives in the view-mode
    // header slot (the edit-mode slot is occupied by the save-status badge).
    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));

    // Post-save AND in view mode: the drawer state has replaced
    // previousSpecText from the DTO; the toggle materialises.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-story-drawer-previous-version-toggle'),
      ).toBeInTheDocument();
    });

    // Clicking the toggle renders the inline diff.
    fireEvent.click(
      screen.getByTestId('mdd-story-drawer-previous-version-toggle'),
    );
    expect(
      screen.getByTestId('mdd-story-drawer-previous-version-diff'),
    ).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Gap 4: Bulk-modal Confirm with a partial allow-list. The Group 9 test
// already pins `manuallyEditedWorkItemIdsToOverwrite: ['wi-2']`; this gap
// test asserts that the SKIPPED row is excluded from the payload too, so the
// caller can safely compute `overwriteManuallyEdited =
// payload.manuallyEditedWorkItemIdsToOverwrite.length > 0`.
// ----------------------------------------------------------------------------

describe('Bulk modal -- partial allow-list excludes skipped rows (Group 10 gap)', () => {
  it('Confirm payload contains ONLY checked rows; unchecked rows do not leak', () => {
    const rows: ManuallyEditedScopeRow[] = [
      {
        workItemId: 'wi-keep-1',
        workItemTitle: 'Keep 1',
        specGenerationId: 'spec-1',
        lastManuallyEditedAt: '2026-05-20T10:00:00Z',
        lastManuallyEditedBy: 'user-alice',
      },
      {
        workItemId: 'wi-skip',
        workItemTitle: 'Skip me',
        specGenerationId: 'spec-2',
        lastManuallyEditedAt: '2026-05-20T11:00:00Z',
        lastManuallyEditedBy: 'user-bob',
      },
      {
        workItemId: 'wi-keep-3',
        workItemTitle: 'Keep 3',
        specGenerationId: 'spec-3',
        lastManuallyEditedAt: '2026-05-20T12:00:00Z',
        lastManuallyEditedBy: 'user-carol',
      },
    ];
    const onConfirm = vi.fn();

    render(
      <BulkManualEditOverwriteModal
        rows={rows}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Check 1 + 3 only; leave the middle row unchecked.
    fireEvent.click(
      screen.getByTestId(
        'manual-edit-overwrite-bulk-modal-row-wi-keep-1-checkbox',
      ),
    );
    fireEvent.click(
      screen.getByTestId(
        'manual-edit-overwrite-bulk-modal-row-wi-keep-3-checkbox',
      ),
    );
    fireEvent.click(
      screen.getByTestId('manual-edit-overwrite-bulk-modal-confirm'),
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0][0] as {
      manuallyEditedWorkItemIdsToOverwrite: string[];
    };
    // Exact membership: skipped row excluded; checked rows present in order.
    expect(payload.manuallyEditedWorkItemIdsToOverwrite).toEqual([
      'wi-keep-1',
      'wi-keep-3',
    ]);
    expect(payload.manuallyEditedWorkItemIdsToOverwrite).not.toContain(
      'wi-skip',
    );
  });
});
