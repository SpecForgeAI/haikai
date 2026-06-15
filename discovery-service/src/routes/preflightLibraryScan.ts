/**
 * Preflight Library Scan routes
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 5.3.
 *
 * Two new POST handlers:
 *   - `/projects/:p/architectures/:a/services/:serviceId/preflight-library-scan`
 *   - `/projects/:p/architectures/:a/libraries/:libraryId/preflight-library-scan`
 *
 * Both clone the repo (or reuse a cached preflight clone), build the
 * lookup table via {@link buildRepoLookupTable}, run the BFS walker with
 * a read-only client (no DB writes), and return the {@link ScanPlan}
 * JSON. Preflight is side-effect-free — no `discovery_runs` row is
 * created, no Library / CodeUnitDependency rows are written.
 *
 * For "new" Libraries that do not yet exist, the read-only client
 * returns `library_id: null` so the modal can display them as
 * "will-be-created"; the actual run resolves the row on insert via the
 * write-enabled walker client.
 */

import { Router, Request, Response } from 'express';
import { archModelClient } from '../services/archModelClient';
import { buildRepoLookupTable } from '../services/repoLookupTableBuilder';
import {
  planLibraryScan,
  WalkerArchClient,
  WalkerLibraryPayload,
  WalkerLibraryResult,
  WalkerRootEntity,
} from '../services/transitiveDependencyWalker';
import { getOrClonePreflightRepo } from '../services/preflightCachedClone';
import { normalizeRepoLocation, normalizeRepoSubfolder } from '../services/repoAccess';

// Side-effect import to ensure resolvers are registered when this module loads.
import '../services/dependencyResolvers/register';

const preflightLibraryScanRouter = Router({ mergeParams: true });

/**
 * Picks the ecosystem for a Service / Library based on its core_tech /
 * ecosystem field. V1 supports MAVEN + NPM only; everything else
 * defaults to MAVEN with a logged warning.
 */
function inferEcosystem(
  hint: string | null | undefined,
): 'MAVEN' | 'NPM' {
  if (!hint) return 'MAVEN';
  const h = hint.toLowerCase();
  if (h.includes('npm') || h.includes('typescript') || h.includes('javascript') || h.includes('node')) {
    return 'NPM';
  }
  if (h.includes('maven') || h.includes('java')) return 'MAVEN';
  return 'MAVEN';
}

/**
 * Read-only walker arch-client used by preflight: returns no row ids,
 * never calls the architecture-model-service. Idempotent — every call
 * returns `{library_id: null, application_point_id: null, is_new: true}`.
 *
 * Note: The walker still passes `application_point_id` from the parent
 * to record edges; preflight returns null target ids so edges are
 * accumulated only as plan entries (never written). `findOrCreateCodeUnitDependency`
 * is called by the walker but our no-op implementation is safe.
 */
const READ_ONLY_CLIENT: WalkerArchClient = {
  async findOrCreateLibrary(_payload: WalkerLibraryPayload): Promise<WalkerLibraryResult> {
    return { library_id: null, application_point_id: null, is_new: true };
  },
  async findOrCreateCodeUnitDependency() {
    return { id: null, is_new: true };
  },
};

// ---------------------------------------------------------------------------
// Service-rooted preflight
// ---------------------------------------------------------------------------

preflightLibraryScanRouter.post(
  '/projects/:projectId/architectures/:architectureId/services/:serviceId/preflight-library-scan',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, architectureId, serviceId } = req.params as {
      projectId: string;
      architectureId: string;
      serviceId: string;
    };
    const includeExternal = req.body?.includeExternal !== false; // default ON.

    try {
      const service = await archModelClient.getService(projectId, architectureId, serviceId);
      if (!service) {
        res.status(404).json({
          error: { code: 404, message: `Service ${serviceId} not found` },
        });
        return;
      }
      const repoLocationRaw = service.repo_location;
      if (!repoLocationRaw) {
        res.status(400).json({
          error: { code: 400, message: `Service '${service.name}' has no repo_location configured.` },
        });
        return;
      }
      const repoLocation = normalizeRepoLocation(repoLocationRaw);
      const repoSubfolder = service.repo_subfolder
        ? normalizeRepoSubfolder(service.repo_subfolder)
        : '';
      const branch = 'main';

      const repoDir = await getOrClonePreflightRepo(projectId, repoLocation, branch);
      const lookup = await buildRepoLookupTable(repoDir);

      const ecosystem = inferEcosystem(service.core_tech);
      // Service-rooted: walker uses a synthetic application point id so
      // edges from the root carry the service's existing AP id.
      // Discovery-service does not yet have a derived-AP id on the
      // ServiceResponseDto — we use `service:<serviceId>` as a stable
      // placeholder; the actual run path will resolve the AP id.
      const root: WalkerRootEntity = {
        kind: 'service',
        id: serviceId,
        name: service.name,
        applicationPointId: `service:${serviceId}`,
        ecosystem,
        repo_location: repoLocation,
        repo_subfolder: repoSubfolder,
      };

      const plan = await planLibraryScan(root, repoDir, lookup, includeExternal, READ_ONLY_CLIENT);
      res.status(200).json(plan);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[preflightLibraryScan:service]', msg);
      res.status(500).json({
        error: { code: 500, message: `Preflight failed: ${msg}` },
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Library-rooted preflight
// ---------------------------------------------------------------------------

preflightLibraryScanRouter.post(
  '/projects/:projectId/architectures/:architectureId/libraries/:libraryId/preflight-library-scan',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, architectureId, libraryId } = req.params as {
      projectId: string;
      architectureId: string;
      libraryId: string;
    };
    const includeExternal = req.body?.includeExternal !== false; // default ON.

    try {
      const library = await archModelClient.getLibrary(projectId, architectureId, libraryId);
      if (!library) {
        res.status(404).json({
          error: { code: 404, message: `Library ${libraryId} not found` },
        });
        return;
      }
      if (!library.repo_location) {
        res.status(400).json({
          error: { code: 400, message: `Library '${library.name}' has no repo_location configured.` },
        });
        return;
      }

      const repoLocation = normalizeRepoLocation(library.repo_location);
      const repoSubfolder = library.repo_subfolder
        ? normalizeRepoSubfolder(library.repo_subfolder)
        : '';
      const branch = 'main';

      const repoDir = await getOrClonePreflightRepo(projectId, repoLocation, branch);
      const lookup = await buildRepoLookupTable(repoDir);

      const ecosystem = (library.ecosystem === 'NPM' ? 'NPM' : 'MAVEN') as 'MAVEN' | 'NPM';
      const root: WalkerRootEntity = {
        kind: 'library',
        id: libraryId,
        libraryId,
        name: library.name,
        applicationPointId: `library:${libraryId}`,
        ecosystem,
        repo_location: repoLocation,
        repo_subfolder: repoSubfolder,
      };

      const plan = await planLibraryScan(root, repoDir, lookup, includeExternal, READ_ONLY_CLIENT);
      res.status(200).json(plan);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[preflightLibraryScan:library]', msg);
      res.status(500).json({
        error: { code: 500, message: `Preflight failed: ${msg}` },
      });
    }
  },
);

export { preflightLibraryScanRouter };
