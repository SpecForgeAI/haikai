/**
 * TargetArchitectureWorkspace empty-badge test
 *
 * Spec: 2026-05-25 Four-Spec Hardening Pass -- Item 3 (Group 2, frontend test).
 *
 * Covers the spec's "Drafts panel renders the 'empty' badge on every draft
 * with `elementCount === 0`, not just the selected one" bullet -- single
 * focused test (the only frontend slot allocated to Item 3 per the
 * 1-frontend + 2-backend split of the spec-total 4 + 4 cap).
 *
 * Asserts:
 *   - Mixed-drafts fixture: two empty (`elementCount: 0`) drafts and one
 *     populated (`elementCount: 5`) draft.
 *   - The badge appears on EVERY empty draft, regardless of which draft is
 *     currently selected (the Spec 1 "lazy approach: only the selected draft
 *     is badged" comment is gone -- this test locks in the corrected
 *     behaviour).
 *   - The populated draft does NOT show the badge.
 *
 * Mock surface mirrors the existing colocated workspace tests
 * (`TargetArchitectureWorkspace.test.tsx`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

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

// Imports AFTER mocks.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-elementcount-1';
const ACTIVE_ARCH_ID = 'arch-active-1';

const draftActiveEmpty: TargetArchitectureDto = {
  id: ACTIVE_ARCH_ID,
  projectId: PROJECT_ID,
  name: 'Active empty draft',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'active',
  archived: false,
  createdAt: '2026-05-19T08:00:00Z',
  updatedAt: '2026-05-19T08:00:00Z',
  elementCount: 0,
};

const draftPopulated: TargetArchitectureDto = {
  id: 'arch-populated',
  projectId: PROJECT_ID,
  name: 'Populated draft',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-05-20T08:00:00Z',
  updatedAt: '2026-05-20T08:00:00Z',
  elementCount: 5,
};

const draftSecondEmpty: TargetArchitectureDto = {
  id: 'arch-second-empty',
  projectId: PROJECT_ID,
  name: 'Second empty draft',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-05-20T09:00:00Z',
  updatedAt: '2026-05-20T09:00:00Z',
  elementCount: 0,
};

const orderedRows = [draftActiveEmpty, draftSecondEmpty, draftPopulated];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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
  vi.mocked(listTargetArchitectures).mockResolvedValue(orderedRows);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Test: Drafts panel badges every empty draft (not just the selected one).
// ---------------------------------------------------------------------------

describe('TargetArchitectureWorkspace Drafts panel (Four-Spec Hardening Pass, Item 3)', () => {
  it('renders the "empty" badge on EVERY draft with elementCount === 0', async () => {
    render(<TargetArchitectureWorkspace />);

    // Drafts list loaded.
    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });
    await screen.findByTestId(`target-arch-draft-row-${draftActiveEmpty.id}`);

    // Both empty drafts show the badge -- including the non-selected one.
    expect(
      screen.getByTestId(`target-arch-empty-badge-${draftActiveEmpty.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`target-arch-empty-badge-${draftSecondEmpty.id}`),
    ).toBeInTheDocument();

    // The populated draft does NOT carry the badge.
    expect(
      screen.queryByTestId(`target-arch-empty-badge-${draftPopulated.id}`),
    ).not.toBeInTheDocument();
  });
});
