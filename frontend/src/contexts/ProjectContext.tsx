/**
 * Project Context
 *
 * Spec 2026-01-05: Project Model with Active Project
 *
 * Provides active project state and refresh function to the application.
 * On app initialization, calls getActiveProject() API and stores result.
 * When activeProject is null, roadmap-related features should show appropriate messaging.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Added clearActiveProject function and useClearActiveProject hook.
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 4: ProjectContext with Source Tracking
 * - Added ProjectSource type ('db' | 'session' | 'none')
 * - Added activeProjectSource state
 * - Updated initialization to use mode-aware loading
 * - Created useActiveProjectSource hook
 *
 * Spec 2026-01-26: Activate Project on Open
 * - Added setActiveProject method and useSetActiveProject hook
 * - Allows direct state update from POST /activate response
 * - Updated refreshActiveProject for File Mode resilience
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { getActiveProject, ProjectDto } from '../api/projectsApi';
import { getSessionProject } from '../api/projectSessionApi';
import { useIncludeDatabase } from './AppConfigContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2.4
// setActiveProject additionally navigates to `/projects/<id>` so the URL
// reflects the active project; <ProjectLayout> then resolves the
// :architectureId via its missing-arch redirect.
import { useNavigate } from 'react-router-dom';

// ============================================================================
// Context Types
// ============================================================================

/**
 * Spec 2026-01-22: Source tracking for active project.
 * - 'db': Project loaded from database (includeDatabase=true)
 * - 'session': Project loaded from session (includeDatabase=false)
 * - 'none': No project loaded
 */
export type ProjectSource = 'db' | 'session' | 'none';

/**
 * Context type providing active project state and refresh function.
 *
 * Spec 2026-01-10: Added clearActiveProject function
 * Spec 2026-01-22: Added activeProjectSource for source tracking
 * Spec 2026-01-26: Added setActiveProject function
 */
interface ProjectContextType {
  /** The currently active project, or null if none */
  activeProject: ProjectDto | null;
  /** The source of the active project */
  activeProjectSource: ProjectSource;
  /** Whether the initial load is in progress */
  loading: boolean;
  /** Function to refresh the active project from the API */
  refreshActiveProject: () => Promise<void>;
  /** Function to clear the active project (set to null) */
  clearActiveProject: () => void;
  /**
   * Set the active project directly from a DTO.
   * Used after successful POST /activate to avoid extra GET call.
   * Spec 2026-01-26: Activate Project on Open
   */
  setActiveProject: (project: ProjectDto) => void;
}

// ============================================================================
// Context and Provider
// ============================================================================

// Exported so the shared test harness (src/test-utils/renderWithProviders.tsx)
// can supply a synchronous stub value without mounting the async
// AppConfig/Project provider chain. Application code should keep using
// <ProjectProvider> and the hooks below.
export const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

/**
 * Props for ProjectProvider component.
 */
interface ProjectProviderProps {
  children: ReactNode;
}

/**
 * ProjectProvider component.
 *
 * Wraps the application and provides active project state.
 * Calls appropriate API based on includeDatabase mode on mount.
 *
 * Spec 2026-01-22: Mode-aware initialization
 * - If includeDatabase=true: calls getActiveProject(), sets source to 'db' or 'none'
 * - If includeDatabase=false: calls getSessionProject(), sets source to 'session' or 'none'
 *
 * Spec 2026-01-26: Added setActiveProject for direct state updates
 */
export function ProjectProvider({ children }: ProjectProviderProps) {
  const [activeProject, setActiveProjectState] = useState<ProjectDto | null>(null);
  const [activeProjectSource, setActiveProjectSource] = useState<ProjectSource>('none');
  const [loading, setLoading] = useState<boolean>(true);
  const includeDatabase = useIncludeDatabase();
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 2.4
  // useNavigate is used by setActiveProject to reflect the project switch in
  // the URL. ProjectProvider is mounted inside <BrowserRouter> in App.tsx.
  const navigate = useNavigate();

  /**
   * Set the active project directly from a DTO.
   * Used after successful POST /activate to avoid extra GET call.
   *
   * Spec 2026-01-26: Activate Project on Open
   *
   * Spec 2026-05-02: Additionally navigates to `/projects/<id>` so the URL
   * is the source of truth for the active project. The :architectureId
   * segment is resolved by <ProjectLayout>'s missing-arch redirect (which
   * picks the project's oldest non-archived architecture and replaces the
   * URL with the canonical form). Public hook surface unchanged.
   *
   * @param project - The project DTO to set as active
   */
  const setActiveProject = useCallback((project: ProjectDto) => {
    setActiveProjectState(project);
    setActiveProjectSource(includeDatabase ? 'db' : 'session');
    // Reflect the active project in the URL. <ProjectLayout> redirects to
    // the canonical /projects/:projectId/architectures/:architectureId/dashboard
    // shape using the project's oldest non-archived architecture.
    if (project?.id) {
      navigate(`/projects/${project.id}`);
    }
  }, [includeDatabase, navigate]);

  /**
   * Refreshes the active project from the API.
   * Updates state with the result (may be null if no active project).
   *
   * Spec 2026-01-22: Mode-aware refresh
   * - In DB mode: call getActiveProject()
   * - In no-DB mode: call getSessionProject()
   *
   * Spec 2026-01-26: File Mode resilience
   * - In File Mode, 404 is expected when no project has been imported
   * - Gracefully handles 404 by preserving current state instead of clearing
   */
  const refreshActiveProject = useCallback(async () => {
    try {
      if (includeDatabase) {
        const project = await getActiveProject();
        setActiveProjectState(project);
        setActiveProjectSource(project ? 'db' : 'none');
      } else {
        // File Mode: Try session endpoint, but don't fail if 404
        try {
          const project = await getSessionProject();
          setActiveProjectState(project);
          setActiveProjectSource(project ? 'session' : 'none');
        } catch (error) {
          // Spec 2026-01-26: In File Mode, 404 is expected if no project imported
          // Just log debug message and preserve current state - don't clear it
          console.debug('No session project in File Mode (expected when no project imported)');
          // Don't modify state - preserve whatever was set via setActiveProject
        }
      }
    } catch (error) {
      console.error('Failed to fetch active project:', error);
      // Keep current state on error, don't set to null
      // This prevents losing state on transient network errors
    }
  }, [includeDatabase]);

  /**
   * Clears the active project by setting it to null.
   *
   * Spec 2026-01-10: Project Menu + Delete Project
   * Used when the active project is deleted.
   *
   * Spec 2026-01-22: Also resets source to 'none'
   */
  const clearActiveProject = useCallback(() => {
    setActiveProjectState(null);
    setActiveProjectSource('none');
  }, []);

  /**
   * Initialize active project state on mount.
   *
   * Spec 2026-01-22: Mode-aware initialization
   */
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        if (includeDatabase) {
          // DB mode: load from /api/projects/active
          const project = await getActiveProject();
          setActiveProjectState(project);
          setActiveProjectSource(project ? 'db' : 'none');
        } else {
          // No-DB mode: load from /api/project-session
          // Spec 2026-01-26: Gracefully handle 404 in File Mode during init
          try {
            const project = await getSessionProject();
            setActiveProjectState(project);
            setActiveProjectSource(project ? 'session' : 'none');
          } catch (initError) {
            // In File Mode, 404 is expected if no project has been imported yet
            console.debug('No session project on init in File Mode (expected)');
            setActiveProjectState(null);
            setActiveProjectSource('none');
          }
        }
      } catch (error) {
        console.error('Failed to fetch active project on init:', error);
        setActiveProjectState(null);
        setActiveProjectSource('none');
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [includeDatabase]);

  return (
    <ProjectContext.Provider value={{
      activeProject,
      activeProjectSource,
      loading,
      refreshActiveProject,
      clearActiveProject,
      setActiveProject,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

// ============================================================================
// Custom Hooks
// ============================================================================

/**
 * Hook to get the active project from context.
 *
 * @returns The active project or null if none
 * @throws Error if used outside ProjectProvider
 */
export function useProject(): ProjectDto | null {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context.activeProject;
}

/**
 * Hook to get the active project source from context.
 *
 * Spec 2026-01-22: Explicit Project Session API
 *
 * @returns The source of the active project ('db', 'session', or 'none')
 * @throws Error if used outside ProjectProvider
 */
export function useActiveProjectSource(): ProjectSource {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useActiveProjectSource must be used within a ProjectProvider');
  }
  return context.activeProjectSource;
}

/**
 * Hook to get the project context loading state.
 *
 * @returns True if the initial project load is in progress
 * @throws Error if used outside ProjectProvider
 */
export function useProjectLoading(): boolean {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProjectLoading must be used within a ProjectProvider');
  }
  return context.loading;
}

/**
 * Hook to get the refreshActiveProject function from context.
 *
 * @returns Function to refresh active project
 * @throws Error if used outside ProjectProvider
 */
export function useRefreshActiveProject(): () => Promise<void> {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useRefreshActiveProject must be used within a ProjectProvider');
  }
  return context.refreshActiveProject;
}

/**
 * Hook to get the clearActiveProject function from context.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 *
 * @returns Function to clear active project (set to null)
 * @throws Error if used outside ProjectProvider
 */
export function useClearActiveProject(): () => void {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useClearActiveProject must be used within a ProjectProvider');
  }
  return context.clearActiveProject;
}

/**
 * Hook to get the setActiveProject function from context.
 *
 * Spec 2026-01-26: Activate Project on Open
 *
 * Used to set active project directly from POST /activate response,
 * avoiding an extra GET call.
 *
 * @returns Function to set active project directly
 * @throws Error if used outside ProjectProvider
 */
export function useSetActiveProject(): (project: ProjectDto) => void {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useSetActiveProject must be used within a ProjectProvider');
  }
  return context.setActiveProject;
}

/**
 * Hook to get the full project context.
 *
 * @returns The complete project context
 * @throws Error if used outside ProjectProvider
 */
export function useProjectContext(): ProjectContextType {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProjectContext must be used within a ProjectProvider');
  }
  return context;
}
