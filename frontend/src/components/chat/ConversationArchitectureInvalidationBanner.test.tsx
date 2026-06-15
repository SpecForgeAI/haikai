/**
 * ConversationArchitectureInvalidationBanner Tests
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 9
 *
 * Coverage (kept to <=8 focused tests, per task spec 9.1):
 *   1. No render when active arch matches bound (returns null).
 *   2. Renders warning banner when active arch differs from bound; both
 *      architecture names appear in the message.
 *   3. Click "Swap back" calls `setActiveArchitecture(boundArchitectureId)`.
 *   4. Click "Abandon conversation" calls the `onAbandon` prop.
 *
 * Mocking strategy:
 *   - vi.mock the `ArchitectureContext` module so `useActiveArchitectureId`
 *     and `useArchitectureContext` return controlled values per test (no
 *     Provider needed). Mirrors the SaveTargetArchitecturePickerModal test
 *     pattern (Group 8) and the DashboardView tests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock context. Tests mutate the variables between renders to drive the
// active-architecture-id and the architectures list; the hook re-reads each
// invocation.
// ---------------------------------------------------------------------------

let mockActiveArchitectureId: string | null = 'arch-target';
const mockSetActiveArchitecture = vi.fn();
const boundArch = {
  id: 'arch-current',
  projectId: 'proj-1',
  name: 'Current State',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const targetArch = {
  id: 'arch-target',
  projectId: 'proj-1',
  name: 'Target State',
  description: null,
  tags: [] as string[],
  archived: false,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};
let mockArchitectures = [boundArch, targetArch];

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => mockActiveArchitectureId,
  useArchitectureContext: () => ({
    architectures: mockArchitectures,
    setActiveArchitecture: mockSetActiveArchitecture,
  }),
}));

// Imports AFTER the mock so the mocked module is wired in.
import { ConversationArchitectureInvalidationBanner } from './ConversationArchitectureInvalidationBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBanner(
  overrides: Partial<
    React.ComponentProps<typeof ConversationArchitectureInvalidationBanner>
  > = {}
) {
  const defaults: React.ComponentProps<
    typeof ConversationArchitectureInvalidationBanner
  > = {
    boundArchitectureId: 'arch-current',
    boundArchitectureName: 'Current State',
    onAbandon: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return {
    props,
    ...render(<ConversationArchitectureInvalidationBanner {...props} />),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationArchitectureInvalidationBanner (Task 9.1)', () => {
  beforeEach(() => {
    // Reset to canonical fixtures.
    mockActiveArchitectureId = 'arch-target';
    mockArchitectures = [boundArch, targetArch];
    mockSetActiveArchitecture.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: when active architecture matches bound, the banner self-suppresses
  // (returns null). The chat panel keeps the component mounted unconditionally
  // for bound/derived modes; the no-divergence guard lives here.
  // --------------------------------------------------------------------------
  it('renders nothing when the active architecture matches the bound architecture', () => {
    mockActiveArchitectureId = 'arch-current'; // same as boundArchitectureId

    renderBanner({ boundArchitectureId: 'arch-current' });

    expect(
      screen.queryByTestId('conv-arch-invalidation-banner')
    ).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: when active != bound, banner renders with both architecture names
  // surfaced in the message and the swap-back button label.
  // --------------------------------------------------------------------------
  it('renders the warning banner when active architecture differs from bound; includes both names', () => {
    mockActiveArchitectureId = 'arch-target';

    renderBanner({
      boundArchitectureId: 'arch-current',
      boundArchitectureName: 'Current State',
    });

    // Banner is mounted.
    expect(
      screen.getByTestId('conv-arch-invalidation-banner')
    ).toBeInTheDocument();

    // Message includes both bound and active names.
    const message = screen.getByTestId('conv-arch-invalidation-banner-message');
    expect(message).toHaveTextContent(
      /This conversation is bound to architecture\s*Current State/
    );
    expect(message).toHaveTextContent(/you('|\u2019)re currently viewing\s*Target State/);
    expect(message).toHaveTextContent(
      /Switch back to continue, or abandon this conversation\./
    );

    // Swap-back button embeds the bound architecture name.
    expect(
      screen.getByTestId('conv-arch-invalidation-banner-swap-back')
    ).toHaveTextContent('Swap back to Current State');

    // Abandon button is present with the spec-mandated copy.
    expect(
      screen.getByTestId('conv-arch-invalidation-banner-abandon')
    ).toHaveTextContent('Abandon conversation');
  });

  // --------------------------------------------------------------------------
  // Test 3: clicking "Swap back" calls setActiveArchitecture with the bound id.
  // The URL change is handled by spec #2's ArchitectureContext routing; the
  // banner just signals the intent.
  // --------------------------------------------------------------------------
  it('clicking "Swap back" calls setActiveArchitecture with the bound architecture id', () => {
    mockActiveArchitectureId = 'arch-target';

    renderBanner({ boundArchitectureId: 'arch-current' });

    fireEvent.click(
      screen.getByTestId('conv-arch-invalidation-banner-swap-back')
    );

    expect(mockSetActiveArchitecture).toHaveBeenCalledTimes(1);
    expect(mockSetActiveArchitecture).toHaveBeenCalledWith('arch-current');
  });

  // --------------------------------------------------------------------------
  // Test 4: clicking "Abandon conversation" calls the onAbandon prop. The
  // chat panel (Group 10) decides what abandon means -- the banner just
  // surfaces the user's intent.
  // --------------------------------------------------------------------------
  it('clicking "Abandon conversation" calls the onAbandon prop', () => {
    mockActiveArchitectureId = 'arch-target';
    const onAbandon = vi.fn();

    renderBanner({ boundArchitectureId: 'arch-current', onAbandon });

    fireEvent.click(
      screen.getByTestId('conv-arch-invalidation-banner-abandon')
    );

    expect(onAbandon).toHaveBeenCalledTimes(1);
    // Swap-back side effect MUST NOT fire when the user chose abandon.
    expect(mockSetActiveArchitecture).not.toHaveBeenCalled();
  });
});
