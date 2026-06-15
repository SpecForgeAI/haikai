/**
 * TargetArchitectureWorkspace Group 7 tests
 *
 * Spec 2026-05-20 Target Architecture Authoring Flow -- Task Group 7 (7.1)
 *
 * Originally six focused tests; three were removed by spec 2026-05-24
 * Target State Sub-tab + Deterministic Suggest (Task Group 4.6 removed
 * the inline add-element handler and the "Add Component / Add API / Add Data entitie /
 * Add Infrastructur" inline-add buttons from the table editor, deleting the
 * UI surface those three tests exercised). The remaining three tests still
 * cover live functionality and pass unchanged:
 *
 *   1. The unmapped-elements panel lists the LEFT JOIN gap returned by AMS,
 *      and the "Mark decommissioned" action calls the atomic write path +
 *      refreshes the panel.
 *   2. The promote-to-active modal calls promote with dryRun=true on open
 *      and renders the impact-preview line ("This will mark N specs stale")
 *      BEFORE the user confirms.
 *   3. Cancel on the promote modal does NOT call the commit endpoint; only
 *      the dry-run call (from open) was fired.
 *
 * Mocking strategy:
 *   Same as the Group 6 test file -- mock the API modules + contexts at the
 *   top of the file. The shared mock for `targetArchitecturesApi` exports
 *   real `mapTargetArchitectureWireToDto` + the typed error class so the
 *   workspace's narrow-cast paths still work.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE imports)
// ---------------------------------------------------------------------------

vi.mock('../../api/targetArchitecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/targetArchitecturesApi')
  >('../../api/targetArchitecturesApi');
  return {
    ...actual,
    listTargetArchitectures: vi.fn(),
    seedTargetArchitecture: vi.fn(),
    deleteTargetArchitecture: vi.fn(),
    listUnmappedCurrentElements: vi.fn(),
    markCurrentElementDecommissioned: vi.fn(),
    mappingSuggest: vi.fn(),
    promoteTargetArchitecture: vi.fn(),
  };
});

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/architecturesApi')
  >('../../api/architecturesApi');
  return {
    ...actual,
    getElementsInventory: vi.fn().mockResolvedValue({ domains: [] }),
    updateArchitecture: vi.fn(),
  };
});

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({
    metaModel: { entities: {}, relationships: {} },
    diagrams: [],
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
  useActiveArchitectureId: vi.fn(),
  useArchitectureDispatch: vi.fn(),
}));

// Imports AFTER mocks so the mocked modules are wired in.
import { TargetArchitectureWorkspace } from './TargetArchitectureWorkspace';
import {
  listTargetArchitectures,
  listUnmappedCurrentElements,
  markCurrentElementDecommissioned,
  mappingSuggest,
  promoteTargetArchitecture,
  type TargetArchitectureDto,
  type UnmappedCurrentElement,
} from '../../api/targetArchitecturesApi';
import { useProject } from '../../contexts/ProjectContext';
import {
  useArchitectureContext,
  useActiveArchitectureId,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-target-arch-group-7';
const ACTIVE_TARGET_ID = 'arch-active-7';
const DRAFT_TARGET_ID = 'arch-draft-7';

const activeTarget: TargetArchitectureDto = {
  id: ACTIVE_TARGET_ID,
  projectId: PROJECT_ID,
  name: 'Draft 2026-05-19 #1',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'active',
  archived: false,
  createdAt: '2026-05-19T08:00:00Z',
  updatedAt: '2026-05-19T08:00:00Z',
elementCount: null,
};

const draftTarget: TargetArchitectureDto = {
  id: DRAFT_TARGET_ID,
  projectId: PROJECT_ID,
  name: 'Draft 2026-05-20 #1',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-05-20T08:00:00Z',
  updatedAt: '2026-05-20T08:00:00Z',
elementCount: null,
};

const orderedTargets = [activeTarget, draftTarget];

const unmappedRows: UnmappedCurrentElement[] = [
  {
    elementId: 'cur-comp-1',
    elementType: 'application_components',
    name: 'Legacy Orders Service',
  },
  {
    elementId: 'cur-iface-1',
    elementType: 'interfaces',
    name: 'Legacy Orders API',
  },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const invalidateCacheMock = vi.fn();
const dispatchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Test project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(ACTIVE_TARGET_ID);
  vi.mocked(useArchitectureDispatch).mockReturnValue(dispatchMock);
  vi.mocked(useArchitectureContext).mockReturnValue({
    invalidateArchitectureModelCache: invalidateCacheMock,
  } as unknown as ReturnType<typeof useArchitectureContext>);

  vi.mocked(listTargetArchitectures).mockResolvedValue(orderedTargets);
  vi.mocked(listUnmappedCurrentElements).mockResolvedValue(unmappedRows);
  vi.mocked(mappingSuggest).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TargetArchitectureWorkspace (Group 7)', () => {
  // -----------------------------------------------------------------------
  // Test 4 (original numbering): Unmapped-elements panel lists the LEFT
  // JOIN gap, and the "Mark decommissioned" action calls the AMS write path
  // then refreshes.
  //
  // Spec 2026-05-24 note: original Tests 1-3 covered the inline add-element
  // flow which was removed by Task Group 4.6 of that spec. Their test bodies
  // were deleted alongside the UI they exercised; the remaining three tests
  // here continue to exercise live functionality (Mark decommissioned, the
  // promote modal's dryRun impact preview, and the cancel-on-promote-modal
  // no-commit guard).
  // -----------------------------------------------------------------------

  it('lists the unmapped LEFT JOIN gap and fires mark-decommissioned on click', async () => {
    vi.mocked(markCurrentElementDecommissioned).mockResolvedValue({
      targetElementId: 'new-target-elem-1',
      mappingId: 'new-mapping-1',
    });

    // First call returns the full list; refresh after the click returns one
    // less row so we can assert the panel re-rendered.
    vi.mocked(listUnmappedCurrentElements)
      .mockResolvedValueOnce(unmappedRows)
      .mockResolvedValueOnce([unmappedRows[1]]);

    render(<TargetArchitectureWorkspace />);

    await waitFor(() => {
      expect(listUnmappedCurrentElements).toHaveBeenCalledWith(
        PROJECT_ID,
        ACTIVE_TARGET_ID,
        ACTIVE_TARGET_ID,
      );
    });

    // Both rows visible on first render.
    expect(
      await screen.findByTestId(
        `target-arch-unmapped-row-${unmappedRows[0].elementId}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        `target-arch-unmapped-row-${unmappedRows[1].elementId}`,
      ),
    ).toBeInTheDocument();

    // Click "Mark decommissioned" on the first row.
    fireEvent.click(
      screen.getByTestId(
        `target-arch-unmapped-mark-decom-${unmappedRows[0].elementId}`,
      ),
    );

    await waitFor(() => {
      expect(markCurrentElementDecommissioned).toHaveBeenCalledWith(
        PROJECT_ID,
        ACTIVE_TARGET_ID,
        {
          currentElementId: unmappedRows[0].elementId,
          currentElementType: unmappedRows[0].elementType,
        },
      );
    });

    // After the refresh, the first row is gone.
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          `target-arch-unmapped-row-${unmappedRows[0].elementId}`,
        ),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Test 5 (original numbering): Promote modal shows the impact preview
  // (fetched via dryRun=true) BEFORE the user confirms.
  // -----------------------------------------------------------------------

  it('shows the impact-preview line in the promote modal before confirm', async () => {
    vi.mocked(promoteTargetArchitecture).mockImplementationOnce(async (_p, _id, opts) => {
      expect(opts?.dryRun).toBe(true);
      return {
        architecture: draftTarget,
        previousActiveId: ACTIVE_TARGET_ID,
        specsMarkedStale: 3,
      };
    });

    render(<TargetArchitectureWorkspace />);

    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });

    // Click "Promote" on the draft row to open the modal.
    fireEvent.click(
      await screen.findByTestId(
        `target-arch-promote-button-${DRAFT_TARGET_ID}`,
      ),
    );

    // Modal opens; dryRun fetch fires.
    expect(
      await screen.findByTestId('target-arch-promote-modal'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(promoteTargetArchitecture).toHaveBeenCalledWith(
        PROJECT_ID,
        DRAFT_TARGET_ID,
        { dryRun: true },
      );
    });

    // Impact preview line surfaces the count returned by the dryRun call.
    const impact = await screen.findByTestId(
      'target-arch-promote-modal-impact',
    );
    expect(impact.textContent ?? '').toContain('3');
    expect(impact.textContent ?? '').toMatch(/stale/i);

    // CRITICAL: only the dry-run call has been fired -- the commit endpoint
    // (the second call) has NOT been hit because the user has not confirmed.
    expect(promoteTargetArchitecture).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Test 6 (original numbering): Promote modal Cancel does NOT call the
  // commit endpoint.
  // -----------------------------------------------------------------------

  it('does not commit when the user cancels the promote modal', async () => {
    vi.mocked(promoteTargetArchitecture).mockResolvedValueOnce({
      architecture: draftTarget,
      previousActiveId: ACTIVE_TARGET_ID,
      specsMarkedStale: 2,
    });

    render(<TargetArchitectureWorkspace />);

    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });

    fireEvent.click(
      await screen.findByTestId(
        `target-arch-promote-button-${DRAFT_TARGET_ID}`,
      ),
    );

    // Wait for the dryRun call (modal open path).
    await waitFor(() => {
      expect(promoteTargetArchitecture).toHaveBeenCalledWith(
        PROJECT_ID,
        DRAFT_TARGET_ID,
        { dryRun: true },
      );
    });

    // Cancel the modal.
    fireEvent.click(screen.getByTestId('target-arch-promote-modal-cancel'));

    // Modal is gone.
    await waitFor(() => {
      expect(
        screen.queryByTestId('target-arch-promote-modal'),
      ).not.toBeInTheDocument();
    });

    // ONLY the dry-run call fired; no commit was issued.
    expect(promoteTargetArchitecture).toHaveBeenCalledTimes(1);
    expect(promoteTargetArchitecture).not.toHaveBeenCalledWith(
      PROJECT_ID,
      DRAFT_TARGET_ID,
      expect.objectContaining({ dryRun: false }),
    );
    expect(promoteTargetArchitecture).not.toHaveBeenCalledWith(
      PROJECT_ID,
      DRAFT_TARGET_ID,
      undefined,
    );
  });
});
