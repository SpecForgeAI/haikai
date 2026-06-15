/**
 * ManageArchitecturesModal Tests
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 5
 * Task 5.1: 2-8 focused tests for the manage modal.
 *
 * (Group 6 backfill: test 5 was updated to mock the
 * ArchiveArchitectureConfirmModal child and assert it receives the right
 * props instead of asserting the old `onArchiveStub` prop -- that prop has
 * been removed in favour of the real modal wiring.)
 *
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 7
 * Task 7.1 backfill: tests 6 and 7 added for the new per-row Clone button
 * (visibility on every non-archived row + click opens
 * `CloneArchitectureModal` wired with the row as `source`). The existing
 * Edit + Archive tests are left untouched as the regression baseline
 * (safety property (g) follows trivially from test 2: archived rows are
 * not rendered, so the Clone button on an archived row is unreachable).
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 10
 * Task 10.1 backfill: tests 8, 9, and 10 added for the new per-row
 * `Copy from...` button:
 *   - Test 8: visibility on every non-archived row alongside Edit + Clone +
 *     Archive (and disabled-with-tooltip on the active-architecture row,
 *     covering safety property (h)).
 *   - Test 9: clicking `Copy from...` opens `<SelectiveCopyWizardModal>`
 *     with `source={row}` and `target={activeArchitecture}`; firing the
 *     child's onClose unmounts the wizard.
 *   - Test 10: disabled state on the active row prevents the wizard from
 *     ever opening (defence-in-depth for safety property (h)).
 *
 * Coverage matrix:
 *   1. Renders one row per non-archived architecture, oldest-first
 *      (matches spec #2's selector ordering rule, which derives from
 *      spec #1's "Default = oldest non-archived" ASC sort).
 *
 *   2. Archived rows are hidden -- they never appear in the DOM (per
 *      requirements decision #2: unarchive UI is out of scope).
 *      Doubles as the Group 7 safety-property-(g) regression check: no
 *      Clone button can be rendered for an archived row because the row
 *      itself does not render.
 *
 *   3. Clicking Edit on a row opens EditArchitectureModal in `mode='edit'`
 *      with the row pre-populated. The child modal is mocked so we can
 *      assert the props it receives without the real chip primitive UX.
 *
 *   4. Safety property (b) client side: when only one non-archived
 *      architecture exists, the Archive button is disabled with the
 *      tooltip "Cannot archive -- every project must have at least one
 *      architecture." and clicking it does NOT mount the confirm modal.
 *
 *   5. With 2+ non-archived architectures, clicking Archive opens
 *      ArchiveArchitectureConfirmModal pre-populated with the row.
 *
 *   6. (Group 7) Every non-archived row renders a per-row Clone button
 *      alongside Edit + Archive, and no Clone modal is mounted on initial
 *      render.
 *
 *   7. (Group 7) Clicking Clone on a row opens CloneArchitectureModal
 *      with `source={row}`; closing the clone modal clears local state
 *      and the Clone modal unmounts.
 *
 *   8. (Spec #7 Group 10) Every non-archived row renders a per-row
 *      `Copy from...` button alongside Edit + Clone + Archive, and the
 *      button is disabled-with-tooltip on the row that IS the active
 *      architecture (safety property (h)). No wizard is mounted on
 *      initial render.
 *
 *   9. (Spec #7 Group 10) Clicking `Copy from...` on a non-active row
 *      opens `<SelectiveCopyWizardModal>` with `source={row}` and
 *      `target={activeArchitecture}`. Firing the child's onClose
 *      unmounts the wizard.
 *
 *  10. (Spec #7 Group 10) Clicking the disabled `Copy from...` button
 *      on the active row is a no-op -- the wizard is never mounted.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - architecturesApi mocked: not exercised directly by this modal, but
 *     mocked so the imports resolve cleanly.
 *   - ArchitectureContext.useArchitectureContext mocked so we don't have
 *     to mount the full provider machinery (~3000 LOC).
 *   - EditArchitectureModal mocked so we can spy on the props it receives
 *     when Edit is clicked (and so we don't drag the chip primitive UX
 *     into this test file's coverage).
 *   - ArchiveArchitectureConfirmModal mocked similarly so we can assert it
 *     receives `architecture` (null when nothing queued, the row when
 *     Archive is clicked) without exercising the real archive flow.
 *   - CloneArchitectureModal mocked so we can assert it receives the
 *     correct {open, projectId, source} props when Clone is clicked
 *     (and so the real clone modal's chip primitive + API plumbing don't
 *     leak into this test surface).
 *   - SelectiveCopyWizardModal mocked so we can assert it receives the
 *     correct {open, projectId, source, target} props when Copy from is
 *     clicked. Mounted only when `copyingFromArchitecture` is non-null,
 *     mirroring the EditArchitectureModal / CloneArchitectureModal guard
 *     pattern; testid presence == wizard open.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ============================================================================
// Mocks (must be set up before importing the component)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi'
  );
  return {
    ...actual,
    // Not used by this modal directly, but imported transitively.
    createArchitecture: vi.fn(),
    updateArchitecture: vi.fn(),
    archiveArchitecture: vi.fn(),
    cloneArchitecture: vi.fn(),
  };
});

// Provide a Router context for the component's useNavigate() call. These
// tests render the modal bare (no MemoryRouter) and do not assert
// navigation, so a no-op useNavigate mock is the minimal, faithful shim.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

// Mock the child EditArchitectureModal so we can assert it received the
// right props when the user clicks Edit on a row, without rendering the
// real chip primitive UX in this test surface.
const editModalMock = vi.fn();
vi.mock('./EditArchitectureModal', () => ({
  EditArchitectureModal: (props: unknown) => {
    editModalMock(props);
    // Return a sentinel node with the props serialised so the assertions
    // below can read them back via the DOM if they prefer that style.
    const safe = props as { mode?: string; architecture?: { id?: string; name?: string } };
    return (
      <div
        data-testid="mock-edit-architecture-modal"
        data-mode={safe.mode ?? ''}
        data-architecture-id={safe.architecture?.id ?? ''}
        data-architecture-name={safe.architecture?.name ?? ''}
      />
    );
  },
}));

// Mock the child ArchiveArchitectureConfirmModal so we can assert it
// received the right `architecture` prop (null when nothing is queued, the
// row object when the user clicks Archive) without exercising the real
// archive flow. The real component renders nothing when architecture is
// null, so we mirror that here so test #4 can still assert "modal not
// mounted" via the mock's data-testid.
const archiveModalMock = vi.fn();
vi.mock('./ArchiveArchitectureConfirmModal', () => ({
  ArchiveArchitectureConfirmModal: (props: unknown) => {
    archiveModalMock(props);
    const safe = props as {
      architecture?: { id?: string; name?: string } | null;
      projectId?: string;
    };
    if (!safe.architecture) {
      // Mirror the real component's "render nothing when null" behaviour
      // so test #4 can rely on absence-of-DOM to mean "no confirm queued".
      return null;
    }
    return (
      <div
        data-testid="mock-archive-architecture-confirm-modal"
        data-architecture-id={safe.architecture?.id ?? ''}
        data-architecture-name={safe.architecture?.name ?? ''}
        data-project-id={safe.projectId ?? ''}
      />
    );
  },
}));

// Mock the child CloneArchitectureModal so we can assert it receives the
// right {open, projectId, source} props when the user clicks Clone on a
// row, without exercising the real chip primitive UX or API plumbing.
// The parent mounts this only when `cloningArchitecture` is non-null
// (mirroring the EditArchitectureModal guard) so the testid's mere
// presence in the DOM is the assertion that the modal is open.
const cloneModalMock = vi.fn();
vi.mock('./CloneArchitectureModal', () => ({
  CloneArchitectureModal: (props: unknown) => {
    cloneModalMock(props);
    const safe = props as {
      open?: boolean;
      projectId?: string;
      source?: { id?: string; name?: string };
      onClose?: () => void;
    };
    return (
      <div
        data-testid="mock-clone-architecture-modal"
        data-open={String(safe.open ?? '')}
        data-project-id={safe.projectId ?? ''}
        data-source-id={safe.source?.id ?? ''}
        data-source-name={safe.source?.name ?? ''}
      >
        {/* Expose the onClose handler via a button so test 7 can fire it
            and assert the parent clears local state (modal unmounts). */}
        <button
          type="button"
          data-testid="mock-clone-architecture-modal-fire-close"
          onClick={() => safe.onClose?.()}
        >
          fire onClose
        </button>
      </div>
    );
  },
}));

// Mock the child SelectiveCopyWizardModal (Spec #7 Group 10). The parent
// mounts this only when `copyingFromArchitecture` is non-null AND the
// active architecture exists in the architectures list; mere DOM presence
// of the testid is the "wizard open" assertion. We expose props via data
// attributes so test 9 can read them back, plus an onClose firing button.
const copyWizardModalMock = vi.fn();
vi.mock('./SelectiveCopyWizardModal', () => ({
  SelectiveCopyWizardModal: (props: unknown) => {
    copyWizardModalMock(props);
    const safe = props as {
      open?: boolean;
      projectId?: string;
      source?: { id?: string; name?: string };
      target?: { id?: string; name?: string };
      onClose?: () => void;
    };
    return (
      <div
        data-testid="mock-selective-copy-wizard-modal"
        data-open={String(safe.open ?? '')}
        data-project-id={safe.projectId ?? ''}
        data-source-id={safe.source?.id ?? ''}
        data-source-name={safe.source?.name ?? ''}
        data-target-id={safe.target?.id ?? ''}
        data-target-name={safe.target?.name ?? ''}
      >
        <button
          type="button"
          data-testid="mock-selective-copy-wizard-modal-fire-close"
          onClick={() => safe.onClose?.()}
        >
          fire onClose
        </button>
      </div>
    );
  },
}));

import { type Architecture } from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { ManageArchitecturesModal } from './ManageArchitecturesModal';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: 'arch-default',
    projectId: PROJECT_ID,
    name: 'Default',
    description: 'Initial architecture seeded by spec #1.',
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setArchitectures(list: Architecture[], activeId: string | null = list[0]?.id ?? null) {
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures: list,
    activeArchitectureId: activeId,
    refreshArchitectures: vi.fn().mockResolvedValue(undefined),
    setActiveArchitecture: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);
}

// ============================================================================
// Test setup helpers
// ============================================================================

let onCloseMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  editModalMock.mockClear();
  archiveModalMock.mockClear();
  cloneModalMock.mockClear();
  copyWizardModalMock.mockClear();
  onCloseMock = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('ManageArchitecturesModal (Task 5.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Renders one row per non-archived architecture, oldest-first.
  // --------------------------------------------------------------------------
  it('renders one row per non-archived architecture, ordered oldest-first by createdAt', () => {
    // Intentionally arrange the list out of order so the sort step is
    // observable in the rendered output.
    const newer = buildArchitecture({
      id: 'arch-newer',
      name: 'Target State',
      createdAt: '2026-03-01T00:00:00Z',
    });
    const oldest = buildArchitecture({
      id: 'arch-oldest',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const middle = buildArchitecture({
      id: 'arch-middle',
      name: 'Current State',
      createdAt: '2026-02-01T00:00:00Z',
    });

    setArchitectures([newer, oldest, middle]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    const list = screen.getByTestId('manage-architectures-list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    // Assert order via the per-row test ids.
    expect(rows[0]).toHaveAttribute('data-testid', 'manage-architectures-row-arch-oldest');
    expect(rows[1]).toHaveAttribute('data-testid', 'manage-architectures-row-arch-middle');
    expect(rows[2]).toHaveAttribute('data-testid', 'manage-architectures-row-arch-newer');

    // Cross-check the visible names match the same order.
    expect(within(rows[0]).getByTestId('manage-architectures-row-name-arch-oldest'))
      .toHaveTextContent('Default');
    expect(within(rows[1]).getByTestId('manage-architectures-row-name-arch-middle'))
      .toHaveTextContent('Current State');
    expect(within(rows[2]).getByTestId('manage-architectures-row-name-arch-newer'))
      .toHaveTextContent('Target State');
  });

  // --------------------------------------------------------------------------
  // Test 2: Archived rows are NOT rendered.
  // --------------------------------------------------------------------------
  // Doubles as the Group 7 safety-property-(g) regression: because the
  // archived row never renders, no per-row Clone button can ever be
  // rendered against an archived architecture from this modal.
  it('does not render archived architectures (and therefore no Clone button for archived rows)', () => {
    const live = buildArchitecture({
      id: 'arch-live',
      name: 'Default',
      archived: false,
    });
    const archived = buildArchitecture({
      id: 'arch-archived',
      name: 'Old Variant',
      archived: true,
    });

    setArchitectures([live, archived]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    expect(screen.getByTestId('manage-architectures-row-arch-live')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-architectures-row-arch-archived')).not.toBeInTheDocument();

    // Safety property (g): no Clone (or Edit / Archive) button is rendered
    // for the archived architecture because the row itself is filtered out.
    expect(screen.queryByTestId('manage-architectures-clone-arch-archived')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manage-architectures-edit-arch-archived')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manage-architectures-archive-arch-archived')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Clicking Edit opens the EditArchitectureModal pre-populated
  // with the row's data, in `mode='edit'`.
  // --------------------------------------------------------------------------
  it('clicking Edit opens EditArchitectureModal with mode=edit and the row pre-populated', () => {
    const a = buildArchitecture({
      id: 'arch-1',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const b = buildArchitecture({
      id: 'arch-2',
      name: 'Target State',
      description: 'Where we are heading.',
      tags: ['target-state', 'wip'],
      createdAt: '2026-02-01T00:00:00Z',
    });

    setArchitectures([a, b]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Initially no Edit modal in the DOM.
    expect(screen.queryByTestId('mock-edit-architecture-modal')).not.toBeInTheDocument();

    // Click Edit on row B.
    fireEvent.click(screen.getByTestId('manage-architectures-edit-arch-2'));

    // Mock modal mounted with mode=edit and the right architecture.
    const child = screen.getByTestId('mock-edit-architecture-modal');
    expect(child).toBeInTheDocument();
    expect(child).toHaveAttribute('data-mode', 'edit');
    expect(child).toHaveAttribute('data-architecture-id', 'arch-2');
    expect(child).toHaveAttribute('data-architecture-name', 'Target State');

    // And spy received the full architecture in `architecture` prop --
    // the spec requires passing `architecture={row}` (NOT `initial`).
    expect(editModalMock).toHaveBeenCalled();
    const lastCall = editModalMock.mock.calls[editModalMock.mock.calls.length - 1][0] as {
      mode: string;
      architecture: Architecture;
      projectId: string;
      open: boolean;
    };
    expect(lastCall.mode).toBe('edit');
    expect(lastCall.architecture).toEqual(b);
    expect(lastCall.projectId).toBe(PROJECT_ID);
    expect(lastCall.open).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 4: Safety property (b) client side.
  // --------------------------------------------------------------------------
  it('disables Archive (with tooltip) when only one non-archived architecture exists, and clicking it does not open the confirm modal', () => {
    const onlyOne = buildArchitecture({ id: 'arch-only', name: 'Default' });
    setArchitectures([onlyOne]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    const archiveBtn = screen.getByTestId(
      'manage-architectures-archive-arch-only'
    ) as HTMLButtonElement;

    // Disabled with the spec's tooltip text. Use a substring match so
    // ASCII vs em-dash variations don't break the assertion -- the
    // load-bearing words are "Cannot archive" and "at least one
    // architecture".
    expect(archiveBtn.disabled).toBe(true);
    const tooltip = archiveBtn.getAttribute('title') ?? '';
    expect(tooltip).toMatch(/Cannot archive/);
    expect(tooltip).toMatch(/at least one architecture/);

    // Clicking it is a no-op: the confirm modal must NOT mount with a
    // populated architecture. The mock returns null when architecture is
    // null, so the testid will not appear in the DOM.
    fireEvent.click(archiveBtn);
    expect(
      screen.queryByTestId('mock-archive-architecture-confirm-modal')
    ).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 5: With 2+ non-archived architectures, Archive click opens the
  // ArchiveArchitectureConfirmModal with the row pre-populated.
  // --------------------------------------------------------------------------
  it('clicking Archive opens ArchiveArchitectureConfirmModal with the row when 2+ non-archived architectures exist', () => {
    const a = buildArchitecture({
      id: 'arch-a',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const b = buildArchitecture({
      id: 'arch-b',
      name: 'Variant',
      createdAt: '2026-02-01T00:00:00Z',
    });
    setArchitectures([a, b]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    const archiveA = screen.getByTestId('manage-architectures-archive-arch-a') as HTMLButtonElement;
    const archiveB = screen.getByTestId('manage-architectures-archive-arch-b') as HTMLButtonElement;

    expect(archiveA.disabled).toBe(false);
    expect(archiveB.disabled).toBe(false);
    // No tooltip when enabled.
    expect(archiveA.getAttribute('title')).toBeNull();

    // Initially the confirm modal mock is mounted but with architecture=null
    // (so it returns null and nothing renders). Confirm via DOM absence.
    expect(
      screen.queryByTestId('mock-archive-architecture-confirm-modal')
    ).not.toBeInTheDocument();

    // Click Archive on row B.
    fireEvent.click(archiveB);

    // Confirm modal now rendered with row B's data.
    const confirm = screen.getByTestId('mock-archive-architecture-confirm-modal');
    expect(confirm).toBeInTheDocument();
    expect(confirm).toHaveAttribute('data-architecture-id', 'arch-b');
    expect(confirm).toHaveAttribute('data-architecture-name', 'Variant');
    expect(confirm).toHaveAttribute('data-project-id', PROJECT_ID);

    // And the spy received the full architecture object (parent passes
    // the row from local state).
    const calls = archiveModalMock.mock.calls;
    const lastProps = calls[calls.length - 1][0] as {
      architecture: Architecture | null;
      projectId: string;
      onClose: () => void;
    };
    expect(lastProps.architecture).toEqual(b);
    expect(lastProps.projectId).toBe(PROJECT_ID);
    expect(typeof lastProps.onClose).toBe('function');
  });

  // --------------------------------------------------------------------------
  // Test 6: (Spec #6 Group 7) Per-row Clone button is rendered for every
  // non-archived row alongside Edit + Archive, and no Clone modal is
  // mounted on initial render.
  // --------------------------------------------------------------------------
  it('renders a Clone button on every non-archived row alongside Edit + Archive (no Clone modal mounted initially)', () => {
    const a = buildArchitecture({
      id: 'arch-a',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const b = buildArchitecture({
      id: 'arch-b',
      name: 'Variant',
      createdAt: '2026-02-01T00:00:00Z',
    });
    setArchitectures([a, b]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Each non-archived row exposes the full action triplet.
    expect(screen.getByTestId('manage-architectures-edit-arch-a')).toBeInTheDocument();
    expect(screen.getByTestId('manage-architectures-clone-arch-a')).toBeInTheDocument();
    expect(screen.getByTestId('manage-architectures-archive-arch-a')).toBeInTheDocument();

    expect(screen.getByTestId('manage-architectures-edit-arch-b')).toBeInTheDocument();
    expect(screen.getByTestId('manage-architectures-clone-arch-b')).toBeInTheDocument();
    expect(screen.getByTestId('manage-architectures-archive-arch-b')).toBeInTheDocument();

    // Clone buttons are labelled "Clone" (spec copy).
    expect(screen.getByTestId('manage-architectures-clone-arch-a')).toHaveTextContent('Clone');
    expect(screen.getByTestId('manage-architectures-clone-arch-b')).toHaveTextContent('Clone');

    // No Clone modal mounted before any click -- the parent guards on
    // `cloningArchitecture && <CloneArchitectureModal ... />`.
    expect(screen.queryByTestId('mock-clone-architecture-modal')).not.toBeInTheDocument();
    expect(cloneModalMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 7: (Spec #6 Group 7) Clicking Clone on a row opens
  // CloneArchitectureModal with `source={row}` and {open, projectId}
  // wired through; firing the child's onClose unmounts the modal.
  // --------------------------------------------------------------------------
  it('clicking Clone opens CloneArchitectureModal with source={row}, and the child onClose clears the local state', () => {
    const a = buildArchitecture({
      id: 'arch-a',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const b = buildArchitecture({
      id: 'arch-b',
      name: 'Variant',
      description: 'A second variant.',
      tags: ['exploratory'],
      createdAt: '2026-02-01T00:00:00Z',
    });
    setArchitectures([a, b]);

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Click Clone on row B.
    fireEvent.click(screen.getByTestId('manage-architectures-clone-arch-b'));

    // The mock CloneArchitectureModal is now mounted with the right props.
    const modal = screen.getByTestId('mock-clone-architecture-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute('data-open', 'true');
    expect(modal).toHaveAttribute('data-project-id', PROJECT_ID);
    expect(modal).toHaveAttribute('data-source-id', 'arch-b');
    expect(modal).toHaveAttribute('data-source-name', 'Variant');

    // And the spy received the full architecture object as `source`.
    expect(cloneModalMock).toHaveBeenCalled();
    const lastCall = cloneModalMock.mock.calls[cloneModalMock.mock.calls.length - 1][0] as {
      open: boolean;
      onClose: () => void;
      projectId: string;
      source: Architecture;
    };
    expect(lastCall.open).toBe(true);
    expect(lastCall.projectId).toBe(PROJECT_ID);
    expect(lastCall.source).toEqual(b);
    expect(typeof lastCall.onClose).toBe('function');

    // Fire the child's onClose -- the parent should clear cloningArchitecture
    // and the mock CloneArchitectureModal should unmount. The parent's
    // outer onClose must NOT be invoked (the manage modal stays open).
    fireEvent.click(screen.getByTestId('mock-clone-architecture-modal-fire-close'));
    expect(screen.queryByTestId('mock-clone-architecture-modal')).not.toBeInTheDocument();
    expect(onCloseMock).not.toHaveBeenCalled();
    // Manage modal is still rendered.
    expect(screen.getByTestId('manage-architectures-modal')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 8: (Spec #7 Group 10) Per-row `Copy from...` button rendered for
  // every non-archived row alongside Edit + Clone + Archive. The button on
  // the row that IS the active architecture is disabled with the spec's
  // tooltip (safety property (h)). No wizard mounted on initial render.
  // --------------------------------------------------------------------------
  it('renders a Copy from button on every non-archived row, disabled-with-tooltip when the row IS the active architecture', () => {
    const active = buildArchitecture({
      id: 'arch-active',
      name: 'Current State',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const other = buildArchitecture({
      id: 'arch-other',
      name: 'Target State',
      createdAt: '2026-02-01T00:00:00Z',
    });
    // arch-active is the active architecture -- its Copy from button must
    // be disabled. arch-other's button must be enabled.
    setArchitectures([active, other], 'arch-active');

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Both rows expose the new fourth action button.
    const copyActive = screen.getByTestId(
      'manage-architectures-copy-from-arch-active'
    ) as HTMLButtonElement;
    const copyOther = screen.getByTestId(
      'manage-architectures-copy-from-arch-other'
    ) as HTMLButtonElement;

    expect(copyActive).toBeInTheDocument();
    expect(copyOther).toBeInTheDocument();

    // Copy buttons labelled (spec copy includes the trailing ellipsis).
    expect(copyActive).toHaveTextContent(/Copy from/);
    expect(copyOther).toHaveTextContent(/Copy from/);

    // Safety property (h): the active row's button is disabled with the
    // exact tooltip text from the spec. Use substring matches so ASCII vs
    // em-dash variations don't break the assertion -- load-bearing words
    // are "Cannot copy into itself" and "switch to a different
    // architecture".
    expect(copyActive.disabled).toBe(true);
    const tooltip = copyActive.getAttribute('title') ?? '';
    expect(tooltip).toMatch(/Cannot copy into itself/);
    expect(tooltip).toMatch(/switch to a different architecture/);

    // The non-active row's button is enabled with no tooltip.
    expect(copyOther.disabled).toBe(false);
    expect(copyOther.getAttribute('title')).toBeNull();

    // No wizard mounted before any click.
    expect(
      screen.queryByTestId('mock-selective-copy-wizard-modal')
    ).not.toBeInTheDocument();
    expect(copyWizardModalMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 9: (Spec #7 Group 10) Clicking `Copy from...` on a non-active row
  // opens the SelectiveCopyWizardModal with `source={row}` and
  // `target={activeArchitecture}`. The child onClose clears local state
  // and the wizard unmounts; the manage modal remains open.
  // --------------------------------------------------------------------------
  it('clicking Copy from on a non-active row opens SelectiveCopyWizardModal with source=row and target=activeArchitecture', () => {
    const active = buildArchitecture({
      id: 'arch-active',
      name: 'Current State',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const other = buildArchitecture({
      id: 'arch-other',
      name: 'Target State',
      description: 'Variant we want to pull from.',
      tags: ['target-state'],
      createdAt: '2026-02-01T00:00:00Z',
    });
    setArchitectures([active, other], 'arch-active');

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Click Copy from on the non-active row.
    fireEvent.click(screen.getByTestId('manage-architectures-copy-from-arch-other'));

    // Wizard mock is now mounted with source=row, target=active.
    const wizard = screen.getByTestId('mock-selective-copy-wizard-modal');
    expect(wizard).toBeInTheDocument();
    expect(wizard).toHaveAttribute('data-open', 'true');
    expect(wizard).toHaveAttribute('data-project-id', PROJECT_ID);
    expect(wizard).toHaveAttribute('data-source-id', 'arch-other');
    expect(wizard).toHaveAttribute('data-source-name', 'Target State');
    expect(wizard).toHaveAttribute('data-target-id', 'arch-active');
    expect(wizard).toHaveAttribute('data-target-name', 'Current State');

    // And the spy received the full architecture objects.
    expect(copyWizardModalMock).toHaveBeenCalled();
    const lastCall = copyWizardModalMock.mock.calls[
      copyWizardModalMock.mock.calls.length - 1
    ][0] as {
      open: boolean;
      onClose: () => void;
      projectId: string;
      source: Architecture;
      target: Architecture;
    };
    expect(lastCall.open).toBe(true);
    expect(lastCall.projectId).toBe(PROJECT_ID);
    expect(lastCall.source).toEqual(other);
    expect(lastCall.target).toEqual(active);
    expect(typeof lastCall.onClose).toBe('function');

    // Fire the child's onClose -- the parent should clear
    // copyingFromArchitecture and the wizard should unmount. The parent's
    // outer onClose must NOT be invoked (the manage modal stays open).
    fireEvent.click(screen.getByTestId('mock-selective-copy-wizard-modal-fire-close'));
    expect(
      screen.queryByTestId('mock-selective-copy-wizard-modal')
    ).not.toBeInTheDocument();
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('manage-architectures-modal')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 10: (Spec #7 Group 10) Defence-in-depth for safety property (h):
  // clicking the disabled `Copy from...` button on the active-architecture
  // row never mounts the wizard (browser native click suppression on
  // disabled buttons is the primary protection; this verifies no stray
  // handler bypasses it).
  // --------------------------------------------------------------------------
  it('clicking the disabled Copy from button on the active row never mounts the wizard', () => {
    const active = buildArchitecture({
      id: 'arch-active',
      name: 'Current State',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const other = buildArchitecture({
      id: 'arch-other',
      name: 'Variant',
      createdAt: '2026-02-01T00:00:00Z',
    });
    setArchitectures([active, other], 'arch-active');

    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    const copyActive = screen.getByTestId(
      'manage-architectures-copy-from-arch-active'
    ) as HTMLButtonElement;
    expect(copyActive.disabled).toBe(true);

    // Click is a no-op on a disabled button -- the wizard must NOT mount.
    fireEvent.click(copyActive);
    expect(
      screen.queryByTestId('mock-selective-copy-wizard-modal')
    ).not.toBeInTheDocument();
    expect(copyWizardModalMock).not.toHaveBeenCalled();
  });
});
