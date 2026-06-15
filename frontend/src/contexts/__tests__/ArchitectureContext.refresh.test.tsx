/**
 * ArchitectureContext.refreshArchitectures() -- Task Group 3 test
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 * Task 3.1: 2-8 focused tests for the API client + context.
 *
 * This file covers the safety property (e) foundation:
 *   - `refreshArchitectures()` re-invokes `listArchitectures(projectId)` and
 *     updates the in-memory `architectures` array on the context. Modals
 *     in groups 4-7 call this on success so the dropdown / Manage modal
 *     re-render against fresh server-confirmed data.
 *
 * Test strategy mirrors the existing
 *   `frontend/src/__tests__/multiArchitectureSelectorAndRouting.contextRewire.test.tsx`
 * pattern: mock `architecturesApi` and `ProjectContext.useProject`, render
 * the provider under a MemoryRouter so `useParams` resolves cleanly, and
 * drive the context via a tiny probe component.
 */

import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mocks (must be declared before importing the modules under test)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual('../../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

vi.mock('../ProjectContext', () => ({
  useProject: vi.fn(),
}));

import { listArchitectures, type Architecture } from '../../api/architecturesApi';
import { useProject } from '../ProjectContext';
import {
  ArchitectureProvider,
  useArchitectureContext,
} from '../ArchitectureContext';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-refresh';
const ARCH_A_ID = 'arch-a';
const ARCH_B_ID = 'arch-b';

function buildArchitecture(overrides: Partial<Architecture>): Architecture {
  return {
    id: 'arch-default',
    projectId: PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
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
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
  };
}

/**
 * Probe that exposes the architectures array + a button that calls
 * refreshArchitectures(). The test asserts behaviour through this probe's
 * rendered output.
 */
function RefreshProbe() {
  const ctx = useArchitectureContext();
  const list = ctx.architectures ?? [];
  return (
    <div>
      <div data-testid="arch-count">{list.length}</div>
      <div data-testid="arch-ids">{list.map(a => a.id).join(',')}</div>
      <button
        type="button"
        data-testid="refresh-btn"
        onClick={() => {
          // Fire-and-forget -- the test awaits the resulting list change.
          void ctx.refreshArchitectures();
        }}
      >
        refresh
      </button>
    </div>
  );
}

function renderWithProvider(children: ReactNode) {
  return render(
    <MemoryRouter
      initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_A_ID}/dashboard`]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/*"
          element={<ArchitectureProvider>{children}</ArchitectureProvider>}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('ArchitectureContext.refreshArchitectures() (Task 3.1, safety property e foundation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-invokes listArchitectures and updates the in-memory architectures array', async () => {
    // First call (initial load on mount): only [a1].
    // Second call (refresh): [a1, a2].
    vi.mocked(listArchitectures)
      .mockResolvedValueOnce([
        buildArchitecture({ id: ARCH_A_ID, name: 'Default' }),
      ])
      .mockResolvedValueOnce([
        buildArchitecture({ id: ARCH_A_ID, name: 'Default' }),
        buildArchitecture({ id: ARCH_B_ID, name: 'Target State' }),
      ]);

    renderWithProvider(<RefreshProbe />);

    // Initial load -- the useEffect from spec #2 fires once on mount.
    await waitFor(() => {
      expect(screen.getByTestId('arch-count')).toHaveTextContent('1');
    });
    expect(screen.getByTestId('arch-ids')).toHaveTextContent(ARCH_A_ID);
    expect(listArchitectures).toHaveBeenCalledTimes(1);
    expect(listArchitectures).toHaveBeenLastCalledWith(PROJECT_ID);

    // Trigger a refresh -- should invoke listArchitectures again and update
    // the array to the new 2-item shape.
    await act(async () => {
      screen.getByTestId('refresh-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('arch-count')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('arch-ids')).toHaveTextContent(
      `${ARCH_A_ID},${ARCH_B_ID}`
    );

    // Refresh fired exactly one additional listArchitectures call (so
    // the total is 2: initial load + refresh).
    expect(listArchitectures).toHaveBeenCalledTimes(2);
    expect(listArchitectures).toHaveBeenLastCalledWith(PROJECT_ID);
  });
});
