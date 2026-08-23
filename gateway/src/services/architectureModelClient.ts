/**
 * Client for communicating with the Architecture Model Service.
 *
 * Provides functions to resolve implement context entity and diagram IDs
 * into detailed summaries for LLM context enrichment.
 *
 * Spec: Implement Context Resolution - Iteration 3
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase (added fetchProductSummary, fetchMetaModelSummary)
 * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
 * Spec: 2026-01-16 Context Bundles Backend Expansion (added expandResolveContext, hasBundleTypeSelections, tryResolveImplementContextWithBundles)
 * Spec: 2026-01-17 Fix Context Bundle + Depth Wiring End-to-End
 *   - Task Group 3: Added normalizeEntityType(), normalizeEntitiesForExpandResolve()
 *   - Task Group 4: Added validatePdeAttributes() for PDE attribute validation
 * Spec: 2026-02-12 Increment 5 - Wire Confirmation, Mission Generation, Tool Execution
 *   - Task Group 2: Added fetchProductName()
 * Spec: 2026-03-06 Dashboard Real Data
 *   - Task Group 2: Added fetchWorkItemStats()
 * Spec: 2026-05-01 Multi-Architecture Plumbing
 *   - Task Group 3: Bucket A functions now require architectureId; added listArchitectures
 *     and resolveDefaultArchitectureId helpers. Bucket B functions are unchanged.
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5)
 *   - Task Group 2: Added lookupInterfaceArchitecture(projectId, interfaceId) helper
 *     for the gateway's derivedBindingResolver; throws InterfaceArchitectureLookupError
 *     on 404 (interface not found) so callers can map to a typed failure.
 * Spec: 2026-05-01 Multi-Architecture Full Clone (Spec #6)
 *   - Task Group 4: Added cloneArchitecture(projectId, sourceArchitectureId, payload) helper
 *     mirroring createArchitecture/updateArchitecture; throws ArchitectureModelHttpError
 *     on non-2xx so the proxy route can forward 422 archived_source / 409 duplicate_name /
 *     404 / 400 envelopes byte-for-byte.
 */

import { getConfig } from '../config';
import {
  ResolvedImplementContextDto,
  ProductSummaryDto,
  InitiativeSummary,
  EpicSummary,
  FeatureSummary,
  MetaModelSummaryDto,
  EntityBundleSelection,
  DiagramBundleSelection,
  ExpandResolveResponseDto,
  ArchitectureContext,
  ChatContext,
  ResolvedEntitySummary,
} from '../types';
import { logger } from './logger';

/**
 * Canonical mapping for entity type keys.
 *
 * Maps snake_case entity type keys (from frontend MetaModelEntities interface)
 * to camelCase keys (expected by the model-service resolver).
 *
 * Keys not in this map pass through unchanged (e.g., services, classes, methods,
 * interfaces, applications, endpoints).
 *
 * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
 */
export const ENTITY_TYPE_CANONICAL_MAP: Record<string, string> = {
  physical_data_entities: 'physicalDataEntities',
  logical_data_entities: 'logicalDataEntities',
  app_components: 'appComponents',
  business_processes: 'businessProcesses',
  business_points: 'businessPoints',
  process_activities: 'businessPoints', // Special mapping: process_activities maps to businessPoints in resolver
  ui_screens: 'uiScreens',
};

/**
 * Normalizes an entity type by converting snake_case to camelCase.
 *
 * Uses the ENTITY_TYPE_CANONICAL_MAP to convert known snake_case types.
 * Unknown types pass through unchanged.
 *
 * Spec: 2026-01-17 Fix Context Bundle + Depth Wiring End-to-End - Task Group 3
 *
 * @param entityType - The entity type to normalize (e.g., "physical_data_entities")
 * @returns Normalized entity type (e.g., "physicalDataEntities")
 */
export function normalizeEntityType(entityType: string): string {
  if (!entityType) {
    return entityType;
  }

  // Look up in canonical mapping
  const canonicalType = ENTITY_TYPE_CANONICAL_MAP[entityType];
  if (canonicalType) {
    return canonicalType;
  }

  // Not in mapping, pass through unchanged
  return entityType;
}

/**
 * Normalizes an entity type ID by converting snake_case entity types to camelCase.
 *
 * Parses the entity ID on the `::` delimiter to extract the entityType and entityId parts.
 * If the entityType is in the canonical mapping table, it is replaced with the canonical form.
 * Otherwise, the entityType passes through unchanged.
 *
 * @param typedEntityId - Entity ID in format "entityType::entityId"
 * @returns Normalized entity ID with canonical entityType
 *
 * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
 */
export function normalizeEntityTypeId(typedEntityId: string): string {
  if (!typedEntityId) {
    return typedEntityId;
  }

  const delimiterIndex = typedEntityId.indexOf('::');
  if (delimiterIndex <= 0) {
    // No valid delimiter found, return unchanged
    return typedEntityId;
  }

  const entityType = typedEntityId.substring(0, delimiterIndex);
  const entityId = typedEntityId.substring(delimiterIndex + 2);

  // Use normalizeEntityType to get canonical form
  const canonicalType = normalizeEntityType(entityType);

  if (canonicalType !== entityType) {
    // Found in mapping, use canonical type
    return `${canonicalType}::${entityId}`;
  }

  // Not in mapping, pass through unchanged
  // Log debug warning for unmapped types that look like snake_case
  if (entityType.includes('_')) {
    logger.debug('Unmapped snake_case entity type encountered (passing through unchanged)', {
      entityType,
      typedEntityId,
    });
  }

  return typedEntityId;
}

/**
 * Normalizes entity_type fields in an array of EntityBundleSelection objects.
 *
 * Applies normalizeEntityType() to each entity's entity_type field to convert
 * snake_case types to camelCase before calling expandResolveContext().
 *
 * Spec: 2026-01-17 Fix Context Bundle + Depth Wiring End-to-End - Task Group 3
 *
 * @param entities - Array of EntityBundleSelection objects from frontend
 * @returns Array of EntityBundleSelection with normalized entity_type fields
 */
export function normalizeEntitiesForExpandResolve(
  entities: EntityBundleSelection[] | undefined | null
): EntityBundleSelection[] {
  if (!entities || !Array.isArray(entities)) {
    return [];
  }

  return entities.map((entity) => ({
    ...entity,
    entity_type: normalizeEntityType(entity.entity_type),
  }));
}

// ============================================================================
// PDE Attribute Validation
// Spec: 2026-01-17 Fix Context Bundle + Depth Wiring End-to-End - Task Group 4
// ============================================================================

/**
 * Result of PDE attribute validation.
 */
export interface PdeAttributeValidationResult {
  /** True if all PDEs have attributes, false otherwise */
  valid: boolean;
  /** List of PDE entity IDs missing attributes */
  missingEntityIds: string[];
}

/**
 * Validates that resolved physicalDataEntities have relevant_fields.attributes populated.
 *
 * This validation ensures that PDEs have their attribute metadata available for
 * the LLM prompt. When attributes are missing, the LLM won't have complete schema
 * information to generate accurate code.
 *
 * Spec: 2026-01-17 Fix Context Bundle + Depth Wiring End-to-End - Task Group 4
 *
 * @param resolvedEntities - Array of resolved entity summaries from expand-resolve
 * @returns PdeAttributeValidationResult with valid flag and list of missing entity IDs
 */
export function validatePdeAttributes(
  resolvedEntities: ResolvedEntitySummary[]
): PdeAttributeValidationResult {
  const missingEntityIds: string[] = [];

  if (!resolvedEntities || !Array.isArray(resolvedEntities)) {
    return { valid: true, missingEntityIds: [] };
  }

  for (const entity of resolvedEntities) {
    // Only validate physicalDataEntities
    if (entity.entity_type !== 'physicalDataEntities') {
      continue;
    }

    // Check if relevant_fields.attributes exists and is non-empty
    const relevantFields = entity.relevant_fields;
    if (!relevantFields) {
      missingEntityIds.push(entity.id);
      continue;
    }

    const attributes = relevantFields.attributes as unknown[];
    if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
      missingEntityIds.push(entity.id);
    }
  }

  const valid = missingEntityIds.length === 0;

  // Log error if attributes are missing
  if (!valid) {
    logger.error('Physical Data Entities missing attributes in resolved context', {
      missingCount: missingEntityIds.length,
      missingEntityIds,
      hint: 'PDEs should have relevant_fields.attributes populated. Check depth parameter and expansion service.',
    });
  }

  return { valid, missingEntityIds };
}

/**
 * Resolves entity and diagram IDs into detailed summaries by calling
 * the architecture-model-service backend API.
 *
 * @param projectId - The project ID (filename)
 * @param entityIds - List of entity IDs in format "entityType::entityId"
 * @param diagramIds - List of diagram IDs
 * @returns ResolvedImplementContextDto with resolved entities and diagrams, or null on error
 */
export async function resolveImplementContext(
  projectId: string,
  entityIds: string[],
  diagramIds: string[]
): Promise<ResolvedImplementContextDto | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/implement-context/resolve`;

  // Normalize entity IDs before sending to resolver
  // Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
  const normalizedEntityIds = (entityIds || []).map(normalizeEntityTypeId);

  logger.debug('Calling architecture-model-service to resolve implement context', {
    projectId,
    entityIdsCount: entityIds?.length || 0,
    normalizedEntityIdsCount: normalizedEntityIds.length,
    diagramIdsCount: diagramIds?.length || 0,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        selected_entity_ids: normalizedEntityIds,
        selected_diagram_ids: diagramIds || [],
      }),
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for context resolution', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as ResolvedImplementContextDto;

    logger.debug('Successfully resolved implement context', {
      projectId,
      resolvedEntitiesCount: data.resolved_entities?.length || 0,
      resolvedDiagramsCount: data.resolved_diagrams?.length || 0,
    });

    return data;
  } catch (error) {
    logger.warn('Failed to resolve implement context from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Raw work item shape returned by GET /api/model/projects/{id}/work-items.
 */
interface WorkItemRaw {
  id: string;
  type: string;            // 'INITIATIVE', 'EPIC', 'FEATURE', 'STORY'
  parent_id: string | null;
  title: string;
  description: string | null;
  priority: number | null;
  sort_order: number;
}

/**
 * Fetches the Product Book of Work summary for a project.
 *
 * Calls the work-items endpoint and assembles a hierarchical ProductSummaryDto
 * (Initiatives > Epics > Features) from the flat work item list.
 * Stories are excluded for conciseness.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 * Fix: Rewrites non-existent /product-summary call to use /work-items endpoint
 *
 * @param projectId - The project ID (filename)
 * @returns ProductSummaryDto with hierarchical work items, or null on error
 */
export async function fetchProductSummary(
  projectId: string
): Promise<ProductSummaryDto | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;

  logger.debug('Fetching work items for product summary from architecture-model-service', {
    projectId,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for work items', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const workItems = await response.json() as WorkItemRaw[];

    if (!Array.isArray(workItems) || workItems.length === 0) {
      logger.debug('No work items found for project', { projectId });
      return { initiatives: [] };
    }

    // Filter by relevant types
    const initiatives = workItems.filter((wi) => wi.type === 'INITIATIVE');
    const epics = workItems.filter((wi) => wi.type === 'EPIC');
    const features = workItems.filter((wi) => wi.type === 'FEATURE');

    // Group features by parent_id (epic id)
    const featuresByParent = new Map<string, FeatureSummary[]>();
    for (const f of features) {
      if (f.parent_id) {
        const list = featuresByParent.get(f.parent_id) || [];
        list.push({ id: f.id, title: f.title, description: f.description || '' });
        featuresByParent.set(f.parent_id, list);
      }
    }

    // Build EpicSummary objects with nested features
    const initiativeIds = new Set(initiatives.map((i) => i.id));
    const epicSummariesById = new Map<string, EpicSummary>();
    const orphanEpics: EpicSummary[] = [];

    for (const e of epics) {
      const epicSummary: EpicSummary = {
        id: e.id,
        title: e.title,
        description: e.description || '',
        features: featuresByParent.get(e.id) || [],
        priority: e.priority ?? null,
        sortOrder: e.sort_order ?? 0,
      };
      epicSummariesById.set(e.id, epicSummary);

      if (!e.parent_id || !initiativeIds.has(e.parent_id)) {
        orphanEpics.push(epicSummary);
      }
    }

    // Group epics by parent_id (initiative id)
    const epicsByParent = new Map<string, EpicSummary[]>();
    for (const e of epics) {
      if (e.parent_id && initiativeIds.has(e.parent_id)) {
        const list = epicsByParent.get(e.parent_id) || [];
        list.push(epicSummariesById.get(e.id)!);
        epicsByParent.set(e.parent_id, list);
      }
    }

    // Build InitiativeSummary objects with nested epics
    const result: InitiativeSummary[] = initiatives.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description || '',
      epics: epicsByParent.get(i.id) || [],
    }));

    // Add synthetic initiative for orphan epics
    if (orphanEpics.length > 0) {
      result.push({
        id: '',
        title: '',
        description: '',
        epics: orphanEpics,
      });
    }

    logger.debug('Successfully assembled product summary from work items', {
      projectId,
      initiativesCount: result.length,
      epicsCount: epics.length,
      featuresCount: features.length,
    });

    return { initiatives: result };
  } catch (error) {
    logger.warn('Failed to fetch product summary from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Fetches the product name for a project from the architecture-model-service.
 *
 * Calls GET /api/projects/{projectId}/product and extracts the product_name field.
 * Returns null on HTTP error, network error, or missing/empty product_name.
 *
 * Spec: 2026-02-12 Increment 5 - Wire Confirmation, Mission Generation, Tool Execution
 * Task Group 2: fetchProductName function
 *
 * @param projectId - The project ID (filename)
 * @returns The product name string, or null on error or missing data
 */
export async function fetchProductName(
  projectId: string
): Promise<string | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/product`;

  logger.debug('Fetching product name from architecture-model-service', {
    projectId,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for product name', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const productName = data.product_name;

    if (!productName || typeof productName !== 'string' || productName.trim().length === 0) {
      logger.warn('Product name is missing or empty in architecture model service response', {
        projectId,
        hasProductName: !!productName,
      });
      return null;
    }

    logger.debug('Successfully fetched product name', {
      projectId,
      productName,
    });

    return productName;
  } catch (error) {
    logger.warn('Failed to fetch product name from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// fetchProjectFolder -- module-level cache
// Project folders are immutable at runtime, so we cache them permanently.
// ---------------------------------------------------------------------------

const projectFolderCache = new Map<string, string>();

/**
 * Fetches the project_parent_folder for a project from the architecture-model-service.
 *
 * Calls GET /api/projects/{projectId} to get the project DTO and extracts project_parent_folder.
 * Results are cached in a module-level Map (project folders are immutable at runtime).
 *
 * @param projectId - The project ID (UUID string)
 * @returns The project parent folder string, or null on failure
 */
export async function fetchProjectFolder(
  projectId: string
): Promise<string | null> {
  // Return cached value if available
  const cached = projectFolderCache.get(projectId);
  if (cached !== undefined) {
    return cached;
  }

  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}`;

  logger.debug('Fetching project folder from architecture-model-service', {
    projectId,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for project folder', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const folder = data.project_parent_folder;
    if (folder && typeof folder === 'string' && folder.trim().length > 0) {
      projectFolderCache.set(projectId, folder);
      logger.debug('Successfully fetched project folder', { projectId, folder });
      return folder;
    }

    logger.warn('project_parent_folder missing or empty in project response', { projectId });
    return null;
  } catch (error) {
    logger.warn('Failed to fetch project folder from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ============================================================================
// fetchProjectConfig -- per-project shape-spec generation config
// Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 9
// ============================================================================

/**
 * Shape of the per-project shape-spec generation config carried on the
 * `project` row. The three fields are NULL-tolerant so the gateway can
 * distinguish "not set" from "explicitly disabled"; callers that need a
 * defaulted view should apply DEFAULT_*_TOKEN_CAP / DEFAULT_AUTO_RUN_PASS_2
 * after reading.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 9
 */
export interface ProjectSpecGenerationConfig {
  perStoryContextTokenCap: number | null;
  crossStoryContextTokenCap: number | null;
  autoRunPass2: boolean | null;
}

/** Default per-story token cap when project config is null (mirrors AMS BudgetMetaTracker). */
export const DEFAULT_PER_STORY_TOKEN_CAP = 24000;

/** Default cross-story token cap when project config is null (mirrors AMS BudgetMetaTracker). */
export const DEFAULT_CROSS_STORY_TOKEN_CAP = 12000;

/** Default auto-run-pass-2 flag when project config is null. */
export const DEFAULT_AUTO_RUN_PASS_2 = true;

/**
 * Fetches the per-project shape-spec generation config for the bounded
 * two-pass loop. Calls GET /api/projects/{projectId} and projects out
 * the three Task-Group-9 fields. Returns null on failure (404 / network
 * error) so callers can fall back to the DEFAULT_* constants.
 *
 * Cost-preview, the gateway batch handler, and the per-batch override
 * dialog all read these via this helper -- it is the single canonical
 * surface for the per-project config on the gateway side.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 9
 * @param projectId - The project ID (UUID string)
 * @returns The config object, or null on failure
 */
export async function fetchProjectConfig(
  projectId: string
): Promise<ProjectSpecGenerationConfig | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK for project config', {
        projectId,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const perStory = data.per_story_context_token_cap;
    const crossStory = data.cross_story_context_token_cap;
    const autoRun = data.auto_run_pass_2;

    return {
      perStoryContextTokenCap:
        typeof perStory === 'number' ? perStory : null,
      crossStoryContextTokenCap:
        typeof crossStory === 'number' ? crossStory : null,
      autoRunPass2: typeof autoRun === 'boolean' ? autoRun : null,
    };
  } catch (error) {
    logger.warn('Failed to fetch project config from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Reads the per-project shape-spec generation config and applies the
 * documented defaults for any null field. The cost-preview endpoint and
 * the batch handler call this when they need a fully-defaulted view.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 9
 */
export async function fetchProjectConfigWithDefaults(
  projectId: string
): Promise<{
  perStoryContextTokenCap: number;
  crossStoryContextTokenCap: number;
  autoRunPass2: boolean;
}> {
  const config = await fetchProjectConfig(projectId);
  return {
    perStoryContextTokenCap:
      config?.perStoryContextTokenCap ?? DEFAULT_PER_STORY_TOKEN_CAP,
    crossStoryContextTokenCap:
      config?.crossStoryContextTokenCap ?? DEFAULT_CROSS_STORY_TOKEN_CAP,
    autoRunPass2: config?.autoRunPass2 ?? DEFAULT_AUTO_RUN_PASS_2,
  };
}

// ============================================================================
// Implementation-Service Init Persistence (project init-status + repo map)
// Spec: 2026-06-12 Implementation-Service Init and Integration Repair - TG2
// ============================================================================

/**
 * One entry of the implementation-service workspace repo map as stored in AMS
 * (`project_implementation_repos`). snake_case on the wire (AMS global
 * Jackson strategy).
 */
export interface ImplementationRepo {
  folder: string;
  gitUrl: string;
  workspaceDir: string | null;
  mode: string | null;
}

/**
 * Persists the implementation-service init status onto the AMS project row
 * via PATCH /api/projects/{projectId}. Null-guarded on the AMS side: omitted
 * fields are left unchanged (boxed types -- a failed init writes ONLY
 * init_success=false and never wipes a previously stored mode/project_dir).
 *
 * Returns true on success, false on any failure (logged; callers surface a
 * `persisted` flag rather than failing the route).
 *
 * Spec: 2026-06-12 Implementation-Service Init and Integration Repair - TG2
 */
export async function updateProjectImplementationInit(
  projectId: string,
  init: {
    initSuccess: boolean;
    mode?: string | null;
    projectDir?: string | null;
  }
): Promise<boolean> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}`;

  const body: Record<string, unknown> = {
    implementation_init_success: init.initSuccess,
  };
  if (init.mode != null) {
    body.implementation_mode = init.mode;
  }
  if (init.projectDir != null) {
    body.implementation_project_dir = init.projectDir;
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.warn('AMS returned non-OK persisting implementation init status', {
        projectId,
        status: response.status,
      });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn('Failed to persist implementation init status to AMS', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Replaces the AMS-stored workspace repo map wholesale via
 * PUT /api/projects/{projectId}/implementation-repos. This is the drift
 * auto-sync target: the external implementation service is the source of
 * truth for what is cloned, and the gateway writes its reported map here
 * (AMS never pushes its stored map upstream).
 *
 * Returns true on success, false on any failure (logged).
 *
 * Spec: 2026-06-12 Implementation-Service Init and Integration Repair - TG2
 */
export async function replaceProjectImplementationRepos(
  projectId: string,
  repos: ImplementationRepo[]
): Promise<boolean> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/implementation-repos`;

  const body = {
    repos: repos.map((repo) => ({
      folder: repo.folder,
      git_url: repo.gitUrl,
      workspace_dir: repo.workspaceDir ?? null,
      mode: repo.mode ?? null,
    })),
  };

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.warn('AMS returned non-OK replacing implementation repo map', {
        projectId,
        status: response.status,
      });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn('Failed to replace implementation repo map in AMS', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Fetches the AMS-stored workspace repo map for a project (reads the
 * `implementation_repos` list attached to GET /api/projects/{projectId}).
 * Returns null on failure so callers can degrade gracefully (e.g. report
 * `changed=false` when no comparison is possible).
 *
 * Spec: 2026-06-12 Implementation-Service Init and Integration Repair - TG2
 */
export async function fetchProjectImplementationRepos(
  projectId: string
): Promise<ImplementationRepo[] | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      logger.warn('AMS returned non-OK fetching implementation repo map', {
        projectId,
        status: response.status,
      });
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    const rawRepos = data.implementation_repos;
    if (!Array.isArray(rawRepos)) {
      return [];
    }
    return rawRepos
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        folder: typeof r.folder === 'string' ? r.folder : '',
        gitUrl: typeof r.git_url === 'string' ? r.git_url : '',
        workspaceDir: typeof r.workspace_dir === 'string' ? r.workspace_dir : null,
        mode: typeof r.mode === 'string' ? r.mode : null,
      }));
  } catch (error) {
    logger.warn('Failed to fetch implementation repo map from AMS', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ============================================================================
// Architectures (Bucket A list endpoint + Default resolver)
// Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3
// ============================================================================

/**
 * Architecture DTO returned by the new list endpoint.
 *
 * Mirrors the shape of architecture-model-service's `ArchitectureDto`
 * (a Java record). Tags are surfaced as a flat string list mapped from
 * the ArchitectureTagEntity join table.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing
 */
export interface Architecture {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lists all architectures for a project.
 *
 * Calls GET /api/projects/{projectId}/architectures and returns the array
 * (ordered by created_at ascending per the backend service contract).
 * Returns null on error so callers can degrade gracefully.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3
 *
 * @param projectId - The project ID (UUID string)
 * @returns Array of Architecture DTOs, or null on error
 */
export async function listArchitectures(
  projectId: string
): Promise<Architecture[] | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures`;

  logger.debug('Listing architectures from architecture-model-service', {
    projectId,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for list architectures', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as Architecture[];
    if (!Array.isArray(data)) {
      logger.warn('listArchitectures response was not an array', { projectId });
      return null;
    }

    logger.debug('Successfully listed architectures', {
      projectId,
      count: data.length,
    });

    return data;
  } catch (error) {
    logger.warn('Failed to list architectures from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Error thrown by mutation client functions (`createArchitecture`,
 * `updateArchitecture`, `archiveArchitecture`, `cloneArchitecture`) when the
 * architecture-model service returns a non-2xx response.
 *
 * Carries the upstream HTTP `status` and parsed JSON `body` so the gateway
 * proxy route can re-emit them byte-for-byte to the frontend. The frontend
 * then branches on `body.code` (e.g. `duplicate_name`, `last_architecture`)
 * and `body.field` to render inline validation messages.
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 2
 */
export class ArchitectureModelHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message || `Architecture model service responded ${status}`);
    this.name = 'ArchitectureModelHttpError';
    this.status = status;
    this.body = body;
  }
}

async function readBodyOrEmpty(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

/**
 * Payload for `createArchitecture`.
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management
 */
export interface CreateArchitecturePayload {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Payload for `updateArchitecture` (PATCH).
 *
 * `tags` is required (the empty array clears all tags). The full set is
 * replaced atomically alongside `name` and `description`.
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management
 */
export interface UpdateArchitecturePayload {
  name: string;
  description?: string;
  tags: string[];
}

/**
 * Creates a new architecture in a project.
 *
 * Calls POST /api/projects/{projectId}/architectures.
 * Returns the created Architecture DTO on success (HTTP 201).
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim (e.g. 409 duplicate
 * name, 400 validation, 404 missing project).
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 2
 *
 * @param projectId - The project ID (UUID string)
 * @param payload - {name, description?, tags?}
 * @returns The created Architecture DTO
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function createArchitecture(
  projectId: string,
  payload: CreateArchitecturePayload
): Promise<Architecture> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures`;

  logger.debug('Creating architecture in architecture-model-service', {
    projectId,
    url,
    name: payload?.name,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for create architecture', {
      projectId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as Architecture;
}

/**
 * Updates an architecture (PATCH -- name + description + full tag replacement).
 *
 * Calls PATCH /api/projects/{projectId}/architectures/{architectureId}.
 * Returns the updated Architecture DTO on success (HTTP 200).
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim (e.g. 409 duplicate
 * name, 400 validation, 404 wrong project).
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 2
 *
 * @param projectId - The project ID (UUID string)
 * @param architectureId - The architecture ID (UUID string)
 * @param payload - {name, description?, tags} -- empty tags array clears tags
 * @returns The updated Architecture DTO
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function updateArchitecture(
  projectId: string,
  architectureId: string,
  payload: UpdateArchitecturePayload
): Promise<Architecture> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;

  logger.debug('Updating architecture in architecture-model-service', {
    projectId,
    architectureId,
    url,
    name: payload?.name,
  });

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for update architecture', {
      projectId,
      architectureId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as Architecture;
}

/**
 * Archives (soft-deletes) an architecture.
 *
 * Calls POST /api/projects/{projectId}/architectures/{architectureId}/archive.
 * Returns the updated Architecture DTO with `archived: true` on success.
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim (e.g. 422
 * last-architecture protection, 404 missing).
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 2
 *
 * @param projectId - The project ID (UUID string)
 * @param architectureId - The architecture ID (UUID string)
 * @returns The updated Architecture DTO with archived=true
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function archiveArchitecture(
  projectId: string,
  architectureId: string
): Promise<Architecture> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/archive`;

  logger.debug('Archiving architecture in architecture-model-service', {
    projectId,
    architectureId,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for archive architecture', {
      projectId,
      architectureId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as Architecture;
}

/**
 * Payload for `cloneArchitecture`.
 *
 * Same shape as `CreateArchitecturePayload`: the new architecture name +
 * optional description + optional tag list. Tags default to empty (the
 * `CloneArchitectureModal` deliberately starts with no chips pre-loaded so
 * the user opts in to any inherited classification).
 *
 * Spec: 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 4
 */
export interface CloneArchitecturePayload {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Full-clones an existing architecture in a project.
 *
 * Calls POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone.
 * Returns the newly created Architecture DTO on success (HTTP 201). The
 * upstream service performs the entire clone (architecture row + every
 * architecture-scoped meta-model row) inside a single `@Transactional`
 * boundary so a partial clone never leaks.
 *
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim:
 *  - 422 `{code: "archived_source", message: ...}` -- source is archived
 *  - 409 `{code: "duplicate_name", field: "name", message: ...}` -- name conflict
 *  - 404 -- source architecture not found in this project
 *  - 400 -- validation failure (empty name, name >100 chars, etc.)
 *
 * Spec: 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 4
 *
 * @param projectId             - The project ID (UUID string)
 * @param sourceArchitectureId  - The source architecture ID to clone from (UUID string)
 * @param payload               - {name, description?, tags?}
 * @returns The newly created Architecture DTO
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function cloneArchitecture(
  projectId: string,
  sourceArchitectureId: string,
  payload: CloneArchitecturePayload
): Promise<Architecture> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(sourceArchitectureId)}/clone`;

  logger.debug('Cloning architecture in architecture-model-service', {
    projectId,
    sourceArchitectureId,
    url,
    name: payload?.name,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for clone architecture', {
      projectId,
      sourceArchitectureId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as Architecture;
}

/**
 * In-flight cache for the default-architecture resolver.
 *
 * Keyed by projectId. Stores the in-flight Promise so concurrent callers
 * for the same project share a single upstream HTTP request, but lookups
 * for different projects are independent. Successful results stay cached
 * for the lifetime of the gateway process (architectures rarely move
 * status; the only Default-affecting mutation in spec #1 is the migration
 * itself, which runs at backend startup).
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3
 */
const defaultArchitectureCache = new Map<string, Promise<string | null>>();

/**
 * Resolves the project's `Default` architecture id (oldest non-archived).
 *
 * Calls listArchitectures(projectId) and returns the id of the oldest
 * non-archived architecture (matches the frontend + discovery-service
 * resolution rule). Returns null if the list call fails or no
 * non-archived architecture exists.
 *
 * Cached per-project for the lifetime of the gateway process.
 *
 * Used by gateway-internal Bucket A callers (bootstrap / dashboard /
 * context resolvers) that don't have an `architectureId` from the
 * incoming request and need to fall back to the project's Default.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3
 *
 * @param projectId - The project ID (UUID string)
 * @returns The Default architecture id, or null on error / no architectures
 */
export function resolveDefaultArchitectureId(
  projectId: string
): Promise<string | null> {
  const cached = defaultArchitectureCache.get(projectId);
  if (cached !== undefined) {
    return cached;
  }

  const inFlight = (async () => {
    const architectures = await listArchitectures(projectId);
    if (!architectures || architectures.length === 0) {
      logger.warn('No architectures returned for project; cannot resolve Default', { projectId });
      return null;
    }
    // Pick oldest non-archived (the list is already ordered by created_at asc).
    const nonArchived = architectures.filter((a) => !a.archived);
    if (nonArchived.length === 0) {
      logger.warn('All architectures for project are archived; cannot resolve Default', { projectId });
      return null;
    }
    return nonArchived[0].id;
  })();

  // Cache the promise so concurrent callers share a single upstream call.
  defaultArchitectureCache.set(projectId, inFlight);

  // On failure, evict so the next caller retries.
  inFlight.catch(() => {
    defaultArchitectureCache.delete(projectId);
  });

  return inFlight;
}

/**
 * Test-only helper to reset the default-architecture cache.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3
 */
export function _resetDefaultArchitectureCache(): void {
  defaultArchitectureCache.clear();
}

/**
 * Fetches the architecture meta-model summary for a project's architecture.
 *
 * Returns services, data entities, interfaces, and relationships scoped to
 * the given (projectId, architectureId) pair. All entities are resolved to
 * human-readable names.
 *
 * Bucket A endpoint: requires a valid `architectureId` path segment. Forgetting
 * it produces a 404 at the backend (no silent fallback).
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 * Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3
 *   - Now requires architectureId; URL changed to embed it as a path segment.
 *
 * @param projectId - The project ID (UUID string)
 * @param architectureId - The architecture ID (UUID string) -- REQUIRED
 * @returns MetaModelSummaryDto with all entities and relationships, or null on error
 */
export async function fetchMetaModelSummary(
  projectId: string,
  architectureId: string
): Promise<MetaModelSummaryDto | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/meta-model-summary`;

  logger.debug('Fetching meta-model summary from architecture-model-service', {
    projectId,
    architectureId,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for meta-model summary', {
        projectId,
        architectureId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as MetaModelSummaryDto;

    logger.debug('Successfully fetched meta-model summary', {
      projectId,
      architectureId,
      servicesCount: data.services?.length || 0,
      dataEntitiesCount: data.data_entities?.length || 0,
      interfacesCount: data.interfaces?.length || 0,
      relationshipsCount: data.relationships?.length || 0,
    });

    return data;
  } catch (error) {
    logger.warn('Failed to fetch meta-model summary from architecture model service', {
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ============================================================================
// Work Item Stats
// Spec: 2026-03-06 Dashboard Real Data - Task Group 2
// ============================================================================

/**
 * Response shape from GET /api/model/projects/{projectId}/work-items/stats.
 *
 * Uses snake_case field names to match the Java backend's JSON output
 * (consistent with how all other client interfaces in this file use
 * the backend's casing directly).
 */
export interface WorkItemStatsResponse {
  /** Nested map: outer key = work item type (EPIC, FEATURE, STORY, etc.), inner key = status, value = count */
  type_counts: Record<string, Record<string, number>>;
  /** Count of STORYs where description is non-null and non-empty */
  stories_with_ac_count: number;
}

/**
 * Fetches work item statistics for a project.
 *
 * Calls GET /api/model/projects/{projectId}/work-items/stats and returns
 * type-status counts and stories-with-AC count.
 *
 * Follows the identical pattern of fetchProductSummary: config baseUrl,
 * GET fetch, try-catch returning null on error, logger.warn on failure.
 *
 * Spec: 2026-03-06 Dashboard Real Data - Task Group 2
 *
 * @param projectId - The project ID (UUID string)
 * @returns WorkItemStatsResponse with type counts and stories with AC count, or null on error
 */
export async function fetchWorkItemStats(
  projectId: string
): Promise<WorkItemStatsResponse | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items/stats`;

  logger.debug('Fetching work item stats from architecture-model-service', {
    projectId,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for work item stats', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as WorkItemStatsResponse;

    logger.debug('Successfully fetched work item stats', {
      projectId,
      typeCountKeys: data.type_counts ? Object.keys(data.type_counts) : [],
      storiesWithAcCount: data.stories_with_ac_count ?? 0,
    });

    return data;
  } catch (error) {
    logger.warn('Failed to fetch work item stats from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Expands entity and diagram bundle selections into detailed summaries by calling
 * the architecture-model-service expand-resolve endpoint.
 *
 * This function supports bundle-based context expansion where each entity/diagram
 * can specify a bundle_type to determine how much related context to include.
 *
 * Bundle types for entities:
 * - interface_only, interface_with_endpoints, interface_with_endpoints_and_schemas
 * - service_only, service_with_parents_and_children
 * - entity_only, entity_with_attributes_and_relationships
 *
 * Bundle types for diagrams:
 * - diagram_only
 *
 * Spec: 2026-01-16 Context Bundles Backend Expansion
 * Spec: 2026-01-17 Fix Context Bundle + Depth Wiring End-to-End - Task Group 3
 *   - Added entity type normalization before API call
 *   - Added PDE attribute validation after response (Task Group 4)
 *
 * @param projectId - The project ID (filename)
 * @param selectedEntities - Array of entity bundle selections with entity_type, entity_id, bundle_type
 * @param selectedDiagrams - Array of diagram bundle selections with diagram_id, bundle_type
 * @returns ExpandResolveResponseDto with expanded IDs and resolved summaries, or null on error
 */
export async function expandResolveContext(
  projectId: string,
  selectedEntities: EntityBundleSelection[],
  selectedDiagrams: DiagramBundleSelection[]
): Promise<ExpandResolveResponseDto | null> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/implement-context/expand-resolve`;

  // Spec 2026-01-17 Task Group 3: Normalize entity types before sending to backend
  const normalizedEntities = normalizeEntitiesForExpandResolve(selectedEntities);

  logger.debug('Calling architecture-model-service to expand-resolve context', {
    projectId,
    selectedEntitiesCount: selectedEntities?.length || 0,
    selectedDiagramsCount: selectedDiagrams?.length || 0,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        selected_entities: normalizedEntities || [],
        selected_diagrams: selectedDiagrams || [],
      }),
    });

    if (!response.ok) {
      logger.warn('Architecture model service returned non-OK response for expand-resolve', {
        projectId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as ExpandResolveResponseDto;

    logger.debug('Successfully expanded and resolved context', {
      projectId,
      expandedEntityIdsCount: data.expanded_entity_ids?.length || 0,
      expandedDiagramIdsCount: data.expanded_diagram_ids?.length || 0,
      resolvedEntitiesCount: data.resolved_entities?.length || 0,
      resolvedDiagramsCount: data.resolved_diagrams?.length || 0,
      truncated: data.truncated,
    });

    // Log warning if results were truncated
    if (data.truncated) {
      logger.warn('Expand-resolve results were truncated due to limits', {
        projectId,
        truncationReason: data.truncation_reason,
      });
    }

    // Spec 2026-01-17 Task Group 4: Validate PDE attributes
    // This logs an error if PDEs are missing attributes, but processing continues
    validatePdeAttributes(data.resolved_entities || []);

    return data;
  } catch (error) {
    logger.warn('Failed to expand-resolve context from architecture model service', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Checks if the architecture context contains bundle type selections.
 *
 * Returns true if either:
 * - architectureContext.entities has any item with bundle_type field
 * - architectureContext.diagrams has any item with bundle_type field
 *
 * Spec: 2026-01-16 Context Bundles Backend Expansion - Task Group 9
 *
 * @param architectureContext - The architecture context to check
 * @returns true if bundle_type selections are present, false otherwise
 */
export function hasBundleTypeSelections(
  architectureContext: ArchitectureContext | undefined | null
): boolean {
  if (!architectureContext) {
    return false;
  }

  // Check if entities array has any items with bundle_type
  const hasEntityBundles =
    Array.isArray(architectureContext.entities) &&
    architectureContext.entities.length > 0 &&
    architectureContext.entities.some((e) => e && e.bundle_type);

  // Check if diagrams array has any items with bundle_type
  const hasDiagramBundles =
    Array.isArray(architectureContext.diagrams) &&
    architectureContext.diagrams.length > 0 &&
    architectureContext.diagrams.some((d) => d && d.bundle_type);

  return hasEntityBundles || hasDiagramBundles;
}

/**
 * Resolves implement context using either expand-resolve or standard resolve,
 * depending on whether bundle_type selections are present.
 *
 * - If bundle_type is present in entities/diagrams: calls expandResolveContext()
 * - If no bundle_type present: calls resolveImplementContext()
 * - Transforms ExpandResolveResponseDto to ResolvedImplementContextDto for compatibility
 * - Logs truncation warning if expand-resolve returns truncated=true
 *
 * Spec: 2026-01-16 Context Bundles Backend Expansion - Task Group 9
 *
 * @param context - The chat context containing architectureContext
 * @param requestId - Request ID for logging
 * @returns ResolvedImplementContextDto or null
 */
export async function tryResolveImplementContextWithBundles(
  context: ChatContext | undefined,
  requestId: string
): Promise<ResolvedImplementContextDto | null> {
  // Only resolve in implement_feature mode with architecture context
  if (context?.mode !== 'implement_feature') {
    return null;
  }

  const effectiveProjectId = context.projectId || context.filename;
  if (!effectiveProjectId) {
    logger.debug('Cannot resolve implement context: no projectId or filename provided', { requestId });
    return null;
  }

  if (!context.architectureContext) {
    logger.debug('Cannot resolve implement context: no architectureContext provided', { requestId });
    return null;
  }

  const { entityIds, diagramIds, entities, diagrams } = context.architectureContext;

  // Check if we should use expand-resolve (bundle_type present)
  const useBundleExpansion = hasBundleTypeSelections(context.architectureContext);

  if (useBundleExpansion) {
    // Use expand-resolve endpoint
    logger.debug('Using expand-resolve for bundle-based context resolution', {
      requestId,
      projectId: effectiveProjectId,
      entitiesCount: entities?.length || 0,
      diagramsCount: diagrams?.length || 0,
    });

    try {
      const expandResponse = await expandResolveContext(
        effectiveProjectId,
        entities || [],
        diagrams || []
      );

      if (!expandResponse) {
        return null;
      }

      // Log truncation warning if truncated
      if (expandResponse.truncated) {
        logger.warn('Context bundle expansion was truncated', {
          requestId,
          projectId: effectiveProjectId,
          truncationReason: expandResponse.truncation_reason,
          expandedEntityIdsCount: expandResponse.expanded_entity_ids?.length || 0,
          expandedDiagramIdsCount: expandResponse.expanded_diagram_ids?.length || 0,
        });
      }

      // Transform ExpandResolveResponseDto to ResolvedImplementContextDto
      const resolvedContext: ResolvedImplementContextDto = {
        resolved_entities: expandResponse.resolved_entities || [],
        resolved_diagrams: expandResponse.resolved_diagrams || [],
      };

      logger.debug('Successfully resolved implement context via expand-resolve', {
        requestId,
        resolvedEntitiesCount: resolvedContext.resolved_entities.length,
        resolvedDiagramsCount: resolvedContext.resolved_diagrams.length,
        truncated: expandResponse.truncated,
      });

      return resolvedContext;
    } catch (error) {
      logger.warn('Failed to resolve implement context via expand-resolve, proceeding without resolved context', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  } else {
    // Use standard resolve endpoint (no bundle_type present)
    // Skip resolution if both lists are empty
    if ((!entityIds || entityIds.length === 0) && (!diagramIds || diagramIds.length === 0)) {
      logger.debug('Skipping implement context resolution: no entities or diagrams to resolve', { requestId });
      return null;
    }

    logger.debug('Using standard resolve for implement context resolution', {
      requestId,
      projectId: effectiveProjectId,
      entityIdsCount: entityIds?.length || 0,
      diagramIdsCount: diagramIds?.length || 0,
    });

    try {
      const resolvedContext = await resolveImplementContext(
        effectiveProjectId,
        entityIds || [],
        diagramIds || []
      );

      if (resolvedContext) {
        logger.debug('Successfully resolved implement context via standard resolve', {
          requestId,
          resolvedEntitiesCount: resolvedContext.resolved_entities?.length || 0,
          resolvedDiagramsCount: resolvedContext.resolved_diagrams?.length || 0,
        });
      }

      return resolvedContext;
    } catch (error) {
      logger.warn('Failed to resolve implement context, proceeding without resolved context', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}

// ============================================================================
// Interface -> Architecture Binding Lookup
// Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 2
// ============================================================================

/**
 * Result of {@link lookupInterfaceArchitecture}: the architecture an interface
 * is bound to, plus the archived flag so the gateway resolver can refuse
 * `derived-from-context` binding into archived architectures.
 *
 * Mirrors the `InterfaceArchitectureBindingResponse` Java record returned by
 * `architecture-model-service`'s `BindingLookupController`.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 2.
 */
export interface InterfaceArchitectureBinding {
  /** UUID of the architecture the interface belongs to. */
  architectureId: string;
  /** Human-readable architecture display name (used in system-prompt injection). */
  architectureName: string;
  /**
   * Whether the architecture is archived. The gateway resolver translates
   * `archived: true` into a `DerivedBindingError` with code
   * `'archived_architecture'` rather than binding the conversation.
   */
  archived: boolean;
}

/**
 * Typed error thrown by {@link lookupInterfaceArchitecture} when the upstream
 * architecture-model-service returns a non-2xx response (notably 404 when the
 * interface does not exist or belongs to a different project).
 *
 * Carries the upstream HTTP `status` so callers (the
 * `derivedBindingResolver`) can distinguish 404 ("interface not found") from
 * 5xx ("upstream failure") and surface accurate error messages to the LLM.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 2.
 */
export class InterfaceArchitectureLookupError extends Error {
  readonly status: number;
  readonly projectId: string;
  readonly interfaceId: string;

  constructor(
    status: number,
    projectId: string,
    interfaceId: string,
    message?: string
  ) {
    super(
      message ||
        `Interface architecture lookup failed (status=${status}) for projectId=${projectId} interfaceId=${interfaceId}`
    );
    this.name = 'InterfaceArchitectureLookupError';
    this.status = status;
    this.projectId = projectId;
    this.interfaceId = interfaceId;
  }
}

/**
 * Looks up the architecture an interface belongs to via the
 * project-scoped binding endpoint.
 *
 * Calls
 * `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding`
 * on architecture-model-service (introduced in Spec #5 Group 1) and parses
 * the {@link InterfaceArchitectureBinding} payload.
 *
 * Used exclusively by the gateway's `derivedBindingResolver` (Spec #5 Group
 * 2) when the LLM emits a `contextBinding` block during a
 * `derived-from-context` conversation. The resolver consults this helper to
 * find the entity's architecture and either binds the conversation or
 * (when `archived === true`) refuses with a `DerivedBindingError`.
 *
 * Errors:
 *   - HTTP 404 -> throws {@link InterfaceArchitectureLookupError} with
 *     `status === 404` (interface not found OR cross-project access).
 *   - Other non-2xx responses -> throws
 *     {@link InterfaceArchitectureLookupError} with the upstream status so
 *     the resolver can map upstream failures to a generic refusal without
 *     binding the thread.
 *   - Network / fetch errors -> throws {@link InterfaceArchitectureLookupError}
 *     with `status === 0` (no HTTP response received).
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 2.
 *
 * @param projectId   - Project UUID
 * @param interfaceId - Interface id (typed string; backend accepts UUID or
 *                      string id depending on schema; encoded as a path segment)
 * @returns The {@link InterfaceArchitectureBinding} for the given interface
 * @throws InterfaceArchitectureLookupError on 404 / non-2xx / network failure
 */
export async function lookupInterfaceArchitecture(
  projectId: string,
  interfaceId: string
): Promise<InterfaceArchitectureBinding> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/interfaces/${encodeURIComponent(interfaceId)}/architecture-binding`;

  logger.debug('Looking up interface architecture binding from architecture-model-service', {
    projectId,
    interfaceId,
    url,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  } catch (error) {
    logger.warn('Network failure calling interface architecture-binding endpoint', {
      projectId,
      interfaceId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new InterfaceArchitectureLookupError(
      0,
      projectId,
      interfaceId,
      `Network failure looking up interface architecture binding: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for interface binding lookup', {
      projectId,
      interfaceId,
      status: response.status,
      statusText: response.statusText,
    });
    throw new InterfaceArchitectureLookupError(
      response.status,
      projectId,
      interfaceId
    );
  }

  const data = (await response.json()) as InterfaceArchitectureBinding;

  logger.debug('Successfully looked up interface architecture binding', {
    projectId,
    interfaceId,
    architectureId: data.architectureId,
    architectureName: data.architectureName,
    archived: data.archived,
  });

  return data;
}

// ============================================================================
// Multi-Architecture Selective Cross-Architecture Copy (Spec #7) -- Task Group 5
//
// Three new client helpers for the selective-copy workflow:
//   - getElementsInventory(projectId, architectureId)
//     -> GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory
//   - selectiveCopyPreflight(projectId, targetArchitectureId, payload)
//     -> POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight
//   - selectiveCopyCommit(projectId, targetArchitectureId, payload)
//     -> POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit
//
// All three throw `ArchitectureModelHttpError` on any non-2xx response so the
// gateway proxy route can forward the upstream status + body byte-for-byte
// (404 / 422 archived_source / 422 same_architecture / 422 missing_reference /
// 400 validation envelopes).
//
// Spec: 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy.
// ============================================================================

/**
 * One leaf instance in the element inventory tree.
 *
 * `archived` is optional because architecture-scoped element rows do not have
 * an archived flag in V1 (only the architecture itself can be archived); the
 * field is present in the contract for future-proofing per the spec.
 */
export interface ElementInventoryInstance {
  id: string;
  name: string;
  archived?: boolean;
}

/** A grouping of instances by entity type within a domain. */
export interface ElementInventoryType {
  name: string;
  /**
   * Backend entity-type identifier (e.g. `interfaces`, `services`,
   * `data_entities`). Always populated by AMS; optional here to stay
   * tolerant of older payloads (mirrors the frontend typing).
   */
  entityType?: string;
  instances: ElementInventoryInstance[];
}

/**
 * One of the six canonical domains: Applications, Data, Business, UI,
 * Behavioural, Diagrams (in that order per spec).
 */
export interface ElementInventoryDomain {
  name: string;
  types: ElementInventoryType[];
}

/**
 * Response shape from
 * `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`.
 *
 * Powers the `SelectiveCopyElementPicker` tree (Spec #7 frontend Group 7).
 */
export interface ElementInventoryResponse {
  domains: ElementInventoryDomain[];
}

/**
 * Request body for
 * `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight`.
 *
 * `elementIds` is the user's raw selection from the picker tree; the backend
 * runs smart cascading to compute auto-included elements + same_uuid conflicts.
 */
export interface SelectiveCopyPreflightRequest {
  sourceArchitectureId: string;
  elementIds: string[];
}

/**
 * One conflict reported by preflight.
 *
 * `conflictReason` is a discriminated string so future variants (e.g. name
 * collision) can extend the enum without breaking the contract per the spec.
 * `referencedBy` lists parent elements that pulled this one in via cascading
 * (only populated when the conflict relates to a referenced/auto-included
 * element).
 */
export interface SelectiveCopyConflict {
  elementId: string;
  elementType: string;
  name: string;
  conflictReason: 'same_uuid' | 'missing_reference';
  referencedBy?: string[];
}

/**
 * One auto-included element reported by preflight.
 *
 * `includedBecause` carries the parent element's name so the picker tree can
 * render the `auto-included` badge tooltip ("Auto-included because referenced
 * by <parent>").
 */
export interface SelectiveCopyAutoIncluded {
  elementId: string;
  elementType: string;
  name: string;
  includedBecause: string;
}

/** Aggregate counts surfaced in the preflight summary header. */
export interface SelectiveCopyPreflightSummary {
  totalSelected: number;
  conflictCount: number;
  autoIncludedCount: number;
  willCopyCount: number;
}

/**
 * Response body from the preflight endpoint. No state mutation occurs --
 * preflight is read-only per the spec.
 */
export interface SelectiveCopyPreflightResponse {
  conflicts: SelectiveCopyConflict[];
  autoIncluded: SelectiveCopyAutoIncluded[];
  summary: SelectiveCopyPreflightSummary;
}

/**
 * One per-element resolution decision sent to the commit endpoint.
 *
 * Defaults to `skip` on the frontend (safest non-destructive action). The
 * three actions match the backend's `ArchitectureSelectiveCopyService.commit`
 * branch logic exactly.
 */
export interface SelectiveCopyResolution {
  elementId: string;
  action: 'skip' | 'overwrite' | 'duplicate';
}

/**
 * Request body for
 * `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit`.
 *
 * `elementIds` mirrors the preflight selection; `resolutions` carries the
 * per-conflict decisions. Backend re-runs preflight defence-in-depth and
 * refuses with 422 `missing_reference` if the user un-ticked an auto-included
 * element (per the spec).
 */
export interface SelectiveCopyCommitRequest {
  sourceArchitectureId: string;
  elementIds: string[];
  resolutions: SelectiveCopyResolution[];
}

/**
 * Response body from the commit endpoint. Counts feed the post-copy toast
 * ("Copied N elements from <source.name> (skipped: X, overwrote: Y,
 * duplicated: Z)") on the frontend.
 */
export interface SelectiveCopyCommitResponse {
  copied: number;
  skipped: number;
  overwritten: number;
  duplicated: number;
  autoIncluded: number;
}

/**
 * Fetches the element inventory for an architecture (the read-only meta
 * endpoint backing the picker tree).
 *
 * Calls `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory`.
 * Returns the parsed `ElementInventoryResponse` on 2xx.
 *
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim:
 *   - 404 -- architecture not found within the project (standard envelope)
 *
 * Spec: 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy -- Task Group 5
 *
 * @param projectId      - The project ID (UUID string)
 * @param architectureId - The architecture ID (UUID string)
 * @returns The parsed `ElementInventoryResponse`
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function getElementsInventory(
  projectId: string,
  architectureId: string
): Promise<ElementInventoryResponse> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/elements-inventory`;

  logger.debug('Fetching elements inventory from architecture-model-service', {
    projectId,
    architectureId,
    url,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for elements inventory', {
      projectId,
      architectureId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as ElementInventoryResponse;
}

/**
 * Runs the selective-copy preflight (read-only conflict + auto-include
 * detection) against a target architecture.
 *
 * Calls `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight`.
 * Returns the parsed `SelectiveCopyPreflightResponse` on 2xx.
 *
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim:
 *   - 422 `{code: "archived_source"}` -- source is archived
 *   - 422 `{code: "same_architecture"}` -- source === target
 *   - 404 -- source or target architecture not found within the project
 *   - 400 -- validation failure (empty `elementIds`, malformed body, etc.)
 *
 * Spec: 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy -- Task Group 5
 *
 * @param projectId             - The project ID (UUID string)
 * @param targetArchitectureId  - The target architecture ID (UUID string)
 * @param payload               - {sourceArchitectureId, elementIds}
 * @returns The parsed `SelectiveCopyPreflightResponse`
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function selectiveCopyPreflight(
  projectId: string,
  targetArchitectureId: string,
  payload: SelectiveCopyPreflightRequest
): Promise<SelectiveCopyPreflightResponse> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(targetArchitectureId)}/selective-copy/preflight`;

  logger.debug('Calling selective-copy preflight on architecture-model-service', {
    projectId,
    targetArchitectureId,
    sourceArchitectureId: payload?.sourceArchitectureId,
    elementIdsCount: payload?.elementIds?.length || 0,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for selective-copy preflight', {
      projectId,
      targetArchitectureId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as SelectiveCopyPreflightResponse;
}

/**
 * Runs the selective-copy commit (transactional copy with FK rewiring) against
 * a target architecture.
 *
 * Calls `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit`.
 * Returns the parsed `SelectiveCopyCommitResponse` on 2xx.
 *
 * Throws `ArchitectureModelHttpError` on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim:
 *   - 422 `{code: "archived_source"}`     -- source is archived (defence in depth)
 *   - 422 `{code: "same_architecture"}`   -- source === target (defence in depth)
 *   - 422 `{code: "missing_reference"}`   -- user un-ticked an auto-included element
 *   - 404 -- source or target architecture not found within the project
 *   - 400 -- validation failure
 *
 * Spec: 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy -- Task Group 5
 *
 * @param projectId             - The project ID (UUID string)
 * @param targetArchitectureId  - The target architecture ID (UUID string)
 * @param payload               - {sourceArchitectureId, elementIds, resolutions}
 * @returns The parsed `SelectiveCopyCommitResponse`
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function selectiveCopyCommit(
  projectId: string,
  targetArchitectureId: string,
  payload: SelectiveCopyCommitRequest
): Promise<SelectiveCopyCommitResponse> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(targetArchitectureId)}/selective-copy/commit`;

  logger.debug('Calling selective-copy commit on architecture-model-service', {
    projectId,
    targetArchitectureId,
    sourceArchitectureId: payload?.sourceArchitectureId,
    elementIdsCount: payload?.elementIds?.length || 0,
    resolutionsCount: payload?.resolutions?.length || 0,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for selective-copy commit', {
      projectId,
      targetArchitectureId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as SelectiveCopyCommitResponse;
}

// ============================================================================
// Discovery Run Input Artifacts (Log Files PATCH)
// Spec 2026-05-10 Runtime Log Input at Discovery Run Start -- Task Group 2
// ============================================================================

/**
 * Shape of a single log-file metadata entry persisted on the discovery_run
 * row's `config_snapshot.inputArtifacts.logFiles[]` JSONB array.
 *
 * Mirrors the gateway/AMS DTO (camelCase). All fields except `contentType`
 * are required.
 */
export interface LogFileMeta {
  artifactId: string;
  originalFileName: string;
  sizeBytes: number;
  fileExtension: string;
  contentType?: string;
  uploadedAtIso: string;
  relativePath: string;
}

/**
 * Body passed to the AMS PATCH endpoint that merges log-file metadata into
 * `config_snapshot.inputArtifacts.logFiles[]`.
 */
export interface LogFilesPatchRequest {
  logFiles: LogFileMeta[];
  attemptedCount: number;
  /**
   * Spec 2026-05-11 Section 1: optional sibling key carrying the
   * per-run runtime-evidence config that AMS merges into
   * `config_snapshot.runtimeEvidenceConfig` atomically with the
   * `inputArtifacts.logFiles[]` merge. Omit the field entirely to
   * leave the existing snapshot value unchanged on AMS.
   */
  runtimeEvidenceConfig?: { maxLogPathPrefixSegments?: number; logPatternHint?: string };
}

/**
 * PATCHes the AMS discovery-run input-artifacts endpoint with newly written
 * log-file metadata.
 *
 * Endpoint:
 *   PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files
 *
 * Returns the updated `inputArtifacts` block on 200. Throws
 * `ArchitectureModelHttpError` on non-2xx so the caller (gateway upload route)
 * can surface upstream status / body to the frontend.
 *
 * Idempotent on `artifactId` (server replaces existing entries with same id,
 * appends new ones). `attemptedCount` is set on the row via a `max(existing,
 * incoming)` rule in the AMS service layer.
 *
 * Spec 2026-05-10 Runtime Log Input at Discovery Run Start.
 *
 * @param projectId - The project ID (UUID string)
 * @param architectureId - The architecture ID (UUID string)
 * @param runId - The discovery run ID (UUID string)
 * @param body - { logFiles, attemptedCount }
 * @returns The updated `inputArtifacts` Map (opaque JSON object)
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
/**
 * PATCH operator-uploaded API contract files (WADL/WSDL/XSD content, inline)
 * onto a discovery run's `config_snapshot.contractFiles[]` (2026-08-02). The
 * discovery pipeline reads them as an authoritative Interface/Endpoint source.
 * Idempotent on fileName at the service layer.
 */
export async function patchDiscoveryRunContractFiles(
  projectId: string,
  architectureId: string,
  runId: string,
  body: { contractFiles: Array<{ fileName: string; content: string }> }
): Promise<unknown> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}` +
    `/contract-files`;

  logger.debug('PATCHing discovery run contract files', {
    projectId,
    architectureId,
    runId,
    url,
    fileCount: body.contractFiles.length,
  });

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const responseBody = await readBodyOrEmpty(response);
  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK for discovery run contract-files PATCH', {
      projectId,
      architectureId,
      runId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, responseBody);
  }
  return responseBody;
}

export async function patchDiscoveryRunLogFileArtifacts(
  projectId: string,
  architectureId: string,
  runId: string,
  body: LogFilesPatchRequest
): Promise<unknown> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}` +
    `/input-artifacts/log-files`;

  logger.debug('PATCHing discovery run log-file artifacts', {
    projectId,
    architectureId,
    runId,
    url,
    fileCount: body.logFiles.length,
    attemptedCount: body.attemptedCount,
  });

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for discovery run log-files PATCH', {
      projectId,
      architectureId,
      runId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, responseBody);
  }

  return responseBody;
}

// ============================================================================
// Architecture Element Mappings (Spec: 2026-05-15 Create Target Baseline) -- Group 4
//
// Four new client helpers for the cross-architecture element mapping CRUD/search:
//   - listArchitectureMappings(projectId, filters?)
//     -> GET    /api/projects/{projectId}/architecture-mappings (with optional query params)
//   - createArchitectureMapping(projectId, body)
//     -> POST   /api/projects/{projectId}/architecture-mappings
//   - updateArchitectureMapping(projectId, mappingId, body)
//     -> PUT    /api/projects/{projectId}/architecture-mappings/{mappingId}
//   - deleteArchitectureMapping(projectId, mappingId)
//     -> DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}
//
// All four throw ArchitectureModelHttpError on any non-2xx response so the
// gateway proxy route can forward the upstream status + body byte-for-byte
// (notably 422 {code: "duplicate_mapping"} from the AMS GlobalExceptionHandler
// when the unique constraint is violated).
// ============================================================================

/**
 * Optional filters for listArchitectureMappings. Mirrors the AMS controller's
 * query parameters. Undefined fields are omitted from the upstream querystring.
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4.
 */
export interface ArchitectureMappingFilters {
  sourceArchitectureId?: string;
  targetArchitectureId?: string;
  sourceElementType?: string;
  targetElementType?: string;
  mappingType?: string;
  status?: string;
  q?: string;
}

/**
 * Response shape from the AMS architecture-mapping endpoints.
 *
 * Mirrors ArchitectureElementMappingDto on the AMS side. confidence is a
 * boxed numeric (Double on the entity / number | null on the wire) per the
 * project_primitive_double_dto_overwrite.md lesson -- a primitive double
 * silently wipes to 0 on PATCH semantics, which would corrupt mapping rows.
 */
export interface ArchitectureElementMappingDto {
  id: string;
  projectId: string;
  sourceArchitectureId: string;
  targetArchitectureId: string;
  sourceElementType: string;
  sourceElementId: string;
  targetElementType: string;
  targetElementId: string;
  mappingType: string;
  status: string;
  createdByTask: string;
  createdAt: string;
  updatedAt: string;
  notes?: string | null;
  confidence?: number | null;
}

/**
 * Request body for createArchitectureMapping. The server sets id, both
 * timestamps, and createdByTask (mapping-review-modal-add for the manual
 * path; selective-copy-with-auto-map is set internally by the auto-map
 * branch and is never sent through this endpoint).
 */
export interface CreateArchitectureMappingRequest {
  sourceArchitectureId: string;
  targetArchitectureId: string;
  sourceElementType: string;
  sourceElementId: string;
  targetElementType: string;
  targetElementId: string;
  mappingType: string;
  status: string;
  notes?: string | null;
  confidence?: number | null;
}

/**
 * Request body for updateArchitectureMapping. Only the four mutable fields
 * are accepted by the AMS service; all four are boxed (null allowed) so a
 * PATCH that omits confidence does NOT silently wipe the existing value.
 */
export interface UpdateArchitectureMappingRequest {
  mappingType?: string;
  status?: string;
  notes?: string | null;
  confidence?: number | null;
}

/**
 * Builds a querystring from an ArchitectureMappingFilters object. Omits
 * undefined / null / empty-string values defensively so the upstream URL
 * stays clean.
 */
function buildArchitectureMappingFilterQuery(
  filters: ArchitectureMappingFilters | undefined
): string {
  if (!filters) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Lists architecture element mappings for a project. Optional filter object
 * narrows the result by source/target architecture, element type, mapping
 * type, status, and free-text q (AMS searches across source/target element
 * ids and notes).
 *
 * Calls GET /api/projects/{projectId}/architecture-mappings.
 * Returns the parsed ArchitectureElementMappingDto[] on 2xx.
 *
 * Throws ArchitectureModelHttpError on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim.
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4
 *
 * @param projectId - The project ID (UUID string)
 * @param filters   - Optional filter object (all fields optional)
 * @returns The parsed ArchitectureElementMappingDto[]
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function listArchitectureMappings(
  projectId: string,
  filters?: ArchitectureMappingFilters
): Promise<ArchitectureElementMappingDto[]> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const querystring = buildArchitectureMappingFilterQuery(filters);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings${querystring}`;

  logger.debug('Listing architecture mappings from architecture-model-service', {
    projectId,
    url,
    filterKeys: filters ? Object.keys(filters).filter((k) => (filters as any)[k] !== undefined) : [],
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const body = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for list architecture mappings', {
      projectId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }

  return body as ArchitectureElementMappingDto[];
}

/**
 * Creates a single architecture element mapping (manual-add path from the
 * Mapping Review modal).
 *
 * Calls POST /api/projects/{projectId}/architecture-mappings.
 * Returns the parsed ArchitectureElementMappingDto on 201.
 *
 * Throws ArchitectureModelHttpError on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim, notably:
 *   - 422 {code: "duplicate_mapping"} -- unique-constraint violation
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4
 *
 * @param projectId - The project ID (UUID string)
 * @param body      - CreateArchitectureMappingRequest
 * @returns The created ArchitectureElementMappingDto
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function createArchitectureMapping(
  projectId: string,
  body: CreateArchitectureMappingRequest
): Promise<ArchitectureElementMappingDto> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings`;

  logger.debug('Creating architecture mapping in architecture-model-service', {
    projectId,
    url,
    sourceArchitectureId: body?.sourceArchitectureId,
    targetArchitectureId: body?.targetArchitectureId,
    mappingType: body?.mappingType,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });

  const responseBody = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for create architecture mapping', {
      projectId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, responseBody);
  }

  return responseBody as ArchitectureElementMappingDto;
}

/**
 * Updates the four mutable fields on an existing architecture element mapping
 * (PATCH semantics on the wire even though the HTTP method is PUT, per the
 * AMS controller contract: only mappingType, status, notes, confidence are
 * honoured; createdByTask is set server-side to mapping-review-modal-edit).
 *
 * Calls PUT /api/projects/{projectId}/architecture-mappings/{mappingId}.
 * Returns the parsed ArchitectureElementMappingDto on 200.
 *
 * Throws ArchitectureModelHttpError on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim.
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4
 *
 * @param projectId - The project ID (UUID string)
 * @param mappingId - The mapping ID (UUID string)
 * @param body      - UpdateArchitectureMappingRequest (only mutable fields)
 * @returns The updated ArchitectureElementMappingDto
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function updateArchitectureMapping(
  projectId: string,
  mappingId: string,
  body: UpdateArchitectureMappingRequest
): Promise<ArchitectureElementMappingDto> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings/${encodeURIComponent(mappingId)}`;

  logger.debug('Updating architecture mapping in architecture-model-service', {
    projectId,
    mappingId,
    url,
  });

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });

  const responseBody = await readBodyOrEmpty(response);

  if (!response.ok) {
    logger.warn('Architecture model service returned non-OK response for update architecture mapping', {
      projectId,
      mappingId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, responseBody);
  }

  return responseBody as ArchitectureElementMappingDto;
}

/**
 * Hard-deletes an architecture element mapping. v1 has no soft-delete column
 * for mappings; the row is removed.
 *
 * Calls DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}.
 * Returns nothing on 204.
 *
 * Throws ArchitectureModelHttpError on any non-2xx response so the proxy
 * route can forward the upstream status + body verbatim.
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4
 *
 * @param projectId - The project ID (UUID string)
 * @param mappingId - The mapping ID (UUID string)
 * @returns void
 * @throws ArchitectureModelHttpError on non-2xx responses
 */
export async function deleteArchitectureMapping(
  projectId: string,
  mappingId: string
): Promise<void> {
  const config = getConfig();
  const baseUrl = config.architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings/${encodeURIComponent(mappingId)}`;

  logger.debug('Deleting architecture mapping in architecture-model-service', {
    projectId,
    mappingId,
    url,
  });

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await readBodyOrEmpty(response);
    logger.warn('Architecture model service returned non-OK response for delete architecture mapping', {
      projectId,
      mappingId,
      status: response.status,
    });
    throw new ArchitectureModelHttpError(response.status, body);
  }
}
