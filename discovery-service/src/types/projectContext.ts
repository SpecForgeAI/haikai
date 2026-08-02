/**
 * Project Context Contract Types
 *
 * Type-only definitions for the project context that the discovery service
 * will eventually need. No runtime integration with architecture-model-service
 * in this skeleton increment.
 */

/**
 * Discovery project context -- information about the project being analyzed.
 */
export interface DiscoveryProjectContext {
  projectId: string;
  projectFolderPath?: string;
  repoUrl?: string;
}

/**
 * Discovery request -- the shape of an incoming discovery pipeline request.
 */
export interface DiscoveryRequest {
  projectId: string;
  phase: string;
  step: string;
  options?: Record<string, unknown>;
}

/**
 * Typed interface for the discovery config payload (`config_payload` field
 * of the `DiscoveryConfigResponseDto`).
 *
 * This interface captures the known fields of the config payload.
 * Additional fields may exist and are preserved via the index signature.
 */
export interface DiscoveryConfigPayload {
  /** Repository configurations for the discovery run */
  repos?: Array<{ url: string; branch?: string; includePaths?: string[]; excludePaths?: string[] }>;
  /** Technology hints keyed by repo URL or path, with optional version */
  techHints?: Record<string, { language?: string; technology?: string; version?: string }>;
  /** Include path patterns for file filtering */
  includePaths?: string[];
  /** Exclude path patterns for file filtering */
  excludePaths?: string[];
  /** Repo-to-application mappings for anchor hints */
  repoApplicationMappings?: Record<string, string>;
  /**
   * Extension pack IDs to activate for this discovery run.
   * Empty array for v1 (no packs registered).
   * Future increments will populate with pack IDs like
   * 'java-spring-boot' or 'react-typescript'.
   */
  extensionPacks?: string[];
  /**
   * Operator-uploaded API contract files (2026-08-02): WADL/WSDL/XSD content
   * supplied to the scan as an AUTHORITATIVE Interface/Endpoint source, the
   * service-discovery analogue of API Baseline Capture's contract upload.
   * Threaded into the V3 pipeline's contract passes (parsed like a repo
   * `.wadl`/`.xsd`).
   */
  contractFiles?: Array<{ fileName: string; content: string }>;
  /** Allow additional untyped fields for forward compatibility */
  [key: string]: unknown;
}
