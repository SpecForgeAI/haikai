/**
 * SelectiveCopyMappingReviewStep -- notes pretty-rendering tests
 *
 * Spec 2026-05-26 Mapping-Notes Pretty Rendering -- Task Groups 2 + 3.
 *
 * Two integration tests covering the read/edit toggle on the per-row
 * Notes cell + the manual-add row's permanent textarea:
 *
 *   1. (Task Group 2) Read mode shows LinkifiedText + pencil. Click
 *      pencil -> textarea. Type new (multi-line) value + Save -> cell
 *      flips back to read mode with the new value visible.
 *   2. (Task Group 3) Manual-add row's notes field is a <textarea>
 *      (not <input>) and accepts multi-line input.
 *
 * Pattern mirrors `SelectiveCopyMappingReviewStep.gapFill.test.tsx` for
 * the mock-plumbing convention.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi',
  );
  return {
    ...actual,
    getElementsInventory: vi.fn(),
    listArchitectureMappings: vi.fn(),
    createArchitectureMapping: vi.fn(),
    updateArchitectureMapping: vi.fn(),
    deleteArchitectureMapping: vi.fn(),
  };
});

import {
  getElementsInventory,
  listArchitectureMappings,
  updateArchitectureMapping,
  type ArchitectureElementMappingDto,
  type ElementInventoryResponse,
} from '../../api/architecturesApi';
import { SelectiveCopyMappingReviewStep } from './SelectiveCopyMappingReviewStep';

const PROJECT_ID = 'proj-notes-edit';
const SOURCE_ARCH_ID = 'arch-source-notes';
const TARGET_ARCH_ID = 'arch-target-notes';

function buildMapping(
  overrides: Partial<ArchitectureElementMappingDto> = {}
): ArchitectureElementMappingDto {
  return {
    id: 'mapping-notes-1',
    projectId: PROJECT_ID,
    sourceArchitectureId: SOURCE_ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    sourceElementType: 'application',
    sourceElementId: 'app-1',
    targetElementType: 'application',
    targetElementId: 'app-1-target',
    mappingType: 'equivalent',
    status: 'confirmed',
    createdByTask: 'selective-copy-with-auto-map',
    createdAt: '2026-05-26T10:00:00Z',
    updatedAt: '2026-05-26T10:00:00Z',
    notes: 'initial notes',
    confidence: 1.0,
    ...overrides,
  };
}

function buildInventory(): ElementInventoryResponse {
  return {
    domains: [
      {
        name: 'Applications',
        types: [
          {
            name: 'Service',
            entityType: 'application',
            instances: [
              { id: 'app-1', name: 'App One' },
              { id: 'app-2', name: 'App Two' },
            ],
          },
        ],
      },
      { name: 'Data', types: [] },
      { name: 'Business', types: [] },
      { name: 'UI', types: [] },
      { name: 'Behavioural', types: [] },
      { name: 'Diagrams', types: [] },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderStep() {
  return render(
    <SelectiveCopyMappingReviewStep
      projectId={PROJECT_ID}
      sourceArchitectureId={SOURCE_ARCH_ID}
      targetArchitectureId={TARGET_ARCH_ID}
    />
  );
}

describe('SelectiveCopyMappingReviewStep -- notes pretty-rendering', () => {
  // ----------------------------------------------------------------------
  // Test 1 (Task Group 2): pencil -> textarea -> Save -> read mode.
  // ----------------------------------------------------------------------
  it('Test 1: pencil click flips Notes cell to textarea; Save commits new value and returns to read mode', async () => {
    const mapping = buildMapping({ notes: 'initial notes' });
    // First fetch returns the initial state. Subsequent fetch (after
    // Save) returns the updated state so the refetch->reseed-drafts
    // flow reflects the new value in read mode.
    vi.mocked(listArchitectureMappings)
      .mockResolvedValueOnce([mapping])
      .mockResolvedValue([{ ...mapping, notes: 'new\nmulti-line\nnotes' }]);
    vi.mocked(updateArchitectureMapping).mockResolvedValue({
      ...mapping,
      notes: 'new\nmulti-line\nnotes',
    });

    renderStep();

    // Wait for the initial fetch + row render.
    await waitFor(() => {
      expect(
        screen.getByTestId(`mapping-review-row-${mapping.id}`)
      ).toBeInTheDocument();
    });

    // Read mode: notes content is visible via LinkifiedText (rendered as
    // plain text in this case -- no URLs). The pencil button is visible.
    const row = screen.getByTestId(`mapping-review-row-${mapping.id}`);
    expect(row.textContent).toContain('initial notes');
    const pencil = screen.getByTestId(
      `mapping-review-row-notes-edit-${mapping.id}`
    );
    expect(pencil).toBeInTheDocument();

    // Click the pencil.
    fireEvent.click(pencil);

    // Edit mode: a <textarea> appears with the initial value; the pencil
    // is gone from the DOM.
    const textarea = (await screen.findByTestId(
      `mapping-review-row-notes-${mapping.id}`
    )) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('initial notes');
    expect(
      screen.queryByTestId(`mapping-review-row-notes-edit-${mapping.id}`)
    ).toBeNull();

    // Cancel button is now visible.
    expect(
      screen.getByTestId(`mapping-review-row-notes-cancel-${mapping.id}`)
    ).toBeInTheDocument();

    // Type a multi-line replacement.
    fireEvent.change(textarea, {
      target: { value: 'new\nmulti-line\nnotes' },
    });
    expect(textarea.value).toBe('new\nmulti-line\nnotes');

    // Click Save.
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`mapping-review-row-save-${mapping.id}`)
      );
    });

    // updateArchitectureMapping was called with the new notes value.
    await waitFor(() => {
      expect(updateArchitectureMapping).toHaveBeenCalledTimes(1);
    });
    const updateCall = vi.mocked(updateArchitectureMapping).mock.calls[0];
    expect(updateCall[0]).toBe(PROJECT_ID);
    expect(updateCall[1]).toBe(mapping.id);
    expect(updateCall[2].notes).toBe('new\nmulti-line\nnotes');

    // Cell flips back to read mode: pencil button reappears, textarea
    // is gone, and the new value is rendered.
    await waitFor(() => {
      expect(
        screen.getByTestId(`mapping-review-row-notes-edit-${mapping.id}`)
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(`mapping-review-row-notes-${mapping.id}`)
    ).toBeNull();
    const updatedRow = screen.getByTestId(`mapping-review-row-${mapping.id}`);
    expect(updatedRow.textContent).toContain('new');
    expect(updatedRow.textContent).toContain('multi-line');
    expect(updatedRow.textContent).toContain('notes');
  });

  // ----------------------------------------------------------------------
  // Test 2 (Task Group 3): manual-add row's notes field is a <textarea>
  // and accepts multi-line input.
  // ----------------------------------------------------------------------
  it('Test 2: manual-add row notes is a textarea that accepts multi-line input', async () => {
    vi.mocked(listArchitectureMappings).mockResolvedValue([]);

    renderStep();

    // Wait for the inventories + empty list to settle so the "Add
    // manual mapping" button is rendered.
    await waitFor(() => {
      expect(
        screen.getByTestId('mapping-review-open-manual-add')
      ).toBeInTheDocument();
    });

    // Open the manual-add row.
    fireEvent.click(screen.getByTestId('mapping-review-open-manual-add'));
    await waitFor(() => {
      expect(
        screen.getByTestId('mapping-review-manual-add-row')
      ).toBeInTheDocument();
    });

    // The notes field is a <textarea> (not <input>).
    const notes = screen.getByTestId(
      'mapping-review-manual-add-notes'
    ) as HTMLTextAreaElement;
    expect(notes.tagName).toBe('TEXTAREA');

    // Type a multi-line value. The textarea preserves newlines in its
    // value (controlled-component round-trip).
    fireEvent.change(notes, {
      target: { value: 'line one\nline two\nline three' },
    });
    expect(notes.value).toBe('line one\nline two\nline three');
  });
});
