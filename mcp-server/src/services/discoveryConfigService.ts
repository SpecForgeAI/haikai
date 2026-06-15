/**
 * Discovery Config Service
 *
 * Core business logic for the save_discovery_config MCP tool.
 * Handles JSON parsing, payload size validation, structural validation,
 * project existence check, and persistence via the architecture-model-service.
 *
 * Follows the parse-validate-persist pattern from temporaryArchitectureDiagramService.ts.
 *
 * @module discoveryConfigService
 */

import { SaveDiscoveryConfigResult } from '../types/saveDiscoveryConfig';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

/**
 * Maximum allowed payload size for a discovery config JSON string (500KB).
 */
const MAX_PAYLOAD_SIZE_BYTES = 500 * 1024;

/**
 * Saves a discovery config by parsing, validating, and
 * persisting the config payload.
 *
 * Orchestration flow:
 * 1. Validate payload size (500KB limit)
 * 2. Parse discoveryConfigJson via JSON.parse; throw 400 on invalid JSON
 * 3. Validate parsed result is a non-null object; throw 400 if not
 * 4. Validate project exists via archModelClient.getProjectById; let AxiosError propagate
 * 5. Extract status from parsed config if present, default to 'DRAFT'
 * 6. Persist via archModelClient.saveDiscoveryConfig
 * 7. Return { projectId, status }
 *
 * @param projectId - The project UUID
 * @param discoveryConfigJson - The raw JSON string of the discovery config payload
 * @returns Promise resolving to the save result
 * @throws HttpError with statusCode 400 for validation failures
 * @throws AxiosError for upstream communication failures (mapped to 502 by error handler)
 */
export async function saveDiscoveryConfig(
  projectId: string,
  discoveryConfigJson: string
): Promise<SaveDiscoveryConfigResult> {
  // ====================================================================
  // 1. Validate payload size
  // ====================================================================

  const payloadSizeBytes = Buffer.byteLength(discoveryConfigJson, 'utf8');
  if (payloadSizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    throw createHttpError(
      400,
      `discoveryConfigJson payload exceeds maximum size of 500KB (received ${Math.round(payloadSizeBytes / 1024)}KB)`
    );
  }

  // ====================================================================
  // 2. Parse JSON
  // ====================================================================

  let parsed: any;
  try {
    parsed = JSON.parse(discoveryConfigJson);
  } catch (e: any) {
    throw createHttpError(400, `Invalid JSON: ${e.message}`);
  }

  // ====================================================================
  // 3. Validate parsed result is a non-null object
  // ====================================================================

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw createHttpError(400, 'discoveryConfigJson must be a JSON object (not null, array, or primitive)');
  }

  // ====================================================================
  // 4. Validate project exists (let AxiosError propagate for 502 mapping)
  // ====================================================================

  await archModelClient.getProjectById(projectId);

  // ====================================================================
  // 5. Extract status (default to 'DRAFT')
  // ====================================================================

  const status = typeof parsed.status === 'string' && parsed.status.trim() !== ''
    ? parsed.status
    : 'DRAFT';

  // ====================================================================
  // 6. Persist config
  // ====================================================================

  const backendResponse = await archModelClient.saveDiscoveryConfig(
    projectId,
    parsed,
    status
  );

  // ====================================================================
  // 7. Return result
  // ====================================================================

  return {
    projectId,
    status: backendResponse.status,
  };
}
