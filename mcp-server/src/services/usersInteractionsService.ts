/**
 * Users & Interactions Service
 *
 * Core business logic for the save_users_interactions MCP tool.
 * Handles validation, ID generation, ref resolution, entity building,
 * and merge with existing model data using a GET-merge-PUT strategy.
 */

import { generateId } from '../utils/generateId';
import { ensureAbbreviations } from '../utils/abbreviationUtils';
import {
  UsersInteractionsInput,
  SaveUsersInteractionsResponse,
} from '../types/saveUsersInteractions';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// parseAndValidate
// ============================================================================

export function parseAndValidate(usersInteractionsJson: string): {
  input: UsersInteractionsInput;
  errors: string[];
} {
  let parsed: any;
  try {
    parsed = JSON.parse(usersInteractionsJson);
  } catch (e: any) {
    return {
      input: {} as UsersInteractionsInput,
      errors: [`Invalid JSON: ${e.message}`],
    };
  }

  const input: UsersInteractionsInput = {
    business_users: Array.isArray(parsed.business_users) ? parsed.business_users : [],
    business_processes: Array.isArray(parsed.business_processes) ? parsed.business_processes : [],
    process_activities: Array.isArray(parsed.process_activities) ? parsed.process_activities : [],
    ui_screens: Array.isArray(parsed.ui_screens) ? parsed.ui_screens : [],
  };

  const errors: string[] = [];

  // Validate names are non-empty
  for (let i = 0; i < (input.business_users || []).length; i++) {
    const item = input.business_users![i];
    if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
      errors.push(`Empty or missing name at business_users[${i}]`);
    }
  }
  for (let i = 0; i < (input.business_processes || []).length; i++) {
    const item = input.business_processes![i];
    if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
      errors.push(`Empty or missing name at business_processes[${i}]`);
    }
  }
  for (let i = 0; i < (input.process_activities || []).length; i++) {
    const item = input.process_activities![i];
    if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
      errors.push(`Empty or missing name at process_activities[${i}]`);
    }
  }
  for (let i = 0; i < (input.ui_screens || []).length; i++) {
    const item = input.ui_screens![i];
    if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
      errors.push(`Empty or missing name at ui_screens[${i}]`);
    }
  }

  return { input, errors };
}

// ============================================================================
// createEmptyModelShell (reusable)
// ============================================================================

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
// saveUsersInteractions (main orchestrator)
// ============================================================================

export async function saveUsersInteractions(
  projectId: string,
  usersInteractionsJson: string
): Promise<SaveUsersInteractionsResponse> {
  // Step 1: Look up project to get filename
  let project;
  try {
    project = await archModelClient.getProjectById(projectId);
  } catch (err: any) {
    if (err.message && err.message.includes('Project not found')) {
      throw createHttpError(404, `Project not found: ${projectId}`);
    }
    throw err;
  }
  const filename = project.name;

  // Resolve the project's default architecture so we can call the
  // architecture-scoped model endpoints. The users-interactions route
  // does not accept an explicit architectureId; it always targets the default.
  const architectureId = await archModelClient.getDefaultArchitectureId(projectId);

  // Step 2: Parse and validate the input
  const { input, errors: validationErrors } = parseAndValidate(usersInteractionsJson);
  if (validationErrors.length > 0) {
    throw createHttpError(400, JSON.stringify({ success: false, errors: validationErrors }));
  }

  // Step 3: Generate IDs for all entities
  const businessUserIds: Record<string, string> = {};
  for (const bu of input.business_users || []) {
    businessUserIds[bu.name] = generateId('bu-');
  }

  const businessProcessIds: Record<string, string> = {};
  for (const bp of input.business_processes || []) {
    businessProcessIds[bp.name] = generateId('bp-');
  }

  const processActivityIds: Record<string, string> = {};
  for (const pa of input.process_activities || []) {
    processActivityIds[pa.name] = generateId('pa-');
  }

  const uiScreenIds: Record<string, string> = {};
  for (const us of input.ui_screens || []) {
    uiScreenIds[us.name] = generateId('ui-');
  }

  // Step 4: Get existing model (null if 404)
  let existingModel;
  try {
    existingModel = await archModelClient.getModel(projectId, architectureId, filename);
  } catch (err: any) {
    throw createHttpError(502, `Failed to fetch existing model: ${err.message}`);
  }

  // Step 5: Build entity DTOs
  const businessUsers = (input.business_users || []).map(bu => ({
    id: businessUserIds[bu.name],
    name: bu.name,
    description: bu.description || null,
    tags: null,
    abbreviation: bu.abbreviation || '',
  }));

  const businessProcesses = (input.business_processes || []).map(bp => ({
    id: businessProcessIds[bp.name],
    name: bp.name,
    description: bp.description || null,
    tags: null,
    valid_from: null,
    valid_to: null,
  }));

  const processActivities = (input.process_activities || []).map((pa, idx) => ({
    id: processActivityIds[pa.name],
    business_process_id: pa.processRef ? (businessProcessIds[pa.processRef] || null) : null,
    name: pa.name,
    description: pa.description || null,
    sequence_order: pa.sequenceOrder ?? (idx + 1),
    frequency: null,
    actor_hint: pa.actorHint || null,
    user_interaction_level: 'HIGH',
    tags: null,
    valid_from: null,
    valid_to: null,
  }));

  const uiScreens = (input.ui_screens || []).map(us => ({
    id: uiScreenIds[us.name],
    name: us.name,
    route: us.route || null,
    description: us.description || null,
    application_point_id: null,
  }));

  // Step 6: Build business_points for each business_process (needed for user-process links)
  const businessPoints: any[] = [];
  for (const bp of input.business_processes || []) {
    const bpId = businessProcessIds[bp.name];
    businessPoints.push({
      id: `bpt_${bpId}`,
      name: bp.name,
      description: null,
      kind: 'BUSINESS_PROCESS',
      business_process_id: bpId,
      tags: null,
      valid_from: null,
      valid_to: null,
    });
  }

  // Step 7: Build relationships: business_user_business_points
  const businessUserBusinessPoints: any[] = [];
  for (const bp of input.business_processes || []) {
    const bpId = businessProcessIds[bp.name];
    const businessPointId = `bpt_${bpId}`;
    for (const userRef of bp.userRefs || []) {
      const userId = businessUserIds[userRef];
      if (userId) {
        businessUserBusinessPoints.push({
          id: generateId('bubp-'),
          business_user_id: userId,
          business_point_id: businessPointId,
          description: null,
          tags: null,
          valid_from: null,
          valid_to: null,
        });
      }
    }
  }

  // Step 8: Merge with existing model
  const base = existingModel ? JSON.parse(JSON.stringify(existingModel)) : createEmptyModelShell();

  if (!base.metaModel) {
    base.metaModel = createEmptyModelShell().metaModel;
  }
  if (!base.metaModel.entities) {
    base.metaModel.entities = createEmptyModelShell().metaModel.entities;
  }
  if (!base.metaModel.relationships) {
    base.metaModel.relationships = createEmptyModelShell().metaModel.relationships;
  }

  const entities = base.metaModel.entities;
  const relationships = base.metaModel.relationships;

  const ensureArray = (obj: any, key: string): any[] => {
    if (!Array.isArray(obj[key])) {
      obj[key] = [];
    }
    return obj[key];
  };

  // Deduplicate by name: skip entities that already exist with the same name
  const existingBuNames = new Set(ensureArray(entities, 'business_users').map((e: any) => e.name));
  const existingBpNames = new Set(ensureArray(entities, 'business_processes').map((e: any) => e.name));
  const existingPaNames = new Set(ensureArray(entities, 'process_activities').map((e: any) => e.name));
  const existingUiNames = new Set(ensureArray(entities, 'ui_screens').map((e: any) => e.name));

  const newBu = businessUsers.filter(e => !existingBuNames.has(e.name));
  const newBp = businessProcesses.filter(e => !existingBpNames.has(e.name));
  const newPa = processActivities.filter(e => !existingPaNames.has(e.name));
  const newUi = uiScreens.filter(e => !existingUiNames.has(e.name));

  ensureArray(entities, 'business_users').push(...newBu);
  ensureArray(entities, 'business_processes').push(...newBp);
  ensureArray(entities, 'process_activities').push(...newPa);
  ensureArray(entities, 'ui_screens').push(...newUi);
  ensureArray(entities, 'business_points').push(...businessPoints);
  ensureArray(relationships, 'business_user_business_points').push(...businessUserBusinessPoints);

  // Step 9: Ensure abbreviations before save
  ensureAbbreviations(base);

  // Step 10: Save the merged model
  try {
    await archModelClient.putModel(projectId, architectureId, filename, base);
  } catch (err: any) {
    const statusCode = err.response?.status || 502;
    const responseBody = err.response?.data;
    const detail = responseBody
      ? (typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody))
      : err.message;
    throw createHttpError(502, `Failed to save model (upstream ${statusCode}): ${detail}`);
  }

  // Step 10: Return response
  return {
    success: true,
    projectId,
    filename,
    summary: {
      businessUsers: newBu.length,
      businessProcesses: newBp.length,
      processActivities: newPa.length,
      uiScreens: newUi.length,
    },
    createdEntities: {
      businessUsers: newBu.map(e => ({ name: e.name, id: e.id })),
      businessProcesses: newBp.map(e => ({ name: e.name, id: e.id })),
      processActivities: newPa.map(e => ({ name: e.name, id: e.id })),
      uiScreens: newUi.map(e => ({ name: e.name, id: e.id })),
    },
  };
}
