/**
 * GridCell Component
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Groups 3 & 4: Updated to pass relationship context props to cell editors
 * and handle label cache dispatch on selection.
 *
 * Spec: Method Parameters/Returns/Throws Type-Oriented Input
 * Added 'free_text_typeahead_single_token' cell type for Returns/Throws fields.
 *
 * Spec 2026-01-20: UI Characteristics Entity - Dynamic Key Suggestions
 * Added support for dynamicSuggestions flag on text_with_suggestions cells.
 * When entityType is 'ui_characteristics' and dynamicSuggestions is true,
 * suggestions are computed based on the entity's 'type' field value.
 *
 * Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
 * Added snakeCaseToTitleCase helper and formatOptionLabel prop to DropdownCell
 * for displaying human-friendly labels while storing snake_case values.
 *
 * Spec 2026-01-20: Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task Group 3: TextWithSuggestionsCell now displays pretty labels on chips
 * (e.g., "Bulk Action" for "bulk_action") while inserting raw snake_case values.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { AnyEntity, ApplicationComponent, ArchitectureModel, EntityType, Service, UICharacteristic, UICharacteristicType } from '../../types/model';
import { GridColumnConfig, ValidationError } from '../../types/config';
import { getCellValidationError } from '../../utils/validation';
import { deriveServiceTier } from '../../utils/deriveServiceTier';
import { TypeaheadCell } from './TypeaheadCell';
import { ApplicationPointPickerCell } from './ApplicationPointPickerCell';
import { InfrastructurePointPickerCell } from './InfrastructurePointPickerCell';
import { PackageSetCell } from './PackageSetCell';
import { TechHintsCell } from './TechHintsCell';
import { DataEntityPointSelect } from './DataEntityPointSelect';
import {
  FreeTextTypeaheadSingleToken,
  deriveSuggestionsFromModel,
} from './FreeTextTypeaheadSingleToken';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import styles from './Grid.module.css';

/**
 * Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
 * Converts snake_case strings to Title Case for display.
 * Example: "business_feature" -> "Business Feature"
 */
export function snakeCaseToTitleCase(value: string): string {
  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface GridCellProps {
  entity: AnyEntity;
  column: GridColumnConfig;
  entityType: EntityType;
  model: ArchitectureModel;
  errors: ValidationError[];
  onChange: (value: unknown) => void;
  /**
   * Callback to add a new entity (for ApplicationPointPickerCell derived APs).
   * Spec: Global Application Point Picker with Derived ApplicationPoints
   */
  onAddEntity?: (entityType: string, entity: AnyEntity) => void;
  /**
   * Callback when "Create new..." is clicked in PackageSetCell.
   * Spec 2026-01-06: Service Package Set Assignment Dropdown
   */
  onPackageSetCreateNew?: () => void;
  /**
   * Callback when "Clone and customize..." is clicked in PackageSetCell.
   * Spec 2026-01-06: Service Package Set Assignment Dropdown
   */
  onPackageSetClone?: () => void;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Relationship key for label cache dispatch (e.g., 'data_movements', 'interactions').
   * If provided, enables label cache updates on dropdown selection.
   */
  relationshipKey?: string;
}

/**
 * Spec 2026-01-20: UI Characteristics Entity - Dynamic Key Suggestions
 * Computes suggestions for the 'key' field based on the UICharacteristic's 'type' field.
 *
 * @param characteristicType - The type of UI characteristic
 * @param config - AppConfig containing key suggestion arrays
 * @returns Array of suggestion strings for the given type
 */
function getUICharacteristicKeySuggestions(
  characteristicType: UICharacteristicType | undefined,
  config: {
    uiCharacteristicsUiCapabilityKeys: string[];
    uiCharacteristicsInteractionComplexityKeys: string[];
    uiCharacteristicsTechnicalShapeKeys: string[];
  }
): string[] {
  switch (characteristicType) {
    case 'business_feature':
      // No suggestions for business_feature type
      return [];
    case 'ui_capability':
      return config.uiCharacteristicsUiCapabilityKeys;
    case 'interaction_complexity':
      return config.uiCharacteristicsInteractionComplexityKeys;
    case 'technical_shape':
      return config.uiCharacteristicsTechnicalShapeKeys;
    default:
      return [];
  }
}

export function GridCell({
  entity,
  column,
  entityType,
  model,
  errors,
  onChange,
  onAddEntity,
  onPackageSetCreateNew,
  onPackageSetClone,
  relationshipKey,
}: GridCellProps) {
  const value = (entity as unknown as Record<string, unknown>)[column.field];
  const error = getCellValidationError(entity.id, column.field, errors);
  const dispatch = useArchitectureDispatch();
  const appConfig = useAppConfig();

  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Callback to dispatch SET_RELATIONSHIP_CELL_LABEL action.
   * Used by dropdown editors to update the label cache on selection.
   */
  const handleLabelUpdate = useCallback(
    (relKey: string, rowId: string, columnKey: string, label: string) => {
      dispatch({
        type: 'SET_RELATIONSHIP_CELL_LABEL',
        payload: {
          relationshipKey: relKey,
          rowId,
          columnKey,
          label,
        },
      });
    },
    [dispatch]
  );

  // ============================================================================
  // Spec 2026-01-20: UI Characteristics Entity - Dynamic Key Suggestions
  // Compute suggestions dynamically for ui_characteristics entity type
  // ============================================================================
  const dynamicSuggestions = useCallback(() => {
    // Only compute dynamic suggestions for ui_characteristics with dynamicSuggestions flag
    if (entityType === 'ui_characteristics' && column.dynamicSuggestions) {
      const characteristic = entity as unknown as UICharacteristic;
      return getUICharacteristicKeySuggestions(characteristic.type, appConfig);
    }
    // Fall back to static suggestions from column config
    return column.suggestions || [];
  }, [entityType, column.dynamicSuggestions, column.suggestions, entity, appConfig]);

  switch (column.cellType) {
    case 'text':
    case 'tags':
      return (
        <TextCell
          value={value as string}
          onChange={onChange}
          error={error}
          autoGenerate={column.autoGenerate}
        />
      );

    case 'boolean':
      return (
        <BooleanCell
          value={value as boolean}
          onChange={onChange}
        />
      );

    case 'dropdown':
      return (
        <DropdownCell
          value={value as string}
          options={column.options || []}
          onChange={onChange}
          error={error}
          formatOptionLabel={column.formatOptionLabel}
        />
      );

    case 'fk_typeahead':
      return (
        <TypeaheadCell
          value={value as string}
          entity={entity}
          column={column}
          entityType={entityType}
          model={model}
          onChange={onChange}
          error={error}
          // Spec: Standardize Relationship Dropdown Display Labels
          // Pass relationship context for label cache dispatch
          relationshipKey={relationshipKey}
          rowId={entity.id}
          onLabelUpdate={relationshipKey ? handleLabelUpdate : undefined}
        />
      );

    // Spec: Business Logic Type Suggestions (Non-Enforcing)
    // Spec 2026-01-20: UI Characteristics Entity - Dynamic Key Suggestions
    case 'text_with_suggestions':
      return (
        <TextWithSuggestionsCell
          value={value as string}
          suggestions={dynamicSuggestions()}
          onChange={onChange}
          error={error}
        />
      );

    // Spec: Method Parameters/Returns/Throws Type-Oriented Input
    // Single-token typeahead with entity-derived suggestions
    case 'free_text_typeahead_single_token': {
      // Derive suggestions from model entities based on suggestionSources and staticSuggestions
      const suggestions = deriveSuggestionsFromModel(
        model,
        column.suggestionSources || [],
        column.staticSuggestions || []
      );
      return (
        <FreeTextTypeaheadSingleToken
          value={value as string}
          suggestions={suggestions}
          onChange={onChange}
          error={error}
          // Spec: Standardize Relationship Dropdown Display Labels
          // Pass relationship context for label cache dispatch (optional)
          onLabelUpdate={relationshipKey ? handleLabelUpdate : undefined}
        />
      );
    }

    // Spec: Global Application Point Picker with Derived ApplicationPoints
    case 'application_point_picker':
      return (
        <ApplicationPointPickerCell
          value={value as string}
          entity={entity}
          column={column}
          model={model}
          onChange={onChange}
          onAddEntity={onAddEntity}
          error={error}
          // Spec: Standardize Relationship Dropdown Display Labels
          // Pass relationship context for label cache dispatch
          relationshipKey={relationshipKey}
          rowId={entity.id}
          columnKey={column.field}
          onLabelUpdate={relationshipKey ? handleLabelUpdate : undefined}
          allowedKinds={column.allowedKinds}
        />
      );

    // Spec 2026-05-04: Infrastructure Domain Tables UI
    // Polymorphic picker over the 12 Infrastructure entity types; auto-derives
    // an InfrastructurePoint row via ensureDerivedInfrastructurePoint.
    case 'infrastructure_point_picker':
      return (
        <InfrastructurePointPickerCell
          value={value as string}
          entity={entity}
          column={column}
          model={model}
          onChange={onChange}
          onAddEntity={onAddEntity}
          error={error}
          relationshipKey={relationshipKey}
          rowId={entity.id}
          columnKey={column.field}
          onLabelUpdate={relationshipKey ? handleLabelUpdate : undefined}
          allowedKinds={column.allowedKinds}
        />
      );

    // Spec 2026-01-06: Service Package Set Assignment Dropdown
    // Task Group 6: Pass defaultRules and service for resolution display
    case 'package_set_dropdown': {
      // Cast entity to Service to access core_tech and service_type
      const serviceEntity = entity as unknown as Service;
      return (
        <PackageSetCell
          value={value as string | null | undefined}
          packageSets={model.metaModel.entities.package_sets || []}
          packages={model.metaModel.entities.packages || []}
          onChange={(newValue) => onChange(newValue)}
          onCreateNew={onPackageSetCreateNew || (() => {})}
          onClone={onPackageSetClone || (() => {})}
          defaultRules={model.metaModel.entities.package_set_default_rules || []}
          service={{
            core_tech: serviceEntity.core_tech,
            service_type: serviceEntity.service_type,
          }}
        />
      );
    }

    // Spec: Data Entity Point UI Switch
    // Unified picker for selecting Logical or Physical Data Entities
    case 'data_entity_point_picker':
      return (
        <DataEntityPointSelect
          value={value as string}
          model={model}
          onChange={onChange}
          error={error}
          // Spec: Standardize Relationship Dropdown Display Labels
          // Pass relationship context for label cache dispatch
          relationshipKey={relationshipKey}
          rowId={entity.id}
          columnKey={column.field}
          onLabelUpdate={relationshipKey ? handleLabelUpdate : undefined}
          // Hotfix 2026-05-13: forward the column's `required` flag so the
          // picker stops rendering "(Missing - Required)" red text for
          // optional FK columns (e.g., endpoint Request / Response Data).
          required={column.required}
        />
      );

    // Spec 2026-04-20: Tech Hints LLM Resolution
    // Custom cell for the services core_tech column. Registered only for
    // this column (services grid config uses cellType: tech_hints_cell).
    // TechHintsCell emits patch objects that touch both core_tech (the column
    // field) and the five resolved columns. We dispatch the full patch in a
    // single UPDATE_ENTITY action so all fields land atomically.
    case 'tech_hints_cell': {
      // Spec 2026-05-06: Library Frontend Types & Tables - Q4 (Option a)
      // TechHintsCell now accepts a structural TechHintsRow; both Service and
      // Library (and any future tech-hint-bearing row) satisfy it without a cast.
      //
      // Spec 2026-06-06: when the row is a service whose parent application
      // component is "Persistence Tier", flag its Core Tech against the
      // available database scan packs. Derive the parent tier here (GridCell
      // has the full entity + model); only services carry an app_component_id,
      // so the library tech-hint row resolves to 'Unknown' (no check). Computed
      // inline -- this case renders for just the services `core_tech` column.
      let persistenceTierParent = false;
      if (entityType === 'services') {
        const appComponentsById = new Map<string, ApplicationComponent>();
        for (const ac of model.metaModel.entities.app_components ?? []) {
          appComponentsById.set(ac.id, ac);
        }
        persistenceTierParent =
          deriveServiceTier(entity as Service, appComponentsById) === 'Persistence';
      }
      return (
        <TechHintsCell
          service={entity}
          persistenceTierParent={persistenceTierParent}
          onChange={(patch) => {
            const updatedEntity = { ...entity, ...patch } as AnyEntity;
            dispatch({ type: 'UPDATE_ENTITY', entityType, entity: updatedEntity });
          }}
        />
      );
    }

    // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
    // Read-only display of a structural-fidelity JSONB block (constraint/index
    // metadata on a physical entity; FK join/referenced columns on a
    // relationship). Renders a compact summary; the full JSON is shown on hover.
    case 'json_summary':
      return <JsonSummaryCell value={value} field={column.field} />;

    default:
      return <span>{String(value)}</span>;
  }
}

/**
 * Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
 *
 * Read-only rendering of a structural-fidelity JSONB block. Two known shapes
 * are summarised into a compact one-line string; anything else falls back to a
 * stable JSON string. The full JSON is always available via the hover title.
 * This cell is never editable (the values are discovery-sourced structural
 * truth) and is intentionally excluded from XLSX export.
 *
 *  - physical_data_entities.constraints_metadata:
 *      { primary_key:{name,columns[]}, unique_constraints:[...],
 *        check_constraints:[...], indexes:[...] }
 *  - logical_data_entity_relationships.fk_columns:
 *      { join_columns:[...], referenced_columns:[...] }
 */
export function summarizeStructuralJson(value: unknown, field?: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'object') return String(value);

  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  const arrLen = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

  // constraints_metadata summary (PK / unique / check / index counts)
  if (
    field === 'constraints_metadata' ||
    'primary_key' in obj ||
    'unique_constraints' in obj ||
    'check_constraints' in obj ||
    'indexes' in obj
  ) {
    const pk = obj.primary_key as { columns?: unknown } | undefined;
    if (pk && Array.isArray(pk.columns) && pk.columns.length > 0) {
      parts.push(`PK(${(pk.columns as unknown[]).join(', ')})`);
    }
    const uq = arrLen(obj.unique_constraints);
    if (uq > 0) parts.push(`${uq} unique`);
    const ck = arrLen(obj.check_constraints);
    if (ck > 0) parts.push(`${ck} check`);
    const ix = arrLen(obj.indexes);
    if (ix > 0) parts.push(`${ix} index${ix === 1 ? '' : 'es'}`);
    if (parts.length > 0) return parts.join(' | ');
  }

  // fk_columns summary (join -> referenced columns)
  if (field === 'fk_columns' || 'join_columns' in obj || 'referenced_columns' in obj) {
    const join = Array.isArray(obj.join_columns) ? (obj.join_columns as unknown[]) : [];
    const ref = Array.isArray(obj.referenced_columns)
      ? (obj.referenced_columns as unknown[])
      : [];
    if (join.length > 0 || ref.length > 0) {
      return `${join.join(', ')} -> ${ref.join(', ')}`;
    }
  }

  // Fallback: stable JSON string (still read-only, full value on hover).
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function JsonSummaryCell({ value, field }: { value: unknown; field?: string }) {
  const summary = summarizeStructuralJson(value, field);
  let full = '';
  try {
    full = value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
  } catch {
    full = String(value);
  }
  return (
    <div
      className={`${styles.cellValue} ${styles.readonly}`}
      title={full}
      data-testid="json-summary-cell"
    >
      {summary}
    </div>
  );
}

interface TextCellProps {
  value: string;
  onChange: (value: string) => void;
  error?: ValidationError;
  autoGenerate?: boolean;
}

function TextCell({ value, onChange, error, autoGenerate }: TextCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (!autoGenerate) {
      setEditValue(value || '');
      setIsEditing(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onChange(editValue);
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      setEditValue(value || '');
      setIsEditing(false);
    } else if (e.key === 'Tab') {
      onChange(editValue);
      setIsEditing(false);
    }
  };

  const handleBlur = () => {
    onChange(editValue);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={styles.cellInput}
      />
    );
  }

  return (
    <div
      className={`${styles.cellValue} ${error ? styles.cellError : ''} ${autoGenerate ? styles.readonly : ''}`}
      onDoubleClick={handleDoubleClick}
      title={error?.message}
    >
      {value || (autoGenerate ? value : '')}
    </div>
  );
}

interface BooleanCellProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

function BooleanCell({ value, onChange }: BooleanCellProps) {
  return (
    <input
      type="checkbox"
      checked={value || false}
      onChange={(e) => onChange(e.target.checked)}
      className={styles.cellCheckbox}
    />
  );
}

/**
 * Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
 * Added optional formatOptionLabel prop for displaying human-friendly labels
 * while keeping stored values unchanged.
 */
interface DropdownCellProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  error?: ValidationError;
  formatOptionLabel?: (value: string) => string;
}

function DropdownCell({ value, options, onChange, error, formatOptionLabel }: DropdownCellProps) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`${styles.cellSelect} ${error ? styles.cellError : ''}`}
      title={error?.message}
    >
      <option value="">--</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {formatOptionLabel ? formatOptionLabel(option) : option}
        </option>
      ))}
    </select>
  );
}

/**
 * TextWithSuggestionsCell Component
 * Spec: Business Logic Type Suggestions (Non-Enforcing)
 *
 * A text input cell that displays optional, non-enforcing suggestions as
 * clickable chips when in edit mode. Users can click a suggestion to
 * populate the input, or type any free-text value.
 *
 * Spec 2026-01-20: UI Characteristics Entity - Dynamic Key Suggestions
 * Suggestions can now be dynamically computed based on row data when
 * the column has dynamicSuggestions: true.
 *
 * Spec 2026-01-20: Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task Group 3: Chips now display human-friendly Title Case labels using
 * snakeCaseToTitleCase() while inserting the raw snake_case value on click.
 */
interface TextWithSuggestionsCellProps {
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  error?: ValidationError;
}

export function TextWithSuggestionsCell({
  value,
  suggestions,
  onChange,
  error,
}: TextWithSuggestionsCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    setEditValue(value || '');
    setIsEditing(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onChange(editValue);
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      setEditValue(value || '');
      setIsEditing(false);
    } else if (e.key === 'Tab') {
      onChange(editValue);
      setIsEditing(false);
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Check if the blur is to a suggestion chip - if so, don't close edit mode
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget?.classList?.contains(styles.suggestionChip)) {
      return;
    }
    onChange(editValue);
    setIsEditing(false);
  };

  /**
   * Spec 2026-01-20: Fix UI Characteristics Picker Grouping and Key Suggestions
   * Task Group 3: handleSuggestionClick receives the raw snake_case suggestion
   * and sets it as the editValue. The display label is handled separately.
   */
  const handleSuggestionClick = (suggestion: string) => {
    setEditValue(suggestion);
    // Re-focus the input after chip click
    inputRef.current?.focus();
  };

  if (isEditing) {
    return (
      <div className={styles.textWithSuggestionsContainer}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={styles.cellInput}
        />
        {suggestions.length > 0 && (
          <div className={styles.suggestionChipsContainer}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestionChip}
                onMouseDown={(e) => {
                  // Prevent blur from firing before click
                  e.preventDefault();
                }}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {/* Spec 2026-01-20: Display pretty label, insert raw value */}
                {snakeCaseToTitleCase(suggestion)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${styles.cellValue} ${error ? styles.cellError : ''}`}
      onDoubleClick={handleDoubleClick}
      title={error?.message}
    >
      {value || ''}
    </div>
  );
}
