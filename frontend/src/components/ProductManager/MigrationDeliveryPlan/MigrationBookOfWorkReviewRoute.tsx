/**
 * MigrationBookOfWorkReviewRoute
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Follow-up wiring (2026-06-03): mount the already-built (but never-routed)
 * review surface behind a production route.
 *
 * Architecture-scoped router entry for the Migration Delivery Plan review
 * workspace. Mounted under the architecture-scoped tree in `App.tsx`,
 * mirroring `SpecGenerationWorkspaceRoute` / `MigrationDeliveryDashboardRoute`:
 *
 *   /projects/:projectId
 *     /architectures/:architectureId
 *       /migration-books-of-work/:bookId/review
 *
 * Route params (from `useParams()`):
 *   - projectId        — project UUID
 *   - architectureId   — active architecture UUID (used only for the
 *                        back-to-backlog navigation target; the review
 *                        workspace itself is project-scoped)
 *   - bookId           — the GeneratedMigrationBookOfWork draft id
 *
 * The route lives under `architectures/:architectureId` because
 * `ProjectLayout` silently redirects any project-scoped URL that lacks an
 * architecture segment. We accept the indirection (and let the caller pass
 * the active architecture) rather than restructuring `ProjectLayout` — the
 * same rationale the spec-generation + delivery-dashboard routes record.
 *
 * The wrapped `MigrationBookOfWorkReviewWorkspace` loads the draft itself via
 * `getMigrationBookOfWork(projectId, bookId)` and owns the full
 * review/select/save-to-backlog experience; this wrapper only supplies the
 * route params and the `onOpenBacklog` navigation callback exposed by the
 * post-save view.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { MigrationBookOfWorkReviewWorkspace } from './MigrationBookOfWorkReviewWorkspace';
// Phase 1b: the execution rail needs the orchestration scope — company =
// organisation NAME, project = active project name; resolved exactly as the
// delivery-dashboard route does (fail-soft; missing scope only disables Start).
import { useProject } from '../../../contexts/ProjectContext';
import { getOrganisationById } from '../../../api/organisationsApi';
import { getProjectById } from '../../../api/projectsApi';

export function MigrationBookOfWorkReviewRoute() {
  const { projectId, architectureId, bookId } = useParams<{
    projectId: string;
    architectureId: string;
    bookId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeProject = useProject();
  // Phase 1c: deep links that used to open the standalone spec-generation
  // workspace's drawer now auto-select the story here (?workItemId=...).
  const initialSelectedWorkItemId = searchParams.get('workItemId') ?? undefined;

  const [company, setCompany] = useState<string>('');
  const [project, setProject] = useState<string>('');
  // Spec 2026-07-23: WHY the scope failed — surfaced under the (visibly
  // disabled) Start button. Pre-fix a failed organisation resolution left the
  // button silently disabled while it rendered fully active: clicking it did
  // nothing, with no dialog, no network call and no console error.
  const [scopeHint, setScopeHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const derive = async () => {
      // Scope source: the in-memory active-project context, FALLING BACK to a
      // fetch by the URL's projectId (2026-07-26 fix). The context is only
      // hydrated by opening the project from the projects list, so a reload /
      // deep link onto this route used to dead-end on "Project context is not
      // loaded" with a disabled Start button — despite the project id sitting
      // right in the URL.
      let scopeProject: { name?: string | null; organisationId?: string | null } | null =
        activeProject;
      if (!scopeProject && projectId) {
        try {
          scopeProject = await getProjectById(projectId);
        } catch {
          scopeProject = null;
        }
      }
      const projectName = scopeProject?.name || projectId || '';
      if (!cancelled) setProject(projectName);
      if (!scopeProject) {
        if (!cancelled) {
          setCompany('');
          setScopeHint(
            'Project context could not be resolved — the active-project ' +
              'context is empty and the project lookup by id failed, so the ' +
              'run scope (organisation + project name) is unavailable. Check ' +
              'the projects service, then reload.',
          );
        }
        return;
      }
      if (!scopeProject.organisationId) {
        if (!cancelled) {
          setCompany('');
          setScopeHint(
            'This project has no organisation link, so the run scope ' +
              '(organisation + project name) cannot be resolved. Set the ' +
              "project's organisation, then reload.",
          );
        }
        return;
      }
      try {
        const organisation = await getOrganisationById(
          scopeProject.organisationId,
        );
        if (!cancelled) {
          const name = organisation?.name ?? '';
          setCompany(name);
          setScopeHint(
            name
              ? null
              : `Organisation ${scopeProject.organisationId} has no name — ` +
                  'the run scope needs it. Fix the organisation record, then reload.',
          );
        }
      } catch {
        if (!cancelled) {
          setCompany('');
          setScopeHint(
            `Organisation lookup failed (id ${scopeProject.organisationId}) — ` +
              'the run scope needs the organisation name. Check the ' +
              'organisations service, then reload.',
          );
        }
      }
    };
    void derive();
    return () => {
      cancelled = true;
    };
  }, [activeProject, projectId]);

  if (!projectId || !architectureId || !bookId) {
    return null;
  }

  const archScopedPrefix = `/projects/${projectId}/architectures/${architectureId}`;

  return (
    <MigrationBookOfWorkReviewWorkspace
      projectId={projectId}
      bookId={bookId}
      onOpenBacklog={() => navigate(`${archScopedPrefix}/product/backlog`)}
      onBackToPlans={() =>
        navigate(`${archScopedPrefix}/migration-delivery-plan`)
      }
      initialSelectedWorkItemId={initialSelectedWorkItemId}
      companyName={company || undefined}
      projectName={project || undefined}
      scopeHint={scopeHint}
      activeArchitectureId={architectureId}
      onOpenDelivery={() =>
        navigate(
          `${archScopedPrefix}/migration-books-of-work/${bookId}/delivery`,
        )
      }
      onOpenProgress={() =>
        navigate(
          `${archScopedPrefix}/migration-books-of-work/${bookId}/progress`,
        )
      }
    />
  );
}

export default MigrationBookOfWorkReviewRoute;
