# Specification: Business Logic Type Suggestions

## Goal
Provide optional, non-enforcing type suggestions as clickable chips in the Business Logic grid editor to improve authoring speed and consistency while keeping the Type field as unrestricted free text.

## User Stories
- As an architect, I want to quickly select common Business Logic types from suggestions so that I can author entities faster with consistent naming
- As an architect, I want to override or modify suggested types after selection so that I maintain full flexibility in my modeling

## Specific Requirements

**Create suggestion constants file**
- Create new file: `src/config/businessLogicTypeSuggestions.ts`
- Export constant array: `BUSINESS_LOGIC_TYPE_SUGGESTIONS`
- Include values: Calculation, Validation, Transformation, Policy, Workflow, Aggregation, Pricing, Eligibility
- Keep as simple string array for easy maintenance and extensibility

**Change type_text cell type from dropdown to text with suggestions**
- In `gridConfigs.ts`, change business_logics `type_text` field cellType from `'dropdown'` to `'text_with_suggestions'`
- Remove the `options: businessLogicTypeOptions` property
- Add new property: `suggestions` pointing to the suggestions constant
- This allows free-text input while showing suggestion chips

**Create new TextWithSuggestionsCell component**
- Create new cell editor component that extends TextCell behavior
- Render standard text input for free-text editing
- Below the input (when editing), render a row of clickable suggestion chips
- Clicking a chip sets the input value to the chip text without closing edit mode
- Keep focus in the input after chip click for immediate modification if desired

**Add suggestion chips styling to Grid.module.css**
- Add `.suggestionChipsContainer` for the row of chips below input
- Add `.suggestionChip` styling following existing badge pattern from SequenceEditorPanel
- Use compact sizing: padding 2px 8px, font-size 11px, border-radius 3px
- Use subtle color scheme: light blue background (#e3f2fd), blue text (#1565C0)
- Add hover state with darker background (#bbdefb)

**Update GridCell to handle new cell type**
- Add case for `'text_with_suggestions'` cellType in GridCell switch statement
- Pass suggestions array from column config to TextWithSuggestionsCell
- Ensure standard onChange callback works identically to text cells

**Preserve existing save flow**
- No changes to entity creation or update dispatch logic
- type_text field saves as string through existing UPDATE_ENTITY action
- No validation or enforcement added to the field

## Existing Code to Leverage

**GridCell.tsx TextCell component**
- Reuse the editing state management pattern (isEditing, editValue, inputRef)
- Reuse keyboard handlers (Enter to save, Escape to cancel, Tab to save)
- Reuse blur handling for committing changes
- Extend with suggestion chip rendering beneath input when isEditing is true

**SequenceEditorPanel.module.css badge styling**
- Follow `.badge` pattern: inline-block, small padding, rounded corners, colored background
- Consistent font-size (10-11px) and weight for compact appearance
- Apply similar hover transitions for interactive feedback

**Grid.module.css cellInput styling**
- Maintain consistent input appearance with existing grid cells
- Suggestion chips should visually complement the input styling

**gridConfigs.ts business_logics configuration**
- Located at line 310-318 in gridConfigs.ts
- Currently uses cellType `'dropdown'` with `businessLogicTypeOptions`
- Change to `'text_with_suggestions'` with new suggestions property

**defaults.ts businessLogicTypeOptions**
- Contains existing type values that can inform the new suggestions list
- New suggestions list intentionally different per requirements (adds Aggregation, Pricing, Eligibility; removes Rule, Constraint, Other)

## Out of Scope
- Backend API changes or new endpoints
- Database schema modifications
- Validation rules that enforce type values against suggestions
- Modal-based editing for Business Logic (only grid editing supported)
- Making suggestions configurable at runtime
- Adding suggestions to other entity type fields
- Persisting user-defined custom suggestions
- Multi-select or combining multiple suggestions
- Search/filter within suggestions list
- Keyboard navigation through suggestion chips
