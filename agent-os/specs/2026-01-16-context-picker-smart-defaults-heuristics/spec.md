# Specification: Context Picker Smart Defaults and Heuristic Suggestions

## Goal

Reduce user effort and improve context quality in the Context Picker by implementing smart type-based default bundle choices, heuristic-driven suggestions for additional context, and optional depth controls for entity relationship expansion.

## User Stories

- As a developer, I want the Context Picker to automatically select appropriate bundle types when I add an item so that I don't have to manually configure each selection.
- As a developer, I want the system to suggest relevant additional context (like schemas for interfaces) so that I can provide complete information to the LLM without needing domain expertise on what context is needed.

## Specific Requirements

**Smart default bundle type assignment**
- When user selects an entity in the Context Picker, automatically assign a default bundle_type based on entity_type
- Interface entities default to `interface_with_endpoints_and_schemas`
- Service entities default to `service_with_parents_and_children`
- Physical Data Entity and Logical Data Entity default to `entity_with_attributes_and_relationships`
- Diagram selections default to `diagram_only`
- Display the assigned bundle_type in the existing BundleSelector dropdown component (lines 66-89 in ContextPickerModal.tsx)
- Allow users to change the default via the dropdown at any time

**Suggestions UI area in Context Picker modal**
- Add new "Suggested Context" section below the search input area in ContextPickerModal.tsx (after line 405)
- Each suggestion card displays: short title, 1-2 sentence rationale, "Add" button, "Dismiss" button
- Suggestions section collapses when empty or all suggestions dismissed
- Maximum of 3 suggestions displayed at once to avoid UI clutter
- Suggestions are non-blocking: user can click Apply without accepting any suggestions
- Add corresponding CSS styles in ContextPickerModal.module.css (after line 143)

**Heuristic rule: rule_interface_needs_schema**
- Trigger when user selects an interface with `interface_only` or `interface_with_endpoints` bundle_type
- Suggest upgrading to `interface_with_endpoints_and_schemas` bundle_type
- Rationale: "Including schemas helps the LLM understand the data contracts for this interface's endpoints."
- "Add" action changes the bundle_type on the existing selection

**Heuristic rule: rule_service_needs_interfaces**
- Trigger when user selects a service with `service_only` bundle_type
- Check if any interfaces are already selected that belong to this service
- If no related interfaces selected, suggest upgrading to `service_with_parents_and_children`
- Rationale: "Including parent and child context helps the LLM understand how this service fits in the architecture hierarchy."

**Heuristic rule: rule_entity_relationships_depth**
- Trigger when user selects multiple data entities (logical or physical) with `entity_only` bundle_type
- Check if relationships exist between selected entities using existing relationship metadata
- Suggest upgrading to `entity_with_attributes_and_relationships` to include relationship context
- Rationale: "Including relationships between these entities helps the LLM understand the data model connections."

**Heuristic rule: rule_diagram_as_context**
- Trigger when user has selected 3+ entities from the Architecture tab
- Query diagram options to find diagrams that reference 50%+ of selected entities
- Suggest adding highly-relevant diagrams (diagram_only bundle_type)
- Rationale: "This diagram references multiple selected entities and may provide useful visual context."
- Maximum of 1 diagram suggestion at a time

**Depth control for entity bundles**
- Add optional depth selector for `entity_with_attributes_and_relationships` bundle selections
- Depth options: 1 (default), 2 (advanced)
- Display depth selector inline with BundleSelector dropdown when entity bundle is selected
- Depth 2 includes warning label: "May increase context size significantly"
- Store depth value alongside bundle_type in selection state

**Selection contract extension for depth**
- Extend EntityRef interface in contextStorage.ts (line 20) with optional `depth?: 1 | 2` field
- Default depth is 1 when not specified for backward compatibility
- Pass depth to backend expand-resolve endpoint in ArchitectureContext.entities array
- Extend EntityBundleSelection type in chat.ts (line 587) to include `depth?: number`

**Heuristic computation location**
- Compute suggestions in frontend using local selection state and available options
- For rule_diagram_as_context, use diagramOptions prop to find candidate diagrams
- For entity relationship checking, rely on entityOptionMap for relationship metadata if available, or skip rule if not
- No new gateway endpoint needed for v1 heuristics

## Existing Code to Leverage

**ContextPickerModal.tsx (lines 95-531)**
- Use existing `entityBundleSelections` state (line 118) for tracking bundle types per entity
- Extend `handleEntityToggle` callback (line 175) to apply smart defaults
- Use existing `entityOptionMap` (line 164) for entity metadata lookup
- Follow existing BundleSelector component pattern (lines 66-89) for depth selector

**contextBundleTypes.ts (lines 1-157)**
- Use existing `getDefaultBundleType()` function (line 122) which already implements smart defaults
- Use existing `BUNDLE_TYPE_LABELS` map (line 94) for human-readable dropdown labels
- Extend with depth-related labels if needed

**contextStorage.ts (lines 20-44)**
- EntityRef interface (line 20) already has `bundle_type?: string` field
- DiagramRef interface (line 36) already has `bundle_type?: string` field
- Add optional `depth?: 1 | 2` field to EntityRef for relationship depth control

**ContextPickerModal.module.css (lines 1-329)**
- Follow existing styling patterns for new suggestions section
- Use existing `.optionRow` (line 190) pattern for suggestion card layout
- Reuse `.primaryButton` and `.secondaryButton` styles for Add/Dismiss actions

**chat.ts types (lines 587-608)**
- EntityBundleSelection interface for extend with depth field
- ArchitectureContext interface (lines 81-98) already supports entities array with bundle_type

## Out of Scope

- No gateway endpoint for heuristic suggestions (frontend-only computation for v1)
- No new bundle types introduced beyond existing ones
- No changes to backend expand-resolve logic (depth parameter passthrough only)
- No persistence of dismissed suggestions across sessions
- No user preferences for disabling suggestions
- No ML-based or learned suggestions (rules are static heuristics)
- No suggestions based on expanded context analysis (only selection-time analysis)
- No changes to the condensed DTO schema
- No automatic bundle expansion without user confirmation
- No suggestions displayed in collapsed/minimized state
