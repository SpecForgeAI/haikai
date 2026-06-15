/**
 * Redirect shim test for the legacy `/target-architecture` URL.
 *
 * Spec 2026-05-26-low-priority-mechanical-cleanups (#10).
 *
 * The legacy top-level Target Architecture route was re-homed under
 * Architecture & Design as a sub-tab (see
 * `2026-05-24-target-state-architect-conversation` Spec 1, Task Group 3.3).
 * A `<Navigate replace to="../architecture-design/target-state">` shim
 * lives in `App.tsx:783-784` so bookmarks pointing at the old URL keep
 * working. This test exists because the shim itself had no dedicated
 * coverage -- it was only being exercised incidentally through
 * `DashboardView.tsx:547`.
 *
 * The test asserts:
 *   1. Mounting MemoryRouter at the OLD URL
 *      `/projects/:p/architectures/:a/target-architecture` lands the user
 *      at the new canonical URL
 *      `/projects/:p/architectures/:a/architecture-design/target-state`
 *      (verified via `useLocation()` probe);
 *   2. The `:projectId` and `:architectureId` path params survive the
 *      `..` relative redirect (i.e. `p1` / `a1` are still resolvable on
 *      the destination route).
 *
 * Test mirrors the MemoryRouter + `<Routes>` pattern from
 * `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx`
 * but stays minimal: no AppShell / ProjectLayout providers are needed
 * because we mount only the two routes the shim cares about (the legacy
 * source path + the canonical destination path) and assert via testid +
 * `useLocation()`, not via destination-component behaviour.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';

/**
 * Probe component that renders the current pathname + the resolved
 * `:projectId` and `:architectureId` params via testids, so the test can
 * assert both the destination URL and the surviving path params without
 * mounting the real Target State page.
 */
function DestinationProbe() {
  const location = useLocation();
  const { projectId, architectureId } = useParams<{
    projectId: string;
    architectureId: string;
  }>();
  return (
    <div data-testid="destination-probe">
      <span data-testid="destination-pathname">{location.pathname}</span>
      <span data-testid="destination-project-id">{projectId}</span>
      <span data-testid="destination-architecture-id">{architectureId}</span>
    </div>
  );
}

describe('Target Architecture redirect shim (#10)', () => {
  it('redirects /target-architecture -> /architecture-design/target-state preserving path params', () => {
    render(
      <MemoryRouter
        initialEntries={['/projects/p1/architectures/a1/target-architecture']}
      >
        <Routes>
          <Route path="/projects/:projectId/architectures/:architectureId">
            {/*
              Mirrors the App.tsx:783-784 shim verbatim. The `..` prefix
              resolves against the matched parent segment
              `architectures/:architectureId`, so the projectId +
              architectureId path params survive into the destination.
            */}
            <Route
              path="target-architecture"
              element={<Navigate replace to="../architecture-design/target-state" />}
            />
            <Route
              path="architecture-design/target-state"
              element={<DestinationProbe />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // The probe at the destination route is mounted: redirect landed.
    expect(screen.getByTestId('destination-probe')).toBeInTheDocument();

    // URL ends up at the canonical destination, path params intact.
    expect(screen.getByTestId('destination-pathname').textContent).toBe(
      '/projects/p1/architectures/a1/architecture-design/target-state',
    );
    expect(screen.getByTestId('destination-project-id').textContent).toBe('p1');
    expect(screen.getByTestId('destination-architecture-id').textContent).toBe(
      'a1',
    );
  });
});
