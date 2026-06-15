/**
 * Package Set Standards Import API Functions
 *
 * Spec: Package Set Standards Import (Iteration 6)
 *
 * API functions for interacting with the Package Set Standards Import backend endpoints.
 */

import {
  PackageSetStandardsImportResult,
  PackageSetStandardsImportStatus,
} from '../types/packageSetStandards';

/**
 * Base URL for the API - should be configured via environment variable in production.
 * Defaults to the development server URL.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

/**
 * Triggers a Package Set Standards Import.
 *
 * POST /api/standards/package-sets/import
 *
 * This endpoint reads package-set-standards.json files from:
 * - Company level: {projectParentFolder}/standards/package-set-standards.json
 * - Project level: {projectParentFolder}/{projectName}/standards/package-set-standards.json
 *
 * It performs upsert operations for PackageSets, Packages, and DefaultRules using
 * deterministic UUID generation based on (modelFileId, standardSource, standardKey).
 *
 * @returns Promise<PackageSetStandardsImportResult> - The import result with counts and status
 * @throws Error if the API request fails
 */
export async function importPackageSetStandards(): Promise<PackageSetStandardsImportResult> {
  const response = await fetch(`${API_BASE_URL}/api/standards/package-sets/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    // Try to parse error response body
    try {
      const errorBody = await response.json();
      throw new Error(errorBody.message || `Import failed with status ${response.status}`);
    } catch {
      throw new Error(`Import failed with status ${response.status}`);
    }
  }

  const result: PackageSetStandardsImportResult = await response.json();
  return result;
}

/**
 * Fetches the last Package Set Standards Import status.
 *
 * GET /api/standards/package-sets/import-status
 *
 * Returns the most recent import status record for the current model file,
 * or null if no import has ever been performed.
 *
 * @returns Promise<PackageSetStandardsImportStatus | null> - The import status or null if not found
 * @throws Error if the API request fails (except for 404, which returns null)
 */
export async function getPackageSetStandardsImportStatus(): Promise<PackageSetStandardsImportStatus | null> {
  const response = await fetch(`${API_BASE_URL}/api/standards/package-sets/import-status`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  // 404 means no import status found - return null
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    // Try to parse error response body
    try {
      const errorBody = await response.json();
      throw new Error(errorBody.message || `Failed to fetch import status with status ${response.status}`);
    } catch {
      throw new Error(`Failed to fetch import status with status ${response.status}`);
    }
  }

  const status: PackageSetStandardsImportStatus = await response.json();
  return status;
}
