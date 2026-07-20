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

  useEffect(() => {
    let cancelled = false;
    const derive = async () => {
      const projectName = activeProject?.name || projectId || '';
      if (!cancelled) setProject(projectName);
      if (!activeProject?.organisationId) {
        if (!cancelled) setCompany('');
        return;
      }
      try {
        const organisation = await getOrganisationById(
          activeProject.organisationId,
        );
        if (!cancelled) setCompany(organisation?.name ?? '');
      } catch {
        if (!cancelled) setCompany('');
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
      onOpenDelivery={() =>
        navigate(
          `${archScopedPrefix}/migration-books-of-work/${bookId}/delivery`,
        )
      }
    />
  );
}

export default MigrationBookOfWorkReviewRoute;
