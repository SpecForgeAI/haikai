import { Router, Request, Response, NextFunction } from 'express';
import { archModelClient } from '../services/archModelClient';
import { getOrCreateSession, updateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveProductArtifactsRequest, SaveProductArtifactsResponse } from '../types';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maximum byte length for missionMarkdown (200KB)
 */
const MAX_MISSION_MARKDOWN_BYTES = 204800;

/**
 * Maximum character length for productName
 */
const MAX_PRODUCT_NAME_LENGTH = 255;

/**
 * Express Router for the save_product_artifacts MCP tool endpoint.
 * Mounts at /mcp/tools/save_product_artifacts
 */
export const saveProductArtifactsRouter = Router();

/**
 * POST /
 *
 * Saves product artifacts: writes MISSION.MD to agent-os/product/ and
 * upserts a minimal ProductDefinition record in architecture-model-service.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectParentFolder: string (required)
 *   - projectId: string (required, UUID v4)
 *   - productName: string (required, max 255 chars)
 *   - missionMarkdown: string (required, max 200KB)
 *   - overwrite: boolean (optional, default true)
 *
 * Response:
 *   - { writtenPaths: string[], productUpserted: boolean }
 *
 * Session effects:
 *   - Stores productName in session
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields
 *   - 409 Conflict: File exists and overwrite is false
 *   - 500 Internal Server Error: File write failure
 *   - 502 Bad Gateway: DB upsert failure (partial success with writtenPaths)
 */
saveProductArtifactsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        sessionId,
        projectParentFolder,
        projectId,
        productName,
        missionMarkdown,
        overwrite: overwriteParam,
      } = req.body as SaveProductArtifactsRequest;

      // Default overwrite to true if not provided
      const overwrite = overwriteParam !== undefined ? overwriteParam : true;

      // ====================================================================
      // Request Validation
      // ====================================================================

      // Validate sessionId (required, non-empty string)
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate projectParentFolder (required, non-empty string)
      if (!projectParentFolder || typeof projectParentFolder !== 'string' || projectParentFolder.trim() === '') {
        throw createHttpError(400, 'projectParentFolder is required and must be a non-empty string');
      }

      // Validate projectId (required, must match UUID v4 regex)
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }

      // Validate productName (required, non-empty string, max 255 characters)
      if (!productName || typeof productName !== 'string' || productName.trim() === '' || productName.length > MAX_PRODUCT_NAME_LENGTH) {
        throw createHttpError(400, 'productName is required, must be a non-empty string, and must not exceed 255 characters');
      }

      // Validate missionMarkdown (required, non-empty string, max 200KB)
      if (!missionMarkdown || typeof missionMarkdown !== 'string' || missionMarkdown.trim() === '') {
        throw createHttpError(400, 'missionMarkdown is required, must be a non-empty string, and must not exceed 200KB');
      }
      if (Buffer.byteLength(missionMarkdown, 'utf8') > MAX_MISSION_MARKDOWN_BYTES) {
        throw createHttpError(400, 'missionMarkdown is required, must be a non-empty string, and must not exceed 200KB');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Atomic MISSION.MD File Write
      // ====================================================================

      const missionDir = path.join(projectParentFolder, 'agent-os', 'product');
      const missionFile = path.join(missionDir, 'MISSION.MD');

      // Check overwrite flag
      if (overwrite === false) {
        try {
          await fs.access(missionFile);
          // File exists and overwrite is false
          throw createHttpError(409, 'MISSION.MD already exists and overwrite is false');
        } catch (accessError) {
          // If the error is the 409 we just created, re-throw it
          if ((accessError as any).statusCode === 409) {
            throw accessError;
          }
          // Otherwise, file does not exist -- continue with write
        }
      }

      // Create directory
      await fs.mkdir(missionDir, { recursive: true });

      // Write temp file
      await fs.writeFile(missionFile + '.tmp', missionMarkdown, 'utf8');

      // Atomic rename
      await fs.rename(missionFile + '.tmp', missionFile);

      const writtenPaths = ['agent-os/product/MISSION.MD'];

      // ====================================================================
      // ProductDefinition Upsert
      // ====================================================================

      let productUpserted = false;

      try {
        await archModelClient.upsertProductDefinition(projectId, productName);
        productUpserted = true;
      } catch (upsertError) {
        // DB upsert failure after successful file write -- respond with 502
        const errorMessage = (upsertError as Error).message || 'Failed to upsert product definition';
        console.error('[save_product_artifacts] DB upsert failed', {
          projectId,
          error: errorMessage,
        });
        res.status(502).json({
          error: {
            code: 502,
            message: errorMessage,
          },
          writtenPaths,
        });
        return;
      }

      // ====================================================================
      // Success Response and Session Update
      // ====================================================================

      updateSession(sessionId, { productName });

      console.log('[save_product_artifacts] Success', {
        missionFile,
        productUpserted,
        missionMarkdownLength: Buffer.byteLength(missionMarkdown, 'utf8'),
      });

      res.json({ writtenPaths, productUpserted: true } as SaveProductArtifactsResponse);
    } catch (error) {
      next(error);
    }
  }
);
