# Spec Initialization

## Title
Iteration 2 — Create Organisation modal (keyboard shortcut, save only)

## Raw Idea/Intent

```
intent:
  Add a simple, global "Create Organisation" modal that is opened via a keyboard shortcut.
  The modal collects Organisation fields (name, description, standards document lists) with client-side validation,
  and on Create it persists the Organisation to the Architecture Model Service (no standards generation call yet).

scope:
  in_scope:
    - Frontend: global keyboard shortcut to open modal
    - Frontend: Create Organisation modal UI + validation + chip/bubble multi-string inputs
    - Frontend: reuse existing list-organisations endpoint used by Create Project org autocomplete to validate uniqueness
    - Frontend: call existing create-organisation API via gateway to persist all Organisation fields
    - Frontend: update in-memory/org lists so newly created org is immediately selectable in Create Project UI (where applicable)
    - Minimal tests for modal open/close, validation, and payload mapping
  out_of_scope:
    - Calling external POST /api/v1/standards/global/generate
    - Any async orchestration/job handling
    - Organisation edit/update UI (create only)
    - Changing Create Project flow beyond making new org available after creation

keyboard_shortcut:
  - Register a global shortcut: Ctrl+Shift+M
  - Only active when user focus is not inside an input/textarea/contenteditable element.
  - Prevent default if triggered and open the modal.
  - If the modal is already open, shortcut does nothing.
  - Escape key closes the modal (same as Cancel).

ui_modal:
  name: "Create Organisation"
  layout:
    - Field: Name (single-line text input)
      - Validation: required + unique
      - Show validation message/indicator in red directly under the field when invalid
    - Field: Description (textarea)
      - Visible height: 3 lines (fixed), internal scroll when overflow
    - Section: Standards (thin bordered box with header "Standards")
      - Intro text:
        "Choose the input documents (local files, external URLs) that will generate the standards.
         Provide multiple values that apply to:"
      - Then labeled multi-string inputs in this exact order:
        1) All
        2) Tech Stack
        3) Coding Styles
        4) Conventions
        5) Error Handling
        6) Validation
    - Buttons: [Cancel] [Create]
      - Cancel closes modal without saving
      - Create persists to backend (disabled while invalid or while saving)

multi_string_input_component:
  behavior:
    - Renders like a text input with chip/bubble values preceding the caret.
    - Supports adding values by:
      - PASTE: paste inserts a new chip using the pasted text (trim whitespace).
      - TYPE: when user types a delimiter character "|", "," or ";", commit current token as a chip (trim whitespace).
    - Also commit on Enter key if there is a non-empty token.
    - Ignore empty/whitespace-only tokens (do not create chips).
    - Backspace when input is empty removes the last chip.
    - Each chip has an "x" to remove it.
  normalization:
    - Trim tokens
    - De-duplicate case-insensitively within the same field (keep first occurrence)
    - Preserve original casing in stored chip value
  stored_value:
    - Produces List<string> for each standards field

data_mapping:
  modal_fields_to_entity_and_api_contract_reference:
    - All:
        entity_attribute: docsAppliedToAllSources: List<string>
        (future api mapping): sources: string[]
    - Tech Stack:
        entity_attribute: docsAppliedToTechStack: List<string>
        (future api mapping): technical_documents.tech_stack: string[]
    - Coding Styles:
        entity_attribute: docsAppliedToCodingStyles: List<string>
        (future api mapping): technical_documents.coding_style: string[]
    - Conventions:
        entity_attribute: docsAppliedToConventions: List<string>
        (future api mapping): technical_documents.conventions: string[]
    - Error Handling:
        entity_attribute: docsAppliedToErrorHandling: List<string>
        (future api mapping): technical_documents.error_handling: string[]
    - Validation:
        entity_attribute: docsAppliedToValidation: List<string>
        (future api mapping): technical_documents.validation: string[]
  create_payload:
    - name
    - description
    - docsAppliedToAllSources
    - docsAppliedToTechStack
    - docsAppliedToCodingStyles
    - docsAppliedToConventions
    - docsAppliedToErrorHandling
    - docsAppliedToValidation
    - techStandardsGenerated: false (explicit or omitted if backend defaults)

validation:
  name_required:
    - invalid if empty or whitespace
  name_unique:
    - on modal open, fetch organisations list via the same endpoint used by Create Project org autocomplete
    - compare case-insensitively against existing organisation names
    - invalid if conflicts
  create_button_state:
    - disabled when invalid or while save is in progress
  error_handling:
    - if backend returns 409 duplicate-name, show inline name error and keep modal open
    - for other errors, show a toast/banner error and keep modal open

integration_points:
  frontend_api:
    - Reuse existing organisations list API client method used by Create Project autocomplete
    - Reuse existing create-organisation API client method (or add if missing) that targets Gateway and persists to model service
  state_refresh:
    - After successful create, refresh organisations list in shared state/provider so other screens/components see the new org immediately.

tests:
  add_or_update:
    - Shortcut opens modal (when not focused in input); Escape closes
    - Name required validation renders red error
    - Name uniqueness validation using fetched org list (case-insensitive)
    - Multi-string input: paste creates chip; delimiters commit chip; backspace removes last chip
    - Create calls API with correctly mapped lists; on success modal closes and org list refreshes

acceptance_criteria:
  - Pressing Ctrl+Shift+M opens Create Organisation modal from anywhere appropriate; Escape/Cancel closes it.
  - Name field validates required + case-insensitive uniqueness against existing organisations.
  - Description is a 3-line textarea with internal scrolling.
  - Standards section renders exactly with 6 multi-string chip inputs and commits tokens on paste or on "|", "," or ";".
  - Clicking Create persists organisation with all list fields; new organisation appears in organisation selectors without a full page reload.
  - No external standards generation calls exist in this iteration.
```

## Created
2026-01-31
