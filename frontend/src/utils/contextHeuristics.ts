/**
 * contextHeuristics.ts
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 2: Heuristic rules engine for context suggestions
 * Task Group 3: Diagram context heuristic
 *
 * This module provides:
 * - Suggestion interface and SuggestionAction type
 * - Heuristic rule implementations for context suggestions
 * - computeSuggestions orchestrator function
 *
 * Heuristic Rules:
 * - rule_interface_needs_schema: Suggest upgrading interface bundles to include schemas
 * - rule_service_needs_interfaces: Suggest upgrading service bundles to include hierarchy
 * - rule_entity_relationships_depth: Suggest upgrading entity bundles to include relationships
 * - rule_diagram_as_context: Suggest adding diagrams that reference selected entities
 */

import type { PickOption } from './contextPickListBuilders';

// ============================================================================
// Rule Identifiers
// ============================================================================

export const RULE_INTERFACE_NEEDS_SCHEMA = 'rule_interface_needs_schema';
export const RULE_SERVICE_NEEDS_INTERFACES = 'rule_service_needs_interfaces';
export const RULE_ENTITY_RELATIONSHIPS_DEPTH = 'rule_entity_relationships_depth';
export const RULE_DIAGRAM_AS_CONTEXT = 'rule_diagram_as_context';

// ============================================================================
// Types
// ============================================================================

/**
 * SuggestionAction - the type of action to take when a suggestion is accepted
 * - 'upgrade_bundle': Upgrade an existing selection's bundle_type
 * - 'add_entity': Add a new entity/diagram to the selection
 */
export type SuggestionAction = 'upgrade_bundle' | 'add_entity';

/**
 * Suggestion - represents a heuristic-generated suggestion for improving context
 */
export interface Suggestion {
  /** Unique identifier for this suggestion instance */
  id: string;
  /** The rule that generated this suggestion */
  ruleId: string;
  /** Short title for the suggestion */
  title: string;
  /** 1-2 sentence rationale explaining why this is suggested */
  rationale: string;
  /** The type of action to take */
  action: SuggestionAction;
  /** The entity/diagram ID this suggestion targets */
  targetEntityId: string;
  /** For upgrade_bundle actions: the new bundle_type to apply */
  targetBundleType?: string;
  /** For add_entity actions: the entity_type being added */
  targetEntityType?: string;
  /** For add_entity diagram suggestions: the diagram label */
  targetLabel?: string;
}

/**
 * Extended PickOption with diagram-specific fields for diagram heuristics
 */
export interface DiagramPickOption extends PickOption {
  /** Entity IDs referenced by this diagram (for diagram heuristics) */
  referenced_entity_ids?: string[];
}

/**
 * Parameters for computeSuggestions function
 */
export interface ComputeSuggestionsParams {
  /** Currently selected entity IDs */
  selectedEntityIds: Set<string>;
  /** Bundle selections per entity ID */
  entityBundleSelections: Record<string, string>;
  /** Map of entity ID to PickOption for metadata lookup */
  entityOptionMap: Map<string, PickOption>;
  /** Diagram options (may include referenced_entity_ids for heuristics) */
  diagramOptions: DiagramPickOption[];
  /** Currently selected diagram IDs */
  selectedDiagramIds: Set<string>;
}

// ============================================================================
// Maximum Suggestions Constant
// ============================================================================

const MAX_SUGGESTIONS = 3;

// ============================================================================
// Heuristic Rule Implementations
// ============================================================================

/**
 * rule_interface_needs_schema
 *
 * Trigger: Interface selected with interface_only or interface_with_endpoints bundle
 * Suggestion: Upgrade to interface_with_endpoints_and_schemas
 * Rationale: "Including schemas helps the LLM understand the data contracts for this interface's endpoints."
 */
function ruleInterfaceNeedsSchema(params: ComputeSuggestionsParams): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const entityId of params.selectedEntityIds) {
    const option = params.entityOptionMap.get(entityId);
    if (!option || option.entity_type !== 'interfaces') {
      continue;
    }

    const bundleType = params.entityBundleSelections[entityId];
    if (bundleType === 'interface_only' || bundleType === 'interface_with_endpoints') {
      suggestions.push({
        id: `${RULE_INTERFACE_NEEDS_SCHEMA}::${entityId}`,
        ruleId: RULE_INTERFACE_NEEDS_SCHEMA,
        title: `Include schemas for ${option.label}`,
        rationale:
          "Including schemas helps the LLM understand the data contracts for this interface's endpoints.",
        action: 'upgrade_bundle',
        targetEntityId: entityId,
        targetBundleType: 'interface_with_endpoints_and_schemas',
      });
    }
  }

  return suggestions;
}

/**
 * rule_service_needs_interfaces
 *
 * Trigger: Service selected with service_only bundle
 * Suggestion: Upgrade to service_with_parents_and_children
 * Rationale: "Including parent and child context helps the LLM understand how this service fits in the architecture hierarchy."
 */
function ruleServiceNeedsInterfaces(params: ComputeSuggestionsParams): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const entityId of params.selectedEntityIds) {
    const option = params.entityOptionMap.get(entityId);
    if (!option || option.entity_type !== 'services') {
      continue;
    }

    const bundleType = params.entityBundleSelections[entityId];
    if (bundleType === 'service_only') {
      suggestions.push({
        id: `${RULE_SERVICE_NEEDS_INTERFACES}::${entityId}`,
        ruleId: RULE_SERVICE_NEEDS_INTERFACES,
        title: `Include hierarchy for ${option.label}`,
        rationale:
          'Including parent and child context helps the LLM understand how this service fits in the architecture hierarchy.',
        action: 'upgrade_bundle',
        targetEntityId: entityId,
        targetBundleType: 'service_with_parents_and_children',
      });
    }
  }

  return suggestions;
}

/**
 * rule_entity_relationships_depth
 *
 * Trigger: 2+ data entities selected with entity_only bundle
 * Suggestion: Upgrade to entity_with_attributes_and_relationships
 * Rationale: "Including relationships between these entities helps the LLM understand the data model connections."
 */
function ruleEntityRelationshipsDepth(params: ComputeSuggestionsParams): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Find data entities with entity_only bundle
  const dataEntityIds: string[] = [];
  for (const entityId of params.selectedEntityIds) {
    const option = params.entityOptionMap.get(entityId);
    if (!option) continue;

    const isDataEntity =
      option.entity_type === 'physical_data_entities' ||
      option.entity_type === 'logical_data_entities';

    if (isDataEntity && params.entityBundleSelections[entityId] === 'entity_only') {
      dataEntityIds.push(entityId);
    }
  }

  // Only trigger if 2+ data entities with entity_only
  if (dataEntityIds.length >= 2) {
    // Suggest upgrading each entity to include relationships
    for (const entityId of dataEntityIds) {
      const option = params.entityOptionMap.get(entityId)!;
      suggestions.push({
        id: `${RULE_ENTITY_RELATIONSHIPS_DEPTH}::${entityId}`,
        ruleId: RULE_ENTITY_RELATIONSHIPS_DEPTH,
        title: `Include relationships for ${option.label}`,
        rationale:
          'Including relationships between these entities helps the LLM understand the data model connections.',
        action: 'upgrade_bundle',
        targetEntityId: entityId,
        targetBundleType: 'entity_with_attributes_and_relationships',
      });
    }
  }

  return suggestions;
}

/**
 * rule_diagram_as_context
 *
 * Trigger: 3+ entities selected from Architecture tab
 * Find: Diagrams referencing 50%+ of selected entities
 * Suggestion: Add diagram with diagram_only bundle
 * Rationale: "This diagram references multiple selected entities and may provide useful visual context."
 * Limit: Maximum 1 diagram suggestion
 */
function ruleDiagramAsContext(params: ComputeSuggestionsParams): Suggestion[] {
  // Only trigger if 3+ entities selected
  if (params.selectedEntityIds.size < 3) {
    return [];
  }

  const suggestions: Suggestion[] = [];
  const selectedEntitySet = params.selectedEntityIds;
  const selectedCount = selectedEntitySet.size;
  const threshold = selectedCount * 0.5;

  // Find diagrams with 50%+ overlap
  for (const diagram of params.diagramOptions) {
    // Skip already selected diagrams
    if (params.selectedDiagramIds.has(diagram.value)) {
      continue;
    }

    // Check if diagram has referenced entities
    const referencedIds = diagram.referenced_entity_ids || [];
    if (referencedIds.length === 0) {
      continue;
    }

    // Count overlap
    let overlapCount = 0;
    for (const refId of referencedIds) {
      if (selectedEntitySet.has(refId)) {
        overlapCount++;
      }
    }

    // Check threshold (50% of selected entities)
    if (overlapCount >= threshold) {
      suggestions.push({
        id: `${RULE_DIAGRAM_AS_CONTEXT}::${diagram.value}`,
        ruleId: RULE_DIAGRAM_AS_CONTEXT,
        title: `Add diagram: ${diagram.label}`,
        rationale:
          'This diagram references multiple selected entities and may provide useful visual context.',
        action: 'add_entity',
        targetEntityId: diagram.value,
        targetEntityType: 'diagrams',
        targetBundleType: 'diagram_only',
        targetLabel: diagram.label,
      });

      // Limit to 1 diagram suggestion
      break;
    }
  }

  return suggestions;
}

// ============================================================================
// Orchestrator Function
// ============================================================================

/**
 * computeSuggestions
 *
 * Orchestrates all heuristic rules and returns combined suggestions.
 * Deduplicates by suggestion ID and limits to MAX_SUGGESTIONS (3).
 *
 * @param params - The parameters containing current selection state
 * @returns Array of Suggestion objects (max 3)
 */
export function computeSuggestions(params: ComputeSuggestionsParams): Suggestion[] {
  const allSuggestions: Suggestion[] = [];

  // Run all heuristic rules
  allSuggestions.push(...ruleInterfaceNeedsSchema(params));
  allSuggestions.push(...ruleServiceNeedsInterfaces(params));
  allSuggestions.push(...ruleEntityRelationshipsDepth(params));
  allSuggestions.push(...ruleDiagramAsContext(params));

  // Deduplicate by suggestion ID
  const seenIds = new Set<string>();
  const deduplicatedSuggestions: Suggestion[] = [];
  for (const suggestion of allSuggestions) {
    if (!seenIds.has(suggestion.id)) {
      seenIds.add(suggestion.id);
      deduplicatedSuggestions.push(suggestion);
    }
  }

  // Limit to MAX_SUGGESTIONS
  return deduplicatedSuggestions.slice(0, MAX_SUGGESTIONS);
}
