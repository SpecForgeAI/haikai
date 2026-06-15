/**
 * StartDiscoveryRunConfirmModal Tests
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
 *
 * Tests cover:
 *   1. Override test (the spec's required Test 4): the user changes the
 *      picker to a different architecture id than the URL active id; on
 *      Confirm the modal calls `onConfirm(pickerArchId)` -- proving the
 *      picker is the source of truth and NOT the URL active id.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` of `useActiveArchitectureId` and
 *     `useArchitectureContext` so we can independently control:
 *       - the URL active architecture id (the picker pre-fill source)
 *       - the architectures list (the picker options)
 *   - The modal's own onConfirm callback is the integration point this
 *     test pins down -- it must receive the PICKER's id, NOT the URL
 *     active id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(),
  useArchitectureContext: vi.fn(),
}));

import { type Architecture } from '../../api/architecturesApi';
import {
  useActiveArchitectureId,
  useArchitectureContext,
} from '../../contexts/ArchitectureContext';
import { StartDiscoveryRunConfirmModal } from './StartDiscoveryRunConfirmModal';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_URL_ACTIVE_ID = 'arch-url-active-uuid';
const ARCH_PICKER_OVERRIDE_ID = 'arch-picker-override-uuid';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
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

function setUrlActiveArchId(id: string | null) {
  vi.mocked(useActiveArchitectureId).mockReturnValue(id);
}

function setArchitectures(list: Architecture[]) {
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures: list,
  } as unknown as ReturnType<typeof useArchitectureContext>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('StartDiscoveryRunConfirmModal (Task 6.1)', () => {
  // --------------------------------------------------------------------------
  // Test (spec required Test 4): picker override beats URL active id.
  //
  // Scenario:
  //   - URL active architecture is `arch-url-active-uuid` (the picker
  //     pre-fills with this).
  //   - User opens the picker and selects a DIFFERENT architecture
  //     (`arch-picker-override-uuid`).
  //   - User clicks Continue.
  //
  // Expected:
  //   - onConfirm is called with `arch-picker-override-uuid`, NOT the
  //     URL active id. This proves the picker is the source of truth
  //     for the run-start payload (spec property d -- run is bound to
  //     the picked architecture for life).
  // --------------------------------------------------------------------------
  it('Confirm passes the picker chosen id (NOT useActiveArchitectureId) into the run-start callback', () => {
    setUrlActiveArchId(ARCH_URL_ACTIVE_ID);
    setArchitectures([
      buildArchitecture({
        id: ARCH_URL_ACTIVE_ID,
        name: 'URL Active',
        createdAt: '2026-01-01T00:00:00Z',
      }),
      buildArchitecture({
        id: ARCH_PICKER_OVERRIDE_ID,
        name: 'Picker Override',
        createdAt: '2026-02-01T00:00:00Z',
      }),
    ]);

    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <StartDiscoveryRunConfirmModal
        isOpen={true}
        serviceName="Orders UI"
        warnings={['LLM-only mode warning']}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    // Sanity: picker pre-selected with the URL active id.
    const select = screen.getByTestId(
      'architecture-run-target-picker-select'
    ) as HTMLSelectElement;
    expect(select.value).toBe(ARCH_URL_ACTIVE_ID);

    // The user picks a different architecture.
    fireEvent.change(select, { target: { value: ARCH_PICKER_OVERRIDE_ID } });
    expect(select.value).toBe(ARCH_PICKER_OVERRIDE_ID);

    // The user clicks Continue.
    fireEvent.click(screen.getByTestId('modal-continue-button'));

    // Spec property d: onConfirm receives the picker's chosen id, NOT
    // the URL active id.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(ARCH_PICKER_OVERRIDE_ID);
    // Defensive: confirm was NOT called with the URL active id.
    expect(onConfirm).not.toHaveBeenCalledWith(ARCH_URL_ACTIVE_ID);
  });
});
