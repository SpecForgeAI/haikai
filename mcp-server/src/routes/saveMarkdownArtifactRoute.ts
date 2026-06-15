import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveMarkdownArtifactRequest, SaveMarkdownArtifactResponse } from '../types';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maximum byte length for markdown content (200KB)
 */
const MAX_MARKDOWN_BYTES = 204800;

/**
 * Regex for unsafe filename characters: path traversal (..) or path separators (/ or \)
 */
const UNSAFE_FILENAME_REGEX = /\.\.|[/\\]/;

/**
 * Regex for valid artifact file extensions (.MD, .md, .yaml, .yml, .json)
 */
const VALID_ARTIFACT_EXTENSION_REGEX = /\.(MD|md|yaml|yml|json)$/;

/**
 * Express Router for the save_markdown_artifact MCP tool endpoint.
 * Mounts at /mcp/tools/save_markdown_artifact
 */
export const saveMarkdownArtifactRouter = Router();

/**
 * POST /
 *
 * Saves a markdown artifact to agent-os/product/<artifactFilename>.
 * Generic tool for writing any markdown artifact (TECH-STACK.MD, TEST-STRATEGY.MD, etc.)
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - projectParentFolder: string (optional, base path for file write)
 *   - artifactFilename: string (required, safe filename ending in .MD, .md, .yaml, .yml, or .json)
 *   - markdown: string (required, non-empty, max 200KB)
 *
 * Response:
 *   - { writtenPaths: string[] }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields, unsafe filename, oversized content
 *   - 500 Internal Server Error: File write failure
 */
saveMarkdownArtifactRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        sessionId,
        projectId,
        projectParentFolder,
        artifactFilename,
        markdown,
      } = req.body as SaveMarkdownArtifactRequest;

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

      // Validate artifactFilename (required, non-empty string)
      if (!artifactFilename || typeof artifactFilename !== 'string' || artifactFilename.trim() === '') {
        throw createHttpError(400, 'artifactFilename is required and must be a non-empty string');
      }

      // Validate artifactFilename safety: no path traversal (..) or path separators (/ or \)
      if (UNSAFE_FILENAME_REGEX.test(artifactFilename)) {
        throw createHttpError(400, 'artifactFilename must not contain path traversal characters (..) or path separators (/ or \\)');
      }

      // Validate artifactFilename extension: must end in .MD, .md, .yaml, .yml, or .json
      if (!VALID_ARTIFACT_EXTENSION_REGEX.test(artifactFilename)) {
        throw createHttpError(400, 'artifactFilename must end in .MD, .md, .yaml, .yml, or .json');
      }

      // Validate markdown (required, non-empty string)
      if (!markdown || typeof markdown !== 'string' || markdown.trim() === '') {
        throw createHttpError(400, 'markdown is required and must be a non-empty string');
      }

      // Validate markdown byte length (max 200KB)
      if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
        throw createHttpError(400, 'markdown must not exceed 200KB (204800 bytes)');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Resolve Base Path
      // ====================================================================

      // Use projectParentFolder if provided, otherwise fall back to cwd
      const basePath = projectParentFolder && typeof projectParentFolder === 'string' && projectParentFolder.trim() !== ''
        ? projectParentFolder
        : process.cwd();

      // ====================================================================
      // Atomic Markdown File Write
      // ====================================================================

      const targetDir = path.join(basePath, 'agent-os', 'product');
      const targetFile = path.join(targetDir, artifactFilename);

      // Create directory (mkdir -p)
      await fs.mkdir(targetDir, { recursive: true });

      // Write to temp file
      await fs.writeFile(targetFile + '.tmp', markdown, 'utf8');

      // Atomic rename
      await fs.rename(targetFile + '.tmp', targetFile);

      const writtenPaths = [`agent-os/product/${artifactFilename}`];

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_markdown_artifact] Success', {
        targetFile,
        artifactFilename,
        markdownByteLength: Buffer.byteLength(markdown, 'utf8'),
      });

      res.json({ writtenPaths } as SaveMarkdownArtifactResponse);
    } catch (error) {
      next(error);
    }
  }
);
