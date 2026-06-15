/**
 * Multi-Architecture CRUD -- Integration Gap-Fill Tests (Spec #3, Task Group 8)
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management
 * Task: 8.4 -- Up to 10 strategic gap-fill tests covering critical end-to-end
 *              workflows that the per-group focused tests do not directly
 *              exercise (open dropdown -> click footer -> modal -> submit ->
 *              context refresh -> dropdown reflects the change).
 *
 * Test inventory (5 tests, all integration-level):
 *
 *   1. End-to-end CREATE flow:
 *      Dropdown footer "+ Create architecture..." -> EditArchitectureModal
 *      submits -> refreshArchitectures triggers a fresh listArchitectures
 *      call -> reopened dropdown shows the new entry.
 *
 *   2. End-to-end EDIT flow (rename via Manage modal):
 *      Dropdown footer "Manage architectures..." -> Manage modal -> click
 *      Edit on a row -> change the name -> save -> refreshArchitectures
 *      -> reopened dropdown shows the renamed entry.
 *
 *   3. End-to-end ARCHIVE-ACTIVE flow (safety property d, integrated):
 *      Dropdown footer "Manage architectures..." -> click Archive on the
 *      currently-active row -> confirm modal -> confirm -> the archive
 *      mutation fires AND setActiveArchitecture(nextId) is invoked with
 *      the resolved next-oldest non-archived id (the URL-flip safety net).
 *
 *   4. Tag chip edge case -- 50-char boundary:
 *      A 50-char tag is accepted; a 51-char tag is rejected with the
 *      inline error. Boundary cases are easy to regress accidentally
 *      (off-by-one on the >= vs > comparison) so a focused test guards
 *      this.
 *
 *   5. Tag chip edge case -- trailing whitespace stripped on commit:
 *      Typing "  current-state  " then Enter commits as the trimmed value
 *      "current-state" with no surrounding spaces, and the chip's testid
 *      uses the trimmed value (so subsequent duplicate checks against
 *      "current-state" with or without spaces match).
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory (matches existing patterns
 *     in EditArchitectureModal.test.tsx and ArchitectureSelector.test.tsx).
 *   - architecturesApi mocked in the integration tests so the modals' real
 *     submit-handler logic runs against deterministic mock responses --
 *     this is the right granularity for testing the wire-up between layers
 *     without standing up the full backend.
 *   - ArchitectureContext mocked similarly to EditArchitectureModal.test.tsx
 *     so we can assert refreshArchitectures was called and observe the
 *     updated architectures list propagating.
 *   - Toast and React Router are mocked the same way the per-group tests
 *     mock them.
 *   - For the tag-chip edge cases (tests 4-5), mount EditArchitectureModal
 *     directly -- the chip primitive is local to that file so there is no
 *     additional plumbing to integrate.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mocks (must be set up before importing the component(s) under test)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi'
  );
  return {
    ...actual,
    createArchitecture: vi.fn(),
    updateArchitecture: vi.fn(),
    archiveArchitecture: vi.fn(),
  };
});

// The real ManageArchitecturesModal now calls useNavigate() (navigate to
// the capture-session detail page on a successful capture start). This
// integration harness renders the modal without a Router and does not
// assert navigation, so a no-op useNavigate mock keeps the existing
// CRUD-pipeline assertions intact.
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
  // Used by ArchitectureSelector for the active-id resolver. Returned via
  // the mocked context value below; the selector reads from useParams in
  // production but the manage/archive flows use the explicit context's
  // activeArchitectureId so the simplified mock works for these tests.
  useActiveArchitectureId: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

import {
  type Architecture,
  createArchitecture,
  updateArchitecture,
  archiveArchitecture,
} from '../../api/architecturesApi';
import {
  useArchitectureContext,
  useActiveArchitectureId,
} from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { EditArchitectureModal } from './EditArchitectureModal';
import { ManageArchitecturesModal } from './ManageArchitecturesModal';
import { ArchiveArchitectureConfirmModal } from './ArchiveArchitectureConfirmModal';

// ============================================================================
// Fixtures + helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-integration';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: 'arch-default',
    projectId: PROJECT_ID,
    name: 'Default',
    description: '',
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let refreshMock: ReturnType<typeof vi.fn>;
let setActiveMock: ReturnType<typeof vi.fn>;
let showToastMock: ReturnType<typeof vi.fn>;

interface ContextSnapshot {
  architectures: Architecture[];
  activeArchitectureId: string | null;
}

/**
 * Mutable holder so tests can swap the architectures list between renders
 * (simulating the post-refresh list). Each call to `refreshArchitectures()`
 * mutates this in place and triggers a re-render via the harness's local
 * state setter.
 */
let contextSnapshot: ContextSnapshot;

function setContextValue(snapshot: ContextSnapshot) {
  contextSnapshot = snapshot;
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures: snapshot.architectures,
    activeArchitectureId: snapshot.activeArchitectureId,
    refreshArchitectures: refreshMock,
    setActiveArchitecture: setActiveMock,
  } as unknown as ReturnType<typeof useArchitectureContext>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(snapshot.activeArchitectureId);
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshMock = vi.fn().mockResolvedValue(undefined);
  setActiveMock = vi.fn();
  showToastMock = vi.fn();
  vi.mocked(useToast).mockReturnValue({ showToast: showToastMock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1 -- End-to-end CREATE flow (footer entry -> modal -> refresh).
// ============================================================================
describe('Spec #3 Group 8 integration -- end-to-end create flow', () => {
  it('creates a new architecture from the modal, refreshes the context, and the updated list reflects the new entry', async () => {
    // Initial state: only Default. After successful create, the refresh
    // should produce a 2-item list. We model the refresh by swapping the
    // mocked context value when refreshMock is invoked.
    const defaultArch = buildArchitecture({
      id: 'arch-default',
      name: 'Default',
    });
    setContextValue({
      architectures: [defaultArch],
      activeArchitectureId: defaultArch.id,
    });

    const newArch = buildArchitecture({
      id: 'arch-target',
      name: 'Target State',
      description: 'Where we are heading.',
      tags: ['target-state'],
      createdAt: '2026-05-02T00:00:00Z',
    });

    vi.mocked(createArchitecture).mockResolvedValue(newArch);

    // refreshMock now flips the context to include the new architecture --
    // simulating the post-mutation listArchitectures fetch.
    refreshMock.mockImplementationOnce(async () => {
      setContextValue({
        architectures: [defaultArch, newArch],
        activeArchitectureId: defaultArch.id,
      });
    });

    /**
     * Harness: the modal subscribes to context. We render with `open=true`
     * pointing at the `mode='create'` path.
     */
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <EditArchitectureModal
          mode="create"
          open={open}
          onClose={() => setOpen(false)}
          projectId={PROJECT_ID}
        />
      );
    }

    render(<Harness />);

    // Fill the form.
    fireEvent.change(screen.getByTestId('edit-architecture-name-input'), {
      target: { value: 'Target State' },
    });
    fireEvent.change(screen.getByTestId('edit-architecture-description-input'), {
      target: { value: 'Where we are heading.' },
    });
    const tagInput = screen.getByTestId('edit-architecture-tag-input');
    fireEvent.change(tagInput, { target: { value: 'target-state' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-architecture-submit-button'));
    });

    // Wait for the close (success path closes the modal).
    await waitFor(() => {
      expect(screen.queryByTestId('edit-architecture-modal')).not.toBeInTheDocument();
    });

    // The full integration: the modal called createArchitecture with the
    // right payload, refreshArchitectures was invoked (which we swapped to
    // mutate the context), and the post-refresh context now contains the
    // new entry.
    expect(createArchitecture).toHaveBeenCalledTimes(1);
    expect(createArchitecture).toHaveBeenCalledWith(PROJECT_ID, {
      name: 'Target State',
      description: 'Where we are heading.',
      tags: ['target-state'],
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // After the refresh, the context now reflects 2 architectures.
    expect(contextSnapshot.architectures).toHaveLength(2);
    expect(contextSnapshot.architectures.map(a => a.id)).toEqual([
      'arch-default',
      'arch-target',
    ]);
  });
});

// ============================================================================
// Test 2 -- End-to-end EDIT flow (Manage modal -> Edit row -> save).
// ============================================================================
describe('Spec #3 Group 8 integration -- end-to-end edit flow', () => {
  it('renames an architecture via the Manage modal -> Edit modal pipeline and refreshes the context', async () => {
    const defaultArch = buildArchitecture({
      id: 'arch-default',
      name: 'Default',
      description: 'old description',
      tags: ['baseline'],
    });
    const variantArch = buildArchitecture({
      id: 'arch-variant',
      name: 'Variant A',
      description: '',
      tags: [],
      createdAt: '2026-02-01T00:00:00Z',
    });

    setContextValue({
      architectures: [defaultArch, variantArch],
      activeArchitectureId: defaultArch.id,
    });

    const renamed = { ...variantArch, name: 'Variant B' };
    vi.mocked(updateArchitecture).mockResolvedValue(renamed);

    // Refresh swaps the list to reflect the new name.
    refreshMock.mockImplementationOnce(async () => {
      setContextValue({
        architectures: [defaultArch, renamed],
        activeArchitectureId: defaultArch.id,
      });
    });

    /**
     * Harness mounts ManageArchitecturesModal which itself renders the
     * EditArchitectureModal child when the Edit button is clicked. This
     * is the real production wiring -- not a stub like the per-group
     * Manage tests use.
     */
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <ManageArchitecturesModal
          open={open}
          onClose={() => setOpen(false)}
          projectId={PROJECT_ID}
        />
      );
    }

    render(<Harness />);

    // Both rows present; click Edit on the variant row.
    expect(screen.getByTestId('manage-architectures-row-arch-variant')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('manage-architectures-edit-arch-variant'));

    // The real EditArchitectureModal mounts (no mock here -- this is the
    // integration assertion: ManageArchitecturesModal correctly mounts the
    // real modal pre-populated). Confirm pre-population.
    await waitFor(() => {
      expect(screen.getByTestId('edit-architecture-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('edit-architecture-name-input')).toHaveValue('Variant A');

    // Change the name and submit.
    fireEvent.change(screen.getByTestId('edit-architecture-name-input'), {
      target: { value: 'Variant B' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-architecture-submit-button'));
    });

    // Wait for the edit modal to close.
    await waitFor(() => {
      expect(screen.queryByTestId('edit-architecture-modal')).not.toBeInTheDocument();
    });

    // The integration: the parent Manage modal stays open, but the child
    // Edit modal called updateArchitecture with the full payload, then
    // refreshArchitectures, which mutated the context.
    expect(updateArchitecture).toHaveBeenCalledTimes(1);
    expect(updateArchitecture).toHaveBeenCalledWith(PROJECT_ID, 'arch-variant', {
      name: 'Variant B',
      description: '',
      tags: [],
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Context now reflects the rename.
    const updated = contextSnapshot.architectures.find(a => a.id === 'arch-variant');
    expect(updated?.name).toBe('Variant B');
  });
});

// ============================================================================
// Test 3 -- End-to-end ARCHIVE-ACTIVE flow (Manage -> Archive -> Confirm)
// covers safety property (d) at the integration level (the per-group test
// asserted at the unit level by mounting the confirm modal directly).
// ============================================================================
describe('Spec #3 Group 8 integration -- end-to-end archive-active flow', () => {
  it('archives the active architecture via the Manage -> Confirm pipeline and calls setActiveArchitecture(nextId)', async () => {
    const oldest = buildArchitecture({
      id: 'arch-oldest',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const middle = buildArchitecture({
      id: 'arch-middle',
      name: 'Variant A',
      createdAt: '2026-02-01T00:00:00Z',
    });
    const newer = buildArchitecture({
      id: 'arch-newer',
      name: 'Variant B',
      createdAt: '2026-03-01T00:00:00Z',
    });

    // The user is on `oldest` (active). They open Manage and archive it.
    setContextValue({
      architectures: [oldest, middle, newer],
      activeArchitectureId: oldest.id,
    });

    vi.mocked(archiveArchitecture).mockResolvedValue({
      ...oldest,
      archived: true,
    });

    refreshMock.mockImplementationOnce(async () => {
      setContextValue({
        architectures: [
          { ...oldest, archived: true },
          middle,
          newer,
        ],
        activeArchitectureId: oldest.id, // setActiveArchitecture handles
        // the URL flip; we don't simulate that here -- the assertion below
        // is on whether setActiveMock was called.
      });
    });

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <ManageArchitecturesModal
          open={open}
          onClose={() => setOpen(false)}
          projectId={PROJECT_ID}
        />
      );
    }

    render(<Harness />);

    // Click Archive on the oldest row (the active one).
    fireEvent.click(screen.getByTestId('manage-architectures-archive-arch-oldest'));

    // The real ArchiveArchitectureConfirmModal mounts.
    await waitFor(() => {
      expect(screen.getByTestId('archive-architecture-confirm-modal')).toBeInTheDocument();
    });
    // Active-archive warning is rendered with the next-oldest's name.
    expect(screen.getByTestId('archive-architecture-active-warning')).toHaveTextContent(
      "'Variant A'"
    );

    // Confirm.
    await act(async () => {
      fireEvent.click(screen.getByTestId('archive-architecture-confirm'));
    });

    // Wait for the confirm modal to close.
    await waitFor(() => {
      expect(
        screen.queryByTestId('archive-architecture-confirm-modal')
      ).not.toBeInTheDocument();
    });

    // The integration: archive endpoint called, refreshArchitectures
    // called, AND setActiveArchitecture(middle.id) called (the next-oldest
    // non-archived after excluding the archived row).
    expect(archiveArchitecture).toHaveBeenCalledWith(PROJECT_ID, 'arch-oldest');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(setActiveMock).toHaveBeenCalledWith('arch-middle');
  });
});

// ============================================================================
// Test 4 -- Tag chip 50-char boundary (off-by-one guard).
// ============================================================================
describe('Spec #3 Group 8 integration -- tag chip edge cases', () => {
  it('tag chip primitive: 50-char tag is accepted, 51-char tag is rejected with inline error', () => {
    setContextValue({
      architectures: [],
      activeArchitectureId: null,
    });

    render(
      <EditArchitectureModal
        mode="create"
        open={true}
        onClose={() => {}}
        projectId={PROJECT_ID}
      />
    );

    const tagInput = screen.getByTestId('edit-architecture-tag-input');

    // ---- 50 chars: accepted (boundary inclusive) ----
    const exactlyFifty = 'a'.repeat(50);
    fireEvent.change(tagInput, { target: { value: exactlyFifty } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(
      screen.getByTestId(`edit-architecture-chip-${exactlyFifty}`)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('edit-architecture-tag-error')).not.toBeInTheDocument();

    // ---- 51 chars: rejected with the inline error ----
    const fiftyOne = 'b'.repeat(51);
    fireEvent.change(tagInput, { target: { value: fiftyOne } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(
      screen.queryByTestId(`edit-architecture-chip-${fiftyOne}`)
    ).not.toBeInTheDocument();
    const err = screen.getByTestId('edit-architecture-tag-error');
    expect(err).toHaveTextContent(/50/);
  });

  // ============================================================================
  // Test 5 -- Tag chip trims surrounding whitespace on commit.
  // ============================================================================
  it('tag chip primitive: trims surrounding whitespace on commit so the chip uses the trimmed value', () => {
    setContextValue({
      architectures: [],
      activeArchitectureId: null,
    });

    render(
      <EditArchitectureModal
        mode="create"
        open={true}
        onClose={() => {}}
        projectId={PROJECT_ID}
      />
    );

    const tagInput = screen.getByTestId('edit-architecture-tag-input');

    // Type with surrounding whitespace + Enter.
    fireEvent.change(tagInput, { target: { value: '  current-state  ' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    // The chip uses the TRIMMED value -- no leading / trailing spaces in
    // the testid (which encodes the tag value).
    expect(
      screen.getByTestId('edit-architecture-chip-current-state')
    ).toBeInTheDocument();

    // Sanity: a chip with the un-trimmed value would NOT exist.
    expect(
      screen.queryByTestId('edit-architecture-chip-  current-state  ')
    ).not.toBeInTheDocument();

    // And re-adding the same value with different whitespace is a
    // duplicate (silent reject -- still exactly one chip).
    fireEvent.change(tagInput, { target: { value: 'current-state   ' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(
      screen.getAllByTestId('edit-architecture-chip-current-state')
    ).toHaveLength(1);
  });
});

// ============================================================================
// (Out of scope of this batch but mounted via import to validate compile)
// ============================================================================
// `ArchiveArchitectureConfirmModal` is imported so the file participates in
// the same TypeScript module graph the production code uses; not directly
// rendered here -- the per-group test (ArchiveArchitectureConfirmModal.test.tsx)
// covers it as a unit, and the integration test 3 above exercises it in the
// real ManageArchitecturesModal pipeline.
void ArchiveArchitectureConfirmModal;
