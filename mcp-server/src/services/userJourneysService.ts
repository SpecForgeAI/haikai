/**
 * User Journeys Service
 *
 * Core business logic for the save_user_journeys MCP tool.
 * Handles validation, name-to-ID resolution, upsert with CREATED/UPDATED
 * status tracking, and merge with existing model data using a GET-merge-PUT strategy.
 *
 * Follows the structural pattern of usersInteractionsService.ts but extends it
 * with FK reference resolution and upsert semantics.
 */

import { generateId } from '../utils/generateId';
import { ensureAbbreviations } from '../utils/abbreviationUtils';
import {
  UserJourneysInput,
  UserJourneyInput,
  ProcessActivityInput,
  ActivityStepInput,
  UserJourneyLinkInput,
  SaveUserJourneysResponse,
  SaveUserJourneysValidationError,
  EntityStatus,
  UserJourneyEntityResult,
  ActivityStepEntityResult,
  UserJourneyLinkEntityResult,
} from '../types/saveUserJourneys';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// Canonical relationship types (mirrors ModelService.java enum)
// ============================================================================

export const CANONICAL_RELATIONSHIP_TYPES = [
  'RELATES_TO',
  'PRECEDES',
  'DEPENDS_ON',
  'OPTIONALLY_LEADS_TO',
  'TRIGGERS',
] as const;

// ============================================================================
// parseAndValidate
// ============================================================================

export function parseAndValidate(userJourneysJson: string): {
  input: UserJourneysInput;
  errors: SaveUserJourneysValidationError[];
} {
  let parsed: any;
  try {
    parsed = JSON.parse(userJourneysJson);
  } catch (e: any) {
    return {
      input: { user_journeys: [] } as UserJourneysInput,
      errors: [{
        type: 'PARSE_ERROR',
        message: `Invalid JSON: ${e.message}`,
        context: 'userJourneysJson',
      }],
    };
  }

  const errors: SaveUserJourneysValidationError[] = [];

  // Validate user_journeys array exists and is non-empty
  if (!parsed.user_journeys || !Array.isArray(parsed.user_journeys)) {
    errors.push({
      type: 'VALIDATION_ERROR',
      message: 'user_journeys array is required',
      context: 'user_journeys',
    });
    return {
      input: { user_journeys: [] } as UserJourneysInput,
      errors,
    };
  }

  if (parsed.user_journeys.length === 0) {
    errors.push({
      type: 'VALIDATION_ERROR',
      message: 'user_journeys array must not be empty',
      context: 'user_journeys',
    });
    return {
      input: { user_journeys: [] } as UserJourneysInput,
      errors,
    };
  }

  // Parse user_journey_links: default to [] if absent or not an array
  const rawLinks = Array.isArray(parsed.user_journey_links) ? parsed.user_journey_links : [];

  const input: UserJourneysInput = {
    user_journeys: parsed.user_journeys as UserJourneyInput[],
    process_activities: Array.isArray(parsed.process_activities) ? parsed.process_activities as ProcessActivityInput[] : [],
    activity_steps: Array.isArray(parsed.activity_steps) ? parsed.activity_steps as ActivityStepInput[] : [],
    user_journey_links: rawLinks as UserJourneyLinkInput[],
  };

  // LOG 1: What did the LLM send for process_activities?
  console.log('[UJ-SAVE] process_activities from LLM:', JSON.stringify(input.process_activities, null, 2));
  console.log('[UJ-SAVE] process_activities count:', input.process_activities?.length ?? 0);

  // Validate each user_journey has non-empty name
  const journeyNames = new Set<string>();
  for (let i = 0; i < input.user_journeys.length; i++) {
    const journey = input.user_journeys[i];
    if (!journey.name || typeof journey.name !== 'string' || journey.name.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'User journey name is required and must be a non-empty string',
        context: `user_journeys[${i}].name`,
      });
    } else {
      journeyNames.add(journey.name.trim());
    }
  }

  // Build a lowercase set for case-insensitive journey name lookups
  const journeyNamesLower = new Set<string>();
  for (const name of journeyNames) {
    journeyNamesLower.add(name.toLowerCase());
  }

  // Validate each activity_step
  const activitySteps = input.activity_steps || [];
  // Track sequence_order per journey for duplicate detection
  const seqOrdersByJourney = new Map<string, Map<number, number[]>>();

  for (let i = 0; i < activitySteps.length; i++) {
    const step = activitySteps[i];

    if (!step.user_journey_name || typeof step.user_journey_name !== 'string' || step.user_journey_name.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Activity step user_journey_name is required and must be a non-empty string',
        context: `activity_steps[${i}].user_journey_name`,
      });
    }

    if (!step.process_activity_name || typeof step.process_activity_name !== 'string' || step.process_activity_name.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Activity step process_activity_name is required and must be a non-empty string',
        context: `activity_steps[${i}].process_activity_name`,
      });
    }

    if (!step.business_user_abbreviation || typeof step.business_user_abbreviation !== 'string' || step.business_user_abbreviation.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Activity step business_user_abbreviation is required and must be a non-empty string',
        context: `activity_steps[${i}].business_user_abbreviation`,
      });
    }

    if (!step.application_abbreviation || typeof step.application_abbreviation !== 'string' || step.application_abbreviation.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Activity step application_abbreviation is required and must be a non-empty string',
        context: `activity_steps[${i}].application_abbreviation`,
      });
    }

    if (!step.activity_step_name || typeof step.activity_step_name !== 'string' || step.activity_step_name.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Activity step activity_step_name is required and must be a non-empty string',
        context: `activity_steps[${i}].activity_step_name`,
      });
    }

    if (!step.diagram_label || typeof step.diagram_label !== 'string' || step.diagram_label.trim() === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Activity step diagram_label is required and must be a non-empty string',
        context: `activity_steps[${i}].diagram_label`,
      });
    }

    // Validate sequence_order is a positive integer when present
    if (step.sequence_order !== undefined && step.sequence_order !== null) {
      if (typeof step.sequence_order !== 'number' || !Number.isInteger(step.sequence_order) || step.sequence_order < 1) {
        errors.push({
          type: 'VALIDATION_ERROR',
          message: 'Activity step sequence_order must be a positive integer when provided',
          context: `activity_steps[${i}].sequence_order`,
        });
      } else if (step.user_journey_name && typeof step.user_journey_name === 'string' && step.user_journey_name.trim() !== '') {
        // Track for duplicate detection
        const journeyKey = step.user_journey_name.trim();
        if (!seqOrdersByJourney.has(journeyKey)) {
          seqOrdersByJourney.set(journeyKey, new Map());
        }
        const seqMap = seqOrdersByJourney.get(journeyKey)!;
        if (!seqMap.has(step.sequence_order)) {
          seqMap.set(step.sequence_order, []);
        }
        seqMap.get(step.sequence_order)!.push(i);
      }
    }

    // Validate user_journey_name references a journey in the payload
    if (step.user_journey_name && typeof step.user_journey_name === 'string' && step.user_journey_name.trim() !== '') {
      if (!journeyNames.has(step.user_journey_name.trim())) {
        errors.push({
          type: 'VALIDATION_ERROR',
          message: `Activity step references unknown user journey '${step.user_journey_name}'`,
          context: `activity_steps[${i}].user_journey_name`,
        });
      }
    }
  }

  // Check for duplicate sequence_order within the same user_journey_name
  for (const [journeyKey, seqMap] of seqOrdersByJourney) {
    for (const [seqOrder, indices] of seqMap) {
      if (indices.length > 1) {
        errors.push({
          type: 'VALIDATION_ERROR',
          message: `Duplicate sequence_order ${seqOrder} within user journey '${journeyKey}' at indices [${indices.join(', ')}]`,
          context: `activity_steps.sequence_order`,
        });
      }
    }
  }

  // ============================================================================
  // Validate user_journey_links
  // ============================================================================

  const links = input.user_journey_links || [];
  const seenLinkKeys = new Set<string>();

  for (let i = 0; i < links.length; i++) {
    const link = links[i];

    // Validate source_user_journey_name is a non-empty string (after trim)
    const source = (typeof link.source_user_journey_name === 'string')
      ? link.source_user_journey_name.trim()
      : '';
    if (source === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Link source_user_journey_name is required and must be a non-empty string',
        context: `user_journey_links[${i}].source_user_journey_name`,
      });
    }

    // Validate target_user_journey_name is a non-empty string (after trim)
    const target = (typeof link.target_user_journey_name === 'string')
      ? link.target_user_journey_name.trim()
      : '';
    if (target === '') {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: 'Link target_user_journey_name is required and must be a non-empty string',
        context: `user_journey_links[${i}].target_user_journey_name`,
      });
    }

    // Validate source and target are not the same (case-insensitive)
    if (source !== '' && target !== '' && source.toLowerCase() === target.toLowerCase()) {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: `Link source and target must not be the same journey ('${source}')`,
        context: `user_journey_links[${i}]`,
      });
    }

    // Validate relationship_type after trim + uppercase
    const rawRelType = (typeof link.relationship_type === 'string')
      ? link.relationship_type.trim().toUpperCase()
      : '';
    if (rawRelType === '' || !(CANONICAL_RELATIONSHIP_TYPES as readonly string[]).includes(rawRelType)) {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: `Link relationship_type '${link.relationship_type || ''}' is not a valid type. Must be one of: ${CANONICAL_RELATIONSHIP_TYPES.join(', ')}`,
        context: `user_journey_links[${i}].relationship_type`,
      });
    }

    // Validate source journey name exists in the payload's user_journeys array
    if (source !== '' && !journeyNamesLower.has(source.toLowerCase())) {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: `Link references unknown source user journey '${source}'`,
        context: `user_journey_links[${i}].source_user_journey_name`,
      });
    }

    // Validate target journey name exists in the payload's user_journeys array
    if (target !== '' && !journeyNamesLower.has(target.toLowerCase())) {
      errors.push({
        type: 'VALIDATION_ERROR',
        message: `Link references unknown target user journey '${target}'`,
        context: `user_journey_links[${i}].target_user_journey_name`,
      });
    }

    // Detect exact duplicate links (same source, target, relationship_type after normalization)
    if (source !== '' && target !== '' && rawRelType !== '') {
      const linkKey = `${source.toLowerCase()}|${target.toLowerCase()}|${rawRelType}`;
      if (seenLinkKeys.has(linkKey)) {
        errors.push({
          type: 'VALIDATION_ERROR',
          message: `Duplicate link: ${source} -> ${target} (${rawRelType})`,
          context: `user_journey_links[${i}]`,
        });
      } else {
        seenLinkKeys.add(linkKey);
      }
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
        user_journeys: [],
        activity_steps: [],
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
        user_journey_links: [],
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// ensureArray helper
// ============================================================================

function ensureArray(obj: any, key: string): any[] {
  if (!Array.isArray(obj[key])) {
    obj[key] = [];
  }
  return obj[key];
}

// ============================================================================
// Name-to-ID resolution helper
// ============================================================================

function findEntityByName(entities: any[], name: string): any | undefined {
  // Case-insensitive matching consistent with existing patterns
  const normalizedName = name.trim().toLowerCase();
  return entities.find((e: any) => e.name && e.name.trim().toLowerCase() === normalizedName);
}

function findEntityByAbbreviation(entities: any[], abbreviation: string): any | undefined {
  const normalized = abbreviation.trim().toLowerCase();
  return entities.find((e: any) => e.abbreviation && e.abbreviation.trim().toLowerCase() === normalized);
}

// ============================================================================
// saveUserJourneys (main orchestrator)
// ============================================================================

export async function saveUserJourneys(
  projectId: string,
  userJourneysJson: string
): Promise<SaveUserJourneysResponse> {
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
  // architecture-scoped model endpoints. The user-journeys route does
  // not accept an explicit architectureId; it always targets the default.
  const architectureId = await archModelClient.getDefaultArchitectureId(projectId);

  // Step 2: Parse and validate the input
  const { input, errors: validationErrors } = parseAndValidate(userJourneysJson);
  if (validationErrors.length > 0) {
    throw createHttpError(400, JSON.stringify({ success: false, errors: validationErrors }));
  }

  // Step 3: GET existing model
  let existingModel;
  try {
    existingModel = await archModelClient.getModel(projectId, architectureId, filename);
  } catch (err: any) {
    throw createHttpError(502, `Failed to fetch existing model: ${err.message}`);
  }

  // Initialize model shell
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

  // Step 4: Resolve all name-based references to IDs, auto-creating missing entities
  const existingBusinessUsers = ensureArray(entities, 'business_users');
  const existingBusinessProcesses = ensureArray(entities, 'business_processes');
  const existingProcessActivities = ensureArray(entities, 'process_activities');
  const existingApplications = ensureArray(entities, 'applications');
  const existingUserJourneys = ensureArray(entities, 'user_journeys');
  const existingActivitySteps = ensureArray(entities, 'activity_steps');

  // Track auto-created entities for the response summary
  const autoCreated = {
    business_users: [] as string[],
    business_processes: [] as string[],
    process_activities: [] as string[],
    applications: [] as string[],
  };

  // Helper: find-or-create an entity by name in an array
  function findOrCreate(
    entityArray: any[],
    name: string,
    idPrefix: string,
    trackingArray: string[],
    extraFields?: Record<string, unknown>
  ): string {
    const found = findEntityByName(entityArray, name);
    if (found) return found.id;
    // Auto-create the missing entity
    const newId = generateId(idPrefix);
    const newEntity: any = {
      id: newId,
      name: name.trim(),
      description: null,
      tags: null,
      abbreviation: '',
      ...extraFields,
    };
    entityArray.push(newEntity);
    trackingArray.push(name.trim());
    return newId;
  }

  // Resolve user_journey FK references
  const journeyResolved: Array<{
    input: UserJourneyInput;
    primary_business_user_id: string | null;
    parent_business_process_id: string | null;
  }> = [];

  for (let i = 0; i < input.user_journeys.length; i++) {
    const journey = input.user_journeys[i];

    // Resolve primary_business_user_abbreviation (optional) -- must already exist
    let primaryBusinessUserId: string | null = null;
    if (journey.primary_business_user_abbreviation && journey.primary_business_user_abbreviation.trim() !== '') {
      const found = findEntityByAbbreviation(existingBusinessUsers, journey.primary_business_user_abbreviation);
      if (!found) {
        throw createHttpError(400, `Business user with abbreviation '${journey.primary_business_user_abbreviation}' not found in architecture. Business users must be defined before creating user journeys.`);
      }
      primaryBusinessUserId = found.id;
    }

    // Resolve parent_business_process_name (optional) -- auto-create if missing
    let parentBusinessProcessId: string | null = null;
    if (journey.parent_business_process_name && journey.parent_business_process_name.trim() !== '') {
      parentBusinessProcessId = findOrCreate(
        existingBusinessProcesses,
        journey.parent_business_process_name,
        'bp-',
        autoCreated.business_processes,
      );
    }

    journeyResolved.push({
      input: journey,
      primary_business_user_id: primaryBusinessUserId,
      parent_business_process_id: parentBusinessProcessId,
    });
  }

  // ============================================================================
  // Step 4b: Save process activities directly from the process_activities input.
  // Business processes are created first (from parent_business_process_name),
  // then process activities are created/updated with all their fields.
  // ============================================================================

  const inputProcessActivities = input.process_activities || [];

  for (const pa of inputProcessActivities) {
    const paName = pa.name.trim();
    // LOG 2: Each PA from input with all field values
    console.log(`[UJ-SAVE] Step 4b processing PA: name="${paName}", frequency="${pa.frequency}", user_interaction_level="${pa.user_interaction_level}", description="${pa.description}", parent_bp="${pa.parent_business_process_name}"`);

    // Resolve parent business process -- auto-create if missing
    let businessProcessId: string | null = null;
    if (pa.parent_business_process_name && pa.parent_business_process_name.trim() !== '') {
      businessProcessId = findOrCreate(
        existingBusinessProcesses,
        pa.parent_business_process_name,
        'bp-',
        autoCreated.business_processes,
      );
    }

    const existingPA = findEntityByName(existingProcessActivities, paName);
    if (existingPA) {
      // Update existing PA with all fields from the worksheet
      console.log(`[UJ-SAVE] Step 4b PA "${paName}" already exists (id=${existingPA.id}), updating fields`);
      if (pa.frequency !== undefined) existingPA.frequency = pa.frequency;
      if (pa.user_interaction_level !== undefined) existingPA.user_interaction_level = pa.user_interaction_level;
      if (pa.description !== undefined) existingPA.description = pa.description;
      if (businessProcessId) existingPA.business_process_id = businessProcessId;
    } else {
      // Create new PA with all fields
      const newId = generateId('pa-');
      console.log(`[UJ-SAVE] Step 4b PA "${paName}" is NEW (id=${newId}), creating with frequency="${pa.frequency}", user_interaction_level="${pa.user_interaction_level || 'HIGH'}"`);
      existingProcessActivities.push({
        id: newId,
        name: paName,
        description: pa.description || null,
        tags: null,
        abbreviation: '',
        business_process_id: businessProcessId,
        actor_hint: null,
        user_interaction_level: pa.user_interaction_level || 'HIGH',
        sequence_order: null,
        frequency: pa.frequency || null,
        valid_from: null,
        valid_to: null,
      });
      autoCreated.process_activities.push(paName);
    }
  }

  // ============================================================================
  // Step 4c: Resolve activity_step FK references.
  // Process activities already exist from Step 4b, so just look them up.
  // ============================================================================

  const activitySteps = input.activity_steps || [];
  const stepResolved: Array<{
    input: ActivityStepInput;
    process_activity_id: string;
    business_user_id: string;
    application_id: string;
  }> = [];

  for (let i = 0; i < activitySteps.length; i++) {
    const step = activitySteps[i];

    // business_user_abbreviation (required) -- must already exist
    const foundBU = findEntityByAbbreviation(existingBusinessUsers, step.business_user_abbreviation);
    if (!foundBU) {
      throw createHttpError(400, `Business user with abbreviation '${step.business_user_abbreviation}' not found in architecture (activity_steps[${i}]). Business users must be defined before creating user journeys.`);
    }
    const businessUserId = foundBU.id;

    // application_abbreviation (required) -- must already exist
    const foundApp = findEntityByAbbreviation(existingApplications, step.application_abbreviation);
    if (!foundApp) {
      throw createHttpError(400, `Application with abbreviation '${step.application_abbreviation}' not found in architecture (activity_steps[${i}]). Applications must be defined before creating user journeys.`);
    }
    const applicationId = foundApp.id;

    // process_activity_name (required) -- should already exist from Step 4b
    const existingPA = findEntityByName(existingProcessActivities, step.process_activity_name);
    let processActivityId: string;
    if (existingPA) {
      processActivityId = existingPA.id;
      console.log(`[UJ-SAVE] Step 4c activity step[${i}] found PA "${step.process_activity_name}" (id=${existingPA.id}, frequency=${existingPA.frequency}, uil=${existingPA.user_interaction_level})`);
    } else {
      // Fallback: auto-create if the PA wasn't in the process_activities input
      console.log(`[UJ-SAVE] Step 4c activity step[${i}] PA "${step.process_activity_name}" NOT FOUND - using fallback auto-create`);
      let bpIdForPA: string;
      if (step.parent_business_process_name && step.parent_business_process_name.trim() !== '') {
        bpIdForPA = findOrCreate(
          existingBusinessProcesses,
          step.parent_business_process_name,
          'bp-',
          autoCreated.business_processes,
        );
      } else {
        const journeyData = journeyResolved.find(
          jr => jr.input.name.trim().toLowerCase() === step.user_journey_name.trim().toLowerCase()
        );
        bpIdForPA = journeyData?.parent_business_process_id
          ?? findOrCreate(existingBusinessProcesses, 'Unassigned', 'bp-', autoCreated.business_processes);
      }

      processActivityId = findOrCreate(
        existingProcessActivities,
        step.process_activity_name,
        'pa-',
        autoCreated.process_activities,
        {
          business_process_id: bpIdForPA,
          actor_hint: foundBU.name,
          user_interaction_level: 'HIGH',
          sequence_order: null,
          frequency: null,
          valid_from: null,
          valid_to: null,
        },
      );
    }

    stepResolved.push({
      input: step,
      process_activity_id: processActivityId,
      business_user_id: businessUserId,
      application_id: applicationId,
    });
  }

  // Step 6: Upsert user_journeys with CREATED/UPDATED status
  const journeyResults: UserJourneyEntityResult[] = [];
  const upsertedJourneys: any[] = [];

  // Build a map of incoming journey name -> resolved data for activity step resolution
  const journeyIdByName = new Map<string, string>();

  for (const resolved of journeyResolved) {
    const journeyName = resolved.input.name.trim();
    const existing = findEntityByName(existingUserJourneys, journeyName);

    let id: string;
    let status: EntityStatus;

    if (existing) {
      // UPDATED: preserve existing ID
      id = existing.id;
      status = 'UPDATED';
    } else {
      // CREATED: generate new ID
      id = generateId('uj-');
      status = 'CREATED';
    }

    journeyIdByName.set(journeyName.toLowerCase(), id);

    const journeyDto: any = {
      id,
      name: journeyName,
      description: resolved.input.description || null,
      primary_business_user_id: resolved.primary_business_user_id,
      parent_business_process_id: resolved.parent_business_process_id,
      tags: null,
    };

    upsertedJourneys.push(journeyDto);
    journeyResults.push({ name: journeyName, id, status });
  }

  // Step 6b: Upsert activity_steps with CREATED/UPDATED status
  const stepResults: ActivityStepEntityResult[] = [];
  const upsertedSteps: any[] = [];

  for (let i = 0; i < stepResolved.length; i++) {
    const resolved = stepResolved[i];
    const step = resolved.input;

    // Resolve user_journey_name to ID
    // Check incoming payload first (via journeyIdByName), then existing model
    let userJourneyId = journeyIdByName.get(step.user_journey_name.trim().toLowerCase());
    if (!userJourneyId) {
      const existingJourney = findEntityByName(existingUserJourneys, step.user_journey_name);
      if (existingJourney) {
        userJourneyId = existingJourney.id;
      }
    }

    // This should not happen since we already validated user_journey_name in parseAndValidate,
    // but guard defensively
    if (!userJourneyId) {
      throw createHttpError(400, JSON.stringify({
        success: false,
        errors: [{
          type: 'VALIDATION_ERROR',
          message: `Could not resolve user journey '${step.user_journey_name}' to an ID`,
          context: `activity_steps[${i}].user_journey_name`,
        }],
      }));
    }

    const seqOrder = step.sequence_order ?? (i + 1);

    // Upsert key: (user_journey_id, sequence_order)
    const existing = existingActivitySteps.find(
      (e: any) => e.user_journey_id === userJourneyId && e.sequence_order === seqOrder
    );

    let id: string;
    let status: EntityStatus;

    if (existing) {
      id = existing.id;
      status = 'UPDATED';
    } else {
      id = generateId('as-');
      status = 'CREATED';
    }

    // Use explicit activity_step_name from input
    const name = step.activity_step_name || step.description || step.process_activity_name;

    const stepDto: any = {
      id,
      name,
      description: step.description || null,
      diagram_label: step.diagram_label || step.process_activity_name || '',
      user_journey_id: userJourneyId,
      process_activity_id: resolved.process_activity_id,
      business_user_id: resolved.business_user_id,
      application_id: resolved.application_id,
      sequence_order: seqOrder,
      tags: null,
      activity_issues: step.activity_issues || '',
      ui_issues: step.ui_issues || '',
    };

    upsertedSteps.push(stepDto);
    stepResults.push({
      userJourneyName: step.user_journey_name,
      sequenceOrder: seqOrder,
      id,
      status,
    });
  }

  // Step 6c: Resolve and upsert user_journey_links with CREATED/UPDATED status
  const inputLinks = input.user_journey_links || [];
  const linkResults: UserJourneyLinkEntityResult[] = [];
  const upsertedLinks: any[] = [];

  // Ensure existing user_journey_links array exists
  const existingLinks = ensureArray(base.metaModel.relationships, 'user_journey_links');

  for (let i = 0; i < inputLinks.length; i++) {
    const link = inputLinks[i];
    const sourceName = link.source_user_journey_name.trim();
    const targetName = link.target_user_journey_name.trim();
    const relationshipType = link.relationship_type.trim().toUpperCase();

    // Resolve source journey name to ID:
    // Check journeyIdByName map (current payload) first, then fall back to existing model
    let sourceJourneyId = journeyIdByName.get(sourceName.toLowerCase());
    if (!sourceJourneyId) {
      const existingJourney = findEntityByName(existingUserJourneys, sourceName);
      if (existingJourney) {
        sourceJourneyId = existingJourney.id;
      }
    }

    if (!sourceJourneyId) {
      throw createHttpError(400, `Could not resolve source user journey '${sourceName}' to an ID for link at index ${i}. Journey must exist in the payload or in the existing model.`);
    }

    // Resolve target journey name to ID:
    // Check journeyIdByName map (current payload) first, then fall back to existing model
    let targetJourneyId = journeyIdByName.get(targetName.toLowerCase());
    if (!targetJourneyId) {
      const existingJourney = findEntityByName(existingUserJourneys, targetName);
      if (existingJourney) {
        targetJourneyId = existingJourney.id;
      }
    }

    if (!targetJourneyId) {
      throw createHttpError(400, `Could not resolve target user journey '${targetName}' to an ID for link at index ${i}. Journey must exist in the payload or in the existing model.`);
    }

    // Upsert key: (source_user_journey_id, target_user_journey_id, relationship_type)
    const existingLink = existingLinks.find(
      (e: any) =>
        e.source_user_journey_id === sourceJourneyId &&
        e.target_user_journey_id === targetJourneyId &&
        e.relationship_type === relationshipType
    );

    let linkId: string;
    let status: EntityStatus;

    if (existingLink) {
      linkId = existingLink.id;
      status = 'UPDATED';
    } else {
      linkId = generateId('ujl-');
      status = 'CREATED';
    }

    const linkDto: any = {
      id: linkId,
      source_user_journey_id: sourceJourneyId,
      target_user_journey_id: targetJourneyId,
      relationship_type: relationshipType,
      label: link.relationship_label || null,
      description: link.relationship_description || null,
      tags: null,
    };

    upsertedLinks.push(linkDto);
    linkResults.push({
      sourceJourneyName: sourceName,
      targetJourneyName: targetName,
      relationshipType,
      id: linkId,
      status,
    });
  }

  // Step 7: Merge upserted arrays into the model, preserving all other entity arrays
  // For user_journeys: replace existing by name, append new
  const mergedJourneys = [...existingUserJourneys];
  for (const upserted of upsertedJourneys) {
    const existingIndex = mergedJourneys.findIndex(
      (e: any) => e.name && e.name.trim().toLowerCase() === upserted.name.trim().toLowerCase()
    );
    if (existingIndex >= 0) {
      mergedJourneys[existingIndex] = upserted;
    } else {
      mergedJourneys.push(upserted);
    }
  }
  entities.user_journeys = mergedJourneys;

  // For activity_steps: replace existing by (user_journey_id, sequence_order), append new
  const mergedSteps = [...existingActivitySteps];
  for (const upserted of upsertedSteps) {
    const existingIndex = mergedSteps.findIndex(
      (e: any) => e.user_journey_id === upserted.user_journey_id && e.sequence_order === upserted.sequence_order
    );
    if (existingIndex >= 0) {
      mergedSteps[existingIndex] = upserted;
    } else {
      mergedSteps.push(upserted);
    }
  }
  entities.activity_steps = mergedSteps;

  // For user_journey_links: replace existing by (source_user_journey_id, target_user_journey_id, relationship_type), append new
  const mergedLinks = [...existingLinks];
  for (const upserted of upsertedLinks) {
    const existingIndex = mergedLinks.findIndex(
      (e: any) =>
        e.source_user_journey_id === upserted.source_user_journey_id &&
        e.target_user_journey_id === upserted.target_user_journey_id &&
        e.relationship_type === upserted.relationship_type
    );
    if (existingIndex >= 0) {
      mergedLinks[existingIndex] = upserted;
    } else {
      mergedLinks.push(upserted);
    }
  }
  base.metaModel.relationships.user_journey_links = mergedLinks;

  // ============================================================================
  // Step 7b: Auto-derive BusinessPoints, ApplicationPoints, and relationships
  // from the merged activity steps data.
  //
  // Mirrors the pattern in usersInteractionsService.ts (lines 228-263) but
  // additionally derives PROCESS_ACTIVITY-kind BusinessPoints and
  // APPLICATION-kind ApplicationPoints with full dedup against the global model.
  // ============================================================================

  const relationships = base.metaModel.relationships;
  const allActivitySteps = ensureArray(entities, 'activity_steps');
  const allProcessActivities = ensureArray(entities, 'process_activities');
  const allBusinessProcesses = ensureArray(entities, 'business_processes');
  const allApplications = ensureArray(entities, 'applications');
  const allBusinessPoints = ensureArray(entities, 'business_points');
  const allApplicationPoints = ensureArray(entities, 'application_points');
  const allBubpRels = ensureArray(relationships, 'business_user_business_points');
  const allApbpRels = ensureArray(relationships, 'application_point_business_points');
  const allJourneys = ensureArray(entities, 'user_journeys');

  // Track counts for the response summary
  let derivedBusinessPointCount = 0;
  let derivedApplicationPointCount = 0;
  let derivedBubpRelCount = 0;
  let derivedApbpRelCount = 0;

  // Collect unique process_activity_ids and their application_ids from the
  // merged activity steps (only those belonging to journeys in this save batch)
  const journeyIdsInBatch = new Set<string>();
  for (const jr of journeyResults) {
    journeyIdsInBatch.add(jr.id);
  }

  // Build a map: journeyId -> primary_business_user_id (from merged journeys)
  const journeyUserMap = new Map<string, string>();
  for (const j of allJourneys) {
    if (j.primary_business_user_id) {
      journeyUserMap.set(j.id, j.primary_business_user_id);
    }
  }

  // Process each activity step that belongs to a journey in this save batch
  for (const step of allActivitySteps) {
    if (!journeyIdsInBatch.has(step.user_journey_id)) continue;
    if (!step.process_activity_id) continue;

    // Look up the process activity to get its business_process_id
    const pa = allProcessActivities.find((p: any) => p.id === step.process_activity_id);
    if (!pa) continue;

    // Resolve business_process_id -- handle edge case where PA has no parent BP
    let businessProcessId = pa.business_process_id;
    if (!businessProcessId) {
      // Fall back to "Unassigned" business process if it exists
      const unassignedBP = findEntityByName(allBusinessProcesses, 'Unassigned');
      if (unassignedBP) {
        businessProcessId = unassignedBP.id;
      }
    }

    // Task 1.2: Create BUSINESS_PROCESS-kind BusinessPoint
    if (businessProcessId) {
      const bpPointId = `bpt_${businessProcessId}`;
      const existingBpPoint = allBusinessPoints.find((bp: any) => bp.id === bpPointId);
      if (!existingBpPoint) {
        const bp = allBusinessProcesses.find((b: any) => b.id === businessProcessId);
        allBusinessPoints.push({
          id: bpPointId,
          name: bp ? bp.name : businessProcessId,
          description: null,
          kind: 'BUSINESS_PROCESS',
          business_process_id: businessProcessId,
          process_activity_id: null,
          tags: null,
          valid_from: null,
          valid_to: null,
        });
        derivedBusinessPointCount++;
      }
    }

    // Task 1.2: Create PROCESS_ACTIVITY-kind BusinessPoint
    const paPointId = `bpt_${step.process_activity_id}`;
    const existingPaPoint = allBusinessPoints.find((bp: any) => bp.id === paPointId);
    if (!existingPaPoint) {
      allBusinessPoints.push({
        id: paPointId,
        name: pa.name || step.process_activity_id,
        description: null,
        kind: 'PROCESS_ACTIVITY',
        business_process_id: businessProcessId || null,
        process_activity_id: step.process_activity_id,
        tags: null,
        valid_from: null,
        valid_to: null,
      });
      derivedBusinessPointCount++;
    }

    // Task 1.3: Create APPLICATION-kind ApplicationPoint (if not already existing)
    if (step.application_id) {
      const existingApt = allApplicationPoints.find(
        (ap: any) => ap.application_id === step.application_id && ap.kind === 'APPLICATION'
      );
      if (!existingApt) {
        const app = allApplications.find((a: any) => a.id === step.application_id);
        const aptId = generateId('apt-');
        allApplicationPoints.push({
          id: aptId,
          name: app ? app.name : step.application_id,
          description: null,
          kind: 'APPLICATION',
          application_id: step.application_id,
          application_component_id: null,
          service_id: null,
          interface_id: null,
          target_type: null,
          target_ref_id: null,
          point_type: null,
          tags: null,
          valid_from: null,
          valid_to: null,
        });
        derivedApplicationPointCount++;
      }
    }

    // Task 1.4: Create BusinessUser-to-BusinessPoint relationships
    const businessUserId = journeyUserMap.get(step.user_journey_id);
    if (businessUserId) {
      // Link to BUSINESS_PROCESS-kind BusinessPoint
      if (businessProcessId) {
        const bpPointId = `bpt_${businessProcessId}`;
        const existingBubpBp = allBubpRels.find(
          (r: any) => r.business_user_id === businessUserId && r.business_point_id === bpPointId
        );
        if (!existingBubpBp) {
          allBubpRels.push({
            id: generateId('bubp-'),
            business_user_id: businessUserId,
            business_point_id: bpPointId,
            description: null,
            tags: null,
            valid_from: null,
            valid_to: null,
          });
          derivedBubpRelCount++;
        }
      }

      // Link to PROCESS_ACTIVITY-kind BusinessPoint
      const paPointIdForRel = `bpt_${step.process_activity_id}`;
      const existingBubpPa = allBubpRels.find(
        (r: any) => r.business_user_id === businessUserId && r.business_point_id === paPointIdForRel
      );
      if (!existingBubpPa) {
        allBubpRels.push({
          id: generateId('bubp-'),
          business_user_id: businessUserId,
          business_point_id: paPointIdForRel,
          description: null,
          tags: null,
          valid_from: null,
          valid_to: null,
        });
        derivedBubpRelCount++;
      }
    }

    // Task 1.5: Create ApplicationPoint-to-BusinessPoint relationships
    if (step.application_id) {
      // Find the ApplicationPoint for this application (looked up or just created above)
      const apt = allApplicationPoints.find(
        (ap: any) => ap.application_id === step.application_id && ap.kind === 'APPLICATION'
      );
      if (apt) {
        // Link to PROCESS_ACTIVITY-kind BusinessPoint
        const paPointIdForApbp = `bpt_${step.process_activity_id}`;
        const existingApbpPa = allApbpRels.find(
          (r: any) => r.application_point_id === apt.id && r.business_point_id === paPointIdForApbp
        );
        if (!existingApbpPa) {
          allApbpRels.push({
            id: generateId('apbp-'),
            application_point_id: apt.id,
            business_point_id: paPointIdForApbp,
            description: null,
            tags: null,
            valid_from: null,
            valid_to: null,
          });
          derivedApbpRelCount++;
        }

        // Link to BUSINESS_PROCESS-kind BusinessPoint
        if (businessProcessId) {
          const bpPointIdForApbp = `bpt_${businessProcessId}`;
          const existingApbpBp = allApbpRels.find(
            (r: any) => r.application_point_id === apt.id && r.business_point_id === bpPointIdForApbp
          );
          if (!existingApbpBp) {
            allApbpRels.push({
              id: generateId('apbp-'),
              application_point_id: apt.id,
              business_point_id: bpPointIdForApbp,
              description: null,
              tags: null,
              valid_from: null,
              valid_to: null,
            });
            derivedApbpRelCount++;
          }
        }
      }
    }
  }

  // Step 8: Ensure abbreviations before save
  ensureAbbreviations(base);

  // Step 9: PUT model
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

  // Step 10: Return structured response
  const summary = {
    userJourneys: {
      created: journeyResults.filter(r => r.status === 'CREATED').length,
      updated: journeyResults.filter(r => r.status === 'UPDATED').length,
    },
    activitySteps: {
      created: stepResults.filter(r => r.status === 'CREATED').length,
      updated: stepResults.filter(r => r.status === 'UPDATED').length,
    },
    userJourneyLinks: {
      created: linkResults.filter(r => r.status === 'CREATED').length,
      updated: linkResults.filter(r => r.status === 'UPDATED').length,
    },
    autoCreatedEntities: {
      businessUsers: autoCreated.business_users.length,
      businessProcesses: autoCreated.business_processes.length,
      processActivities: autoCreated.process_activities.length,
      applications: autoCreated.applications.length,
    },
    autoDerivedEntities: {
      businessPoints: derivedBusinessPointCount,
      applicationPoints: derivedApplicationPointCount,
      businessUserBusinessPointRelationships: derivedBubpRelCount,
      applicationPointBusinessPointRelationships: derivedApbpRelCount,
    },
  };

  return {
    success: true,
    projectId,
    filename,
    summary,
    entities: {
      userJourneys: journeyResults,
      activitySteps: stepResults,
      userJourneyLinks: linkResults,
    },
  };
}
