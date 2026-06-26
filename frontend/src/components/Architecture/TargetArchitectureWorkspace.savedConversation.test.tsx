/**
 * TargetArchitectureWorkspace -- saved-conversation indicator + in-place filter.
 *
 * Spec: 2026-06-26-target-conversation-save-resume-plan-sourcing (FR6),
 * Task Group 4.1 / 4.3.
 *
 * Covers (2 tests):
 *   1. The EXISTING drafts list badges every draft whose `conversationSavedAt`
 *      is non-null with a "Saved" indicator; unsaved drafts carry no badge.
 *   2. The in-place "Saved conversations only" filter narrows the SAME list to
 *      saved drafts (not a parallel section).
 *
 * Mock surface mirrors the colocated workspace tests
 * (`TargetArchitectureWorkspace.elementCountBadge.test.tsx`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react';

vi.mock('../../api/targetArchitecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/targetArchitecturesApi')
  >('../../api/targetArchitecturesApi');
  return {
    ...actual,
    listTargetArchitectures: vi.fn(),
    listUnmappedCurrentElements: vi.fn().mockResolvedValue([]),
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

import { TargetArchitectureWorkspace } from './TargetArchitectureWorkspace';
import {
  listTargetArchitectures,
  type TargetArchitectureDto,
} from '../../api/targetArchitecturesApi';
import { useProject } from '../../contexts/ProjectContext';
import {
  useArchitectureContext,
  useActiveArchitectureId,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';

const PROJECT_ID = 'proj-saved-1';
const ACTIVE_ARCH_ID = 'arch-active-1';

const savedDraft: TargetArchitectureDto = {
  id: 'arch-saved',
  projectId: PROJECT_ID,
  name: 'Saved draft',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-06-20T08:00:00Z',
  updatedAt: '2026-06-20T08:00:00Z',
  elementCount: 5,
  conversationSavedAt: '2026-06-25T10:00:00Z',
};

const unsavedDraft: TargetArchitectureDto = {
  id: 'arch-unsaved',
  projectId: PROJECT_ID,
  name: 'Unsaved draft',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'active',
  archived: false,
  createdAt: '2026-06-21T08:00:00Z',
  updatedAt: '2026-06-21T08:00:00Z',
  elementCount: 5,
  conversationSavedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Test project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(ACTIVE_ARCH_ID);
  vi.mocked(useArchitectureDispatch).mockReturnValue(vi.fn());
  vi.mocked(useArchitectureContext).mockReturnValue({
    invalidateArchitectureModelCache: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);
  vi.mocked(listTargetArchitectures).mockResolvedValue([savedDraft, unsavedDraft]);
});

afterEach(() => cleanup());

describe('TargetArchitectureWorkspace -- saved-conversation indicator + filter', () => {
  it('badges drafts with a non-null conversationSavedAt and not the unsaved ones', async () => {
    render(<TargetArchitectureWorkspace />);

    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });
    await screen.findByTestId(`target-arch-draft-row-${savedDraft.id}`);

    expect(
      screen.getByTestId(`target-arch-saved-badge-${savedDraft.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`target-arch-saved-badge-${unsavedDraft.id}`),
    ).toBeNull();
  });

  it('narrows the EXISTING list to saved drafts via the in-place filter', async () => {
    render(<TargetArchitectureWorkspace />);

    await screen.findByTestId(`target-arch-draft-row-${unsavedDraft.id}`);

    // Both rows visible before filtering.
    expect(
      screen.getByTestId(`target-arch-draft-row-${savedDraft.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`target-arch-draft-row-${unsavedDraft.id}`),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('target-arch-saved-filter-checkbox'));

    // Only the saved draft remains in the SAME list.
    expect(
      screen.getByTestId(`target-arch-draft-row-${savedDraft.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`target-arch-draft-row-${unsavedDraft.id}`),
    ).toBeNull();
  });
});
