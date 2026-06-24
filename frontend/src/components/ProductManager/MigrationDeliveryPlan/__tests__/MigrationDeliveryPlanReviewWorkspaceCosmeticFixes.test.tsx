/**
 * MigrationBookOfWorkReviewWorkspace -- cosmetic fixes (2026-06-24)
 *
 * Covers the five review-workspace fixes:
 *   1. "Save draft" gives explicit feedback (saving -> saved indicator +
 *      success toast) and surfaces failures via an error toast; clicking with
 *      nothing to save emits an info toast instead of a dead click.
 *   2. Per-row selection checkboxes drive `saveState 'selected'`; toggling a
 *      PARENT cascades to its whole subtree, and a parent renders
 *      indeterminate when only some descendants are selected.
 *   5. A "Back to plans" affordance invokes the navigation callback.
 *
 * (Points 3 + 4 are pure layout/CSS and are not asserted here.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../../../contexts/ToastContext';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationBookOfWorkApi';

// --- Mock the CSS module so class-name assertions don't blow up ---------
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- Mock the API client ------------------------------------------------
const mockGetMigrationBookOfWork = vi.fn();
const mockUpdateMigrationBookOfWork = vi.fn();
const mockSaveMigrationBookOfWorkToBacklog = vi.fn();
const mockListMigrationBookOfWorks = vi.fn();

vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    getMigrationBookOfWork: (...args: unknown[]) =>
      mockGetMigrationBookOfWork(...args),
    updateMigrationBookOfWork: (...args: unknown[]) =>
      mockUpdateMigrationBookOfWork(...args),
    saveMigrationBookOfWorkToBacklog: (...args: unknown[]) =>
      mockSaveMigrationBookOfWorkToBacklog(...args),
    listMigrationBookOfWorks: (...args: unknown[]) =>
      mockListMigrationBookOfWorks(...args),
  };
});

import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function makeItem(
  overrides: Partial<MigrationBookOfWorkItem> = {},
): MigrationBookOfWorkItem {
  return {
    id: 'i-default',
    type: 'initiative',
    parentId: null,
    title: 'Default item',
    description: 'desc',
    acceptanceCriteria: [],
    workstream: 'other',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
    evidenceReferences: [],
    architectureReferences: [],
    apiBaselineReferences: [],
    discoveryFindingReferences: [],
    mappingReferences: [],
    sourceContextRefs: [],
    ...overrides,
  };
}

function makeDraft(items: MigrationBookOfWorkItem[]): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    status: 'draft',
    title: 'Test migration plan',
    summary: 'Summary text',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: { items },
    createdAt: '2026-05-17T10:00:00Z',
    updatedAt: '2026-05-17T10:00:00Z',
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
  };
}

/** Linear init -> epic -> feat -> story chain. */
function makeLinearItems(): MigrationBookOfWorkItem[] {
  return [
    makeItem({ id: 'init-1', type: 'initiative', parentId: null, title: 'I-1', sequenceOrder: 10 }),
    makeItem({ id: 'epic-1', type: 'epic', parentId: 'init-1', title: 'E-1', sequenceOrder: 10 }),
    makeItem({ id: 'feat-1', type: 'feature', parentId: 'epic-1', title: 'F-1', sequenceOrder: 10 }),
    makeItem({ id: 'story-1', type: 'story', parentId: 'feat-1', title: 'S-1', sequenceOrder: 10 }),
  ];
}

function renderWorkspace(extraProps: Record<string, unknown> = {}) {
  return render(
    <ToastProvider>
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        {...extraProps}
      />
    </ToastProvider>,
  );
}

describe('Review workspace cosmetic fixes -- per-row selection checkboxes (point 2)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('checking a PARENT checkbox cascades selection to all descendants; unchecking clears them', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Check the top initiative -> every descendant flips to 'selected'.
    fireEvent.click(screen.getByTestId('hierarchy-node-checkbox-init-1'));
    await waitFor(() =>
      expect(screen.getByTestId('badge-savestate-init-1')).toHaveTextContent(
        'selected',
      ),
    );
    for (const id of ['epic-1', 'feat-1', 'story-1']) {
      expect(screen.getByTestId(`badge-savestate-${id}`)).toHaveTextContent(
        'selected',
      );
    }
    // The parent checkbox is now fully checked (not indeterminate).
    const parent = screen.getByTestId(
      'hierarchy-node-checkbox-init-1',
    ) as HTMLInputElement;
    expect(parent.checked).toBe(true);
    expect(parent.indeterminate).toBe(false);

    // Uncheck the parent -> all descendants return to draft (no badge).
    fireEvent.click(screen.getByTestId('hierarchy-node-checkbox-init-1'));
    await waitFor(() =>
      expect(screen.queryByTestId('badge-savestate-init-1')).toBeNull(),
    );
    for (const id of ['epic-1', 'feat-1', 'story-1']) {
      expect(screen.queryByTestId(`badge-savestate-${id}`)).toBeNull();
    }
  });

  it('a parent renders INDETERMINATE when only some of its subtree is selected', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Select only the deepest leaf.
    fireEvent.click(screen.getByTestId('hierarchy-node-checkbox-story-1'));
    await waitFor(() =>
      expect(screen.getByTestId('badge-savestate-story-1')).toHaveTextContent(
        'selected',
      ),
    );

    // Every ancestor is partially selected -> indeterminate, not checked.
    for (const id of ['init-1', 'epic-1', 'feat-1']) {
      const box = screen.getByTestId(
        `hierarchy-node-checkbox-${id}`,
      ) as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(box.indeterminate).toBe(true);
    }
    const leaf = screen.getByTestId(
      'hierarchy-node-checkbox-story-1',
    ) as HTMLInputElement;
    expect(leaf.checked).toBe(true);
    expect(leaf.indeterminate).toBe(false);
  });

  it('toggling a checkbox does NOT open the item drawer (selection vs focus are separate)', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('hierarchy-node-checkbox-story-1'));
    // The drawer for story-1 must NOT have opened from a checkbox click.
    expect(screen.queryByTestId('item-drawer-story-1')).toBeNull();
  });
});

describe('Review workspace cosmetic fixes -- save-draft feedback (point 1)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('clicking Save draft with NO changes emits an info toast instead of a dead click', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-draft-button'));
    await waitFor(() =>
      expect(screen.getByTestId('global-toast')).toHaveTextContent(
        /No unsaved review changes/i,
      ),
    );
    expect(mockUpdateMigrationBookOfWork).not.toHaveBeenCalled();
  });

  it('a successful Save draft shows the saved indicator and a success toast', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    mockUpdateMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Make a change so there is something to persist.
    fireEvent.click(screen.getByTestId('hierarchy-node-checkbox-init-1'));
    await waitFor(() =>
      expect(
        screen.getByTestId('unsaved-review-changes-indicator'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-draft-button'));
    await waitFor(() =>
      expect(mockUpdateMigrationBookOfWork).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByTestId('draft-saved-indicator')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('global-toast')).toHaveTextContent(/Draft saved/i);
  });

  it('a failed Save draft surfaces an error toast and does NOT show the saved indicator', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    mockUpdateMigrationBookOfWork.mockRejectedValueOnce(new Error('boom'));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('hierarchy-node-checkbox-init-1'));
    await waitFor(() =>
      expect(
        screen.getByTestId('unsaved-review-changes-indicator'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-draft-button'));
    await waitFor(() =>
      expect(screen.getByTestId('global-toast')).toHaveTextContent(
        /Failed to save draft/i,
      ),
    );
    expect(screen.queryByTestId('draft-saved-indicator')).toBeNull();
  });
});

describe('Review workspace -- horizontal scroll canvas + resizable detail panel', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
  });

  it('wraps the hierarchy in a horizontal-scroll canvas', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );
    // The scroll canvas wraps the tree rows so wide rows overflow-scroll
    // instead of clipping.
    const canvas = screen.getByTestId('hierarchy-scroll-content');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toContainElement(screen.getByTestId('hierarchy-node-init-1'));
  });

  it('drags the resize handle to change the detail panel width', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    const rightPanel = screen.getByTestId('right-panel');
    // Default width.
    expect(rightPanel).toHaveStyle({ width: '420px' });

    // Pin the body's right edge so the handler can compute a width from clientX.
    const body = screen.getByTestId('workspace-body');
    body.getBoundingClientRect = () =>
      ({ right: 1000, left: 0, top: 0, bottom: 0, width: 1000, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;

    fireEvent.mouseDown(screen.getByTestId('right-panel-resize-handle'));
    // Drag left to clientX=600 → width = 1000 - 600 = 400 (within bounds).
    fireEvent.mouseMove(window, { clientX: 600 });
    expect(rightPanel).toHaveStyle({ width: '400px' });

    // Drag past the max bound → clamped to 760.
    fireEvent.mouseMove(window, { clientX: 100 });
    expect(rightPanel).toHaveStyle({ width: '760px' });

    fireEvent.mouseUp(window);
    // After mouseUp, further moves are ignored.
    fireEvent.mouseMove(window, { clientX: 900 });
    expect(rightPanel).toHaveStyle({ width: '760px' });
  });
});

describe('Review workspace cosmetic fixes -- back navigation (point 5)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
  });

  it('renders a "Back to plans" button that invokes the navigation callback', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    const onBackToPlans = vi.fn();
    renderWorkspace({ onBackToPlans });
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('back-to-plans-button'));
    expect(onBackToPlans).toHaveBeenCalledTimes(1);
  });

  it('omits the back button when no callback is supplied', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(makeLinearItems()));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('back-to-plans-button')).toBeNull();
  });
});
