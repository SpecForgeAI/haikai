/**
 * Test harness for DiscoveryRunDetailPage.
 *
 * The page wrapper now owns all data fetching, the runs list, the run-detail
 * panel, the candidates tab, and the URL-driven tab + runId state. Tests that
 * used to render the legacy `<DiscoveryRunDetailView projectId... onClose... />`
 * use `renderDiscoveryRunDetailPage(Component, { runId, architectureId })`
 * instead -- it sets up MemoryRouter+Routes so `useParams` resolves the runId
 * and `useNavigate` / `useSearchParams` are available.
 *
 * Callers still need to vi.mock:
 *   - api/discoveryApi -- the page calls getDiscoveryRuns / getDiscoveryRun /
 *     getDiscoveryCandidateCount / getDiscoveryCandidates / saveApprovedCandidates
 *   - contexts/ArchitectureContext -- must export useActiveArchitectureId,
 *     useArchitectureContext (with `architectures` AND
 *     `invalidateArchitectureModelCache`), and useArchitectureDispatch.
 *   - contexts/ProjectContext -- must export useProject returning the active
 *     project (id + name).
 *   - The CSS module mock (./DiscoveryRunDetailView.module.css) stays as before.
 */

import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';

export interface RenderDiscoveryRunDetailPageOptions {
  projectId?: string;
  architectureId?: string;
  runId?: string;
  initialTab?: 'candidates' | 'findings';
  /**
   * Optional raw query string (e.g. `?findingId=f-1` or `?room=open`) for
   * tests exercising the Spec 2026-06-11 route params. Mutually additive
   * with `initialTab` is NOT supported -- supply the full string yourself
   * when combining params.
   */
  search?: string;
}

export function renderDiscoveryRunDetailPage(
  Component: React.ComponentType,
  opts: RenderDiscoveryRunDetailPageOptions = {},
): RenderResult {
  const projectId = opts.projectId ?? 'proj-1';
  const architectureId = opts.architectureId ?? 'arch-uuid-default';
  const runId = opts.runId ?? 'run-default';
  const tabParam = opts.initialTab === 'findings' ? '?tab=findings' : '';
  const search = opts.search ?? tabParam;
  const url =
    `/projects/${projectId}/architectures/${architectureId}` +
    `/discovery/runs/${runId}${search}`;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/discovery/runs/:runId"
          element={<Component />}
        />
        <Route
          path="/projects/:projectId/architectures/:architectureId/discovery"
          element={<div data-testid="harness-discovery-list" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
