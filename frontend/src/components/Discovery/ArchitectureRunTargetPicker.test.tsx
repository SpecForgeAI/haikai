/**
 * ArchitectureRunTargetPicker Tests
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
 *
 * Tests cover:
 *   1. Renders all non-archived architectures, oldest-first by createdAt.
 *      Archived rows are filtered out.
 *   2. Pre-selected with the value passed via props (the parent modal
 *      seeds this from useActiveArchitectureId() per spec).
 *   3. Disabled when the project has exactly one non-archived architecture
 *      (the picker is still rendered for confirmation, but there is no
 *      choice to make).
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` of ArchitectureContext so we can inject
 *     the architectures list directly.
 *   - No router needed -- the picker reads only from the context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

import { type Architecture } from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { ArchitectureRunTargetPicker } from './ArchitectureRunTargetPicker';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_DEFAULT_ID = 'arch-default-uuid';
const ARCH_TARGET_ID = 'arch-target-uuid';
const ARCH_ARCHIVED_ID = 'arch-archived-uuid';

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

function setContext(architectures: Architecture[]) {
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures,
  } as unknown as ReturnType<typeof useArchitectureContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('ArchitectureRunTargetPicker (Task 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: Renders all non-archived architectures, oldest-first.
  // --------------------------------------------------------------------------
  it('renders all non-archived architectures in oldest-first order, filtering out archived rows', () => {
    // Intentionally seed the context out of order to prove the picker
    // sorts -- we pass Target State (newer) before Default (older), plus
    // an archived row that must NOT appear.
    setContext([
      buildArchitecture({
        id: ARCH_TARGET_ID,
        name: 'Target State',
        createdAt: '2026-02-01T00:00:00Z',
      }),
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: 'Default',
        createdAt: '2026-01-01T00:00:00Z',
      }),
      buildArchitecture({
        id: ARCH_ARCHIVED_ID,
        name: 'Old Archived',
        archived: true,
        createdAt: '2025-12-01T00:00:00Z',
      }),
    ]);

    render(
      <ArchitectureRunTargetPicker
        value={ARCH_DEFAULT_ID}
        onChange={vi.fn()}
      />
    );

    const select = screen.getByTestId(
      'architecture-run-target-picker-select'
    ) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));

    // Two non-archived rows present (the archived one is filtered out).
    expect(options).toHaveLength(2);

    // Oldest-first: Default (2026-01-01) before Target State (2026-02-01),
    // even though we seeded the context the other way around.
    expect(options[0]).toHaveTextContent('Default');
    expect(options[0].getAttribute('value')).toBe(ARCH_DEFAULT_ID);
    expect(options[1]).toHaveTextContent('Target State');
    expect(options[1].getAttribute('value')).toBe(ARCH_TARGET_ID);

    // The archived row is absent.
    expect(
      screen.queryByTestId(`architecture-run-target-picker-option-${ARCH_ARCHIVED_ID}`)
    ).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: Pre-selected with the value passed via props (parent seeds
  // this from useActiveArchitectureId()).
  // --------------------------------------------------------------------------
  it('pre-selects the option matching the value prop (parent seeds from useActiveArchitectureId())', () => {
    setContext([
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
    ]);

    // value=Target State -- the picker should show that as the selected
    // option (proving the parent's pre-selection from useActiveArchitectureId
    // propagates correctly through the controlled `value` prop).
    render(
      <ArchitectureRunTargetPicker
        value={ARCH_TARGET_ID}
        onChange={vi.fn()}
      />
    );

    const select = screen.getByTestId(
      'architecture-run-target-picker-select'
    ) as HTMLSelectElement;
    expect(select.value).toBe(ARCH_TARGET_ID);
  });

  // --------------------------------------------------------------------------
  // Test 3: Disabled when only one non-archived architecture exists.
  // --------------------------------------------------------------------------
  it('is disabled when the project has exactly one non-archived architecture', () => {
    setContext([
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: 'Default',
        createdAt: '2026-01-01T00:00:00Z',
      }),
      // Archived rows do not count -- the picker should still be disabled
      // because the only selectable choice is Default.
      buildArchitecture({
        id: ARCH_ARCHIVED_ID,
        name: 'Old Archived',
        archived: true,
        createdAt: '2025-12-01T00:00:00Z',
      }),
    ]);

    render(
      <ArchitectureRunTargetPicker
        value={ARCH_DEFAULT_ID}
        onChange={vi.fn()}
      />
    );

    const select = screen.getByTestId(
      'architecture-run-target-picker-select'
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe(ARCH_DEFAULT_ID);

    // Sanity: confirmation copy is still present so the user can read
    // what the run will be locked to.
    expect(
      screen.getByTestId('architecture-run-target-picker-confirmation').textContent
    ).toContain('locked to this architecture for its entire lifetime');
  });

  // --------------------------------------------------------------------------
  // Test 4: onChange fires with the picked id when the user selects a
  // different architecture (sanity check that the picker is wired
  // controlled-style and the parent receives the new id).
  // --------------------------------------------------------------------------
  it('calls onChange with the newly selected architecture id when the user changes the select', () => {
    setContext([
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
    ]);

    const onChange = vi.fn();
    render(
      <ArchitectureRunTargetPicker
        value={ARCH_DEFAULT_ID}
        onChange={onChange}
      />
    );

    const select = screen.getByTestId(
      'architecture-run-target-picker-select'
    ) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: ARCH_TARGET_ID } });

    expect(onChange).toHaveBeenCalledWith(ARCH_TARGET_ID);
  });
});
