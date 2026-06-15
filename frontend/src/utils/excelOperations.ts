/**
 * Excel Operations Utility
 *
 * Provides import/export functionality for meta-model data using xlsx library.
 * Export creates worksheets for entity and relationship tables.
 * Import parses xlsx files and appends data to existing model.
 *
 * Spec 2026-01-11: Fix Export as XLSX by Enforcing Excel-Safe Worksheet Names
 * - Added canonical mapping constant META_MODEL_XLSX_SHEET_NAME_BY_KEY
 * - Added helper functions: getSheetNameForKey, toExcelSafeSheetName, ensureUniqueSheetName
 * - Refactored export to use key-based naming instead of tab names
 * - Updated reverse mapping functions for import compatibility
 *
 * Spec 2026-01-11: Redesign Import as XLSX for Architecture Meta-Model
 * - Added ImportMode type ('append' | 'overwrite')
 * - importMetaModelFromExcel now accepts mode parameter
 * - Entity-first processing order (entities before relationships)
 * - Row matching by 'name' field for entities
 * - Append mode: skip existing rows, add new rows only
 * - Overwrite mode: update matching rows (preserve IDs), add new rows
 * - Relationship FK validation against combined entity set (non-blocking)
 * - Exclude logical_data_attribute_physical_data_attributes from row matching
 * - Enhanced ImportResult with rowsUpdated counts
 *
 * Spec 2026-01-11: Interface Entity Relationship Refactor
 * - Added XLSX_HEADER_TO_FIELD for mapping Excel column headers to entity field names
 * - Maps legacy "Logical Entity" column to new "dataEntityPointId" field for interface_logical_entities
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 4: XLSX Metadata Worksheet
 * - Added _metadata worksheet as first sheet in XLSX exports
 * - Contains project_name and export_date columns
 * - Import reads project_name from _metadata and includes in ImportResult
 * - Added projectName field to ImportResult interface
 */

import * as XLSX from 'xlsx';
import { ArchitectureModel } from '../types/model';
import {
  gridConfigs,
  entityTabNames,
  relationshipTabNames,
  tabToEntityType,
  relationshipTabToType,
} from '../config/gridConfigs';
import { generateEntityId, generateRelationshipId } from './idGenerator';
import { GridColumnConfig } from '../types/config';
import {
  DATA_ENTITY_POINT_PREFIXES,
  DATA_ENTITY_TYPE_BADGES,
} from './dataEntityPointOptions';

// Derived entities to exclude from export (these are computed, not user-entered)
const DERIVED_ENTITY_TYPES = ['application_points', 'business_points', 'app_business_points'];

// Relationship types excluded from row matching (always import as-is)
const EXCLUDED_FROM_MATCHING = new Set(['logical_data_attribute_physical_data_attributes']);

// Metadata worksheet name (Spec 2026-01-19)
const METADATA_WORKSHEET_NAME = '_metadata';

// ============================================================================
// Excel Header → Field Mappings
// ============================================================================

/**
 * Maps Excel column headers to entity/relationship field names when the header
 * doesn't match the gridConfig displayName (e.g., gateway-generated XLSX files
 * use prefixed headers like "Activity Name" while gridConfig uses "Name").
 *
 * Format: { [typeKey]: { [excelHeader]: fieldName } }
 */
const XLSX_HEADER_TO_FIELD: Record<string, Record<string, string>> = {
  'interface_logical_entities': {
    'Logical Entity': 'dataEntityPointId',
    'logical_entity_id': 'dataEntityPointId',
  },
  'process_activities': {
    'Activity Name': 'name',
    'Activity Description': 'description',
    'Activity Frequency': 'frequency',
    'Activity User Interaction Level': 'user_interaction_level',
    'Parent Business Process': 'business_process_id',
  },
  'user_journeys': {
    'User Journey Name': 'name',
    'User Journey Description': 'description',
    'Primary Business User Role': 'primary_business_user_id',
  },
  'activity_steps': {
    'Activity Step Name': 'name',
    'Activity Step Diagram Label': 'diagram_label',
    'Activity Step Description': 'description',
    'Activity Step Order': 'sequence_order',
    'User Journey Name': 'user_journey_id',
    'Activity Name': 'process_activity_id',
    'Business User Role': 'business_user_id',
    'Activity Related Issues': 'activity_issues',
    'UI Related Issues': 'ui_issues',
  },
  'user_journey_links': {
    'Source User Journey': 'source_user_journey_id',
    'Target User Journey': 'target_user_journey_id',
    'Relationship Type': 'relationship_type',
  },
};

/**
 * Convert legacy column values to new format during import.
 *
 * Spec 2026-01-11: Interface Entity Relationship Refactor
 * - Converts logical_entity_id values (lde_xxx) to dataEntityPointId format (dep_log_lde_xxx)
 *
 * @param typeKey - Entity or relationship type key
 * @param fieldName - Field name being processed
 * @param value - Raw value from import
 * @returns Converted value or original value if no conversion needed
 */
function convertLegacyValue(typeKey: string, fieldName: string, value: unknown): unknown {
  if (typeKey === 'interface_logical_entities' && fieldName === 'dataEntityPointId') {
    // Convert legacy logical_entity_id format to dataEntityPointId format
    const strValue = String(value);
    // If it's already in dep_log_ or dep_phy_ format, return as-is
    if (strValue.startsWith('dep_log_') || strValue.startsWith('dep_phy_')) {
      return strValue;
    }
    // If it's a legacy logical entity ID (lde_xxx), convert to dep_log_lde_xxx
    if (strValue.startsWith('lde_')) {
      return `dep_log_${strValue}`;
    }
    // If it's a legacy physical entity ID (pde_xxx), convert to dep_phy_pde_xxx
    if (strValue.startsWith('pde_')) {
      return `dep_phy_${strValue}`;
    }
    // Otherwise return as-is (could be a data entity point ID already)
    return strValue;
  }
  return value;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Import mode type - Append or Overwrite
 *
 * Spec 2026-01-11: Redesign Import as XLSX
 */
export type ImportMode = 'append' | 'overwrite';

/**
 * Individual error from import validation
 */
export interface ImportError {
  row: number;
  field: string;
  message: string;
}

/**
 * Result for a single worksheet import
 *
 * Spec 2026-01-11: Added rowsUpdated field
 */
export interface WorksheetImportResult {
  worksheetName: string;
  entityType: string;
  isRelationship: boolean;
  rowsImported: number;
  rowsSkipped: number;
  rowsUpdated: number;
  errors: ImportError[];
}

/**
 * Overall import result
 *
 * Spec 2026-01-11: Added updatedEntities, updatedRelationships, totalRowsUpdated, mode
 * Spec 2026-01-19: Added projectName for metadata worksheet support
 */
export interface ImportResult {
  success: boolean;
  worksheetResults: WorksheetImportResult[];
  newEntities: Record<string, unknown[]>;
  newRelationships: Record<string, unknown[]>;
  updatedEntities?: Record<string, unknown[]>;
  updatedRelationships?: Record<string, unknown[]>;
  ignoredWorksheets: string[];
  totalRowsImported?: number;
  totalRowsSkipped?: number;
  totalRowsUpdated?: number;
  totalErrors?: number;
  mode?: ImportMode;
  /** Project name from _metadata worksheet (Spec 2026-01-19) */
  projectName?: string;
}

// ============================================================================
// Canonical Worksheet Name Mapping (Spec 2026-01-11)
// ============================================================================

/**
 * Canonical mapping from entity/relationship type keys to Excel worksheet names.
 * This is the single source of truth for all XLSX worksheet names.
 *
 * Only contains explicit entries for overlength keys that exceed Excel's
 * 31-character worksheet name limit. All other keys use identity mapping
 * (the key itself as the sheet name).
 *
 * Overlength keys and their abbreviated sheet names:
 * - application_point_business_points (33 chars) -> app_point_business_points (25 chars)
 * - logical_data_entity_relationships (33 chars) -> logical_entity_relationships (28 chars)
 * - application_point_business_logics (33 chars) -> app_point_business_logics (25 chars)
 * - logical_data_entity_physical_data_entities (42 chars) -> logical_entity_physical_ents (28 chars)
 * - logical_data_attribute_physical_data_attributes (47 chars) -> logical_attr_physical_attrs (27 chars)
 *
 * Spec 2026-05-04: Infrastructure Domain Tables UI - 1 overlength relationship key:
 * - deployment_unit_compute_resources (33 chars) -> deployment_unit_compute_res (27 chars)
 */
export const META_MODEL_XLSX_SHEET_NAME_BY_KEY: Record<string, string> = {
  // 5 overlength relationship keys that need abbreviation
  'application_point_business_points': 'app_point_business_points',
  'logical_data_entity_relationships': 'logical_entity_relationships',
  'application_point_business_logics': 'app_point_business_logics',
  'logical_data_entity_physical_data_entities': 'logical_entity_physical_ents',
  'logical_data_attribute_physical_data_attributes': 'logical_attr_physical_attrs',
  // Spec 2026-05-04: Infrastructure Domain Tables UI - overlength relationship key
  'deployment_unit_compute_resources': 'deployment_unit_compute_res',
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 2 overlength
  // relationship keys. Without these entries the export truncated the raw key
  // to 31 chars and the import reverse-lookup could no longer round-trip them.
  'application_infrastructure_resource_uses': 'app_infra_resource_uses',
  'application_load_balancer_exposures': 'app_load_balancer_exposures',
};

/**
 * Reverse mapping from Excel worksheet names back to entity/relationship type keys.
 * Generated by inverting META_MODEL_XLSX_SHEET_NAME_BY_KEY.
 * Used by import functions to recognize canonical abbreviated sheet names.
 */
export const XLSX_SHEET_NAME_TO_KEY: Record<string, string> = {
  // Auto-generated reverse mappings for abbreviated sheet names
  ...Object.fromEntries(
    Object.entries(META_MODEL_XLSX_SHEET_NAME_BY_KEY).map(([key, sheetName]) => [sheetName, key])
  ),
  // Gateway-format worksheet names (title-case with spaces)
  'Process Activities': 'process_activities',
  'User Journeys': 'user_journeys',
  'Activity Steps': 'activity_steps',
  'User Journey Links': 'user_journey_links',
};

// ============================================================================
// Worksheet Name Helper Functions (Spec 2026-01-11)
// ============================================================================

/**
 * Get the canonical worksheet name for an entity or relationship type key.
 * Uses the canonical mapping for overlength keys, otherwise returns the key itself.
 *
 * @param key - Entity or relationship type key (e.g., 'business_users', 'logical_data_entity_relationships')
 * @returns Canonical worksheet name (max 31 chars for mapped keys)
 */
export function getSheetNameForKey(key: string): string {
  return META_MODEL_XLSX_SHEET_NAME_BY_KEY[key] ?? key;
}

/**
 * Convert a name to an Excel-safe worksheet name.
 * Enforces all Excel worksheet name constraints:
 * - Replaces illegal characters \ / ? * [ ] with underscore _
 * - Trims leading/trailing whitespace
 * - Truncates to 31 characters maximum
 *
 * @param name - Input name to convert
 * @returns Excel-safe worksheet name
 */
export function toExcelSafeSheetName(name: string): string {
  // Replace illegal characters with underscore
  let safeName = name.replace(/[\\/?*[\]]/g, '_');

  // Trim whitespace
  safeName = safeName.trim();

  // Truncate to 31 characters
  if (safeName.length > 31) {
    safeName = safeName.slice(0, 31);
  }

  return safeName;
}

/**
 * Ensure a worksheet name is unique within a workbook.
 * If the name already exists, appends _2, _3, etc. until unique.
 * Adds the returned name to the existingNames set.
 *
 * @param name - Proposed worksheet name
 * @param existingNames - Set of already-used worksheet names (modified in place)
 * @returns Unique worksheet name
 */
export function ensureUniqueSheetName(name: string, existingNames: Set<string>): string {
  if (!existingNames.has(name)) {
    existingNames.add(name);
    return name;
  }

  // Find unique suffix
  let suffix = 2;
  let uniqueName = `${name}_${suffix}`;
  while (existingNames.has(uniqueName)) {
    suffix++;
    uniqueName = `${name}_${suffix}`;
  }

  existingNames.add(uniqueName);
  return uniqueName;
}

// ============================================================================
// Legacy Worksheet Naming Functions (Deprecated)
// ============================================================================

/**
 * Get worksheet name for an entity tab.
 * Excel worksheet names have a 31 character limit.
 *
 * @deprecated Use getSheetNameForKey(entityType) instead for key-based naming.
 * This function is kept for backward compatibility with existing code.
 *
 * @param tabName - The tab name from entityTabNames
 * @returns Worksheet name (max 31 chars)
 */
export function getEntityWorksheetName(tabName: string): string {
  return tabName.slice(0, 31);
}

/**
 * Get worksheet name for a relationship tab.
 * Replaces <-> with - for Excel compatibility.
 * Excel worksheet names have a 31 character limit.
 *
 * @deprecated Use getSheetNameForKey(relationshipType) instead for key-based naming.
 * This function is kept for backward compatibility with existing code.
 *
 * @param tabName - The tab name from relationshipTabNames
 * @returns Worksheet name with hyphen format (max 31 chars)
 */
export function getRelationshipWorksheetName(tabName: string): string {
  return tabName.replace(/<->/g, '-').slice(0, 31);
}

// ============================================================================
// Entity/Relationship Type Mapping
// ============================================================================

/**
 * Get exportable entity types (excludes derived entities).
 * @returns Array of entity types that should be exported
 */
export function getExportableEntityTypes(): string[] {
  return entityTabNames
    .map((tabName) => tabToEntityType[tabName])
    .filter((entityType) => entityType && !DERIVED_ENTITY_TYPES.includes(entityType));
}

/**
 * Get exportable relationship types.
 * @returns Array of relationship types that should be exported
 */
export function getExportableRelationshipTypes(): string[] {
  return relationshipTabNames
    .map((tabName) => relationshipTabToType[tabName])
    .filter((relType) => relType !== undefined);
}

/**
 * Map worksheet name back to entity type.
 * Uses the reverse mapping constant for canonical abbreviated names,
 * then falls back to matching entity type keys directly.
 *
 * @param sheetName - Worksheet name
 * @returns Entity type or undefined if not found
 */
export function worksheetNameToEntityType(sheetName: string): string | undefined {
  // First check reverse mapping for abbreviated names
  const mappedKey = XLSX_SHEET_NAME_TO_KEY[sheetName];
  if (mappedKey) {
    // The mapped key is a relationship type, not an entity type
    // Check if it's actually an entity type
    const entityTypes = Object.values(tabToEntityType);
    if (entityTypes.includes(mappedKey)) {
      return mappedKey;
    }
  }

  // Check if sheet name matches an entity type key directly
  const entityTypes = Object.values(tabToEntityType);
  if (entityTypes.includes(sheetName)) {
    return sheetName;
  }

  return undefined;
}

/**
 * Map worksheet name back to relationship type.
 * Uses the reverse mapping constant for canonical abbreviated names,
 * then falls back to matching relationship type keys directly.
 *
 * @param sheetName - Worksheet name
 * @returns Relationship type or undefined if not found
 */
export function worksheetNameToRelationshipType(sheetName: string): string | undefined {
  // First check reverse mapping for abbreviated names
  const mappedKey = XLSX_SHEET_NAME_TO_KEY[sheetName];
  if (mappedKey) {
    // Verify it's a relationship type
    const relTypes = Object.values(relationshipTabToType);
    if (relTypes.includes(mappedKey)) {
      return mappedKey;
    }
  }

  // Check if sheet name matches a relationship type key directly
  const relTypes = Object.values(relationshipTabToType);
  if (relTypes.includes(sheetName)) {
    return sheetName;
  }

  return undefined;
}

// ============================================================================
// Header/Field Mapping
// ============================================================================

/**
 * Get column headers (display names) for an entity/relationship type.
 * @param type - Entity or relationship type
 * @returns Array of display names in column order
 */
function getColumnHeaders(type: string): string[] {
  const config = gridConfigs[type];
  if (!config) return [];
  // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
  // 'json_summary' columns (constraints_metadata, fk_columns) are nested
  // discovery-sourced structural metadata that do NOT fit the flat XLSX cell
  // model (they would serialise as [object Object] and could not be parsed back
  // on import). They are EXPLICITLY scoped out of XLSX ingestion - populated
  // only by the discovery DB scan - so they are excluded from both headers and
  // row data here.
  return config.filter((col) => col.cellType !== 'json_summary').map((col) => col.displayName);
}

/**
 * Create mapping from display name to field name for an entity/relationship type.
 * @param type - Entity or relationship type
 * @returns Map of displayName -> field
 */
function getDisplayNameToFieldMap(type: string): Map<string, string> {
  const config = gridConfigs[type];
  const map = new Map<string, string>();
  if (!config) return map;
  config.forEach((col) => {
    map.set(col.displayName, col.field);
  });
  return map;
}

/**
 * Get required fields for an entity/relationship type.
 * @param type - Entity or relationship type
 * @returns Set of required field names
 */
function getRequiredFields(type: string): Set<string> {
  const config = gridConfigs[type];
  if (!config) return new Set();
  return new Set(config.filter((col) => col.required).map((col) => col.field));
}

/**
 * Get FK target mappings for an entity/relationship type.
 * @param type - Entity or relationship type
 * @returns Map of field -> fkTarget
 */
function getFkFields(type: string): Map<string, string> {
  const config = gridConfigs[type];
  const map = new Map<string, string>();
  if (!config) return map;
  config.forEach((col) => {
    if (col.cellType === 'fk_typeahead' && col.fkTarget) {
      map.set(col.field, col.fkTarget);
    }
  });
  return map;
}

// ============================================================================
// Metadata Worksheet Functions (Spec 2026-01-19)
// ============================================================================

/**
 * Create the _metadata worksheet for XLSX export.
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 4: XLSX Metadata Worksheet
 *
 * Creates a worksheet with two columns:
 * - project_name: The name of the project
 * - export_date: ISO timestamp of when the export occurred
 *
 * @param projectName - The project name to include in metadata
 * @returns XLSX worksheet for metadata
 */
function createMetadataWorksheet(projectName: string): XLSX.WorkSheet {
  const exportDate = new Date().toISOString();
  const data = [
    ['project_name', 'export_date'],
    [projectName, exportDate],
  ];
  return XLSX.utils.aoa_to_sheet(data);
}

/**
 * Read project name from the _metadata worksheet.
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 4: XLSX Metadata Worksheet
 *
 * @param workbook - XLSX workbook to read from
 * @returns Project name if found, undefined otherwise
 */
function readProjectNameFromMetadata(workbook: XLSX.WorkBook): string | undefined {
  // Check if _metadata worksheet exists
  if (!workbook.SheetNames.includes(METADATA_WORKSHEET_NAME)) {
    return undefined;
  }

  const metadataSheet = workbook.Sheets[METADATA_WORKSHEET_NAME];
  if (!metadataSheet) {
    return undefined;
  }

  // Parse the sheet as JSON with headers
  const data = XLSX.utils.sheet_to_json(metadataSheet) as Record<string, unknown>[];
  if (!data || data.length === 0) {
    return undefined;
  }

  // Get project_name from first row
  const firstRow = data[0];
  const projectName = firstRow['project_name'];

  if (typeof projectName === 'string' && projectName.trim().length > 0) {
    return projectName.trim();
  }

  return undefined;
}

// ============================================================================
// Export Implementation
// ============================================================================

/**
 * Convert entity data to worksheet format with display name headers.
 * @param entities - Array of entity objects
 * @param entityType - Entity type for column config lookup
 * @returns Array of objects with display name keys
 */
function entitiesToWorksheetData(entities: unknown[], entityType: string): Record<string, unknown>[] {
  const config = gridConfigs[entityType];
  if (!config || entities.length === 0) return [];

  return entities.map((entity) => {
    const row: Record<string, unknown> = {};
    const entityObj = entity as Record<string, unknown>;
    config.forEach((col) => {
      // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
      // Skip 'json_summary' columns (constraints_metadata, fk_columns): nested
      // objects are explicitly scoped out of XLSX (see getColumnHeaders).
      if (col.cellType === 'json_summary') return;
      row[col.displayName] = entityObj[col.field] ?? '';
    });
    return row;
  });
}

/**
 * Export meta-model to Excel file.
 * Creates one worksheet per entity table (excluding derived entities)
 * and one worksheet per relationship table.
 *
 * Spec 2026-01-11: Refactored to use key-based naming with getSheetNameForKey()
 * instead of tab-name-based naming. All sheet names are validated with
 * toExcelSafeSheetName() and uniqueness is enforced with ensureUniqueSheetName().
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 4: Added _metadata worksheet as the first sheet containing
 * project_name and export_date.
 *
 * @param model - The architecture model to export
 * @param loadedFileName - Currently loaded filename (optional, for naming)
 */
export function exportMetaModelToExcel(model: ArchitectureModel, loadedFileName?: string): void {
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  // Spec 2026-01-19: Create _metadata worksheet as the FIRST sheet
  const projectName = loadedFileName || 'Untitled';
  const metadataWorksheet = createMetadataWorksheet(projectName);
  XLSX.utils.book_append_sheet(workbook, metadataWorksheet, METADATA_WORKSHEET_NAME);
  usedSheetNames.add(METADATA_WORKSHEET_NAME);

  // Export entity worksheets (excluding derived entities)
  for (const tabName of entityTabNames) {
    const entityType = tabToEntityType[tabName];
    if (!entityType || DERIVED_ENTITY_TYPES.includes(entityType)) {
      continue;
    }

    const entities = model.metaModel.entities[entityType as keyof typeof model.metaModel.entities];
    if (!entities) continue;

    // Use key-based naming with canonical mapping
    let worksheetName = getSheetNameForKey(entityType);
    // Apply Excel safety validation
    worksheetName = toExcelSafeSheetName(worksheetName);
    // Ensure uniqueness
    worksheetName = ensureUniqueSheetName(worksheetName, usedSheetNames);

    const headers = getColumnHeaders(entityType);
    const data = entitiesToWorksheetData(entities as unknown[], entityType);

    // Create worksheet with headers even if no data
    let worksheet: XLSX.WorkSheet;
    if (data.length > 0) {
      worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
    } else {
      // Empty worksheet with just headers
      worksheet = XLSX.utils.aoa_to_sheet([headers]);
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);
  }

  // Export relationship worksheets
  for (const tabName of relationshipTabNames) {
    const relType = relationshipTabToType[tabName];
    if (!relType) continue;

    const relationships = model.metaModel.relationships[relType as keyof typeof model.metaModel.relationships];
    if (!relationships) continue;

    // Use key-based naming with canonical mapping
    let worksheetName = getSheetNameForKey(relType);
    // Apply Excel safety validation
    worksheetName = toExcelSafeSheetName(worksheetName);
    // Ensure uniqueness
    worksheetName = ensureUniqueSheetName(worksheetName, usedSheetNames);

    const headers = getColumnHeaders(relType);
    const data = entitiesToWorksheetData(relationships as unknown[], relType);

    let worksheet: XLSX.WorkSheet;
    if (data.length > 0) {
      worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
    } else {
      worksheet = XLSX.utils.aoa_to_sheet([headers]);
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);
  }

  // Generate filename
  let baseFileName = 'architecture';
  if (loadedFileName) {
    // Remove .json extension if present
    baseFileName = loadedFileName.replace(/\.json$/i, '');
  }
  const exportFileName = `${baseFileName}-metamodel.xlsx`;

  // Trigger download
  XLSX.writeFile(workbook, exportFileName);
}

// ============================================================================
// Import Validation (Legacy - used for backward compatibility)
// ============================================================================

/**
 * Validate a single import row (legacy validation).
 * Checks for duplicate IDs, required fields, and FK references.
 *
 * @param row - Row data with field names as keys
 * @param entityType - Entity or relationship type
 * @param existingIds - Set of existing IDs in the model
 * @param model - Current architecture model for FK validation
 * @param rowNumber - Row number for error reporting
 * @returns Validation result with errors array
 */
function validateImportRowLegacy(
  row: Record<string, unknown>,
  entityType: string,
  existingIds: Set<string>,
  model: ArchitectureModel,
  rowNumber: number
): { valid: boolean; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const requiredFields = getRequiredFields(entityType);
  const fkFields = getFkFields(entityType);

  // Check for ID
  const id = row['id'] as string | undefined;
  if (!id || id.toString().trim() === '') {
    errors.push({ row: rowNumber, field: 'id', message: 'ID is required' });
    return { valid: false, errors };
  }

  // Check for duplicate ID
  if (existingIds.has(id)) {
    errors.push({ row: rowNumber, field: 'id', message: `Duplicate ID: ${id}` });
    return { valid: false, errors };
  }

  // Check required fields
  for (const field of requiredFields) {
    if (field === 'id') continue; // Already checked
    const value = row[field];
    if (value === undefined || value === null || value.toString().trim() === '') {
      errors.push({ row: rowNumber, field, message: `Required field "${field}" is missing` });
    }
  }

  // Check FK references
  for (const [field, fkTarget] of fkFields.entries()) {
    const value = row[field] as string | undefined;
    if (!value || value.trim() === '') continue; // Optional FK

    // Look up FK target in entities or relationships
    let targetArray: unknown[] | undefined;
    if (fkTarget in model.metaModel.entities) {
      targetArray = model.metaModel.entities[fkTarget as keyof typeof model.metaModel.entities] as unknown[];
    } else if (fkTarget in model.metaModel.relationships) {
      targetArray = model.metaModel.relationships[fkTarget as keyof typeof model.metaModel.relationships] as unknown[];
    }

    if (targetArray) {
      const exists = targetArray.some((item) => (item as Record<string, unknown>)['id'] === value);
      if (!exists) {
        errors.push({
          row: rowNumber,
          field,
          message: `FK reference not found: ${value} in ${fkTarget}`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Import Implementation (Spec 2026-01-11: Redesign Import as XLSX)
// ============================================================================

/**
 * Map raw Excel row to entity/relationship fields based on grid config.
 *
 * Handles field name normalization, type conversions, and XLSX header-to-field mapping.
 */
function mapRowToFields(
  rawRow: Record<string, unknown>,
  config: GridColumnConfig[],
  typeKey?: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Create lowercase field name lookup for both field names and display names
  const rawKeys = Object.keys(rawRow);
  const rawKeyLower = new Map<string, string>();
  for (const key of rawKeys) {
    rawKeyLower.set(key.toLowerCase().replace(/\s+/g, '_'), key);
    rawKeyLower.set(key.toLowerCase(), key);
  }

  // Get XLSX header-to-field mappings for this type
  const headerMappings = typeKey ? XLSX_HEADER_TO_FIELD[typeKey] || {} : {};

  for (const colConfig of config) {
    // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
    // 'json_summary' columns (constraints_metadata, fk_columns) are explicitly
    // scoped out of XLSX ingestion (they are not exported and the flat cell
    // model cannot round-trip a nested object). Skip on import so a stray cell
    // cannot inject a malformed value into the structural-metadata field.
    if (colConfig.cellType === 'json_summary') continue;
    const fieldName = colConfig.field;
    const fieldNameLower = fieldName.toLowerCase();
    const displayName = colConfig.displayName;
    const displayNameLower = displayName.toLowerCase();

    // Try exact field match first
    let rawValue: unknown;
    if (rawRow[fieldName] !== undefined) {
      rawValue = rawRow[fieldName];
    } else if (rawRow[displayName] !== undefined) {
      // Try display name match
      rawValue = rawRow[displayName];
    } else {
      // Try lowercase match
      const matchedKey = rawKeyLower.get(fieldNameLower) || rawKeyLower.get(displayNameLower);
      if (matchedKey) {
        rawValue = rawRow[matchedKey];
      }
    }

    // Convert value based on cell type
    if (rawValue !== undefined && rawValue !== '') {
      // Apply legacy value conversion if applicable
      if (typeKey) {
        rawValue = convertLegacyValue(typeKey, fieldName, rawValue);
      }

      if (colConfig.cellType === 'boolean') {
        // Convert to boolean
        if (typeof rawValue === 'boolean') {
          result[fieldName] = rawValue;
        } else if (typeof rawValue === 'string') {
          result[fieldName] =
            rawValue.toLowerCase() === 'true' ||
            rawValue.toLowerCase() === 'yes' ||
            rawValue === '1';
        } else if (typeof rawValue === 'number') {
          result[fieldName] = rawValue !== 0;
        }
      } else if (colConfig.cellType === 'tags') {
        // Parse tags (comma-separated or JSON array)
        if (typeof rawValue === 'string') {
          try {
            const parsed = JSON.parse(rawValue);
            if (Array.isArray(parsed)) {
              result[fieldName] = parsed;
            } else {
              result[fieldName] = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
            }
          } catch {
            result[fieldName] = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
          }
        } else if (Array.isArray(rawValue)) {
          result[fieldName] = rawValue;
        }
      } else {
        // Store as-is
        result[fieldName] = rawValue;
      }
    }
  }

  // Process XLSX header mappings — resolve Excel headers that don't match gridConfig displayNames
  for (const [excelHeader, fieldName] of Object.entries(headerMappings)) {
    // Skip if we already have a value for this field
    if (result[fieldName] !== undefined) continue;

    // Try to find the Excel column value
    let headerValue: unknown;
    if (rawRow[excelHeader] !== undefined) {
      headerValue = rawRow[excelHeader];
    } else {
      // Try lowercase match
      const matchedKey = rawKeyLower.get(excelHeader.toLowerCase());
      if (matchedKey) {
        headerValue = rawRow[matchedKey];
      }
    }

    if (headerValue !== undefined && headerValue !== '') {
      // Apply value conversion (e.g., interface_logical_entities ID format)
      if (typeKey) {
        headerValue = convertLegacyValue(typeKey, fieldName, headerValue);
      }
      result[fieldName] = headerValue;
    }
  }

  return result;
}

/**
 * Validate foreign key references in a relationship row.
 *
 * Returns validation errors for unresolved FK references.
 * Errors are non-blocking - the row is still imported.
 */
function validateForeignKeys(
  row: Record<string, unknown>,
  config: GridColumnConfig[],
  combinedEntities: Record<string, Map<string, unknown>>,
  excelRowNum: number
): ImportError[] {
  const errors: ImportError[] = [];

  for (const colConfig of config) {
    if (colConfig.cellType === 'fk_typeahead' && colConfig.fkTarget) {
      const fkValue = row[colConfig.field] as string;
      if (!fkValue) continue;

      // Check if FK target entity type exists in combined entities
      const targetEntities = combinedEntities[colConfig.fkTarget];
      if (!targetEntities) {
        errors.push({
          row: excelRowNum,
          field: colConfig.field,
          message: `FK target type '${colConfig.fkTarget}' not found`,
        });
        continue;
      }

      // Check if FK value exists in target entities
      if (!targetEntities.has(fkValue)) {
        errors.push({
          row: excelRowNum,
          field: colConfig.field,
          message: `FK reference not found: ${fkValue} in ${colConfig.fkTarget}`,
        });
      }
    }
  }

  return errors;
}

// ============================================================================
// Data Entity Point Display Label Resolution
// Spec 2026-02-10: Resolve display labels to canonical DEP IDs during import
// ============================================================================

/** Regex to match display label format: "EntityName [LOGICAL_DATA_ENTITY]" or "EntityName [PHYSICAL_DATA_ENTITY]" */
const DEP_DISPLAY_LABEL_REGEX = /^(.+?)\s+\[(LOGICAL_DATA_ENTITY|PHYSICAL_DATA_ENTITY)\]$/;

/**
 * Build a lookup map from display labels to canonical DataEntityPoint IDs.
 *
 * After all entities have been imported (and assigned IDs), this function
 * scans both logical and physical data entities to create a map:
 *   "EntityName [PHYSICAL_DATA_ENTITY]" → "dep_phy_pde-xxxxx"
 *   "EntityName [LOGICAL_DATA_ENTITY]"  → "dep_log_lde-xxxxx"
 *
 * Includes both pre-existing and newly imported entities.
 *
 * @param combinedEntities - The combined entity lookup populated during import
 * @returns Map from display label to canonical DEP ID
 */
function buildDataEntityPointLabelMap(
  combinedEntities: Record<string, Map<string, unknown>>
): Map<string, string> {
  const labelMap = new Map<string, string>();

  // Process logical data entities
  const logicalEntities = combinedEntities['logical_data_entities'];
  if (logicalEntities) {
    for (const [entityId, entity] of logicalEntities) {
      const name = (entity as Record<string, unknown>).name as string;
      if (name) {
        const label = `${name} [${DATA_ENTITY_TYPE_BADGES.LOGICAL}]`;
        const depId = `${DATA_ENTITY_POINT_PREFIXES.LOGICAL}${entityId}`;
        labelMap.set(label, depId);
      }
    }
  }

  // Process physical data entities
  const physicalEntities = combinedEntities['physical_data_entities'];
  if (physicalEntities) {
    for (const [entityId, entity] of physicalEntities) {
      const name = (entity as Record<string, unknown>).name as string;
      if (name) {
        const label = `${name} [${DATA_ENTITY_TYPE_BADGES.PHYSICAL}]`;
        const depId = `${DATA_ENTITY_POINT_PREFIXES.PHYSICAL}${entityId}`;
        labelMap.set(label, depId);
      }
    }
  }

  return labelMap;
}

/**
 * Resolve data_entity_point_picker field values from display labels to canonical IDs.
 *
 * For each column with cellType 'data_entity_point_picker', checks if the value
 * is a display label (e.g., "ScenarioSummary [PHYSICAL_DATA_ENTITY]") and resolves
 * it to the canonical DataEntityPoint ID (e.g., "dep_phy_pde-xxxxx").
 *
 * Values that already start with "dep_phy_" or "dep_log_" are left unchanged.
 *
 * @param row - The imported row data
 * @param config - Grid column config for this entity/relationship type
 * @param labelMap - The display-label-to-canonical-ID lookup map
 * @param excelRowNum - Excel row number for error reporting
 * @returns Array of import errors for unresolvable references
 */
function resolveDataEntityPointLabels(
  row: Record<string, unknown>,
  config: GridColumnConfig[],
  labelMap: Map<string, string>,
  excelRowNum: number
): ImportError[] {
  const errors: ImportError[] = [];

  for (const colConfig of config) {
    if (colConfig.cellType !== 'data_entity_point_picker') continue;

    const rawValue = row[colConfig.field] as string;
    if (!rawValue) continue;

    // Already a canonical DEP ID — leave as-is
    if (rawValue.startsWith(DATA_ENTITY_POINT_PREFIXES.LOGICAL) ||
        rawValue.startsWith(DATA_ENTITY_POINT_PREFIXES.PHYSICAL)) {
      continue;
    }

    // Attempt to resolve display label to canonical ID
    const match = DEP_DISPLAY_LABEL_REGEX.exec(rawValue);
    if (match) {
      const resolvedId = labelMap.get(rawValue);
      if (resolvedId) {
        row[colConfig.field] = resolvedId;
      } else {
        errors.push({
          row: excelRowNum,
          field: colConfig.field,
          message: `Data entity not found for reference: "${rawValue}"`,
        });
      }
    } else {
      // Value doesn't match either canonical ID or display label format
      errors.push({
        row: excelRowNum,
        field: colConfig.field,
        message: `Invalid data entity point reference: "${rawValue}". Expected format: "EntityName [PHYSICAL_DATA_ENTITY]" or "EntityName [LOGICAL_DATA_ENTITY]", or a canonical ID starting with "dep_phy_" or "dep_log_"`,
      });
    }
  }

  return errors;
}

/**
 * Process a single worksheet.
 *
 * @param worksheet - XLSX worksheet object
 * @param typeKey - Entity or relationship type key
 * @param isRelationship - Whether this is a relationship worksheet
 * @param existingModel - Current architecture model
 * @param combinedEntities - Combined lookup of existing + newly imported entities
 * @param mode - Import mode
 * @param newEntities - Collection to add new entities to
 * @param updatedEntities - Collection to add updated entities to
 * @param newRelationships - Collection to add new relationships to
 * @param updatedRelationships - Collection to add updated relationships to
 * @param depLabelMap - Optional display-label-to-canonical-ID map for data_entity_point_picker resolution
 */
function processWorksheet(
  worksheet: XLSX.WorkSheet,
  typeKey: string,
  isRelationship: boolean,
  existingModel: ArchitectureModel,
  combinedEntities: Record<string, Map<string, unknown>>,
  mode: ImportMode,
  newEntities: Record<string, unknown[]>,
  updatedEntities: Record<string, unknown[]>,
  newRelationships: Record<string, unknown[]>,
  updatedRelationships: Record<string, unknown[]>,
  depLabelMap?: Map<string, string>
): WorksheetImportResult {
  const result: WorksheetImportResult = {
    worksheetName: typeKey,
    entityType: typeKey,
    isRelationship,
    rowsImported: 0,
    rowsSkipped: 0,
    rowsUpdated: 0,
    errors: [],
  };

  // Get grid config for this type
  const config = gridConfigs[typeKey];
  if (!config) {
    return result;
  }

  // Parse worksheet to JSON
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  if (!Array.isArray(jsonData) || jsonData.length === 0) {
    return result;
  }

  // Get existing data for matching
  const existingData = isRelationship
    ? (existingModel.metaModel.relationships[typeKey as keyof typeof existingModel.metaModel.relationships] || []) as Record<string, unknown>[]
    : (existingModel.metaModel.entities[typeKey as keyof typeof existingModel.metaModel.entities] || []) as Record<string, unknown>[];

  // Build lookup maps for matching
  const existingByName = new Map<string, Record<string, unknown>>();
  const existingById = new Map<string, Record<string, unknown>>();

  for (const item of existingData) {
    const id = item.id as string;
    const name = item.name as string;
    if (id) existingById.set(id, item);
    if (name) existingByName.set(name, item);
  }

  // Initialize output collections
  if (!newEntities[typeKey]) newEntities[typeKey] = [];
  if (!updatedEntities[typeKey]) updatedEntities[typeKey] = [];
  if (!newRelationships[typeKey]) newRelationships[typeKey] = [];
  if (!updatedRelationships[typeKey]) updatedRelationships[typeKey] = [];

  // Initialize combined entity map for this type if needed
  if (!combinedEntities[typeKey]) {
    combinedEntities[typeKey] = new Map();
    for (const item of existingData) {
      const id = item.id as string;
      if (id) combinedEntities[typeKey].set(id, item);
    }
  }

  // Track names we've already processed in this import (to avoid duplicates)
  const importedNames = new Set<string>();

  // Process each row
  for (let rowIdx = 0; rowIdx < jsonData.length; rowIdx++) {
    const rawRow = jsonData[rowIdx] as Record<string, unknown>;
    const excelRowNum = rowIdx + 2; // +1 for header, +1 for 1-based indexing

    // Map raw row to entity/relationship fields (with legacy column support)
    const row = mapRowToFields(rawRow, config, typeKey);

    // Determine if this row matches an existing row
    const rowName = row.name as string;
    const isExcludedFromMatching = EXCLUDED_FROM_MATCHING.has(typeKey);

    let matchingExisting: Record<string, unknown> | undefined;

    if (!isExcludedFromMatching && rowName) {
      // Check if we've already imported a row with this name
      if (importedNames.has(rowName)) {
        // Duplicate in import file - skip
        result.rowsSkipped++;
        continue;
      }

      // Check for match in existing data
      matchingExisting = existingByName.get(rowName);
    }

    // Resolve FK display names to entity IDs for fk_typeahead columns.
    // Excel files from the gateway use entity names (e.g., "My Journey") instead
    // of IDs (e.g., "uj_001"). Look up the name in combinedEntities to find the ID.
    for (const colConfig of config) {
      if (colConfig.cellType === 'fk_typeahead' && colConfig.fkTarget) {
        const fkValue = row[colConfig.field] as string;
        if (!fkValue) continue;
        const targetEntities = combinedEntities[colConfig.fkTarget];
        if (!targetEntities) continue;
        // If value already matches an entity ID, skip
        if (targetEntities.has(fkValue)) continue;
        // Try to find by name
        for (const [entityId, entity] of targetEntities.entries()) {
          if ((entity as Record<string, unknown>).name === fkValue) {
            row[colConfig.field] = entityId;
            break;
          }
        }
      }
    }

    // Spec 2026-02-10: Resolve display labels in data_entity_point_picker columns
    // to canonical DataEntityPoint IDs before FK validation.
    if (isRelationship && depLabelMap) {
      const depErrors = resolveDataEntityPointLabels(row, config, depLabelMap, excelRowNum);
      result.errors.push(...depErrors);
    }

    // Validate FK references for relationships
    if (isRelationship) {
      const fkErrors = validateForeignKeys(row, config, combinedEntities, excelRowNum);
      result.errors.push(...fkErrors);
      // FK errors are non-blocking - row is still imported
    }

    if (matchingExisting) {
      // Row matches existing data
      if (mode === 'append') {
        // Append mode: skip existing rows
        result.rowsSkipped++;
      } else {
        // Overwrite mode: merge imported fields into existing row (preserve all existing fields)
        const updatedRow = {
          ...matchingExisting,  // Keep all existing fields (actor_hint, tags, etc.)
          ...row,               // Override with imported fields
          id: matchingExisting.id, // Ensure ID is never overwritten
        };

        if (isRelationship) {
          updatedRelationships[typeKey].push(updatedRow);
        } else {
          updatedEntities[typeKey].push(updatedRow);
        }
        result.rowsUpdated++;

        // Update combined entities with the updated row
        combinedEntities[typeKey].set(updatedRow.id as string, updatedRow);
      }
    } else {
      // New row - generate ID if needed
      const newRow = { ...row };
      if (!newRow.id) {
        newRow.id = isRelationship
          ? generateRelationshipId(typeKey)
          : generateEntityId(typeKey);
      }

      if (isRelationship) {
        newRelationships[typeKey].push(newRow);
      } else {
        newEntities[typeKey].push(newRow);
      }
      result.rowsImported++;

      // Add to combined entities for FK resolution
      combinedEntities[typeKey].set(newRow.id as string, newRow);
    }

    // Track imported names
    if (rowName) {
      importedNames.add(rowName);
    }
  }

  return result;
}

/**
 * Import meta-model from Excel (.xlsx) format.
 *
 * Spec 2026-01-11: Redesign Import as XLSX
 * - Processes worksheets in entity-first order (entities before relationships)
 * - Matches rows by 'name' field for entities
 * - Append mode: skip existing rows, add new rows only
 * - Overwrite mode: update matching rows (preserve IDs), add new rows
 * - Validates FK references against combined entity set (non-blocking)
 * - Excludes logical_data_attribute_physical_data_attributes from row matching
 *
 * Spec 2026-01-11: Interface Entity Relationship Refactor
 * - Handles legacy "Logical Entity" column mapping to dataEntityPointId
 * - Converts legacy logical_entity_id values to dataEntityPointId format
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 4: XLSX Metadata Worksheet
 * - Reads project_name from _metadata worksheet if present
 * - Returns projectName in ImportResult for backward compatibility
 *
 * @param file - The Excel file to import
 * @param existingModel - The current architecture model (for row matching)
 * @param mode - Import mode ('append' or 'overwrite'), defaults to 'overwrite'
 * @returns Promise resolving to ImportResult with detailed statistics and imported data
 */
export async function importMetaModelFromExcel(
  file: File,
  existingModel: ArchitectureModel,
  mode: ImportMode = 'overwrite'
): Promise<ImportResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // Spec 2026-01-19: Read project name from _metadata worksheet
        const projectName = readProjectNameFromMetadata(workbook);

        const result: ImportResult = {
          success: true,
          worksheetResults: [],
          newEntities: {},
          newRelationships: {},
          updatedEntities: {},
          updatedRelationships: {},
          ignoredWorksheets: [],
          totalRowsImported: 0,
          totalRowsSkipped: 0,
          totalRowsUpdated: 0,
          totalErrors: 0,
          mode,
          projectName, // Spec 2026-01-19: Include project name in result
        };

        // Build combined entity lookup (existing + to-be-imported)
        // This is populated as we process worksheets
        const combinedEntities: Record<string, Map<string, unknown>> = {};

        // Initialize from existing model
        for (const [typeKey, data] of Object.entries(existingModel.metaModel.entities)) {
          if (Array.isArray(data)) {
            combinedEntities[typeKey] = new Map();
            for (const entity of data) {
              const id = (entity as Record<string, unknown>).id as string;
              if (id) {
                combinedEntities[typeKey].set(id, entity);
              }
            }
          }
        }

        // Build list of known entity and relationship types
        const knownEntityTypes = new Set(Object.values(tabToEntityType));
        const knownRelationshipTypes = new Set(Object.values(relationshipTabToType));

        // Build processing order: entities first, then relationships
        const entityWorksheets: string[] = [];
        const relationshipWorksheets: string[] = [];

        for (const sheetName of workbook.SheetNames) {
          // Skip _metadata worksheet - already processed
          if (sheetName === METADATA_WORKSHEET_NAME) {
            continue;
          }

          // Check direct match or reverse mapping
          const mappedKey = XLSX_SHEET_NAME_TO_KEY[sheetName] || sheetName;

          if (knownEntityTypes.has(mappedKey) || knownEntityTypes.has(sheetName)) {
            entityWorksheets.push(sheetName);
          } else if (knownRelationshipTypes.has(mappedKey) || knownRelationshipTypes.has(sheetName)) {
            relationshipWorksheets.push(sheetName);
          } else {
            result.ignoredWorksheets.push(sheetName);
          }
        }

        // Phase 1: Process entity worksheets first
        for (const sheetName of entityWorksheets) {
          const worksheet = workbook.Sheets[sheetName];
          const mappedKey = XLSX_SHEET_NAME_TO_KEY[sheetName] || sheetName;
          const typeKey = knownEntityTypes.has(mappedKey) ? mappedKey : sheetName;

          const worksheetResult = processWorksheet(
            worksheet,
            typeKey,
            false,
            existingModel,
            combinedEntities,
            mode,
            result.newEntities,
            result.updatedEntities!,
            result.newRelationships,
            result.updatedRelationships!
          );

          result.worksheetResults.push(worksheetResult);
          result.totalRowsImported! += worksheetResult.rowsImported;
          result.totalRowsSkipped! += worksheetResult.rowsSkipped;
          result.totalRowsUpdated! += worksheetResult.rowsUpdated;
          result.totalErrors! += worksheetResult.errors.length;
        }

        // Spec 2026-02-10: Build display-label-to-canonical-ID lookup map
        // after all entities are imported so newly generated IDs are available.
        const depLabelMap = buildDataEntityPointLabelMap(combinedEntities);

        // Phase 2: Process relationship worksheets with DEP label resolution
        for (const sheetName of relationshipWorksheets) {
          const worksheet = workbook.Sheets[sheetName];
          const mappedKey = XLSX_SHEET_NAME_TO_KEY[sheetName] || sheetName;
          const typeKey = knownRelationshipTypes.has(mappedKey) ? mappedKey : sheetName;

          const worksheetResult = processWorksheet(
            worksheet,
            typeKey,
            true,
            existingModel,
            combinedEntities,
            mode,
            result.newEntities,
            result.updatedEntities!,
            result.newRelationships,
            result.updatedRelationships!,
            depLabelMap
          );

          result.worksheetResults.push(worksheetResult);
          result.totalRowsImported! += worksheetResult.rowsImported;
          result.totalRowsSkipped! += worksheetResult.rowsSkipped;
          result.totalRowsUpdated! += worksheetResult.rowsUpdated;
          result.totalErrors! += worksheetResult.errors.length;
        }

        resolve(result);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        resolve({
          success: false,
          worksheetResults: [
            {
              worksheetName: 'Error',
              entityType: '',
              isRelationship: false,
              rowsImported: 0,
              rowsSkipped: 0,
              rowsUpdated: 0,
              errors: [{ row: 0, field: '', message: `Failed to parse Excel file: ${errorMessage}` }],
            },
          ],
          newEntities: {},
          newRelationships: {},
          updatedEntities: {},
          updatedRelationships: {},
          ignoredWorksheets: [],
          totalRowsImported: 0,
          totalRowsSkipped: 0,
          totalRowsUpdated: 0,
          totalErrors: 1,
          mode,
        });
      }
    };

    reader.onerror = () => {
      resolve({
        success: false,
        worksheetResults: [
          {
            worksheetName: 'Error',
            entityType: '',
            isRelationship: false,
            rowsImported: 0,
            rowsSkipped: 0,
            rowsUpdated: 0,
            errors: [{ row: 0, field: '', message: 'Failed to read file' }],
          },
        ],
        newEntities: {},
        newRelationships: {},
        updatedEntities: {},
        updatedRelationships: {},
        ignoredWorksheets: [],
        totalRowsImported: 0,
        totalRowsSkipped: 0,
        totalRowsUpdated: 0,
        totalErrors: 1,
        mode,
      });
    };

    reader.readAsArrayBuffer(file);
  });
}
