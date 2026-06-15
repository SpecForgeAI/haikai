/**
 * Temporary Architecture Diagram Service
 *
 * Core business logic for the saveTemporaryArchitectureDiagram MCP tool.
 * Handles JSON parsing, payload size validation, structural/semantic validation,
 * project existence check, and persistence via the architecture-model-service.
 *
 * Follows the parse-validate-persist pattern from backlogItemsService.ts.
 *
 * @module temporaryArchitectureDiagramService
 */

import { SaveTemporaryArchitectureDiagramResult } from '../types/saveTemporaryArchitectureDiagram';
import { validateTemporaryArchitectureDiagram } from './temporaryArchitectureDiagramValidator';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

/**
 * Maximum allowed payload size for a diagram JSON string (500KB).
 */
const MAX_PAYLOAD_SIZE_BYTES = 500 * 1024;

/**
 * Saves a temporary architecture diagram by parsing, validating, and
 * persisting the diagram payload.
 *
 * Orchestration flow:
 * 1. Validate payload size (500KB limit)
 * 2. Parse diagramJson via JSON.parse; throw 400 on invalid JSON
 * 3. Validate parsed diagram structurally and semantically; throw 400 if errors
 * 4. Validate project exists via archModelClient.getProjectById; let AxiosError propagate
 * 5. Persist via archModelClient.saveTemporaryDiagram
 * 6. Return { id, status: "saved", createdAt }
 *
 * @param projectId - The project UUID
 * @param diagramJson - The raw JSON string of the TemporaryArchitectureDiagram payload
 * @returns Promise resolving to the save result
 * @throws HttpError with statusCode 400 for validation failures
 * @throws AxiosError for upstream communication failures (mapped to 502 by error handler)
 */
export async function saveTemporaryArchitectureDiagram(
  projectId: string,
  diagramJson: string,
  // Hotfix 2026-05-13: optional architectureId from the caller. When the
  // gateway extracts it from the chat request body (the chat panel sends
  // the URL-active id), the save targets that exact architecture. When
  // omitted (legacy callers, or scenarios where the caller has no
  // architecture context), the service resolves the project's default
  // architecture as a backwards-compatible fallback -- the same rule the
  // frontend uses for `useActiveArchitectureId()` resolution.
  architectureId?: string
): Promise<SaveTemporaryArchitectureDiagramResult> {
  // ====================================================================
  // 1. Validate payload size
  // ====================================================================

  const payloadSizeBytes = Buffer.byteLength(diagramJson, 'utf8');
  if (payloadSizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    throw createHttpError(
      400,
      `diagramJson payload exceeds maximum size of 500KB (received ${Math.round(payloadSizeBytes / 1024)}KB)`
    );
  }

  // ====================================================================
  // 2. Parse JSON
  // ====================================================================

  let parsed: any;
  try {
    parsed = JSON.parse(diagramJson);
  } catch (e: any) {
    throw createHttpError(400, `Invalid JSON: ${e.message}`);
  }

  // ====================================================================
  // 2b. Normalize edge_points sequence_order to 0-based
  // LLMs sometimes output 1-based sequence_order; normalize before validation.
  // ====================================================================

  if (Array.isArray(parsed.edges)) {
    for (const edge of parsed.edges) {
      if (edge && Array.isArray(edge.edge_points) && edge.edge_points.length > 0) {
        const first = edge.edge_points[0];
        if (first && typeof first.sequence_order === 'number' && first.sequence_order === 1) {
          for (const pt of edge.edge_points) {
            if (pt && typeof pt.sequence_order === 'number') {
              pt.sequence_order = pt.sequence_order - 1;
            }
          }
        }
      }
    }
  }

  // ====================================================================
  // 3. Validate diagram
  // ====================================================================

  const errors = validateTemporaryArchitectureDiagram(parsed);
  if (errors.length > 0) {
    throw createHttpError(400, errors.join('; '));
  }

  // ====================================================================
  // 4. Validate project exists (let AxiosError propagate for 502 mapping)
  // ====================================================================

  await archModelClient.getProjectById(projectId);

  // ====================================================================
  // 4b. Resolve the target architecture
  // Hotfix 2026-05-13: the AMS temporary-diagram routes are
  // architecture-scoped. Prefer the architectureId supplied by the caller
  // (the gateway forwards the chat request's URL-active id) so save and
  // preview hit the same architecture. Fall back to the project's default
  // (oldest non-archived) only when the caller didn't supply one -- this
  // preserves the original behaviour for legacy callers / scenarios with
  // no architecture context.
  // ====================================================================

  const resolvedArchitectureId =
    architectureId && architectureId.length > 0
      ? architectureId
      : await archModelClient.getDefaultArchitectureId(projectId);

  // ====================================================================
  // 5. Persist diagram
  // ====================================================================

  const backendResponse = await archModelClient.saveTemporaryDiagram(
    projectId,
    resolvedArchitectureId,
    parsed.id,
    parsed
  );

  // ====================================================================
  // 6. Return result
  // ====================================================================

  return {
    id: parsed.id,
    status: 'saved',
    createdAt: backendResponse.created_at,
  };
}
