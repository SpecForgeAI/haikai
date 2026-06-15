# Specification: Context Picker Bundles - UI and Selection Contract

## Goal
Allow users to choose predefined bundle scopes when selecting context items in the Implement screen, and persist those bundle choices alongside existing context selections for future backend expansion (without changing current LLM payload behavior).

## User Stories
- As a developer implementing a feature, I want to select an Interface along with a bundle scope (e.g., "with endpoints and schemas") so that context expansion can later automatically include related items.
- As a developer, I want my previously saved context selections (without bundle_type) to continue loading correctly with sensible defaults applied.

## Specific Requirements

**Extend EntityRef interface with bundle_type field**
- Add optional `bundle_type?: string` field to `EntityRef` interface in `frontend/src/utils/contextStorage.ts` (lines 20-29)
- Field stores the user's selected bundle scope for that entity
- Must be optional to maintain backward compatibility with existing saved contexts
- When loading contexts without bundle_type, default should be inferred based on entity_type

**Extend DiagramRef interface with bundle_type field**
- Add optional `bundle_type?: string` field to `DiagramRef` interface in `frontend/src/utils/contextStorage.ts` (lines 34-41)
- Diagrams default to `diagram_only` bundle type
- Field is optional for backward compatibility

**Define bundle type constants for each entity kind**
- Create new file `frontend/src/utils/contextBundleTypes.ts` with TypeScript union types and constants
- Interface bundles: `interface_only`, `interface_with_endpoints`, `interface_with_endpoints_and_schemas` (default)
- Service bundles: `service_only`, `service_with_parents_and_children` (default)
- Physical Data Entity bundles: `entity_only`, `entity_with_attributes_and_relationships` (default)
- Diagram bundles: `diagram_only` (default, only option for now)
- Export helper function `getDefaultBundleType(entityType: string): string` that returns the recommended default based on entity_type
- Export helper function `getBundleOptionsForEntityType(entityType: string): string[]` returning available bundle options

**Add bundle selector UI to ContextPickerModal**
- Modify `frontend/src/components/ProductView/ContextPickerModal.tsx` to show bundle dropdown per selected item
- Add dropdown/select control next to each checked entity in the architecture tab (lines 348-363 area)
- Dropdown appears inline with the checkbox row when the item is selected
- Dropdown options are filtered based on the entity's type using `getBundleOptionsForEntityType()`
- Pre-select the default bundle type when an item is first checked
- Store bundle selections in component state alongside entity ID selections

**Track bundle selections in modal state**
- Add new state: `const [entityBundleSelections, setEntityBundleSelections] = useState<Record<string, string>>({})`
- Key is entity_id, value is the selected bundle_type
- Initialize from `initialSelected.entity_refs` bundle_type values when modal opens (lines 69-93 area)
- For entities in initialSelected without bundle_type, use `getDefaultBundleType()` to set initial value

**Update handleApply to include bundle_type in refs**
- Modify `handleApply` function (lines 188-224) to include bundle_type when building EntityRef objects
- Lookup bundle_type from `entityBundleSelections` state for each selected entity
- For DiagramRef, always set `bundle_type: 'diagram_only'`

**Backward compatible context loading**
- Modify `loadContext()` in `frontend/src/utils/contextStorage.ts` (lines 90-124) to handle missing bundle_type gracefully
- Existing validation logic already returns parsed data if structure is valid - no change needed there
- UI layer (ContextPickerModal) handles default inference when bundle_type is missing

**No changes to chat payload behavior**
- The highlighted context sent to the LLM remains unchanged in this iteration
- bundle_type is stored but not used for context expansion yet
- Files `frontend/src/api/chatApi.ts` and `gateway/src/services/promptBuilder.ts` remain unchanged

## Visual Design
No mockups provided - follow existing ContextPickerModal patterns.

**UI Pattern for Bundle Selector**
- Small inline `<select>` dropdown appearing to the right of the checkbox label when item is checked
- Follow existing dropdown styling from `AdvancedAddDialog.module.css` `.spacingSelect` class (lines 95-109)
- Dropdown should be compact (approximately 180px width) to fit inline with option row
- Use existing color scheme: border `#ddd`, focus border `#1976D2`

## Existing Code to Leverage

**`frontend/src/utils/contextStorage.ts`**
- Contains `EntityRef` interface (lines 20-29) and `DiagramRef` interface (lines 34-41) that need bundle_type extension
- Contains `ContextState` interface (lines 47-54) - no changes needed, arrays already typed
- `loadContext()` and `saveContext()` functions handle serialization automatically via JSON - no changes needed

**`frontend/src/components/ProductView/ContextPickerModal.tsx`**
- Main modal component to extend with bundle selector UI
- Existing `selectedEntityIds` state (line 63) tracks which entities are checked
- `handleApply()` (lines 188-224) builds `EntityRef` objects from selections - extend to include bundle_type
- `useEffect` initialization (lines 70-93) loads selections from `initialSelected` - extend to load bundle_type

**`frontend/src/components/DiagramsView/AdvancedAddDialog.module.css`**
- Contains `.spacingSelect` class (lines 95-109) with dropdown styling to reuse
- Contains `.layoutControl` pattern (lines 149-169) for inline control layout

**`frontend/src/utils/contextPickListBuilders.ts`**
- Contains `PickOption` interface with `entity_type` field used to determine which bundle options to show
- `ARCHITECTURE_ENTITY_KEYS` array (lines 40-60) lists entity types that appear in picker

**`frontend/src/__tests__/contextStorage.test.ts`**
- Existing test patterns for context storage round-trip testing
- Extend with tests for bundle_type persistence and backward compatibility

## Out of Scope
- No backend context expansion logic (bundle_type stored but not expanded)
- No changes to ImplementContextResolutionService or condensed DTO payloads
- No changes to prompt templates or LLM payload structure
- No relationship selection UI in the picker (relationships are not selectable)
- No bundle options for entity types other than interfaces, services, physical_data_entities, diagrams
- No custom/user-defined bundle types (only predefined options)
- No bundle editing after initial selection in the same modal session (re-open modal to change)
- No visual indication of bundle scope in the context chips on WorkItemSummaryPanel (future iteration)
- No persistence of bundle_type to backend API (remains localStorage only for now)
- No changes to gateway or architecture-model-service in this iteration
