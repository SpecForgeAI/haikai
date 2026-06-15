# Task Breakdown: Business Logic Templates for Creation Flow

## Overview
Total Tasks: 6 Task Groups, ~25 Sub-tasks

This is a **frontend-only feature** with no backend changes. The feature provides a "Start from template" option when creating Business Logic entities, prefilling the description with markdown skeletons.

## Files to Create
- `frontend/src/templates/businessLogicTemplates.ts`
- `frontend/src/components/DiagramsView/modals/CreateBusinessLogicModal.tsx`
- `frontend/src/components/DiagramsView/modals/CreateBusinessLogicModal.module.css`

## Files to Modify
- `frontend/src/components/Grid/Grid.tsx` (lines 140-144, 639-651)

## Task List

### Task Group 1: Template Definitions Module
**Dependencies:** None

- [x] 1.0 Complete template definitions module
  - [x] 1.1 Write 3-4 focused tests for template module
    - Test `BusinessLogicTemplate` interface structure validation
    - Test `BUSINESS_LOGIC_TEMPLATES` array contains all 6 templates (Blank, Calculation, Validation, Transformation/Mapping, Policy/Decision, Workflow)
    - Test Blank template returns empty string for description and undefined suggestedType
    - Test each template has required fields: `id`, `label`, `suggestedType`, `descriptionMarkdown`
  - [x] 1.2 Create `frontend/src/templates/businessLogicTemplates.ts`
    - Export `BusinessLogicTemplate` interface with fields:
      - `id: string` - unique template identifier
      - `label: string` - display name for dropdown
      - `suggestedType: string | undefined` - prefill value for Type field
      - `descriptionMarkdown: string` - markdown skeleton content
    - Export `BUSINESS_LOGIC_TEMPLATES` array
  - [x] 1.3 Implement Blank template
    - `id: 'blank'`
    - `label: 'Blank'`
    - `suggestedType: undefined`
    - `descriptionMarkdown: ''`
  - [x] 1.4 Implement Calculation template
    - `id: 'calculation'`
    - `label: 'Calculation'`
    - `suggestedType: 'Calculation'`
    - `descriptionMarkdown: '## Purpose\n\n## Inputs\n\n## Steps / Formula\n\n## Rounding / Precision\n\n## Edge Cases\n\n## Examples'`
  - [x] 1.5 Implement Validation template
    - `id: 'validation'`
    - `label: 'Validation'`
    - `suggestedType: 'Validation'`
    - `descriptionMarkdown: '## Purpose\n\n## Inputs / Context\n\n## Preconditions\n\n## Rules\n\n## Error Messages / Codes\n\n## Examples'`
  - [x] 1.6 Implement Transformation/Mapping template
    - `id: 'transformation'`
    - `label: 'Transformation / Mapping'`
    - `suggestedType: 'Transformation'`
    - `descriptionMarkdown: '## Purpose\n\n## Source\n\n## Target\n\n## Field Mappings\n\n## Transform Rules\n\n## Null/Default Handling\n\n## Examples'`
  - [x] 1.7 Implement Policy/Decision template
    - `id: 'policy'`
    - `label: 'Policy / Decision'`
    - `suggestedType: 'Policy'`
    - `descriptionMarkdown: '## Decision\n\n## Inputs\n\n## Rules / Criteria\n\n## Exceptions\n\n## Examples'`
  - [x] 1.8 Implement Workflow template
    - `id: 'workflow'`
    - `label: 'Workflow'`
    - `suggestedType: 'Workflow'`
    - `descriptionMarkdown: '## Goal\n\n## Steps\n\n## Branches / Conditions\n\n## Retries / Idempotency\n\n## Observability\n\n## Examples'`
  - [x] 1.9 Ensure template module tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify all templates export correctly

**Acceptance Criteria:**
- All 6 templates defined with correct structure
- Blank template has empty description and no suggested type
- All other templates have markdown skeletons matching spec
- Template types align with `BUSINESS_LOGIC_TYPE_SUGGESTIONS` from `src/config/businessLogicTypeSuggestions.ts`

---

### Task Group 2: Modal Component Structure
**Dependencies:** Task Group 1

- [x] 2.0 Complete modal component structure
  - [x] 2.1 Write 4-5 focused tests for modal component
    - Test modal renders when `isOpen=true` and does not render when `isOpen=false`
    - Test Name field is required (submit disabled when empty)
    - Test form resets when modal opens (useEffect pattern)
    - Test keyboard handlers: Escape closes modal, Ctrl+Enter submits
    - Test onSubmit callback receives correct BusinessLogic entity structure
  - [x] 2.2 Create `frontend/src/components/DiagramsView/modals/CreateBusinessLogicModal.tsx`
    - Follow pattern from `AttachBusinessLogicModal.tsx` (lines 1-252)
    - Import React hooks: useState, useCallback, useMemo, useEffect
    - Import `BusinessLogic` type from `../../../types/model`
    - Import `generateEntityId` from `../../../utils/idGenerator`
    - Import `BUSINESS_LOGIC_TEMPLATES` from `../../../templates/businessLogicTemplates`
  - [x] 2.3 Define component props interface
    ```typescript
    export interface CreateBusinessLogicModalProps {
      isOpen: boolean;
      onClose: () => void;
      onSubmit: (entity: BusinessLogic) => void;
    }
    ```
  - [x] 2.4 Define form data interface
    ```typescript
    interface CreateBusinessLogicFormData {
      name: string;
      typeText: string;
      templateId: string;
      descriptionMd: string;
    }
    ```
  - [x] 2.5 Implement form state management
    - Initialize with default values (empty strings, templateId: 'blank')
    - Add `errors` state for validation messages
    - Add `isSubmitting` state for loading indicator
  - [x] 2.6 Implement useEffect for form reset on open
    - Reset all form fields to defaults when `isOpen` changes to true
    - Clear errors and submitting state
    - Follow pattern from `AttachBusinessLogicModal.tsx` lines 78-85
  - [x] 2.7 Implement field change handlers
    - Generic `handleFieldChange` callback for all fields
    - Clear field-specific error when field is modified
    - Follow pattern from `AttachBusinessLogicModal.tsx` lines 87-96
  - [x] 2.8 Ensure modal structure tests pass
    - Run ONLY the 4-5 tests written in 2.1

**Acceptance Criteria:**
- Modal component follows existing patterns from AttachBusinessLogicModal
- Form state properly initializes and resets
- Props interface matches expected usage in Grid.tsx

---

### Task Group 3: Template Application Logic
**Dependencies:** Task Group 2

- [x] 3.0 Complete template prefill behavior
  - [x] 3.1 Write 4-5 focused tests for template prefill logic
    - Test selecting template prefills description when description is empty
    - Test selecting template does NOT overwrite description when not empty
    - Test selecting template prefills Type field when Type is empty
    - Test selecting template does NOT overwrite Type field when not empty
    - Test all prefilled content remains editable
  - [x] 3.2 Implement template selection handler
    - Create `handleTemplateChange` callback
    - Find selected template from `BUSINESS_LOGIC_TEMPLATES` by id
    - Check if description field is empty before prefilling
  - [x] 3.3 Implement description prefill logic
    - If `formData.descriptionMd` is empty string or whitespace: replace with template's `descriptionMarkdown`
    - If `formData.descriptionMd` has content: do not modify (no confirmation dialog)
  - [x] 3.4 Implement Type prefill logic
    - If `formData.typeText` is empty string or whitespace AND template has `suggestedType`: prefill with `suggestedType`
    - If `formData.typeText` has content: do not modify
  - [x] 3.5 Update form state atomically
    - Use single `setFormData` call to update both description and type together
    - Ensure React renders with both updates in same cycle
  - [x] 3.6 Ensure template prefill tests pass
    - Run ONLY the 4-5 tests written in 3.1

**Acceptance Criteria:**
- Template selection only prefills empty fields
- Non-empty fields are never overwritten
- Prefilled content is fully editable
- State updates are atomic

---

### Task Group 4: Modal Form UI and Submit
**Dependencies:** Task Group 3

- [x] 4.0 Complete modal form UI
  - [x] 4.1 Write 3-4 focused tests for form validation and submission
    - Test form validation requires non-empty Name field
    - Test submit creates BusinessLogic with correct structure
    - Test submit generates UUID via `generateEntityId('business_logics')`
    - Test modal closes after successful submit
  - [x] 4.2 Implement form validation
    - Create `isFormValid` useMemo that checks `formData.name.trim()` is non-empty
    - Disable submit button when invalid
  - [x] 4.3 Implement submit handler
    - Validate required Name field
    - Generate ID: `generateEntityId('business_logics')`
    - Create BusinessLogic entity:
      ```typescript
      const entity: BusinessLogic = {
        id: generateEntityId('business_logics'),
        name: formData.name.trim(),
        type_text: formData.typeText.trim() || undefined,
        description_md: formData.descriptionMd || undefined,
        tags: '',
        valid_from: undefined,
        valid_to: undefined,
      };
      ```
    - Call `onSubmit(entity)` then `onClose()`
  - [x] 4.4 Implement modal JSX structure
    - Overlay with click-outside-to-close
    - Header with title "Create Business Logic" and close button
    - Content section with form fields in order:
      1. Name (required text input)
      2. Type (free text input)
      3. Template (dropdown with BUSINESS_LOGIC_TEMPLATES)
      4. Description (multiline textarea)
    - Footer with Cancel and Create buttons
  - [x] 4.5 Implement keyboard handlers
    - Escape key: call `onClose()`
    - Ctrl+Enter: submit if form is valid
    - Follow pattern from `AttachBusinessLogicModal.tsx` lines 147-154
  - [x] 4.6 Ensure form UI tests pass
    - Run ONLY the 3-4 tests written in 4.1

**Acceptance Criteria:**
- Modal UI matches AttachBusinessLogicModal visual structure
- Name field is required, other fields optional
- Template dropdown appears above Description for logical flow
- Keyboard shortcuts work correctly

---

### Task Group 5: Styling
**Dependencies:** Task Group 4

- [x] 5.0 Complete modal styling
  - [x] 5.1 Create `frontend/src/components/DiagramsView/modals/CreateBusinessLogicModal.module.css`
    - Copy base styles from `AttachBusinessLogicModal.module.css` (all 247 lines)
    - Reuse exact same class names for consistency
  - [x] 5.2 Add text input styling (for Name and Type fields)
    - Add `.textInput` class matching `.select` styling but without dropdown arrow
    - Include focus and error states
    ```css
    .textInput {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
      font-family: inherit;
      background: white;
      box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .textInput:focus {
      outline: none;
      border-color: #1976D2;
      box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
    }
    ```
  - [x] 5.3 Extend textarea styling for description
    - Increase `min-height` to 150px for template markdown content
    - Add `.textareaLarge` class variant
  - [x] 5.4 Verify modal width accommodates template content
    - Ensure `max-width: 480px` is sufficient for markdown preview
    - If needed, increase to 520px

**Acceptance Criteria:**
- Modal styling consistent with existing modals
- All form fields properly styled with focus/error states
- Textarea large enough to display template markdown

---

### Task Group 6: Grid Integration
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete Grid.tsx integration
  - [x] 6.1 Write 3-4 focused integration tests
    - Test "+ Add Row" for `business_logics` opens CreateBusinessLogicModal
    - Test modal submit dispatches `ADD_ENTITY` action with new entity
    - Test `selectedRowId` is set to new entity's ID after creation
    - Test other entity types still use direct `createEmptyEntity()` flow
  - [x] 6.2 Add modal state to Grid.tsx
    - Add import for `CreateBusinessLogicModal`
    - Add state: `const [isCreateBusinessLogicModalOpen, setIsCreateBusinessLogicModalOpen] = useState(false);`
  - [x] 6.3 Modify `handleAddRow` function (line 140-144)
    - Add conditional check for `entityType === 'business_logics'`
    - If business_logics: open modal via `setIsCreateBusinessLogicModalOpen(true)`
    - Otherwise: continue with existing `createEmptyEntity()` flow
    ```typescript
    const handleAddRow = () => {
      if (entityType === 'business_logics') {
        setIsCreateBusinessLogicModalOpen(true);
        return;
      }
      const newEntity = createEmptyEntity(entityType);
      dispatch({ type: 'ADD_ENTITY', entityType, entity: newEntity });
      setSelectedRowId(newEntity.id);
    };
    ```
  - [x] 6.4 Implement modal submit handler
    - Create `handleCreateBusinessLogicSubmit` callback
    - Dispatch `ADD_ENTITY` with entityType `'business_logics'` and received entity
    - Set `selectedRowId` to new entity's ID
    - Close modal
    ```typescript
    const handleCreateBusinessLogicSubmit = useCallback((entity: BusinessLogic) => {
      dispatch({ type: 'ADD_ENTITY', entityType: 'business_logics', entity });
      setSelectedRowId(entity.id);
      setIsCreateBusinessLogicModalOpen(false);
    }, [dispatch]);
    ```
  - [x] 6.5 Add modal component to Grid.tsx JSX
    - Render `CreateBusinessLogicModal` at end of component
    - Pass props: `isOpen`, `onClose`, `onSubmit`
  - [x] 6.6 Ensure integration tests pass
    - Run ONLY the 3-4 tests written in 6.1

**Acceptance Criteria:**
- "+ Add Row" for business_logics opens modal instead of direct creation
- Other entity types unaffected
- New entity is selected in grid after creation
- Modal closes after successful submission

---

### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 3-4 tests from Task Group 1 (template definitions)
    - Review 4-5 tests from Task Group 2 (modal structure)
    - Review 4-5 tests from Task Group 3 (template prefill)
    - Review 3-4 tests from Task Group 4 (form validation/submit)
    - Review 3-4 tests from Task Group 6 (grid integration)
    - Total existing tests: approximately 18-22 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify any critical user workflows lacking coverage
    - Focus ONLY on gaps related to Business Logic template creation
    - Prioritize end-to-end template selection to entity creation workflow
  - [x] 7.3 Write up to 5 additional strategic tests if needed
    - Add maximum of 5 new tests to fill identified critical gaps
    - Suggested gap tests:
      - Test full workflow: open modal -> select template -> fill name -> submit -> verify entity in state
      - Test switching between templates updates description correctly
      - Test partial prefill (only type or only description)
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this feature
    - Expected total: approximately 18-27 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical user workflows covered
- No more than 5 additional tests added
- Testing focused exclusively on this feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Template Definitions** - No dependencies, creates foundation
2. **Task Group 2: Modal Component Structure** - Depends on templates module
3. **Task Group 3: Template Application Logic** - Depends on modal structure
4. **Task Group 4: Modal Form UI and Submit** - Depends on template logic
5. **Task Group 5: Styling** - Depends on modal UI being complete
6. **Task Group 6: Grid Integration** - Depends on complete modal
7. **Task Group 7: Test Review** - Final validation

## Reference Files

| File | Purpose | Key Lines |
|------|---------|-----------|
| `src/components/DiagramsView/modals/AttachBusinessLogicModal.tsx` | Modal pattern reference | All (253 lines) |
| `src/components/DiagramsView/modals/AttachBusinessLogicModal.module.css` | CSS pattern reference | All (247 lines) |
| `src/components/Grid/Grid.tsx` | Grid integration point | 140-144 (handleAddRow), 639-651 (business_logics case) |
| `src/utils/idGenerator.ts` | ID generation utility | 54-58 (generateEntityId) |
| `src/config/businessLogicTypeSuggestions.ts` | Type suggestions reference | 15-24 (BUSINESS_LOGIC_TYPE_SUGGESTIONS) |
| `src/types/model.ts` | BusinessLogic type definition | N/A |
