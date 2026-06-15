/**
 * TargetArchitectureWorkspace tests
 *
 * Spec 2026-05-20 Target Architecture Authoring Flow -- Task Group 6 (6.1)
 *
 * Focused tests (6 total -- per the task cap of 6):
 *   1. Drafts panel renders every kind='target' row returned by the API.
 *   2. The active draft row receives the active highlight + active badge.
 *   3. Inline-editing a draft name calls the architecturesApi.updateArchitecture
 *      PATCH (the standard architecture PATCH; spec says "inline-edit on draft
 *      name calls PATCH (or relevant API)").
 *   4. Delete draft removes it from the list; the active draft can also be
 *      deleted (it is demoted from active first, behind a confirm).
 *   5. Seed dialog with mode=blank calls the API + the new draft appears in
 *      the drafts list.
 *   6. Seed dialog renders the from-template option as DISABLED in v1 per
 *      spec.
 *
 * Mocking strategy:
 *   - vi.mock the API modules at the top of the file so the workspace's
 *     network calls become controlled.
 *   - vi.mock the ArchitectureContext + ProjectContext so the workspace's
 *     hooks resolve without a real provider tree.
 *   - The LOAD_MODEL dispatch assertion piggy-backs on the seed test (Test 5):
 *     when a mutation targets the active architecture id the workspace must
 *     call loadModelByProjectId + dispatch LOAD_MODEL per
 *     project_appshell_model_cache.md.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
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
  seedTargetArchitecture,
  deleteTargetArchitecture,
  type TargetArchitectureDto,
} from '../../api/targetArchitecturesApi';
import { updateArchitecture } from '../../api/architecturesApi';
import { loadModelByProjectId } from '../../api/modelApi';
import { useProject } from '../../contexts/ProjectContext';
import {
  useArchitectureContext,
  useActiveArchitectureId,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-target-arch-1';
const ACTIVE_ARCH_ID = 'arch-active-1';

const draftActive: TargetArchitectureDto = {
  id: ACTIVE_ARCH_ID,
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

const draftRecent: TargetArchitectureDto = {
  id: 'arch-draft-2',
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

const draftLlm: TargetArchitectureDto = {
  id: 'arch-draft-llm',
  projectId: PROJECT_ID,
  name: 'Draft from LLM suggest',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-05-20T09:00:00Z',
  updatedAt: '2026-05-20T09:00:00Z',
elementCount: null,
};

// AMS ordering: active-first then most-recent.
const orderedRows = [draftActive, draftLlm, draftRecent];

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
  vi.mocked(useActiveArchitectureId).mockReturnValue(ACTIVE_ARCH_ID);
  vi.mocked(useArchitectureDispatch).mockReturnValue(dispatchMock);
  vi.mocked(useArchitectureContext).mockReturnValue({
    invalidateArchitectureModelCache: invalidateCacheMock,
  } as unknown as ReturnType<typeof useArchitectureContext>);
  vi.mocked(listTargetArchitectures).mockResolvedValue(orderedRows);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Test 1: drafts panel lists every kind='target' row in AMS order.
// ---------------------------------------------------------------------------

describe('TargetArchitectureWorkspace (Group 6.1)', () => {
  it('renders every target draft returned by listTargetArchitectures in server order', async () => {
    render(<TargetArchitectureWorkspace />);

    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });

    // All three rows present.
    expect(
      await screen.findByTestId(`target-arch-draft-row-${draftActive.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`target-arch-draft-row-${draftLlm.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`target-arch-draft-row-${draftRecent.id}`),
    ).toBeInTheDocument();

    // Each row reflects the persisted name (auto-named "Draft from LLM suggest"
    // appears verbatim in the inline name input).
    const llmInput = screen.getByTestId(
      `target-arch-draft-name-input-${draftLlm.id}`,
    ) as HTMLInputElement;
    expect(llmInput.defaultValue).toBe('Draft from LLM suggest');
  });

  // -------------------------------------------------------------------------
  // Test 2: the active draft row receives the active-row highlight + badge.
  // -------------------------------------------------------------------------

  it('highlights the active draft row and surfaces an "Active" badge', async () => {
    render(<TargetArchitectureWorkspace />);

    const activeRow = await screen.findByTestId(
      `target-arch-draft-row-${draftActive.id}`,
    );
    expect(activeRow.getAttribute('data-active')).toBe('true');

    // Active badge present on the active row, absent on draft rows.
    expect(
      screen.getByTestId(`target-arch-active-badge-${draftActive.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`target-arch-active-badge-${draftLlm.id}`),
    ).not.toBeInTheDocument();

    // The active draft can now be deleted too (demoted from active first,
    // behind a confirm), so its delete control is enabled -- not disabled.
    const activeDelete = screen.getByTestId(
      `target-arch-delete-button-${draftActive.id}`,
    ) as HTMLButtonElement;
    expect(activeDelete.disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: inline-editing a draft name calls updateArchitecture (PATCH).
  // -------------------------------------------------------------------------

  it('calls updateArchitecture when the user edits a draft name in place', async () => {
    vi.mocked(updateArchitecture).mockResolvedValue({
      ...draftLlm,
      name: 'Renamed draft',
    } as unknown as ReturnType<typeof updateArchitecture> extends Promise<infer R>
      ? R
      : never);

    render(<TargetArchitectureWorkspace />);

    const nameInput = (await screen.findByTestId(
      `target-arch-draft-name-input-${draftLlm.id}`,
    )) as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'Renamed draft' } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(updateArchitecture).toHaveBeenCalledWith(
        PROJECT_ID,
        draftLlm.id,
        expect.objectContaining({ name: 'Renamed draft' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: delete-draft removes the row from the list AFTER the API call.
  // Delete button for the active draft is disabled (verified in Test 2);
  // here we cover the happy path on a non-active draft.
  // -------------------------------------------------------------------------

  it('removes a non-active draft from the list when delete is confirmed', async () => {
    vi.mocked(deleteTargetArchitecture).mockResolvedValue(undefined);

    // Initial list has all three rows; after delete, the second listing
    // returns only the active draft + the LLM draft (recent draft removed).
    vi.mocked(listTargetArchitectures)
      .mockResolvedValueOnce(orderedRows)
      .mockResolvedValueOnce([draftActive, draftLlm]);

    render(<TargetArchitectureWorkspace />);

    const deleteBtn = (await screen.findByTestId(
      `target-arch-delete-button-${draftRecent.id}`,
    )) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(false);

    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(deleteTargetArchitecture).toHaveBeenCalledWith(
        PROJECT_ID,
        draftRecent.id,
        false,
      );
    });

    // After the refresh, the recent draft is gone.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`target-arch-draft-row-${draftRecent.id}`),
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: seed dialog with mode=blank calls the API + the new draft
  // appears in the drafts list. Also exercises the LOAD_MODEL dispatch when
  // the newly-created draft matches the active architecture id.
  // -------------------------------------------------------------------------

  it('opens the seed dialog, submits mode=blank, and refreshes the drafts list', async () => {
    const newDraft: TargetArchitectureDto = {
      id: 'arch-draft-new',
      projectId: PROJECT_ID,
      name: 'Draft 2026-05-20 #2',
      description: null,
      tags: [],
      kind: 'target',
      draftState: 'draft',
      archived: false,
      createdAt: '2026-05-20T10:00:00Z',
      updatedAt: '2026-05-20T10:00:00Z',
    elementCount: null,
    };
    vi.mocked(seedTargetArchitecture).mockResolvedValue(newDraft);

    // Make the newly-created draft equal the active architecture id so the
    // LOAD_MODEL dispatch path is exercised too. Re-mock the active arch
    // hook for THIS test only.
    vi.mocked(useActiveArchitectureId).mockReturnValue(newDraft.id);

    // After the seed, the list endpoint returns the new row + the originals.
    vi.mocked(listTargetArchitectures)
      .mockResolvedValueOnce(orderedRows)
      .mockResolvedValueOnce([draftActive, newDraft, draftLlm, draftRecent]);

    render(<TargetArchitectureWorkspace />);

    fireEvent.click(
      await screen.findByTestId('target-arch-new-draft-button'),
    );

    // Dialog is open.
    expect(screen.getByTestId('target-arch-seed-dialog')).toBeInTheDocument();

    // Select the blank mode then submit.
    fireEvent.click(screen.getByTestId('seed-mode-blank'));
    fireEvent.click(screen.getByTestId('seed-dialog-submit'));

    await waitFor(() => {
      expect(seedTargetArchitecture).toHaveBeenCalledWith(PROJECT_ID, {
        mode: 'blank',
      });
    });

    // The new draft is in the refreshed list.
    await waitFor(() => {
      expect(
        screen.getByTestId(`target-arch-draft-row-${newDraft.id}`),
      ).toBeInTheDocument();
    });

    // AppShell cache sync: since the new draft id matches the active arch id,
    // the workspace fetches the model and dispatches LOAD_MODEL.
    await waitFor(() => {
      expect(loadModelByProjectId).toHaveBeenCalledWith(
        PROJECT_ID,
        newDraft.id,
      );
    });
    await waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOAD_MODEL' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: the from-template seed option is rendered as DISABLED in v1.
  // -------------------------------------------------------------------------

  it('renders the from-template seed option as disabled (with tooltip) in v1', async () => {
    render(<TargetArchitectureWorkspace />);

    fireEvent.click(
      await screen.findByTestId('target-arch-new-draft-button'),
    );

    const fromTemplateRadio = screen.getByTestId(
      'seed-mode-from-template',
    ) as HTMLInputElement;
    expect(fromTemplateRadio.disabled).toBe(true);

    // Clone-current is the default selection.
    const cloneRadio = screen.getByTestId(
      'seed-mode-clone-current',
    ) as HTMLInputElement;
    expect(cloneRadio.checked).toBe(true);

    // Blank is selectable.
    const blankRadio = screen.getByTestId('seed-mode-blank') as HTMLInputElement;
    expect(blankRadio.disabled).toBe(false);
  });
});
