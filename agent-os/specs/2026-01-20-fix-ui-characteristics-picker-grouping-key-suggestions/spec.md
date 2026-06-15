# Specification: Fix UI Characteristics Picker Grouping and Key Suggestions

## Goal
Improve the UI Characteristics grid UX by (A) grouping Application Points by kind (Applications, Application Components, Services) in the ApplicationPointPickerCell dropdown, and (B) enabling Key field suggestions sourced from backend config with human-friendly chip labels that insert raw snake_case values.

## User Stories
- As a user editing UI Characteristics, I want the Application Point picker to group options by kind (Applications, App Components, Services) instead of a generic "Application Points" section so I can find the right entity faster.
- As a user entering a Key value, I want to see suggested keys as clickable chips with human-friendly labels that insert the raw snake_case value when clicked.

## Specific Requirements

**Part A: Application Point Picker Grouping by Kind**
- Modify `ApplicationPointPickerCell.tsx` to group Application Points by `kind` field instead of a single "Application Points" group
- Use custom group labels: "Applications" (kind=APPLICATION), "Application Components" (kind=APP_COMPONENT), "Services" (kind=SERVICE)
- Keep existing "Classes" and "Methods" groups unchanged (these are for derived APs from Service/Class/Method entities)
- Maintain existing filtering, search, and selection behavior
- Update `OptionGroup` type to include new kind-based groups: `'applications' | 'app_components' | 'services' | 'classes' | 'methods'`
- Update `GROUP_LABELS` constant with human-friendly labels for the new groups

**Part B: Backend Config Default Values for Key Suggestions**
- Add default pipe-delimited values to `application.yml` for the three key suggestion properties
- `ui-characteristics-ui-capability-keys`: Default to common UI capability keys (e.g., "search|filter|sort|pagination|export|import|bulk_action")
- `ui-characteristics-interaction-complexity-keys`: Default to complexity levels (e.g., "simple|moderate|complex|expert")
- `ui-characteristics-technical-shape-keys`: Default to technical patterns (e.g., "form|table|dashboard|wizard|modal|drawer")
- Properties already exist in `AppFeaturesProperties.java` and `BootstrapResponse.java` - no Java changes needed

**Part B: Suggestion Chips Display Pretty Labels but Insert Raw Values**
- Modify `TextWithSuggestionsCell` in `GridCell.tsx` to display chips with pretty labels using `snakeCaseToTitleCase()`
- When a chip is clicked, insert the original raw snake_case value (not the pretty label) into the input
- The `snakeCaseToTitleCase` function already exists in `GridCell.tsx` (line 42-47)
- Chips should show "Bulk Action" but insert "bulk_action" when clicked

**Part A: Group Ordering in Dropdown**
- Render groups in this order: Applications, Application Components, Services, Classes, Methods
- Each group only appears if it has matching options after filtering
- Group headers use existing styling (uppercase, gray background, smaller font)

**Part A: Build Options Logic Refactor**
- In `buildGroupedOptions()`, iterate over `entities.application_points` and assign to groups based on `ap.kind`
- APPLICATION kind -> 'applications' group
- APP_COMPONENT kind -> 'app_components' group
- SERVICE kind -> 'services' group
- CLASS kind -> 'classes' group (derived APs)
- METHOD kind -> 'methods' group (derived APs)
- Services/Classes/Methods entities still create derived AP options in their respective groups

**Unit Tests for ApplicationPointPickerCell Grouping**
- Test that Application Points with kind=APPLICATION appear under "Applications" group header
- Test that Application Points with kind=APP_COMPONENT appear under "Application Components" group header
- Test that Application Points with kind=SERVICE appear under "Services" group header
- Test that filtering works across all kind-based groups
- Test that derived AP creation still works for Service/Class/Method selection

**Unit Tests for TextWithSuggestionsCell Pretty Labels**
- Test that suggestion chips display `snakeCaseToTitleCase(suggestion)` as visible text
- Test that clicking a chip sets the input value to the raw snake_case suggestion (not the pretty label)
- Test with multi-word snake_case values like "bulk_action" -> displays "Bulk Action", inserts "bulk_action"

## Visual Design
No visual mockups provided. Changes follow existing dropdown grouping patterns from `DataEntityPointSelect.tsx`.

## Existing Code to Leverage

**ApplicationPointPickerCell.tsx (lines 40-160)**
- Current `OptionGroup` type and `GROUP_LABELS` constant to extend with kind-based groups
- `buildGroupedOptions()` function to refactor for kind-based grouping logic
- Existing dropdown rendering with group headers at lines 443-476 can be reused

**DataEntityPointSelect.tsx (lines 270-330)**
- Pattern for grouped dropdown rendering with `groupOrder` array and `optionsByGroup` map
- `DATA_ENTITY_POINT_GROUPS` constant pattern for defining group labels
- Shows how to conditionally render groups only when they have options

**GridCell.tsx - snakeCaseToTitleCase (lines 42-47)**
- Existing helper function that converts "bulk_action" to "Bulk Action"
- Already used for dropdown cell formatting, can be reused for suggestion chip labels

**GridCell.tsx - TextWithSuggestionsCell (lines 444-538)**
- Current implementation renders suggestion chips with raw values
- `handleSuggestionClick(suggestion)` at line 489 sets `editValue` to the raw suggestion
- Chip button rendering at lines 510-520 to modify for pretty labels

**AppConfigContext.tsx - parseDelimitedString (lines 137-149)**
- Already parses pipe-delimited strings from backend into arrays
- Frontend already receives and stores key suggestions as `string[]` arrays

## Out of Scope
- Adding new config properties to `AppFeaturesProperties.java` (already exist)
- Modifying `BootstrapController.java` or `BootstrapResponse.java` (already expose the properties)
- Changes to persistence/database schema
- Changes to the "Type" dropdown in UI Characteristics (already uses `formatOptionLabel`)
- Adding new key suggestion properties beyond the three existing types (ui_capability, interaction_complexity, technical_shape)
- Changing how `business_feature` type works (it has no suggestions by design)
- Auto-generating Application Points or modifying derived AP creation logic
- Changes to other picker components (DataEntityPointSelect, TypeaheadCell, etc.)
- Sorting options within groups (maintain existing order)
- Keyboard navigation within suggestion chips
