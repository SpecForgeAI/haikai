/**
 * MigrationDeliveryDashboard + MigrationDeliveryStoryDrawer pass-2 surface tests
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.1
 *
 * Covers the 2-8 focused Vitest tests for the new pass-2 frontend surfaces:
 *   1. (T7-1) The story drawer renders the "Pass 2" badge when
 *      `generation_pass = 2`.
 *   2. (T7-2) The drawer renders the "Pass 2: no meaningful change" badge
 *      when `no_meaningful_change = true` -- and the pass-2 badge is NOT
 *      hidden in that case (both render side-by-side).
 *   3. (T7-3) The inline diff renders red ("- ") + green ("+ ") highlights
 *      derived from `pass1_spec_text` vs the current `generated_spec_text`.
 *   4. (T7-4) The "what changed and why" summary renders ABOVE the diff
 *      (DOM order assertion).
 *   5. (T7-5) `contradicts_sibling` warnings render in the cross-story
 *      warnings panel with the sibling work-item id.
 *   6. (T7-6) The budget warning ("Trimmed N sibling specs",
 *      "Trimmed M evidence refs", "no_sibling_context_available") renders
 *      inline when `budget_meta.trimmed` has non-zero counts.
 *   7. (T7-7) The Generate-all dialog's per-batch auto-run pass-2 toggle
 *      defaults to the project setting AND is overrideable in the dialog.
 *
 * Test conventions mirror the existing dashboard test files:
 *   - vi.mock the CSS module via a Proxy so class-name access does not blow up.
 *   - vi.mock the API client surfaces BEFORE importing components.
 *   - vi.resetAllMocks() in beforeEach.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mock CSS module ---------------------------------------------------------
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// ---- Mock dashboard API ------------------------------------------------------
const mockGetDashboard = vi.fn();
vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: (...args: unknown[]) =>
      mockGetDashboard(...args),
  };
});

// ---- Mock cost-preview API ---------------------------------------------------
const mockFetchCostPreview = vi.fn();
vi.mock('../../../../api/migrationShapeSpecCostPreviewApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationShapeSpecCostPreviewApi')
  >('../../../../api/migrationShapeSpecCostPreviewApi');
  return {
    ...actual,
    fetchMigrationShapeSpecCostPreview: (...args: unknown[]) =>
      mockFetchCostPreview(...args),
  };
});

import {
  MigrationDeliveryStoryDrawer,
  type StoryPassTwoDetail,
} from '../MigrationDeliveryStoryDrawer';
import { MigrationDeliveryGenerateAllDialog } from '../MigrationDeliveryGenerateAllDialog';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

// Silence the "'React' is declared but its value is never read" check; React
// is the JSX runtime here so the import IS load-bearing.
void React;

// ============================================================================
// Fixtures
// ============================================================================

function makeStory(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto> = {},
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: 'story-1',
    parentId: 'feature-1',
    type: 'story',
    title: 'Migrate order-service create endpoint',
    workstream: 'order-service',
    sequenceOrder: 1,
    workItemId: 'wi-1',
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: 'high',
    implementationStatus: 'not_started',
    evidenceStatus: 'no_evidence',
    needsAttentionCount: 0,
    missingInputsCount: 0,
    children: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// Test 1 -- Pass 2 badge renders when generation_pass = 2
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- Pass 2 badge (T7-1)', () => {
  it('renders the "Pass 2" badge when generationPass === 2', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: '## decisions\n- choose A',
      generatedSpecText: '## decisions\n- choose B',
      pass2ChangesSummary: 'Aligned with sibling wi-2 decision.',
      budgetMetaJson: null,
      noMeaningfulChange: false,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    const badge = screen.getByTestId('mdd-story-drawer-pass-2-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/Pass 2/);
  });

  it('does NOT render the "Pass 2" badge for legacy / pass-1 rows', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 1,
      pass1SpecText: null,
      generatedSpecText: '## decisions\n- choose A',
      pass2ChangesSummary: null,
      budgetMetaJson: null,
      noMeaningfulChange: null,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('mdd-story-drawer-pass-2-badge'),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// Test 2 -- "Pass 2: no meaningful change" badge renders alongside the
// pass-2 badge (the pass-2 status is NOT hidden when noMeaningfulChange).
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- No-meaningful-change badge (T7-2)', () => {
  it('renders BOTH the Pass-2 badge AND the no-meaningful-change badge when noMeaningfulChange is true', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: '## decisions\n- choose A',
      generatedSpecText: '## decisions\n- choose A',
      pass2ChangesSummary: 'No siblings changed our decisions.',
      budgetMetaJson: null,
      noMeaningfulChange: true,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    // Pass-2 status is NOT hidden -- both chips render.
    expect(
      screen.getByTestId('mdd-story-drawer-pass-2-badge'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-story-drawer-no-meaningful-change-badge'),
    ).toHaveTextContent(/Pass 2: no meaningful change/);
  });
});

// ============================================================================
// Test 3 -- Inline diff renders red/green highlights from pass1 vs current.
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- inline diff red/green highlights (T7-3)', () => {
  it('emits added / removed line tokens between pass1_spec_text and generated_spec_text', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: 'A\nB\nC',
      generatedSpecText: 'A\nB2\nC',
      pass2ChangesSummary: 'Edited line B per sibling decision.',
      budgetMetaJson: null,
      noMeaningfulChange: false,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    const diff = screen.getByTestId('mdd-story-drawer-inline-diff');
    // Walk every diff line node and gather the data-op attribute.
    const ops = Array.from(diff.querySelectorAll('[data-op]')).map((n) =>
      (n as HTMLElement).getAttribute('data-op'),
    );
    // We expect to see both at least one 'removed' (the old B) and
    // one 'added' (the new B2). The exact ordering is LCS-driven; just
    // assert presence of both signals.
    expect(ops).toContain('removed');
    expect(ops).toContain('added');
    // Equal lines also appear for A and C.
    expect(ops.filter((o) => o === 'equal').length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Test 4 -- "What changed and why" summary renders above the diff (DOM order).
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- changes summary above diff (T7-4)', () => {
  it('renders pass2_changes_summary BEFORE the inline diff in the DOM', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: 'A',
      generatedSpecText: 'A\nB',
      pass2ChangesSummary: 'Added B because sibling wi-9 requires it.',
      budgetMetaJson: null,
      noMeaningfulChange: false,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    const summary = screen.getByTestId(
      'mdd-story-drawer-pass-2-changes-summary',
    );
    const diff = screen.getByTestId('mdd-story-drawer-inline-diff');
    expect(summary).toHaveTextContent(/sibling wi-9 requires it/);
    // compareDocumentPosition returns DOCUMENT_POSITION_FOLLOWING (4) when
    // the argument node comes AFTER the receiver.
    // eslint-disable-next-line no-bitwise
    expect(summary.compareDocumentPosition(diff) & 4).toBe(4);
  });
});

// ============================================================================
// Test 5 -- contradicts_sibling warnings render with sibling work-item id.
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- contradicts_sibling warnings (T7-5)', () => {
  it('renders one row per contradicts_sibling warning with the sibling work-item id', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: 'A',
      generatedSpecText: 'A',
      pass2ChangesSummary: null,
      budgetMetaJson: null,
      noMeaningfulChange: false,
      warnings: [
        {
          kind: 'contradicts_sibling',
          siblingWorkItemId: 'wi-77',
          conflictingDecisionKey: 'transaction-isolation',
          severity: 'review',
        },
        {
          kind: 'contradicts_sibling',
          siblingWorkItemId: 'wi-99',
          conflictingDecisionKey: 'retry-policy',
          severity: 'review',
        },
        // Non-contradiction warning that should be ignored by this panel.
        {
          kind: 'parser_missing_heading',
          heading: 'interfaces',
        },
      ],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('mdd-story-drawer-warnings-panel'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-story-drawer-contradiction-warning-0-sibling-id'),
    ).toHaveTextContent(/wi-77/);
    expect(
      screen.getByTestId('mdd-story-drawer-contradiction-warning-1-sibling-id'),
    ).toHaveTextContent(/wi-99/);
  });
});

// ============================================================================
// Test 6 -- Budget warning renders when budget_meta.trimmed has non-zero
// counts OR no_sibling_context_available is present.
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- budget warning inline (T7-6)', () => {
  it('renders "Trimmed N sibling specs", "Trimmed M evidence refs", and "no_sibling_context_available" inline', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: 'A',
      generatedSpecText: 'A',
      pass2ChangesSummary: null,
      budgetMetaJson: {
        used_tokens: 20000,
        max_tokens: 24000,
        trimmed: {
          sibling_specs_dropped: 4,
          evidence_refs_dropped: 7,
          findings_dropped: 0,
        },
        warnings: ['no_sibling_context_available: budget too small'],
      },
      noMeaningfulChange: false,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    const banner = screen.getByTestId('mdd-story-drawer-budget-warning');
    expect(banner).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-story-drawer-budget-warning-sibling-specs'),
    ).toHaveTextContent(/Trimmed 4 sibling spec/);
    expect(
      screen.getByTestId('mdd-story-drawer-budget-warning-evidence-refs'),
    ).toHaveTextContent(/Trimmed 7 evidence ref/);
    expect(
      screen.getByTestId('mdd-story-drawer-budget-warning-no-sibling-context'),
    ).toHaveTextContent(/no_sibling_context_available/);
  });

  it('does NOT render the budget banner when no trimming or warnings are present', () => {
    const specGen: StoryPassTwoDetail = {
      generationPass: 2,
      pass1SpecText: 'A',
      generatedSpecText: 'A',
      pass2ChangesSummary: null,
      budgetMetaJson: {
        used_tokens: 8000,
        max_tokens: 24000,
        trimmed: {
          sibling_specs_dropped: 0,
          evidence_refs_dropped: 0,
          findings_dropped: 0,
        },
        warnings: [],
      },
      noMeaningfulChange: false,
      warnings: [],
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={null}
        specGeneration={specGen}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('mdd-story-drawer-budget-warning'),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// Test 7 -- Per-batch auto-run pass-2 toggle defaults to project setting
// and is overrideable in the dialog. Generate-all is disabled when the
// concurrency-lock signal is non-null.
// ============================================================================

describe('MigrationDeliveryGenerateAllDialog -- pass-2 toggle + cost preview (T7-7)', () => {
  it('initialises the pass-2 toggle from defaultAutoRunPass2 and forwards the override on confirm', async () => {
    mockFetchCostPreview.mockResolvedValueOnce({
      estimatedTokens: 100000,
      estimatedWallClockSeconds: 2000,
      perStoryEstimates: [],
      meta: {
        storyCount: 4,
        includePass2: true,
        perStoryContextTokenCap: 24000,
        crossStoryContextTokenCap: 12000,
        tokensPerSecond: 50,
        outputBufferTokens: 2000,
      },
    });

    const onConfirm = vi.fn();

    render(
      <MigrationDeliveryGenerateAllDialog
        projectId="p-1"
        bookOfWorkId="b-1"
        defaultAutoRunPass2={true}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    // Default reflects the project setting.
    const toggle = screen.getByTestId(
      'mdd-generate-all-dialog-pass2-toggle',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await waitFor(() => {
      expect(mockFetchCostPreview).toHaveBeenCalled();
    });

    // Override: flip it off.
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);

    // Confirm forwards the user's override, not the default.
    fireEvent.click(screen.getByTestId('mdd-generate-all-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ autoRunPass2: false });
  });

  it('disables Generate-all when concurrencyLockError is present and shows the banner', () => {
    mockFetchCostPreview.mockResolvedValueOnce({
      estimatedTokens: 0,
      estimatedWallClockSeconds: 0,
      perStoryEstimates: [],
      meta: {
        storyCount: 0,
        includePass2: false,
        perStoryContextTokenCap: 24000,
        crossStoryContextTokenCap: 12000,
        tokensPerSecond: 50,
        outputBufferTokens: 2000,
      },
    });

    render(
      <MigrationDeliveryGenerateAllDialog
        projectId="p-1"
        bookOfWorkId="b-1"
        defaultAutoRunPass2={false}
        concurrencyLockError={{
          code: 'WORKSTREAM_LOCKED',
          message: 'Batch in progress',
          workstreamId: 'ws-1',
          activePass: 2,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const confirm = screen.getByTestId(
      'mdd-generate-all-dialog-confirm',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const banner = screen.getByTestId('mdd-generate-all-dialog-lock-banner');
    expect(banner).toHaveTextContent(/Batch in progress \(pass 2 of 2\)/);
  });
});
