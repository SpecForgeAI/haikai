# Specification: Business Logic Templates for Creation Flow

## Goal
Provide a "Start from template" option when creating Business Logic entities, prefilling the description with markdown skeletons to accelerate authoring of common business logic types without backend changes.

## User Stories
- As a modeler, I want to select a template when creating a Business Logic so that I can quickly structure my documentation with appropriate sections.
- As a modeler, I want the template to auto-fill the Type field based on my selection so that I maintain consistent categorization.

## Specific Requirements

**Template Definitions Module**
- Create `src/templates/businessLogicTemplates.ts` as a static frontend-only module
- Export `BusinessLogicTemplate` interface with fields: `id`, `label`, `suggestedType`, `descriptionMarkdown`
- Export `BUSINESS_LOGIC_TEMPLATES` array containing: Blank, Calculation, Validation, Transformation / Mapping, Policy / Decision, Workflow
- Blank template returns empty string for description and no suggested type

**Create Business Logic Modal Component**
- Create `src/components/DiagramsView/modals/CreateBusinessLogicModal.tsx`
- Fields: Name (required text input), Type (free text with suggestions), Template (dropdown), Description (multiline textarea)
- Template dropdown placed above Description field for logical flow
- Follow existing modal patterns from `AttachBusinessLogicModal.tsx` and `LogicalErCreateModal.tsx`
- Use existing CSS patterns from `AttachBusinessLogicModal.module.css`

**Template Prefill Logic**
- On template selection change, check if Description field is empty before prefilling
- If Description is empty: replace with template's `descriptionMarkdown`
- If Description is NOT empty: do not overwrite (no confirmation dialog needed)
- If Type field is empty when template is selected: prefill with template's `suggestedType`
- All prefilled content remains fully editable by user

**Grid Integration - Replace Direct Add**
- Modify `Grid.tsx` to intercept "+ Add Row" click for `business_logics` entity type
- Open `CreateBusinessLogicModal` instead of calling `createEmptyEntity()` directly
- On modal submit: generate UUID via `generateEntityId('business_logics')`, dispatch `ADD_ENTITY`, close modal

**Template Markdown Content**
- Calculation: `## Purpose\n\n## Inputs\n\n## Steps / Formula\n\n## Rounding / Precision\n\n## Edge Cases\n\n## Examples`
- Validation: `## Purpose\n\n## Inputs / Context\n\n## Preconditions\n\n## Rules\n\n## Error Messages / Codes\n\n## Examples`
- Transformation / Mapping: `## Purpose\n\n## Source\n\n## Target\n\n## Field Mappings\n\n## Transform Rules\n\n## Null/Default Handling\n\n## Examples`
- Policy / Decision: `## Decision\n\n## Inputs\n\n## Rules / Criteria\n\n## Exceptions\n\n## Examples`
- Workflow: `## Goal\n\n## Steps\n\n## Branches / Conditions\n\n## Retries / Idempotency\n\n## Observability\n\n## Examples`

**State Management and Row Selection**
- After successful entity creation, set `selectedRowId` to the new entity's ID
- This ensures the newly created Business Logic row is highlighted in the grid
- Modal reset form state on open using useEffect pattern from existing modals

## Visual Design
No visual mockups provided. Modal should match existing modal styling patterns established in `AttachBusinessLogicModal.module.css`.

## Existing Code to Leverage

**`src/components/DiagramsView/modals/AttachBusinessLogicModal.tsx`**
- Provides modal structure pattern with header, content, footer sections
- Shows form field patterns (fieldGroup, label, required indicator, select, textarea)
- Demonstrates useCallback/useState/useMemo patterns for form handling
- Provides keyboard handling (Escape to close, Ctrl+Enter to submit)

**`src/components/DiagramsView/modals/AttachBusinessLogicModal.module.css`**
- Complete CSS styling for modal overlay, container, form fields, buttons
- Includes styles for select dropdown, textarea, error states, loading states
- Maintains consistent visual language with other application modals

**`src/components/Grid/Grid.tsx` (lines 140-144, 449-656)**
- `handleAddRow()` function shows current entity creation flow pattern
- `createEmptyEntity()` switch statement shows entity-specific default creation
- Business logics case (lines 639-651) shows required fields: id, name, type_text, description_md, tags

**`src/utils/idGenerator.ts`**
- `generateEntityId('business_logics')` generates prefixed UUID
- Use this for consistent ID generation pattern

**`src/config/businessLogicTypeSuggestions.ts`**
- Existing `BUSINESS_LOGIC_TYPE_SUGGESTIONS` array for type field suggestions
- Can be referenced for Type field autocomplete/suggestions in modal

## Out of Scope
- Backend storage of templates - templates are frontend-only static data
- Confirmation dialog for overwriting description - simply do not overwrite if not empty
- DSL or structured parsing of template content - markdown is plain text
- Changes to BusinessLogic entity schema - no new fields added
- Template editing or customization UI - templates are read-only
- Applying templates to existing Business Logic entities - only for creation flow
- Changes to other entity creation flows - only business_logics affected
- Template versioning or migration - static content only
- Import/export of custom templates
- Analytics or tracking of template usage
