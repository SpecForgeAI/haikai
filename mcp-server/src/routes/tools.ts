import { Router, Request, Response, NextFunction } from 'express';
import { archModelClient } from '../services/archModelClient';
import { getOrCreateSession, updateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import {
  ListInterfacesRequest,
  GetInterfaceContextRequest,
  InterfaceSummaryDto,
} from '../types';
import { computeOasGapsRouter } from './computeOasGapsRoute';
import { saveOasSpecRouter } from './saveOasSpecRoute';
import { saveProductArtifactsRouter } from './saveProductArtifactsRoute';
import { saveArchitectureBaselineRouter } from './saveArchitectureBaselineRoute';
import { saveRoadmapStructureRouter } from './saveRoadmapStructureRoute';
import { saveMarkdownArtifactRouter } from './saveMarkdownArtifactRoute';
import { saveUsersInteractionsRouter } from './saveUsersInteractionsRoute';
import { saveBacklogItemsRouter } from './saveBacklogItemsRoute';
import { saveTemporaryArchitectureDiagramRouter } from './saveTemporaryArchitectureDiagramRoute';
import { saveUserJourneysRouter } from './saveUserJourneysRoute';
import { saveDiscoveryConfigRouter } from './saveDiscoveryConfigRoute';
import { saveDiscoveryRunRouter } from './saveDiscoveryRunRoute';
import { saveProjectAnchorEntitiesRouter } from './saveProjectAnchorEntitiesRoute';
import { saveDiscoveryCandidatesRouter } from './saveDiscoveryCandidatesRoute';
import { saveApprovedCandidatesRouter } from './saveApprovedCandidatesRoute';
import { applyGapMetadataRouter } from './applyGapMetadataRoute';
import { applyEndpointEffectsRouter } from './applyEndpointEffectsRoute';
import { createProjectArtifactRouter } from './createProjectArtifactRoute';

/**
 * Express Router for MCP tool endpoints.
 * Mounts at /mcp/tools
 */
export const toolsRouter = Router();

// Mount the compute_oas_gaps route
toolsRouter.use('/compute_oas_gaps', computeOasGapsRouter);

// Mount the save_oas_spec route
toolsRouter.use('/save_oas_spec', saveOasSpecRouter);

// Mount the save_product_artifacts route
toolsRouter.use('/save_product_artifacts', saveProductArtifactsRouter);

// Mount the save_architecture_baseline route
toolsRouter.use('/save_architecture_baseline', saveArchitectureBaselineRouter);

// Mount the save_roadmap_structure route
toolsRouter.use('/save_roadmap_structure', saveRoadmapStructureRouter);

// Mount the save_markdown_artifact route
toolsRouter.use('/save_markdown_artifact', saveMarkdownArtifactRouter);

// Mount the save_users_interactions route
toolsRouter.use('/save_users_interactions', saveUsersInteractionsRouter);
// Mount the save_backlog_items route
toolsRouter.use('/save_backlog_items', saveBacklogItemsRouter);

// Mount the saveTemporaryArchitectureDiagram route
toolsRouter.use('/saveTemporaryArchitectureDiagram', saveTemporaryArchitectureDiagramRouter);

// Mount the save_user_journeys route
toolsRouter.use('/save_user_journeys', saveUserJourneysRouter);

// Mount the save_discovery_config route
toolsRouter.use('/save_discovery_config', saveDiscoveryConfigRouter);

// Mount the save_discovery_run route
toolsRouter.use('/save_discovery_run', saveDiscoveryRunRouter);

// Mount the save_project_anchor_entities route
toolsRouter.use('/save_project_anchor_entities', saveProjectAnchorEntitiesRouter);

// Mount the save_discovery_candidates_to_model route
toolsRouter.use('/save_discovery_candidates_to_model', saveDiscoveryCandidatesRouter);

// Mount the save_approved_candidates route (Increment 13: manual save-back for approved candidates)
toolsRouter.use('/save_approved_candidates', saveApprovedCandidatesRouter);

// Mount the apply_gap_metadata route (Spec 4 — LLM gap-proposal queue,
// 2026-08-04: additive fk_columns / primary-key metadata apply on approve)
toolsRouter.use('/apply_gap_metadata', applyGapMetadataRouter);

// Mount the apply_endpoint_effects route (Effect-map backfill, 2026-08-20:
// additive endpoint -> write-table effect edges, corpus-derived or approved
// LLM proposals; the table-name resolution is the hallucination guard)
toolsRouter.use('/apply_endpoint_effects', applyEndpointEffectsRouter);

// Mount the create_project_artifact route
toolsRouter.use('/create_project_artifact', createProjectArtifactRouter);

/**
 * POST /mcp/tools/list_interfaces
 *
 * Lists all interfaces for a given model filename.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - filename: string (required)
 *
 * Response:
 *   - { interfaces: InterfaceSummaryDto[] }
 *
 * Session effects:
 *   - Stores filename in session
 *   - Stores lastListedInterfaces in session
 */
toolsRouter.post(
  '/list_interfaces',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, filename } = req.body as ListInterfacesRequest;

      // Validate required fields
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      if (!filename || typeof filename !== 'string' || filename.trim() === '') {
        throw createHttpError(400, 'filename is required and must be a non-empty string');
      }

      // Get or create session
      getOrCreateSession(sessionId);

      // Call backend service
      const interfaces: InterfaceSummaryDto[] = await archModelClient.listInterfaces(filename);

      // Update session with filename and listed interfaces
      updateSession(sessionId, {
        filename,
        lastListedInterfaces: interfaces,
      });

      // Return response
      res.json({ interfaces });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /mcp/tools/get_interface_oas_context
 *
 * Gets the full OAS-ready context for a specific interface.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - interfaceId: string (required)
 *
 * Response:
 *   - InterfaceOasContextDto directly
 *
 * Session effects:
 *   - Stores lastSelectedInterfaceId in session
 */
toolsRouter.post(
  '/get_interface_oas_context',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, interfaceId } = req.body as GetInterfaceContextRequest;

      // Validate required fields
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      if (!interfaceId || typeof interfaceId !== 'string' || interfaceId.trim() === '') {
        throw createHttpError(400, 'interfaceId is required and must be a non-empty string');
      }

      // Get or create session
      getOrCreateSession(sessionId);

      // Call backend service
      const context = await archModelClient.getInterfaceOasContext(interfaceId);

      // Update session with selected interface ID
      updateSession(sessionId, {
        lastSelectedInterfaceId: interfaceId,
      });

      // Return response (the full context object directly)
      res.json(context);
    } catch (error) {
      next(error);
    }
  }
);
