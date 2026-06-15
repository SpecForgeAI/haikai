/**
 * useNavigateToView
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 *
 * Returns a stable callback that navigates to a target view on the canonical
 * architecture-scoped URL. Replaces the removed `dispatch({ type: 'SET_VIEW' })`
 * code path.
 *
 * Resolution rules:
 *   - The active project id is taken from `useParams().projectId`, falling
 *     back to the active project from `useProject()` (covers call sites that
 *     dispatch from outside an architecture-scoped route).
 *   - The active architecture id is read from `useActiveArchitectureId()`
 *     (which is itself URL-derived).
 *   - If either id is missing, the callback no-ops and logs a warning. This
 *     should not happen in practice once Task Group 4 is wired -- every
 *     screen that previously dispatched SET_VIEW already required an active
 *     project and architecture.
 *
 * Optional `query` parameter mirrors the `?tab=...` use cases that previously
 * combined a SET_VIEW dispatch with a `window.history.pushState`.
 */

import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useActiveArchitectureId } from '../contexts/ArchitectureContext';
import type { CurrentView } from './useCurrentView';

export function buildArchitectureScopedUrl(
  projectId: string,
  architectureId: string,
  view: CurrentView,
  query?: string
): string {
  const base = `/projects/${projectId}/architectures/${architectureId}/${view}`;
  if (!query) return base;
  return query.startsWith('?') ? `${base}${query}` : `${base}?${query}`;
}

export function useNavigateToView(): (
  view: CurrentView,
  query?: string
) => void {
  const navigate = useNavigate();
  const params = useParams();
  const activeProject = useProject();
  const activeArchitectureId = useActiveArchitectureId();

  return useCallback(
    (view: CurrentView, query?: string) => {
      const projectId = params.projectId ?? activeProject?.id;
      const architectureId = params.architectureId ?? activeArchitectureId;
      if (!projectId || !architectureId) {
        console.warn(
          `[useNavigateToView] Cannot navigate to "${view}" -- missing projectId or architectureId (project=${projectId ?? 'null'}, architecture=${architectureId ?? 'null'}).`
        );
        return;
      }
      navigate(buildArchitectureScopedUrl(projectId, architectureId, view, query));
    },
    [navigate, params.projectId, params.architectureId, activeProject, activeArchitectureId]
  );
}
