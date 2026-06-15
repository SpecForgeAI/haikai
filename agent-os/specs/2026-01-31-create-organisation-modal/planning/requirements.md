# Spec Requirements: Iteration 2 - Create Organisation Modal

## Initial Description

Add a simple, global "Create Organisation" modal that is opened via a keyboard shortcut (Ctrl+Shift+M). The modal collects Organisation fields (name, description, standards document lists) with client-side validation, and on Create it persists the Organisation to the Architecture Model Service (no standards generation call yet).

**Scope:**
- In Scope:
  - Frontend: global keyboard shortcut to open modal
  - Frontend: Create Organisation modal UI + validation + chip/bubble multi-string inputs
  - Frontend: reuse existing list-organisations endpoint used by Create Project org autocomplete to validate uniqueness
  - Frontend: call existing create-organisation API via gateway to persist all Organisation fields
  - Frontend: update in-memory/org lists so newly created org is immediately selectable in Create Project UI
  - Minimal tests for modal open/close, validation, and payload mapping
- Out of Scope:
  - Calling external POST /api/v1/standards/global/generate
  - Any async orchestration/job handling
  - Organisation edit/update UI (create only)
  - Changing Create Project flow beyond making new org available after creation

## Requirements Discussion

### First Round Questions

**Q1:** Should the multi-value chip input component be built as a standalone reusable component (e.g., MultiValueChipsInput), or implemented specifically within the Create Organisation modal?
**Answer:** Make it reusable (a small generic "MultiValueChipsInput" component), but only used in Create Organisation for now.

**Q2:** For the backend API, should we extend the existing createOrganisation endpoint to accept the full payload (name, description, and all six docsAppliedTo* lists), or create a new v2 endpoint?
**Answer:** Correct - extend the existing createOrganisation API (or add a new createOrganisationV2) to accept the full payload: name, description, and all six docsAppliedTo* lists.

**Q3:** What is the expected backend API contract? Will backend changes be needed in a prior iteration, or should this spec assume the backend already supports the full Organisation payload?
**Answer:** Backend changes will be needed (Iteration 1 adds these fields + DTO support). For Iteration 2, assume backend now supports the full payload.

**Q4:** For the global keyboard shortcut registration, should it be mounted at the App root level (App.tsx or a top-level provider) to ensure it's truly global across all views?
**Answer:** Yes - mount the modal at the App root (e.g., App.tsx or a top-level provider) so it's truly global; register the shortcut listener there.

**Q5:** After successful organisation creation, should we introduce a shared OrganisationsContext for state management, or keep it simple with a re-fetch approach?
**Answer:** Keep it simple: no new OrganisationsContext yet. After successful create, just re-fetch via listOrganisations() where needed (and/or invalidate a simple in-module cache if one exists).

**Q6:** For the Description textarea, should it be strictly fixed at 3 visible lines with internal scroll, or should users be able to resize it?
**Answer:** Strictly fixed at 3 visible lines with internal scroll; not user-resizable.

**Q7:** Are there any additional exclusions beyond what's stated (no external standards calls, no edit/update UI, no orchestration/jobs)?
**Answer:** No further exclusions beyond what's already stated (no external standards calls, no edit/update UI, no orchestration/jobs).

### Existing Code to Reference

No similar existing features identified for reference by the user.

### Follow-up Questions

None required - all answers were comprehensive and clear.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - no visual files found in the planning/visuals folder.

## Requirements Summary

### Functional Requirements

**Modal Behavior:**
- Global keyboard shortcut Ctrl+Shift+M opens the modal from anywhere in the application
- Shortcut only active when user focus is not inside an input/textarea/contenteditable element
- Prevent default browser behavior when shortcut is triggered
- If modal is already open, shortcut does nothing
- Escape key closes the modal (same as Cancel button)
- Modal mounted at App root level for true global access

**Form Fields:**
- Name: single-line text input, required, must be unique (case-insensitive)
- Description: textarea fixed at 3 visible lines with internal scroll, not user-resizable
- Standards section with bordered box and header "Standards"
- Intro text explaining the purpose of the document lists
- Six multi-value chip inputs in exact order: All, Tech Stack, Coding Styles, Conventions, Error Handling, Validation

**Multi-Value Chip Input Component (MultiValueChipsInput):**
- Reusable component, but only used in Create Organisation for now
- Renders like a text input with chip/bubble values preceding the caret
- Add values via: PASTE (inserts chip from pasted text), TYPE (commit on delimiter "|", "," or ";"), ENTER (commit non-empty token)
- Ignore empty/whitespace-only tokens
- Backspace when input is empty removes last chip
- Each chip has an "x" to remove it
- Normalization: trim tokens, de-duplicate case-insensitively (keep first occurrence), preserve original casing

**Validation:**
- Name required: invalid if empty or whitespace
- Name unique: fetch organisations list on modal open, compare case-insensitively
- Show validation message/indicator in red directly under the Name field when invalid
- Create button disabled when invalid or while save is in progress

**API Integration:**
- Assume backend supports full payload (name, description, and all six docsAppliedTo* lists)
- Use existing/extended createOrganisation API (or createOrganisationV2) via gateway
- Reuse existing organisations list API client method for uniqueness validation
- On successful create, re-fetch via listOrganisations() where needed (no new context)
- On 409 duplicate-name error, show inline name error and keep modal open
- On other errors, show toast/banner error and keep modal open

**Data Mapping:**
- All -> docsAppliedToAllSources: List<string>
- Tech Stack -> docsAppliedToTechStack: List<string>
- Coding Styles -> docsAppliedToCodingStyles: List<string>
- Conventions -> docsAppliedToConventions: List<string>
- Error Handling -> docsAppliedToErrorHandling: List<string>
- Validation -> docsAppliedToValidation: List<string>
- techStandardsGenerated: false (explicit or omitted if backend defaults)

### Reusability Opportunities

- MultiValueChipsInput component built as reusable but scoped to Create Organisation for now
- Existing organisations list API client method to be reused
- Existing create-organisation API client method (or add if missing)

### Scope Boundaries

**In Scope:**
- Frontend: global keyboard shortcut to open modal
- Frontend: Create Organisation modal UI + validation + chip/bubble multi-string inputs
- Frontend: reuse existing list-organisations endpoint for uniqueness validation
- Frontend: call create-organisation API via gateway to persist all Organisation fields
- Frontend: update in-memory/org lists so newly created org is immediately selectable
- Minimal tests for modal open/close, validation, and payload mapping
- Reusable MultiValueChipsInput component

**Out of Scope:**
- Calling external POST /api/v1/standards/global/generate
- Any async orchestration/job handling
- Organisation edit/update UI (create only)
- Changing Create Project flow beyond making new org available after creation
- New OrganisationsContext (use simple re-fetch approach instead)
- Backend changes (assumed completed in Iteration 1)

### Technical Considerations

- Mount modal and shortcut listener at App root (App.tsx or top-level provider)
- Use existing tech stack: React 18.x, TypeScript 5.x, Vite 5.x
- CSS Modules for component styling
- Vitest + React Testing Library for tests
- Description textarea: fixed height for 3 lines, overflow-y: auto, resize: none
- Shortcut should check document.activeElement to avoid triggering in inputs/textareas/contenteditable
