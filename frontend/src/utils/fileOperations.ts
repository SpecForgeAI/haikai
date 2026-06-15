import { ArchitectureModel, Diagram, DiagramNode, DiagramEdge, EdgePoint, TextHorizontalAlign, TextVerticalAlign, ProcessActivity, UserInteractionLevel, PhysicalDataEntity, ProcessActivityFrequency, AppBusinessPoint, Event, Class, Method, State, StateTransition, Activity, ActivityFlow, ActivityPartition, UIScreen, UIWorkflowTransition, UIComponent, UIAction, BusinessLogic, UICharacteristic, UserJourney, ActivityStep } from '../types/model';
import { TypedContentEnvelope } from '../types/typedContent';
import { ValidationError } from '../types/config';
import { validateJsonStructure, validateModel, getArrayOrDefault } from './validation';
import { reconcileBusinessPoints } from './businessPointSync';

// Parse JSON with error handling
export function parseJSON(content: string): { data: unknown; error: string | null } {
  try {
    const data = JSON.parse(content);
    return { data, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown parsing error';
    return { data: null, error: `Failed to parse JSON: ${error}` };
  }
}

// Parse edge points from edge object
function parseEdgePoints(edge: Record<string, unknown>): EdgePoint[] {
  const points = getArrayOrDefault(edge.edge_points) as Record<string, unknown>[];
  return points.map((p) => ({
    id: p.id as string,
    sequence_order: (p.sequence_order as number) || 0,
    pos_x: (p.pos_x as number) || 0,
    pos_y: (p.pos_y as number) || 0,
  }));
}

// Parse diagram edges from diagram object
function parseDiagramEdges(diagram: Record<string, unknown>): DiagramEdge[] {
  const edges = getArrayOrDefault(diagram.diagram_edges) as Record<string, unknown>[];
  return edges.map((e) => ({
    id: e.id as string,
    relationship_type: (e.relationship_type as string) || '',
    relationship_id: (e.relationship_id as string) || '',
    source_node_id: e.source_node_id as string,
    target_node_id: e.target_node_id as string,
    label_text: e.label_text as string | undefined,
    label_pos_x: e.label_pos_x as number | undefined,
    label_pos_y: e.label_pos_y as number | undefined,
    line_weight: e.line_weight as string | undefined,
    line_type: e.line_type as string | undefined,
    arrow_start: e.arrow_start as string | undefined,
    arrow_end: e.arrow_end as string | undefined,
    style_override: e.style_override as Record<string, unknown> | undefined,
    edge_points: parseEdgePoints(e),
    // Parse new font styling fields for edge labels
    label_font_size: e.label_font_size as string | undefined,
    label_font_weight: e.label_font_weight as string | undefined,
    label_font_style: e.label_font_style as string | undefined,
  }));
}

// Validate and parse horizontal alignment value
function parseTextHAlign(value: unknown): TextHorizontalAlign | undefined {
  if (value === 'LEFT' || value === 'CENTER' || value === 'RIGHT') {
    return value;
  }
  return undefined;
}

// Validate and parse vertical alignment value
function parseTextVAlign(value: unknown): TextVerticalAlign | undefined {
  if (value === 'TOP' || value === 'MIDDLE' || value === 'BOTTOM') {
    return value;
  }
  return undefined;
}

// Parse diagram nodes from diagram object
function parseDiagramNodes(diagram: Record<string, unknown>): DiagramNode[] {
  const nodes = getArrayOrDefault(diagram.diagram_nodes) as Record<string, unknown>[];
  return nodes.map((n) => ({
    id: n.id as string,
    entity_type: n.entity_type as string,
    entity_id: n.entity_id as string,
    pos_x: (n.pos_x as number) || 0,
    pos_y: (n.pos_y as number) || 0,
    width: (n.width as number) || 100,
    height: (n.height as number) || 60,
    auto_size: n.auto_size as boolean | undefined,
    z_index: n.z_index as number | undefined,
    parent_node_id: (n.parent_node_id as string) || null,
    style_override: n.style_override as Record<string, unknown> | undefined,
    text_h_align: parseTextHAlign(n.text_h_align),
    text_v_align: parseTextVAlign(n.text_v_align),
    // Parse new fields for text area and font styling
    text_area_width: n.text_area_width as number | undefined,
    text_font_size: n.text_font_size as string | undefined,
    text_font_weight: n.text_font_weight as string | undefined,
    text_font_style: n.text_font_style as string | undefined,
  }));
}

// ============================================================================
// TypedContent Parsing
// ============================================================================

/**
 * Parse typedContent from a diagram object.
 *
 * Handles the snake_case to camelCase mapping:
 * - Backend sends `typed_content` (snake_case)
 * - Frontend uses `typedContent` (camelCase)
 *
 * Returns undefined for:
 * - General diagrams (no typed content)
 * - Null or undefined typed_content
 * - Invalid typed_content structure
 *
 * @param diagram - Raw diagram object from JSON
 * @returns TypedContentEnvelope or undefined
 */
function parseTypedContent(diagram: Record<string, unknown>): TypedContentEnvelope | undefined {
  // Try both snake_case (from backend API) and camelCase (from local JSON)
  const rawTypedContent = diagram.typed_content ?? diagram.typedContent;

  // Return undefined for null, undefined, or non-object values
  if (rawTypedContent === null || rawTypedContent === undefined) {
    return undefined;
  }

  if (typeof rawTypedContent !== 'object') {
    return undefined;
  }

  const typedContentObj = rawTypedContent as Record<string, unknown>;

  // Validate required fields
  const type = typedContentObj.type as string | undefined;
  const version = typedContentObj.version as number | undefined;
  const content = typedContentObj.content;

  if (!type || version === undefined || !content) {
    return undefined;
  }

  // Validate type is one of the allowed values
  if (!['Sequence', 'ER', 'Activity', 'State'].includes(type)) {
    return undefined;
  }

  return {
    type: type as 'Sequence' | 'ER' | 'Activity' | 'State',
    version,
    content: content as TypedContentEnvelope['content'],
  };
}

// Parse diagrams with nested nodes and edges
function parseDiagrams(data: unknown[]): Diagram[] {
  return data.map((d) => {
    const diagram = d as Record<string, unknown>;
    const parsedDiagram: Diagram = {
      id: diagram.id as string,
      name: diagram.name as string,
      description: (diagram.description as string) || '',
      diagram_type: diagram.diagram_type as string | undefined,
      settings: diagram.settings as Record<string, unknown> | undefined,
      diagram_nodes: parseDiagramNodes(diagram),
      diagram_edges: parseDiagramEdges(diagram),
    };

    // Parse typedContent (handles both snake_case and camelCase)
    const typedContent = parseTypedContent(diagram);
    if (typedContent) {
      parsedDiagram.typedContent = typedContent;
    }

    return parsedDiagram;
  });
}

// ============================================================================
// Migration: Convert old is_manual/user_input_amount to user_interaction_level
// ============================================================================

/**
 * Migrate a ProcessActivity from old format (is_manual + user_input_amount)
 * to new format (user_interaction_level).
 *
 * Migration mapping:
 * - is_manual=false (any user_input_amount) -> "AUTOMATED"
 * - is_manual=true + user_input_amount="MINIMAL" -> "MINIMAL"
 * - is_manual=true + user_input_amount="MODERATE" -> "MODERATE"
 * - is_manual=true + user_input_amount="SIGNIFICANT" -> "SIGNIFICANT"
 * - Default fallback (missing/invalid) -> "AUTOMATED"
 *
 * @param rawActivity - Raw activity data from JSON (may have old or new fields)
 * @returns ProcessActivity with user_interaction_level set
 */
function migrateProcessActivity(rawActivity: Record<string, unknown>): ProcessActivity {
  // If the new field already exists and is valid, use it directly
  if (rawActivity.user_interaction_level !== undefined) {
    const level = rawActivity.user_interaction_level as string;
    if (['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT'].includes(level)) {
      return {
        id: rawActivity.id as string,
        business_process_id: rawActivity.business_process_id as string,
        name: rawActivity.name as string,
        description: (rawActivity.description as string) || '',
        sequence_order: rawActivity.sequence_order as number | undefined,
        frequency: rawActivity.frequency as ProcessActivityFrequency | undefined,
        actor_hint: (rawActivity.actor_hint as ProcessActivity['actor_hint']) || 'OTHER',
        user_interaction_level: level as UserInteractionLevel,
        tags: (rawActivity.tags as string) || '',
        valid_from: rawActivity.valid_from as string | undefined,
        valid_to: rawActivity.valid_to as string | undefined,
      };
    }
  }

  // Migration: check for old fields
  const isManual = rawActivity.is_manual as boolean | undefined;
  const userInputAmount = rawActivity.user_input_amount as string | undefined;

  let userInteractionLevel: UserInteractionLevel = 'AUTOMATED';

  if (isManual === false) {
    // Automated activity - regardless of user_input_amount
    userInteractionLevel = 'AUTOMATED';
  } else if (isManual === true) {
    // Manual activity - map based on user_input_amount
    if (userInputAmount === 'MINIMAL') {
      userInteractionLevel = 'MINIMAL';
    } else if (userInputAmount === 'MODERATE') {
      userInteractionLevel = 'MODERATE';
    } else if (userInputAmount === 'SIGNIFICANT') {
      userInteractionLevel = 'SIGNIFICANT';
    } else {
      // is_manual=true but user_input_amount is NA or missing - default to AUTOMATED
      userInteractionLevel = 'AUTOMATED';
    }
  }
  // If neither old field is present, default is AUTOMATED

  return {
    id: rawActivity.id as string,
    business_process_id: rawActivity.business_process_id as string,
    name: rawActivity.name as string,
    description: (rawActivity.description as string) || '',
    sequence_order: rawActivity.sequence_order as number | undefined,
    frequency: rawActivity.frequency as ProcessActivityFrequency | undefined,
    actor_hint: (rawActivity.actor_hint as ProcessActivity['actor_hint']) || 'OTHER',
    user_interaction_level: userInteractionLevel,
    tags: (rawActivity.tags as string) || '',
    valid_from: rawActivity.valid_from as string | undefined,
    valid_to: rawActivity.valid_to as string | undefined,
  };
}

/**
 * Migrate process_activities array from old format to new format.
 * Handles both old (is_manual + user_input_amount) and new (user_interaction_level) formats.
 *
 * @param rawActivities - Raw activities array from JSON
 * @returns Array of ProcessActivity with user_interaction_level set
 */
function migrateProcessActivities(rawActivities: unknown[]): ProcessActivity[] {
  return rawActivities.map((a) => migrateProcessActivity(a as Record<string, unknown>));
}

// ============================================================================
// Migration: Strip logical_entity_id from PhysicalDataEntity
// ============================================================================

/**
 * Migrate a PhysicalDataEntity by stripping the deprecated logical_entity_id field.
 *
 * The logical_entity_id field has been removed from the PhysicalDataEntity interface.
 * The Logical-to-Physical Entity mapping is now exclusively modeled via the
 * LogicalDataEntityPhysicalDataEntity relationship table.
 *
 * This function silently discards any logical_entity_id present in legacy JSON files.
 *
 * @param rawEntity - Raw physical data entity from JSON (may have legacy logical_entity_id)
 * @returns PhysicalDataEntity without logical_entity_id
 */
function migratePhysicalDataEntity(rawEntity: Record<string, unknown>): PhysicalDataEntity {
  // Destructure to explicitly omit logical_entity_id if present
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { logical_entity_id: _discarded, ...cleanEntity } = rawEntity;

  return {
    id: cleanEntity.id as string,
    name: (cleanEntity.name as string) || '',
    description: (cleanEntity.description as string) || '',
    physical_type: (cleanEntity.physical_type as string) || '',
    database: (cleanEntity.database as string) || '',
    tags: (cleanEntity.tags as string) || '',
    valid_from: cleanEntity.valid_from as string | undefined,
    valid_to: cleanEntity.valid_to as string | undefined,
  };
}

/**
 * Migrate physical_data_entities array by stripping logical_entity_id from each entity.
 *
 * @param rawEntities - Raw physical data entities array from JSON
 * @returns Array of PhysicalDataEntity without logical_entity_id
 */
function migratePhysicalDataEntities(rawEntities: unknown[]): PhysicalDataEntity[] {
  return rawEntities.map((e) => migratePhysicalDataEntity(e as Record<string, unknown>));
}

// Build model from parsed data with defaults for missing arrays
export function buildModelFromData(data: unknown): ArchitectureModel {
  const obj = data as Record<string, unknown>;

  // Get metaModel or default to empty object
  const metaModel = (obj.metaModel as Record<string, unknown>) || {};
  const entities = (metaModel.entities as Record<string, unknown>) || {};
  const relationships = (metaModel.relationships as Record<string, unknown>) || {};

  // Get raw process_activities and migrate them
  const rawProcessActivities = getArrayOrDefault(entities.process_activities) as unknown[];
  const migratedProcessActivities = migrateProcessActivities(rawProcessActivities);

  // Get raw physical_data_entities and migrate them (strip logical_entity_id)
  const rawPhysicalDataEntities = getArrayOrDefault(entities.physical_data_entities) as unknown[];
  const migratedPhysicalDataEntities = migratePhysicalDataEntities(rawPhysicalDataEntities);

  // Build initial model with all entity arrays (including new business_points, endpoints, interactions, app_business_points, events, classes, methods, states, state_transitions, activities, activity_flows, activity_partitions, ui_screens, ui_components, ui_actions, business_logics)
  const initialModel: ArchitectureModel = {
    metaModel: {
      entities: {
        business_users: getArrayOrDefault(entities.business_users) as ArchitectureModel['metaModel']['entities']['business_users'],
        business_processes: getArrayOrDefault(entities.business_processes) as ArchitectureModel['metaModel']['entities']['business_processes'],
        process_activities: migratedProcessActivities,
        business_points: getArrayOrDefault(entities.business_points) as ArchitectureModel['metaModel']['entities']['business_points'],
        applications: getArrayOrDefault(entities.applications) as ArchitectureModel['metaModel']['entities']['applications'],
        app_components: getArrayOrDefault(entities.app_components) as ArchitectureModel['metaModel']['entities']['app_components'],
        services: getArrayOrDefault(entities.services) as ArchitectureModel['metaModel']['entities']['services'],
        interfaces: getArrayOrDefault(entities.interfaces) as ArchitectureModel['metaModel']['entities']['interfaces'],
        endpoints: getArrayOrDefault(entities.endpoints) as ArchitectureModel['metaModel']['entities']['endpoints'],
        classes: getArrayOrDefault(entities.classes) as Class[],
        methods: getArrayOrDefault(entities.methods) as Method[],
        application_points: getArrayOrDefault(entities.application_points) as ArchitectureModel['metaModel']['entities']['application_points'],
        logical_data_entities: getArrayOrDefault(entities.logical_data_entities) as ArchitectureModel['metaModel']['entities']['logical_data_entities'],
        logical_data_attributes: getArrayOrDefault(entities.logical_data_attributes) as ArchitectureModel['metaModel']['entities']['logical_data_attributes'],
        physical_data_entities: migratedPhysicalDataEntities,
        physical_data_attributes: getArrayOrDefault(entities.physical_data_attributes) as ArchitectureModel['metaModel']['entities']['physical_data_attributes'],
        interactions: getArrayOrDefault(entities.interactions) as ArchitectureModel['metaModel']['entities']['interactions'],
        app_business_points: getArrayOrDefault(entities.app_business_points) as AppBusinessPoint[],
        events: getArrayOrDefault(entities.events) as Event[],
        states: getArrayOrDefault(entities.states) as State[],
        state_transitions: getArrayOrDefault(entities.state_transitions) as StateTransition[],
        activities: getArrayOrDefault(entities.activities) as Activity[],
        activity_flows: getArrayOrDefault(entities.activity_flows) as ActivityFlow[],
        activity_partitions: getArrayOrDefault(entities.activity_partitions) as ActivityPartition[],
        ui_screens: getArrayOrDefault(entities.ui_screens) as UIScreen[],  // Spec 2026-01-02: UI Architecture
        ui_components: getArrayOrDefault(entities.ui_components) as UIComponent[],  // Spec 2026-01-03: Meta-Model UI Domain Tab
        ui_actions: getArrayOrDefault(entities.ui_actions) as UIAction[],  // Spec 2026-01-03: Meta-Model UI Domain Tab
        business_logics: getArrayOrDefault(entities.business_logics) as BusinessLogic[],  // Spec: Business Logic Entity v1
        package_sets: getArrayOrDefault(entities.package_sets) as ArchitectureModel['metaModel']['entities']['package_sets'],  // Spec: Package Sets Persistence
        packages: getArrayOrDefault(entities.packages) as ArchitectureModel['metaModel']['entities']['packages'],  // Spec: Package Sets Persistence
        ui_characteristics: getArrayOrDefault(entities.ui_characteristics) as UICharacteristic[],  // Spec 2026-01-20: UI Characteristics
        user_journeys: getArrayOrDefault(entities.user_journeys) as UserJourney[],  // Business domain: User Journeys
        activity_steps: getArrayOrDefault(entities.activity_steps) as ActivityStep[],  // Business domain: Activity Steps
        // Spec 2026-05-04: Infrastructure Domain Frontend Types - 13 entity collections (parsed if present, else default to [])
        environments: getArrayOrDefault(entities.environments) as ArchitectureModel['metaModel']['entities']['environments'],
        cloud_accounts: getArrayOrDefault(entities.cloud_accounts) as ArchitectureModel['metaModel']['entities']['cloud_accounts'],
        locations: getArrayOrDefault(entities.locations) as ArchitectureModel['metaModel']['entities']['locations'],
        networks: getArrayOrDefault(entities.networks) as ArchitectureModel['metaModel']['entities']['networks'],
        subnets: getArrayOrDefault(entities.subnets) as ArchitectureModel['metaModel']['entities']['subnets'],
        compute_clusters: getArrayOrDefault(entities.compute_clusters) as ArchitectureModel['metaModel']['entities']['compute_clusters'],
        compute_resources: getArrayOrDefault(entities.compute_resources) as ArchitectureModel['metaModel']['entities']['compute_resources'],
        deployment_units: getArrayOrDefault(entities.deployment_units) as ArchitectureModel['metaModel']['entities']['deployment_units'],
        load_balancers: getArrayOrDefault(entities.load_balancers) as ArchitectureModel['metaModel']['entities']['load_balancers'],
        listeners: getArrayOrDefault(entities.listeners) as ArchitectureModel['metaModel']['entities']['listeners'],
        data_store_instances: getArrayOrDefault(entities.data_store_instances) as ArchitectureModel['metaModel']['entities']['data_store_instances'],
        infrastructure_resources: getArrayOrDefault(entities.infrastructure_resources) as ArchitectureModel['metaModel']['entities']['infrastructure_resources'],
        infrastructure_points: getArrayOrDefault(entities.infrastructure_points) as ArchitectureModel['metaModel']['entities']['infrastructure_points'],
        // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
        iac_sources: getArrayOrDefault(entities.iac_sources) as ArchitectureModel['metaModel']['entities']['iac_sources'],
        // Spec 2026-05-06: Library Frontend Types & Tables
        libraries: getArrayOrDefault(entities.libraries) as ArchitectureModel['metaModel']['entities']['libraries'],
      },
      relationships: {
        // Business Point relationship arrays (new format only - legacy arrays are silently ignored)
        business_user_business_points: getArrayOrDefault(relationships.business_user_business_points) as ArchitectureModel['metaModel']['relationships']['business_user_business_points'],
        application_point_business_points: getArrayOrDefault(relationships.application_point_business_points) as ArchitectureModel['metaModel']['relationships']['application_point_business_points'],
        // Other relationships
        logical_data_entity_relationships: getArrayOrDefault(relationships.logical_data_entity_relationships) as ArchitectureModel['metaModel']['relationships']['logical_data_entity_relationships'],
        logical_data_entity_physical_data_entities: getArrayOrDefault(relationships.logical_data_entity_physical_data_entities) as ArchitectureModel['metaModel']['relationships']['logical_data_entity_physical_data_entities'],
        logical_data_attribute_physical_data_attributes: getArrayOrDefault(relationships.logical_data_attribute_physical_data_attributes) as ArchitectureModel['metaModel']['relationships']['logical_data_attribute_physical_data_attributes'],
        data_movements: getArrayOrDefault(relationships.data_movements) as ArchitectureModel['metaModel']['relationships']['data_movements'],
        interface_logical_entities: getArrayOrDefault(relationships.interface_logical_entities) as ArchitectureModel['metaModel']['relationships']['interface_logical_entities'],
        ui_workflow_transitions: getArrayOrDefault(relationships.ui_workflow_transitions) as UIWorkflowTransition[],  // Spec 2026-01-02: UI Architecture
        application_point_business_logics: getArrayOrDefault(relationships.application_point_business_logics) as ArchitectureModel['metaModel']['relationships']['application_point_business_logics'],  // Spec: Business Logic Entity v1
        // Spec 2026-05-04: Infrastructure Domain Frontend Types - 3 relationship collections
        resource_subnet_hostings: getArrayOrDefault(relationships.resource_subnet_hostings) as ArchitectureModel['metaModel']['relationships']['resource_subnet_hostings'],
        deployment_unit_compute_resources: getArrayOrDefault(relationships.deployment_unit_compute_resources) as ArchitectureModel['metaModel']['relationships']['deployment_unit_compute_resources'],
        load_balancer_resource_routes: getArrayOrDefault(relationships.load_balancer_resource_routes) as ArchitectureModel['metaModel']['relationships']['load_balancer_resource_routes'],
        // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
        iac_resource_bindings: getArrayOrDefault(relationships.iac_resource_bindings) as ArchitectureModel['metaModel']['relationships']['iac_resource_bindings'],
      },
    },
    diagrams: parseDiagrams(getArrayOrDefault(obj.diagrams) as unknown[]),
  };

  // Reconcile Business Points to ensure all Business Processes and Process Activities
  // have corresponding Business Points. This is the only synchronization step needed.
  // Note: Data Entity Point normalization has been removed - point-id fields are now required.
  const reconciledMetaModel = reconcileBusinessPoints(initialModel.metaModel);

  return {
    metaModel: reconciledMetaModel,
    diagrams: initialModel.diagrams,
  };
}

// Serialize model to formatted JSON
export function serializeModel(model: ArchitectureModel): string {
  return JSON.stringify(model, null, 2);
}

// Load JSON file
export async function loadJsonFile(file: File): Promise<{
  model: ArchitectureModel | null;
  errors: ValidationError[];
  fileName: string;
}> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result as string;

      // Parse JSON
      const { data, error: parseError } = parseJSON(content);

      if (parseError || !data) {
        resolve({
          model: null,
          errors: [
            {
              entityType: 'root',
              entityId: '',
              field: '',
              message: parseError || 'Failed to parse JSON',
              type: 'invalid_json',
            },
          ],
          fileName: file.name,
        });
        return;
      }

      // Validate structure (only rejects malformed JSON or non-array types)
      const structureErrors = validateJsonStructure(data);
      if (structureErrors.length > 0) {
        resolve({
          model: null,
          errors: structureErrors,
          fileName: file.name,
        });
        return;
      }

      // Build model with defaults for missing arrays
      let model: ArchitectureModel;
      try {
        model = buildModelFromData(data);
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Unknown error building model';
        resolve({
          model: null,
          errors: [
            {
              entityType: 'root',
              entityId: '',
              field: '',
              message: error,
              type: 'invalid_json',
            },
          ],
          fileName: file.name,
        });
        return;
      }

      // Validate model (FK references, required fields, etc.)
      // Note: We return the model even if there are validation errors,
      // so the user can see and fix them in the UI
      const validationErrors = validateModel(model);

      resolve({
        model,
        errors: validationErrors,
        fileName: file.name,
      });
    };

    reader.onerror = () => {
      resolve({
        model: null,
        errors: [
          {
            entityType: 'root',
            entityId: '',
            field: '',
            message: 'Failed to read file',
            type: 'invalid_json',
          },
        ],
        fileName: file.name,
      });
    };

    reader.readAsText(file);
  });
}

// Trigger file input click
export function triggerFileInput(
  inputRef: React.RefObject<HTMLInputElement>
): void {
  inputRef.current?.click();
}

// Get default filename
export function getDefaultFileName(): string {
  return 'architecture-model.json';
}

// ============================================================================
// Spec 2026-01-06: Filename Sanitization Utility
// ============================================================================

/**
 * Sanitizes a string for use as a filename by removing characters that are
 * invalid in filenames on most operating systems.
 *
 * Invalid characters removed: < > : " / \ | ? *
 *
 * @param name - The string to sanitize
 * @returns The sanitized string safe for use as a filename
 */
export function sanitizeFilename(name: string): string {
  // Remove characters that are invalid in filenames on Windows/Mac/Linux
  // Characters: < > : " / \ | ? *
  return name.replace(/[<>:"/\\|?*]/g, '');
}

/**
 * Triggers a file download in the browser.
 *
 * Spec 2026-01-06: Frontend Project Snapshot Export/Import
 * Task Group 3: TopBar Integration
 *
 * Uses the Blob + URL.createObjectURL pattern for triggering downloads.
 *
 * @param content - The content to download (typically JSON string)
 * @param filename - The filename for the download
 * @param mimeType - The MIME type for the Blob (default: 'application/json')
 */
export function triggerDownload(content: string, filename: string, mimeType: string = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
