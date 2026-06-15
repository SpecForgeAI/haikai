/**
 * TopBar Test Helpers
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 5: Import/Export Flow Routing
 *
 * Helper functions for testing TopBar import/export routing logic
 * without needing to render the full component.
 */

import { exportActiveProjectSnapshot, importProjectSnapshot, ProjectSnapshotDto } from '../api/projectSnapshotApi';
import { exportSessionSnapshot, importToSession } from '../api/projectSessionApi';

/**
 * Simulates the JSON export logic from TopBar.
 *
 * This mirrors the routing logic in TopBar's executeJsonExport function:
 * - If includeDatabase=true: use exportActiveProjectSnapshot
 * - If includeDatabase=false: use exportSessionSnapshot
 *
 * @param includeDatabase - Whether DB mode is enabled
 * @param projectName - The project name to export
 * @returns Promise resolving to the exported snapshot or null
 */
export async function executeJsonExportForTest(
  includeDatabase: boolean,
  projectName: string
): Promise<ProjectSnapshotDto | null> {
  let snapshot: ProjectSnapshotDto | null;

  if (includeDatabase) {
    // DB mode: use existing endpoint
    snapshot = await exportActiveProjectSnapshot();
  } else {
    // No-DB mode: use session endpoint
    snapshot = await exportSessionSnapshot();
  }

  return snapshot;
}

/**
 * Simulates the import logic from TopBar.
 *
 * This mirrors the routing logic in TopBar/ImportProjectSnapshotModal:
 * - If includeDatabase=true: use importProjectSnapshot
 * - If includeDatabase=false: use importToSession
 *
 * @param includeDatabase - Whether DB mode is enabled
 * @param snapshot - The snapshot to import
 * @returns Promise resolving to the import result
 */
export async function executeImportForTest(
  includeDatabase: boolean,
  snapshot: ProjectSnapshotDto
): Promise<void> {
  const request = {
    snapshot,
    setActive: true,
  };

  if (includeDatabase) {
    // DB mode: use existing endpoint
    await importProjectSnapshot(request);
  } else {
    // No-DB mode: use session endpoint
    await importToSession(request);
  }
}
