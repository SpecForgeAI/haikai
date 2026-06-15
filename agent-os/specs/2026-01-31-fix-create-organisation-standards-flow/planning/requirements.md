# Spec Requirements: Fix Create Organisation Standards Flow

## Initial Description

Fix three regressions in the Create Organisation flow:
1. Typed (non-pasted) values must be committed into chips when focus leaves the field or when Create is clicked.
2. Organisation list fields (docsAppliedTo*) must be persisted to the Architecture Model Service DB on create.
3. The external standards generation call must send the required request body schema (company/sources/technical_documents), and techStandardsGenerated must be set true only when the external call returns HTTP 200/201.

### Scope from Initial Idea

**In Scope:**
- Frontend: MultiValueChipsInput commits pending token on blur and on submit
- Frontend: Create Organisation modal submits correct docsAppliedTo* arrays (including last typed token)
- Architecture Model Service: Create Organisation endpoint accepts and persists docsAppliedTo* arrays
- Gateway: standards/global/generate proxy accepts the external schema and forwards it unchanged to the external service
- Gateway: on external success (200/201), update Organisation.techStandardsGenerated=true in AMS; otherwise leave false
- Tests covering the three fixes

**Out of Scope:**
- Re-run standards generation UI, retries, background jobs, polling
- Editing organisations beyond techStandardsGenerated update after create
- Changes to external service implementation

## Requirements Discussion

### First Round Questions

**Q1:** For onBlur commit logic, should blurring the input field call the exact same commitValue logic (trim, ignore empty, case-insensitive de-dupe)?
**Answer:** Yes - onBlur should call the exact same commitValue logic (trim, ignore empty, case-insensitive de-dupe).

**Q2:** For the flushPendingToken pattern, is useImperativeHandle + forwarded refs with a flush() method acceptable?
**Answer:** Yes - useImperativeHandle + forwarded refs with a flush() method is acceptable.

**Q3:** For synchronous commit before API call, should flush/commit happen synchronously in the Create click handler before starting the async API calls?
**Answer:** Yes - flush/commit synchronously in the Create click handler before starting the async API calls.

**Q4:** For the Architecture Model Service DTO, should we expand the existing CreateOrganisationRequest DTO to include all six list fields, or create a separate DTO?
**Answer:** Expand the existing CreateOrganisationRequest DTO to include all six list fields (no separate DTO needed).

**Q5:** For JSON field naming compatibility, should we add @JsonAlias to support both camelCase and snake_case for those fields?
**Answer:** Yes - add @JsonAlias to support both camelCase and snake_case for those fields.

**Q6:** For the organisationId in the standards generation request, should the frontend send organisationId or should the gateway resolve org id (by company name) for the PATCH?
**Answer:** Prefer the new schema: frontend should NOT send organisationId; gateway should resolve org id (by company name) for the PATCH.

**Q7:** Is the external service URL/schema finalized?
**Answer:** Yes - path and schema are finalized: POST /api/v1/standards/global/generate with company/sources/technical_documents.

**Q8:** Are there any explicit exclusions or things to avoid changing?
**Answer:** Exclude unrelated behavior changes: don't change toast/error formatting conventions or 409 handling beyond what's required for these fixes.

### Existing Code to Reference

No similar existing features were explicitly identified for reference by the user. However, based on the initialization document, the following files are directly relevant:

**Frontend Components:**
- `frontend/src/components/common/MultiValueChipsInput.tsx` - The chip input component to be modified

**Architecture Model Service:**
- OrganisationController create request DTO
- OrganisationService create logic
- DTO/entity mapping

**Gateway:**
- Standards/global/generate route
- Organisation update mechanism

### Follow-up Questions

No follow-up questions needed - the user's answers were comprehensive and addressed all key decision points.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - no visual assets were submitted for this specification.

## Requirements Summary

### Functional Requirements

**Change 1: Frontend Chip Commit on Blur + Submit**
- MultiValueChipsInput must commit pending token on blur using exact same logic as delimiter/Enter commit
- Commit logic: trim whitespace, ignore empty tokens, case-insensitive de-duplication (keep first occurrence)
- Expose flush() method via useImperativeHandle + forwarded refs for parent to force-commit before submit
- Create Organisation modal must call flush() on all six chip inputs synchronously before collecting values for API calls
- Existing commit triggers remain unchanged: paste, delimiters (|, comma, semicolon), Enter key
- Backspace on empty input removes last chip; chips removable with "x" button

**Change 2: Persist docsAppliedTo* Lists on Organisation Create**
- Architecture Model Service POST /api/v1/organisations must accept and persist six list fields:
  - docsAppliedToAllSources: List<String>
  - docsAppliedToTechStack: List<String>
  - docsAppliedToCodingStyles: List<String>
  - docsAppliedToConventions: List<String>
  - docsAppliedToErrorHandling: List<String>
  - docsAppliedToValidation: List<String>
- Expand existing CreateOrganisationRequest DTO (no separate DTO)
- Add @JsonAlias annotations to support both camelCase and snake_case field names
- Null lists normalized to empty lists before save
- techStandardsGenerated remains false on create (default)
- Preserve existing 409 conflict behavior for duplicate organisation names

**Change 3: Correct External Standards Request Body + Flag Update**
- Frontend sends external schema to Gateway (NOT organisation-shaped payload):
  ```json
  {
    "company": "<org name>",
    "sources": [...],
    "technical_documents": {
      "tech_stack": [...],
      "coding_style": [...],
      "conventions": [...],
      "error_handling": [...],
      "validation": [...]
    }
  }
  ```
- Frontend does NOT send organisationId in request
- Gateway forwards request unchanged to external service: POST /api/v1/standards/global/generate
- Gateway resolves organisationId by company name (via AMS lookup endpoint)
- On external HTTP 200/201: Gateway PATCHes Organisation.techStandardsGenerated=true in AMS
- On external non-200/201: techStandardsGenerated remains false, error propagated to frontend
- Standards generation failure must NOT rollback org creation

### Reusability Opportunities

- Existing commit logic in MultiValueChipsInput can be reused for onBlur handler
- Existing CreateOrganisationRequest DTO structure can be extended
- Existing PATCH endpoint pattern in AMS (if available) for flag update
- Existing organisation lookup patterns for by-name resolution

### Scope Boundaries

**In Scope:**
- Frontend MultiValueChipsInput blur handling and flush capability
- Frontend Create Organisation modal flush-before-submit logic
- AMS CreateOrganisationRequest DTO expansion with six list fields
- AMS persistence of docsAppliedTo* arrays
- Gateway standards/global/generate route with external schema
- Gateway org-by-name lookup and PATCH for techStandardsGenerated flag
- Unit and integration tests for all three changes

**Out of Scope:**
- Re-run standards generation UI
- Retry logic or background jobs for standards generation
- Polling for generation status
- Editing organisations (beyond techStandardsGenerated update)
- Changes to external service implementation
- Toast/error formatting convention changes
- 409 handling changes beyond what exists

### Technical Considerations

- useImperativeHandle pattern for exposing flush() method on chip inputs
- Synchronous flush execution before async API calls
- @JsonAlias for flexible JSON field name support in Java DTOs
- Gateway must chain: forward to external -> lookup org by name -> PATCH flag
- Two-phase create: first persist org to DB, then trigger standards generation
- Standards generation is fire-and-forget from org creation perspective (no rollback)
- External service endpoint is finalized: POST /api/v1/standards/global/generate
