import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { saveDiscoveryCandidatesToModel } from '../services/candidateSaveBackService';

/**
 * UUID v4 regex pattern for projectId, architectureId, and runId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the save_approved_candidates MCP tool endpoint.
 * Mounts at /mcp/tools/save_approved_candidates
 *
 * This is a convenience endpoint that calls saveDiscoveryCandidatesToModel
 * with mode = 'manual', selecting only candidates with review_status === 'approved'.
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 3: Save-Approved Backend Endpoint
 *
 * Multi-architecture migration (2026-05-11): the route now requires an
 * architectureId in the request body and forwards it into the save-back
 * orchestration so the resulting model PUT lands on the correct
 * (project, architecture) pair. The gateway proxy at
 * gateway/src/routes/discovery.ts (POST .../save-approved) already supplies
 * this field.
 */
export const saveApprovedCandidatesRouter = Router();

/**
 * POST /
 *
 * Saves all approved discovery candidates from a run into the canonical
 * architecture meta-model. Uses manual mode which selects only candidates
 * with review_status === 'approved', ignoring confidence threshold.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - architectureId: string (required, UUID v4)
 *   - runId: string (required, UUID v4)
 *
 * Response:
 *   - { projectId, runId, entitiesCreated, entitiesSkipped, candidatesCommitted }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveApprovedCandidatesRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, runId, commit } = req.body;

      // ====================================================================
      // Request Validation
      // ====================================================================

      // Validate sessionId (required, non-empty string)
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate projectId (required, must match UUID v4 regex)
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }

      // Validate architectureId (required, must match UUID v4 regex).
      // Loud-failure contract: the discovery save-back flow cannot fall back
      // to a default architectureId -- doing so corrupts cross-architecture
      // model_files when a project has multiple architectures.
      if (!architectureId || typeof architectureId !== 'string' || !UUID_V4_REGEX.test(architectureId)) {
        throw createHttpError(400, 'architectureId is required and must be a valid UUID');
      }

      // Validate runId (required, must match UUID v4 regex)
      if (!runId || typeof runId !== 'string' || !UUID_V4_REGEX.test(runId)) {
        throw createHttpError(400, 'runId is required and must be a valid UUID');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service with manual mode
      // ====================================================================

      // `commit === false` (forwarded from the gateway dry-run flag) runs the
      // resolution as a PROJECTION ONLY -- no model PUT, no candidate transition,
      // no findings write -- so the C1 remediation panel can PREVIEW what would
      // commit (Spec 2026-06-20 skipped-candidate-visibility-bulk-fill). Defaults
      // to a real commit when the flag is absent.
      const response = await saveDiscoveryCandidatesToModel(projectId, architectureId, runId, 'manual', commit !== false);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_approved_candidates] Success', {
        projectId,
        architectureId,
        runId,
        entitiesCreated: response.entitiesCreated,
        entitiesSkipped: response.entitiesSkipped,
        candidatesCommitted: response.candidatesCommitted,
      });

      res.json(response);
    } catch (error: any) {
      // Handle 400 validation errors
      if (error.statusCode === 400) {
        res.status(400).json({
          error: {
            code: 400,
            message: error.message,
          },
        });
        return;
      }

      // Handle 502 upstream failures
      if (error.statusCode === 502) {
        console.error('[save_approved_candidates] Upstream failure', {
          error: error.message,
        });
        res.status(502).json({
          error: {
            code: 502,
            message: error.message,
          },
        });
        return;
      }

      next(error);
    }
  }
);
