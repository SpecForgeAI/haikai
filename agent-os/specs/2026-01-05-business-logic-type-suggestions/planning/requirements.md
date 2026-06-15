# Requirements: Business Logic Type Suggestions

## Feature Request

**Title:** Add Business Logic Type free-text suggestions (non-enforcing) in UI

**Intent:**
Improve authoring speed and consistency for Business Logic by providing optional "suggested types" that users can click to populate the existing free-text Type field. Type remains unrestricted free text (no enum, no validation constraints).

## Scope

- Frontend only
- Business Logic type storage remains a string (type_text) persisted as-is
- No schema changes, no backend changes

## Requirements

1. Business Logic "Type" must remain a free-text editable field
2. Provide a visible, lightweight suggestion UI for common types:
   - Calculation, Validation, Transformation, Policy, Workflow, Aggregation, Pricing, Eligibility
3. Selecting a suggestion must:
   - Set the Type field value to the clicked suggestion text
   - NOT restrict subsequent edits (user can modify to anything)
4. Suggestions are optional - user can ignore them and type any value
5. Suggestions must appear wherever Business Logic Type is edited (grid row editor or modal)

## UX Constraints

- No confirmation dialog when applying a suggestion
- Clicking a suggestion always sets the value (explicit action)
- Keep UI compact (chips/pills) and consistent with existing styling

## Implementation Guidance

1. Add suggestion list constant:
   - Create: src/config/businessLogicTypeSuggestions.ts
   - export const BUSINESS_LOGIC_TYPE_SUGGESTIONS = ['Calculation', 'Validation', 'Transformation', 'Policy', 'Workflow', 'Aggregation', 'Pricing', 'Eligibility']

2. Render suggestion chips next to Type editor:
   - Update Business Logics grid configuration/editor
   - For the "Type" column (type_text):
     - Render clickable chips beneath or beside the text input when cell is in edit mode
   - On chip click:
     - Set the edited cell value to the chip text
     - Keep focus in the input

3. Ensure persistence unchanged:
   - The edited Type value saves through existing model save flow

## Acceptance Criteria

- Business Logic Type remains free text and accepts arbitrary strings
- Suggestions appear in the Business Logic editing experience and are clickable
- Clicking a suggestion sets the type value but does not enforce or lock the field
- No backend or schema changes required
- Model round-trips successfully

## Out of Scope

- Backend changes
- Schema changes
- Enforcing/validating the Type field against the suggestions list
- Modal editing (if exists) - only grid editing is in scope for this feature
