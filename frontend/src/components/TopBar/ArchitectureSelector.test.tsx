/**
 * ArchitectureSelector Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 3
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 7
 *
 * Tests cover:
 *   1. Closed selector renders the active architecture's name (lookup against
 *      `architectures` via `useActiveArchitectureId`).
 *   2. Clicking the closed control opens the dropdown showing all
 *      non-archived architectures, ordered oldest-first.
 *   3. (Safety property c) Clicking a dropdown row calls
 *      setActiveArchitecture(id) -> URL `:architectureId` segment is swapped
 *      AND the new id propagates back through `useActiveArchitectureId()`.
 *   4. Only the architecture name is rendered in the dropdown rows -- no
 *      tags (tags are managed inside EditArchitectureModal in spec #3).
 *   5. Archived architectures are filtered out of the dropdown.
 *   6. Dropdown closes on click-outside and on Escape.
 *
 *   Spec #3 Task Group 7 footer extension tests (added in this group):
 *   7. Footer entries (`+ Create architecture...`, `Manage architectures...`)
 *      and the separator are rendered after the existing list, even when
 *      `architectures.length === 1`.
 *   8. Clicking `+ Create architecture...` opens EditArchitectureModal in
 *      `mode='create'` and closes the dropdown.
 *   9. Clicking `Manage architectures...` opens ManageArchitecturesModal
 *      and closes the dropdown.
 *  10. Clicking a footer entry does NOT call setActiveArchitecture (footer
 *      entries are actions, not selectable architectures).
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` at the top of the file.
 *   - `MemoryRouter` for route-driven assertions (the active architecture id
 *     comes from useParams()).
 *   - `useProject` is mocked so we don't need the full ProjectProvider.
 *   - `listArchitectures` is mocked to control the dropdown contents.
 *   - `ReactDOM.createPortal` is short-circuited so the menu renders inline
 *     (mirrors `FileMenu.generateStandards.test.tsx`).
 *   - `EditArchitectureModal` and `ManageArchitecturesModal` are mocked so
 *     we can assert their open/closed state via data-* attributes on
 *     sentinel DOM nodes without rendering the real chip primitive UX or
 *     the manage list.
 */

import { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// ============================================================================
// Mocks
// ============================================================================

// Render portals inline so the menu shows up in the test DOM tree.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: ReactNode) => node,
  };
});

// Mock listArchitectures so we control the architectures list.
vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual('../../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

// Mock useProject so ArchitectureProvider sees a project without us
// having to mount the full ProjectProvider.
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

// Mock the EditArchitectureModal so the footer-entry tests can assert the
// modal opened with the right props (mode='create', open=true, etc.)
// without rendering the real chip UX. The mock renders a sentinel div
// only when `open` is true so the tests can assert mount/unmount via
// queryByTestId.
const editModalMock = vi.fn();
vi.mock('./EditArchitectureModal', () => ({
  EditArchitectureModal: (props: unknown) => {
    editModalMock(props);
    const safe = props as {
      mode?: string;
      open?: boolean;
      projectId?: string;
    };
    if (!safe.open) return null;
    return (
      <div
        data-testid="mock-edit-architecture-modal"
        data-mode={safe.mode ?? ''}
        data-project-id={safe.projectId ?? ''}
      />
    );
  },
}));

// Mock the ManageArchitecturesModal similarly.
const manageModalMock = vi.fn();
vi.mock('./ManageArchitecturesModal', () => ({
  ManageArchitecturesModal: (props: unknown) => {
    manageModalMock(props);
    const safe = props as { open?: boolean; projectId?: string };
    if (!safe.open) return null;
    return (
      <div
        data-testid="mock-manage-architectures-modal"
        data-project-id={safe.projectId ?? ''}
      />
    );
  },
}));

import { listArchitectures, type Architecture } from '../../api/architecturesApi';
import { useProject } from '../../contexts/ProjectContext';
import {
  ArchitectureProvider,
  useActiveArchitectureId,
} from '../../contexts/ArchitectureContext';
import { ArchitectureSelector } from './ArchitectureSelector';

// ============================================================================
// Test Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_DEFAULT_ID = 'arch-default-uuid';
const ARCH_TARGET_ID = 'arch-target-uuid';
const ARCH_ARCHIVED_ID = 'arch-archived-uuid';

function buildArchitecture(overrides: Partial<Architecture>): Architecture {
  return {
    id: 'arch-default',
    projectId: PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildProjectFixture() {
  return {
    id: PROJECT_ID,
    name: 'Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * Probe component that re-exposes useActiveArchitectureId so tests can
 * assert that setActiveArchitecture has propagated the new id back through
 * context (safety property c).
 */
function ActiveIdProbe() {
  const id = useActiveArchitectureId();
  return <div data-testid="probe-active-arch-id">{id ?? 'NULL'}</div>;
}

/**
 * Probe that exposes the current pathname so we can assert the URL change.
 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="probe-pathname">{location.pathname}</div>;
}

/**
 * Render the selector under a MemoryRouter with the canonical
 * architecture-scoped route shape, so useParams() resolves
 * `:architectureId` correctly.
 */
function renderSelector(opts: { initialEntries: string[] }) {
  return render(
    <MemoryRouter initialEntries={opts.initialEntries}>
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/*"
          element={
            <ArchitectureProvider>
              <ArchitectureSelector />
              <ActiveIdProbe />
              <LocationProbe />
            </ArchitectureProvider>
          }
        />
        {/* Catch-all so navigation away from the architecture-scoped path
            still mounts the provider + probes (used after click-to-switch). */}
        <Route
          path="*"
          element={
            <ArchitectureProvider>
              <ArchitectureSelector />
              <ActiveIdProbe />
              <LocationProbe />
            </ArchitectureProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('ArchitectureSelector (Task 3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    // Default: two non-archived (oldest-first) + one archived. Individual
    // tests override as needed.
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: 'Default',
        createdAt: '2026-01-01T00:00:00Z',
      }),
      buildArchitecture({
        id: ARCH_TARGET_ID,
        name: 'Target State',
        createdAt: '2026-02-01T00:00:00Z',
      }),
      buildArchitecture({
        id: ARCH_ARCHIVED_ID,
        name: 'Old Archived',
        archived: true,
        createdAt: '2025-12-01T00:00:00Z',
      }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Closed selector renders the active architecture's name.
  // ---------------------------------------------------------------------------
  it('renders the active architecture name in the closed trigger', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    // Trigger reads the active id from useParams immediately, then resolves
    // the name from the architectures list once it loads.
    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Clicking opens the dropdown, listing non-archived oldest-first.
  // ---------------------------------------------------------------------------
  it('opens the dropdown on click and lists non-archived architectures oldest-first', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    // Wait for the architectures list to be populated so the dropdown has
    // rows to render.
    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    // Open the dropdown.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });

    // Menu is rendered.
    expect(screen.getByTestId('architecture-selector-menu')).toBeInTheDocument();

    // Both non-archived rows are present (the archived one is filtered out --
    // separate assertion in test 5 below).
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(2);

    // Oldest-first: Default (2026-01-01) before Target State (2026-02-01).
    expect(rows[0]).toHaveTextContent('Default');
    expect(rows[1]).toHaveTextContent('Target State');
  });

  // ---------------------------------------------------------------------------
  // Test 3 (Safety property c): Clicking a row calls setActiveArchitecture
  // which updates the URL and propagates the new id through context.
  // ---------------------------------------------------------------------------
  it('selecting a row updates the URL :architectureId segment AND propagates the new active id through context (safety property c)', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    // Confirm the starting state via the probes.
    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });
    expect(screen.getByTestId('probe-active-arch-id')).toHaveTextContent(
      ARCH_DEFAULT_ID
    );
    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`
    );

    // Open the dropdown.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });

    // Click the Target State row.
    act(() => {
      fireEvent.click(
        screen.getByTestId(`architecture-selector-row-${ARCH_TARGET_ID}`)
      );
    });

    // URL changed -- only the :architectureId segment was swapped, the
    // trailing view (diagrams) is preserved.
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/diagrams`
      );
    });

    // The new active id has propagated through context -- useActiveArchitectureId
    // reads it from useParams() in the next render.
    expect(screen.getByTestId('probe-active-arch-id')).toHaveTextContent(
      ARCH_TARGET_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: Only the name is rendered -- no tags.
  // ---------------------------------------------------------------------------
  it('renders only the architecture name in dropdown rows (no tags)', async () => {
    // Tags exist in the schema; the selector must not surface them in the
    // dropdown rows (tag management lives in EditArchitectureModal).
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: 'Default',
        tags: ['canonical', 'tag-baseline-token', 'do-not-render-me'],
        createdAt: '2026-01-01T00:00:00Z',
      }),
    ]);

    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });

    const row = screen.getByTestId(`architecture-selector-row-${ARCH_DEFAULT_ID}`);
    // The row contains exactly the architecture name. None of the tags
    // should appear anywhere in the menu.
    expect(row.textContent).toBe('Default');
    const menu = screen.getByTestId('architecture-selector-menu');
    // None of the architecture's tag tokens leak anywhere into the menu.
    // (Tokens chosen so none is a substring of the footer action copy --
    // e.g. the `API Behaviour baselines...` entry legitimately contains
    // the word "baselines".)
    expect(menu.textContent).not.toMatch(/canonical|tag-baseline-token|do-not-render-me/);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Archived architectures are filtered out of the dropdown.
  // ---------------------------------------------------------------------------
  it('filters archived architectures out of the dropdown', async () => {
    // The default mock returns one archived architecture (ARCH_ARCHIVED_ID).
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });

    // Archived row must NOT be present.
    expect(
      screen.queryByTestId(`architecture-selector-row-${ARCH_ARCHIVED_ID}`)
    ).not.toBeInTheDocument();

    // Menu must not contain the archived architecture's name.
    const menu = screen.getByTestId('architecture-selector-menu');
    expect(menu.textContent).not.toContain('Old Archived');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Dropdown closes on Escape and on click-outside.
  // ---------------------------------------------------------------------------
  it('closes the dropdown on Escape and on click-outside', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    // ----- Escape -----
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    expect(screen.getByTestId('architecture-selector-menu')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('architecture-selector-menu')
      ).not.toBeInTheDocument();
    });

    // ----- Click-outside -----
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    expect(screen.getByTestId('architecture-selector-menu')).toBeInTheDocument();

    // The click-outside listener is attached after a setTimeout(0) so the
    // opening click does not immediately re-close the menu. Wait one tick
    // before firing the outside mousedown so the listener is live.
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('architecture-selector-menu')
      ).not.toBeInTheDocument();
    });
  });
});

// ============================================================================
// Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 7
// Tests 7-10 cover the dropdown footer extension (separator + Create /
// Manage actions). The modals themselves are mocked at the top of the
// file -- the tests assert open/closed state via the sentinel data-*
// attributes on the mocked components.
// ============================================================================

describe('ArchitectureSelector footer (Task 7.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    // Default for footer tests: a single non-archived architecture so we
    // can assert the footer entries are visible regardless of list size
    // (per spec: footer is always visible even with one architecture).
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: 'Default',
        createdAt: '2026-01-01T00:00:00Z',
      }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 7: Footer entries + separator render after the existing list, even
  // when there is only one architecture. (Always-visible behaviour from spec.)
  // ---------------------------------------------------------------------------
  it('renders the separator and both footer entries after the architecture list, even when only one architecture exists', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });

    // Separator is present.
    const separator = screen.getByTestId('architecture-selector-separator');
    expect(separator).toBeInTheDocument();

    // Both footer entries are present and have the spec-mandated copy.
    const createEntry = screen.getByTestId('architecture-selector-create');
    const manageEntry = screen.getByTestId('architecture-selector-manage');
    expect(createEntry).toBeInTheDocument();
    expect(manageEntry).toBeInTheDocument();
    expect(createEntry.textContent).toMatch(/Create architecture/);
    expect(manageEntry.textContent).toMatch(/Manage architectures/);

    // The architecture row is still there too -- footer is additive.
    expect(
      screen.getByTestId(`architecture-selector-row-${ARCH_DEFAULT_ID}`)
    ).toBeInTheDocument();

    // DOM order: the architecture rows come BEFORE the separator, which
    // comes before both footer entries. We assert ordering via
    // compareDocumentPosition.
    const archRow = screen.getByTestId(`architecture-selector-row-${ARCH_DEFAULT_ID}`);
    expect(
      archRow.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      separator.compareDocumentPosition(createEntry) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      createEntry.compareDocumentPosition(manageEntry) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Test 8: Clicking `+ Create architecture...` opens EditArchitectureModal
  // in mode='create' AND closes the dropdown.
  // ---------------------------------------------------------------------------
  it('clicking + Create architecture... opens EditArchitectureModal (mode=create) and closes the dropdown', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    // Modal is NOT mounted before the click -- the mock only renders when
    // `open` prop is true.
    expect(
      screen.queryByTestId('mock-edit-architecture-modal')
    ).not.toBeInTheDocument();

    // Open the dropdown then click Create.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    expect(screen.getByTestId('architecture-selector-menu')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-create'));
    });

    // Modal mounted with mode='create' and the right project id.
    const modal = await screen.findByTestId('mock-edit-architecture-modal');
    expect(modal.getAttribute('data-mode')).toBe('create');
    expect(modal.getAttribute('data-project-id')).toBe(PROJECT_ID);

    // Dropdown is closed.
    expect(
      screen.queryByTestId('architecture-selector-menu')
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 9: Clicking `Manage architectures...` opens
  // ManageArchitecturesModal AND closes the dropdown.
  // ---------------------------------------------------------------------------
  it('clicking Manage architectures... opens ManageArchitecturesModal and closes the dropdown', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    // Modal is NOT mounted before the click.
    expect(
      screen.queryByTestId('mock-manage-architectures-modal')
    ).not.toBeInTheDocument();

    // Open the dropdown then click Manage.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    expect(screen.getByTestId('architecture-selector-menu')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-manage'));
    });

    // Manage modal mounted with the right project id.
    const modal = await screen.findByTestId('mock-manage-architectures-modal');
    expect(modal.getAttribute('data-project-id')).toBe(PROJECT_ID);

    // Dropdown is closed.
    expect(
      screen.queryByTestId('architecture-selector-menu')
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 10: Footer entries are not confused with architecture rows --
  // clicking them does NOT trigger setActiveArchitecture (would change the
  // URL). We assert via the LocationProbe staying on the original path.
  // ---------------------------------------------------------------------------
  it('clicking a footer entry does NOT invoke setActiveArchitecture (URL unchanged)', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    const startingPath = `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`;
    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(startingPath);

    // Click Create.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-create'));
    });

    // URL has NOT changed -- the footer entry is an action, not a row
    // selection. (If setActiveArchitecture had been called, the path
    // would now include a different :architectureId segment.)
    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(startingPath);
    expect(screen.getByTestId('probe-active-arch-id')).toHaveTextContent(
      ARCH_DEFAULT_ID
    );

    // Same assertion for Manage. First close the create modal so the
    // re-open of the dropdown is clean.
    // (The ArchitectureSelector renders both modals as siblings -- the
    // Create one stays mounted in `open=true` state but that doesn't
    // affect the dropdown.)

    // Open dropdown again and click Manage.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-manage'));
    });

    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(startingPath);
    expect(screen.getByTestId('probe-active-arch-id')).toHaveTextContent(
      ARCH_DEFAULT_ID
    );
  });

  // ---------------------------------------------------------------------------
  // Test 11 (2026-06-02 discoverability fix): Clicking
  // `API Behaviour baselines...` navigates to the active architecture's
  // `/api-behaviour` list page (previously deep-link-only) AND closes the
  // dropdown.
  // ---------------------------------------------------------------------------
  it('clicking API Behaviour baselines... navigates to the active architecture /api-behaviour list page and closes the dropdown', async () => {
    renderSelector({
      initialEntries: [
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('architecture-selector-trigger')
      ).toHaveTextContent('Default');
    });

    const startingPath = `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`;
    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(startingPath);

    // Open the dropdown then click the API Behaviour baselines entry.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    expect(screen.getByTestId('architecture-selector-menu')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-api-behaviour'));
    });

    // The URL now points at the API Behaviour baselines list page for the
    // ACTIVE architecture (no trailing view segment -- it is the list root).
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/api-behaviour`
      );
    });

    // Dropdown is closed.
    expect(
      screen.queryByTestId('architecture-selector-menu')
    ).not.toBeInTheDocument();
  });
});
