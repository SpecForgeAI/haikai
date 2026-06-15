/**
 * TargetStateSubTabNavigation tests
 *
 * Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 5
 * (sub-task 5.1, first of the two focused frontend tests).
 *
 * Covers the spec's "Frontend test: sub-tab navigation" bullet. Renders the
 * Architecture & Design Target State page wrapped in a MemoryRouter +
 * <Routes> harness (mirrors the pattern in
 * `frontend/src/components/DashboardView/__tests__/_discoveryRunDetailPageHarness.tsx`)
 * pointed at the canonical URL
 *   /projects/:projectId/architectures/:architectureId/architecture-design/target-state
 *
 * Asserts:
 *   - the shared sub-tab strip renders both "Current State" + "Target State"
 *     peers,
 *   - the "Target State" tab is marked active (URL-derived; not local state),
 *   - <TargetArchitectureWorkspace /> renders inside the page via its testid.
 *
 * Mock surface follows the existing colocated tests in this directory
 * (`TargetArchitectureWorkspace.test.tsx`,
 * `TargetArchitectureWorkspace.group7.test.tsx`):
 *   - vi.mock the API modules at the top of the file so the workspace's
 *     network calls become controlled stubs,
 *   - vi.mock ProjectContext + ArchitectureContext per CLAUDE.md's
 *     established "UnifiedChatPanel requires mocks for..." pattern.
 *
 * Test count: 1 (paired with the suggestPending test in the sibling file to
 * land the spec's two-test cap per Task Group 5.1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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
import { ArchitectureDesignTargetStatePage } from './ArchitectureDesignTargetStatePage';
import {
  listTargetArchitectures,
  listUnmappedCurrentElements,
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

const PROJECT_ID = 'proj-target-state-subtab';
const ACTIVE_ARCH_ID = 'arch-active-subtab';

const draft: TargetArchitectureDto = {
  id: 'draft-1',
  projectId: PROJECT_ID,
  name: 'Target State - Suggested 2026-05-24',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'draft',
  archived: false,
  createdAt: '2026-05-24T08:00:00Z',
  updatedAt: '2026-05-24T08:00:00Z',
elementCount: null,
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
  // Return at least one draft so the workspace renders its full layout
  // (Drafts panel + table editor) rather than the empty-state branch -- the
  // sub-tab nav strip is rendered in both branches but pairing it with the
  // populated layout matches the spec's "render Architecture & Design page
  // with at least one draft" wording.
  vi.mocked(listTargetArchitectures).mockResolvedValue([draft]);
  vi.mocked(listUnmappedCurrentElements).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAtTargetStateRoute() {
  const url =
    `/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}` +
    `/architecture-design/target-state`;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/architecture-design/target-state"
          element={<ArchitectureDesignTargetStatePage />}
        />
        <Route
          path="/projects/:projectId/architectures/:architectureId/metamodel"
          element={<div data-testid="harness-current-state-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('TargetStateSubTabNavigation (Group 5.1)', () => {
  it('renders the Current State + Target State sub-tabs with Target State active and mounts the workspace', async () => {
    renderAtTargetStateRoute();

    // The sub-tab strip is present.
    const subTabs = await screen.findByTestId('architecture-design-sub-tabs');
    expect(subTabs).toBeInTheDocument();

    // Both peer tabs render.
    const currentStateTab = screen.getByTestId(
      'architecture-design-current-state-tab',
    );
    const targetStateTab = screen.getByTestId(
      'architecture-design-target-state-tab',
    );
    expect(currentStateTab).toBeInTheDocument();
    expect(targetStateTab).toBeInTheDocument();

    // The labels match the spec verbatim.
    expect(currentStateTab.textContent).toBe('Current State');
    expect(targetStateTab.textContent).toBe('Target State');

    // URL-derived active selection: the page mounts with active="target-state"
    // and the strip reflects it via aria-selected.
    expect(targetStateTab.getAttribute('aria-selected')).toBe('true');
    expect(currentStateTab.getAttribute('aria-selected')).toBe('false');

    // The workspace renders inside the page.
    expect(
      await screen.findByTestId('target-architecture-workspace'),
    ).toBeInTheDocument();

    // Drafts panel renders because we seeded one row (populated-layout branch).
    await waitFor(() => {
      expect(listTargetArchitectures).toHaveBeenCalledWith(PROJECT_ID);
    });
    expect(
      await screen.findByTestId(`target-arch-draft-row-${draft.id}`),
    ).toBeInTheDocument();
  });
});
