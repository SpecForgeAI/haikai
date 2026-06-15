/**
 * Migration Discovery Context proxy route.
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 2 (D6).
 *
 * Provides a single project-scoped proxy:
 *   POST /api/v1/projects/:projectId/migration-discovery-context
 *
 * Thin pass-through to the architecture-model-service aggregation endpoint
 * `POST /api/projects/{projectId}/migration-discovery-context`. The request
 * body is forwarded verbatim and the AMS response (status + body) is re-emitted
 * byte-for-byte so callers (the new api-migration-validation-service, the
 * frontend capture wizard pre-fetch, future migration-planning workflows) can
 * pass `discoveryRunIds`, `apiBehaviourBaselineIds`, include flags, and limits
 * without a gateway-side transformation layer in the middle.
 *
 * No business logic lives here: the no-parameter "latest relevant" view goes
 * through the dedicated `MigrationDiscoveryContextResolver` in
 * `gateway/src/services/contextResolvers.ts`; this proxy is for parameter-rich
 * callers per shaping decision D6.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  fetchMigrationDiscoveryContext,
  MigrationDiscoveryContextRequest,
} from '../services/migrationDiscoveryContextClient';
import { ArchitectureModelHttpError } from '../services/architectureModelClient';

export const migrationContextRouter = Router();

/**
 * POST /api/v1/projects/:projectId/migration-discovery-context
 *
 * Forwards the request body verbatim to AMS and pipes the upstream status +
 * body back to the caller. AMS errors round-trip byte-for-byte (404 when
 * `currentArchitectureId` does not belong to `projectId`, 400 on validation
 * failure, 422 on AMS business-rule failure, etc.).
 *
 * On network / fetch failure returns a 503 with the structured error envelope
 * the rest of the gateway uses, matching `architectures.ts` conventions.
 */
migrationContextRouter.post(
  '/projects/:projectId/migration-discovery-context',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId } = req.params;

    const body = (req.body ?? {}) as MigrationDiscoveryContextRequest;

    const start = Date.now();
    try {
      const result = await fetchMigrationDiscoveryContext(projectId, body);
      console.log(
        `[diag-gw] route=migration-discovery-context status=200 ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ArchitectureModelHttpError) {
        logger.warn('Migration discovery context proxy: upstream returned non-OK', {
          requestId,
          projectId,
          status: error.status,
        });
        console.warn(
          `[diag-gw] route=migration-discovery-context status=${error.status} ` +
            `elapsed_ms=${Date.now() - start}`,
        );
        res.status(error.status);
        if (error.body === null || error.body === undefined) {
          res.end();
        } else if (typeof error.body === 'string') {
          res.send(error.body);
        } else {
          res.json(error.body);
        }
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration discovery context proxy: upstream fetch failed', {
        requestId,
        projectId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-discovery-context status=503 ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
          details: message,
        },
      });
    }
  }
);
