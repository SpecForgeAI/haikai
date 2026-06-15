/**
 * TargetArchitectureWorkspace suggestPending test
 *
 * Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 5
 * (sub-task 5.1, second of the two focused frontend tests).
 *
 * Covers the spec's "Frontend test: Suggest button disabled while pending"
 * bullet. The empty-state card branch (zero drafts in the workspace) hosts
 * the canonical Suggest button (testid
 * `target-arch-suggest-from-current-button-empty`) -- exercising it from
 * the empty state isolates the pending-disable behaviour from the populated
 * Drafts-panel layout's extra chrome.
 *
 * Asserts (single test):
 *   - The empty-state card renders the Suggest button enabled (zero drafts +
 *     active architecture id available).
 *   - Clicking the button invokes `suggestTargetFromCurrent` with the
 *     captured architecture id and disables the button while the request is
 *     in flight (pending-disable per spec task 4.4).
 *   - Resolving the controllable promise causes the workspace to refresh its
 *     drafts list and re-enables the Suggest control on the resulting layout
 *     (the new draft is now present so the workspace re-renders the
 *     populated-layout Suggest button in the Drafts panel header). The
 *     re-enabled assertion lifts on the surface that is actually mounted
 *     post-resolution.
 *
 * Mock surface mirrors the existing colocated workspace tests
 * (`TargetArchitectureWorkspace.test.tsx`).
 *
 * Test count: 1 (paired with TargetStateSubTabNavigation.test.tsx to land
 * the spec's two-test cap per Task Group 5.1).
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
    listUnmappedCurrentElements: vi.fn(),
    suggestTargetFromCurrent: vi.fn(),
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
  suggestTargetFromCurrent,
  type SuggestFromCurrentResponse,
  type TargetArchitectureDto,
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

const PROJECT_ID = 'proj-suggest-pending';
const ACTIVE_ARCH_ID = 'arch-active-suggest';
const NEW_DRAFT_ID = 'arch-new-draft-suggest';

const newDraft: TargetArchitectureDto = {
  id: NEW_DRAFT_ID,
  projectId: PROJECT_ID,
  name: 'Target State - Suggested 2026-05-24',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-05-24T09:00:00Z',
  updatedAt: '2026-05-24T09:00:00Z',
elementCount: null,
};

const suggestResponse: SuggestFromCurrentResponse = {
  newDraftId: NEW_DRAFT_ID,
  resolvedName: newDraft.name,
  clonedElementCount: 7,
  mappingRowCount: 7,
};

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
  // Initial drafts list is empty -> workspace renders the empty-state card
  // with the Suggest button. After a successful Suggest, the workspace
  // refetches the list and we return the new draft so the populated layout
  // mounts with its re-enabled Suggest button in the Drafts panel header.
  vi.mocked(listTargetArchitectures)
    .mockResolvedValueOnce([])
    .mockResolvedValue([newDraft]);
  vi.mocked(listUnmappedCurrentElements).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('TargetArchitectureWorkspace Suggest pending-disable (Group 5.1)', () => {
  it('disables the Suggest button while the request is in flight and re-enables it on resolution', async () => {
    // Controllable promise so we can hold the request "in flight" and verify
    // the button disable lifecycle deterministically (no fake-timer
    // gymnastics, no never-resolving leaks at teardown).
    let resolveSuggest!: (value: SuggestFromCurrentResponse) => void;
    const suggestPromise = new Promise<SuggestFromCurrentResponse>(resolve => {
      resolveSuggest = resolve;
    });
    vi.mocked(suggestTargetFromCurrent).mockReturnValueOnce(suggestPromise);

    render(<TargetArchitectureWorkspace />);

    // Empty-state card mounts (zero drafts in the initial fetch).
    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });
    const emptyCard = await screen.findByTestId(
      'target-arch-empty-state-card',
    );
    expect(emptyCard).toBeInTheDocument();

    // The Suggest button in the empty-state card is enabled before the click.
    const suggestButton = screen.getByTestId(
      'target-arch-suggest-from-current-button-empty',
    ) as HTMLButtonElement;
    expect(suggestButton.disabled).toBe(false);
    expect(suggestButton.textContent).toBe('Suggest');

    // Click fires the suggest API call.
    fireEvent.click(suggestButton);

    // Pending guard kicks in: the button is now disabled and shows the
    // pending copy.
    await waitFor(() => {
      expect(suggestButton.disabled).toBe(true);
    });
    expect(suggestButton.textContent).toBe('Suggesting...');
    expect(suggestTargetFromCurrent).toHaveBeenCalledWith(PROJECT_ID, {
      currentArchitectureId: ACTIVE_ARCH_ID,
    });

    // Resolve the controllable promise -- the workspace's handler refreshes
    // the drafts list (returning the new draft this time) so the populated
    // layout mounts with its own Suggest button in the Drafts panel header,
    // re-enabled because the pending flag has flipped back to false.
    resolveSuggest(suggestResponse);

    // The populated layout's Suggest button mounts post-resolution.
    const populatedSuggestButton = (await screen.findByTestId(
      'target-arch-suggest-from-current-button',
    )) as HTMLButtonElement;
    await waitFor(() => {
      expect(populatedSuggestButton.disabled).toBe(false);
    });
    expect(populatedSuggestButton.textContent).toBe('Suggest');

    // The new draft is now present in the Drafts panel (auto-selected by
    // newDraftId per spec task 4.3).
    expect(
      await screen.findByTestId(`target-arch-draft-row-${NEW_DRAFT_ID}`),
    ).toBeInTheDocument();
  });
});
