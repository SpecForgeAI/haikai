# Specification: Fix Create Organisation Standards Flow

## Goal
Fix three regressions in the Create Organisation flow: ensure typed chip values commit on blur/submit, persist docsAppliedTo* lists to AMS database on create, and correct the external standards generation request schema while having the gateway resolve organisationId by company name.

## User Stories
- As a user creating an organisation, I want typed values in chip inputs to be saved when I click Create or click away, so that my data is not lost.
- As a user, I want the document references I enter to be saved to the database, so that they are available for standards generation and future reference.

## Specific Requirements

**CHANGE 1: MultiValueChipsInput onBlur Commit + flush() Imperative Handle**
- Add onBlur handler to the input element that calls existing commitValue() function
- Expose flush() method via React.forwardRef + useImperativeHandle pattern
- flush() must commit any pending input value synchronously (call commitValue())
- flush() returns void; commit logic already handles trim, empty-check, case-insensitive de-dupe
- Add MultiValueChipsInputHandle interface: { flush: () => void }
- Component signature changes from function to forwardRef-wrapped function
- Existing props interface (MultiValueChipsInputProps) remains unchanged

**CHANGE 2: CreateOrganisationModal Flush Before Submit**
- Create refs for all six MultiValueChipsInput instances using useRef<MultiValueChipsInputHandle>
- Pass refs via ref prop to each MultiValueChipsInput component
- In handleCreate(), call flush() on all six refs synchronously before collecting state values
- flush() calls must happen before setIsSubmitting(true) and before reading chip state arrays
- Order: flush all inputs -> read current state -> build payload -> call API

**CHANGE 3: AMS CreateOrganisationRequest DTO Expansion**
- Expand existing CreateOrganisationRequest record in OrganisationController.java with six list fields
- Add fields: docsAppliedToAllSources, docsAppliedToTechStack, docsAppliedToCodingStyles, docsAppliedToConventions, docsAppliedToErrorHandling, docsAppliedToValidation (all List<String>)
- Add @JsonAlias annotations for snake_case support: docs_applied_to_all_sources, docs_applied_to_tech_stack, etc.
- Update createOrganisation endpoint to pass all six fields to OrganisationService
- Null lists should be normalized to empty lists in OrganisationService.createOrganisation()

**CHANGE 4: AMS OrganisationService Persistence of docsAppliedTo* Fields**
- Modify createOrganisation method signature to accept all six list fields
- Use OrganisationEntity.builder() to set all fields (nulls become empty lists via @Builder.Default)
- Ensure entity save persists all fields to database via existing StringListJsonConverter
- No changes needed to OrganisationMapper or OrganisationDto (already include all fields)

**CHANGE 5: Frontend StandardsGenerationPayload Schema Change**
- Remove organisationId field from StandardsGenerationPayload interface in organisationsApi.ts
- Frontend sends external-compatible schema directly: company, sources, technical_documents
- Update generateGlobalStandards function to map payload to external format before sending
- New payload structure: { company: string, sources: string[], technical_documents: { tech_stack, coding_style, conventions, error_handling, validation } }

**CHANGE 6: Gateway Standards Route - Resolve Org by Name**
- Remove organisationId from StandardsGenerateRequest interface
- Gateway receives external-compatible schema directly (company, sources, technical_documents)
- After external service returns 200/201, Gateway calls AMS GET /api/v1/organisations/by-name/{company} to resolve organisationId
- Use resolved organisationId for PATCH /api/v1/organisations/{id} to set techStandardsGenerated=true
- If by-name lookup fails (404), log warning but still return success to frontend (standards were generated)

**CHANGE 7: CreateOrganisationModal Standards Payload Update**
- Update handleCreate to build external-compatible payload for generateGlobalStandards
- Remove createdOrg.id from payload; use name.trim() for company field
- Map docsAppliedToAllSources to sources array
- Map remaining five fields to technical_documents object with snake_case keys

## Visual Design
No visual assets provided - this specification addresses backend/data-flow fixes with no UI changes.

## Existing Code to Leverage

**MultiValueChipsInput.tsx (frontend/src/components/common/)**
- Existing commitValue() function handles trim, empty-check, case-insensitive de-dupe
- isDuplicate() helper already implements case-insensitive comparison
- Pattern: commitValue calls onChange with new values array, then clears inputValue state
- Add onBlur handler that calls commitValue() directly

**CreateOrganisationModal.tsx (frontend/src/components/Organisation/)**
- Already imports MultiValueChipsInput and manages six state arrays
- handleCreate already builds CreateOrganisationPayload and StandardsGenerationPayload
- Add ref creation (useRef<MultiValueChipsInputHandle>) for all six chip inputs
- Call flush() on each ref before reading state in handleCreate

**OrganisationController.java (architecture-model-service/.../controller/)**
- CreateOrganisationRequest record already uses @JsonAlias pattern for snake_case
- UpdateOrganisationRequest shows pattern for Boolean field with @JsonAlias
- createOrganisation endpoint calls organisationService.createOrganisation(name, description)
- Expand to pass all six list fields to service method

**OrganisationService.java (architecture-model-service/.../service/)**
- createOrganisation builds OrganisationEntity via builder pattern
- @Builder.Default on entity fields initializes lists to empty ArrayList
- No null-normalization needed if using builder - @Builder.Default handles it

**standardsGenerate.ts (gateway/src/routes/)**
- Already defines ExternalStandardsRequest interface with company/sources/technical_documents
- mapToExternalFormat function shows field mapping pattern
- patchOrganisationFlag function handles PATCH to AMS
- Add org-by-name lookup using existing getConfig().architectureModelServiceBaseUrl

## Out of Scope
- Re-run standards generation UI or retry functionality
- Background jobs or polling for standards generation status
- Editing organisations beyond techStandardsGenerated flag update
- Changes to external Standards service implementation
- Toast message or error formatting convention changes
- 409 conflict handling changes beyond existing behavior
- New API endpoints in AMS beyond expanding existing POST
- Changes to OrganisationMapper or OrganisationDto structure
- Frontend validation changes for chip inputs
- Unit tests for existing OrganisationEntity or OrganisationDto
