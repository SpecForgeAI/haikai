/**
 * Model API Client
 *
 * API client for backend model endpoints.
 * Provides functions to fetch, load, and save architecture models.
 */

import type { ArchitectureModel } from '../types/model';
import { normalizeModelFromApi, prepareModelForApiSave } from './modelSerialization';
import { ModelApiError } from './types/modelApiError';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Data transfer object for model file summary.
 * Returned by the /api/model/filenames endpoint.
 */
export interface ModelFileSummaryDto {
  id: string;
  filename: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  is_default?: boolean;
  tags?: string;
}

/**
 * Fetches the list of available model filenames from the backend.
 *
 * @returns Promise resolving to array of ModelFileSummaryDto
 * @throws Error if the request fails
 */
export async function fetchModelFilenames(): Promise<ModelFileSummaryDto[]> {
  const res = await fetch(`${API_BASE}/api/model/filenames`);
  if (!res.ok) {
    throw new Error(`Failed to load filenames: ${res.status}`);
  }
  return res.json();
}

/**
 * Loads an architecture model by filename from the backend.
 *
 * Normalizes the API response by mapping snake_case `typed_content` to camelCase `typedContent`.
 *
 * @param filename - The filename to load
 * @returns Promise resolving to the ArchitectureModel with normalized keys
 * @throws Error if the request fails
 */
export async function loadModelByFilename(filename: string): Promise<ArchitectureModel> {
  const params = new URLSearchParams({ filename });
  const res = await fetch(`${API_BASE}/api/model?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to load model "${filename}": ${res.status}`);
  }
  const raw = await res.json();
  return normalizeModelFromApi(raw);
}

/**
 * Loads an architecture model by project UUID and architecture UUID from the backend.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   The model-load function migrated from query-param form
 *   (`/api/model?projectId=...`) to path-segment form
 *   (`/api/model/projects/{projectId}/architectures/{architectureId}`) in the
 *   same spec as the backend cutover. Forgetting `architectureId` produces a
 *   404 at the backend (no silent fallback).
 *
 * Normalizes the API response by mapping snake_case `typed_content` to camelCase `typedContent`.
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID -- REQUIRED, no fallback
 * @returns Promise resolving to the ArchitectureModel with normalized keys
 * @throws Error if the request fails
 */
export async function loadModelByProjectId(
  projectId: string,
  architectureId: string
): Promise<ArchitectureModel> {
  const url = `${API_BASE}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load model for project "${projectId}" architecture "${architectureId}": ${res.status}`
    );
  }
  const raw = await res.json();
  return normalizeModelFromApi(raw);
}

/**
 * Saves an architecture model to the backend, scoped by project + architecture.
 *
 * Prepares the model for API save by mapping camelCase `typedContent` to snake_case `typed_content`.
 *
 * Spec 2026-05-11 Frontend Architecture-Scoped Save Migration:
 *   Cutover from the legacy `PUT /api/model?filename=X` URL to the
 *   architecture-scoped `PUT /api/model/projects/{projectId}/architectures/{architectureId}?filename=X`
 *   endpoint that has been on the backend since spec 2026-05-01. Without
 *   architecture scoping, the legacy filename-only lookup is non-deterministic
 *   in a post-clone scenario where two model_files rows share the same
 *   filename across architectures (changeset 096 relaxed the legacy global
 *   UNIQUE constraint to a per-architecture composite UNIQUE INDEX) -- it
 *   would corrupt the wrong architecture on save.
 *
 *   `projectId` and `architectureId` are REQUIRED. We throw a descriptive
 *   `Error` BEFORE issuing the fetch when either is missing/empty so a
 *   missing-context bug fails loud rather than silently corrupting the wrong
 *   architecture's model_file via the legacy lookup.
 *
 * Step 1 of the 5-step save-validation improvement series:
 *   On non-2xx responses, this function parses the structured envelope
 *   emitted by the backend `GlobalExceptionHandler` and throws a
 *   `ModelApiError` carrying the full envelope (`status`, `message`, `code`,
 *   `field`, `error`, `rawBody`). Step 4 reuses the `ModelApiError` to
 *   route structured errors to the existing pre-save validation panel.
 *
 *   The `.message` property of the thrown error is set to the most
 *   informative human-readable string available -- prefer backend `message`,
 *   fall back to backend `error`, fall back to `${status} ${statusText}`.
 *
 * @param projectId - The project UUID -- REQUIRED, must be non-empty
 * @param architectureId - The architecture UUID -- REQUIRED, must be non-empty
 * @param filename - The filename to save as -- REQUIRED, must be non-empty
 * @param model - The ArchitectureModel to save
 * @returns Promise resolving to the saved ModelFileSummaryDto
 * @throws Error if `projectId`, `architectureId`, or `filename` is missing/empty
 * @throws ModelApiError if the request fails (carries the structured envelope)
 */
export async function saveModelByFilename(
  projectId: string,
  architectureId: string,
  filename: string,
  model: ArchitectureModel
): Promise<ModelFileSummaryDto> {
  // Spec 2026-05-11: Loud-failure contract. The architecture-scoped endpoint
  // requires all three identifiers; missing any of them would either trigger
  // a backend 4xx after a wasted round-trip OR (worse) silently route to the
  // wrong architecture if a future caller falls back to the legacy URL. Fail
  // here so the missing-context bug surfaces as a stack trace at the call
  // site instead of being absorbed into a generic save-failed toast.
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error(
      'saveModelByFilename: projectId is required and must be a non-empty string'
    );
  }
  if (typeof architectureId !== 'string' || architectureId.length === 0) {
    throw new Error(
      'saveModelByFilename: architectureId is required and must be a non-empty string'
    );
  }
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(
      'saveModelByFilename: filename is required and must be a non-empty string'
    );
  }

  const payload = prepareModelForApiSave(model);
  const url =
    `${API_BASE}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `?filename=${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Best-effort: read the body once as text, then attempt JSON parse.
    // The backend GlobalExceptionHandler returns a structured envelope:
    //   { timestamp, status, error, message, code?, field? }
    // ...but we MUST tolerate non-JSON or empty bodies (e.g. infrastructure
    // 502s, intermediate proxy errors).
    let rawBody: string | undefined;
    try {
      rawBody = await res.text();
    } catch {
      rawBody = undefined;
    }

    let parsedMessage: string | undefined;
    let parsedCode: string | undefined;
    let parsedField: string | undefined;
    let parsedError: string | undefined;
    let parsedTimestamp: string | undefined;
    // Step 4 of save-validation series: structured ValidationException fields
    // (snake_case on the wire). These let the caller route the error inline
    // to the existing pre-save validation panel.
    let parsedEntityType: string | undefined;
    let parsedEntityId: string | undefined;
    let parsedEntityName: string | undefined;

    if (rawBody && rawBody.length > 0) {
      try {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.message === 'string') {
            parsedMessage = parsed.message;
          }
          if (typeof parsed.code === 'string') {
            parsedCode = parsed.code;
          }
          if (typeof parsed.field === 'string') {
            parsedField = parsed.field;
          }
          if (typeof parsed.error === 'string') {
            parsedError = parsed.error;
          }
          if (typeof parsed.timestamp === 'string') {
            parsedTimestamp = parsed.timestamp;
          }
          if (typeof parsed.entity_type === 'string') {
            parsedEntityType = parsed.entity_type;
          }
          if (typeof parsed.entity_id === 'string') {
            parsedEntityId = parsed.entity_id;
          }
          if (typeof parsed.entity_name === 'string') {
            parsedEntityName = parsed.entity_name;
          }
        }
      } catch {
        // Body was not JSON -- fall through to status+statusText fallback.
      }
    }

    // Pick the most informative human-readable message available.
    const fallbackStatusText =
      res.statusText && res.statusText.length > 0
        ? `${res.status} ${res.statusText}`
        : `${res.status}`;
    const finalMessage = parsedMessage ?? parsedError ?? fallbackStatusText;

    throw new ModelApiError(finalMessage, {
      status: res.status,
      message: parsedMessage,
      code: parsedCode,
      field: parsedField,
      error: parsedError,
      timestamp: parsedTimestamp,
      entity_type: parsedEntityType,
      entity_id: parsedEntityId,
      entity_name: parsedEntityName,
      rawBody,
    });
  }
  return res.json();
}

// ============================================================================
// SVG Export API Functions
// Spec: Export Diagrams as SVG
// ============================================================================

/**
 * Exports a single diagram as SVG.
 *
 * Returns the raw Response to allow blob handling by the caller.
 * The caller should use response.blob() to get the SVG content
 * and parse the Content-Disposition header for the download filename.
 *
 * @param filename - The model filename
 * @param diagramId - The ID of the diagram to export
 * @returns Promise resolving to the raw Response for blob handling
 * @throws Error if the request fails
 */
export async function exportDiagramAsSvg(
  filename: string,
  diagramId: string
): Promise<Response> {
  const params = new URLSearchParams({ filename });
  const url = `${API_BASE}/api/model/diagrams/${encodeURIComponent(diagramId)}/export-svg?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to export diagram "${diagramId}": ${res.status}`);
  }
  return res;
}

/**
 * Exports all diagrams in the model as a ZIP archive containing SVG files.
 *
 * Returns the raw Response to allow blob handling by the caller.
 * The caller should use response.blob() to get the ZIP content
 * and parse the Content-Disposition header for the download filename.
 *
 * @param filename - The model filename
 * @returns Promise resolving to the raw Response for blob handling
 * @throws Error if the request fails
 */
export async function exportAllDiagramsAsZip(
  filename: string
): Promise<Response> {
  const params = new URLSearchParams({ filename });
  const url = `${API_BASE}/api/model/diagrams/export-all-svg?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to export all diagrams: ${res.status}`);
  }
  return res;
}

// ============================================================================
// Infrastructure Terraform Export API Function
// Spec 2026-05-08: Infrastructure Terraform Export (GCP)
// Task Group 7: Frontend modal + menu + API client
// ============================================================================

/**
 * Options for the Infrastructure Terraform export request.
 *
 * `environmentId` and `provider` are required. `cloudAccountId` and `locationId`
 * are optional and are omitted from the request URL when not provided.
 */
export interface ExportInfrastructureTerraformOptions {
  /** Required: model id of the selected Environment. */
  environmentId: string;
  /** Optional: model id of the selected Cloud Account. */
  cloudAccountId?: string;
  /** Optional: model id of the selected Location. */
  locationId?: string;
  /** Required: target IaC provider, e.g. 'GCP'. V1 only registers GCP on the backend. */
  provider: string;
}

/**
 * Exports the Infrastructure domain of an architecture as a Terraform ZIP archive.
 *
 * Mirrors `exportAllDiagramsAsZip(...)`: returns the raw `Response` so the caller
 * can read the body as a `Blob` and parse the `Content-Disposition` header via
 * `parseContentDispositionFilename` for the download filename.
 *
 * Endpoint:
 *   GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform
 *       ?environmentId=<uuid>
 *       [&cloudAccountId=<uuid>]
 *       [&locationId=<uuid>]
 *       &provider=<id>
 *
 * Hard-fail (4xx) only when:
 *   - `environmentId` is missing,
 *   - `provider` is not in `iacSourceProviderOptions`,
 *   - `provider` is not registered on the backend (V1: only `GCP`).
 *
 * All other validation gaps surface as soft-warns inside the ZIP's `warnings.json`.
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID
 * @param options - environmentId / cloudAccountId / locationId / provider
 * @returns Promise resolving to the raw Response for blob handling
 * @throws Error if the request fails
 */
export async function exportInfrastructureTerraform(
  projectId: string,
  architectureId: string,
  options: ExportInfrastructureTerraformOptions
): Promise<Response> {
  const params = new URLSearchParams();
  params.set('environmentId', options.environmentId);
  if (options.cloudAccountId !== undefined && options.cloudAccountId !== '') {
    params.set('cloudAccountId', options.cloudAccountId);
  }
  if (options.locationId !== undefined && options.locationId !== '') {
    params.set('locationId', options.locationId);
  }
  params.set('provider', options.provider);

  const url =
    `${API_BASE}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/infrastructure/export-terraform?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to export Infrastructure as Terraform for project "${projectId}" architecture "${architectureId}": ${res.status}`
    );
  }
  return res;
}

/**
 * Parses the Content-Disposition header to extract the filename.
 *
 * Handles both quoted and unquoted filenames:
 * - Content-Disposition: attachment; filename="project_diagram_20240109-120000.svg"
 * - Content-Disposition: attachment; filename=project_diagram_20240109-120000.svg
 *
 * @param header - The Content-Disposition header value
 * @param defaultName - Default filename if parsing fails
 * @returns The extracted filename or the default
 */
export function parseContentDispositionFilename(
  header: string | null,
  defaultName: string
): string {
  if (!header) {
    return defaultName;
  }

  // Try quoted filename first
  const quotedMatch = header.match(/filename="([^"]+)"/);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  // Try unquoted filename
  const unquotedMatch = header.match(/filename=([^;\s]+)/);
  if (unquotedMatch && unquotedMatch[1]) {
    return unquotedMatch[1];
  }

  return defaultName;
}

// ============================================================================
// Infrastructure Terraform Import API Function
// Spec 2026-05-08: Infrastructure Terraform Import (GCP)
// Task Group 7: Frontend modal + menu + API client
//
// Mirrors `exportInfrastructureTerraform`, but POSTs `multipart/form-data` and
// returns parsed JSON (the transient `ImportReviewResult`). NO model mutation
// occurs in this endpoint -- the user explicitly approves the candidates via
// the existing model-save flow afterwards.
// ============================================================================

/**
 * Evidence block for a single imported candidate -- the parsed HCL location +
 * raw snippet preserved for evidence display in the review UI.
 *
 * snake_case keys mirror the backend JSON contract verbatim (Q3 / Q11 locked).
 */
export interface ImportCandidateEvidence {
  file_path: string;
  start_line: number;
  end_line: number;
  raw_snippet: string;
  /** Set when an HCL expression could not be resolved (e.g. var.foo with no default). */
  unresolved_expression_text?: string | null;
}

/**
 * A single Terraform-derived candidate produced by the importer.
 *
 * `target_entity_type` is the polymorphic Infrastructure entity discriminator
 * (e.g. `Network`, `ComputeResource`, `LoadBalancer`).
 *
 * `proposed_entity_fields` is the proposed entity payload (snake_case) the
 * approval flow merges into the model on Approve all.
 *
 * `proposed_binding` is the proposed `IaCResourceBinding` row (snake_case).
 *
 * `confidence` is one of the three locked buckets: 0.900 (HIGH), 0.600 (MEDIUM),
 * 0.300 (LOW).
 *
 * `candidate_id` + `ignored` are plumbed through even though V1 UI is read-only
 * -- the follow-up per-row UI spec is pure UI work over this same shape.
 */
export interface ImportCandidate {
  candidate_id: string;
  target_entity_type: string;
  proposed_entity_fields: Record<string, unknown>;
  proposed_binding: Record<string, unknown>;
  confidence: number;
  per_candidate_warnings: string[];
  evidence: ImportCandidateEvidence;
  ignored: boolean;
}

/**
 * The IaC source proposal -- one per import (Q4 = whole upload is one source).
 */
export interface ImportIacSource {
  repository_url?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  path?: string | null;
  workspace?: string | null;
  provider: string;
}

/**
 * Aggregate counts surfaced by the result `summary` block.
 */
export interface ImportReviewSummary {
  will_create_count: number;
  will_update_count: number;
  unsupported_count: number;
  warnings_count: number;
}

/**
 * The transient response payload returned by the import endpoint.
 *
 * Mirrors the backend `ImportReviewResult` record verbatim (snake_case JSON).
 *
 * `will_create` / `will_update` / `unsupported` are populated in three buckets
 * based on `iac_address` matching against existing `IaCResourceBinding` rows.
 *
 * `warnings` is the result-level warnings list (collected during parse + classify).
 */
export interface ImportReviewResult {
  iac_source: ImportIacSource;
  will_create: ImportCandidate[];
  will_update: ImportCandidate[];
  unsupported: ImportCandidate[];
  warnings: string[];
  summary: ImportReviewSummary;
}

/**
 * Imports Terraform `.tf` files (or a single `.zip`) and returns the transient
 * `ImportReviewResult` payload (proposed candidates + warnings).
 *
 * NO model mutation occurs in this call -- the user explicitly approves the
 * candidates via the existing model-save flow afterwards. "Discard all" is a
 * pure client-side state clear with no server call.
 *
 * Endpoint:
 *   POST /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform
 *
 * Body: `multipart/form-data` with `files` parts (one or more `.tf` files OR
 *       exactly one `.zip`) plus form fields:
 *       - `environmentId` (required UUID)
 *       - `cloudAccountId` (optional UUID)
 *       - `locationId` (optional UUID)
 *       - `provider` (required, V1 must be `GCP`)
 *       - `repositoryUrl` (optional)
 *       - `branch` (optional)
 *       - `commitSha` (optional)
 *       - `path` (optional)
 *       - `workspace` (optional)
 *
 * IMPORTANT: do NOT manually set `Content-Type` -- the browser supplies the
 * multipart boundary automatically when `body` is a `FormData` instance.
 *
 * Hard-fail (4xx) when:
 *   - any file part is missing,
 *   - `environmentId` is missing,
 *   - `provider` is not in `iacSourceProviderOptions`,
 *   - `provider` is not registered on the backend (V1: only `GCP`),
 *   - ZIP or any individual file exceeds the configured max size.
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID
 * @param formData - Pre-assembled FormData (built by the modal)
 * @returns Promise resolving to the parsed `ImportReviewResult`
 * @throws Error carrying the server's error message on non-2xx
 */
export async function importInfrastructureTerraform(
  projectId: string,
  architectureId: string,
  formData: FormData
): Promise<ImportReviewResult> {
  const url =
    `${API_BASE}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/infrastructure/import-terraform`;

  const res = await fetch(url, {
    method: 'POST',
    body: formData,
    // NOTE: no manual Content-Type -- the browser supplies the multipart boundary.
  });

  if (!res.ok) {
    // Try to read a server error message from the response body. The backend
    // returns either a plain string or a JSON object with an `error` field.
    let serverMessage = '';
    try {
      const text = await res.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
            serverMessage = parsed.error;
          } else {
            serverMessage = text;
          }
        } catch {
          serverMessage = text;
        }
      }
    } catch {
      // Best-effort: fall through to status-only error below.
    }
    const suffix = serverMessage ? `: ${serverMessage}` : '';
    throw new Error(
      `Failed to import Infrastructure Terraform for project "${projectId}" architecture "${architectureId}": ${res.status}${suffix}`
    );
  }

  return (await res.json()) as ImportReviewResult;
}
