/**
 * SpecGenerationWorkspaceRoute
 *
 * Spec 2026-05-19: PM Migration Shape-Spec Batch Generation — follow-up
 * Frontend router entry for the spec-generation workspace surface introduced
 * by Spec 2 (Group 9 + 10 + 11). Mounted under the architecture-scoped tree
 * in `App.tsx`:
 *
 *   /projects/:projectId
 *     /architectures/:architectureId
 *       /migration-books-of-work/:bookId/spec-generation
 *
 * Route params (from `useParams()`):
 *   - projectId        — project UUID
 *   - bookId           — saved GeneratedMigrationBookOfWork id
 *
 * Query params (from `useSearchParams()`):
 *   - workItemId       — optional; when present, the workspace auto-opens
 *                        the story result drawer for this WorkItem (the
 *                        drill-back surface invoked from the WorkItem
 *                        Implement-tab `ImplementTabShapeSpecCard`).
 *
 * The route lives under `architectures/:architectureId` because
 * `ProjectLayout` silently redirects any project-scoped URL that lacks an
 * architecture segment. We accept the indirection (and let the caller pass
 * the active architecture) rather than restructuring `ProjectLayout`.
 */

import { useParams, useSearchParams } from 'react-router-dom';
import { SpecGenerationWorkspace } from './SpecGenerationWorkspace';

export function SpecGenerationWorkspaceRoute() {
  const { projectId, bookId } = useParams<{
    projectId: string;
    bookId: string;
  }>();
  const [searchParams] = useSearchParams();
  const workItemId = searchParams.get('workItemId');

  if (!projectId || !bookId) {
    return null;
  }

  return (
    <SpecGenerationWorkspace
      projectId={projectId}
      bookOfWorkId={bookId}
      initialDrawerWorkItemId={workItemId ?? null}
    />
  );
}

export default SpecGenerationWorkspaceRoute;
