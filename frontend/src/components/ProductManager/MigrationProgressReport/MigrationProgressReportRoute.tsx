/**
 * MigrationProgressReportRoute (2026-08-16)
 *
 * Router entry for the stakeholder progress report. Mounted under the
 * architecture-scoped tree in `App.tsx` (the MigrationDeliveryDashboardRoute
 * precedent):
 *
 *   /projects/:projectId
 *     /architectures/:architectureId
 *       /migration-books-of-work/:bookId/progress
 *
 * The route layer supplies the one thing the presentational report cannot
 * derive: the PRODUCT NAME for the identity line, taken from the active
 * project's display name (the same `useProject()` convention the delivery
 * dashboard route uses for its orchestration scope). Fail-soft: with no
 * active project the project id renders instead — never a blank line.
 */

import { useParams } from 'react-router-dom';
import { useProject } from '../../../contexts/ProjectContext';
import { MigrationProgressReport } from './MigrationProgressReport';

export function MigrationProgressReportRoute() {
  const { projectId, architectureId, bookId } = useParams<{
    projectId: string;
    architectureId: string;
    bookId: string;
  }>();
  const activeProject = useProject();

  if (!projectId || !architectureId || !bookId) {
    return null;
  }

  return (
    <MigrationProgressReport
      projectId={projectId}
      architectureId={architectureId}
      bookId={bookId}
      productName={activeProject?.name || projectId}
    />
  );
}

export default MigrationProgressReportRoute;
