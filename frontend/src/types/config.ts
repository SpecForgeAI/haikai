export interface AppConfig {
  canvas: {
    defaultWidth: number;
    defaultHeight: number;
  };
  zoom: {
    min: number;
    max: number;
    default: number;
    step: number;
  };
  grid: {
    rowHeight: number;
    headerHeight: number;
  };
  node: {
    minWidth: number;
    minHeight: number;
    padding: number;
    labelPadding: number;
    borderRadius: number;
    borderWidth: number;
    fontSize: number;
  };
  edge: {
    lineWidth: number;
    arrowSize: number;
    labelFontSize: number;
  };
}

/**
 * ValidationError interface
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * Added 'xor_constraint' type for XOR validation errors (exactly one of N fields must be set)
 *
 * Save-Validation Improvement Series Step 3:
 * Added the following type variants to support frontend pre-save validators that mirror backend rules:
 * - 'conditional_required': a field is required when another field has a specific value
 *   (e.g. UIAction.contract_id required when effect_type === 'CALL_API')
 * - 'invalid_enum': a field value is not in the allowed enum set
 *   (e.g. UserJourneyLink.relationship_type)
 * - 'pairwise_constraint': two fields must both be set or both be blank/null
 *   (e.g. ApplicationPoint.target_type / target_ref_id)
 * - 'missing_reference': a required relationship endpoint reference is missing
 *   (e.g. LogicalDataEntityRelationship.fromDataEntityPointId / toDataEntityPointId)
 */
export interface ValidationError {
  entityType: string;
  entityId: string;
  field: string;
  message: string;
  type:
    | 'required'
    | 'invalid_fk'
    | 'duplicate_id'
    | 'invalid_json'
    | 'missing_array'
    | 'consistency'
    | 'duplicate_name'
    | 'xor_constraint'
    | 'conditional_required'
    | 'invalid_enum'
    | 'pairwise_constraint'
    | 'missing_reference';
  /**
   * The entity's name for display purposes in error messages.
   * Used to provide context in formatted error messages.
   */
  entityName?: string;
}

// Spec: Global Application Point Picker with Derived ApplicationPoints
// Added 'application_point_picker' cell type for grouped dropdown with Services/Classes/Methods
// Spec 2026-01-06: Service Package Set Assignment Dropdown
// Added 'package_set_dropdown' cell type for package set selection
// Spec: Data Entity Point UI Switch
// Added 'data_entity_point_picker' cell type for unified logical/physical entity selection
// Spec: Method Parameters/Returns/Throws Type-Oriented Input
// Added 'free_text_typeahead_single_token' cell type for single-token type names with suggestions
// Spec 2026-05-04: Infrastructure Domain Tables UI
// Added 'infrastructure_point_picker' cell type for polymorphic InfrastructurePoint selection
// across the 12 Infrastructure entity types (Environment, CloudAccount, Location, Network,
// Subnet, ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer, Listener,
// DataStoreInstance, InfrastructureResource).
export type CellType =
  | 'text'
  | 'tags'
  | 'boolean'
  | 'dropdown'
  | 'fk_typeahead'
  | 'text_with_suggestions'
  | 'application_point_picker'
  | 'package_set_dropdown'
  | 'data_entity_point_picker'
  | 'free_text_typeahead_single_token'
  | 'tech_hints_cell'
  // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
  // Read-only display of a structural-fidelity JSONB block (constraint/index
  // metadata on physical_data_entities; FK join/referenced columns on
  // logical_data_entity_relationships). Renders a compact human summary with
  // the full JSON in a hover title; never editable. NOT exported to XLSX (the
  // nested object does not fit the flat cell model - see excelOperations.ts).
  | 'json_summary'
  | 'infrastructure_point_picker';

/**
 * XOR Validation Rule Definition
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * Defines XOR validation rules where exactly one of the specified fields must be set.
 */
export interface XORValidationRule {
  /** The entity type this rule applies to */
  entityType: string;
  /** Array of field names that participate in the XOR constraint */
  fields: string[];
  /** Error message template - can include {fields} placeholder */
  message: string;
}

export interface GridColumnConfig {
  field: string;
  displayName: string;
  cellType: CellType;
  required: boolean;
  width: number;
  options?: string[];
  fkTarget?: string;
  autoGenerate?: boolean;
  /**
   * Optional display formatter for FK typeahead cells.
   * When provided, formats the display string for dropdown options and filtering.
   * @param id - The entity ID to look up
   * @param entities - Array of target entities to search
   * @returns Formatted display string for the entity
   */
  displayFormatter?: (id: string, entities: unknown[]) => string;
  /**
   * Optional field name to read for dynamic FK target resolution.
   * When set, the Grid component reads the value from this field on the row
   * and uses dynamicFkTargetMap to determine the actual fkTarget.
   * Spec: Expand Application Points to Reference Service/Class/Method
   */
  dynamicFkTargetField?: string;
  /**
   * Optional mapping from field value to entity type for dynamic FK resolution.
   * Used in conjunction with dynamicFkTargetField to resolve the actual fkTarget
   * based on row data.
   * Example: { 'SERVICE': 'services', 'CLASS': 'classes', 'METHOD': 'methods' }
   * Spec: Expand Application Points to Reference Service/Class/Method
   */
  dynamicFkTargetMap?: Record<string, string>;
  /**
   * Optional array of suggestion strings to display as clickable chips
   * when the cell type is 'text_with_suggestions'. These are non-enforcing
   * hints that help users enter common values quickly while allowing
   * free-text input.
   * Spec: Business Logic Type Suggestions (Non-Enforcing)
   */
  suggestions?: string[];
  /**
   * Optional array of entity type keys to derive suggestions from.
   * Used with 'free_text_typeahead_single_token' cellType.
   * The component extracts 'name' field from entities in these collections.
   * Example: ['logical_data_entities', 'physical_data_entities']
   * Spec: Method Parameters/Returns/Throws Type-Oriented Input
   */
  suggestionSources?: string[];
  /**
   * Optional array of static suggestions to combine with entity-derived suggestions.
   * Used with 'free_text_typeahead_single_token' cellType.
   * Example: ['RuntimeException', 'IllegalArgumentException']
   * Spec: Method Parameters/Returns/Throws Type-Oriented Input
   */
  staticSuggestions?: string[];
  /**
   * Spec 2026-01-11: Data Movement Interface Schema Extension
   * Optional array of field names that form an XOR group with this field.
   * When set, exactly one of the fields in the XOR group must have a value.
   * Setting a value in one field should clear values in the other XOR fields.
   */
  xorGroup?: string[];
  /**
   * Spec 2026-01-20: UI Characteristics Entity - Dynamic Key Suggestions
   * When true, suggestions for this field are dynamically determined based on
   * other row values (e.g., the 'type' field in ui_characteristics).
   * Used with 'text_with_suggestions' cellType.
   */
  dynamicSuggestions?: boolean;
  /**
   * Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
   * Optional formatter to convert option values to display labels.
   * Used with 'dropdown' cellType to show human-friendly labels
   * while storing the original value.
   * Example: (value) => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
   */
  formatOptionLabel?: (value: string) => string;
  /**
   * Optional array of Application Point kinds to display in the picker.
   * When set, only groups whose kind is in this list are shown.
   * Used with 'application_point_picker' cellType.
   * Example: ['APPLICATION', 'APP_COMPONENT', 'SERVICE']
   *
   * Spec 2026-05-04: Infrastructure Domain Tables UI
   * Also reused by 'infrastructure_point_picker' cellType to filter the
   * 12 InfrastructurePoint kinds (e.g. ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']).
   */
  allowedKinds?: string[];
}

export interface EntityColors {
  background: string;
  border: string;
}
