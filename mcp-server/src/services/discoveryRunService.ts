/**
 * Discovery Run Service
 *
 * Core business logic for the save_discovery_run MCP tool.
 * Handles JSON parsing, payload size validation, structural validation,
 * project existence check, and persistence via the architecture-model-service.
 *
 * Follows the parse-validate-persist pattern from discoveryConfigService.ts.
 *
 * @module discoveryRunService
 */

import { SaveDiscoveryRunResult } from '../types/saveDiscoveryRun';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

/**
 * Maximum allowed payload size for a discovery run JSON string (500KB).
 */
const MAX_PAYLOAD_SIZE_BYTES = 500 * 1024;

/**
 * Saves a discovery run by parsing, validating, and
 * persisting the run payload.
 *
 * Orchestration flow:
 * 1. Validate payload size (500KB limit)
 * 2. Parse discoveryRunJson via JSON.parse; throw 400 on invalid JSON
 * 3. Validate parsed result is a non-null object; throw 400 if not
 * 4. Validate project exists via archModelClient.getProjectById; let AxiosError propagate
 * 5. Extract status from parsed run if present, default to 'PENDING'
 * 6. Determine if creating or updating -- if parsed.id exists, call saveDiscoveryRun (PUT),
 *    otherwise call createDiscoveryRun (POST)
 * 7. Return { projectId, status }
 *
 * @param projectId - The project UUID
 * @param discoveryRunJson - The raw JSON string of the discovery run payload
 * @returns Promise resolving to the save result
 * @throws HttpError with statusCode 400 for validation failures
 * @throws AxiosError for upstream communication failures (mapped to 502 by error handler)
 */
export async function saveDiscoveryRun(
  projectId: string,
  discoveryRunJson: string
): Promise<SaveDiscoveryRunResult> {
  // ====================================================================
  // 1. Validate payload size
  // ====================================================================

  const payloadSizeBytes = Buffer.byteLength(discoveryRunJson, 'utf8');
  if (payloadSizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    throw createHttpError(
      400,
      `discoveryRunJson payload exceeds maximum size of 500KB (received ${Math.round(payloadSizeBytes / 1024)}KB)`
    );
  }

  // ====================================================================
  // 2. Parse JSON
  // ====================================================================

  let parsed: any;
  try {
    parsed = JSON.parse(discoveryRunJson);
  } catch (e: any) {
    throw createHttpError(400, `Invalid JSON: ${e.message}`);
  }

  // ====================================================================
  // 3. Validate parsed result is a non-null object
  // ====================================================================

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw createHttpError(400, 'discoveryRunJson must be a JSON object (not null, array, or primitive)');
  }

  // ====================================================================
  // 4. Validate project exists (let AxiosError propagate for 502 mapping)
  // ====================================================================

  await archModelClient.getProjectById(projectId);

  // ====================================================================
  // 5. Extract status (default to 'PENDING')
  // ====================================================================

  const status = typeof parsed.status === 'string' && parsed.status.trim() !== ''
    ? parsed.status
    : 'PENDING';

  // ====================================================================
  // 6. Persist run (create or update)
  // ====================================================================

  let backendResponse;

  // Resolve the project's default architectureId so the architecture-scoped
  // discovery-run controller can route the persistence call to the correct
  // (project, architecture) pair. The save_discovery_run MCP route does
  // not accept an explicit architectureId in its request body.
  const architectureId = await archModelClient.getDefaultArchitectureId(projectId);

  if (parsed.id) {
    // Update existing run via PUT
    backendResponse = await archModelClient.saveDiscoveryRun(
      projectId,
      architectureId,
      parsed.id,
      parsed,
      status
    );
  } else {
    // Create new run via POST
    backendResponse = await archModelClient.createDiscoveryRun(
      projectId,
      architectureId,
      parsed
    );
  }

  // ====================================================================
  // 7. Return result
  // ====================================================================

  return {
    projectId,
    status: backendResponse.status,
  };
}
