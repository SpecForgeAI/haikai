/**
 * ArchiveArchitectureConfirmModal Tests
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 6
 * Task 6.1: 2-8 focused tests for the archive confirmation modal.
 *
 * Coverage matrix:
 *   1. Renders nothing when `architecture === null`; renders shell + body
 *      when set.
 *
 *   2. Active-architecture warning paragraph renders only when archiving
 *      the currently-active architecture, and names the resolved next
 *      (oldest non-archived after excluding the to-be-archived row).
 *
 *   3. Confirm flow (non-active path): calls archiveArchitecture with the
 *      correct ids, then refreshArchitectures, then onClose. Does NOT call
 *      setActiveArchitecture (URL stays put).
 *
 *   4. Confirm flow (active path - safety property d): also calls
 *      setActiveArchitecture(nextId) using the resolved next-oldest
 *      non-archived id.
 *
 *   5. 422 server response (safety property b - server race): error
 *      message rendered in the modal, modal stays open, refreshArchitectures
 *      is NOT called.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - architecturesApi.archiveArchitecture mocked so each test controls
 *     resolution / rejection.
 *   - ArchitectureContext.useArchitectureContext mocked so we can inject
 *     `architectures`, `activeArchitectureId`, and capture
 *     `setActiveArchitecture` / `refreshArchitectures` calls without
 *     mounting the full provider.
 *   - ToastContext.useToast mocked to avoid pulling the Toast component.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ============================================================================
// Mocks (must be set up before importing the component)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi'
  );
  return {
    ...actual,
    archiveArchitecture: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

import {
  type Architecture,
  ArchitecturesApiError,
  archiveArchitecture,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { ArchiveArchitectureConfirmModal } from './ArchiveArchitectureConfirmModal';

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

interface ContextOverrides {
  architectures: Architecture[];
  activeArchitectureId: string | null;
}

let refreshMock: ReturnType<typeof vi.fn>;
let setActiveMock: ReturnType<typeof vi.fn>;
let showToastMock: ReturnType<typeof vi.fn>;
let onCloseMock: ReturnType<typeof vi.fn>;

function setContext({ architectures, activeArchitectureId }: ContextOverrides) {
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures,
    activeArchitectureId,
    refreshArchitectures: refreshMock,
    setActiveArchitecture: setActiveMock,
  } as unknown as ReturnType<typeof useArchitectureContext>);
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshMock = vi.fn().mockResolvedValue(undefined);
  setActiveMock = vi.fn();
  showToastMock = vi.fn();
  onCloseMock = vi.fn();
  vi.mocked(useToast).mockReturnValue({ showToast: showToastMock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('ArchiveArchitectureConfirmModal (Task 6.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: hidden when architecture === null; visible when set.
  // --------------------------------------------------------------------------
  it('renders nothing when architecture is null and renders the shell when set', () => {
    const arch = buildArchitecture({ id: 'a1', name: 'Default' });
    setContext({
      architectures: [arch],
      activeArchitectureId: arch.id,
    });

    const { rerender } = render(
      <ArchiveArchitectureConfirmModal
        architecture={null}
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    expect(
      screen.queryByTestId('archive-architecture-confirm-modal')
    ).not.toBeInTheDocument();

    // Now flip to populated (this stays on the same root, so rerender is
    // safe -- no unmount in between).
    rerender(
      <ArchiveArchitectureConfirmModal
        architecture={arch}
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    expect(
      screen.getByTestId('archive-architecture-confirm-modal')
    ).toBeInTheDocument();
    // Body copy includes the architecture name.
    expect(screen.getByTestId('archive-architecture-message')).toHaveTextContent(
      "Archive 'Default'?"
    );
    // Header text per spec.
    expect(screen.getByText('Archive architecture?')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: active-architecture warning paragraph renders only when
  // archiving the active architecture, naming the resolved <next>.
  //
  // We exercise both arms (non-active first, active second) using two
  // independent render() calls separated by an explicit cleanup() so the
  // testing-library state is fresh between them. (Avoids the "Cannot
  // update an unmounted root" trap when calling rerender() after
  // unmount().)
  // --------------------------------------------------------------------------
  it('renders the active-architecture warning naming the next-oldest non-archived only when archiving the active row', () => {
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
    const newer = buildArchitecture({
      id: 'arch-newer',
      name: 'Target State',
      createdAt: '2026-03-01T00:00:00Z',
    });

    // ----- First scenario: archive a NON-active row. No warning expected.
    setContext({
      architectures: [oldest, middle, newer],
      activeArchitectureId: oldest.id, // active is the oldest
    });

    render(
      <ArchiveArchitectureConfirmModal
        architecture={middle} // not active
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    expect(
      screen.queryByTestId('archive-architecture-active-warning')
    ).not.toBeInTheDocument();

    // Tear down the first render explicitly so the second render has a
    // fresh root.
    cleanup();

    // ----- Second scenario: archive the active row. Warning expected,
    // naming the resolved next-oldest non-archived after excluding
    // `oldest`. Candidates: [middle, newer] -> next is `middle`.
    setContext({
      architectures: [oldest, middle, newer],
      activeArchitectureId: oldest.id,
    });

    render(
      <ArchiveArchitectureConfirmModal
        architecture={oldest} // active
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    const warning = screen.getByTestId('archive-architecture-active-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent("you're currently viewing");
    expect(warning).toHaveTextContent("'Current State'");
  });

  // --------------------------------------------------------------------------
  // Test 3: confirm calls archiveArchitecture, then refreshArchitectures,
  // then onClose. Non-active path: setActiveArchitecture NOT called.
  // --------------------------------------------------------------------------
  it('on confirm: calls archiveArchitecture with the right ids, refreshArchitectures, and onClose; non-active path does not move active', async () => {
    const active = buildArchitecture({
      id: 'arch-active',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const target = buildArchitecture({
      id: 'arch-target',
      name: 'Variant',
      createdAt: '2026-02-01T00:00:00Z',
    });

    setContext({
      architectures: [active, target],
      activeArchitectureId: active.id,
    });

    vi.mocked(archiveArchitecture).mockResolvedValue({
      ...target,
      archived: true,
    });

    render(
      <ArchiveArchitectureConfirmModal
        architecture={target} // archiving the non-active row
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    fireEvent.click(screen.getByTestId('archive-architecture-confirm'));

    await waitFor(() => {
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    expect(archiveArchitecture).toHaveBeenCalledTimes(1);
    expect(archiveArchitecture).toHaveBeenCalledWith(PROJECT_ID, target.id);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Non-active path: setActiveArchitecture must NOT fire.
    expect(setActiveMock).not.toHaveBeenCalled();

    // Success toast fires with the spec wording.
    expect(showToastMock).toHaveBeenCalledWith(
      "Architecture 'Variant' archived.",
      'success'
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: safety property (d) -- archiving the active architecture also
  // calls setActiveArchitecture(nextId).
  // --------------------------------------------------------------------------
  it('safety property (d): archiving the active architecture calls setActiveArchitecture(nextId)', async () => {
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
    const newer = buildArchitecture({
      id: 'arch-newer',
      name: 'Target State',
      createdAt: '2026-03-01T00:00:00Z',
    });

    setContext({
      architectures: [oldest, middle, newer],
      activeArchitectureId: oldest.id,
    });

    vi.mocked(archiveArchitecture).mockResolvedValue({
      ...oldest,
      archived: true,
    });

    render(
      <ArchiveArchitectureConfirmModal
        architecture={oldest} // active
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    fireEvent.click(screen.getByTestId('archive-architecture-confirm'));

    await waitFor(() => {
      expect(setActiveMock).toHaveBeenCalledTimes(1);
    });

    // Next is the oldest of the remaining non-archived (middle).
    expect(setActiveMock).toHaveBeenCalledWith(middle.id);

    // Safety property (e) sanity: refresh fires regardless.
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 5: 422 server-race response -- error message rendered in modal,
  // modal stays open, refreshArchitectures NOT called.
  // --------------------------------------------------------------------------
  it('on 422 last_architecture: renders the error inline, keeps modal open, and does not call refreshArchitectures', async () => {
    const onlyArch = buildArchitecture({
      id: 'arch-only',
      name: 'Default',
    });
    const otherArch = buildArchitecture({
      id: 'arch-other',
      name: 'Variant',
      createdAt: '2026-02-01T00:00:00Z',
    });

    // Set up context so the client thinks two non-archived rows exist (so
    // the parent allowed Archive). The server is the one rejecting.
    setContext({
      architectures: [onlyArch, otherArch],
      activeArchitectureId: otherArch.id, // archive a NON-active row to
      // exercise the 422 path without conflating with the active-archive
      // navigation in test #4.
    });

    vi.mocked(archiveArchitecture).mockRejectedValue(
      new ArchitecturesApiError(
        422,
        {
          code: 'last_architecture',
          message: 'A project must have at least one architecture.',
        }
      )
    );

    render(
      <ArchiveArchitectureConfirmModal
        architecture={onlyArch}
        projectId={PROJECT_ID}
        onClose={onCloseMock}
      />
    );

    fireEvent.click(screen.getByTestId('archive-architecture-confirm'));

    // Wait for the error to render.
    await waitFor(() => {
      expect(screen.getByTestId('archive-architecture-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('archive-architecture-error')).toHaveTextContent(
      'A project must have at least one architecture.'
    );

    // Modal must stay open.
    expect(
      screen.getByTestId('archive-architecture-confirm-modal')
    ).toBeInTheDocument();

    // No refresh, no navigation, no close on the error path.
    expect(refreshMock).not.toHaveBeenCalled();
    expect(setActiveMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();

    // No success toast either.
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
