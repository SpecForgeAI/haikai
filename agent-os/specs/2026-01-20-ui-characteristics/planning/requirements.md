# Spec Requirements: UI Characteristics

## Initial Description

Add a new UI entity called "UI Characteristics" to the Architecture & Design -> UI domain. This entity captures key business features and UI/UX/technical characteristics associated with frontend UIs, linked to an Application Point, and persists as part of the architecture model (DB + file import/export).

The entity has the following fields:
- id: string (required, primary key)
- uiId: string (required, references ApplicationPoint.id)
- type: string (required) - enum with values: business_feature, ui_capability, interaction_complexity, technical_shape
- key: string (optional, free text with type-dependent autocomplete)
- name: string (required)
- description: string (optional)
- evidence: string (optional, free text)

The feature requires:
- Backend DTO, entity, repository, and Liquibase migration
- Frontend type definitions, model state integration, and grid UI
- Configuration for key autocomplete suggestions via bootstrap endpoint
- Full round-trip support (DB, file export/import)

## Requirements Discussion

### First Round Questions

**Q1:** Application Point Picker Scope - Should the UI field use:
A) The existing picker groups (which include Services, Classes, Methods with non-selectable section headers)
B) A simpler picker limited only to Application Points?

**Answer:** A - Use the existing picker groups (which include Services, Classes, Methods with non-selectable section headers)

**Q2:** Key Field Autocomplete Trigger - Should the autocomplete dropdown:
A) Show all suggestions immediately when the field is focused
B) Only show autocomplete dropdown after the user starts typing?

**Answer:** B - Only show autocomplete dropdown after the user starts typing

**Q3:** Type Column Behavior - Should the Type column be:
A) Standard dropdown where users must select from the list
B) Editable dropdown allowing custom type values?

**Answer:** A - Standard dropdown where users must select from the list. IMPORTANT: Display the enum values with spaces instead of underscores and each word capitalized. For example:
- `business_feature` displays as "Business Feature"
- `ui_capability` displays as "UI Capability"
- `interaction_complexity` displays as "Interaction Complexity"
- `technical_shape` displays as "Technical Shape"

**Q4:** Evidence Field - Should the evidence field be:
A) An appendable field where each entry is prefixed with a date stamp (similar to a log)
B) Simply a text field that users edit in place?

**Answer:** B - Simply a text field that users edit in place (not appendable with dated entries)

**Q5:** Tab Positioning - The raw idea specifies "UI Characteristics" as the 5th tab under UI entities, positioned after "UI Actions". Is this confirmed?

**Answer:** Yes, confirmed - "UI Characteristics" is the 5th tab positioned after "UI Actions"

**Q6:** Type -> Key Switching Behavior - When a user changes the Type dropdown value, should the Key field:
A) Preserve the current key value even if it doesn't match the new type's suggestions
B) Clear the Key value when Type is changed?

**Answer:** B - Clear the Key value when Type is changed

**Q7:** Explicit Exclusions - Are there any behaviors or features that should explicitly NOT be included in this implementation?

**Answer:** No additional exclusions beyond what was already stated in the raw idea

### Existing Code to Reference

**Similar Features Identified:**
- Feature: UI Screens, UI Workflow Transitions, UI Components, UI Actions - these are the existing UI entity tabs that follow the same grid pattern
- Components to potentially reuse: Existing entity grid patterns for add/edit/remove row functionality
- Backend logic to reference: Existing UI entity DTOs, entities, repositories, and mapping patterns

The user explicitly stated: "the feature should follow the existing entity grid patterns exactly as implemented for other UI entities (UI Screens, UI Workflow Transitions, UI Components, UI Actions). Same styling, same add/edit/remove row functionality."

### Follow-up Questions

No follow-up questions were needed - the user's answers were comprehensive and clear.

## Visual Assets

### Files Provided:

No visual assets provided.

### Visual Insights:

The user explicitly stated that no visual mockups are needed because the feature should follow existing entity grid patterns exactly. The implementation should match:
- Same styling as other UI entity grids
- Same add/edit/remove row functionality
- Same Application Point picker pattern (grouped with non-selectable section headers)

## Requirements Summary

### Functional Requirements

- Add "UI Characteristics" as the 5th tab in the UI entities section (after UI Actions)
- Grid-based editor with columns: ID*, UI*, Type*, Key, Name*, Description, Evidence
- UI field uses existing Application Point picker with grouped subtypes (Services, Classes, Methods) and non-selectable section headers
- Type dropdown displays enum values formatted with spaces and capitalization:
  - "Business Feature" (stores as `business_feature`)
  - "UI Capability" (stores as `ui_capability`)
  - "Interaction Complexity" (stores as `interaction_complexity`)
  - "Technical Shape" (stores as `technical_shape`)
- Key field provides type-dependent autocomplete:
  - For "Business Feature": no autocomplete suggestions
  - For other types: autocomplete from configured suggestion lists
  - Autocomplete only triggers after user starts typing (not on focus)
  - Free text always allowed (no hard validation)
- When Type is changed, the Key field value is cleared
- Evidence field is a simple text field (not appendable/dated)
- Add, edit, and remove row functionality matching existing UI entity grids
- Backend persistence with UICharacteristicEntity and ui_characteristics table
- Bootstrap endpoint exposes configuration for key suggestion lists
- Full round-trip support: DB persistence, file export, file import
- Backward compatibility: opening older models without ui_characteristics works (empty list)

### Reusability Opportunities

- UI Screens, UI Workflow Transitions, UI Components, UI Actions grids for pattern reference
- Existing Application Point picker component with grouped autocomplete
- Existing entity grid component with add/edit/remove functionality
- Existing UI entity DTO, entity, and repository patterns in backend
- Existing MetaModelEntitiesDto extension pattern
- Existing Liquibase changelog patterns for UI entity tables

### Scope Boundaries

**In Scope:**
- UICharacteristic entity definition (frontend and backend)
- Grid UI for CRUD operations
- Type dropdown with formatted display values
- Key autocomplete with type-dependent suggestions
- Application Point picker integration
- Backend DTO, entity, repository
- Liquibase migration for ui_characteristics table
- Bootstrap configuration for suggestion lists
- File export/import support
- DB persistence integration
- Backward compatibility for older models

**Out of Scope:**
- Hard validation on key values (free text always allowed)
- Target-state or sizing logic
- Automatic derivation logic (pure capture only)
- Appendable/dated evidence entries
- Custom type values (fixed enum only)

### Technical Considerations

- Entity naming: "UICharacteristic" (singular) / "UI Characteristics" (display)
- Table name: ui_characteristics
- Configuration properties use pipe (|) or comma (,) delimiters for suggestion lists
- Backend should split delimiters defensively
- Bootstrap endpoint provides: uiCharacteristicsUiCapabilityKeys, uiCharacteristicsInteractionComplexityKeys, uiCharacteristicsTechnicalShapeKeys
- Type enum values stored as snake_case, displayed as Title Case with spaces
- Key clearing behavior on Type change prevents mismatched suggestions
- Follow existing UI entity patterns exactly for consistency
