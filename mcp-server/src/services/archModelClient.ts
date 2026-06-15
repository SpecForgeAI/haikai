import axios, { AxiosInstance, AxiosError } from 'axios';
import { ARCH_MODEL_SERVICE_BASE_URL } from '../config';
import { InterfaceSummaryDto, InterfaceOasContextDto, SaveOasSpecSummaryDto, ProductDefinitionDto } from '../types';
import { WorkItemDto } from '../types/saveRoadmapStructure';

/**
 * Represents a project returned by GET /api/projects.
 */
export interface ProjectDto {
  id: string;
  name: string;
  [key: string]: any;
}

/**
 * Represents an architecture returned by GET /api/projects/{projectId}/architectures.
 */
export interface ArchitectureDto {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

/**
 * Response shape from the temporary diagram save/retrieve endpoints
 * in the architecture-model-service.
 */
export interface TemporaryDiagramResponseDto {
  id: string;
  temporary_diagram_id: string;
  project_id: string;
  diagram_payload: object;
  created_at: string;
  updated_at: string;
}

/**
 * Response shape from the discovery config save/retrieve endpoints
 * in the architecture-model-service.
 */
export interface DiscoveryConfigResponseDto {
  id: string;
  project_id: string;
  config_payload: object;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Response shape from the discovery run save/retrieve endpoints
 * in the architecture-model-service.
 */
export interface DiscoveryRunResponseDto {
  id: string;
  project_id: string;
  status: string;
  current_step: string | null;
  config_snapshot: object;
  steps_payload: object;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Response shape from the discovery candidate endpoints
 * in the architecture-model-service.
 *
 * Matches the JSON serialization of DiscoveryCandidateDto.java
 * with snake_case field names from @JsonProperty annotations.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 4: Candidate Fetching and Provenance Mapping Methods
 *
 * Extended in Increment 13 with review fields for
 * Candidate Review and Approval Workflow:
 * - review_status: current review state (pending_review, approved, rejected, deferred)
 * - reviewed_by: who performed the last review action (nullable)
 * - reviewed_at: when the last review action was performed (nullable ISO-8601)
 * - previous_review_status: review state before the last action (nullable)
 *
 * Model-Aware Discovery (2026-05-30) -- Task Group 4:
 * - operation: the candidate operation dimension carried on the AMS
 *   `discovery_candidate.operation` column (snake_case wire `operation`).
 *   `create` (default) mints a new entity; `enrich` adds attributes /
 *   relationships to ONE existing entity referenced BY NAME in `data`; `link`
 *   creates a logical<->physical mapping between TWO existing entities
 *   referenced BY NAME in `data`. Absent coerces to `create`.
 */
export interface DiscoveryCandidateDto {
  id: string;
  run_id: string;
  candidate_type: string;
  name: string;
  confidence: number;
  status: string;
  source_cluster_ids: string[];
  data: Record<string, any>;
  synthesized_at: string;
  parent_candidate_id: string | null;
  review_status?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  previous_review_status?: string | null;
  /**
   * Candidate operation dimension (`create` / `enrich` / `link`). Absent /
   * undefined is treated as `create` by the save-back (the AMS column default),
   * so older rows and operation-agnostic emitters round-trip as `create`.
   */
  operation?: 'create' | 'enrich' | 'link';
}

/**
 * Response shape from the candidate-entity-mapping provenance endpoints
 * in the architecture-model-service.
 *
 * Matches the JSON serialization of DiscoveryCandidateEntityMappingDto.java
 * with snake_case field names from @JsonProperty annotations.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 4: Candidate Fetching and Provenance Mapping Methods
 */
export interface CandidateEntityMappingDto {
  id: string;
  candidate_id: string;
  run_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  created_at: string;
}

/**
 * Loud-failure validator for required architectureId arguments.
 *
 * Throws synchronously if the architectureId is empty / missing. The discovery
 * save-back flow MUST never silently fall back to a legacy non-arch-scoped
 * URL: doing so corrupts cross-architecture model_files in multi-arch
 * projects. Same contract as the frontend `saveModelByFilename` fix.
 *
 * @param architectureId - The architectureId argument to validate
 * @param methodName - The calling method name, included in the error message
 * @throws Error if architectureId is undefined / null / empty
 */
function requireArchitectureId(architectureId: string | undefined | null, methodName: string): asserts architectureId is string {
  if (!architectureId || typeof architectureId !== 'string' || architectureId.trim() === '') {
    throw new Error(
      `archModelClient.${methodName}: architectureId is required and must be a non-empty string ` +
      `(legacy non-architecture-scoped URLs would corrupt cross-architecture model_files)`
    );
  }
}

// =============================================================================
// Discovery Findings -- create payload surface (Model-Aware Discovery,
// 2026-05-30, Task Group 4).
//
// The deterministic save-back core must NEVER silently drop evidence: an
// enrich/link target that has gone missing at save-back, and an attribute
// conflict against an existing entity, each become a Discovery Finding instead
// of a silent skip. Findings are persisted to the SAME AMS surface the
// discovery-service FindingEmitter uses
// (POST .../discovery/runs/{runId}/findings), so this mirrors the
// discovery-service archModelClient payload contract (camelCase in TS,
// snake_case on the wire via the mapper below). Persistence is best-effort:
// the caller soft-fails (logs a warning, continues) exactly like
// FindingEmitter, so an AMS hiccup never aborts a save-back.
// =============================================================================

/**
 * Allowed `discovery_finding_links.target_type` values. The save-back only
 * emits `architecture_element` (conflicts link to the resolved entity) and
 * `discovery_candidate` (target-gone links to the originating candidate), but
 * the full v1 set is declared for shape-compatibility with the AMS DTO.
 */
export type DiscoveryFindingLinkTargetType =
  | 'discovery_candidate'
  | 'discovery_decision_task'
  | 'discovery_relationship'
  | 'discovery_evidence'
  | 'discovery_cluster'
  | 'architecture_element';

/**
 * Link payload included inline when creating a finding.
 */
export interface DiscoveryFindingLinkPayload {
  linkType: string;
  targetType: DiscoveryFindingLinkTargetType;
  targetId: string;
  label?: string | null;
}

/**
 * Create-finding payload accepted by AMS `POST .../findings` (and, in bulk, by
 * `POST .../findings/bulk`). Scoping ids (run/project/architecture) come from
 * the URL path, not the body. camelCase here; the mapper emits snake_case.
 */
export interface DiscoveryFindingCreatePayload {
  findingType: string;
  category: string;
  severity: string;
  title: string;
  confidence?: number | null;
  status?: string;
  summary?: string | null;
  detailJson?: Record<string, unknown> | null;
  source?: string | null;
  createdByStage?: string | null;
  links?: DiscoveryFindingLinkPayload[];
}

/**
 * Maps a camelCase create payload to the snake_case body the AMS DTO expects.
 * Mirrors the discovery-service `mapFindingCreateToBackend` so both writers
 * speak the identical wire shape.
 */
function mapFindingCreateToBackend(
  payload: DiscoveryFindingCreatePayload
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    finding_type: payload.findingType,
    category: payload.category,
    severity: payload.severity,
    title: payload.title,
  };
  if (payload.confidence !== undefined) body.confidence = payload.confidence;
  if (payload.status !== undefined) body.status = payload.status;
  if (payload.summary !== undefined) body.summary = payload.summary;
  if (payload.detailJson !== undefined) body.detail_json = payload.detailJson;
  if (payload.source !== undefined) body.source = payload.source;
  if (payload.createdByStage !== undefined) body.created_by_stage = payload.createdByStage;
  if (payload.links !== undefined) {
    body.links = payload.links.map((l) => ({
      link_type: l.linkType,
      target_type: l.targetType,
      target_id: l.targetId,
      label: l.label ?? null,
    }));
  }
  return body;
}

/**
 * HTTP client for communicating with the architecture-model-service backend.
 * Provides methods for interface discovery operations.
 */
class ArchModelClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: ARCH_MODEL_SERVICE_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Lists all interfaces for a given model filename.
   *
   * @param filename - The name of the stored model file
   * @returns Promise resolving to array of interface summaries
   * @throws AxiosError with status code preserved for middleware handling
   */
  async listInterfaces(filename: string): Promise<InterfaceSummaryDto[]> {
    const response = await this.client.get<InterfaceSummaryDto[]>(
      '/api/model/interfaces',
      {
        params: { filename },
      }
    );
    return response.data;
  }

  /**
   * Gets the full OAS-ready context for a specific interface.
   *
   * @param interfaceId - The globally unique interface ID
   * @returns Promise resolving to the interface OAS context
   * @throws AxiosError with status code preserved for middleware handling
   */
  async getInterfaceOasContext(interfaceId: string): Promise<InterfaceOasContextDto> {
    const response = await this.client.get<InterfaceOasContextDto>(
      `/api/model/interfaces/${encodeURIComponent(interfaceId)}`
    );
    return response.data;
  }

  /**
   * Saves an OpenAPI specification for a specific interface.
   *
   * @param interfaceId - The globally unique interface ID
   * @param filename - The architecture filename (used as folder name)
   * @param format - The format of the OAS content: 'yaml' or 'json'
   * @param contents - The full OAS document content
   * @returns Promise resolving to the save summary including path and created flag
   * @throws AxiosError with status code preserved for middleware handling
   */
  async saveOasSpec(
    interfaceId: string,
    filename: string,
    format: string,
    contents: string
  ): Promise<SaveOasSpecSummaryDto> {
    const response = await this.client.put<SaveOasSpecSummaryDto>(
      `/api/model/interfaces/${encodeURIComponent(interfaceId)}/oas`,
      { format, contents },
      {
        params: { filename },
      }
    );
    return response.data;
  }

  /**
   * Upserts a minimal ProductDefinition record in the architecture-model-service.
   * Calls PUT /api/projects/{projectId}/product with the given product name.
   *
   * @param projectId - The project UUID
   * @param productName - The product name to upsert
   * @returns Promise resolving to the upserted ProductDefinitionDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async upsertProductDefinition(projectId: string, productName: string): Promise<ProductDefinitionDto> {
    const response = await this.client.put<ProductDefinitionDto>(
      `/api/projects/${encodeURIComponent(projectId)}/product`,
      { productName }
    );
    return response.data;
  }

  /**
   * Looks up a project by its ID from the architecture-model-service.
   * Calls GET /api/projects to list all projects, then filters by the given projectId.
   *
   * @param projectId - The project UUID to find
   * @returns Promise resolving to the matching ProjectDto
   * @throws Error with descriptive message if no project matches the given projectId
   */
  async getProjectById(projectId: string): Promise<ProjectDto> {
    const response = await this.client.get<ProjectDto[]>('/api/projects');
    const projects = response.data;
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  /**
   * Lists all architectures for a project.
   * Calls GET /api/projects/{projectId}/architectures.
   *
   * Used by non-discovery save flows (anchor entities, baseline, user journeys,
   * users interactions, discovery-run save) that don't carry an explicit
   * architectureId in their request body. Those routes resolve the project's
   * default architecture (first non-archived item per AMS ordering) and pass
   * it explicitly to the architecture-scoped putModel / getModel calls.
   *
   * @param projectId - The project UUID
   * @returns Promise resolving to the architectures list ordered by created_at ascending
   * @throws AxiosError with status code preserved for caller handling
   */
  async listArchitecturesForProject(projectId: string): Promise<ArchitectureDto[]> {
    const response = await this.client.get<ArchitectureDto[]>(
      `/api/projects/${encodeURIComponent(projectId)}/architectures`
    );
    return response.data;
  }

  /**
   * Resolves the default (first non-archived, oldest) architecture ID for a project.
   *
   * Mirrors the frontend ArchitectureContext rule: the first non-archived
   * architecture in created_at ascending order is the project's default.
   *
   * Used by non-discovery save flows that don't have an explicit architectureId
   * in their request body so they can still call the architecture-scoped
   * putModel / getModel methods. Discovery flows (save-back, save-run) MUST
   * pass an explicit architectureId from the request body and never call this
   * helper -- discovery is multi-arch by design.
   *
   * @param projectId - The project UUID
   * @returns Promise resolving to the default architecture UUID
   * @throws Error if the project has no non-archived architectures
   */
  async getDefaultArchitectureId(projectId: string): Promise<string> {
    const architectures = await this.listArchitecturesForProject(projectId);
    const defaultArch = architectures.find((a) => !a.archived_at);
    if (!defaultArch) {
      throw new Error(
        `No non-archived architecture found for project ${projectId}: ` +
        `cannot resolve default architectureId for save flow`
      );
    }
    return defaultArch.id;
  }

  /**
   * Fetches the full architecture model for a given (project, architecture)
   * pair, scoped by filename.
   *
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}?filename=X.
   *
   * Architecture-scoped form is REQUIRED: changeset 096 relaxed the legacy
   * global UNIQUE constraint on model_files.filename to a per-architecture
   * composite, so the legacy filename-only lookup is non-deterministic in
   * multi-arch projects. The non-arch-scoped form has been removed from this
   * client entirely.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param filename - The model filename (derived from project name)
   * @returns Promise resolving to the ArchitectureModelDto, or null if the model does not exist (404)
   * @throws Error if architectureId is missing
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getModel(projectId: string, architectureId: string, filename: string): Promise<any | null> {
    requireArchitectureId(architectureId, 'getModel');
    try {
      const response = await this.client.get(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`,
        {
          params: { filename },
        }
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetches the full architecture model by project + architecture pair.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @returns Promise resolving to the ArchitectureModelDto, or null if not found (404)
   * @throws Error if architectureId is missing
   * @throws AxiosError for non-404 errors
   */
  async getModelByProjectId(projectId: string, architectureId: string): Promise<any | null> {
    requireArchitectureId(architectureId, 'getModelByProjectId');
    try {
      const response = await this.client.get(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Saves the full architecture model for a given (project, architecture)
   * pair, scoped by filename.
   *
   * Calls PUT /api/model/projects/{projectId}/architectures/{architectureId}?filename=X.
   *
   * Architecture-scoped form is REQUIRED. See {@link #getModel} for the
   * underlying constraint that drives this contract.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param filename - The model filename (derived from project name)
   * @param dto - The full ArchitectureModelDto to persist
   * @returns Promise resolving to the response data from the backend
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async putModel(projectId: string, architectureId: string, filename: string, dto: any): Promise<any> {
    requireArchitectureId(architectureId, 'putModel');
    const response = await this.client.put(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`,
      dto,
      {
        params: { filename },
      }
    );
    return response.data;
  }

  /**
   * Lists all work items for a given project.
   * Calls GET /api/model/projects/{projectId}/work-items.
   *
   * @param projectId - The project UUID
   * @returns Promise resolving to array of WorkItemDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async listWorkItems(projectId: string): Promise<WorkItemDto[]> {
    const response = await this.client.get<WorkItemDto[]>(
      `/api/model/projects/${encodeURIComponent(projectId)}/work-items`
    );
    return response.data;
  }

  /**
   * Creates a new work item for a given project.
   * Calls POST /api/model/projects/{projectId}/work-items.
   *
   * @param projectId - The project UUID
   * @param dto - The partial WorkItemDto to create
   * @returns Promise resolving to the created WorkItemDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async createWorkItem(projectId: string, dto: Partial<WorkItemDto>): Promise<WorkItemDto> {
    const response = await this.client.post<WorkItemDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/work-items`,
      dto
    );
    return response.data;
  }

  /**
   * Updates an existing work item for a given project.
   * Calls PUT /api/model/projects/{projectId}/work-items/{workItemId}.
   *
   * @param projectId - The project UUID
   * @param workItemId - The work item UUID
   * @param dto - The partial WorkItemDto fields to update
   * @returns Promise resolving to the updated WorkItemDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async updateWorkItem(projectId: string, workItemId: string, dto: Partial<WorkItemDto>): Promise<WorkItemDto> {
    const response = await this.client.put<WorkItemDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}`,
      dto
    );
    return response.data;
  }

  /**
   * Deletes a work item by ID. Children are deleted via ON DELETE CASCADE in the database.
   * Calls DELETE /api/model/projects/{projectId}/work-items/{workItemId}.
   *
   * @param projectId - The project UUID
   * @param workItemId - The work item UUID to delete
   * @throws AxiosError with status code preserved for caller handling
   */
  async deleteWorkItem(projectId: string, workItemId: string): Promise<void> {
    await this.client.delete(
      `/api/model/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}`
    );
  }

  /**
   * Saves a temporary architecture diagram via the architecture-model-service.
   * Calls PUT /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}
   * with the diagram payload as the request body.
   *
   * Uses upsert semantics: if a diagram with the same (projectId, architectureId,
   * temporaryDiagramId) already exists, it will be overwritten.
   *
   * Hotfix 2026-05-13: the URL is architecture-scoped per the multi-arch
   * plumbing migration; AMS no longer registers the legacy
   * `/api/projects/{projectId}/temporary-diagrams/...` route. The previous
   * version of this method hit that legacy URL, AMS 404'd, and the frontend
   * preview then 404'd again when it tried to GET the (never-persisted)
   * diagram via the architecture-scoped URL.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param temporaryDiagramId - The client/LLM-provided diagram ID
   * @param diagramPayload - The full TemporaryArchitectureDiagram JSON object
   * @returns Promise resolving to the saved TemporaryDiagramResponseDto
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async saveTemporaryDiagram(
    projectId: string,
    architectureId: string,
    temporaryDiagramId: string,
    diagramPayload: object
  ): Promise<TemporaryDiagramResponseDto> {
    requireArchitectureId(architectureId, 'saveTemporaryDiagram');
    const response = await this.client.put<TemporaryDiagramResponseDto>(
      `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`,
      { diagram_payload: diagramPayload }
    );
    return response.data;
  }

  /**
   * Retrieves a temporary architecture diagram from the architecture-model-service.
   * Calls GET /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}.
   *
   * Returns null if the diagram does not exist (404 response).
   *
   * Hotfix 2026-05-13: see `saveTemporaryDiagram` -- URL bumped to the
   * architecture-scoped form to match AMS's only registered route.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param temporaryDiagramId - The client/LLM-provided diagram ID
   * @returns Promise resolving to the TemporaryDiagramResponseDto, or null on 404
   * @throws Error if architectureId is missing
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getTemporaryDiagram(
    projectId: string,
    architectureId: string,
    temporaryDiagramId: string
  ): Promise<TemporaryDiagramResponseDto | null> {
    requireArchitectureId(architectureId, 'getTemporaryDiagram');
    try {
      const response = await this.client.get<TemporaryDiagramResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Saves a discovery config via the architecture-model-service.
   * Calls PUT /api/model/projects/{projectId}/discovery/config
   * with the config payload and status as the request body.
   *
   * Uses upsert semantics: one config per project, overwritten on re-save.
   *
   * @param projectId - The project UUID
   * @param configPayload - The structured discovery config JSON object
   * @param status - The config lifecycle status (e.g., "DRAFT" or "COMPLETE")
   * @returns Promise resolving to the saved DiscoveryConfigResponseDto
   * @throws AxiosError with status code preserved for caller handling
   */
  async saveDiscoveryConfig(
    projectId: string,
    configPayload: object,
    status: string
  ): Promise<DiscoveryConfigResponseDto> {
    const response = await this.client.put<DiscoveryConfigResponseDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/discovery/config`,
      { config_payload: configPayload, status }
    );
    return response.data;
  }

  /**
   * Retrieves a discovery config from the architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/discovery/config.
   *
   * Returns null if no config exists for the project (404 response).
   *
   * @param projectId - The project UUID
   * @returns Promise resolving to the DiscoveryConfigResponseDto, or null on 404
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getDiscoveryConfig(
    projectId: string
  ): Promise<DiscoveryConfigResponseDto | null> {
    try {
      const response = await this.client.get<DiscoveryConfigResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/discovery/config`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Creates a project artifact via the architecture-model-service.
   * Calls POST /api/model/projects/{projectId}/artifacts/{artifactType}
   * with the content and source as the request body.
   *
   * @param projectId - The project UUID
   * @param artifactType - The artifact type (e.g., "DISCOVERY_BRIEF_MD")
   * @param content - The artifact content (e.g., markdown text)
   * @param source - The source identifier for the artifact
   * @returns Promise resolving to the created artifact response
   * @throws AxiosError with status code preserved for caller handling
   */
  async createProjectArtifact(
    projectId: string,
    artifactType: string,
    content: string,
    source: string
  ): Promise<any> {
    const response = await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactType)}`,
      { content, source }
    );
    return response.data;
  }

  /**
   * Saves (updates) a discovery run via the architecture-model-service.
   * Calls PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}.
   *
   * The discovery-run controller in the architecture-model-service was migrated
   * to architecture-scoped routes during the multi-architecture work (changesets
   * 087-091). This method follows suit.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @param discoveryRunPayload - The structured discovery run JSON object
   * @param status - The run lifecycle status (e.g., "PENDING", "RUNNING", "COMPLETED", "FAILED")
   * @returns Promise resolving to the saved DiscoveryRunResponseDto
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async saveDiscoveryRun(
    projectId: string,
    architectureId: string,
    runId: string,
    discoveryRunPayload: object,
    status: string
  ): Promise<DiscoveryRunResponseDto> {
    requireArchitectureId(architectureId, 'saveDiscoveryRun');
    const response = await this.client.put<DiscoveryRunResponseDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`,
      { status, ...discoveryRunPayload }
    );
    return response.data;
  }

  /**
   * Retrieves a discovery run from the architecture-model-service.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}.
   *
   * Returns null if the run does not exist (404 response).
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @returns Promise resolving to the DiscoveryRunResponseDto, or null on 404
   * @throws Error if architectureId is missing
   * @throws AxiosError for non-404 errors, preserved for caller handling
   */
  async getDiscoveryRun(
    projectId: string,
    architectureId: string,
    runId: string
  ): Promise<DiscoveryRunResponseDto | null> {
    requireArchitectureId(architectureId, 'getDiscoveryRun');
    try {
      const response = await this.client.get<DiscoveryRunResponseDto>(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`
      );
      return response.data;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Creates a new discovery run via the architecture-model-service.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs
   * to create a new run (the backend handles config snapshot and step initialization).
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param discoveryRunPayload - The structured discovery run JSON object
   * @returns Promise resolving to the created DiscoveryRunResponseDto
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async createDiscoveryRun(
    projectId: string,
    architectureId: string,
    discoveryRunPayload: object
  ): Promise<DiscoveryRunResponseDto> {
    requireArchitectureId(architectureId, 'createDiscoveryRun');
    const response = await this.client.post<DiscoveryRunResponseDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs`,
      discoveryRunPayload
    );
    return response.data;
  }

  // ===========================================================================
  // Discovery Candidate methods
  // ===========================================================================

  /**
   * Retrieves discovery candidates for a discovery run, optionally filtered
   * by candidate type and/or status.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates
   * with optional ?type= and ?status= query parameters.
   *
   * Migrated to the architecture-scoped URL during the multi-architecture
   * save-back migration: the underlying controller in AMS lives at
   * `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates`
   * and the legacy non-arch-scoped variant has been removed.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @param type - Optional candidate type filter (e.g., 'application', 'service')
   * @param status - Optional candidate status filter (e.g., 'proposed', 'accepted')
   * @returns Promise resolving to an array of DiscoveryCandidateDto
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async getCandidatesByRun(
    projectId: string,
    architectureId: string,
    runId: string,
    type?: string,
    status?: string
  ): Promise<DiscoveryCandidateDto[]> {
    requireArchitectureId(architectureId, 'getCandidatesByRun');
    const url = `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates`;
    const params: Record<string, string> = {};
    if (type) {
      params.type = type;
    }
    if (status) {
      params.status = status;
    }
    const response = await this.client.get<DiscoveryCandidateDto[]>(url, { params });
    return response.data;
  }

  /**
   * Updates an existing discovery candidate (e.g., for status changes after save-back).
   * Calls PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates/{candidateId}.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @param candidateId - The candidate UUID to update
   * @param update - The fields to update on the candidate
   * @returns Promise resolving to the updated DiscoveryCandidateDto
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async updateCandidate(
    projectId: string,
    architectureId: string,
    runId: string,
    candidateId: string,
    update: Partial<DiscoveryCandidateDto>
  ): Promise<DiscoveryCandidateDto> {
    requireArchitectureId(architectureId, 'updateCandidate');
    const response = await this.client.put<DiscoveryCandidateDto>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`,
      update
    );
    return response.data;
  }

  // ===========================================================================
  // Candidate Entity Mapping (Provenance) methods
  // ===========================================================================

  /**
   * Retrieves all candidate-entity provenance mappings for a given discovery run.
   * Calls GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidate-entity-mappings.
   *
   * Used by the idempotent save-back flow to detect candidates that have already
   * been saved back to the canonical model (preventing duplicate entity creation
   * on re-execution).
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @returns Promise resolving to an array of CandidateEntityMappingDto
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async getCandidateEntityMappingsByRun(
    projectId: string,
    architectureId: string,
    runId: string
  ): Promise<CandidateEntityMappingDto[]> {
    requireArchitectureId(architectureId, 'getCandidateEntityMappingsByRun');
    const response = await this.client.get<CandidateEntityMappingDto[]>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidate-entity-mappings`
    );
    return response.data;
  }

  /**
   * Persists candidate-entity provenance mappings in bulk for a given discovery run.
   * Calls POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidate-entity-mappings.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @param mappings - The candidate-entity mappings to persist
   * @returns Promise resolving to the persisted CandidateEntityMappingDto array
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkCreateCandidateEntityMappings(
    projectId: string,
    architectureId: string,
    runId: string,
    mappings: CandidateEntityMappingDto[]
  ): Promise<CandidateEntityMappingDto[]> {
    requireArchitectureId(architectureId, 'bulkCreateCandidateEntityMappings');
    const response = await this.client.post<CandidateEntityMappingDto[]>(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidate-entity-mappings`,
      mappings
    );
    return response.data;
  }

  // ===========================================================================
  // Discovery Finding methods (Model-Aware Discovery, 2026-05-30, Task Group 4)
  // ===========================================================================

  /**
   * Creates a single discovery finding under a run via
   * `POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings`.
   *
   * Used by the deterministic save-back to surface an attribute conflict
   * (architecture != reality) or a target-gone enrich/link as a reviewable
   * Finding rather than a silent drop. The body is snake_case on the wire
   * (AMS uses `property-naming-strategy: SNAKE_CASE`).
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @param payload - The finding to create (camelCase; mapped to snake_case)
   * @returns Promise resolving to the created finding row (raw AMS shape)
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async createDiscoveryFinding(
    projectId: string,
    architectureId: string,
    runId: string,
    payload: DiscoveryFindingCreatePayload
  ): Promise<any> {
    requireArchitectureId(architectureId, 'createDiscoveryFinding');
    const response = await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings`,
      mapFindingCreateToBackend(payload)
    );
    return response.data;
  }

  /**
   * Bulk-creates discovery findings under a run via
   * `POST .../discovery/runs/{runId}/findings/bulk`. The AMS request body wraps
   * the payloads in `{ findings: [...] }`, matching the discovery-service
   * `bulkCreateDiscoveryFindings` contract.
   *
   * @param projectId - The project UUID
   * @param architectureId - The architecture UUID (required, validated loudly)
   * @param runId - The discovery run UUID
   * @param payloads - The findings to create (camelCase; mapped to snake_case)
   * @returns Promise resolving to the created finding rows (raw AMS shape)
   * @throws Error if architectureId is missing
   * @throws AxiosError with status code preserved for caller handling
   */
  async bulkCreateDiscoveryFindings(
    projectId: string,
    architectureId: string,
    runId: string,
    payloads: DiscoveryFindingCreatePayload[]
  ): Promise<any[]> {
    requireArchitectureId(architectureId, 'bulkCreateDiscoveryFindings');
    const body = { findings: payloads.map(mapFindingCreateToBackend) };
    const response = await this.client.post(
      `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/findings/bulk`,
      body
    );
    return Array.isArray(response.data) ? response.data : [];
  }
}

/**
 * Singleton instance of the architecture model client
 */
export const archModelClient = new ArchModelClient();
