/**
 * Shared test harness helpers.
 *
 * Production navigation moved to react-router (spec 2026-05-02 / 2026-05-04:
 * useNavigate replaces the SET_VIEW dispatch), so any component that calls
 * useNavigate()/useLocation()/useParams() must be rendered inside a Router.
 * Similarly, useActiveArchitectureId/useProject/useTemporaryDiagramContext
 * require their providers.
 *
 * This module gives tests composable wrappers:
 *
 * - renderWithRouter(ui, { initialEntries })
 *     MemoryRouter only. Use when the test already mocks the context hooks
 *     (the common pattern in Grid/TopBar/DashboardView suites) and only the
 *     Router was missing.
 *
 * - renderWithProviders(ui, { initialEntries, project, withArchitecture,
 *   withTemporaryDiagram })
 *     MemoryRouter > ProjectContext (synchronous stub value)
 *     > ArchitectureProvider (real) > TemporaryDiagramProvider (real).
 *     The ProjectContext is stubbed rather than mounted via the real
 *     <ProjectProvider> because the real chain requires <AppConfigProvider>,
 *     which blocks its first render on an async /api/bootstrap fetch and
 *     breaks synchronous render assertions.
 *
 * - createProvidersWrapper(options)
 *     The same provider stack as a wrapper component, for
 *     renderHook(cb, { wrapper }).
 *
 * The active architecture id is URL-derived (parsed from the pathname), so
 * tests that need a non-null useActiveArchitectureId() should pass an
 * architecture-scoped route, e.g.
 *   initialEntries: ['/projects/p1/architectures/arch-1/dashboard']
 */
import React, { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectContext } from '../contexts/ProjectContext';
import { ArchitectureProvider } from '../contexts/ArchitectureContext';
import { TemporaryDiagramProvider } from '../contexts/TemporaryDiagramContext';
import type { ProjectDto } from '../api/projectsApi';

// ============================================================================
// Project context stub
// ============================================================================

type ProjectContextValue = NonNullable<React.ContextType<typeof ProjectContext>>;

/**
 * Build a minimal valid ProjectDto for tests.
 */
export function makeTestProject(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: 'proj-1',
    name: 'Test Project',
    projectParentFolder: '/tmp/test-project',
    projectHierarchy: null,
    organisationId: null,
    repoUrl: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    perStoryContextTokenCap: null,
    crossStoryContextTokenCap: null,
    autoRunPass2: null,
    ...overrides,
  } as ProjectDto;
}

/**
 * Build a synchronous ProjectContext value. Pass a project (or null for the
 * "no active project" state) plus any function overrides.
 */
export function makeProjectContextValue(
  project: ProjectDto | null = null,
  overrides: Partial<ProjectContextValue> = {}
): ProjectContextValue {
  return {
    activeProject: project,
    activeProjectSource: project ? 'db' : 'none',
    loading: false,
    refreshActiveProject: async () => {},
    clearActiveProject: () => {},
    setActiveProject: () => {},
    ...overrides,
  };
}

// ============================================================================
// Wrapper factory
// ============================================================================

export interface ProvidersOptions {
  /** Initial router history entries. Defaults to ['/']. */
  initialEntries?: string[];
  /** Active project exposed via ProjectContext. Defaults to null. */
  project?: ProjectDto | null;
  /** Extra overrides for the ProjectContext value (e.g. spy functions). */
  projectContextOverrides?: Partial<ProjectContextValue>;
  /** Mount the real ArchitectureProvider. Defaults to true. */
  withArchitecture?: boolean;
  /** Mount the real TemporaryDiagramProvider. Defaults to true. */
  withTemporaryDiagram?: boolean;
}

/**
 * Create a wrapper component mounting MemoryRouter + ProjectContext stub +
 * (optionally) the real ArchitectureProvider and TemporaryDiagramProvider.
 * Suitable for render(ui, { wrapper }) and renderHook(cb, { wrapper }).
 */
export function createProvidersWrapper(
  options: ProvidersOptions = {}
): React.FC<{ children: ReactNode }> {
  const {
    initialEntries = ['/'],
    project = null,
    projectContextOverrides = {},
    withArchitecture = true,
    withTemporaryDiagram = true,
  } = options;

  const projectValue = makeProjectContextValue(project, projectContextOverrides);

  return function ProvidersWrapper({ children }: { children: ReactNode }) {
    let tree = <>{children}</>;
    if (withTemporaryDiagram) {
      tree = <TemporaryDiagramProvider>{tree}</TemporaryDiagramProvider>;
    }
    if (withArchitecture) {
      tree = <ArchitectureProvider>{tree}</ArchitectureProvider>;
    }
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ProjectContext.Provider value={projectValue}>{tree}</ProjectContext.Provider>
      </MemoryRouter>
    );
  };
}

// ============================================================================
// render helpers
// ============================================================================

export interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
}

/**
 * Render inside a MemoryRouter only. Use when the test mocks its context
 * hooks and just needs useNavigate()/useLocation() to resolve.
 */
export function renderWithRouter(
  ui: ReactElement,
  { initialEntries = ['/'], ...renderOptions }: RenderWithRouterOptions = {}
): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    ),
    ...renderOptions,
  });
}

export interface RenderWithProvidersOptions
  extends ProvidersOptions, Omit<RenderOptions, 'wrapper'> {}

/**
 * Render inside the full provider stack (Router + Project + Architecture +
 * TemporaryDiagram). Opt out of individual providers via options.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderResult {
  const {
    initialEntries,
    project,
    projectContextOverrides,
    withArchitecture,
    withTemporaryDiagram,
    ...renderOptions
  } = options;
  return render(ui, {
    wrapper: createProvidersWrapper({
      initialEntries,
      project,
      projectContextOverrides,
      withArchitecture,
      withTemporaryDiagram,
    }),
    ...renderOptions,
  });
}
