/**
 * EditArchitectureModal Tests
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 4
 * Task 4.1: 2-8 focused tests for the combined Create / Edit modal.
 *
 * Coverage matrix:
 *   1. Create flow happy path (safety property e):
 *      - Type name + description + add 2 tag chips, click Create
 *      - Asserts createArchitecture called once with the right payload
 *      - refreshArchitectures called, success toast fired, onClose called
 *
 *   2. Edit flow happy path (safety property c, atomic PATCH):
 *      - Pre-populated, change name + add new tag + remove existing tag
 *      - Asserts updateArchitecture called once with the FULL new
 *        {name, description, tags} payload
 *
 *   3. Duplicate-name 409 (safety property a):
 *      - createArchitecture rejects with status 409 + body.code === 'duplicate_name'
 *      - Inline error renders under the Name field with the server's message
 *      - refreshArchitectures NOT called, onClose NOT called, modal stays open
 *
 *   4. Tag chip primitive UX:
 *      - Enter commits a chip, comma commits a chip
 *      - Duplicate (case-sensitive) silently rejected
 *      - >50 chars rejected with inline error
 *      - Empty / whitespace-only silently rejected
 *      - x button removes a chip
 *
 *   5. Empty name blocks submit:
 *      - With name empty, primary button is disabled
 *      - Inline error renders after a typed-then-cleared cycle
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - architecturesApi mocked: createArchitecture / updateArchitecture as
 *     vi.fn() -- ArchitecturesApiError preserved (real class) so the typed
 *     branch in the modal works.
 *   - ArchitectureContext.useArchitectureContext mocked so we don't need the
 *     full provider machinery (~3000 LOC) for a focused modal test.
 *   - ToastContext.useToast mocked so we can assert showToast calls.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi'
  );
  return {
    ...actual,
    createArchitecture: vi.fn(),
    updateArchitecture: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

import {
  createArchitecture,
  updateArchitecture,
  ArchitecturesApiError,
  type Architecture,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { EditArchitectureModal } from './EditArchitectureModal';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_ID = 'arch-uuid-456';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: ARCH_ID,
    projectId: PROJECT_ID,
    name: 'Current State',
    description: 'The architecture as it stands today.',
    tags: ['baseline', 'production'],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

  // Minimal ArchitectureContext shape -- the modal only reads
  // refreshArchitectures off the context. setActiveArchitecture and the
  // other fields are stubbed for completeness so a future refactor that
  // pulls more fields off the context is caught early.
  vi.mocked(useArchitectureContext).mockReturnValue({
    refreshArchitectures: refreshArchitecturesMock,
    setActiveArchitecture: setActiveArchitectureMock,
    architectures: [],
    activeArchitectureId: null,
    // The state/dispatch/undo fields are unused by the modal -- cast
    // through unknown to satisfy the strict context type without mounting
    // the full reducer.
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

describe('EditArchitectureModal (Task 4.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Create flow happy path (safety property e -- refreshArchitectures
  // called after successful mutation).
  // --------------------------------------------------------------------------
  it('create flow: typing name + description + adding two tag chips submits the right payload, refreshes, toasts, and closes', async () => {
    vi.mocked(createArchitecture).mockResolvedValue(
      buildArchitecture({
        id: 'new-arch-id',
        name: 'Target State',
        description: 'Where we are heading.',
        tags: ['target-state', 'in-progress'],
      })
    );

    render(
      <EditArchitectureModal
        mode="create"
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Type Name.
    fireEvent.change(screen.getByTestId('edit-architecture-name-input'), {
      target: { value: 'Target State' },
    });

    // Type Description.
    fireEvent.change(screen.getByTestId('edit-architecture-description-input'), {
      target: { value: 'Where we are heading.' },
    });

    // Add two tag chips: one via Enter, one via comma.
    const tagInput = screen.getByTestId('edit-architecture-tag-input');
    fireEvent.change(tagInput, { target: { value: 'target-state' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByTestId('edit-architecture-chip-target-state')).toBeInTheDocument();

    fireEvent.change(tagInput, { target: { value: 'in-progress' } });
    fireEvent.keyDown(tagInput, { key: ',' });
    expect(screen.getByTestId('edit-architecture-chip-in-progress')).toBeInTheDocument();

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-architecture-submit-button'));
    });

    // createArchitecture called once with the right payload.
    expect(createArchitecture).toHaveBeenCalledTimes(1);
    expect(createArchitecture).toHaveBeenCalledWith(PROJECT_ID, {
      name: 'Target State',
      description: 'Where we are heading.',
      tags: ['target-state', 'in-progress'],
    });

    // Safety property (e): refreshArchitectures was called.
    await waitFor(() => {
      expect(refreshArchitecturesMock).toHaveBeenCalledTimes(1);
    });

    // Toast fired and modal closed.
    expect(showToastMock).toHaveBeenCalledWith('Architecture created.', 'success');
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 2: Edit flow + safety property (c) -- atomic PATCH.
  // --------------------------------------------------------------------------
  it('edit flow: pre-populated, changing name + adding/removing tags submits a single atomic PATCH with the full payload', async () => {
    const initial = buildArchitecture({
      name: 'Current State',
      description: 'Original description.',
      tags: ['baseline', 'production'],
    });

    vi.mocked(updateArchitecture).mockResolvedValue({
      ...initial,
      name: 'Renamed State',
      tags: ['baseline', 'snapshot-2026'],
    });

    render(
      <EditArchitectureModal
        mode="edit"
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
        architecture={initial}
      />
    );

    // Pre-population: name + description + chips visible.
    expect(screen.getByTestId('edit-architecture-name-input')).toHaveValue('Current State');
    expect(screen.getByTestId('edit-architecture-description-input')).toHaveValue(
      'Original description.'
    );
    expect(screen.getByTestId('edit-architecture-chip-baseline')).toBeInTheDocument();
    expect(screen.getByTestId('edit-architecture-chip-production')).toBeInTheDocument();

    // Change name.
    fireEvent.change(screen.getByTestId('edit-architecture-name-input'), {
      target: { value: 'Renamed State' },
    });

    // Remove one of the existing tags ('production').
    fireEvent.click(screen.getByTestId('edit-architecture-chip-remove-production'));
    expect(screen.queryByTestId('edit-architecture-chip-production')).not.toBeInTheDocument();

    // Add a new tag.
    const tagInput = screen.getByTestId('edit-architecture-tag-input');
    fireEvent.change(tagInput, { target: { value: 'snapshot-2026' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByTestId('edit-architecture-chip-snapshot-2026')).toBeInTheDocument();

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-architecture-submit-button'));
    });

    // Safety property (c): single atomic PATCH carries name + description + tags.
    expect(updateArchitecture).toHaveBeenCalledTimes(1);
    expect(updateArchitecture).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, {
      name: 'Renamed State',
      description: 'Original description.',
      tags: ['baseline', 'snapshot-2026'],
    });

    await waitFor(() => {
      expect(refreshArchitecturesMock).toHaveBeenCalledTimes(1);
    });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 3: Duplicate-name 409 -- safety property (a).
  // --------------------------------------------------------------------------
  it('surfaces a 409 duplicate-name error inline under the Name field, leaves the modal open, and does not refresh', async () => {
    vi.mocked(createArchitecture).mockRejectedValue(
      new ArchitecturesApiError(
        409,
        {
          code: 'duplicate_name',
          field: 'name',
          message: "An architecture named 'Default' already exists in this project.",
        }
      )
    );

    render(
      <EditArchitectureModal
        mode="create"
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    fireEvent.change(screen.getByTestId('edit-architecture-name-input'), {
      target: { value: 'Default' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('edit-architecture-submit-button'));
    });

    // Inline error rendered under the Name field with the server's message.
    await waitFor(() => {
      const err = screen.getByTestId('edit-architecture-name-error');
      expect(err).toHaveTextContent(
        "An architecture named 'Default' already exists in this project."
      );
    });

    // Modal stays open and we did NOT refresh / close.
    expect(screen.getByTestId('edit-architecture-modal')).toBeInTheDocument();
    expect(refreshArchitecturesMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 4: Tag chip primitive UX -- the chip behaviours in one focused test.
  // --------------------------------------------------------------------------
  it('tag chip primitive: Enter / comma add, x removes, duplicate silently rejected, >50 chars shows inline error, empty silently rejected', () => {
    render(
      <EditArchitectureModal
        mode="create"
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    const tagInput = screen.getByTestId('edit-architecture-tag-input') as HTMLInputElement;

    // ---- Enter adds a chip ----
    fireEvent.change(tagInput, { target: { value: 'current-state' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByTestId('edit-architecture-chip-current-state')).toBeInTheDocument();
    expect(tagInput.value).toBe('');

    // ---- Comma adds a chip ----
    fireEvent.change(tagInput, { target: { value: 'target-state' } });
    fireEvent.keyDown(tagInput, { key: ',' });
    expect(screen.getByTestId('edit-architecture-chip-target-state')).toBeInTheDocument();
    expect(tagInput.value).toBe('');

    // ---- Duplicate (case-sensitive) silently rejected: still only one ----
    fireEvent.change(tagInput, { target: { value: 'current-state' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    // Still exactly one chip with this label.
    expect(screen.getAllByTestId('edit-architecture-chip-current-state')).toHaveLength(1);
    // No tag error rendered for duplicate.
    expect(screen.queryByTestId('edit-architecture-tag-error')).not.toBeInTheDocument();

    // ---- Empty / whitespace-only silently rejected ----
    fireEvent.change(tagInput, { target: { value: '   ' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.queryByTestId('edit-architecture-tag-error')).not.toBeInTheDocument();
    // Chip count for current-state still 1.
    expect(screen.getAllByTestId('edit-architecture-chip-current-state')).toHaveLength(1);

    // ---- >50 chars rejected with inline error ----
    const tooLong = 'x'.repeat(51);
    fireEvent.change(tagInput, { target: { value: tooLong } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    const tagErr = screen.getByTestId('edit-architecture-tag-error');
    expect(tagErr).toHaveTextContent(/50 characters/i);

    // ---- x removes a chip ----
    fireEvent.click(screen.getByTestId('edit-architecture-chip-remove-target-state'));
    expect(screen.queryByTestId('edit-architecture-chip-target-state')).not.toBeInTheDocument();
    // current-state is still there.
    expect(screen.getByTestId('edit-architecture-chip-current-state')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 5: Empty name blocks submit.
  // --------------------------------------------------------------------------
  it('disables submit when the name is empty and shows an inline error after the user clears the field', async () => {
    render(
      <EditArchitectureModal
        mode="create"
        open={true}
        onClose={onCloseMock}
        projectId={PROJECT_ID}
      />
    );

    // Initially empty -> submit disabled.
    const submitBtn = screen.getByTestId('edit-architecture-submit-button') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Type then clear the name -- inline error should appear.
    const nameInput = screen.getByTestId('edit-architecture-name-input');
    fireEvent.change(nameInput, { target: { value: 'My Arch' } });
    expect(submitBtn.disabled).toBe(false);

    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(submitBtn.disabled).toBe(true);
    expect(screen.getByTestId('edit-architecture-name-error')).toHaveTextContent(/required/i);

    // Sanity: createArchitecture was never called.
    expect(createArchitecture).not.toHaveBeenCalled();
  });
});
