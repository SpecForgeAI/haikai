/**
 * Anchor Entities Service
 *
 * Core business logic for the save_project_anchor_entities MCP tool.
 * Performs a targeted GET-merge-PUT on the architecture model to add
 * discovered applications and app_components from Phase 0 discovery framing.
 *
 * Uses name-based deduplication: if an application or app_component with the
 * same name already exists, it is skipped (not duplicated).
 *
 * Follows the GET-merge-PUT pattern from architectureBaselineService.ts.
 *
 * @module anchorEntitiesService
 */

import { generateId } from '../utils/generateId';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// Types
// ============================================================================

export interface AnchorApplication {
  name: string;
  description: string;
}

export interface AnchorAppComponent {
  name: string;
  applicationName: string;
  description: string;
}

export interface SaveAnchorEntitiesResult {
  projectId: string;
  applicationsCreated: number;
  appComponentsCreated: number;
}

// ============================================================================
// Empty Model Shell
// ============================================================================

/**
 * Creates an empty model shell with all entity and relationship arrays initialized
 * to empty arrays, used when no existing model is found (GET returned 404).
 *
 * Matches the createEmptyModelShell from architectureBaselineService.ts.
 */
function createEmptyModelShell(): any {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        data_entity_points: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
        application_point_business_logics: [],
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Saves anchor entities (applications and app_components) to the architecture model
 * using a GET-merge-PUT strategy with name-based deduplication.
 *
 * Orchestration flow:
 * 1. Validate project exists via archModelClient.getProjectById
 * 2. GET existing model via archModelClient.getModel; create empty shell if null
 * 3. For each application: skip if name already exists, otherwise create with generated ID
 * 4. For each appComponent: resolve parent application by name, skip if name exists, otherwise create
 * 5. PUT updated model via archModelClient.putModel
 * 6. Return counts of created entities
 *
 * @param projectId - The project UUID
 * @param applications - Array of applications to add
 * @param appComponents - Array of app components to add
 * @returns Promise resolving to the save result with creation counts
 */
export async function saveProjectAnchorEntities(
  projectId: string,
  applications: AnchorApplication[],
  appComponents: AnchorAppComponent[]
): Promise<SaveAnchorEntitiesResult> {
  // ====================================================================
  // 1. Validate project exists and derive filename
  // ====================================================================

  const project = await archModelClient.getProjectById(projectId);
  const filename = project.name;

  // Resolve the project's default architecture so we can call the
  // architecture-scoped model endpoints. This route does not accept an
  // explicit architectureId in its request body; the anchor-entities flow
  // pre-dates multi-arch support and always targets the project's default.
  const architectureId = await archModelClient.getDefaultArchitectureId(projectId);

  // ====================================================================
  // 2. GET existing model by projectId (or create empty shell)
  // ====================================================================

  let model = await archModelClient.getModelByProjectId(projectId, architectureId);
  if (!model) {
    model = createEmptyModelShell();
  }

  // Ensure entity arrays exist
  if (!model.metaModel) {
    model.metaModel = createEmptyModelShell().metaModel;
  }
  if (!model.metaModel.entities) {
    model.metaModel.entities = createEmptyModelShell().metaModel.entities;
  }
  if (!Array.isArray(model.metaModel.entities.applications)) {
    model.metaModel.entities.applications = [];
  }
  if (!Array.isArray(model.metaModel.entities.app_components)) {
    model.metaModel.entities.app_components = [];
  }

  // ====================================================================
  // 3. Merge applications with name-based deduplication
  // ====================================================================

  let applicationsCreated = 0;

  for (const app of applications) {
    const existingApp = model.metaModel.entities.applications.find(
      (existing: any) => existing.name === app.name
    );

    if (existingApp) {
      // Skip duplicate -- application with this name already exists
      continue;
    }

    const newApp = {
      id: generateId('app-'),
      name: app.name,
      description: app.description || '',
      abbreviation: app.name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join(''),
      app_type: '',
      status: '',
      tags: '',
      valid_from: null,
      valid_to: null,
      is_internal: null,
    };

    model.metaModel.entities.applications.push(newApp);
    applicationsCreated++;
  }

  // ====================================================================
  // 4. Merge app_components with name-based deduplication
  // ====================================================================

  let appComponentsCreated = 0;

  for (const comp of appComponents) {
    // Resolve parent application ID by matching applicationName
    const parentApp = model.metaModel.entities.applications.find(
      (app: any) => app.name === comp.applicationName
    );

    if (!parentApp) {
      console.warn(
        `[save_project_anchor_entities] Could not resolve parent application "${comp.applicationName}" for component "${comp.name}"; skipping.`
      );
      continue;
    }

    const existingComp = model.metaModel.entities.app_components.find(
      (existing: any) => existing.name === comp.name
    );

    if (existingComp) {
      // Skip duplicate -- app_component with this name already exists
      continue;
    }

    const newComp = {
      id: generateId('comp-'),
      name: comp.name,
      description: comp.description || '',
      application_id: parentApp.id,
      tags: '',
      valid_from: null,
      valid_to: null,
      is_internal: null,
      tech_type: null,
    };

    model.metaModel.entities.app_components.push(newComp);
    appComponentsCreated++;
  }

  // ====================================================================
  // 5. PUT updated model
  // ====================================================================

  await archModelClient.putModel(projectId, architectureId, filename, model);

  // ====================================================================
  // 6. Return result
  // ====================================================================

  return {
    projectId,
    applicationsCreated,
    appComponentsCreated,
  };
}
