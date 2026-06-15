# Task Breakdown: Fix Create Organisation Standards Flow

## Overview
Total Tasks: 24 (across 4 task groups)

This specification addresses three regressions in the Create Organisation flow:
1. **Regression 1**: Typed chip values not committed on blur/submit
2. **Regression 2**: docsAppliedTo* lists not persisted to AMS database
3. **Regression 3**: Incorrect external standards generation request schema

## Task List

### Frontend Layer - Chip Input Fix

#### Task Group 1: MultiValueChipsInput onBlur Commit + Imperative Handle
**Dependencies:** None

- [x] 1.0 Complete MultiValueChipsInput flush() and onBlur implementation
  - [x] 1.1 Write 4-6 focused tests for flush/blur behavior
    - Test: onBlur commits pending input value to chips array
    - Test: onBlur with empty input does not add empty chip
    - Test: flush() via ref commits pending value synchronously
    - Test: flush() with duplicate value (case-insensitive) does not add
    - Test: component still works with forwardRef wrapper (no regression)
  - [x] 1.2 Add MultiValueChipsInputHandle interface
    - Define interface: `{ flush: () => void }`
    - Export interface from module for use by parent components
    - File: `frontend/src/components/common/MultiValueChipsInput.tsx`
  - [x] 1.3 Convert component to forwardRef pattern
    - Wrap existing function with `React.forwardRef<MultiValueChipsInputHandle, MultiValueChipsInputProps>`
    - Add `ref` parameter to function signature
    - Maintain existing props interface unchanged
    - File: `frontend/src/components/common/MultiValueChipsInput.tsx`
  - [x] 1.4 Implement useImperativeHandle with flush() method
    - Import `useImperativeHandle` from React
    - Call `useImperativeHandle(ref, () => ({ flush: () => commitValue() }))`
    - Ensure flush() calls existing commitValue() function synchronously
    - File: `frontend/src/components/common/MultiValueChipsInput.tsx`
  - [x] 1.5 Add onBlur handler to input element
    - Add `onBlur={commitValue}` to the input element (line ~214-224)
    - Reuse existing commitValue() function which handles trim, empty-check, de-dupe
    - File: `frontend/src/components/common/MultiValueChipsInput.tsx`
  - [x] 1.6 Ensure Task Group 1 tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify onBlur commits value correctly
    - Verify flush() works via ref
    - Do NOT run entire test suite

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- onBlur on input calls commitValue() to add pending value as chip
- flush() method exposed via forwardRef commits pending value synchronously
- Existing behavior (Enter, delimiters, paste, backspace) unchanged
- Component maintains TypeScript type safety with new handle interface

**Files to Modify:**
- `frontend/src/components/common/MultiValueChipsInput.tsx`

---

#### Task Group 2: CreateOrganisationModal Flush Before Submit + Payload Update
**Dependencies:** Task Group 1

- [x] 2.0 Complete CreateOrganisationModal flush integration and payload update
  - [x] 2.1 Write 4-6 focused tests for flush-before-submit behavior
    - Test: handleCreate calls flush() on all six chip input refs before reading state
    - Test: pending typed values are included in create payload after flush
    - Test: standards payload uses new external-compatible schema (no organisationId)
    - Test: technical_documents object has correct snake_case keys
  - [x] 2.2 Create refs for all six MultiValueChipsInput instances
    - Import `MultiValueChipsInputHandle` from MultiValueChipsInput module
    - Create six refs: `useRef<MultiValueChipsInputHandle>(null)` for each chip input
    - Name refs: `allSourcesRef`, `techStackRef`, `codingStylesRef`, `conventionsRef`, `errorHandlingRef`, `validationRef`
    - File: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
  - [x] 2.3 Pass refs to MultiValueChipsInput components
    - Add `ref={allSourcesRef}` to docsAppliedToAllSources input (line ~464-471)
    - Add `ref={techStackRef}` to docsAppliedToTechStack input (line ~474-481)
    - Add `ref={codingStylesRef}` to docsAppliedToCodingStyles input (line ~484-491)
    - Add `ref={conventionsRef}` to docsAppliedToConventions input (line ~494-501)
    - Add `ref={errorHandlingRef}` to docsAppliedToErrorHandling input (line ~504-511)
    - Add `ref={validationRef}` to docsAppliedToValidation input (line ~514-521)
    - File: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
  - [x] 2.4 Add flush() calls in handleCreate before reading state
    - Call `allSourcesRef.current?.flush()` first
    - Call flush() on all six refs synchronously
    - Place flush calls BEFORE `setIsSubmitting(true)` (line ~246)
    - Place flush calls BEFORE reading chip state arrays
    - File: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
  - [x] 2.5 Update StandardsGenerationPayload building in handleCreate
    - Remove `organisationId: createdOrg.id` from payload (line ~272-282)
    - Use `name.trim()` for `company` field
    - Map `docsAppliedToAllSources` to `sources` array
    - Build `technical_documents` object with snake_case keys:
      - `tech_stack`: docsAppliedToTechStack
      - `coding_style`: docsAppliedToCodingStyles
      - `conventions`: docsAppliedToConventions
      - `error_handling`: docsAppliedToErrorHandling
      - `validation`: docsAppliedToValidation
    - File: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
  - [x] 2.6 Ensure Task Group 2 tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify flush calls happen before state reading
    - Verify new payload structure
    - Do NOT run entire test suite

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- All six chip inputs have refs passed to them
- flush() called on all refs before setIsSubmitting(true)
- Standards payload uses external-compatible schema without organisationId
- technical_documents object has correct snake_case field names

**Files to Modify:**
- `frontend/src/components/Organisation/CreateOrganisationModal.tsx`

---

#### Task Group 2B: Frontend API StandardsGenerationPayload Update
**Dependencies:** Task Group 2

- [x] 2B.0 Complete StandardsGenerationPayload schema change
  - [x] 2B.1 Write 2-3 focused tests for new payload structure
    - Test: generateGlobalStandards sends external-compatible format
    - Test: payload contains company, sources, technical_documents (no organisationId)
  - [x] 2B.2 Update StandardsGenerationPayload interface
    - Remove `organisationId: string` field
    - Change `name` to `company: string`
    - Change `docsAppliedToAllSources` to `sources: string[]`
    - Add `technical_documents` object with snake_case keys
    - File: `frontend/src/api/organisationsApi.ts` (lines ~76-93)
  - [x] 2B.3 Update generateGlobalStandards function
    - Update function signature to accept new payload structure
    - Send payload directly to API (already external-compatible format)
    - No additional mapping needed - frontend now builds external format
    - File: `frontend/src/api/organisationsApi.ts` (lines ~340-370)
  - [x] 2B.4 Ensure Task Group 2B tests pass
    - Run ONLY the 2-3 tests written in 2B.1
    - Verify payload structure matches external schema
    - Do NOT run entire test suite

**Acceptance Criteria:**
- The 2-3 tests written in 2B.1 pass
- StandardsGenerationPayload no longer contains organisationId
- Payload structure matches external schema: `{ company, sources, technical_documents }`

**Files to Modify:**
- `frontend/src/api/organisationsApi.ts`

---

### Backend Layer - AMS Persistence Fix

#### Task Group 3: AMS CreateOrganisationRequest DTO Expansion + Service Persistence
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete AMS backend persistence of docsAppliedTo* fields
  - [x] 3.1 Write 4-6 focused tests for DTO and persistence
    - Test: CreateOrganisationRequest accepts all six list fields
    - Test: Snake_case field names work via @JsonAlias
    - Test: createOrganisation persists all six list fields to database
    - Test: Null lists are handled gracefully (normalized to empty via @Builder.Default)
    - Test: OrganisationDto response includes all persisted list fields
  - [x] 3.2 Expand CreateOrganisationRequest record with six list fields
    - Add `List<String> docsAppliedToAllSources` with `@JsonAlias({"docs_applied_to_all_sources"})`
    - Add `List<String> docsAppliedToTechStack` with `@JsonAlias({"docs_applied_to_tech_stack"})`
    - Add `List<String> docsAppliedToCodingStyles` with `@JsonAlias({"docs_applied_to_coding_styles"})`
    - Add `List<String> docsAppliedToConventions` with `@JsonAlias({"docs_applied_to_conventions"})`
    - Add `List<String> docsAppliedToErrorHandling` with `@JsonAlias({"docs_applied_to_error_handling"})`
    - Add `List<String> docsAppliedToValidation` with `@JsonAlias({"docs_applied_to_validation"})`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java` (lines ~45-50)
  - [x] 3.3 Update createOrganisation endpoint to pass all fields to service
    - Pass all six list fields from request to `organisationService.createOrganisation()`
    - Maintain existing name and description parameters
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java` (lines ~106-111)
  - [x] 3.4 Modify OrganisationService.createOrganisation signature
    - Add six List<String> parameters for docsAppliedTo* fields
    - Signature: `createOrganisation(String name, String description, List<String> docsAppliedToAllSources, ...)`
    - Added backwards-compatible overload: `createOrganisation(String name, String description)`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java` (line ~113)
  - [x] 3.5 Update entity builder to set all docsAppliedTo* fields
    - Add `.docsAppliedToAllSources(...)` to builder (null-safe via @Builder.Default)
    - Add `.docsAppliedToTechStack(...)` to builder
    - Add `.docsAppliedToCodingStyles(...)` to builder
    - Add `.docsAppliedToConventions(...)` to builder
    - Add `.docsAppliedToErrorHandling(...)` to builder
    - Add `.docsAppliedToValidation(...)` to builder
    - @Builder.Default on entity handles null -> empty list conversion
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java` (lines ~133-137)
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify DTO accepts all fields with both camelCase and snake_case
    - Verify fields are persisted to database
    - Do NOT run entire test suite

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- CreateOrganisationRequest record includes all six list fields with @JsonAlias
- OrganisationService.createOrganisation accepts and persists all fields
- Null lists handled gracefully via @Builder.Default (become empty lists)
- No changes needed to OrganisationMapper or OrganisationDto (already include all fields)

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java`

---

### Gateway Layer - Schema Correction

#### Task Group 4: Gateway Standards Route - Resolve Org by Name
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Complete Gateway standards route schema update
  - [x] 4.1 Write 4-6 focused tests for new gateway behavior
    - Test: Gateway accepts external-compatible schema (no organisationId)
    - Test: Gateway forwards request unchanged to external service
    - Test: Gateway resolves organisationId by company name after success
    - Test: Gateway calls PATCH with resolved organisationId
    - Test: 404 on by-name lookup logs warning but still returns success
  - [x] 4.2 Update StandardsGenerateRequest interface
    - Remove `organisationId: string` field
    - Keep `company: string` (was `name`, now directly matches external)
    - Keep `sources: string[]` (was `docsAppliedToAllSources`)
    - Keep `technical_documents` object
    - File: `gateway/src/routes/standardsGenerate.ts` (lines ~31-48)
  - [x] 4.3 Remove organisationId validation check
    - Remove validation block that checks for `body.organisationId` (lines ~157-161)
    - Update validation to check for `body.company` instead of `body.name`
    - File: `gateway/src/routes/standardsGenerate.ts`
  - [x] 4.4 Add lookupOrganisationByName helper function
    - Create async function `lookupOrganisationByName(company: string): Promise<string | null>`
    - Call `GET ${config.architectureModelServiceBaseUrl}/api/v1/organisations/by-name/${encodeURIComponent(company)}`
    - Return organisation.id on success, null on 404
    - Log warning on 404, log error on other failures
    - File: `gateway/src/routes/standardsGenerate.ts`
  - [x] 4.5 Update mapToExternalFormat function
    - Change `request.name` to `request.company`
    - Change `request.docsAppliedToAllSources` to `request.sources`
    - Update technical_documents mapping to use new field names
    - Or remove function if request is already in external format
    - File: `gateway/src/routes/standardsGenerate.ts` (lines ~71-83)
  - [x] 4.6 Update POST /generate handler for org lookup after success
    - After successful upstream response (200/201):
      - Call `lookupOrganisationByName(body.company)` to get organisationId
      - If lookup succeeds: call `patchOrganisationFlag(resolvedId, true)`
      - If lookup fails (404): log warning, still return success to frontend
    - Replace direct `body.organisationId` usage with resolved ID
    - File: `gateway/src/routes/standardsGenerate.ts` (lines ~198-227)
  - [x] 4.7 Ensure Task Group 4 tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify gateway accepts new schema
    - Verify org lookup and PATCH orchestration
    - Do NOT run entire test suite

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- StandardsGenerateRequest no longer requires organisationId
- Gateway receives external-compatible schema directly
- Gateway resolves organisationId by calling AMS by-name endpoint after success
- PATCH uses resolved organisationId
- 404 on by-name lookup logs warning but returns success (standards were generated)

**Files to Modify:**
- `gateway/src/routes/standardsGenerate.ts`

---

### Integration Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1, 2, 2B, 3, 4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written in Task 1.1 (MultiValueChipsInput flush/blur)
    - Review the 4-6 tests written in Task 2.1 (CreateOrganisationModal flush)
    - Review the 2-3 tests written in Task 2B.1 (StandardsGenerationPayload)
    - Review the 4-6 tests written in Task 3.1 (AMS DTO/persistence)
    - Review the 4-6 tests written in Task 4.1 (Gateway schema)
    - Total existing tests: approximately 18-27 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on the three regression fixes in this spec
    - Prioritize integration between frontend, gateway, and AMS
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Integration test: Full create organisation flow with typed chip values
    - Integration test: Gateway receives frontend payload and forwards correctly
    - Integration test: AMS persists all fields and returns them in response
    - Skip edge cases and performance tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's features
    - Expected total: approximately 28-37 tests maximum
    - Do NOT run entire application test suite
    - Verify all three regression fixes work end-to-end

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-37 tests total)
- Three regression fixes verified:
  1. Typed chip values committed on blur/submit
  2. docsAppliedTo* fields persisted to AMS database
  3. External standards request schema correct, org resolved by name
- No more than 10 additional tests added to fill gaps

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel - No Dependencies):
  - Task Group 1: MultiValueChipsInput flush/blur (Frontend)
  - Task Group 3: AMS DTO Expansion + Service (Backend)
  - Task Group 4: Gateway Schema Correction (Gateway)

Phase 2 (Sequential - Depends on Phase 1):
  - Task Group 2: CreateOrganisationModal flush + payload (Frontend, depends on 1)
  - Task Group 2B: StandardsGenerationPayload update (Frontend, depends on 2)

Phase 3 (Final - Depends on All):
  - Task Group 5: Test Review & Gap Analysis
```

## File Reference Summary

**Frontend Files:**
- `frontend/src/components/common/MultiValueChipsInput.tsx` - Task Group 1
- `frontend/src/components/Organisation/CreateOrganisationModal.tsx` - Task Group 2
- `frontend/src/api/organisationsApi.ts` - Task Group 2B

**Backend (AMS) Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java` - Task Group 3
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java` - Task Group 3

**Gateway Files:**
- `gateway/src/routes/standardsGenerate.ts` - Task Group 4
