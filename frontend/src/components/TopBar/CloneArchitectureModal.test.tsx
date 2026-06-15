/**
 * CloneArchitectureModal Tests
 *
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 6
 * Task 6.1: 4-8 focused tests for the new Clone modal.
 *
 * Coverage matrix:
 *   1. Defaults on open (decisions #2 + #3):
 *      - Name pre-populated as `Copy of <source.name>`.
 *      - Description pre-populated from `source.description`.
 *      - Tags chip area starts EMPTY (no chips pre-loaded -- distinguishes
 *        from EditArchitectureModal which copies the source's tags).
 *
 *   2. Submit happy path -- safety property (h):
 *      - cloneArchitecture called with (projectId, source.id, payload).
 *      - On success: refreshArchitectures + setActiveArchitecture(newArch.id)
 *        + showToast(`Cloned <source.name> as <new.name>`) + onClose().
 *
 *   3. 409 duplicate_name surfaces inline under the Name field:
 *      - Modal stays open, refresh / setActive / onClose NOT called.
 *
 *   4. 422 archived_source surfaces in the footer banner:
 *      - Modal stays open (rare path -- defence-in-depth from backend).
 *
 *   5. Tag chip primitive: Enter adds chip, x button removes chip.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - architecturesApi mocked: cloneArchitecture as vi.fn() --
 *     ArchitecturesApiError preserved (real class) so the typed branch
 *     in the modal works.
 *   - ArchitectureContext.useArchitectureContext mocked so we don't need
 *     the full provider machinery for a focused modal test.
 *   - ToastContext.useToast mocked so we can assert showToast calls.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mocks (declared before imports per Vitest's hoisting semantics).
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi'
  );
  return {
    ...actual,
    cloneArchitecture: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

import {
  cloneArchitecture,
  ArchitecturesApiError,
  type Architecture,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { CloneArchitectureModal } from './CloneArchitectureModal';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const SOURCE_ID = 'arch-source-456';
const NEW_ARCH_ID = 'arch-cloned-789';

function buildSource(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: SOURCE_ID,
    projectId: PROJECT_ID,
    name: 'Default',
    description: 'The original architecture description.',
    tags: ['baseline', 'production'],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildClone(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: NEW_ARCH_ID,
    projectId: PROJECT_ID,
    name: 'Copy of Default',
    description: 'The original architecture description.',
    tags: [],
    archived: false,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// Test setup helpers
// ============================================================================

let refreshArchitecturesMock: ReturnType<typeof vi.fn>;
let setActiveArchitectureMock: ReturnType<typeof vi.fn>;
let showToastMock: ReturnType<typeof vi.fn>;
let onCloseMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  refreshArchitecturesMock = vi.fn().mockResolvedValue(undefined);
  setActiveArchitectureMock = vi.fn();
  showToastMock = vi.fn();
  onCloseMock = vi.fn();

  vi.mocked(useArchitectureContext).mockReturnValue({
    refreshArchitectures: refreshArchitecturesMock,
    setActiveArchitecture: setActiveArchitectureMock,
    architectures: [],
    activeArchitectureId: null,
  } as unknown as ReturnType<typeof useArchitectureContext>);

  vi.mocked(useToast).mockReturnValue({
    showToast: showToastMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('CloneArchitectureModal (Task 6.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Defaults on open -- decisions #2 (Name) + #3 (description copied,
  // tags empty).
  // --------------------------------------------------------------------------
  it('pre-populates Name as `Copy of <source.name>`, copies the description, and starts tags EMPTY', () => {
    const source = buildSource({ name: 'Default', description: 'Original description.' });

    render(
      <CloneArchitectureModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        source={source}
      />
    );

    // Name pre-populated.
    expect(screen.getByTestId('clone-architecture-name-input')).toHaveValue(
      'Copy of Default'
    );

    // Description pre-populated from source.
    expect(screen.getByTestId('clone-architecture-description-input')).toHaveValue(
      'Original description.'
    );

    // Tags chip area is empty -- the "No tags yet" placeholder is visible
    // and source.tags (`baseline`, `production`) are NOT rendered.
    expect(screen.getByTestId('clone-architecture-chip-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('clone-architecture-chip-baseline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clone-architecture-chip-production')).not.toBeInTheDocument();

    // Header announces what we're forking from.
    expect(
      screen.getByText('Clone architecture: Default', { exact: false })
    ).toBeInTheDocument();

    // Submit button is labelled `Clone` (not `Save changes` / not `Create`).
    const submitBtn = screen.getByTestId(
      'clone-architecture-submit-button'
    ) as HTMLButtonElement;
    expect(submitBtn).toHaveTextContent(/^Clone$/);
  });

  // --------------------------------------------------------------------------
  // Test 2: Description fallback -- when source.description is null, the
  // textarea opens empty (not the literal string `null`).
  // --------------------------------------------------------------------------
  it('description defaults to empty string when source.description is null', () => {
    const source = buildSource({ description: null });

    render(
      <CloneArchitectureModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        source={source}
      />
    );

    expect(screen.getByTestId('clone-architecture-description-input')).toHaveValue('');
  });

  // --------------------------------------------------------------------------
  // Test 3: Submit happy path -- safety property (h).
  //
  // Tweak the name + add a tag chip, click Clone, and assert:
  //   - cloneArchitecture called with (projectId, source.id, payload).
  //   - refreshArchitectures awaited.
  //   - setActiveArchitecture(newArch.id) called (safety property h).
  //   - showToast fired with the right message.
  //   - onClose called.
  // --------------------------------------------------------------------------
  it('submit success path: calls cloneArchitecture with the right payload, then refresh -> setActive -> toast -> onClose', async () => {
    const source = buildSource({ name: 'Default' });
    const cloned = buildClone({
      id: NEW_ARCH_ID,
      name: 'Target State',
      description: 'A blank slate for the target architecture.',
      tags: ['target-state'],
    });
    vi.mocked(cloneArchitecture).mockResolvedValue(cloned);

    render(
      <CloneArchitectureModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        source={source}
      />
    );

    // Overtype the default Name.
    fireEvent.change(screen.getByTestId('clone-architecture-name-input'), {
      target: { value: 'Target State' },
    });

    // Overtype the description.
    fireEvent.change(screen.getByTestId('clone-architecture-description-input'), {
      target: { value: 'A blank slate for the target architecture.' },
    });

    // Add a tag.
    const tagInput = screen.getByTestId('clone-architecture-tag-input');
    fireEvent.change(tagInput, { target: { value: 'target-state' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByTestId('clone-architecture-chip-target-state')).toBeInTheDocument();

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByTestId('clone-architecture-submit-button'));
    });

    // cloneArchitecture called once with the right payload.
    expect(cloneArchitecture).toHaveBeenCalledTimes(1);
    expect(cloneArchitecture).toHaveBeenCalledWith(PROJECT_ID, SOURCE_ID, {
      name: 'Target State',
      description: 'A blank slate for the target architecture.',
      tags: ['target-state'],
    });

    // Post-clone pipeline (order matters per safety property h).
    await waitFor(() => {
      expect(refreshArchitecturesMock).toHaveBeenCalledTimes(1);
    });
    expect(setActiveArchitectureMock).toHaveBeenCalledTimes(1);
    expect(setActiveArchitectureMock).toHaveBeenCalledWith(NEW_ARCH_ID);

    // Toast copy uses BOTH source.name AND the new architecture's name.
    expect(showToastMock).toHaveBeenCalledWith(
      'Cloned Default as Target State',
      'success'
    );

    // Modal closed.
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 4: 409 duplicate_name surfaces inline under the Name field; modal
  // stays open; refresh / setActive / onClose NOT called.
  // --------------------------------------------------------------------------
  it('surfaces a 409 duplicate_name inline under the Name field; modal stays open; no refresh / no navigation / no close', async () => {
    const source = buildSource({ name: 'Default' });
    vi.mocked(cloneArchitecture).mockRejectedValue(
      new ArchitecturesApiError(409, {
        code: 'duplicate_name',
        field: 'name',
        message: "An architecture named 'Copy of Default' already exists in this project.",
      })
    );

    render(
      <CloneArchitectureModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        source={source}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('clone-architecture-submit-button'));
    });

    // Inline error rendered under the Name field with the server's message.
    await waitFor(() => {
      const err = screen.getByTestId('clone-architecture-name-error');
      expect(err).toHaveTextContent(
        "An architecture named 'Copy of Default' already exists in this project."
      );
    });

    // Modal stays open.
    expect(screen.getByTestId('clone-architecture-modal')).toBeInTheDocument();

    // Nothing post-success was called.
    expect(refreshArchitecturesMock).not.toHaveBeenCalled();
    expect(setActiveArchitectureMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 5: 422 archived_source surfaces in the footer banner; modal stays
  // open. (Rare path -- defence-in-depth.)
  // --------------------------------------------------------------------------
  it('surfaces a 422 archived_source in the footer banner; modal stays open', async () => {
    const source = buildSource({ name: 'Default' });
    vi.mocked(cloneArchitecture).mockRejectedValue(
      new ArchitecturesApiError(422, {
        code: 'archived_source',
        message: 'This architecture has been archived and can no longer be cloned.',
      })
    );

    render(
      <CloneArchitectureModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        source={source}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('clone-architecture-submit-button'));
    });

    await waitFor(() => {
      const err = screen.getByTestId('clone-architecture-submit-error');
      expect(err).toHaveTextContent(
        'This architecture has been archived and can no longer be cloned.'
      );
    });

    // Modal stays open; no inline name error (this is a footer-banner path).
    expect(screen.getByTestId('clone-architecture-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('clone-architecture-name-error')).not.toBeInTheDocument();

    // No success-side effects.
    expect(refreshArchitecturesMock).not.toHaveBeenCalled();
    expect(setActiveArchitectureMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 6: Tag chip primitive -- Enter adds, x removes.
  //
  // Focused on the two interactions the spec explicitly calls out for
  // Group 6's chip coverage. The full chip behaviour matrix (duplicate /
  // empty / >50 chars) is already exhaustively covered in
  // EditArchitectureModal.test.tsx; we only need the smoke check here that
  // the primitive is wired up in the Clone modal.
  // --------------------------------------------------------------------------
  it('tag chip primitive: Enter adds a chip, x removes a chip', () => {
    const source = buildSource();

    render(
      <CloneArchitectureModal
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        source={source}
      />
    );

    const tagInput = screen.getByTestId(
      'clone-architecture-tag-input'
    ) as HTMLInputElement;

    // ---- Enter adds a chip ----
    fireEvent.change(tagInput, { target: { value: 'target-state' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByTestId('clone-architecture-chip-target-state')).toBeInTheDocument();
    expect(tagInput.value).toBe('');
    // The "No tags yet" placeholder is now hidden.
    expect(screen.queryByTestId('clone-architecture-chip-empty')).not.toBeInTheDocument();

    // ---- x removes the chip ----
    fireEvent.click(screen.getByTestId('clone-architecture-chip-remove-target-state'));
    expect(
      screen.queryByTestId('clone-architecture-chip-target-state')
    ).not.toBeInTheDocument();
    // Placeholder reappears now that the chip area is empty again.
    expect(screen.getByTestId('clone-architecture-chip-empty')).toBeInTheDocument();
  });
});
